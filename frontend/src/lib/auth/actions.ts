'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  loginUser,
  registerUser,
  resendVerification,
  verifyEmail,
  verifyPhone,
  logoutUser,
  refreshSession,
  forgotPassword,
  resetPassword,
  linkSocialIdentity,
  addContact,
  requestAccountDeletion,
  getAccountDeletionStatus,
  NetworkError,
  ApiError,
  UnauthorizedError,
} from '@/lib/api/client';
import type { VerificationDraftContext } from '@/lib/auth/verification-draft';

/**
 * Server Actions for authentication flows.
 */

/**
 * Standard result shape returned by authentication server actions.
 */
export interface AuthActionResult {
  error?: string;
  success?: boolean;
  redirectTo?: string;
}

/**
 * Minimal Supabase client interface required by `withSingleSessionRefresh`.
 */
export interface RefreshableSupabaseClient {
  auth: {
    setSession?: (tokens: {
      access_token: string;
      refresh_token: string;
    }) => Promise<{ error?: unknown } | void>;
    signOut?: (options?: { scope?: 'local' | 'global' | 'others' }) => Promise<unknown>;
  };
}

/**
 * Minimal session token pair required by `withSingleSessionRefresh`.
 */
export interface RefreshableSession {
  access_token: string;
  refresh_token?: string | null;
}

const VERIFICATION_CONTEXT_COOKIE = 'mentor_verification_context';
const RECOVERY_CONTEXT_COOKIE = 'mentor_recovery_context';

const ALLOWED_VERIFICATION_CONTEXTS: readonly VerificationDraftContext[] = [
  'registration',
  'unverified_login',
  'secondary_contact',
  'password_recovery',
];

/**
 * Validates whether a raw string is a permitted verification context value.
 */
function isValidVerificationContext(value: string): value is VerificationDraftContext {
  return (ALLOWED_VERIFICATION_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Normalizes an identifier string for case-insensitive verification context matching.
 *
 * @param value - The identifier string to normalize.
 * @returns The trimmed and lowercased identifier.
 */
function normalizeIdentifierForMatch(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Checks whether a caught error is a Next.js navigation redirect signal.
 */
function isNextRedirectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === 'NEXT_REDIRECT') return true;
  if (
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  ) {
    return true;
  }
  return false;
}

/**
 * Determines whether an error represents an HTTP 401 unauthorized response from the backend API.
 */
function isUnauthorizedApiError(err: unknown): boolean {
  if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
    return false;
  }
  return err instanceof UnauthorizedError || (err instanceof ApiError && err.statusCode === 401);
}

/**
 * Safely signs out the local Supabase session without throwing on storage or network failures.
 */
async function safeSignOut(supabase: RefreshableSupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut?.({ scope: 'local' });
  } catch {
    // Ignore sign-out errors during cleanup
  }
}

/** In-flight token refresh promise map keyed by refresh token to prevent concurrent refresh stampedes. */
const inFlightTokenRefreshes = new Map<
  string,
  Promise<{ access_token: string; refresh_token: string }>
>();

/**
 * Coalesces concurrent refreshSession calls for the same refresh token.
 */
function coalesceRefreshSession(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string }> {
  let inFlight = inFlightTokenRefreshes.get(refreshToken);
  if (!inFlight) {
    const created: Promise<{ access_token: string; refresh_token: string }> = refreshSession(
      refreshToken,
    ).finally(() => {
      if (inFlightTokenRefreshes.get(refreshToken) === created) {
        inFlightTokenRefreshes.delete(refreshToken);
      }
    });
    inFlight = created;
    inFlightTokenRefreshes.set(refreshToken, inFlight);
  }
  return inFlight;
}

