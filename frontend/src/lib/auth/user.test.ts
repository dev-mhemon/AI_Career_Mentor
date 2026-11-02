import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getAppUser,
  getAppSessionState,
  getAppUserResult,
  getAppSessionStateResult,
  isSessionExpired,
} from './user';
import {
  getMe,
  getCurrentUserState,
  UnauthorizedError,
  type UserResponse,
  type CurrentUserStateResponse,
} from '@/lib/api/client';

const mockGetSession = vi.fn();
const mockSetSession = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockCreateSupabaseServerClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (options?: { readOnly?: boolean }) => {
    mockCreateSupabaseServerClient(options);
    return {
      auth: {
        getSession: mockGetSession,
        setSession: mockSetSession,
        signOut: mockSignOut,
      },
    };
  },
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getMe: vi.fn(),
    getCurrentUserState: vi.fn(),
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

/** Helper to generate a dummy mock JWT with specific exp (seconds) */
function makeMockJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'test-user', exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.mockSignature`;
}

describe('isSessionExpired helper', () => {
  it('returns true when expires_at timestamp is in the past', () => {
    const expiredSession = {
      expires_at: Math.floor(Date.now() / 1000) - 30, // 30s ago
      access_token: 'valid-token',
    };
    expect(isSessionExpired(expiredSession)).toBe(true);
  });

  it('returns false when expires_at timestamp is in the future', () => {
    const freshSession = {
      expires_at: Math.floor(Date.now() / 1000) + 3600, // 1h in future
      access_token: 'valid-token',
    };
    expect(isSessionExpired(freshSession)).toBe(false);
  });

  it('returns true when JWT exp claim is in the past', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const expiredJwt = makeMockJwt(pastExp);
    expect(isSessionExpired({ access_token: expiredJwt })).toBe(true);
  });

  it('returns false when JWT exp claim is in the future', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 1800;
    const freshJwt = makeMockJwt(futureExp);
    expect(isSessionExpired({ access_token: freshJwt })).toBe(false);
  });
});

describe('frontend user session resolver (user.ts) - read-only Server Component contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('configures createSupabaseServerClient with readOnly: true', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockResolvedValueOnce(mockActiveUser);

    await getAppUserResult();
    expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith({ readOnly: true });
  });

  it('returns authenticated result when session is valid and backend getMe succeeds', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockResolvedValueOnce(mockActiveUser);

    const result = await getAppUserResult();
    expect(result).toEqual({ status: 'authenticated', data: mockActiveUser });
    expect(getMe).toHaveBeenCalledWith('valid-token');
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns unauthenticated when no session is present', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    const result = await getAppUserResult();
    expect(result).toEqual({ status: 'unauthenticated', data: null });
    expect(getMe).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns unauthenticated without calling getMe when session is expired (non-refreshing boundary)', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'valid-refresh',
          expires_at: Math.floor(Date.now() / 1000) - 60, // expired
        },
      },
    });

    const result = await getAppUserResult();
    expect(result).toEqual({ status: 'unauthenticated', data: null });
    expect(getMe).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns unauthenticated on 401 UnauthorizedError without calling signOut or setSession', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockRejectedValueOnce(new UnauthorizedError('Token expired'));

    const result = await getAppUserResult();
    expect(result).toEqual({ status: 'unauthenticated', data: null });
    expect(getMe).toHaveBeenCalledWith('stale-token');
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('distinguishes transient 503 server error from unauthenticated in getAppUserResult', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    const transientError = new Error('Service Unavailable');
    vi.mocked(getMe).mockRejectedValueOnce(transientError);

    const result = await getAppUserResult();
    expect(result).toEqual({
      status: 'transient_error',
      data: null,
      error: transientError,
    });
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('resolves full app session state via getAppSessionStateResult', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getCurrentUserState).mockResolvedValueOnce(mockSessionState);

    const result = await getAppSessionStateResult();
    expect(result).toEqual({ status: 'authenticated', data: mockSessionState });
    expect(getCurrentUserState).toHaveBeenCalledWith('valid-token');
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('returns transient_error when getAppSessionStateResult encounters backend error', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    const backendError = new Error('Database connection failed');
    vi.mocked(getCurrentUserState).mockRejectedValueOnce(backendError);

    const result = await getAppSessionStateResult();
    expect(result).toEqual({
      status: 'transient_error',
      data: null,
      error: backendError,
    });
    expect(getCurrentUserState).toHaveBeenCalledWith('valid-token');
    expect(mockSetSession).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('backward compatibility: getAppUser returns user on success and null on error/unauthenticated', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockResolvedValueOnce(mockActiveUser);
    expect(await getAppUser()).toEqual(mockActiveUser);

    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await getAppUser()).toBeNull();

    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getMe).mockRejectedValueOnce(new Error('503'));
    expect(await getAppUser()).toBeNull();
  });

  it('backward compatibility: getAppSessionState returns state on success and null on error', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getCurrentUserState).mockResolvedValueOnce(mockSessionState);
    expect(await getAppSessionState()).toEqual(mockSessionState);

    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    vi.mocked(getCurrentUserState).mockRejectedValueOnce(new Error('500'));
    expect(await getAppSessionState()).toBeNull();
  });
});
