import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import { UnauthorizedError } from '@/lib/api/client';
import LoginPage from './page';

const mockGetSession = vi.fn();
const mockGetCurrentUserState = vi.fn();
const mockCreateSupabaseServerClient = vi.fn();
const mockLoginForm = vi.fn();
const mockCookieGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockCookieGet,
  }),
}));

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

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: ({
    initialError,
    successMessage,
    initialRememberedLogin,
    clearSavedLogin,
  }: {
    initialError?: string;
    successMessage?: string;
    initialRememberedLogin?: unknown;
    clearSavedLogin?: boolean;
  }) => {
    mockLoginForm({
      initialError,
      successMessage,
      initialRememberedLogin,
      clearSavedLogin,
    });
    return (
      <div data-testid="login-form">
        {initialError && <div data-testid="initial-error">{initialError}</div>}
        {successMessage && <div data-testid="success-message">{successMessage}</div>}
      </div>
    );
  },
}));

describe('LoginPage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects authenticated users immediately to /dashboard before rendering form HTML', async () => {
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
        email: 'test@example.com',
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

    await expect(LoginPage({})).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith({ readOnly: true });
    expect(redirect).toHaveBeenCalledWith('/dashboard');
    expect(mockLoginForm).not.toHaveBeenCalled();
  });

  it('renders /login?error=sync_failed error message instead of redirecting even if a session exists', async () => {
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
        email: 'test@example.com',
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

    const jsx = await LoginPage({
      searchParams: Promise.resolve({ error: 'sync_failed' }),
    });
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(mockGetCurrentUserState).not.toHaveBeenCalled();
    expect(screen.getByTestId('initial-error')).toHaveTextContent(
      'Account synchronization failed. Please contact support.',
    );
  });

  it('renders login form when Supabase session exists but backend returns UnauthorizedError', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'stale-refresh',
        },
      },
    });
    mockGetCurrentUserState.mockRejectedValue(new UnauthorizedError('Unauthorized'));

    const jsx = await LoginPage({});
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('renders login form without alerts when unauthenticated and no search params', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });

    const jsx = await LoginPage({});
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign In');
    expect(screen.queryByTestId('initial-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('success-message')).not.toBeInTheDocument();
  });

  it('renders login form safely when Supabase getSession rejects', async () => {
    mockGetSession.mockRejectedValue(new Error('Network error'));

    const jsx = await LoginPage({});
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('login-form')).toBeInTheDocument();
  });

  it('renders deletion confirmation banner when searchParams.deleted is true', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const jsx = await LoginPage({
      searchParams: Promise.resolve({ deleted: 'true' }),
    });
    render(jsx);

    const successEl = screen.getByTestId('success-message');
    expect(successEl).toHaveTextContent('Your account has been permanently deleted.');
  });

  it('renders password reset success message when searchParams.reset is success', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const jsx = await LoginPage({
      searchParams: Promise.resolve({ reset: 'success' }),
    });
    render(jsx);

    const successEl = screen.getByTestId('success-message');
    expect(successEl).toHaveTextContent('Password reset successfully.');
  });

  it('forwards remembered phone/email login hint from mentor_login_hint cookie and clears on deleted=true', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockCookieGet.mockImplementation((name: string) =>
      name === 'mentor_login_hint'
        ? {
            value: JSON.stringify({
              channel: 'phone',
              identifier: '01629795421',
              rememberMe: true,
            }),
          }
        : undefined,
    );

    render(await LoginPage({}));
    expect(mockLoginForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialRememberedLogin: {
          channel: 'phone',
          identifier: '01629795421',
          rememberMe: true,
        },
        clearSavedLogin: false,
      }),
    );

    render(
      await LoginPage({
        searchParams: Promise.resolve({ deleted: 'true' }),
      }),
    );
    expect(mockLoginForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialRememberedLogin: null,
        clearSavedLogin: true,
      }),
    );
  });
});
