import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { getAppSessionStateResult } from '@/lib/auth/user';
import type { loadProfileForSetup } from '@/lib/profile/actions';

type SessionStateResult = Awaited<ReturnType<typeof getAppSessionStateResult>>;
type ProfileSetupResult = Awaited<ReturnType<typeof loadProfileForSetup>>;

const {
  mockRedirect,
  mockPush,
  mockRefresh,
  mockGetAppSessionStateResult,
  mockLoadProfileForSetup,
  mockListCareerGoals,
  mockGetToday,
  mockListRoadmaps,
  mockFocusRoadmap,
  mockGetProgress,
  mockGetUser,
  mockGetSession,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockGetAppSessionStateResult: vi.fn<() => Promise<SessionStateResult>>(),
  mockLoadProfileForSetup: vi.fn<() => Promise<ProfileSetupResult>>(),
  mockListCareerGoals: vi.fn(),
  mockGetToday: vi.fn(),
  mockListRoadmaps: vi.fn(),
  mockFocusRoadmap: vi.fn(),
  mockGetProgress: vi.fn(),
  mockGetUser: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  usePathname: () => '/dashboard',
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock('@/lib/auth/user', () => ({
  getAppSessionStateResult: mockGetAppSessionStateResult,
}));

vi.mock('@/lib/profile/actions', () => ({
  loadProfileForSetup: mockLoadProfileForSetup,
}));

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    listCareerGoals: mockListCareerGoals,
    getToday: mockGetToday,
    listRoadmaps: mockListRoadmaps,
    focusRoadmap: mockFocusRoadmap,
    getProgress: mockGetProgress,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
  })),
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}));