/**
 * Wraps an authenticated backend API call with at-most-one token refresh via EP-A07 (`POST /auth/refresh`)
 * when the initial call fails with HTTP 401 (`UnauthorizedError`).
 *
 * - Executes `operation(session.access_token)`.
 * - On HTTP 401: attempts a single token refresh using `refreshSession(session.refresh_token)`,
 *   coalesces in-flight refresh requests keyed by refresh token to prevent race conditions,
 *   persists rotated tokens via `supabase.auth.setSession`, mutates `session.access_token` and
 *   `session.refresh_token` in place so sequential calls sharing the same session reference reuse rotated tokens,
 *   and retries `operation` once with the new access token.
 * - If `refresh_token` is missing, `refreshSession` fails, `setSession` fails, or the retried call
 *   still throws HTTP 401, calls `safeSignOut(supabase)` and redirects to `/login` with zero infinite retry loops.
 */
export async function withSingleSessionRefresh<T>(
  supabase: RefreshableSupabaseClient,
  session: RefreshableSession,
  operation: (accessToken: string) => Promise<T>,
): Promise<T> {
  try {
    return await operation(session.access_token);
  } catch (firstErr) {
    if (!isUnauthorizedApiError(firstErr)) {
      throw firstErr;
    }

    const refreshToken =
      typeof session.refresh_token === 'string' ? session.refresh_token.trim() : '';
    if (!refreshToken) {
      await safeSignOut(supabase);
      return redirect('/login') as never;
    }

    const signOutIfNotRotated = async () => {
      if (session.refresh_token === refreshToken) {
        await safeSignOut(supabase);
      }
    };

    let refreshed: { access_token: string; refresh_token: string };
    try {
      refreshed = await coalesceRefreshSession(refreshToken);
    } catch {
      await signOutIfNotRotated();
      return redirect('/login') as never;
    }

    if (!refreshed?.access_token || !refreshed?.refresh_token) {
      await signOutIfNotRotated();
      return redirect('/login') as never;
    }

    if (supabase.auth.setSession) {
      let setSessionFailed = false;
      try {
        const setResult = await supabase.auth.setSession({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
        });
        setSessionFailed = !!(
          setResult &&
          typeof setResult === 'object' &&
          'error' in setResult &&
          setResult.error
        );
      } catch {
        setSessionFailed = true;
      }
      if (setSessionFailed) {
        await signOutIfNotRotated();
        return redirect('/login') as never;
      }
    }

    session.access_token = refreshed.access_token;
    session.refresh_token = refreshed.refresh_token;

    try {
      return await operation(refreshed.access_token);
    } catch (retryErr) {
      if (isUnauthorizedApiError(retryErr)) {
        await safeSignOut(supabase);
        return redirect('/login') as never;
      }
      throw retryErr;
    }
  }
}

/**
 * Shape of the encrypted/base64url verification context cookie.
 */
interface VerificationContext {
  type: 'email' | 'phone';
  identifier: string;
  context?: VerificationDraftContext;
}

/**
 * Persists the short-lived httpOnly verification context cookie scoped to `/verify`.
 */
async function setVerificationContext(context: VerificationContext) {
  const store = await cookies();
  store.set(
    VERIFICATION_CONTEXT_COOKIE,
    Buffer.from(JSON.stringify(context)).toString('base64url'),
    {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/verify',
      maxAge: 600,
    },
  );
}

/**
 * Clears the `/verify` httpOnly verification context cookie after successful verification.
 */
async function clearVerificationContext() {
  const store = await cookies();
  store.set(VERIFICATION_CONTEXT_COOKIE, '', {
    path: '/verify',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'strict',
  });
}

/**
 * Reads and validates the `/verify` httpOnly verification context cookie for the given channel.
 */
