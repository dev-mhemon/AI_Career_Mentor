'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { syncUser, getMe, NetworkError, ApiError } from '@/lib/api/client';

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

export async function loginAction(
  _prevState: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createSupabaseServerClient();

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return { error: signInError.message };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { error: 'Failed to establish session.' };
  }

  try {
    const redirectTo = await syncAndRedirect(session.access_token);
    redirect(redirectTo);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    await supabase.auth.signOut();
    if (err instanceof NetworkError) {
      return { error: 'Unable to reach the server. Please try again later.' };
    }
    if (err instanceof ApiError) {
      return { error: err.message };
    }
    return { error: 'An unexpected error occurred during login.' };
  }
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
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback`,
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
    const encodedIdentifier = encodeURIComponent(identifier);
    redirect(`/verify?type=${type}&identifier=${encodedIdentifier}`);
  }

  try {
    const redirectTo = await syncAndRedirect(session.access_token);
    redirect(redirectTo);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    await supabase.auth.signOut();
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
  const identifier = formData.get('identifier') as string;
  const token = formData.get('token') as string;

  if (!type || !identifier || !token) {
    return { error: 'Invalid verification request.' };
  }

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
    redirect(redirectTo);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    await supabase.auth.signOut();
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
  identifier: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createSupabaseServerClient();

  let resendError;

  if (type === 'email') {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: identifier,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback`,
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

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
