import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loginAction,
  registerAction,
  verifyOtpAction,
  resendOtpAction,
  logoutAction,
  signInWithOAuth,
  forgotPasswordAction,
  resetPasswordAction,
  linkIdentityAction,
  addContactAction,
  requestAccountDeletionAction,
  pollAccountDeletionStatusAction,
  withSingleSessionRefresh,
} from '@/lib/auth/actions';
import {
  loginUser,
  approveOAuthSession,
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
  ApiError,
  NetworkError,
  UnauthorizedError,
} from '@/lib/api/client';
import { GET as authCallbackGet } from '@/app/auth/callback/route';

import { redirect } from 'next/navigation';

// Mock Supabase
const mockSignUp = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockSetSession = vi.fn();
const mockGetSession = vi.fn();
const mockVerifyOtp = vi.fn();
const mockResend = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockLinkIdentity = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const verificationContext = Buffer.from(
  JSON.stringify({ type: 'email', identifier: 'test@example.com' }),
).toString('base64url');
const mockCookieStore = {
  get: vi.fn(() => ({ value: verificationContext })),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signUp: mockSignUp,
      signOut: mockSignOut,
      setSession: mockSetSession,
      getSession: mockGetSession,
      verifyOtp: mockVerifyOtp,
      resend: mockResend,
      signInWithOAuth: mockSignInWithOAuth,
      linkIdentity: mockLinkIdentity,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
}));

// Mock API Client
vi.mock('@/lib/api/client', () => {
  /**
   * Mock NetworkError mimicking client network failures.
   */
  class MockNetworkError extends Error {
    /**
     * Initializes mock network error with message.
     */
    constructor(message = 'Network error') {
      super(message);
      this.name = 'NetworkError';
    }
  }

  /**
   * Mock API error mimicking backend ApiError structure.
   */
  class MockApiError extends Error {
    /**
     * Initializes mock API error with status code, message, and error code.
     */
    constructor(
      public readonly statusCode: number = 500,
      message = 'Api error',
      public readonly code?: string,
      public readonly requestId?: string,
      public readonly details: unknown[] = [],
      public readonly retryable = false,
      public readonly retryAfterSeconds: number | null = null,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  /**
   * Mock UnauthorizedError mimicking HTTP 401 error subclass.
   */
  class MockUnauthorizedError extends MockApiError {
    /**
     * Initializes mock 401 unauthorized error.
     */
    constructor(message = 'Unauthorized', code?: string, requestId?: string) {
      super(401, message, code, requestId);
      this.name = 'UnauthorizedError';
    }
  }

  return {
    loginUser: vi.fn(),
    syncUser: vi.fn(),
    getMe: vi.fn(),
    approveOAuthSession: vi.fn(),
    registerUser: vi.fn(),
    resendVerification: vi.fn(),
    verifyEmail: vi.fn(),
    verifyPhone: vi.fn(),
    logoutUser: vi.fn(),
    refreshSession: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    linkSocialIdentity: vi.fn(),
    addContact: vi.fn(),
    requestAccountDeletion: vi.fn(),
    getAccountDeletionStatus: vi.fn(),
    NetworkError: MockNetworkError,
    ApiError: MockApiError,
    UnauthorizedError: MockUnauthorizedError,
  };
});

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));
const mockHeaderStore = {
  get: vi.fn<(_name: string) => string | null>(() => null),
};
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
  headers: vi.fn(async () => mockHeaderStore),
}));

