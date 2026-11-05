import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  approveOAuthSession,
  linkSocialIdentity,
  ApiError,
  NetworkError,
} from '@/lib/api/client';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/api/client', () => {
  /**
   * Mock API error mimicking backend ApiError structure.
   */
  class MockApiError extends Error {
    /**
     * Initializes mock API error.
     */
    constructor(
      public readonly statusCode: number,
      message = 'API Error',
      public readonly code?: string,
      public readonly requestId?: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  /**
   * Mock network error mimicking transport-level network failures.
   */
  class MockNetworkError extends Error {
    /**
     * Initializes mock network error.
     */
    constructor(message = 'Network error') {
      super(message);
      this.name = 'NetworkError';
    }
  }

  return {
    approveOAuthSession: vi.fn(),
    linkSocialIdentity: vi.fn(),
    ApiError: MockApiError,
    NetworkError: MockNetworkError,
  };
});

describe('Auth Callback Route Handler (GET /auth/callback)', () => {
  const mockExchangeCodeForSession = vi.fn();
  const mockGetSession = vi.fn();
  const mockSignOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
        getSession: mockGetSession,
        signOut: mockSignOut,
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation & Flow Gating', () => {
    it('redirects to /login?error=oauth_failed when code is missing', async () => {
      const request = new Request('http://localhost:3001/auth/callback?provider=google');
      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('redirects to /settings?error=link_failed when code is missing in link flow', async () => {
      const request = new Request(
        'http://localhost:3001/auth/callback?flow=link&provider=google',
      );
      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });

    it('redirects to /login?error=oauth_failed on unsupported provider param', async () => {
      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=github',
      );
      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('redirects to /settings?error=link_failed on unsupported provider param in link flow', async () => {
      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&flow=link&provider=github',
      );
      const response = await GET(request);

      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });
  });

  describe('OAuth Sign-In Flows (Google & Facebook)', () => {
    it('approves Google OAuth session and navigates to /onboarding/profile when next_step is profile_setup', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'google-access-token',
            user: {
              id: 'user-google-1',
              identities: [{ provider: 'google', id: 'google-sub-1' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-google-1',
          email: 'google-user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['google'],
          verified_contact: true,
        },
        profile_complete: false,
        verified_contact_required: false,
        next_step: 'profile_setup',
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=valid-code&provider=google',
      );
      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('valid-code');
      expect(approveOAuthSession).toHaveBeenCalledWith('google-access-token', 'google');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/onboarding/profile',
      );
    });

    it('approves Google OAuth session and navigates to /dashboard when next_step is app_home', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'google-access-token',
            user: {
              id: 'user-google-2',
              identities: [{ provider: 'google', id: 'google-sub-2' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-google-2',
          email: 'google-user-2@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['google'],
          verified_contact: true,
        },
        profile_complete: true,
        verified_contact_required: false,
        next_step: 'app_home',
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=valid-code&provider=google',
      );
      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/dashboard');
    });

    it('approves Facebook OAuth session and routes to /settings?prompt=verify_contact when contact is unverified', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'fb-access-token',
            user: {
              id: 'user-fb-1',
              identities: [{ provider: 'facebook', id: 'fb-sub-1' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-fb-1',
          email: null,
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['facebook'],
          verified_contact: false,
        },
        profile_complete: false,
        verified_contact_required: true,
        next_step: 'add_verified_contact',
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=valid-code&provider=facebook',
      );
      const response = await GET(request);

      expect(approveOAuthSession).toHaveBeenCalledWith('fb-access-token', 'facebook');
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?prompt=verify_contact',
      );
    });

    it('routes suspended OAuth user to /dashboard shell regardless of next_step', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'google-access-token',
            user: {
              id: 'user-suspended-1',
              identities: [{ provider: 'google', id: 'google-sub-suspended' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-suspended-1',
          email: 'suspended@example.com',
          phone: null,
          role: 'USER',
          status: 'suspended',
          linked_providers: ['google'],
          verified_contact: true,
        },
        profile_complete: false,
        verified_contact_required: false,
        next_step: 'profile_setup',
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=valid-code&provider=google',
      );
      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('http://localhost:3001/dashboard');
    });

    it('performs safe sign out and redirects to /login?error=oauth_failed when exchange fails', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        error: new Error('Exchange failed'),
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=bad-code&provider=google',
      );
      const response = await GET(request);

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('performs safe sign out and redirects to /login?error=oauth_failed when session is absent after exchange', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await GET(request);

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('performs safe sign out and redirects to /login?error=oauth_failed when user lacks matching identity', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'google-token',
            user: {
              id: 'user-mismatch',
              identities: [{ provider: 'facebook', id: 'fb-sub' }],
            },
          },
        },
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await GET(request);

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=oauth_failed',
      );
    });

    it('performs safe sign out and redirects to /login?error=sync_failed when approveOAuthSession throws ApiError', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'google-token',
            user: {
              id: 'user-api-err',
              identities: [{ provider: 'google', id: 'google-sub' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockRejectedValueOnce(
        new ApiError(500, 'Internal Server Error', 'INTERNAL_ERROR'),
      );

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google',
      );
      const response = await GET(request);

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=sync_failed',
      );
    });

    it('performs safe sign out and redirects to /login?error=sync_failed when approveOAuthSession throws NetworkError', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'facebook-token',
            user: {
              id: 'user-net-err',
              identities: [{ provider: 'facebook', id: 'fb-sub' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockRejectedValueOnce(
        new NetworkError('Backend unreachable'),
      );

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=facebook',
      );
      const response = await GET(request);

      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?error=sync_failed',
      );
    });
  });

  describe('Identity Linking Flows (flow=link)', () => {
    it('links Google identity successfully and redirects to /settings?linked=google', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'link-access-token',
            user: {
              id: 'user-link-1',
              identities: [{ provider: 'google', id: 'google-sub-link' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-link-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['phone'],
          verified_contact: true,
        },
        profile_complete: true,
        verified_contact_required: false,
        next_step: 'app_home',
      });
      vi.mocked(linkSocialIdentity).mockResolvedValueOnce({
        linked_providers: ['phone', 'google'],
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await GET(request);

      expect(approveOAuthSession).toHaveBeenCalledWith('link-access-token', 'google');
      expect(linkSocialIdentity).toHaveBeenCalledWith('link-access-token', 'google');
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?linked=google',
      );
    });

    it('links Facebook identity successfully and redirects to /settings?linked=facebook', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'link-fb-access-token',
            user: {
              id: 'user-link-2',
              identities: [{ provider: 'facebook', id: 'fb-sub-link' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-link-2',
          email: 'user2@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        verified_contact_required: false,
        next_step: 'app_home',
      });
      vi.mocked(linkSocialIdentity).mockResolvedValueOnce({
        linked_providers: ['email', 'facebook'],
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=facebook&flow=link',
      );
      const response = await GET(request);

      expect(approveOAuthSession).toHaveBeenCalledWith('link-fb-access-token', 'facebook');
      expect(linkSocialIdentity).toHaveBeenCalledWith('link-fb-access-token', 'facebook');
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?linked=facebook',
      );
    });

    it('preserves existing session (no signOut) and redirects to /settings?error=link_failed when linkSocialIdentity rejects', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'link-access-token',
            user: {
              id: 'user-link-1',
              identities: [{ provider: 'google', id: 'google-sub-link' }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: {
          id: 'user-link-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['phone'],
          verified_contact: true,
        },
        profile_complete: true,
        verified_contact_required: false,
        next_step: 'app_home',
      });
      vi.mocked(linkSocialIdentity).mockRejectedValueOnce(
        new ApiError(409, 'Identity conflict', 'IDENTITY_LINK_CONFLICT'),
      );

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await GET(request);

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });

    it('preserves session and redirects to /settings?error=link_failed when exchange fails in link flow', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        error: new Error('Exchange error'),
      });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link',
      );
      const response = await GET(request);

      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/settings?error=link_failed',
      );
    });
  });

  describe('Legacy Email Confirmation (flow=email)', () => {
    it('handles email confirmation callback, cleans unapproved local session, and redirects to /login?verified=true', async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new Request(
        'http://localhost:3001/auth/callback?code=mock-code&flow=email',
      );
      const response = await GET(request);

      expect(mockExchangeCodeForSession).toHaveBeenCalledWith('mock-code');
      expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe(
        'http://localhost:3001/login?verified=true',
      );
    });
  });
});
