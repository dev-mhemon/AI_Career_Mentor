import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CareerGoalResponse, ProfileResponse } from '@/lib/api/client';
import type { OnboardingWizardProps } from '@/components/onboarding/onboarding-wizard';

const {
  mockRedirect,
  mockGetAppUserResult,
  mockLoadProfileForSetup,
  mockReadLiveAuthUser,
  mockGetSession,
  mockDispatchM05Operation,
  mockRequireFastSessionShell,
  mockOnboardingWizard,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockGetAppUserResult: vi.fn(),
  mockLoadProfileForSetup: vi.fn(),
  mockReadLiveAuthUser: vi.fn(),
  mockGetSession: vi.fn(),
  mockDispatchM05Operation: vi.fn(),
  mockRequireFastSessionShell: vi.fn(),
  mockOnboardingWizard: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/auth/user', () => ({
  getAppUserResult: mockGetAppUserResult,
}));

vi.mock('@/lib/auth/shell-user', () => ({
  requireFastSessionShell: mockRequireFastSessionShell,
}));

vi.mock('@/lib/auth/actions', () => ({
  withSingleSessionRefresh: vi.fn(),
}));

vi.mock('@/lib/profile/actions', () => ({
  loadProfileForSetup: mockLoadProfileForSetup,
}));

vi.mock('@/lib/auth/workspace-profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/workspace-profile')>();
  return {
    ...actual,
    readLiveAuthUser: mockReadLiveAuthUser,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getSession: mockGetSession },
  }),
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    dispatchM05Operation: mockDispatchM05Operation,
  };
});

vi.mock('@/components/onboarding/onboarding-wizard', () => ({
  OnboardingWizard: (props: OnboardingWizardProps) => {
    mockOnboardingWizard(props);
    return (
      <div data-testid="onboarding-wizard">
        Step:{props.initialStep}
      </div>
    );
  },
}));

import OnboardingPage from './page';
import OnboardingLayout from '../layout';

const FULL_PROFILE: ProfileResponse = {
  current_role: 'Backend Developer',
  education: 'BSc in CSE',
  experience_level: 'mid',
  existing_skills: [
    {
      skill_id: 'sk-1',
      name: 'Node.js',
      alias_resolved: true,
      learning_state: 'learning',
      source: 'self_reported',
    },
  ],
  existing_skills_none: false,
  learning_preference: 'hands_on',
  preferred_daily_hours: 2,
  timezone: 'Asia/Dhaka',
  timezone_detected: true,
  active_career_goal_ids: ['g-1'],
  profile_complete: true,
  missing_fields: [],
  updated_at: '2026-11-01T00:00:00.000Z',
};

const CONFIRMED_GOAL: CareerGoalResponse = {
  id: 'g-1',
  goal_text: 'Backend developer',
  status: 'confirmed',
  clarification_round: 0,
  clarification_question: null,
  proposed_role: { canonical_role_id: 'r-1', name: 'Backend Development' },
  alternative_roles: [],
  suggested_level: 'mid',
  target_level: 'mid',
  roadmap_id: null,
  created_at: '2026-11-01T00:00:00.000Z',
};

describe('OnboardingPage RSC (100% Lock + Smart Resume) & OnboardingLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-123' } },
    });
    mockReadLiveAuthUser.mockResolvedValue({
      email: 'mehedi@example.com',
      email_confirmed_at: '2026-11-01T00:00:00.000Z',
      user_metadata: { full_name: 'Mehedi Hasan' },
    });
    mockGetAppUserResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        id: 'user-1',
        email: 'mehedi@example.com',
        phone: null,
        role: 'USER',
        status: 'active',
        linked_providers: ['email'],
        verified_contact: true,
      },
    });
  });

  it('enforces 100% Lock Rule: redirects completed users straight to /dashboard', async () => {
    mockLoadProfileForSetup.mockResolvedValue({
      profile: FULL_PROFILE,
      userId: 'user-1',
      fullName: 'Mehedi Hasan',
    });
    mockDispatchM05Operation.mockResolvedValue({
      items: [CONFIRMED_GOAL],
      meta: { limit: 20, next_cursor: null },
    });

    await expect(OnboardingPage()).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
    expect(mockOnboardingWizard).not.toHaveBeenCalled();
  });

  it('enforces Smart Resume Rule: opens on firstIncompleteStep and filters discontinued goals', async () => {
    mockLoadProfileForSetup.mockResolvedValue({
      profile: {
        ...FULL_PROFILE,
        learning_preference: null,
      },
      userId: 'user-1',
      fullName: 'Mehedi Hasan',
    });
    mockDispatchM05Operation.mockResolvedValue({
      items: [
        { ...CONFIRMED_GOAL, id: 'g-old', status: 'discontinued' },
        { ...CONFIRMED_GOAL, id: 'g-draft', status: 'awaiting_confirmation' },
      ],
      meta: { limit: 20, next_cursor: null },
    });

    const tree = await OnboardingPage();
    render(tree);

    expect(screen.getByTestId('onboarding-wizard')).toHaveTextContent('Step:preferences');
    expect(mockOnboardingWizard).toHaveBeenCalledWith(
      expect.objectContaining({
        initialStep: 'preferences',
        initialFullName: 'Mehedi Hasan',
        initialGoals: [
          expect.objectContaining({ id: 'g-draft', status: 'awaiting_confirmation' }),
        ],
      }),
    );
  });

  it('redirects unauthenticated users to /login and suspended users to /settings', async () => {
    mockGetAppUserResult.mockResolvedValueOnce({ status: 'unauthenticated' });
    await expect(OnboardingPage()).rejects.toThrow('NEXT_REDIRECT:/login');

    mockGetAppUserResult.mockResolvedValueOnce({
      status: 'authenticated',
      data: { id: 'user-s', status: 'suspended' },
    });
    await expect(OnboardingPage()).rejects.toThrow('NEXT_REDIRECT:/settings');
  });

  it('renders distraction-free OnboardingLayout with brand logo and Go to Dashboard link, and NO Sidebar', async () => {
    mockRequireFastSessionShell.mockResolvedValue({
      unauthenticated: false,
      variant: 'authenticated',
      user: {
        fullName: 'Mehedi Hasan',
        currentRole: null,
        email: 'mehedi@example.com',
        phone: null,
      },
    });

    const tree = await OnboardingLayout({ children: <div>Wizard Body</div> });
    render(tree);

    expect(screen.getByText('AI Career Mentor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByText('Wizard Body')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
