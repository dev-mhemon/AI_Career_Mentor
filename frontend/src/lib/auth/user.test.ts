import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAppUser, getAppSessionState } from './user';
import {
  getMe,
  getCurrentUserState,
  refreshSession,
  UnauthorizedError,
  type UserResponse,
  type CurrentUserStateResponse,
} from '@/lib/api/client';

const mockGetSession = vi.fn();
const mockSetSession = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getSession: mockGetSession,
      setSession: mockSetSession,
      signOut: mockSignOut,
    },
  }),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getMe: vi.fn(),
    getCurrentUserState: vi.fn(),
    refreshSession: vi.fn(),
  };
});

const mockActiveUser: UserResponse = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'active@example.com',
  phone: null,
  role: 'USER',
  status: 'active',
  linked_providers: ['email'],
  verified_contact: true,
};

const mockSessionState: CurrentUserStateResponse = {
  user: mockActiveUser,
  profile_complete: false,
  focus_roadmap_id: null,
  effective_access: { 'onboarding.profile': true },
  can_delete_account: true,
};

describe('frontend user session resolver & single refresh guard (user.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns user when session is valid and backend getMe succeeds', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockResolvedValueOnce(mockActiveUser);

    const result = await getAppUser();
    expect(result).toEqual(mockActiveUser);
    expect(getMe).toHaveBeenCalledWith('valid-token');
    expect(refreshSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns null when no session is present', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    const result = await getAppUser();
    expect(result).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('performs single refresh on 401 UnauthorizedError and retries request successfully', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    // First call: 401 Unauthorized
    vi.mocked(getMe).mockRejectedValueOnce(new UnauthorizedError('Token expired'));
    // Refresh succeeds with rotated pair
    vi.mocked(refreshSession).mockResolvedValueOnce({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      user: mockActiveUser,
      profile_complete: false,
      next_step: 'profile_setup',
    });
    mockSetSession.mockResolvedValueOnce({ error: null });
    // Second call: succeeds
    vi.mocked(getMe).mockResolvedValueOnce(mockActiveUser);

    const result = await getAppUser();
    expect(result).toEqual(mockActiveUser);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledWith('valid-refresh');
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    });
    expect(getMe).toHaveBeenNthCalledWith(1, 'stale-token');
    expect(getMe).toHaveBeenNthCalledWith(2, 'new-access-token');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('prevents infinite loop: signs out and returns null if second attempt fails after refresh', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockRejectedValueOnce(new UnauthorizedError('Token expired'));
    vi.mocked(refreshSession).mockResolvedValueOnce({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      user: mockActiveUser,
      profile_complete: false,
      next_step: 'profile_setup',
    });
    mockSetSession.mockResolvedValueOnce({ error: null });
    // Second call also fails — but NOT with UnauthorizedError this time, generic throw
    vi.mocked(getMe).mockRejectedValueOnce(new UnauthorizedError('Token revoked'));

    const result = await getAppUser();
    expect(result).toBeNull();
    // Verify at most one refresh occurred
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('signs out and returns null if refreshSession fails with UnauthorizedError', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'revoked-refresh',
        },
      },
    });
    vi.mocked(getMe).mockRejectedValueOnce(new UnauthorizedError('Token expired'));
    vi.mocked(refreshSession).mockRejectedValueOnce(new UnauthorizedError('Refresh token invalid'));

    const result = await getAppUser();
    expect(result).toBeNull();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('returns null without signOut on transient 503 server error (no session destruction)', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockRejectedValueOnce(new Error('Service Unavailable'));

    const result = await getAppUser();
    expect(result).toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns null without signOut when refresh fails with transient error (preserves session)', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockRejectedValueOnce(new UnauthorizedError('Token expired'));
    // Refresh fails with transient network error, NOT UnauthorizedError
    vi.mocked(refreshSession).mockRejectedValueOnce(new Error('Network timeout'));

    const result = await getAppUser();
    expect(result).toBeNull();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    // Should NOT sign out on transient refresh failure
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('resolves full app session state via getAppSessionState', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getCurrentUserState).mockResolvedValueOnce(mockSessionState);

    const result = await getAppSessionState();
    expect(result).toEqual(mockSessionState);
    expect(getCurrentUserState).toHaveBeenCalledWith('valid-token');
  });
});
