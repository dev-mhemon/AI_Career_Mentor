import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession, mockGetProfile, mockGetCurrentUserState } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockGetProfile: vi.fn(),
    mockGetCurrentUserState: vi.fn(),
  }),
);

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getSession: mockGetSession,
    },
  })),
}));

vi.mock('@/lib/api/client', () => ({
  DEFAULT_AUTH_STATE_TIMEOUT_MS: 4000,
  getProfile: mockGetProfile,
  getCurrentUserState: mockGetCurrentUserState,
}));

import { getFastSessionShellUser } from './shell-user';

describe('getFastSessionShellUser server-verified admin check (PRD §50)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProfile.mockResolvedValue({ current_role: 'Backend Engineer' });
  });

  it('NEVER trusts spoofed JWT app_metadata.role="ADMIN" when EP-A13 /auth/me returns USER', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-with-spoofed-admin-claim',
          user: {
            email: 'learner@example.com',
            app_metadata: { role: 'ADMIN' },
            user_metadata: { full_name: 'Regular Learner', role: 'ADMIN' },
          },
        },
      },
    });
    mockGetCurrentUserState.mockResolvedValue({
      user: {
        id: 'u-1',
        email: 'learner@example.com',
        phone: null,
        role: 'USER',
        status: 'active',
        linked_providers: ['email'],
        verified_contact: true,
      },
      profile_complete: true,
      focus_roadmap_id: null,
      effective_access: {},
      can_delete_account: true,
    });

    const result = await getFastSessionShellUser();

    expect(result.unauthenticated).toBe(false);
    if (!result.unauthenticated) {
      expect(result.variant).toBe('authenticated');
      expect(result.role).toBe('USER');
      expect(result.isAdmin).toBe(false);
    }
  });

  it('fails closed to authenticated USER when EP-A13 /auth/me rejects or user is suspended', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-suspended-admin',
          user: {
            email: 'admin@example.com',
            app_metadata: { role: 'ADMIN' },
            user_metadata: { full_name: 'Suspended Admin' },
          },
        },
      },
    });
    mockGetCurrentUserState.mockResolvedValueOnce({
      user: {
        id: 'u-2',
        email: 'admin@example.com',
        phone: null,
        role: 'ADMIN',
        status: 'suspended',
        linked_providers: ['email'],
        verified_contact: true,
      },
      profile_complete: true,
      focus_roadmap_id: null,
      effective_access: {},
      can_delete_account: true,
    });

    const suspendedResult = await getFastSessionShellUser();
    expect(suspendedResult.unauthenticated).toBe(false);
    if (!suspendedResult.unauthenticated) {
      expect(suspendedResult.variant).toBe('authenticated');
      expect(suspendedResult.role).toBe('USER');
      expect(suspendedResult.isAdmin).toBe(false);
    }

    mockGetCurrentUserState.mockRejectedValueOnce(new Error('Backend down'));
    const failedResult = await getFastSessionShellUser();
    expect(failedResult.unauthenticated).toBe(false);
    if (!failedResult.unauthenticated) {
      expect(failedResult.variant).toBe('authenticated');
      expect(failedResult.role).toBe('USER');
      expect(failedResult.isAdmin).toBe(false);
    }
  });

  it('grants admin shell variant only when server-verified EP-A13 /auth/me confirms active ADMIN', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-real-admin',
          user: {
            email: 'ops@example.com',
            app_metadata: {},
            user_metadata: { full_name: 'Platform Admin' },
          },
        },
      },
    });
    mockGetCurrentUserState.mockResolvedValue({
      user: {
        id: 'a-1',
        email: 'ops@example.com',
        phone: null,
        role: 'ADMIN',
        status: 'active',
        linked_providers: ['email'],
        verified_contact: true,
      },
      profile_complete: true,
      focus_roadmap_id: null,
      effective_access: {},
      can_delete_account: true,
    });

    const result = await getFastSessionShellUser();
    expect(result.unauthenticated).toBe(false);
    if (!result.unauthenticated) {
      expect(result.variant).toBe('admin');
      expect(result.role).toBe('ADMIN');
      expect(result.isAdmin).toBe(true);
    }
  });
});
