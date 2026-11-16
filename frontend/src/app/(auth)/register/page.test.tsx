import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import { UnauthorizedError } from '@/lib/api/client';
import RegisterPage from './page';

const mockGetSession = vi.fn();
const mockGetCurrentUserState = vi.fn();
const mockCreateSupabaseServerClient = vi.fn();
const mockRegisterForm = vi.fn();

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

vi.mock('@/components/auth/register-form', () => ({
  RegisterForm: () => {
    mockRegisterForm();
    return <div data-testid="register-form" />;
  },
}));

describe('RegisterPage Server Component', () => {
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

    await expect(RegisterPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith({ readOnly: true });
    expect(redirect).toHaveBeenCalledWith('/dashboard');
    expect(mockRegisterForm).not.toHaveBeenCalled();
  });

  it('renders registration form when unauthenticated', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
    });

    const jsx = await RegisterPage();
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create Account');
    expect(screen.getByTestId('register-form')).toBeInTheDocument();
  });

  it('renders registration form when app backend rejects session with UnauthorizedError', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'stale-token',
          refresh_token: 'stale-refresh',
        },
      },
    });
    mockGetCurrentUserState.mockRejectedValue(new UnauthorizedError('Unauthorized'));

    const jsx = await RegisterPage();
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('register-form')).toBeInTheDocument();
  });

  it('renders registration form safely when Supabase getSession rejects', async () => {
    mockGetSession.mockRejectedValue(new Error('Network error'));

    const jsx = await RegisterPage();
    render(jsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('register-form')).toBeInTheDocument();
  });
});