describe('Auth Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue({ value: verificationContext });
    mockHeaderStore.get.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loginAction', () => {
    it('returns error if fields are missing', async () => {
      const formData = new FormData();
      const result = await loginAction({}, formData);
      expect(result).toEqual({ error: 'Email and password are required.' });
    });

    it('uses backend EP-A05 and persists only the approved session', async () => {
      const formData = new FormData();
      formData.set('email', 'test@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        access_token: 'approved-access',
        refresh_token: 'approved-refresh',
        user: { status: 'active' },
        next_step: 'app_home',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });
      await loginAction({}, formData);
      expect(loginUser).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'approved-access',
        refresh_token: 'approved-refresh',
      });
      expect(redirect).toHaveBeenCalledWith('/dashboard');
    });

    it('redirects active user to /onboarding/profile when next_step is profile_setup', async () => {
      const formData = new FormData();
      formData.set('email', 'newuser@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        access_token: 'approved-access',
        refresh_token: 'approved-refresh',
        user: { status: 'active' },
        next_step: 'profile_setup',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      await loginAction({}, formData);
      expect(redirect).toHaveBeenCalledWith('/onboarding/profile');
    });

    it('redirects suspended user to /settings shell regardless of next_step', async () => {
      const formData = new FormData();
      formData.set('email', 'suspended@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        access_token: 'approved-access',
        refresh_token: 'approved-refresh',
        user: { status: 'suspended' },
        next_step: 'profile_setup',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      await loginAction({}, formData);
      expect(redirect).toHaveBeenCalledWith('/settings');
    });

    it('catches 403 UNVERIFIED_ACCOUNT and returns error with redirectTo /verify?channel=phone for phone identifier', async () => {
      const formData = new FormData();
      formData.set('identifier', '+8801712345678');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(
          403,
          'Account unapproved; contact confirmation required',
          'UNVERIFIED_ACCOUNT',
        ),
      );
      (resendVerification as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
        resend_available_at: new Date(Date.now() + 60000).toISOString(),
      });

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Please verify your contact before logging in.',
        redirectTo: '/verify?channel=phone&cooldown=60',
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: 'phone',
        contact: '+8801712345678',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        expect.any(String),
        expect.objectContaining({ path: '/verify', maxAge: 600 }),
      );
    });

    it('catches 403 UNVERIFIED_ACCOUNT and returns error with redirectTo /verify for email identifier', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(
          403,
          'Account unapproved; contact confirmation required',
          'UNVERIFIED_ACCOUNT',
        ),
      );
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 'c***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      });

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Please verify your contact before logging in.',
        redirectTo: '/verify?channel=email',
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: 'email',
        contact: 'candidate@example.com',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: '/verify' }),
      );
    });

    it('redirects to /verify?channel=email&cooldown=<seconds> when resendVerification succeeds with cooldown', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(
          403,
          'Account unapproved; contact confirmation required',
          'UNVERIFIED_ACCOUNT',
        ),
      );
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 'c***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
        cooldown: 60,
      } as unknown as Awaited<ReturnType<typeof resendVerification>>);

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Please verify your contact before logging in.',
        redirectTo: '/verify?channel=email&cooldown=60',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: '/verify' }),
      );
    });

    it('returns rate-limited error and does not redirect when resendVerification fails with 429 RESEND_COOLDOWN_ACTIVE or RATE_LIMITED', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'UNVERIFIED_ACCOUNT'),
      );
      vi.mocked(resendVerification).mockRejectedValueOnce(
        new ApiError(
          429,
          'Active cooldown in effect',
          'RESEND_COOLDOWN_ACTIVE',
          undefined,
          [],
          true,
          45,
        ),
      );

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Email delivery is temporarily rate-limited. Please try again later.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('catches 403 ACCOUNT_NOT_VERIFIED and returns rate-limited error when resendVerification returns 429 without active cooldown', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'ACCOUNT_NOT_VERIFIED'),
      );
      vi.mocked(resendVerification).mockRejectedValueOnce(new ApiError(429, 'Rate limit'));

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Email delivery is temporarily rate-limited. Please try again later.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('does not redirect and returns error when resendVerification fails with NetworkError', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'UNVERIFIED_ACCOUNT'),
      );
      vi.mocked(resendVerification).mockRejectedValueOnce(
        new NetworkError('Network connection lost'),
      );

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Unable to reach the server. Please try again later.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('does not redirect and returns error when resendVerification fails with 503 SERVICE_UNAVAILABLE even with retryAfterSeconds', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'UNVERIFIED_ACCOUNT'),
      );
      vi.mocked(resendVerification).mockRejectedValueOnce(
        new ApiError(
          503,
          'Email delivery is temporarily unavailable',
          'SERVICE_UNAVAILABLE',
          undefined,
          [],
          true,
          30,
        ),
      );

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Email delivery is temporarily unavailable',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('does not redirect and returns error when resendVerification fails with INTERNAL_ERROR', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'UNVERIFIED_ACCOUNT'),
      );
      vi.mocked(resendVerification).mockRejectedValueOnce(
        new ApiError(500, 'Internal delivery error', 'INTERNAL_ERROR'),
      );

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Internal delivery error',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('surfaces string error message when resendVerification resolves with string error payload', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'UNVERIFIED_ACCOUNT'),
      );
      vi.mocked(resendVerification).mockResolvedValueOnce({
        success: false,
        error: 'Custom dispatch failure',
      } as unknown as Awaited<ReturnType<typeof resendVerification>>);

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Custom dispatch failure',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('returns fallback error message when resendVerification resolves with boolean/non-string truthy error payload', async () => {
      const formData = new FormData();
      formData.set('email', 'candidate@example.com');
      formData.set('password', 'password123');

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(403, 'Contact confirmation required', 'UNVERIFIED_ACCOUNT'),
      );
      vi.mocked(resendVerification).mockResolvedValueOnce({
        error: true,
      } as unknown as Awaited<ReturnType<typeof resendVerification>>);

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: 'Unable to send verification code. Please try again.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });
  });

  describe('registerAction', () => {
    it('returns error if privacy consent is missing', async () => {
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('identifier', 'test@example.com');
      formData.set('password', 'password123');
      formData.set('confirmPassword', 'password123');

      const result = await registerAction({}, formData);
      expect(result).toEqual({ error: 'Privacy consent is required.' });
    });

    it('returns error if passwords do not match', async () => {
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('identifier', 'test@example.com');
      formData.set('password', 'password123');
      formData.set('confirmPassword', 'password456');
      formData.set('privacy_consent', 'on');

      const result = await registerAction({}, formData);
      expect(result).toEqual({ error: 'Passwords do not match.' });
    });

    it('returns error if password is too short', async () => {
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('identifier', 'test@example.com');
      formData.set('password', 'pass');
      formData.set('confirmPassword', 'pass');
      formData.set('privacy_consent', 'true');

      const result = await registerAction({}, formData);
      expect(result).toEqual({
        error: 'Password must be at least 8 characters.',
      });
    });

    it('returns 429 rate limit error handling', async () => {
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('identifier', 'test@example.com');
      formData.set('password', 'password123');
      formData.set('confirmPassword', 'password123');
      formData.set('privacy_consent', 'on');

      vi.mocked(registerUser).mockRejectedValueOnce(new ApiError(429, 'Too many requests'));

      const result = await registerAction({}, formData);
      expect(result).toMatchObject({
        error: 'Email delivery is temporarily rate-limited. Please try again later.',
      });
    });

    it('returns fallback error when registerUser resolves with success false and no error property', async () => {
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('identifier', 'test@example.com');
      formData.set('password', 'password123');
      formData.set('confirmPassword', 'password123');
      formData.set('privacy_consent', 'on');

      vi.mocked(registerUser).mockResolvedValueOnce({
        success: false,
      } as unknown as Awaited<ReturnType<typeof registerUser>>);

      const result = await registerAction({}, formData);
      expect(result).toEqual({
        error: 'An unexpected error occurred during registration.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('keeps the verification contact out of the redirect URL', async () => {
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('identifier', 'test@example.com');
      formData.set('password', 'password123');
      formData.set('confirmPassword', 'password123');
      formData.set('privacy_consent', 'on');
      vi.mocked(registerUser).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 't***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error('NEXT_REDIRECT');
      });

      await expect(registerAction({}, formData)).rejects.toThrow('NEXT_REDIRECT');
      expect(registerUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        phone: null,
        password: 'password123',
        confirm_password: 'password123',
        privacy_consent: true,
      });
      expect(redirect).toHaveBeenCalledWith('/verify?channel=email');
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: '/verify' }),
      );
    });
  });

  describe('verifyOtpAction', () => {
    it('returns error if missing fields', async () => {
      const formData = new FormData();
      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({ error: 'Invalid verification request.' });
    });

    it('returns error if verification context is missing', async () => {
      mockCookieStore.get.mockReturnValueOnce(undefined);
      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('token', '123456');

      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({ error: 'Invalid verification request.' });
    });

    it('verifies email via backend EP-A02 and returns redirectTo /onboarding/profile on profile_setup', async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: 'profile_setup',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('token', '123456');

      const result = await verifyOtpAction({}, formData);

      expect(verifyEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        code: '123456',
      });
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        '',
        expect.objectContaining({ path: '/verify', maxAge: 0 }),
      );
      expect(result).toEqual({
        success: true,
        redirectTo: '/onboarding/profile',
      });
    });

    it('verifies email using identifier from formData when cookie is missing', async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'test-user-id',
          email: 'reentered@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: 'profile_setup',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('channel', 'email');
      formData.set('identifier', 'reentered@example.com');
      formData.set('token', '123456');

      const result = await verifyOtpAction({}, formData);

      expect(verifyEmail).toHaveBeenCalledWith({
        email: 'reentered@example.com',
        code: '123456',
      });
      expect(result).toEqual({
        success: true,
        redirectTo: '/onboarding/profile',
      });
    });

    it('verifies email via backend EP-A02 and redirects to /dashboard on app_home', async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('token', '123456');

      const result = await verifyOtpAction({}, formData);

      expect(result).toEqual({
        success: true,
        redirectTo: '/dashboard',
      });
    });

    it('returns error message when verifyEmail throws ApiError', async () => {
      vi.mocked(verifyEmail).mockRejectedValueOnce(
        new ApiError(422, 'Verification code is invalid', 'VERIFICATION_CODE_INVALID'),
      );

      const formData = new FormData();
      formData.set('type', 'email');
      formData.set('token', '000000');

      const result = await verifyOtpAction({}, formData);
      expect(result).toMatchObject({ error: 'Verification code is invalid' });
    });

    it('verifies phone via backend EP-A03 and redirects to /onboarding/profile', async () => {
      const phoneContext = Buffer.from(
        JSON.stringify({ type: 'phone', identifier: '+8801712345678' }),
      ).toString('base64url');
      mockCookieStore.get.mockReturnValueOnce({ value: phoneContext });

      vi.mocked(verifyPhone).mockResolvedValueOnce({
        access_token: 'phone-access-token',
        refresh_token: 'phone-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'test-user-id',
          email: null,
          phone: '+8801712345678',
          role: 'USER',
          status: 'active',
          linked_providers: ['phone'],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: 'profile_setup',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('type', 'phone');
      formData.set('token', '123456');

      const result = await verifyOtpAction({}, formData);

      expect(verifyPhone).toHaveBeenCalledWith({
        phone: '+8801712345678',
        code: '123456',
      });
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'phone-access-token',
        refresh_token: 'phone-refresh-token',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        '',
        expect.objectContaining({ path: '/verify', maxAge: 0 }),
      );
      expect(result).toEqual({
        success: true,
        redirectTo: '/onboarding/profile',
      });
    });
  });

  describe('resendOtpAction', () => {
    it('resends email verification via backend EP-A04', async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 't***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      });

      const result = await resendOtpAction('email');
      expect(result).toEqual({
        success: true,
        expiresInSeconds: 600,
        contactMasked: 't***@example.com',
        resendAvailableAt: '2026-01-01T00:00:00Z',
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: 'email',
        contact: 'test@example.com',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: '/verify' }),
      );
    });

    it('handles rate limit', async () => {
      vi.mocked(resendVerification).mockRejectedValueOnce(new ApiError(429, 'Rate limit'));

      const result = await resendOtpAction('email');
      expect(result).toMatchObject({
        error: 'Email delivery is temporarily rate-limited. Please try again later.',
      });
    });
    it('resends verification using reentered identifier when context cookie is absent', async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 'r****@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      });

      const result = await resendOtpAction('email', 'reentered@example.com');
      expect(result).toEqual({
        success: true,
        expiresInSeconds: 600,
        contactMasked: 'r****@example.com',
        resendAvailableAt: '2026-01-01T00:00:00Z',
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: 'email',
        contact: 'reentered@example.com',
      });
    });

    it('returns error on invalid channel', async () => {
      const result = await resendOtpAction('sms' as unknown as 'phone');
      expect(result).toEqual({ error: 'Invalid verification channel.' });
    });

    it('successfully resends OTP when phone channel is requested with TextBee SMS support', async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'phone',
        contact_masked: '+8801****5678',
        expires_in_seconds: 600,
        resend_available_at: new Date(Date.now() + 60000).toISOString(),
      });

      const result = await resendOtpAction('phone', '+8801712345678');
      expect(resendVerification).toHaveBeenCalledWith({
        channel: 'phone',
        contact: '+8801712345678',
      });
      expect(result).toMatchObject({
        success: true,
        contactMasked: '+8801****5678',
        expiresInSeconds: 600,
      });
    });

    it('surfaces string error message when resendVerification resolves with string error payload', async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        success: false,
        error: 'Custom dispatch failure',
      } as unknown as Awaited<ReturnType<typeof resendVerification>>);

      const result = await resendOtpAction('email');
      expect(result).toEqual({
        error: 'Custom dispatch failure',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('returns fallback error message when resendVerification resolves with boolean/non-string truthy error payload', async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        error: true,
      } as unknown as Awaited<ReturnType<typeof resendVerification>>);

      const result = await resendOtpAction('email');
      expect(result).toEqual({
        error: 'Failed to send verification code. Please try again later.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('returns fallback error when resendVerification resolves with success false and no error property', async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        success: false,
      } as unknown as Awaited<ReturnType<typeof resendVerification>>);

      const result = await resendOtpAction('email');
      expect(result).toEqual({
        error: 'Failed to send verification code. Please try again later.',
      });
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it('drops existingContext.context and does not carry over secondary_contact when existingContext.identifier differs from reentered identifier', async () => {
      const secondaryContext = Buffer.from(
        JSON.stringify({
          type: 'email',
          identifier: 'old@example.com',
          context: 'secondary_contact',
        }),
      ).toString('base64url');
      mockCookieStore.get.mockReturnValueOnce({ value: secondaryContext });

      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 'n***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      });

      const result = await resendOtpAction('email', 'new@example.com');

      expect(result).toEqual({
        success: true,
        expiresInSeconds: 600,
        contactMasked: 'n***@example.com',
        resendAvailableAt: '2026-01-01T00:00:00Z',
      });

      const lastSetCall = mockCookieStore.set.mock.calls[mockCookieStore.set.mock.calls.length - 1];
      const encodedPayload = lastSetCall[1];
      const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      expect(decoded).toEqual({
        type: 'email',
        identifier: 'new@example.com',
      });
      expect(decoded.context).toBeUndefined();
    });

    it('preserves existingContext.context case-insensitively when reentered identifier matches existingContext.identifier', async () => {
      const secondaryContext = Buffer.from(
        JSON.stringify({
          type: 'email',
          identifier: 'test@example.com',
          context: 'secondary_contact',
        }),
      ).toString('base64url');
      mockCookieStore.get.mockReturnValueOnce({ value: secondaryContext });

      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 't***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      });

      const result = await resendOtpAction('email', '  TEST@EXAMPLE.COM  ');

      expect(result).toEqual({
        success: true,
        expiresInSeconds: 600,
        contactMasked: 't***@example.com',
        resendAvailableAt: '2026-01-01T00:00:00Z',
      });

      const lastSetCall = mockCookieStore.set.mock.calls[mockCookieStore.set.mock.calls.length - 1];
      const encodedPayload = lastSetCall[1];
      const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      expect(decoded).toEqual({
        type: 'email',
        identifier: 'TEST@EXAMPLE.COM',
        context: 'secondary_contact',
      });
    });
  });

  describe('signInWithOAuth', () => {
    it('initiates OAuth redirect with provider in callback URL', async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error('NEXT_REDIRECT');
      });

      await expect(signInWithOAuth('google')).rejects.toThrow('NEXT_REDIRECT');
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback?provider=google`,
        },
      });
      expect(redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
    });

    it('returns error message when OAuth initiation fails', async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: null,
        error: { message: 'OAuth service error' },
      });

      const result = await signInWithOAuth('facebook');
      expect(result).toEqual({ error: 'OAuth service error' });
    });

    it('returns error message when redirect URL is missing', async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: null },
        error: null,
      });

      const result = await signInWithOAuth('google');
      expect(result).toEqual({
        error: 'Failed to initiate OAuth login. Missing redirect URL.',
      });
    });

    it('uses active trusted request origin (e.g. http://localhost:3001 or 3201) over stale NEXT_PUBLIC_SITE_URL (http://localhost:3000)', async () => {
      const prevSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
      mockHeaderStore.get.mockImplementation((name: string) =>
        name === 'origin' ? 'http://localhost:3001' : null,
      );
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error('NEXT_REDIRECT');
      });

      try {
        await expect(signInWithOAuth('google')).rejects.toThrow('NEXT_REDIRECT');
        expect(mockSignInWithOAuth).toHaveBeenCalledWith({
          provider: 'google',
          options: {
            redirectTo: 'http://localhost:3001/auth/callback?provider=google',
          },
        });
      } finally {
        if (prevSiteUrl === undefined) {
          delete process.env.NEXT_PUBLIC_SITE_URL;
        } else {
          process.env.NEXT_PUBLIC_SITE_URL = prevSiteUrl;
        }
      }
    });

    it('rejects untrusted request origin and falls back to NEXT_PUBLIC_SITE_URL / http://localhost:3001', async () => {
      const prevSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:3201';
      mockHeaderStore.get.mockImplementation((name: string) =>
        name === 'origin' ? 'https://evil.example.com' : null,
      );
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: 'https://www.facebook.com/v18.0/dialog/oauth' },
        error: null,
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error('NEXT_REDIRECT');
      });

      try {
        await expect(signInWithOAuth('facebook')).rejects.toThrow('NEXT_REDIRECT');
        expect(mockSignInWithOAuth).toHaveBeenCalledWith({
          provider: 'facebook',
          options: {
            redirectTo: 'http://127.0.0.1:3201/auth/callback?provider=facebook',
          },
        });
      } finally {
        if (prevSiteUrl === undefined) {
          delete process.env.NEXT_PUBLIC_SITE_URL;
        } else {
          process.env.NEXT_PUBLIC_SITE_URL = prevSiteUrl;
        }
      }
    });
  });

  describe('OAuth callback route handler', () => {
    it('rejects request without code to /login?error=oauth_failed without exchanging code', async () => {
      const request = new Request('http://localhost:3001/auth/callback?provider=google');
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('rejects request with invalid provider to /login?error=oauth_failed without exchanging code', async () => {
      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=github',
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('handles transitional email confirmation callback with flow=email without oauth_failed', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new Request('http://localhost:3001/auth/callback?code=mock-code&flow=email');
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/login?verified=true');
    });

    it('handles transitional email confirmation callback without provider query param without oauth_failed', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new Request('http://localhost:3001/auth/callback?code=mock-code');
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/login?verified=true');
    });

    it('approves OAuth session for a user with primary app_metadata.provider = email and linked google identity', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-oauth-access-token',
            user: {
              id: 'user-123',
              app_metadata: { provider: 'email' },
              identities: [
                { provider: 'email', id: 'email-id' },
                { provider: 'google', id: 'google-sub-123' },
              ],
            },
          },
        },
      });
      (approveOAuthSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { id: 'user-123', status: 'active', verified_contact: true },
        next_step: 'app_home',
        profile_complete: true,
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(approveOAuthSession).toHaveBeenCalledWith('mock-oauth-access-token', 'google');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/dashboard');
    });

    it('redirects OAuth user to /onboarding/profile when next_step is profile_setup', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-oauth-access-token',
            user: {
              id: 'user-123',
              identities: [{ provider: 'google', id: 'google-sub-123' }],
            },
          },
        },
      });
      (approveOAuthSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { id: 'user-123', status: 'active', verified_contact: true },
        next_step: 'profile_setup',
        profile_complete: false,
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await authCallbackGet(request);
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/onboarding/profile');
    });

    it("signs out with scope: 'local' and redirects to /login?error=oauth_failed if user lacks matching identity", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-oauth-access-token',
            user: {
              id: 'user-123',
              app_metadata: { provider: 'email' },
              identities: [{ provider: 'facebook', id: 'fb-123' }],
            },
          },
        },
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await authCallbackGet(request);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('handles flow=link by calling approveOAuthSession and linkSocialIdentity and redirecting to /settings?linked=${provider}', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-link-access-token',
            user: {
              id: 'user-123',
              identities: [{ provider: 'google', id: 'google-123' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-123',
          email: 'user@example.com',
          phone: null,
          status: 'active',
          verified_contact: true,
          role: 'USER',
          linked_providers: ['email'],
        },
        profile_complete: true,
        verified_contact_required: false,
        next_step: 'app_home',
      });
      vi.mocked(linkSocialIdentity).mockResolvedValueOnce({
        linked_providers: ['email', 'google'],
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(approveOAuthSession).toHaveBeenCalledWith('mock-link-access-token', 'google');
      expect(linkSocialIdentity).toHaveBeenCalledWith('mock-link-access-token', 'google');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/settings?linked=google');
    });

    it('preserves session (no signOut) and redirects to /settings?error=link_failed when approveOAuthSession throws during flow=link', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-link-access-token',
            user: {
              id: 'user-123',
              identities: [{ provider: 'google', id: 'google-123' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockRejectedValueOnce(new Error('Approval failed'));

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await authCallbackGet(request);
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(linkSocialIdentity).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });

    it('preserves session (no signOut) and redirects to /settings?error=link_failed when exchangeCodeForSession returns error during flow=link', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        error: new Error('Exchange error'),
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });

    it('preserves session (no signOut) and redirects to /settings?error=link_failed when exchangeCodeForSession throws during flow=link', async () => {
      mockExchangeCodeForSession.mockRejectedValueOnce(new Error('Unexpected exchange failure'));

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });

    it("signs out with scope: 'local' and redirects to /login?error=sync_failed if approveOAuthSession throws ApiError", async () => {
      const { ApiError } = await import('@/lib/api/client');
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'mock-oauth-access-token',
            user: {
              id: 'user-123',
              app_metadata: { provider: 'google' },
              identities: [{ provider: 'google', id: 'google-123' }],
            },
          },
        },
      });
      (approveOAuthSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(500, 'Backend sync error'),
      );

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await authCallbackGet(request);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=sync_failed',
      );
    });
  });

  describe('logoutAction', () => {
    it('calls backend logoutUser with access token before signOut and redirects to login', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'active-token' } },
      });
      vi.mocked(logoutUser).mockResolvedValueOnce({ logged_out: true });

      await logoutAction();

      expect(logoutUser).toHaveBeenCalledWith('active-token');
      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('proceeds with signOut and redirect even if backend logoutUser throws', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'expired-token' } },
      });
      vi.mocked(logoutUser).mockRejectedValueOnce(new Error('Network failed'));

      await logoutAction();

      expect(logoutUser).toHaveBeenCalledWith('expired-token');
      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('proceeds with signOut and redirect when no active session exists', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      await logoutAction();

      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });
  });
  describe('forgotPasswordAction', () => {
    it('returns error when identifier is missing', async () => {
      const formData = new FormData();
      formData.set('identifier', '');

      const result = await forgotPasswordAction({}, formData);
      expect(result).toEqual({ error: 'Email or phone is required.' });
      expect(forgotPassword).not.toHaveBeenCalled();
    });

    it('calls forgotPassword, sets recovery context cookie, and redirects to /reset-password', async () => {
      const formData = new FormData();
      formData.set('identifier', 'user@example.com');
      vi.mocked(forgotPassword).mockResolvedValueOnce({
        message: 'If the account exists, a code was sent.',
      });

      await forgotPasswordAction({}, formData);

      expect(forgotPassword).toHaveBeenCalledWith('user@example.com');
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_recovery_context',
        expect.any(String),
        expect.objectContaining({ path: '/reset-password' }),
      );
      expect(redirect).toHaveBeenCalledWith('/reset-password');
    });
  });

  describe('resetPasswordAction', () => {
    it('validates code and password mismatch', async () => {
      const formData = new FormData();
      formData.set('identifier', 'user@example.com');
      formData.set('code', '123');
      formData.set('new_password', 'Passw0rd1!');
      formData.set('confirm_new_password', 'Passw0rd1!');

      const badCode = await resetPasswordAction({}, formData);
      expect(badCode.error).toContain('six-digit');

      formData.set('code', '123456');
      formData.set('confirm_new_password', 'Mismatch!');
      const mismatch = await resetPasswordAction({}, formData);
      expect(mismatch.error).toContain('Passwords do not match');

      const missingPwForm = new FormData();
      missingPwForm.set('identifier', 'user@example.com');
      missingPwForm.set('code', '123456');
      const missingPw = await resetPasswordAction({}, missingPwForm);
      expect(missingPw).toEqual({
        error: 'Password must be at least 8 characters.',
        fieldErrors: { new_password: 'Password must be at least 8 characters.' },
      });
    });

    it('calls resetPassword, clears recovery cookie, and redirects to /login?reset=success', async () => {
      const formData = new FormData();
      formData.set('identifier', 'user@example.com');
      formData.set('code', '123456');
      formData.set('new_password', 'N3w!Passw0rd');
      formData.set('confirm_new_password', 'N3w!Passw0rd');

      vi.mocked(resetPassword).mockResolvedValueOnce({ password_reset: true });

      await resetPasswordAction({}, formData);

      expect(resetPassword).toHaveBeenCalledWith(
        'user@example.com',
        '123456',
        'N3w!Passw0rd',
        'N3w!Passw0rd',
      );
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_recovery_context',
        '',
        expect.objectContaining({ maxAge: 0 }),
      );
      expect(redirect).toHaveBeenCalledWith('/login?reset=success');
    });
  });

  describe('linkIdentityAction (EP-A11)', () => {
    it('links social identity directly when already linked in Supabase', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'active-token',
            user: { identities: [{ provider: 'google' }] },
          },
        },
      });
      vi.mocked(linkSocialIdentity).mockResolvedValueOnce({
        linked_providers: ['email', 'google'],
      });

      const result = await linkIdentityAction('google');
      expect(result).toEqual({
        success: true,
        linked_providers: ['email', 'google'],
      });
      expect(linkSocialIdentity).toHaveBeenCalledWith('active-token', 'google');
    });

    it('initiates Supabase OAuth identity linking redirect when not yet linked', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'active-token',
            user: { identities: [{ provider: 'email' }] },
          },
        },
      });
      mockLinkIdentity.mockResolvedValueOnce({
        data: { url: 'https://accounts.google.com/o/oauth2/auth' },
        error: null,
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error('NEXT_REDIRECT');
      });

      await expect(linkIdentityAction('google')).rejects.toThrow('NEXT_REDIRECT');
      expect(mockLinkIdentity).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback?flow=link&provider=google`,
        },
      });
      expect(redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
    });

    it('returns error when session is missing', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      const result = await linkIdentityAction('facebook');
      expect(result).toEqual({
        error: 'Authentication session is required to link an identity.',
      });
      expect(linkSocialIdentity).not.toHaveBeenCalled();
    });
  });

  describe('addContactAction (EP-A12)', () => {
    it('stages contact, sets verification context cookie, and redirects to /verify?type=email', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'active-token' } },
      });
      vi.mocked(addContact).mockResolvedValueOnce({
        verification_channel: 'email',
        contact_masked: 'c****@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:01:00.000Z',
      });

      const formData = new FormData();
      formData.set('channel', 'email');
      formData.set('contact', 'candidate@example.com');

      await addContactAction({}, formData);

      expect(addContact).toHaveBeenCalledWith('active-token', {
        channel: 'email',
        contact: 'candidate@example.com',
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        'mentor_verification_context',
        expect.any(String),
        expect.objectContaining({ path: '/verify', maxAge: 600 }),
      );
      expect(redirect).toHaveBeenCalledWith('/verify?channel=email');
    });

    it('returns error when contact is empty', async () => {
      const formData = new FormData();
      formData.set('channel', 'email');
      formData.set('contact', '   ');

      const result = await addContactAction({}, formData);
      expect(result).toEqual({ error: 'Email is required.' });
      expect(addContact).not.toHaveBeenCalled();
    });

    it('gracefully handles 409 ALREADY_VERIFIED returned by addContact', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'active-token' } },
      });
      vi.mocked(addContact).mockRejectedValueOnce(
        new ApiError(409, 'Account already has a verified contact', 'ALREADY_VERIFIED'),
      );

      const formData = new FormData();
      formData.set('channel', 'email');
      formData.set('contact', 'candidate@example.com');

      const result = await addContactAction({}, formData);
      expect(result).toEqual({
        error: 'Account already has a verified contact',
        redirectTo: '/settings?verified=contact',
      });
      expect(redirect).not.toHaveBeenCalled();
    });

    it('normalizes local 01712345678 phone contact to +8801712345678 before calling addContact', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'active-token' } },
      });
      vi.mocked(addContact).mockResolvedValueOnce({
        verification_channel: 'phone',
        contact_masked: '+88017****78',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:01:00.000Z',
      });

      const formData = new FormData();
      formData.set('channel', 'phone');
      formData.set('contact', '01712345678');

      await addContactAction({}, formData);

      expect(addContact).toHaveBeenCalledWith('active-token', {
        channel: 'phone',
        contact: '+8801712345678',
      });
      expect(redirect).toHaveBeenCalledWith('/verify?channel=phone');
    });
  });

  describe('verifyOtpAction secondary_contact context & validation (M02-04)', () => {
    it('redirects to /settings?verified=contact when context is secondary_contact', async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: 'secondary-access-token',
        refresh_token: 'secondary-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'test-user-id',
          email: 'secondary@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email', 'facebook'],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: 'profile_setup',
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set('channel', 'email');
      formData.set('identifier', 'secondary@example.com');
      formData.set('token', '123456');
      formData.set('context', 'secondary_contact');

      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({
        success: true,
        redirectTo: '/settings?verified=contact',
      });
    });

    it('rejects invalid non-enum verification context value', async () => {
      const formData = new FormData();
      formData.set('channel', 'email');
      formData.set('identifier', 'secondary@example.com');
      formData.set('token', '123456');
      formData.set('context', 'malicious_context');

      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({ error: 'Invalid verification request.' });
      expect(verifyEmail).not.toHaveBeenCalled();
    });
  });

  describe('withSingleSessionRefresh (EP-A07 Single-Refresh-Per-401 Retry Helper)', () => {
    it('refreshes session once on 401 UnauthorizedError, persists rotated tokens, and retries operation once', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };
      mockSetSession.mockResolvedValueOnce({ error: null });
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'))
        .mockResolvedValueOnce({ linked_providers: ['email', 'google'] });

      const session = {
        access_token: 'expired-access-token',
        refresh_token: 'valid-refresh-token',
      };

      const result = await withSingleSessionRefresh(mockSupabase, session, operation);

      expect(result).toEqual({ linked_providers: ['email', 'google'] });
      expect(session.access_token).toBe('rotated-access-token');
      expect(session.refresh_token).toBe('rotated-refresh-token');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(operation).toHaveBeenNthCalledWith(1, 'expired-access-token');
      expect(operation).toHaveBeenNthCalledWith(2, 'rotated-access-token');
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(refreshSession).toHaveBeenCalledWith('valid-refresh-token');
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
      });
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('calls safeSignOut and redirects to /login when refreshSession fails on 401', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };
      vi.mocked(refreshSession).mockRejectedValueOnce(
        new UnauthorizedError('Refresh token revoked', 'REFRESH_TOKEN_INVALID'),
      );

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'));

      await withSingleSessionRefresh(
        mockSupabase,
        {
          access_token: 'expired-access-token',
          refresh_token: 'revoked-refresh-token',
        },
        operation,
      );

      expect(operation).toHaveBeenCalledTimes(1);
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('calls safeSignOut and redirects to /login with zero infinite loops when retried call still throws 401', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };
      mockSetSession.mockResolvedValueOnce({ error: null });
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('First 401'))
        .mockRejectedValueOnce(new UnauthorizedError('Second 401'));

      await withSingleSessionRefresh(
        mockSupabase,
        {
          access_token: 'expired-access-token',
          refresh_token: 'valid-refresh-token',
        },
        operation,
      );

      expect(operation).toHaveBeenCalledTimes(2);
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('calls safeSignOut exactly once and redirects to /login when setSession returns an error and refresh_token has not rotated', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };
      mockSetSession.mockResolvedValueOnce({
        error: new Error('Failed to write session cookie'),
      });
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const session = {
        access_token: 'expired-access-token',
        refresh_token: 'initial-refresh-token',
      };

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'));

      await withSingleSessionRefresh(mockSupabase, session, operation);

      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('does not call safeSignOut when setSession returns an error if session.refresh_token was already rotated concurrently', async () => {
      const mockSupabase = {
        auth: {
          setSession: vi.fn(),
          signOut: mockSignOut,
        },
      };
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const session = {
        access_token: 'expired-access-token',
        refresh_token: 'initial-refresh-token',
      };

      // Simulate concurrent rotation updating session.refresh_token before setSession finishes
      mockSupabase.auth.setSession.mockImplementationOnce(async () => {
        session.refresh_token = 'concurrently-rotated-refresh-token';
        return { error: new Error('Stale session write rejected') };
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'));

      await withSingleSessionRefresh(mockSupabase, session, operation);

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('does not call safeSignOut when setSession throws if session.refresh_token was already rotated concurrently', async () => {
      const mockSupabase = {
        auth: {
          setSession: vi.fn(),
          signOut: mockSignOut,
        },
      };
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const session = {
        access_token: 'expired-access-token',
        refresh_token: 'initial-refresh-token',
      };

      mockSupabase.auth.setSession.mockImplementationOnce(async () => {
        session.refresh_token = 'concurrently-rotated-refresh-token';
        throw new Error('setSession network failure');
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'));

      await withSingleSessionRefresh(mockSupabase, session, operation);

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('coalesces concurrent withSingleSessionRefresh calls sharing the same refresh_token to invoke refreshSession only once', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };
      mockSetSession.mockResolvedValue({ error: null });

      let resolveRefresh: (val: unknown) => void = () => {};
      const refreshPromise = new Promise((resolve) => {
        resolveRefresh = resolve;
      });

      vi.mocked(refreshSession).mockReturnValueOnce(
        refreshPromise as unknown as ReturnType<typeof refreshSession>,
      );

      const op1 = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Call 1 expired'))
        .mockResolvedValueOnce({ op: 1 });
      const op2 = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Call 2 expired'))
        .mockResolvedValueOnce({ op: 2 });

      const session1 = {
        access_token: 'expired-token-1',
        refresh_token: 'shared-refresh-token',
      };
      const session2 = {
        access_token: 'expired-token-2',
        refresh_token: 'shared-refresh-token',
      };

      const call1Promise = withSingleSessionRefresh(mockSupabase, session1, op1);
      const call2Promise = withSingleSessionRefresh(mockSupabase, session2, op2);

      // Let both calls reach the pending refresh before it settles.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshSession).toHaveBeenCalledTimes(1);

      resolveRefresh({
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const [res1, res2] = await Promise.all([call1Promise, call2Promise]);

      expect(res1).toEqual({ op: 1 });
      expect(res2).toEqual({ op: 2 });
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(refreshSession).toHaveBeenCalledWith('shared-refresh-token');
      expect(session1.access_token).toBe('rotated-access-token');
      expect(session2.access_token).toBe('rotated-access-token');
      expect(mockSetSession).toHaveBeenCalledTimes(2);
      expect(mockSignOut).not.toHaveBeenCalled();

      // Subsequent call after settled refresh triggers a fresh refreshSession call (verifying map cleanup)
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'subsequent-access-token',
        refresh_token: 'subsequent-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const op3 = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Call 3 expired'))
        .mockResolvedValueOnce({ op: 3 });
      const session3 = {
        access_token: 'expired-token-3',
        refresh_token: 'shared-refresh-token',
      };

      const res3 = await withSingleSessionRefresh(mockSupabase, session3, op3);
      expect(res3).toEqual({ op: 3 });
      expect(refreshSession).toHaveBeenCalledTimes(2);
      expect(mockSetSession).toHaveBeenCalledTimes(3);
    });

    it('redirects both concurrent callers to /login when shared refresh rejects and cleans up map entry for subsequent retry', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };

      let rejectRefresh: (err: unknown) => void = () => {};
      const refreshPromise = new Promise((_, reject) => {
        rejectRefresh = reject;
      });

      vi.mocked(refreshSession).mockReturnValueOnce(
        refreshPromise as unknown as ReturnType<typeof refreshSession>,
      );

      const op1 = vi.fn().mockRejectedValueOnce(new UnauthorizedError('Call 1 expired'));
      const op2 = vi.fn().mockRejectedValueOnce(new UnauthorizedError('Call 2 expired'));

      const session1 = {
        access_token: 'expired-token-1',
        refresh_token: 'failing-refresh-token',
      };
      const session2 = {
        access_token: 'expired-token-2',
        refresh_token: 'failing-refresh-token',
      };

      const call1Promise = withSingleSessionRefresh(mockSupabase, session1, op1);
      const call2Promise = withSingleSessionRefresh(mockSupabase, session2, op2);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(refreshSession).toHaveBeenCalledTimes(1);

      rejectRefresh(new UnauthorizedError('Token revoked', 'REFRESH_TOKEN_INVALID'));

      await Promise.all([call1Promise, call2Promise]);

      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith('/login');
      expect(mockSignOut).toHaveBeenCalled();

      // Subsequent call after rejection triggers a fresh refreshSession call (verifying cleanup)
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'recovered-access-token',
        refresh_token: 'recovered-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const op3 = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Call 3 expired'))
        .mockResolvedValueOnce({ op: 3 });
      const session3 = {
        access_token: 'expired-token-3',
        refresh_token: 'failing-refresh-token',
      };

      const res3 = await withSingleSessionRefresh(mockSupabase, session3, op3);
      expect(res3).toEqual({ op: 3 });
      expect(refreshSession).toHaveBeenCalledTimes(2);
    });

    it('skips safeSignOut on refresh rejection when session.refresh_token was already rotated concurrently', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };

      const session = {
        access_token: 'expired-access-token',
        refresh_token: 'initial-refresh-token',
      };

      vi.mocked(refreshSession).mockImplementationOnce(async () => {
        session.refresh_token = 'rotated-by-concurrent-call';
        throw new Error('Refresh network failure');
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'));

      await withSingleSessionRefresh(mockSupabase, session, operation);

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('skips safeSignOut on missing/invalid token response when session.refresh_token was already rotated concurrently', async () => {
      const mockSupabase = {
        auth: {
          setSession: mockSetSession,
          signOut: mockSignOut,
        },
      };

      const session = {
        access_token: 'expired-access-token',
        refresh_token: 'initial-refresh-token',
      };

      vi.mocked(refreshSession).mockImplementationOnce(async () => {
        session.refresh_token = 'rotated-by-concurrent-call';
        return {} as unknown as Awaited<ReturnType<typeof refreshSession>>;
      });

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new UnauthorizedError('Access token expired'));

      await withSingleSessionRefresh(mockSupabase, session, operation);

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith('/login');
    });
  });

  describe('Account Deletion Actions (EP-X01 / EP-X02)', () => {
    it("returns error when confirmation is not literal 'DELETE'", async () => {
      const formData = new FormData();
      formData.append('confirmation', 'delete');
      formData.append('password', 'Pass1234!');

      const res = await requestAccountDeletionAction({}, formData);
      expect(res.error).toMatch(/DELETE/);
    });

    it('returns error when session is missing or expired', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });

      const formData = new FormData();
      formData.append('confirmation', 'DELETE');
      formData.append('password', 'Pass1234!');

      const res = await requestAccountDeletionAction({}, formData);
      expect(res.error).toMatch(/Session expired|সেশনটি মেয়াদোত্তীর্ণ/);
    });

    it('calls requestAccountDeletion and performs local signOut on completed deletion', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'active-token' } },
      });

      vi.mocked(requestAccountDeletion).mockResolvedValueOnce({
        id: 'del-id-1',
        status: 'completed',
        requested_at: '2026-11-10T12:00:00.000Z',
        completed_at: '2026-11-10T12:01:00.000Z',
        provider_deletion_requested: false,
        deletion_receipt: 'receipt-token',
        receipt_expires_at: '2026-11-11T12:00:00.000Z',
      });

      const formData = new FormData();
      formData.append('confirmation', 'DELETE');
      formData.append('password', 'ValidPass123!');

      const res = await requestAccountDeletionAction({}, formData);
      expect(res.success).toBe(true);
      expect(res.status).toBe('completed');
      expect(res.deletionReceipt).toBe('receipt-token');
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('polls account deletion status and signs out on completion', async () => {
      vi.mocked(getAccountDeletionStatus).mockResolvedValueOnce({
        id: 'del-id-1',
        status: 'completed',
        requested_at: '2026-11-10T12:00:00.000Z',
        completed_at: '2026-11-10T12:01:00.000Z',
        provider_deletion_requested: true,
      });

      const res = await pollAccountDeletionStatusAction('valid-receipt-token');
      expect(res.status).toBe('completed');
      expect(res.providerDeletionRequested).toBe(true);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('returns scheduled or in_progress status without local signOut, retrying via withSingleSessionRefresh on 401', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'expired-token',
            refresh_token: 'valid-refresh',
            user: { id: 'user-123' },
          },
        },
      });

      // First call throws 401 UnauthorizedError, second succeeds with scheduled
      vi.mocked(requestAccountDeletion)
        .mockRejectedValueOnce(new UnauthorizedError('Token expired'))
        .mockResolvedValueOnce({
          id: 'del-sched-1',
          status: 'scheduled',
          deletion_receipt: 'sched-receipt-123',
          receipt_expires_at: '2026-11-11T12:00:00.000Z',
          provider_deletion_requested: false,
          created_at: '2026-11-10T12:00:00.000Z',
        });

      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-123',
          email: 'test@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      const formData = new FormData();
      formData.append('confirmation', 'DELETE');
      formData.append('password', 'Pass1234!');

      const res = await requestAccountDeletionAction({}, formData);
      expect(res.success).toBe(true);
      expect(res.status).toBe('scheduled');
      expect(res.deletionReceipt).toBe('sched-receipt-123');
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('maps REAUTH_REQUIRED, DELETION_ALREADY_REQUESTED, and NetworkError to localized user errors', async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'valid-token',
            user: { id: 'user-123' },
          },
        },
      });

      const formData = new FormData();
      formData.append('confirmation', 'DELETE');
      formData.append('password', 'WrongPass');

      // 1. REAUTH_REQUIRED (exercises real UnauthorizedError class from apiFetch)
      vi.mocked(requestAccountDeletion).mockRejectedValueOnce(
        new UnauthorizedError('Re-authentication required', 'REAUTH_REQUIRED'),
      );
      const reauthRes = await requestAccountDeletionAction({}, formData);
      expect(reauthRes.error).toMatch(/Invalid password or re-authentication required/);
      expect(mockSignOut).not.toHaveBeenCalled();

      // 2. DELETION_ALREADY_REQUESTED
      vi.mocked(requestAccountDeletion).mockRejectedValueOnce(
        new ApiError(409, 'Already requested', 'DELETION_ALREADY_REQUESTED'),
      );
      const conflictRes = await requestAccountDeletionAction({}, formData);
      expect(conflictRes.error).toMatch(/Deletion request already in progress/);

      // 3. NetworkError
      vi.mocked(requestAccountDeletion).mockRejectedValueOnce(new NetworkError('Failed to fetch'));
      const netRes = await requestAccountDeletionAction({}, formData);
      expect(netRes.error).toMatch(/Network error/);
    });

    it('forwards only password when both password and reauth_token are provided in FormData', async () => {
      mockGetSession.mockResolvedValue({
        data: {
          session: {
            access_token: 'valid-token',
            user: { id: 'user-123' },
          },
        },
      });

      vi.mocked(requestAccountDeletion).mockResolvedValueOnce({
        id: 'del-id-mut-excl',
        user_id: 'user-123',
        status: 'in_progress',
        requested_at: '2026-11-10T12:00:00.000Z',
        completed_at: null,
        deletion_receipt: 'receipt-mut-excl',
      });

      const formData = new FormData();
      formData.append('confirmation', 'DELETE');
      formData.append('password', 'MySecretPassword!');
      formData.append('reauth_token', 'some-oauth-token');

      const res = await requestAccountDeletionAction({}, formData);
      expect(res.success).toBe(true);

      expect(requestAccountDeletion).toHaveBeenCalledWith('valid-token', {
        confirmation: 'DELETE',
        password: 'MySecretPassword!',
        reauth_token: undefined,
      });
    });

    it('polls account deletion status and does not sign out when status is in_progress', async () => {
      vi.mocked(getAccountDeletionStatus).mockResolvedValueOnce({
        id: 'del-id-2',
        status: 'in_progress',
        requested_at: '2026-11-10T12:00:00.000Z',
        completed_at: null,
        provider_deletion_requested: false,
      });

      const res = await pollAccountDeletionStatusAction('valid-receipt-token');
      expect(res.status).toBe('in_progress');
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('returns validation error immediately when pollAccountDeletionStatusAction is called with empty or whitespace receipt', async () => {
      const res1 = await pollAccountDeletionStatusAction('');
      expect(res1.error).toMatch(/Valid deletion receipt token is required/);

      const res2 = await pollAccountDeletionStatusAction('   ');
      expect(res2.error).toMatch(/Valid deletion receipt token is required/);
    });
  });
});