import DashboardPage from './page';
import { AppShell } from '@/components/ui/app-shell';
import { AppShellProvider } from '@/components/ui/app-shell-context';

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockGetToday.mockResolvedValue({
      status: 'no_focus_roadmap',
      roadmap_id: null,
      plan_id: null,
      plan_day: null,
      topic: null,
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: null,
      requires_learning_hours: false,
      preferred_daily_hours: null,
    });
    mockListRoadmaps.mockResolvedValue({
      items: [],
      meta: { limit: 10, next_cursor: null },
    });
    mockGetProgress.mockResolvedValue({
      progress: {
        roadmap_id: null,
        career_level: 'mid',
        roadmap_progress: { items_total: 0, items_completed: 0 },
        skills: [],
        weak_areas: [],
      },
      meta: { limit: 50, next_cursor: null },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      profile: null,
    });
  });

  it('redirects unauthenticated users to /login', async () => {
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'unauthenticated',
      data: null,
    });

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('hides workspace sidebar on transient_error recovery shell via AppShellSync disabled', async () => {
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'transient_error',
      data: null,
      error: new Error('Service unavailable'),
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    expect(
      screen.queryByRole('complementary', { name: 'Primary sidebar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Service Temporarily Unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
  });

  it('hides workspace sidebar on suspended account notice via AppShellSync disabled', async () => {
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'suspended',
          verified_contact: true,
          linked_providers: ['email'],
        },
        profile_complete: true,
        effective_access: {},
        focus_roadmap_id: null,
        can_delete_account: true,
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    expect(
      screen.queryByRole('complementary', { name: 'Primary sidebar' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your account is suspended' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Account Settings/i })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
  });

  it('renders complete English SaaS dashboard synced with live profile data and AppShell', async () => {
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-1',
          email: 'mehedi@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          verified_contact: true,
          linked_providers: ['email'],
        },
        profile_complete: true,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          ai_mentor: true,
        },
        focus_roadmap_id: null,
        can_delete_account: true,
      },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      fullName: 'Mehedi Hasan Emon',
      profile: {
        current_role: 'Senior Full-Stack Engineer',
        education: 'BSc in Computer Science',
        experience_level: 'mid',
        existing_skills: [
          {
            skill_id: 'skill-1',
            name: 'TypeScript',
            alias_resolved: false,
            learning_state: 'proficient',
            source: 'self_reported',
          },
          {
            skill_id: 'skill-2',
            name: 'Next.js',
            alias_resolved: false,
            learning_state: 'practicing',
            source: 'self_reported',
          },
        ],
        existing_skills_none: false,
        learning_preference: 'hands_on',
        preferred_daily_hours: 4,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: ['backend-engineer'],
        profile_complete: true,
        missing_fields: [],
        updated_at: '2026-11-15T10:00:00.000Z',
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const profileTrigger = screen.getByRole('button', {
      name: /Mehedi Hasan Emon/i,
    });
    expect(profileTrigger).toHaveTextContent('Senior Full-Stack Engineer');

    expect(
      screen.getByRole('navigation', { name: 'Breadcrumb' }),
    ).toHaveTextContent('AI Career MentorDashboard');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' }),
    ).toBeInTheDocument();
    // Top-right Edit Profile CTA button removed
    expect(screen.queryByRole('link', { name: 'Edit Profile' })).not.toBeInTheDocument();
    // No incomplete banner when 100% complete
    expect(screen.queryByRole('region', { name: 'Profile completion progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /continue setup/i })).not.toBeInTheDocument();

    expect(screen.getByText('GOOD DAY,')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Mehedi Hasan Emon!' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Asia/Dhaka')).toBeInTheDocument();
    expect(screen.getByText('100% Complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/career-profile#preferences',
    );
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('link', { name: 'Review Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('link', { name: 'Update Skills' })).toHaveAttribute(
      'href',
      '/career-profile',
    );
    expect(screen.getByRole('link', { name: 'Edit Career Profile' })).toHaveAttribute(
      'href',
      '/career-profile',
    );
    expect(screen.getByText('4 hrs / day')).toBeInTheDocument();
    expect(screen.getByText('28 hrs / week')).toBeInTheDocument();
    expect(screen.getByText('Mid-Level')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Learning Roadmap' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Daily Practice & Quizzes' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'AI Career Mentor' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Ready')).toHaveLength(3);

    expect(document.body.textContent).not.toMatch(/[\u0980-\u09FF]/);
  });

  it('renders synced onboarding banner and Continue setup CTA to /onboarding when profile completion < 100%', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-123' } },
    });
    mockListCareerGoals.mockResolvedValue({
      items: [],
      meta: { limit: 100, next_cursor: null },
    });
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-2',
          email: 'starter@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          verified_contact: false,
          linked_providers: ['email'],
        },
        profile_complete: false,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          ai_mentor: true,
        },
        focus_roadmap_id: null,
        can_delete_account: true,
      },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      fullName: 'Starter User',
      profile: {
        current_role: 'Student',
        education: null,
        experience_level: 'beginner',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: null,
        preferred_daily_hours: null,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: [],
        profile_complete: false,
        missing_fields: [],
        updated_at: '2026-11-15T10:00:00.000Z',
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    const banner = screen.getByRole('region', { name: 'Profile completion progress' });
    expect(within(banner).getByText('Complete your profile (40%)')).toBeInTheDocument();
    expect(within(banner).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(within(banner).getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    expect(screen.getByText('40% Complete')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue Setup' })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    expect(screen.getAllByText('Unlocks after full onboarding')).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/[\u0980-\u09FF]/);
  });

  it('promotes focused roadmap in left hero card and shows only non-focused active roadmaps in right card', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-focus' } },
    });
    mockListCareerGoals.mockResolvedValue({
      items: [{ id: 'g-1', status: 'confirmed' }],
      meta: { limit: 100, next_cursor: null },
    });
    mockGetToday.mockResolvedValue({
      status: 'ready',
      roadmap_id: 'rm-focus',
      plan_id: 'plan-1',
      plan_day: { day_no: 2, total_days: 12 },
      topic: {
        topic_id: 'top-1',
        title: 'Python for Data Engineering',
        career_level: 'junior',
        content_version: 1,
        explanation_markdown: '## Notes',
        important_questions: [],
        sources: [],
        learning_state: 'learning',
        required_depth: 'Core',
        rating_allowed: true,
        report_allowed: true,
      },
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: null,
      requires_learning_hours: false,
      preferred_daily_hours: 2,
    });
    mockListRoadmaps.mockResolvedValue({
      items: [
        {
          id: 'rm-focus',
          career_goal_id: 'g-1',
          canonical_role_id: 'r-1',
          role_name: 'Data Engineering',
          target_level: 'junior',
          status: 'locked',
          is_focus: true,
          current_version_id: 'v-1',
          current_version_no: 1,
          draft_version_no: null,
          has_open_draft: false,
          has_open_merge: false,
          has_daily_plan: true,
          stale: false,
          stale_draft: false,
          locked_at: '2026-11-20T00:00:00.000Z',
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
        {
          id: 'rm-other-locked',
          career_goal_id: 'g-2',
          canonical_role_id: 'r-2',
          role_name: 'Backend Development',
          target_level: 'mid',
          status: 'locked',
          is_focus: false,
          current_version_id: 'v-2',
          current_version_no: 1,
          draft_version_no: null,
          has_open_draft: false,
          has_open_merge: false,
          has_daily_plan: false,
          stale: false,
          stale_draft: false,
          locked_at: '2026-11-20T00:00:00.000Z',
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
        {
          id: 'rm-other-draft',
          career_goal_id: 'g-3',
          canonical_role_id: 'r-3',
          role_name: 'Cloud Architecture',
          target_level: 'senior',
          status: 'draft',
          is_focus: false,
          current_version_id: null,
          current_version_no: null,
          draft_version_no: 1,
          has_open_draft: true,
          has_open_merge: false,
          has_daily_plan: false,
          stale: false,
          stale_draft: false,
          locked_at: null,
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
      ],
      meta: { limit: 10, next_cursor: null },
    });
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-1',
          email: 'mehedi@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          verified_contact: true,
          linked_providers: ['email'],
        },
        profile_complete: true,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          ai_mentor: true,
        },
        focus_roadmap_id: 'rm-focus',
        can_delete_account: true,
      },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      fullName: 'Mehedi Hasan',
      profile: {
        current_role: 'Engineer',
        education: 'BSc',
        experience_level: 'mid',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: 'hands_on',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: ['g-1'],
        profile_complete: true,
        missing_fields: [],
        updated_at: '2026-11-20T00:00:00.000Z',
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    const heroCard = screen.getByRole('article', {
      name: /Focused roadmap and today's learning/i,
    });
    expect(within(heroCard).getByText('Data Engineering')).toBeInTheDocument();
    expect(within(heroCard).getByText('Focus')).toBeInTheDocument();
    expect(within(heroCard).getByText('locked')).toBeInTheDocument();
    expect(within(heroCard).getByText('Day 2 of 12')).toBeInTheDocument();
    expect(
      within(heroCard).getByRole('link', { name: /Continue Today/i }),
    ).toHaveAttribute('href', '/today');

    const othersCard = screen.getByRole('article', {
      name: /Other active roadmaps/i,
    });
    expect(within(othersCard).getByText('3 / 3 active')).toBeInTheDocument();
    expect(
      within(othersCard).queryByText('Data Engineering'),
    ).not.toBeInTheDocument();
    expect(
      within(othersCard).getByText('Backend Development'),
    ).toBeInTheDocument();
    expect(
      within(othersCard).getByRole('button', { name: 'Set as Focus' }),
    ).toBeInTheDocument();
    expect(
      within(othersCard).getByRole('link', { name: 'Review Draft' }),
    ).toHaveAttribute('href', '/roadmaps/rm-other-draft/draft');
    expect(mockListRoadmaps).toHaveBeenCalledWith('tok-focus', {
      status: 'locked',
      limit: 10,
    });
    expect(mockListRoadmaps).toHaveBeenCalledWith('tok-focus', {
      status: 'draft',
      limit: 10,
    });
  });

  it('renders compact empty state in right card when user only has 1 focused roadmap', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-single' } },
    });
    mockListCareerGoals.mockResolvedValue({
      items: [{ id: 'g-1', status: 'confirmed' }],
      meta: { limit: 100, next_cursor: null },
    });
    mockGetToday.mockResolvedValue({
      status: 'no_daily_plan',
      roadmap_id: 'rm-only',
      plan_id: null,
      plan_day: null,
      topic: null,
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: null,
      requires_learning_hours: false,
      preferred_daily_hours: 2,
    });
    mockListRoadmaps.mockResolvedValue({
      items: [
        {
          id: 'rm-only',
          career_goal_id: 'g-1',
          canonical_role_id: 'r-1',
          role_name: 'Data Engineering',
          target_level: 'junior',
          status: 'locked',
          is_focus: true,
          current_version_id: 'v-1',
          current_version_no: 1,
          draft_version_no: null,
          has_open_draft: false,
          has_open_merge: false,
          has_daily_plan: false,
          stale: false,
          stale_draft: false,
          locked_at: '2026-11-20T00:00:00.000Z',
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
      ],
      meta: { limit: 10, next_cursor: null },
    });
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-1',
          email: 'mehedi@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          verified_contact: true,
          linked_providers: ['email'],
        },
        profile_complete: true,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          ai_mentor: true,
        },
        focus_roadmap_id: 'rm-only',
        can_delete_account: true,
      },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      fullName: 'Mehedi Hasan',
      profile: {
        current_role: 'Engineer',
        education: 'BSc',
        experience_level: 'mid',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: 'hands_on',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: ['g-1'],
        profile_complete: true,
        missing_fields: [],
        updated_at: '2026-11-20T00:00:00.000Z',
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    const othersCard = screen.getByRole('article', {
      name: /Other active roadmaps/i,
    });
    expect(within(othersCard).getByText('1 / 3 active')).toBeInTheDocument();
    expect(
      within(othersCard).getByText(/No other active roadmaps yet/i),
    ).toBeInTheDocument();
    expect(
      within(othersCard).queryByText('Data Engineering'),
    ).not.toBeInTheDocument();
  });

  it('reloads getToday after EP-R14 focus switch to a roadmap without a Daily Plan even if HoursPromptModal is cancelled, preventing stale roadmap_id submission', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-switch' } },
    });
    mockListCareerGoals.mockResolvedValue({
      items: [{ id: 'g-1', status: 'confirmed' }],
      meta: { limit: 100, next_cursor: null },
    });
    mockGetToday
      .mockResolvedValueOnce({
        status: 'ready',
        roadmap_id: 'rm-old',
        plan_id: 'plan-old',
        plan_day: { day_no: 2, total_days: 12 },
        topic: {
          topic_id: 'top-old',
          title: 'Old Roadmap Topic',
          career_level: 'junior',
          content_version: 1,
          explanation_markdown: '## Old',
          important_questions: [],
          sources: [],
          learning_state: 'learning',
          required_depth: 'Core',
          rating_allowed: true,
          report_allowed: true,
        },
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: null,
        requires_learning_hours: false,
        preferred_daily_hours: 2,
      })
      .mockResolvedValueOnce({
        status: 'no_daily_plan',
        roadmap_id: 'rm-new',
        plan_id: null,
        plan_day: null,
        topic: null,
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: null,
        requires_learning_hours: false,
        preferred_daily_hours: 2,
      });

    mockFocusRoadmap.mockResolvedValueOnce({
      focus_roadmap_id: 'rm-new',
      daily_plan: {
        state: 'missing',
        plan_id: null,
        requires_learning_hours: false,
      },
    });

    mockListRoadmaps.mockResolvedValue({
      items: [
        {
          id: 'rm-old',
          career_goal_id: 'g-1',
          canonical_role_id: 'r-1',
          role_name: 'Data Engineering',
          target_level: 'junior',
          status: 'locked',
          is_focus: true,
          current_version_id: 'v-1',
          current_version_no: 1,
          draft_version_no: null,
          has_open_draft: false,
          has_open_merge: false,
          has_daily_plan: true,
          stale: false,
          stale_draft: false,
          locked_at: '2026-11-20T00:00:00.000Z',
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
        {
          id: 'rm-new',
          career_goal_id: 'g-2',
          canonical_role_id: 'r-2',
          role_name: 'Backend Development',
          target_level: 'mid',
          status: 'locked',
          is_focus: false,
          current_version_id: 'v-2',
          current_version_no: 1,
          draft_version_no: null,
          has_open_draft: false,
          has_open_merge: false,
          has_daily_plan: false,
          stale: false,
          stale_draft: false,
          locked_at: '2026-11-20T00:00:00.000Z',
          archived_at: null,
          created_at: '2026-11-20T00:00:00.000Z',
          updated_at: '2026-11-20T00:00:00.000Z',
        },
      ],
      meta: { limit: 10, next_cursor: null },
    });
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-1',
          email: 'mehedi@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          verified_contact: true,
          linked_providers: ['email'],
        },
        profile_complete: true,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          ai_mentor: true,
        },
        focus_roadmap_id: 'rm-old',
        can_delete_account: true,
      },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      fullName: 'Mehedi Hasan',
      profile: {
        current_role: 'Engineer',
        education: 'BSc',
        experience_level: 'mid',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: 'hands_on',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: ['g-1'],
        profile_complete: true,
        missing_fields: [],
        updated_at: '2026-11-20T00:00:00.000Z',
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    const othersCard = screen.getByRole('article', {
      name: /Other active roadmaps/i,
    });
    fireEvent.click(
      within(othersCard).getByRole('button', { name: 'Set as Focus' }),
    );

    // Modal opens for the new focused roadmap; cancel it
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    // Hero card MUST reflect refreshed Today for rm-new (no_daily_plan), NOT stale rm-old ready state
    await waitFor(() => {
      expect(mockGetToday).toHaveBeenCalledTimes(2);
      const heroCard = screen.getByRole('article', {
        name: /Focused roadmap and today's learning/i,
      });
      expect(
        within(heroCard).getByText('Backend Development'),
      ).toBeInTheDocument();
      expect(
        within(heroCard).queryByText('Old Roadmap Topic'),
      ).not.toBeInTheDocument();
      expect(
        within(heroCard).getByRole('button', { name: /Create Daily Plan/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders Today recovery hero card with Retry Today and Open Today when server getToday fails', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'tok-err' } },
    });
    mockListCareerGoals.mockResolvedValue({
      items: [{ id: 'g-1', status: 'confirmed' }],
      meta: { limit: 100, next_cursor: null },
    });
    mockGetToday
      .mockRejectedValueOnce(new Error('transient upstream failure'))
      .mockResolvedValueOnce({
        status: 'no_focus_roadmap',
        roadmap_id: null,
        plan_id: null,
        plan_day: null,
        topic: null,
        quiz: { attempt_id: null, status: null, can_retry: false },
        job: null,
        requires_learning_hours: false,
        preferred_daily_hours: null,
      });
    mockListRoadmaps.mockResolvedValue({
      items: [],
      meta: { limit: 10, next_cursor: null },
    });
    mockGetProgress.mockResolvedValue({
      progress: {
        roadmap_id: null,
        career_level: 'mid',
        roadmap_progress: { items_total: 0, items_completed: 0 },
        skills: [],
        weak_areas: [],
      },
      meta: { limit: 50, next_cursor: null },
    });
    mockGetAppSessionStateResult.mockResolvedValue({
      status: 'authenticated',
      data: {
        user: {
          id: 'user-1',
          email: 'mehedi@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          verified_contact: true,
          linked_providers: ['email'],
        },
        profile_complete: true,
        effective_access: {
          roadmap_generator: true,
          daily_plan: true,
          ai_mentor: true,
        },
        focus_roadmap_id: null,
        can_delete_account: true,
      },
    });
    mockLoadProfileForSetup.mockResolvedValue({
      fullName: 'Mehedi Hasan',
      profile: {
        current_role: 'Engineer',
        education: 'BSc',
        experience_level: 'mid',
        existing_skills: [],
        existing_skills_none: true,
        learning_preference: 'hands_on',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        active_career_goal_ids: ['g-1'],
        profile_complete: true,
        missing_fields: [],
        updated_at: '2026-11-20T00:00:00.000Z',
      },
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    const heroCard = screen.getByRole('article', {
      name: /Focused roadmap and today's learning/i,
    });
    expect(
      within(heroCard).getByText(/Could not load Today's learning status/i),
    ).toBeInTheDocument();
    expect(
      within(heroCard).getByRole('link', { name: /Open Today/i }),
    ).toHaveAttribute('href', '/today');

    fireEvent.click(
      within(heroCard).getByRole('button', { name: /Retry Today/i }),
    );
    await waitFor(() => {
      expect(mockGetToday).toHaveBeenCalledTimes(2);
      expect(
        within(heroCard).getByText(/Choose a Focus Roadmap/i),
      ).toBeInTheDocument();
    });
  });
});
