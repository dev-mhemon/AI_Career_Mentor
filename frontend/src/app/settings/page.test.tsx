import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import SettingsPage from './page';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { loadProfileForSetup } from '@/lib/profile/actions';

vi.mock('@/lib/auth/user', () => ({
  getAppSessionStateResult: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
  linkIdentityAction: vi.fn(),
  addContactAction: vi.fn(),
  requestAccountDeletionAction: vi.fn(),
  pollAccountDeletionStatusAction: vi.fn(),
}));

vi.mock('@/lib/profile/actions', () => ({
  loadProfileForSetup: vi.fn(),
  updateLearningSettingsAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Creates mock AppSessionState for testing settings page.
 */
function createMockSessionState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'authenticated' as const,
    data: {
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@example.com',
        phone: null,
        status: 'active',
        role: 'USER',
        verified_contact: false,
        linked_providers: ['google'],
      },
      profile_complete: true,
      effective_access: {},
      focus_roadmap_id: null,
      can_delete_account: false,
      ...overrides,
    },
  };
}

describe('SettingsPage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProfileForSetup).mockResolvedValue({
      profile: {
        current_role: 'Student',
        education: null,
        experience_level: 'beginner',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: null,
        preferred_daily_hours: 2.5,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: [],
        profile_complete: false,
        missing_fields: ['learning_preference', 'active_career_goal_ids'],
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    });
  });

  it('rejects unvalidated ?linked= URL parameters and does not show false success', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'malicious-string' }),
    });
    render(page);

    expect(screen.queryByText(/অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে/i)).not.toBeInTheDocument();
  });

  it('shows success message only when ?linked= matches an allowed and actually linked provider', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'google' }),
    });
    render(page);

    expect(
      screen.getByText(/Google অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে/i),
    ).toBeInTheDocument();
  });

  it('does not show success message when ?linked=facebook but user only has google linked', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'facebook' }),
    });
    render(page);

    expect(screen.queryByText(/Facebook অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে/i)).not.toBeInTheDocument();
  });

  it('renders AddContactForm when user has unverified contact and is not suspended', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: null,
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: false,
          linked_providers: ['facebook'],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).toBeInTheDocument();
  });

  it('renders verified contact status instead of submission form when user.verified_contact is true', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'verified@example.com',
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: true,
          linked_providers: ['email'],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(
      screen.getByText(/যোগাযোগের মাধ্যম যাচাইকৃত \(Verified Contact Method\)/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /যাচাইকরণ কোড পাঠান/i }),
    ).not.toBeInTheDocument();
  });

  it('renders localized success banner when searchParams.verified === "contact"', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'verified@example.com',
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: true,
          linked_providers: ['email', 'facebook'],
        },
      }),
    );

    const page = await SettingsPage({
      searchParams: Promise.resolve({ verified: 'contact' }),
    });
    render(page);

    expect(
      screen.getByText(/আপনার যোগাযোগের তথ্য সফলভাবে যাচাই করা হয়েছে/i),
    ).toBeInTheDocument();
  });

  it('does not render localized success banner when searchParams.verified === "contact" but user.verified_contact is false', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: null,
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: false,
          linked_providers: ['facebook'],
        },
      }),
    );

    const page = await SettingsPage({
      searchParams: Promise.resolve({ verified: 'contact' }),
    });
    render(page);

    expect(
      screen.queryByText(/আপনার যোগাযোগের তথ্য সফলভাবে যাচাই করা হয়েছে/i),
    ).not.toBeInTheDocument();
  });

  it('renders LearningSettingsForm with profile values loaded via loadProfileForSetup', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({});
    render(page);

    expect(loadProfileForSetup).toHaveBeenCalled();
    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue(
      'Asia/Dhaka',
    );
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(2.5);
  });

  it('redirects to /login when loadProfileForSetup returns unauthorized: true', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());
    vi.mocked(loadProfileForSetup).mockResolvedValueOnce({
      profile: null,
      unauthorized: true,
    });
    vi.mocked(redirect).mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(SettingsPage({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('does not render AddContactForm or interactive learning fields when user is suspended', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'suspended@example.com',
          phone: null,
          status: 'suspended',
          role: 'USER',
          verified_contact: false,
          linked_providers: [],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(loadProfileForSetup).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/স্থগিত অ্যাকাউন্ট থেকে শেখার সেটিংস পরিবর্তন করা সম্ভব নয়/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/টাইমজোন \(IANA Timezone\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/দৈনিক অধ্যয়নের সময়/i)).not.toBeInTheDocument();
  });

  it('handles suspended state gracefully when loadProfileForSetup returns suspended: true', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());
    vi.mocked(loadProfileForSetup).mockResolvedValueOnce({
      profile: null,
      suspended: true,
    });

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByText(/আপনার অ্যাকাউন্ট স্থগিত আছে/i)).toBeInTheDocument();
    expect(
      screen.getByText(/স্থগিত অ্যাকাউন্ট থেকে শেখার সেটিংস পরিবর্তন করা সম্ভব নয়/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/টাইমজোন \(IANA Timezone\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/দৈনিক অধ্যয়নের সময়/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).not.toBeInTheDocument();
  });

  it('renders Danger Zone AccountDeletionCard for both active and suspended users (AZ-SUSP)', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        can_delete_account: true,
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(
      screen.getByRole('heading', { name: /অ্যাকাউন্ট মুছে ফেলা/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }),
    ).toBeInTheDocument();
  });
});