async function getVerificationContext(
  type: 'email' | 'phone',
): Promise<VerificationContext | null> {
  const encoded = (await cookies()).get(VERIFICATION_CONTEXT_COOKIE)?.value;
  if (!encoded) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<VerificationContext>;
    if (value.type !== type || typeof value.identifier !== 'string') {
      return null;
    }
    const validContext =
      typeof value.context === 'string' && isValidVerificationContext(value.context)
        ? value.context
        : undefined;
    return {
      type,
      identifier: value.identifier,
      ...(validContext ? { context: validContext } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Normalizes an unknown error payload into a key-value record if valid, or extracts a string message.
 *
 * @param rawErr - The raw error property or caught value to inspect.
 * @returns A record containing error fields, or undefined if not representable.
 */
function toErrorRecord(rawErr: unknown): Record<string, unknown> | undefined {
  if (typeof rawErr === 'string') {
    return { message: rawErr };
  }
  if (rawErr !== null && typeof rawErr === 'object') {
    return rawErr as Record<string, unknown>;
  }
  return rawErr ? {} : undefined;
}

/**
 * Classifies an error code, retry-after duration, and HTTP status code to determine
 * whether an active cooldown or rate limit is in effect for rate-limit reporting.
 *
 * @param code - Error code identifier from response or exception.
 * @param retryAfter - Retry-after duration in seconds, if present.
 * @param statusCode - HTTP status code, if present.
 * @returns Object with isCooldown flag and optional cooldownSeconds.
 */
function classifyCooldown(
  code: unknown,
  retryAfter: unknown,
  statusCode?: number,
): { isCooldown: boolean; cooldownSeconds?: number } {
  const seconds = typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : undefined;
  const isCooldown =
    code === 'RATE_LIMITED' ||
    code === 'RESEND_COOLDOWN_ACTIVE' ||
    code === 'COOLDOWN_ACTIVE' ||
    (seconds !== undefined &&
      statusCode === 429 &&
      code !== 'OTP_LIMIT_EXCEEDED' &&
      code !== 'IP_SEND_LIMIT_EXCEEDED');
  return { isCooldown, cooldownSeconds: seconds };
}

/**
 * Evaluates the outcome of resendVerification (resolved result or caught error)
 * to determine if verification flow can proceed and whether a cooldown was established.
 * A cooldown reservation alone (e.g. 429 RESEND_COOLDOWN_ACTIVE) is not treated as a usable
 * challenge delivery; redirection to code entry requires a confirmed challenge dispatch.
 *
 * @param result - The resolved value from resendVerification if it did not throw.
 * @param error - The caught error if resendVerification threw.
 * @returns Dispatch decision with canProceed flag, optional cooldown in seconds, and optional error message.
 */
function evaluateResendDispatch(
  result: unknown,
  error: unknown,
): {
  canProceed: boolean;
  cooldownSeconds?: number;
  resendAvailableAt?: string;
  errorMessage?: string;
} {
  if (error) {
    if (error instanceof NetworkError) {
      return {
        canProceed: false,
        errorMessage: 'Unable to reach the server. Please try again later.',
      };
    }
    if (error instanceof ApiError) {
      const { isCooldown } = classifyCooldown(
        error.code,
        error.retryAfterSeconds,
        error.statusCode,
      );

      const limitMsg =
        isCooldown || error.statusCode === 429
          ? 'Email delivery is temporarily rate-limited. Please try again later.'
          : error.message || 'Unable to send verification code. Please try again.';

      return {
        canProceed: false,
        errorMessage: limitMsg,
      };
    }
    return {
      canProceed: false,
      errorMessage: 'Unable to send verification code. Please try again.',
    };
  }

  if (result && typeof result === 'object') {
    const raw = result as Record<string, unknown>;
    const errObj = toErrorRecord(raw.error);
    if (errObj) {
      const { isCooldown } = classifyCooldown(
        errObj.code,
        errObj.retryAfterSeconds,
        typeof errObj.statusCode === 'number'
          ? errObj.statusCode
          : typeof raw.statusCode === 'number'
            ? (raw.statusCode as number)
            : undefined,
      );

      const limitMsg =
        isCooldown || errObj.statusCode === 429 || raw.statusCode === 429
          ? 'Email delivery is temporarily rate-limited. Please try again later.'
          : (typeof errObj.message === 'string' && errObj.message) ||
            'Unable to send verification code. Please try again.';

      return {
        canProceed: false,
        errorMessage: limitMsg,
      };
    }

    if (raw.success === false) {
      return {
        canProceed: false,
        errorMessage: 'Unable to send verification code. Please try again.',
      };
    }

    let derivedFromAvailableAt: number | undefined;
    if (typeof raw.resend_available_at === 'string') {
      const parsedMs = Date.parse(raw.resend_available_at);
      if (Number.isFinite(parsedMs) && parsedMs > Date.now()) {
        derivedFromAvailableAt = Math.ceil((parsedMs - Date.now()) / 1000);
      }
    }

    const cooldownVal =
      typeof raw.cooldown === 'number' && raw.cooldown > 0
        ? raw.cooldown
        : typeof raw.retryAfterSeconds === 'number' && raw.retryAfterSeconds > 0
          ? raw.retryAfterSeconds
          : derivedFromAvailableAt;

    const resendAvailableAt =
      typeof raw.resend_available_at === 'string'
        ? raw.resend_available_at
        : typeof cooldownVal === 'number' && cooldownVal > 0
          ? new Date(Date.now() + cooldownVal * 1000).toISOString()
          : undefined;

    return {
      canProceed: true,
      cooldownSeconds: cooldownVal && cooldownVal > 0 ? cooldownVal : undefined,
      resendAvailableAt,
    };
  }

  return { canProceed: true };
}

/**
 * Server action authenticating user credentials via backend EP-A05 and establishing session.
 * Supports email and Bangladesh mobile phone identifiers with unverified contact redirection.
 */
export async function loginAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const rawIdentifier = (
    (formData.get('email') as string) || (formData.get('identifier') as string)
  )?.trim();
  const password = formData.get('password') as string;

  if (!rawIdentifier || !password) {
    return { error: 'Email and password are required.' };
  }

  let destination = '/dashboard';
  try {
    const session = await loginUser(rawIdentifier, password);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) return { error: 'Failed to establish session.' };
    if (session.user.status === 'suspended') {
      destination = '/settings';
    } else if (session.next_step === 'profile_setup') {
      destination = '/onboarding/profile';
    } else if (session.next_step === 'add_verified_contact') {
      destination = '/settings?prompt=verify_contact';
    }
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      if (
        err.statusCode === 403 &&
        (err.code === 'UNVERIFIED_ACCOUNT' ||
          err.code === 'ACCOUNT_NOT_VERIFIED' ||
          err.message?.toLowerCase().includes('verify'))
      ) {
        const channel = rawIdentifier.includes('@') ? 'email' : 'phone';
        if (channel === 'phone') {
          return {
            error:
              'Phone verification is temporarily unavailable. Please sign in with email or contact support.',
          };
        }
        let resendResult: unknown;
        let resendError: unknown;
        try {
          resendResult = await resendVerification({
            channel: 'email',
            contact: rawIdentifier,
          });
        } catch (resendErr) {
          resendError = resendErr;
        }

        const dispatch = evaluateResendDispatch(resendResult, resendError);
        if (!dispatch.canProceed) {
          return {
            error: dispatch.errorMessage || 'Unable to send verification code. Please try again.',
          };
        }

        const verifyUrl =
          typeof dispatch.cooldownSeconds === 'number' && dispatch.cooldownSeconds > 0
            ? `/verify?channel=email&cooldown=${dispatch.cooldownSeconds}`
            : '/verify?channel=email';

        await setVerificationContext({ type: 'email', identifier: rawIdentifier });
        return {
          error: 'Please verify your contact before logging in.',
          redirectTo: verifyUrl,
        };
      }
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during login.' };
  }
  redirect(destination);
}

/**
 * Server action registering a new account via backend EP-A01.
 */
export async function registerAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const type = formData.get('type') as 'email' | 'phone';
  const identifier = formData.get('identifier') as string;
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  const consentRaw = formData.get('privacy_consent');
  const privacy_consent = consentRaw === 'true' || consentRaw === 'on';

  if (!type || !identifier || !password) {
    return { error: 'All fields are required.' };
  }

  if (!privacy_consent) {
    return { error: 'Privacy consent is required.' };
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  try {
    const regResult = (await registerUser({
      email: type === 'email' ? identifier : null,
      phone: type === 'phone' ? identifier : null,
      password,
      confirm_password: confirmPassword,
      privacy_consent,
    })) as unknown;
    if (regResult && typeof regResult === 'object') {
      const raw = regResult as Record<string, unknown>;
      const errObj = toErrorRecord(raw.error);
      if (errObj) {
        return {
          error:
            (typeof errObj.message === 'string' && errObj.message) ||
            'An unexpected error occurred during registration.',
        };
      }
      if (raw.success === false) {
        return {
          error: 'An unexpected error occurred during registration.',
        };
      }
    }
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      if (err.statusCode === 429) {
        return {
          error: 'Email delivery is temporarily rate-limited. Please try again later.',
        };
      }
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during registration.' };
  }

  await setVerificationContext({ type, identifier });
  redirect(`/verify?channel=${type}`);
}

/**
 * Server action verifying email or phone OTP via backend EP-A02 / EP-A03 and establishing session.
 */
export async function verifyOtpAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const type = ((formData.get('channel') || formData.get('type')) as string)?.trim() as
    'email' | 'phone';
  const token = (formData.get('token') as string)?.trim();

  if (!type || !token) {
    return { error: 'Invalid verification request.' };
  }
  if (type !== 'email' && type !== 'phone') {
    return { error: 'Invalid verification request.' };
  }

  let identifier = (formData.get('identifier') as string)?.trim();
  const rawContext = formData.get('context');
  let verifiedContext: VerificationDraftContext | undefined;
  if (rawContext !== null && rawContext !== undefined) {
    if (typeof rawContext !== 'string') {
      return { error: 'Invalid verification request.' };
    }
    const trimmedContext = rawContext.trim();
    if (trimmedContext !== '') {
      if (!isValidVerificationContext(trimmedContext)) {
        return { error: 'Invalid verification request.' };
      }
      verifiedContext = trimmedContext;
    }
  }

  if (!identifier || !verifiedContext) {
    const cookieContext = await getVerificationContext(type);
    if (cookieContext) {
      if (!identifier) identifier = cookieContext.identifier;
      if (!verifiedContext && cookieContext.context) {
        verifiedContext = cookieContext.context;
      }
    }
  }
  if (!identifier) return { error: 'Invalid verification request.' };

  let destination = '/dashboard';
  try {
    const session =
      type === 'email'
        ? await verifyEmail({
            email: identifier,
            code: token,
          })
        : await verifyPhone({
            phone: identifier,
            code: token,
          });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) return { error: 'Failed to establish session.' };
    await clearVerificationContext();
    if (session.user.status === 'suspended') {
      destination = '/settings';
    } else if (verifiedContext === 'secondary_contact') {
      destination = '/settings?verified=contact';
    } else if (session.next_step === 'profile_setup') {
      destination = '/onboarding/profile';
    } else if (session.next_step === 'add_verified_contact') {
      destination = '/settings?prompt=verify_contact';
    } else {
      destination = '/dashboard';
    }
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during verification.' };
  }
  return { success: true, redirectTo: destination };
}

