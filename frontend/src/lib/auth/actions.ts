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
  forgotPassword,
  resetPassword,
  linkSocialIdentity,
  addContact,
  NetworkError,
  ApiError,
} from '@/lib/api/client';

/**
 * Server Actions for authentication flows.
 */

export interface AuthActionResult {
  error?: string;
  success?: boolean;
  redirectTo?: string;
}

const VERIFICATION_CONTEXT_COOKIE = 'mentor_verification_context';
const RECOVERY_CONTEXT_COOKIE = 'mentor_recovery_context';

interface VerificationContext {
  type: 'email' | 'phone';
  identifier: string;
}

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

async function clearVerificationContext() {
  const store = await cookies();
  store.set(VERIFICATION_CONTEXT_COOKIE, '', {
    path: '/verify',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'strict',
  });
}

async function getVerificationContext(
  type: 'email' | 'phone',
): Promise<VerificationContext | null> {
  const encoded = (await cookies()).get(VERIFICATION_CONTEXT_COOKIE)?.value;
  if (!encoded) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<VerificationContext>;
    return value.type === type && typeof value.identifier === 'string'
      ? { type, identifier: value.identifier }
      : null;
  } catch {
    return null;
  }
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
    (formData.get('email') as string) ||
    (formData.get('identifier') as string)
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
        try {
          await resendVerification({ channel: 'email', contact: rawIdentifier });
        } catch {
          // Best-effort challenge dispatch: if rate-limited or existing unexpired challenge remains valid, proceed to verify
        }
        await setVerificationContext({ type: 'email', identifier: rawIdentifier });
        return {
          error: 'Please verify your contact before logging in.',
          redirectTo: '/verify?channel=email',
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
    await registerUser({
      email: type === 'email' ? identifier : null,
      phone: type === 'phone' ? identifier : null,
      password,
      confirm_password: confirmPassword,
      privacy_consent,
    });
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
    | 'email'
    | 'phone';
  const token = (formData.get('token') as string)?.trim();

  if (!type || !token) {
    return { error: 'Invalid verification request.' };
  }
  if (type !== 'email' && type !== 'phone') {
    return { error: 'Invalid verification request.' };
  }

  let identifier = (formData.get('identifier') as string)?.trim();
  if (!identifier) {
    const context = await getVerificationContext(type);
    if (context) identifier = context.identifier;
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
    destination =
      session.user.status === 'suspended'
        ? '/settings'
        : session.next_step === 'profile_setup'
          ? '/onboarding/profile'
          : session.next_step === 'add_verified_contact'
            ? '/settings?prompt=verify_contact'
            : '/dashboard';
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
  const rawIdentifier =
    typeof reenteredIdentifier === 'string' ? reenteredIdentifier.trim() : '';
  let identifier = rawIdentifier;
  if (!identifier) {
    const context = await getVerificationContext(type);
    if (context) identifier = context.identifier;
  }
  if (!identifier) return { error: 'Invalid verification request.' };

  try {
    const result = await resendVerification({
      channel: type,
      contact: identifier,
    });
    await setVerificationContext({ type, identifier });
    return {
      success: true,
      expiresInSeconds: result.expires_in_seconds,
      contactMasked: result.contact_masked,
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
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred during OAuth login.',
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

    const alreadyLinked = session.user?.identities?.some(
      (i) => i.provider === provider,
    );
    if (alreadyLinked) {
      const result = await linkSocialIdentity(session.access_token, provider);
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
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
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
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while linking identity.',
    };
  }
}

/**
 * Server action for EP-A12 (`POST /api/v1/auth/contact`) to add and verify an email or phone contact.
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

    await addContact(session.access_token, { channel, contact });
    await setVerificationContext({ type: channel, identifier: contact });
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred while adding contact.' };
  }

  redirect(`/verify?channel=${channel}`);
}
