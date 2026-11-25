import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReadOnlySessionResult, AppSessionState } from '@/lib/auth/user';
import type { AuthenticatedFastShellSession } from '@/lib/auth/shell-user';

let mockPathname = '/dashboard';

const {
  mockRedirect,
  mockReplace,
  mockGetAppSessionStateResult,
  mockGetAuthenticatedShellUser,
  mockRequireFastSessionShell,
  mockLoginUser,
  mockSetSession,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockReplace: vi.fn(),
  mockGetAppSessionStateResult:
    vi.fn<() => Promise<ReadOnlySessionResult<AppSessionState>>>(),
  mockGetAuthenticatedShellUser: vi.fn(),
  mockRequireFastSessionShell:
    vi.fn<() => Promise<AuthenticatedFastShellSession>>(),
  mockLoginUser: vi.fn(),
  mockSetSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: async () => ({
    get: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      setSession: mockSetSession,
    },
  })),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    loginUser: mockLoginUser,
  };
});

vi.mock('@/lib/auth/user', () => ({
  getAppSessionStateResult: mockGetAppSessionStateResult,
}));

vi.mock('@/lib/auth/shell-user', () => ({
  getAuthenticatedShellUser: mockGetAuthenticatedShellUser,
  requireFastSessionShell: mockRequireFastSessionShell,
}));

import AdminRouteLayout from '@/app/(app)/admin/layout';
import OnboardingLayout from '@/app/(onboarding)/layout';
import { loginAction } from '@/lib/auth/actions';
import { AdminWorkspaceGuard } from './admin-workspace-guard';

describe('Admin-only flow & strict route isolation', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    vi.clearAllMocks();
    mockSetSession.mockResolvedValue({ error: null });
  });

  it('redirects verified active ADMIN directly to /admin on loginAction even when next_step=profile_setup (bypasses onboarding)', async () => {
    mockLoginUser.mockResolvedValue({
      access_token: 'admin-access-token',
      refresh_token: 'admin-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      user: {
        id: '99999999-9999-4999-8999-999999999999',
        email: 'admin@mentor.com',
        phone: null,
        role: 'ADMIN',
        status: 'active',
        linked_providers: ['email'],
        verified_contact: true,
      },
      profile_complete: false,
      next_step: 'profile_setup',
    });

    const fd = new FormData();
    fd.set('email', 'admin@mentor.com');
    fd.set('password', 'admin1234');

    await expect(loginAction({}, fd)).rejects.toThrow('NEXT_REDIRECT:/admin');
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('redirects verified ADMIN away from /onboarding routes via OnboardingLayout', async () => {
    mockRequireFastSessionShell.mockResolvedValue({
      unauthenticated: false,
      variant: 'admin',
      role: 'ADMIN',
      isAdmin: true,
      user: {
        fullName: 'Platform Admin',
        currentRole: null,
        email: 'admin@mentor.com',
        phone: null,
      },
    });

    await expect(
      OnboardingLayout({ children: <div>Onboarding Step</div> }),
    ).rejects.toThrow('NEXT_REDIRECT:/admin');
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('AdminWorkspaceGuard redirects ADMIN on learner paths and allows /admin/** paths', () => {
    mockPathname = '/roadmaps/123';
    const { rerender } = render(<AdminWorkspaceGuard isAdmin={true} />);
    expect(mockReplace).toHaveBeenCalledWith('/admin');

    mockReplace.mockClear();
    mockPathname = '/admin/users';
    rerender(<AdminWorkspaceGuard isAdmin={true} />);
    expect(mockReplace).not.toHaveBeenCalled();

    mockPathname = '/dashboard';
    rerender(<AdminWorkspaceGuard isAdmin={false} />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('AdminRouteLayout blocks non-admin USER with 403 Access Denied without rendering children', async () => {
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
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
      },
    });

    const tree = await AdminRouteLayout({
      children: <div>Secret Admin Data</div>,
    });
    render(tree);

    expect(screen.getByText('403 Access Denied')).toBeInTheDocument();
    expect(screen.queryByText('Secret Admin Data')).not.toBeInTheDocument();
  });
});