/**
 * Server action resending verification code via backend EP-A04.
 */
export async function resendOtpAction(
  type: 'email' | 'phone',
  reenteredIdentifier?: string,
): Promise<{
  error?: string;
  success?: boolean;
  expiresInSeconds?: number;
  contactMasked?: string;
  resendAvailableAt?: string;
}> {
  if (type !== 'email' && type !== 'phone') {
    return { error: 'Invalid verification channel.' };
  }
  if (type === 'phone') {
    return {
      error:
        'SMS verification is temporarily unavailable. Please verify with email or contact support.',
    };
  }
  const rawIdentifier = typeof reenteredIdentifier === 'string' ? reenteredIdentifier.trim() : '';
  let identifier = rawIdentifier;
  const existingContext = await getVerificationContext(type);
  if (!identifier && existingContext) {
    identifier = existingContext.identifier;
  }
  if (!identifier) return { error: 'Invalid verification request.' };

  try {
    const result = (await resendVerification({
      channel: type,
      contact: identifier,
    })) as unknown;
    if (result && typeof result === 'object') {
      const raw = result as Record<string, unknown>;
      const errObj = toErrorRecord(raw.error);
      if (errObj) {
        return {
          error:
            (typeof errObj.message === 'string' && errObj.message) ||
            'Failed to send verification code. Please try again later.',
        };
      }
      if (raw.success === false) {
        return {
          error: 'Failed to send verification code. Please try again later.',
        };
      }
    }
    const resolved = result as {
      expires_in_seconds?: number;
      contact_masked?: string;
      resend_available_at?: string;
      resendAvailableAt?: string;
      data?: {
        resend_available_at?: string;
        resendAvailableAt?: string;
      };
    };
    const normalizedIdentifier = identifier.trim();
    const matchesExisting =
      !!existingContext &&
      normalizeIdentifierForMatch(existingContext.identifier) ===
        normalizeIdentifierForMatch(normalizedIdentifier);
    const preservedContext = matchesExisting ? existingContext.context : undefined;
    await setVerificationContext({
      type,
      identifier: normalizedIdentifier,
      ...(preservedContext ? { context: preservedContext } : {}),
    });
    const resendAvailableAt =
      resolved?.resendAvailableAt ||
      resolved?.resend_available_at ||
      resolved?.data?.resendAvailableAt ||
      resolved?.data?.resend_available_at;

    return {
      success: true,
      expiresInSeconds: resolved?.expires_in_seconds,
      contactMasked: resolved?.contact_masked,
      ...(resendAvailableAt ? { resendAvailableAt } : {}),
    };
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      if (err.statusCode === 429) {
        return {
          error: 'Email delivery is temporarily rate-limited. Please try again later.',
        };
      }
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred while resending verification.' };
  }
}

