import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import LoginPage from './page';
import { getAppUser } from '@/lib/auth/user';

vi.mock('@/lib/auth/user', () => ({
  getAppUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: ({
    initialError,
    successMessage,
  }: {
    initialError?: string;
    successMessage?: string;
  }) => (
    <div data-testid="login-form">
      {initialError && <div data-testid="initial-error">{initialError}</div>}
      {successMessage && <div data-testid="success-message">{successMessage}</div>}
    </div>
  ),
}));

describe('LoginPage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects authenticated users to /dashboard', async () => {
    vi.mocked(getAppUser).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'active',
      role: 'USER',
      verified_contact: true,
      email: 'test@example.com',
      phone: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    });

    await LoginPage({});
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it('renders login form without alerts when unauthenticated and no search params', async () => {
    vi.mocked(getAppUser).mockResolvedValue(null);

    const jsx = await LoginPage({});
    render(jsx);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign In');
    expect(screen.queryByTestId('initial-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('success-message')).not.toBeInTheDocument();
  });

  it('renders deletion confirmation banner when searchParams.deleted is true', async () => {
    vi.mocked(getAppUser).mockResolvedValue(null);

    const jsx = await LoginPage({
      searchParams: Promise.resolve({ deleted: 'true' }),
    });
    render(jsx);

    const successEl = screen.getByTestId('success-message');
    expect(successEl).toHaveTextContent('Your account has been permanently deleted.');
  });

  it('renders password reset success message when searchParams.reset is success', async () => {
    vi.mocked(getAppUser).mockResolvedValue(null);

    const jsx = await LoginPage({
      searchParams: Promise.resolve({ reset: 'success' }),
    });
    render(jsx);

    const successEl = screen.getByTestId('success-message');
    expect(successEl).toHaveTextContent('Password reset successfully.');
  });
});
