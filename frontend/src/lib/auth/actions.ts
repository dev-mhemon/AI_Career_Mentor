'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { loginUser, syncUser, getMe, NetworkError, ApiError } from '@/lib/api/client';

/**
 * Server Actions for authentication flows.
 */

async function syncAndRedirect(accessToken: string): Promise<string> {
  await syncUser(accessToken);
  await getMe(accessToken);
  return '/dashboard';
}

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

async function clearVerificationContext() {
  (await cookies()).set(VERIFICATION_CONTEXT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/verify',
    maxAge: 0,
  });
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

  if (!type || !identifier || !password) {
    return { error: 'All fields are required.' };
  }

  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters.' };
  }

  const supabase = await createSupabaseServerClient();

  let signUpError;

  if (type === 'email') {
    const { error } = await supabase.auth.signUp({
      email: identifier,
      password,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback?flow=email`,
      },
    });
    signUpError = error;
  } else if (type === 'phone') {
    const { error } = await supabase.auth.signUp({
      phone: identifier,
      password,
      options: {
        channel: 'sms',
      },
    });
    signUpError = error;
  }

  if (signUpError) {
    if (signUpError.status === 429) {
      return {
        error: 'Email delivery is temporarily rate-limited. Please try again later.',
      };
    }
    return { error: signUpError.message };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Session is null because confirmation is required.
    await setVerificationContext({ type, identifier });
    redirect(`/verify?type=${type}`);
  }

  try {
    const redirectTo = await syncAndRedirect(session.access_token);
    redirect(redirectTo);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    await supabase.auth.signOut({ scope: 'local' });
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during registration.' };
  }
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
  const identifier = context.identifier;

  const supabase = await createSupabaseServerClient();
  let verifyError;

  if (type === 'email') {
    const { error } = await supabase.auth.verifyOtp({
      email: identifier,
      token,
      type: 'email',
    });
    verifyError = error;
  } else {
    const { error } = await supabase.auth.verifyOtp({
      phone: identifier,
      token,
      type: 'sms',
    });
    verifyError = error;
  }

  if (verifyError) {
    if (verifyError.status === 429) {
      return {
        error: 'Too many verification attempts. Please wait a minute and try again.',
      };
    }
    return { error: verifyError.message };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { error: 'Failed to establish session after verification.' };
  }

  try {
    const redirectTo = await syncAndRedirect(session.access_token);
    await clearVerificationContext();
    redirect(redirectTo);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    await supabase.auth.signOut({ scope: 'local' });
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during verification.' };
  }
}

export async function resendOtpAction(
  type: 'email' | 'phone',
): Promise<{ error?: string; success?: boolean }> {
  const context = await getVerificationContext(type);
  if (!context) return { error: 'Invalid verification request.' };
  const identifier = context.identifier;
  const supabase = await createSupabaseServerClient();

  let resendError;

  if (type === 'email') {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: identifier,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback?flow=email`,
      },
    });
    resendError = error;
  } else if (type === 'phone') {
    const { error } = await supabase.auth.resend({
      type: 'sms',
      phone: identifier,
    });
    resendError = error;
  }

  if (resendError) {
    if (resendError.status === 429) {
      return {
        error: 'Email delivery is temporarily rate-limited. Please try again later.',
      };
    }
    return { error: resendError.message };
  }

  return { success: true };
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
  await supabase.auth.signOut();
  redirect('/login');
}
