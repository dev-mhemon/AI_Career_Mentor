import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UnauthorizedError } from '@/lib/api/client';
import LandingPage from './page';

const mockGetSession = vi.fn();
const mockGetCurrentUserState = vi.fn();
const mockCreateSupabaseServerClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async (options?: { readOnly?: boolean }) => {
    mockCreateSupabaseServerClient(options);
    return {
      auth: {
        getSession: mockGetSession,
      },
    };
  },
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    getCurrentUserState: (...args: unknown[]) => mockGetCurrentUserState(...args),
  };
});

describe('LandingPage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Sign In and Get Started Free in header pointing to /login and /register when unauthenticated', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });

    const jsx = await LandingPage();
    render(jsx);

    expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith({ readOnly: true });
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign In' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(
      within(header).getByRole('link', { name: 'Get Started Free' }),
    ).toHaveAttribute('href', '/register');
    expect(
      within(header).queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument();
  });

  it('keeps Sign In and Get Started Free visible when authenticated and routes directly to /dashboard', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'valid-token',
          refresh_token: 'valid-refresh',
        },
      },
    });
    mockGetCurrentUserState.mockResolvedValue({
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@example.com',
        phone: null,
        role: 'USER',
        status: 'active',
        verified_contact: true,
        linked_providers: ['email'],
      },
      profile_complete: true,
      focus_roadmap_id: null,
      effective_access: {},
      can_delete_account: true,
    });

    const jsx = await LandingPage();
    render(jsx);

    expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith({ readOnly: true });
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign In' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(
      within(header).getByRole('link', { name: 'Get Started Free' }),
    ).toHaveAttribute('href', '/dashboard');
    expect(
      within(header).queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Sign In to Workspace' }),
    ).toHaveAttribute('href', '/dashboard');
  });

  it('routes Sign In to /login when Supabase session is rejected by backend with UnauthorizedError', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'stale-refresh',
        },
      },
    });
    mockGetCurrentUserState.mockRejectedValue(new UnauthorizedError('Unauthorized'));

    const jsx = await LandingPage();
    render(jsx);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign In' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(
      within(header).getByRole('link', { name: 'Get Started Free' }),
    ).toHaveAttribute('href', '/register');
  });

  it('fails safely to /login and /register header links when auth lookup throws', async () => {
    mockGetSession.mockRejectedValue(new Error('Supabase unavailable'));

    const jsx = await LandingPage();
    render(jsx);

    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Sign In' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(
      within(header).getByRole('link', { name: 'Get Started Free' }),
    ).toHaveAttribute('href', '/register');
  });
});
