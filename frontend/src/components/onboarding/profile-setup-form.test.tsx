import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileSetupForm } from '@/components/onboarding/profile-setup-form';
import type { ProfileResponse } from '@/lib/api/client';

vi.mock('@/lib/profile/actions', () => ({
  saveProfileSetupAction: vi.fn(),
}));

const EMPTY_PROFILE: ProfileResponse = {
  current_role: null,
  education: null,
  experience_level: null,
  existing_skills: [],
  existing_skills_none: false,
  learning_preference: null,
  preferred_daily_hours: null,
  timezone: 'Asia/Dhaka',
  timezone_detected: true,
  active_career_goal_ids: [],
  profile_complete: false,
  missing_fields: [
    'current_role',
    'experience_level',
    'learning_preference',
    'preferred_daily_hours',
    'existing_skills',
    'active_career_goal_ids',
  ],
  updated_at: '2026-11-01T00:00:00.000Z',
};

describe('ProfileSetupForm (M01-09 Screen 07)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('renders Step 1 of 5 progressbar, accessible labels, optional education, and no forced Junior fallback', () => {
    render(<ProfileSetupForm initialProfile={EMPTY_PROFILE} />);

    const progressbar = screen.getByRole('progressbar', {
      name: /step 1 of 5/i,
    });
    expect(progressbar).toHaveAttribute('aria-valuenow', '1');
    expect(progressbar).toHaveAttribute('aria-valuemin', '1');
    expect(progressbar).toHaveAttribute('aria-valuemax', '5');

    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    expect(roleInput).toBeRequired();
    expect(roleInput).toHaveValue('');

    const educationInput = screen.getByLabelText(/education — optional/i);
    expect(educationInput).not.toBeRequired();
    expect(educationInput).toHaveValue('');

    const levelSelect = screen.getByLabelText(/experience level/i);
    expect(levelSelect).toBeRequired();
    // Must not default to 'junior' when profile.experience_level is null
    expect(levelSelect).toHaveValue('');

    const noneSwitch = screen.getByRole('switch', {
      name: /none — complete beginner/i,
    });
    expect(noneSwitch).toHaveAttribute('aria-checked', 'false');

    const skipLink = screen.getByRole('link', { name: /skip to dashboard/i });
    expect(skipLink).toHaveAttribute('href', '/dashboard');

    const nextM05Button = screen.getByRole('button', {
      name: /next: skills — m05/i,
    });
    expect(nextM05Button).toBeDisabled();
    expect(nextM05Button).toHaveAttribute('aria-disabled', 'true');
  });

  it('populates stored profile values and displays preserved skills when present', () => {
    const storedProfile: ProfileResponse = {
      ...EMPTY_PROFILE,
      current_role: 'Frontend Developer',
      education: 'BSc in CSE',
      experience_level: 'junior',
      existing_skills: [
        {
          skill_id: 'skill-1',
          name: 'React',
          alias_resolved: true,
          learning_state: 'learning',
          source: 'self_reported',
        },
      ],
      existing_skills_none: false,
      preferred_daily_hours: 2.5,
      timezone: 'Asia/Dhaka',
    };

    render(<ProfileSetupForm initialProfile={storedProfile} />);

    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Frontend Developer',
    );
    expect(screen.getByLabelText(/education — optional/i)).toHaveValue(
      'BSc in CSE',
    );
    expect(screen.getByLabelText(/experience level/i)).toHaveValue('junior');
    expect(screen.getByLabelText(/iana timezone/i)).toHaveValue('Asia/Dhaka');
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(2.5);
    expect(screen.getByText(/React/)).toBeInTheDocument();
  });

  it('toggles explicit beginner None switch and persists unsaved draft in sessionStorage', () => {
    render(<ProfileSetupForm initialProfile={EMPTY_PROFILE} />);

    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    fireEvent.change(roleInput, { target: { value: 'CS Student' } });

    const levelSelect = screen.getByLabelText(/experience level/i);
    fireEvent.change(levelSelect, { target: { value: 'beginner' } });

    const noneSwitch = screen.getByRole('switch', {
      name: /none — complete beginner/i,
    });
    fireEvent.click(noneSwitch);
    expect(noneSwitch).toHaveAttribute('aria-checked', 'true');

    const rawDraft = window.sessionStorage.getItem(
      'mentor_onboarding_profile_draft',
    );
    expect(rawDraft).not.toBeNull();
    const parsedDraft = JSON.parse(rawDraft!);
    expect(parsedDraft.current_role).toBe('CS Student');
    expect(parsedDraft.experience_level).toBe('beginner');
    expect(parsedDraft.existing_skills_none).toBe(true);
  });

  it('preserves user draft and renders warning alert when initial GET /profile fails', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft',
      JSON.stringify({
        current_role: 'Self-Taught Learner',
        education: '',
        experience_level: 'beginner',
        existing_skills_none: true,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '1.5',
      }),
    );

    render(
      <ProfileSetupForm
        initialProfile={null}
        loadError="Unable to reach the server. You can still enter your details below."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /unable to reach the server/i,
    );
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Self-Taught Learner',
    );
    expect(screen.getByLabelText(/experience level/i)).toHaveValue('beginner');
    expect(
      screen.getByRole('switch', { name: /none — complete beginner/i }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
