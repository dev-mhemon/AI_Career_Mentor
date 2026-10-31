'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loginUser, registerUser, resendVerification, verifyEmail, logoutUser, NetworkError, ApiError } from '@/lib/api/client';

/**
 * Server Actions for authentication flows.
 */


export interface AuthActionResult {
  error?: string;
}

const VERIFICATION_CONTEXT_COOKIE = 'mentor_verification_context';

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


export async function loginAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  let destination = '/dashboard';
  try {
    const session = await loginUser(email, password);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) return { error: 'Failed to establish session.' };
    if (
      session.user.status !== 'suspended' &&
      session.next_step === 'profile_setup'
    )
      destination = '/dashboard?next_step=profile_setup';
  } catch (err) {
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during login.' };
  }
  redirect(destination);
}

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
  redirect(`/verify?type=${type}`);
}

export async function verifyOtpAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const type = formData.get('type') as 'email' | 'phone';
  const token = formData.get('token') as string;

  if (!type || !token) {
    return { error: 'Invalid verification request.' };
  }
  const context = await getVerificationContext(type);
  if (!context) return { error: 'Invalid verification request.' };

  if (type !== 'email') {
    return { error: 'Phone verification is temporarily unavailable.' };
  }

  let destination = '/dashboard';
  try {
    const session = await verifyEmail({
      email: context.identifier,
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
      session.next_step === 'profile_setup'
        ? '/dashboard?next_step=profile_setup'
        : session.next_step === 'add_verified_contact'
          ? '/dashboard?next_step=add_verified_contact'
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
  redirect(destination);
}

export async function resendOtpAction(
  type: 'email' | 'phone',
): Promise<{ error?: string; success?: boolean }> {
  const context = await getVerificationContext(type);
  if (!context) return { error: 'Invalid verification request.' };
  const identifier = context.identifier;

  try {
    await resendVerification({
      channel: type,
      contact: identifier,
    });
    await setVerificationContext(context);
    return { success: true };
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