/**
 * Server action initiating Supabase OAuth sign-in.
 */
export async function signInWithOAuth(
  provider: 'google' | 'facebook',
): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${siteUrl}/auth/callback?provider=${provider}`,
      },
    });

    if (error) {
      return { error: error.message };
    }

    if (data?.url) {
      redirect(data.url);
    }

    return { error: 'Failed to initiate OAuth login. Missing redirect URL.' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    return {
      error:
        err instanceof Error ? err.message : 'An unexpected error occurred during OAuth login.',
    };
  }
}

/**
 * Server action signing out the user locally and from the backend.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    try {
      await logoutUser(session.access_token);
    } catch {
      // Best-effort backend revocation before clearing local session
    }
  }
  await supabase.auth.signOut();
  redirect('/login');
}

/**
 * Server action initiating password recovery via EP-A08.
 */
export async function forgotPasswordAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const identifier = formData.get('identifier') as string;
  if (!identifier || !identifier.trim()) {
    return { error: 'Email or phone is required.' };
  }

  try {
    await forgotPassword(identifier.trim());
    const store = await cookies();
    store.set(
      RECOVERY_CONTEXT_COOKIE,
      Buffer.from(JSON.stringify({ identifier: identifier.trim() })).toString('base64url'),
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/reset-password',
        maxAge: 600,
      },
    );
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred while requesting password recovery.' };
  }

  redirect('/reset-password');
}

/**
 * Server action confirming password reset via EP-A09.
 */
export async function resetPasswordAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  let identifier = (formData.get('identifier') as string)?.trim();
  if (!identifier) {
    const encoded = (await cookies()).get(RECOVERY_CONTEXT_COOKIE)?.value;
    if (encoded) {
      try {
        const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (typeof parsed?.identifier === 'string') {
          identifier = parsed.identifier;
        }
      } catch {
        // Ignore cookie decode failure
      }
    }
  }
  const code = (formData.get('code') as string)?.trim();
  const newPassword = formData.get('new_password') as string;
  const confirmNewPassword = formData.get('confirm_new_password') as string;

  if (!identifier) {
    return { error: 'Identifier is required. Please restart password recovery.' };
  }
  if (!code || !/^\d{6}$/.test(code)) {
    return { error: 'Enter a six-digit verification code.' };
  }
  if (!newPassword || newPassword.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  if (newPassword !== confirmNewPassword) {
    return { error: 'Passwords do not match.' };
  }

  try {
    await resetPassword(identifier, code, newPassword, confirmNewPassword);
    const store = await cookies();
    store.set(RECOVERY_CONTEXT_COOKIE, '', {
      path: '/reset-password',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'strict',
    });
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred while resetting password.' };
  }

  redirect('/login?reset=success');
}

/**
 * Server action for EP-A11 (`POST /api/v1/auth/identities/link`) to link Google or Facebook to the current verified account.
 * Uses `withSingleSessionRefresh` to attempt at most one token refresh on HTTP 401.
 */
export async function linkIdentityAction(
  provider: 'google' | 'facebook',
): Promise<AuthActionResult & { linked_providers?: string[] }> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { error: 'Authentication session is required to link an identity.' };
    }

    const alreadyLinked = session.user?.identities?.some((i) => i.provider === provider);
    if (alreadyLinked) {
      const result = await withSingleSessionRefresh(supabase, session, (accessToken) =>
        linkSocialIdentity(accessToken, provider),
      );
      if (!result) {
        return {
          error: 'Authentication session expired. Please sign in again.',
          redirectTo: '/login',
        };
      }
      return { success: true, linked_providers: result.linked_providers };
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${siteUrl}/auth/callback?flow=link&provider=${provider}`,
      },
    });

    if (error) {
      return { error: error.message };
    }

    if (data?.url) {
      redirect(data.url);
    }

    return { error: 'Failed to initiate identity linking. Missing redirect URL.' };
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return {
      error:
        err instanceof Error ? err.message : 'An unexpected error occurred while linking identity.',
    };
  }
}

