import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProfileSetupForm } from '@/components/onboarding/profile-setup-form';
import type { ProfileResponse } from '@/lib/api/client';
import { saveProfileSetupAction } from '@/lib/profile/actions';

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
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('performs SSR-safe initial render followed by mount useEffect draft restoration and browser timezone detection', () => {
    const tzSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({
        timeZone: 'Europe/London',
      } as Intl.ResolvedDateTimeFormatOptions);

    try {
      window.sessionStorage.setItem(
        'mentor_onboarding_profile_draft:user-42',
        JSON.stringify({
          user_id: 'user-42',
          values: {
            current_role: 'Cloud Architect',
            education: 'MSc in CS',
            experience_level: 'senior',
            existing_skills_none: false,
            timezone: '',
            preferred_daily_hours: '3',
          },
        }),
      );

      render(
        <ProfileSetupForm
          initialProfile={{ ...EMPTY_PROFILE, timezone: null }}
          userId="user-42"
        />,
      );

      // After mount effect runs, restored draft values and detected timezone are applied
      expect(screen.getByRole('status')).toHaveTextContent(/ড্রাফট সংরক্ষিত/i);
      expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
        'Cloud Architect',
      );
      expect(screen.getByLabelText(/education — optional/i)).toHaveValue('MSc in CS');
      expect(screen.getByLabelText(/experience level/i)).toHaveValue('senior');
      expect(screen.getByLabelText(/iana timezone/i)).toHaveValue('Europe/London');
      expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(3);
    } finally {
      tzSpy.mockRestore();
    }
  });

  it('preserves skillsNoneTouched across reload when draft existing_skills_none differs from initialProfile', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-99',
      JSON.stringify({
        user_id: 'user-99',
        values: {
          current_role: 'Junior QA',
          education: '',
          experience_level: 'beginner',
          existing_skills_none: true,
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: '2',
        },
        skills_none_touched: true,
      }),
    );

    const { container } = render(
      <ProfileSetupForm
        initialProfile={{ ...EMPTY_PROFILE, existing_skills_none: false }}
        userId="user-99"
      />,
    );

    const noneSwitch = screen.getByRole('switch', {
      name: /none — complete beginner/i,
    });
    expect(noneSwitch).toHaveAttribute('aria-checked', 'true');

    // Confirm hidden input existing_skills_none_touched is true
    const touchedInput = container.querySelector(
      'input[name="existing_skills_none_touched"]',
    ) as HTMLInputElement;
    expect(touchedInput).not.toBeNull();
    expect(touchedInput.value).toBe('true');
  });

  it('immediately dismisses form-level alert, field errors, and aria-invalid upon user edit and restores them on subsequent failed submit', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      error: 'Validation failed. Please correct the highlighted errors.',
      fieldErrors: {
        current_role: 'বর্তমান পেশা বা ভূমিকা আবশ্যক (Current role is required).',
      },
    });

    render(<ProfileSetupForm initialProfile={EMPTY_PROFILE} />);

    const submitBtn = screen.getByRole('button', {
      name: /প্রোফাইল সংরক্ষণ করুন/i,
    });

    // 1. Submit form to trigger action error
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const initialAlerts = screen.getAllByRole('alert');
    expect(initialAlerts.length).toBe(2);
    expect(screen.getByText(/validation failed/i)).toBeInTheDocument();
    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    expect(roleInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(/বর্তমান পেশা বা ভূমিকা আবশ্যক/i),
    ).toBeInTheDocument();

    // 2. User edits the field -> stale error and aria-invalid must be dismissed immediately
    fireEvent.change(roleInput, { target: { value: 'Frontend Developer' } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(roleInput).toHaveAttribute('aria-invalid', 'false');
    expect(
      screen.queryByText(/বর্তমান পেশা বা ভূমিকা আবশ্যক/i),
    ).not.toBeInTheDocument();

    // 3. User submits again and server returns another error
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      error: 'Please select an experience level.',
      fieldErrors: {
        experience_level: 'অভিজ্ঞতার স্তর নির্বাচন আবশ্যক (Experience level is required).',
      },
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const secondAlerts = screen.getAllByRole('alert');
    expect(secondAlerts.length).toBe(2);
    expect(screen.getByText(/please select an experience level/i)).toBeInTheDocument();
    const levelSelect = screen.getByLabelText(/experience level/i);
    expect(levelSelect).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText(/অভিজ্ঞতার স্তর নির্বাচন আবশ্যক/i),
    ).toBeInTheDocument();
  });

  it('rejects and clears a sessionStorage draft belonging to a different user_id (account isolation)', () => {
    // Draft belonging to user-A
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-B',
      JSON.stringify({
        user_id: 'user-A',
        values: {
          current_role: 'Account A Leaked Role',
          education: 'Secret College',
          experience_level: 'senior',
          existing_skills_none: true,
          timezone: 'Asia/Tokyo',
          preferred_daily_hours: '4',
        },
      }),
    );
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft',
      JSON.stringify({
        user_id: 'user-A',
        current_role: 'Legacy Leaked Role',
      }),
    );

    render(
      <ProfileSetupForm initialProfile={EMPTY_PROFILE} userId="user-B" />,
    );

    // Account B must not see Account A's draft
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // Stale drafts should be removed from sessionStorage
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft:user-B'),
    ).toBeNull();
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft'),
    ).toBeNull();
  });

  it('unconditionally removes malformed legacy un-scoped draft and restores valid user-scoped draft without blocking', () => {
    // Malformed JSON in legacy un-scoped key
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft',
      '{ invalid json corrupt draft',
    );

    // Valid user-scoped draft
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-valid',
      JSON.stringify({
        user_id: 'user-valid',
        values: {
          current_role: 'Security Engineer',
          education: 'BSc in Software Engineering',
          experience_level: 'mid',
          existing_skills_none: false,
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: '3',
        },
      }),
    );

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        userId="user-valid"
      />,
    );

    // Corrupt legacy un-scoped draft must be cleaned up
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft'),
    ).toBeNull();

    // Valid user-scoped draft must be restored properly
    expect(screen.getByRole('status')).toHaveTextContent(/ড্রাফট সংরক্ষিত/i);
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Security Engineer',
    );
    expect(screen.getByLabelText(/education — optional/i)).toHaveValue(
      'BSc in Software Engineering',
    );
    expect(screen.getByLabelText(/experience level/i)).toHaveValue('mid');
  });

  it('cleans up malformed JSON in scoped draft key without throwing', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-corrupt',
      '{ corrupt json',
    );

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        userId="user-corrupt"
      />,
    );

    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('');
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft:user-corrupt'),
    ).toBeNull();
  });

  it('does not auto-detect browser timezone when loadError is present and initialProfile is null with no saved draft', () => {
    const tzSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({
        timeZone: 'Asia/Tokyo',
      } as Intl.ResolvedDateTimeFormatOptions);

    try {
      render(
        <ProfileSetupForm
          initialProfile={null}
          loadError="Unable to reach the server. Please enter your details below."
          userId="user-load-err"
        />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent(/unable to reach the server/i);
      // Timezone input must remain blank instead of auto-detecting Asia/Tokyo
      expect(screen.getByLabelText(/iana timezone/i)).toHaveValue('');
    } finally {
      tzSpy.mockRestore();
    }
  });

  it('persists new draft in sessionStorage when editing a field after a successful save without being wiped', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'প্রোফাইল সংরক্ষিত হয়েছে (Profile saved successfully).',
      values: {
        current_role: 'Full Stack Engineer',
        education: 'BSc in CSE',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    render(
      <ProfileSetupForm initialProfile={EMPTY_PROFILE} userId="user-edit-after-save" />,
    );

    const submitBtn = screen.getByRole('button', {
      name: /প্রোফাইল সংরক্ষণ করুন/i,
    });

    // 1. Submit and succeed
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByText(/প্রোফাইল সংরক্ষিত হয়েছে/i)).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft:user-edit-after-save'),
    ).toBeNull();

    // 2. User edits a field after success -> stale success message is immediately dismissed and new draft is saved
    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    fireEvent.change(roleInput, { target: { value: 'Lead Architect' } });

    expect(
      screen.queryByText(/প্রোফাইল সংরক্ষিত হয়েছে/i),
    ).not.toBeInTheDocument();

    // Draft must now be saved in sessionStorage and NOT wiped by the success effect
    const savedDraft = window.sessionStorage.getItem(
      'mentor_onboarding_profile_draft:user-edit-after-save',
    );
    expect(savedDraft).not.toBeNull();
    const parsed = JSON.parse(savedDraft!);
    expect(parsed.values.current_role).toBe('Lead Architect');

    // 3. Subsequent save succeeds -> success message re-appears
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'প্রোফাইল সংরক্ষিত হয়েছে (Profile saved successfully).',
      values: {
        current_role: 'Lead Architect',
        education: 'BSc in CSE',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByText(/প্রোফাইল সংরক্ষিত হয়েছে/i)).toBeInTheDocument();

    // 4. Toggling existing_skills_none also immediately dismisses the success message
    const noneSwitch = screen.getByRole('switch', {
      name: /none — complete beginner/i,
    });
    fireEvent.click(noneSwitch);
    expect(
      screen.queryByText(/প্রোফাইল সংরক্ষিত হয়েছে/i),
    ).not.toBeInTheDocument();
  });

  it('reflects updated state.profile for stored skills indicator even on partial failure', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      error: 'Unable to reach the server. Please try again.',
      retryable: true,
      profile: {
        ...EMPTY_PROFILE,
        existing_skills: [
          {
            skill_id: 'skill-ts',
            name: 'TypeScript',
            alias_resolved: true,
            learning_state: 'learning',
            source: 'self_reported',
          },
        ],
        existing_skills_none: false,
      },
      values: {
        current_role: 'Platform Engineer',
        education: '',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    render(
      <ProfileSetupForm initialProfile={EMPTY_PROFILE} userId="user-partial-profile" />,
    );

    expect(screen.queryByText(/TypeScript/)).not.toBeInTheDocument();

    const submitBtn = screen.getByRole('button', {
      name: /প্রোফাইল সংরক্ষণ করুন/i,
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /unable to reach the server/i,
    );
    expect(screen.getByText(/TypeScript/)).toBeInTheDocument();
  });

  it('reconciles controlled form inputs with state.values upon successful save', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'প্রোফাইল সংরক্ষিত হয়েছে (Profile saved successfully).',
      values: {
        current_role: 'Senior Staff Engineer',
        education: 'MSc in Software Engineering',
        experience_level: 'senior',
        existing_skills_none: false,
        timezone: 'UTC',
        preferred_daily_hours: '4',
      },
    });

    render(
      <ProfileSetupForm initialProfile={EMPTY_PROFILE} userId="user-reconcile" />,
    );

    const submitBtn = screen.getByRole('button', {
      name: /প্রোফাইল সংরক্ষণ করুন/i,
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Senior Staff Engineer',
    );
    expect(screen.getByLabelText(/education — optional/i)).toHaveValue(
      'MSc in Software Engineering',
    );
    expect(screen.getByLabelText(/experience level/i)).toHaveValue('senior');
    expect(screen.getByLabelText(/iana timezone/i)).toHaveValue('UTC');
    expect(screen.getByLabelText(/preferred daily hours/i)).toHaveValue(4);
  });

  it('reconciles cleared education (null -> "") when saving empty education', async () => {
    const profileWithEducation: ProfileResponse = {
      ...EMPTY_PROFILE,
      current_role: 'Full Stack Engineer',
      education: 'BSc in CSE',
      experience_level: 'mid',
    };

    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'প্রোফাইল সংরক্ষিত হয়েছে (Profile saved successfully).',
      profile: {
        ...profileWithEducation,
        education: null,
      },
      values: {
        current_role: 'Full Stack Engineer',
        education: '',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    render(
      <ProfileSetupForm
        initialProfile={profileWithEducation}
        userId="user-clear-edu"
      />,
    );

    const educationInput = screen.getByLabelText(/education — optional/i);
    expect(educationInput).toHaveValue('BSc in CSE');

    // User clears the field
    fireEvent.change(educationInput, { target: { value: '' } });
    expect(educationInput).toHaveValue('');

    const submitBtn = screen.getByRole('button', {
      name: /প্রোফাইল সংরক্ষণ করুন/i,
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Reconciles to ""
    expect(educationInput).toHaveValue('');
    expect(screen.getByText(/প্রোফাইল সংরক্ষিত হয়েছে/i)).toBeInTheDocument();
  });
});
