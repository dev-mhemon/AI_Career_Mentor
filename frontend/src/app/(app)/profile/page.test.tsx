import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ProfileResponse } from '@/lib/api/client';

const {
  mockRedirect,
  mockPush,
  mockGetAppUserResult,
  mockLoadProfileForSetup,
  mockSaveProfileSetupAction,
  mockReadLiveAuthUser,
} = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockPush: vi.fn(),
  mockGetAppUserResult: vi.fn(),
  mockLoadProfileForSetup: vi.fn(),
  mockSaveProfileSetupAction: vi.fn(),
  mockReadLiveAuthUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/profile',
}));

vi.mock('@/lib/auth/user', () => ({
  getAppUserResult: mockGetAppUserResult,
}));

vi.mock('@/lib/profile/actions', () => ({
  loadProfileForSetup: mockLoadProfileForSetup,
  saveProfileSetupAction: mockSaveProfileSetupAction,
}));

vi.mock('@/lib/auth/workspace-profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/workspace-profile')>();
  return {
    ...actual,
    readLiveAuthUser: mockReadLiveAuthUser,
  };
});

import ProfilePage from './page';

const SAVED_PROFILE: ProfileResponse = {
  current_role: 'Backend Developer',
  education: 'BSc in CSE',
  experience_level: 'mid',
  existing_skills: [],
  existing_skills_none: false,
  learning_preference: 'hands_on',
  preferred_daily_hours: 2,
  timezone: 'Asia/Dhaka',
  timezone_detected: true,
  active_career_goal_ids: [],
  profile_complete: true,
  missing_fields: [],
  updated_at: '2026-11-10T00:00:00.000Z',
};

describe('ProfilePage (/profile standalone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
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

  it('redirects unauthenticated users to /login and suspended users to /settings', async () => {
    mockGetAppUserResult.mockResolvedValueOnce({ status: 'unauthenticated' });
    await expect(ProfilePage()).rejects.toThrow('NEXT_REDIRECT:/login');

    mockGetAppUserResult.mockResolvedValueOnce({
      status: 'authenticated',
      data: { id: 'user-s', status: 'suspended' },
    });
    await expect(ProfilePage()).rejects.toThrow('NEXT_REDIRECT:/settings');
  });

  it('renders standalone ProfileSetupForm without stepper or Go to Dashboard, disables Save Changes while pristine, and triggers floating Toast with countdown bar without navigating away', async () => {
    mockLoadProfileForSetup.mockResolvedValue({
      profile: SAVED_PROFILE,
      userId: 'user-1',
      fullName: 'Mehedi Hasan',
    });
    mockSaveProfileSetupAction.mockResolvedValueOnce({
      success: true,
      message: 'Profile saved successfully.',
      profile: { ...SAVED_PROFILE, current_role: 'Staff Backend Engineer' },
      values: {
        full_name: 'Mehedi Hasan',
        email: 'mehedi@example.com',
        phone: '',
        current_role: 'Staff Backend Engineer',
        education: 'BSc in CSE',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    const tree = await ProfilePage();
    render(tree);

    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /go to dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save & next/i })).not.toBeInTheDocument();

    const saveBtn = screen.getByRole('button', { name: 'Save Changes' });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/current role \/ profession/i), {
      target: { value: 'Staff Backend Engineer' },
    });
    expect(saveBtn).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    const toast = screen.getByTestId('toast-container');
    expect(toast).toHaveClass('fixed');
    expect(toast).toHaveTextContent('Profile updated successfully.');
    const countdownBar = screen.getByTestId('toast-countdown-bar');
    expect(countdownBar).toHaveClass('agy-toast-bar');
    expect(countdownBar.style.getPropertyValue('--toast-duration')).toBe('4000ms');
    // Ensure confirmation is rendered via Toast (not inline inside <form>)
    expect(saveBtn.closest('form')!).not.toContainElement(toast);
    expect(mockPush).not.toHaveBeenCalled();
    expect(saveBtn).toBeDisabled();
  });
});