/**
 * Server action for EP-A12 (`POST /api/v1/auth/contact`) to add and verify an email or phone contact.
 * Uses `withSingleSessionRefresh` to attempt at most one token refresh on HTTP 401 and gracefully handles `ALREADY_VERIFIED`.
 */
export async function addContactAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const channelRaw = (formData.get('channel') as string)?.trim().toLowerCase();
  const channel: 'email' | 'phone' = channelRaw === 'phone' ? 'phone' : 'email';
  const contact = (formData.get('contact') as string)?.trim();

  if (!contact) {
    return {
      error: channel === 'phone' ? 'Phone number is required.' : 'Email is required.',
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { error: 'Authentication session is required to add a contact.' };
    }

    const pendingResult = await withSingleSessionRefresh(supabase, session, (accessToken) =>
      addContact(accessToken, { channel, contact }),
    );
    if (!pendingResult) {
      return {
        error: 'Authentication session expired. Please sign in again.',
        redirectTo: '/login',
      };
    }

    await setVerificationContext({
      type: channel,
      identifier: contact,
      context: 'secondary_contact',
    });
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      if (err.code === 'ALREADY_VERIFIED') {
        return {
          error:
            err.message ||
            'আপনার অ্যাকাউন্টের যোগাযোগের তথ্য ইতিমধ্যে যাচাই করা হয়েছে (Account already has a verified contact).',
          redirectTo: '/settings?verified=contact',
        };
      }
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred while adding contact.' };
  }

  redirect(`/verify?channel=${channel}`);
}

