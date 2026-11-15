import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import OnboardingProfilePage from './page';
import { getAppUser } from '@/lib/auth/user';
import { loadProfileForSetup } from '@/lib/profile/actions';
import type { ProfileSetupFormProps } from '@/components/onboarding/profile-setup-form';

vi.mock('@/lib/auth/user', () => ({
  getAppUser: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}));

vi.mock('@/lib/profile/actions', () => ({
  loadProfileForSetup: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockProfileSetupForm = vi.fn();

vi.mock('@/components/onboarding/profile-setup-form', () => ({
  ProfileSetupForm: (props: ProfileSetupFormProps) => {
    mockProfileSetupForm(props);
    return <div data-testid="profile-setup-form">ProfileSetupForm</div>;
  },
}));

describe('OnboardingProfilePage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects unauthenticated users to /login', async () => {
    vi.mocked(getAppUser).mockResolvedValue(null);

    await OnboardingProfilePage();
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renders suspended banner with link to /settings when user is suspended', async () => {
    vi.mocked(getAppUser).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'suspended',
      role: 'USER',
      verified_contact: true,
      email: 'suspended@example.com',
      phone: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    });

    const jsx = await OnboardingProfilePage();
    render(jsx);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('আপনার অ্যাকাউন্ট স্থগিত আছে');
    const settingsLink = screen.getByRole('link', { name: /settings/i });
    expect(settingsLink).toHaveAttribute('href', '/settings');
    expect(screen.getByText(/Danger Zone/i)).toBeInTheDocument();
  });

  it('passes verified email and fullName metadata into ProfileSetupForm for email-signup users', async () => {
    vi.mocked(getAppUser).mockResolvedValue({
      id: 'user-email-1',
      status: 'active',
      role: 'USER',
      verified_contact: true,
      email: 'alice@example.com',
      phone: null,
      linked_providers: ['email'],
    });
    vi.mocked(loadProfileForSetup).mockResolvedValue({
      profile: null,
      userId: 'user-email-1',
      fullName: 'Alice Rahman',
      contactPhone: '+8801712345678',
    });

    const jsx = await OnboardingProfilePage();
    render(jsx);

    expect(screen.getByTestId('profile-setup-form')).toBeInTheDocument();
    expect(mockProfileSetupForm).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-email-1',
        initialFullName: 'Alice Rahman',
        initialContact: {
          email: 'alice@example.com',
          emailVerified: true,
          phone: '+8801712345678',
          phoneVerified: false,
        },
      }),
    );
  });

  it('passes verified phone into ProfileSetupForm for phone-signup users without marking secondary email verified', async () => {
    vi.mocked(getAppUser).mockResolvedValue({
      id: 'user-phone-1',
      status: 'active',
      role: 'USER',
      verified_contact: true,
      email: null,
      phone: '+8801812345678',
      linked_providers: ['phone'],
    });
    vi.mocked(loadProfileForSetup).mockResolvedValue({
      profile: null,
      userId: 'user-phone-1',
      contactEmail: 'secondary@example.com',
    });

    const jsx = await OnboardingProfilePage();
    render(jsx);

    expect(mockProfileSetupForm).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-phone-1',
        initialFullName: '',
        initialContact: {
          email: 'secondary@example.com',
          emailVerified: false,
          phone: '+8801812345678',
          phoneVerified: true,
        },
      }),
    );
  });
});
