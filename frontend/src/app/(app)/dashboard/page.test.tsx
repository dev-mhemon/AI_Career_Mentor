import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { getAppSessionStateResult } from '@/lib/auth/user';
import type { loadProfileForSetup } from '@/lib/profile/actions';

type SessionStateResult = Awaited<ReturnType<typeof getAppSessionStateResult>>;
type ProfileSetupResult = Awaited<ReturnType<typeof loadProfileForSetup>>;

const {
  mockRedirect,
  mockGetAppSessionStateResult,
  mockLoadProfileForSetup,
  mockGetUser,
  mockGetSession,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockGetAppSessionStateResult: vi.fn<() => Promise<SessionStateResult>>(),
  mockLoadProfileForSetup: vi.fn<() => Promise<ProfileSetupResult>>(),
  mockGetUser: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  usePathname: () => '/dashboard',
}));

vi.mock('@/lib/auth/user', () => ({
  getAppSessionStateResult: mockGetAppSessionStateResult,
}));

vi.mock('@/lib/profile/actions', () => ({
  loadProfileForSetup: mockLoadProfileForSetup,
}));

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
    expect(screen.getByRole('link', { name: 'Edit Profile' })).toHaveAttribute(
      'href',
      '/onboarding/profile',
    );

    expect(screen.getByText('GOOD DAY,')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Mehedi Hasan Emon!' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Asia/Dhaka')).toBeInTheDocument();
    expect(screen.getByText('100% Complete')).toBeInTheDocument();
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

  it('renders onboarding prompt and pending module badges when profile is incomplete', async () => {
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
      profile: null,
    });

    const page = await DashboardPage();
    render(
      <AppShellProvider>
        <AppShell>{page}</AppShell>
      </AppShellProvider>,
    );

    expect(screen.getAllByRole('link', { name: 'Continue Setup' })[0]).toHaveAttribute(
      'href',
      '/onboarding/profile',
    );
    expect(screen.getByText('Step 1 of 5 • 20%')).toBeInTheDocument();
    expect(screen.getAllByText('Unlocks after full onboarding')).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/[\u0980-\u09FF]/);
  });
});