// ─── Account Deletion Server Actions (Screen 22 / EP-X01 / EP-X02) ───────────

export interface AccountDeletionActionResult {
  error?: string;
  success?: boolean;
  status?: 'scheduled' | 'in_progress' | 'completed';
  deletionReceipt?: string;
  receiptExpiresAt?: string;
  requestId?: string;
}

export interface AccountDeletionStatusResult {
  error?: string;
  status?: 'scheduled' | 'in_progress' | 'completed';
  completedAt?: string | null;
  providerDeletionRequested?: boolean;
}

/**
 * Server Action requesting account deletion via `POST /api/v1/account/deletion-requests` (EP-X01).
 * Requires confirmation === "DELETE" and live re-authentication credentials.
 * If status === 'completed', clears local Supabase session.
 */
export async function requestAccountDeletionAction(
  _prevState: AccountDeletionActionResult,
  formData: FormData,
): Promise<AccountDeletionActionResult> {
  const confirmation = formData.get('confirmation');
  const password = formData.get('password');
  const reauthToken = formData.get('reauth_token');

  if (confirmation !== 'DELETE') {
    return {
      error: 'কনফার্মেশন নিশ্চিত করতে অবশ্যই DELETE লিখুন (Confirmation must be DELETE).',
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {
      error:
        'আপনার সেশনটি মেয়াদোত্তীর্ণ হয়েছে। অনুগ্রহ করে পুনরায় সাইন ইন করুন (Session expired).',
    };
  }

  const effectivePassword =
    typeof password === 'string' && password.trim() ? password.trim() : undefined;

  const effectiveReauthToken = effectivePassword
    ? undefined
    : typeof reauthToken === 'string' && reauthToken.trim()
      ? reauthToken.trim()
      : session.access_token;

  try {
    const response = await withSingleSessionRefresh(supabase, session, (accessToken) =>
      requestAccountDeletion(accessToken, {
        confirmation: 'DELETE',
        password: effectivePassword,
        reauth_token: effectiveReauthToken,
      }),
    );

    if (!response) {
      return {
        error:
          'আপনার সেশনটি মেয়াদোত্তীর্ণ হয়েছে। অনুগ্রহ করে পুনরায় সাইন ইন করুন (Session expired).',
      };
    }

    if (response.status === 'completed') {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Best effort local sign out
      }
      try {
        const cookieStore = await cookies();
        cookieStore.set('account_deleted', 'true', {
          path: '/',
          maxAge: 60,
          sameSite: 'lax',
          httpOnly: true,
        });
      } catch {
        // Best effort cookie set
      }
    }

    return {
      success: true,
      status: response.status,
      deletionReceipt: response.deletion_receipt,
      receiptExpiresAt: response.receipt_expires_at,
      requestId: response.id,
    };
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    if (err instanceof NetworkError) {
      return {
        error: 'সার্ভারে সংযোগ করা সম্ভব হচ্ছে না। অনুগ্রহ করে আবার চেষ্টা করুন (Network error).',
      };
    }
    if (err instanceof ApiError) {
      if (err.code === 'CONFIRMATION_MISMATCH') {
        return {
          error: 'কনফার্মেশন অবশ্যই DELETE হতে হবে (Confirmation must equal DELETE).',
        };
      }
      if (err.code === 'REAUTH_REQUIRED') {
        return {
          error:
            'সঠিক পাসওয়ার্ড বা রি-অথেনটিকেশন টোকেন প্রয়োজন (Invalid password or re-authentication required).',
        };
      }
      if (err.code === 'DELETION_ALREADY_REQUESTED') {
        return {
          error:
            'এই অ্যাকাউন্টের জন্য ইতিমধ্যে একটি ডিলিট প্রক্রিয়া চলমান রয়েছে (Deletion request already in progress).',
        };
      }
      return { error: err.message };
    }
    return {
      error: 'অ্যাকাউন্ট মোছার সময় একটি অপ্রত্যাশিত সমস্যা হয়েছে (An unexpected error occurred).',
    };
  }
}

/**
 * Server Action polling account deletion status using a DeletionReceipt via EP-X02.
 */
export async function pollAccountDeletionStatusAction(
  receipt: string,
): Promise<AccountDeletionStatusResult> {
  if (!receipt || typeof receipt !== 'string' || !receipt.trim()) {
    return { error: 'Valid deletion receipt token is required.' };
  }

  try {
    const statusRes = await getAccountDeletionStatus(receipt.trim(), true);
    if (statusRes.status === 'completed') {
      const supabase = await createSupabaseServerClient();
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Best effort local sign out
      }
    }

    return {
      status: statusRes.status,
      completedAt: statusRes.completed_at,
      providerDeletionRequested: statusRes.provider_deletion_requested,
    };
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Network error while checking deletion status.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'Unable to verify account deletion status.' };
  }
}
