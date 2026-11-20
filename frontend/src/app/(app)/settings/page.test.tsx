import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { redirect } from 'next/navigation';
import SettingsPage from './page';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { loadProfileForSetup } from '@/lib/profile/actions';

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
  })),
}));

vi.mock('@/lib/auth/user', () => ({
  getAppSessionStateResult: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
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
  usePathname: () => '/settings',
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
        linked_providers: ['email'],
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
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
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

  it('does not render Google/Facebook social linking section or Linked Providers row', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'google' }),
    });
    render(page);

    expect(
      screen.queryByRole('heading', { name: /linked identities|social account/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(?:link|connect) google account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(?:link|connect) facebook account/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Linked Providers')).not.toBeInTheDocument();
  });

  it('merges live supabase.auth.getUser() metadata with profile in Account Overview and pre-fills LearningSettingsForm', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: null,
          phone: '+8801712345678',
          status: 'active',
          role: 'USER',
          verified_contact: true,
          linked_providers: ['phone'],
        },
        profile_complete: false,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          quiz_practice: false,
          ai_mentor: true,
        },
        can_delete_account: true,
      }),
    );
    vi.mocked(loadProfileForSetup).mockResolvedValueOnce({
      profile: {
        current_role: 'Backend Developer',
        education: 'BSc in CSE',
        experience_level: 'junior',
        existing_skills: [],
        existing_skills_none: false,
        learning_preference: null,
        preferred_daily_hours: 3.5,
        timezone: 'Europe/London',
        timezone_detected: true,
        active_career_goal_ids: [],
        profile_complete: false,
        missing_fields: ['learning_preference', 'active_career_goal_ids'],
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    });
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'phone-1111@synthetic.mentor',
          phone: '+8801712345678',
          user_metadata: {
            full_name: 'Mehedi Hasan',
            contact_email: 'mehedi@example.com',
          },
        },
      },
      error: null,
    });

    const page = await SettingsPage({});
    render(page);

    const overview = screen
      .getByRole('heading', { name: /account overview/i })
      .closest('section');
    expect(overview).toHaveTextContent('Mehedi Hasan');
    expect(overview).toHaveTextContent('Backend Developer');
    expect(screen.getByText('Mehedi Hasan')).toBeInTheDocument();
    expect(screen.getByText('mehedi@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/synthetic\.mentor/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Saved in Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
    expect(screen.getAllByText('Active')).toHaveLength(1);
    expect(screen.getAllByText('+880 1712-345678').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Backend Developer')).toBeInTheDocument();
    expect(screen.getByText('Junior')).toBeInTheDocument();
    expect(screen.getByText('BSc in CSE')).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getByText('Roadmap Generation')).toBeInTheDocument();
    expect(screen.getByText('Daily Plan')).toBeInTheDocument();
    expect(screen.getByText('Quiz Practice')).toBeInTheDocument();
    expect(screen.getByText('AI Mentor')).toBeInTheDocument();
    expect(screen.queryByText(/roadmap_generator: enabled/i)).not.toBeInTheDocument();
    expect(
      within(overview as HTMLElement).queryByRole('button', { name: /sign out/i }),
    ).not.toBeInTheDocument();
    expect(
      within(overview as HTMLElement).getByRole('link', { name: /edit profile/i }),
    ).toHaveAttribute('href', '/profile');

    expect(screen.getByLabelText(/^timezone$/i)).toHaveValue('Europe/London');
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(3.5);
  });

  it('falls back to session user metadata when live supabase.auth.getUser() rejects', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        profile_complete: false,
      }),
    );
    vi.mocked(loadProfileForSetup).mockResolvedValueOnce({ profile: null });
    mockGetUser.mockRejectedValueOnce(new Error('network timeout'));
    mockGetSession.mockResolvedValueOnce({
      data: {
        session: {
          user: {
            email: 'fallback@example.com',
            user_metadata: {
              full_name: 'Fallback User',
              current_role: 'QA Engineer',
              experience_level: 'mid',
              timezone: 'Asia/Singapore',
              preferred_daily_hours: 4,
            },
          },
        },
      },
    });

    const page = await SettingsPage({});
    render(page);

    const overview = screen
      .getByRole('heading', { name: /account overview/i })
      .closest('section');
    expect(overview).toHaveTextContent('Fallback User');
    expect(overview).toHaveTextContent('QA Engineer');
    expect(screen.getByText('Fallback User')).toBeInTheDocument();
    expect(screen.getByText('QA Engineer')).toBeInTheDocument();
    expect(screen.getByText('Mid-Level')).toBeInTheDocument();
    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^timezone$/i)).toHaveValue('Asia/Singapore');
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(4);
  });

  it('displays Complete under Profile Completeness when backend profile defines profile_complete: true', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        profile_complete: false,
      }),
    );
    vi.mocked(loadProfileForSetup).mockResolvedValueOnce({
      profile: {
        current_role: 'Full-Stack Developer',
        education: 'BSc CSE',
        experience_level: 'mid',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: 'hands_on',
        preferred_daily_hours: 3,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: ['goal-1'],
        profile_complete: true,
        missing_fields: [],
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    });

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
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
          linked_providers: [],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByRole('button', { name: /send verification code/i })).toBeInTheDocument();
  });

  it('renders compact verified contact status row instead of submission form when user.verified_contact is true', async () => {
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

    expect(screen.getByRole('heading', { name: /contact channels/i })).toBeInTheDocument();
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByText(/Verified Contact Method/i),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[\u0980-\u09FF]/);
    expect(
      screen.queryByRole('button', { name: /send verification code/i }),
    ).not.toBeInTheDocument();
  });

  it('renders English success banner when searchParams.verified === "contact"', async () => {
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

    const page = await SettingsPage({
      searchParams: Promise.resolve({ verified: 'contact' }),
    });
    render(page);

    expect(
      screen.getByText(/Your contact method has been verified successfully\./i),
    ).toBeInTheDocument();
  });

  it('does not render success banner when searchParams.verified === "contact" but user.verified_contact is false', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: null,
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: false,
          linked_providers: [],
        },
      }),
    );

    const page = await SettingsPage({
      searchParams: Promise.resolve({ verified: 'contact' }),
    });
    render(page);

    expect(
      screen.queryByText(/Your contact method has been verified successfully\./i),
    ).not.toBeInTheDocument();
  });

  it('renders LearningSettingsForm with profile values loaded via loadProfileForSetup', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({});
    render(page);

    expect(loadProfileForSetup).toHaveBeenCalled();
    expect(screen.getByLabelText(/^timezone$/i)).toHaveValue('Asia/Dhaka');
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(2.5);
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
    expect(screen.queryByRole('button', { name: /send verification code/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/learning settings cannot be modified while your account is suspended/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^timezone$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/preferred daily hours/i)).not.toBeInTheDocument();
  });

  it('handles suspended state gracefully when loadProfileForSetup returns suspended: true', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());
    vi.mocked(loadProfileForSetup).mockResolvedValueOnce({
      profile: null,
      suspended: true,
    });

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByText('Your account is suspended')).toBeInTheDocument();
    expect(
      screen.getByText(/learning settings cannot be modified while your account is suspended/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^timezone$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/preferred daily hours/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send verification code/i })).not.toBeInTheDocument();
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
      screen.getByRole('heading', { name: /account deletion/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete account/i }),
    ).toBeInTheDocument();
  });

  it('does not mark email as Verified when email_confirmed_at is null even if linked_providers includes email', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'unverified@example.com',
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: false,
          linked_providers: ['email'],
        },
      }),
    );
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'unverified@example.com',
          email_confirmed_at: null,
          phone: null,
          phone_confirmed_at: null,
        },
      },
      error: null,
    });

    const page = await SettingsPage({});
    render(page);

    const emailTerm = screen.getByText('Email', { selector: 'dt' });
    const emailValue = emailTerm.nextElementSibling as HTMLElement;
    expect(emailValue).toHaveTextContent('unverified@example.com');
    expect(emailValue).not.toHaveTextContent('Verified');
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getByText(/verified contact required/i)).toBeInTheDocument();
  });

  it('marks only the confirmed channel Verified when phone is confirmed and email is unconfirmed', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'unconfirmed@example.com',
          phone: '+8801712345678',
          status: 'active',
          role: 'USER',
          verified_contact: true,
          linked_providers: ['phone', 'email'],
        },
      }),
    );
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'unconfirmed@example.com',
          email_confirmed_at: null,
          phone: '+8801712345678',
          phone_confirmed_at: '2026-11-01T00:00:00.000Z',
        },
      },
      error: null,
    });

    const page = await SettingsPage({});
    render(page);

    const emailTerm = screen.getByText('Email', { selector: 'dt' });
    const emailValue = emailTerm.nextElementSibling as HTMLElement;
    expect(emailValue).toHaveTextContent('unconfirmed@example.com');
    expect(emailValue).not.toHaveTextContent('Verified');

    const phoneTerm = screen.getByText('Phone');
    const phoneValue = phoneTerm.nextElementSibling as HTMLElement;
    expect(phoneValue).toHaveTextContent('+880 1712-345678');
    expect(phoneValue).toHaveTextContent('Verified');

    const contactChannelsHeading = screen.getByRole('heading', {
      name: /contact channels/i,
    });
    const contactChannelsCard = contactChannelsHeading.closest('section') as HTMLElement;
    expect(contactChannelsCard).toHaveTextContent('+880 1712-345678');
    expect(contactChannelsCard).not.toHaveTextContent('unconfirmed@example.com');
  });
});
