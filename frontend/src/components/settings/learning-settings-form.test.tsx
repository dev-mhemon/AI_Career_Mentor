import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LearningSettingsForm } from '@/components/settings/learning-settings-form';
import { updateLearningSettingsAction } from '@/lib/profile/actions';
import type { ProfileResponse } from '@/lib/api/client';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock('@/lib/profile/actions', () => ({
  updateLearningSettingsAction: vi.fn(),
}));

const MOCK_PROFILE: ProfileResponse = {
  current_role: 'Backend Developer',
  education: 'BSc CSE',
  experience_level: 'junior',
  existing_skills: [],
  existing_skills_none: true,
  learning_preference: 'mixed',
  preferred_daily_hours: 2.5,
  timezone: 'Asia/Dhaka',
  timezone_detected: true,
  active_career_goal_ids: [],
  profile_complete: false,
  missing_fields: ['active_career_goal_ids'],
  updated_at: '2026-11-01T00:00:00.000Z',
};

describe('LearningSettingsForm Component (M02-04 Screen 22 EP-P04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders initial profile timezone and preferred_daily_hours values', () => {
    render(<LearningSettingsForm initialProfile={MOCK_PROFILE} />);

    const timezoneInput = screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i);
    const hoursInput = screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i);

    expect(timezoneInput).toHaveValue('Asia/Dhaka');
    expect(hoursInput).toHaveValue(2.5);
    expect(
      screen.getByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i }),
    ).toBeInTheDocument();
  });

  it('falls back to Asia/Dhaka and 2 hours when initialProfile is null', () => {
    render(<LearningSettingsForm initialProfile={null} />);

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue(
      'Asia/Dhaka',
    );
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(2);
  });

  it('renders suspended notice and hides inputs when isSuspended is true', () => {
    render(<LearningSettingsForm initialProfile={MOCK_PROFILE} isSuspended={true} />);

    expect(
      screen.getByText(/স্থগিত অ্যাকাউন্ট থেকে শেখার সেটিংস পরিবর্তন করা সম্ভব নয়/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i }),
    ).not.toBeInTheDocument();
  });

  it('auto-detects browser timezone when Auto-detect button is clicked', () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((...args) => {
      const instance = new originalDateTimeFormat(...args);
      return {
        ...instance,
        resolvedOptions: () => ({ ...instance.resolvedOptions(), timeZone: 'Asia/Tokyo' }),
      } as Intl.DateTimeFormat;
    });

    try {
      render(<LearningSettingsForm initialProfile={{ ...MOCK_PROFILE, timezone: 'UTC' }} />);

      const autoDetectBtn = screen.getByRole('button', {
        name: /স্বয়ংক্রিয়ভাবে শনাক্ত করুন/i,
      });
      fireEvent.click(autoDetectBtn);

      const timezoneInput = screen.getByLabelText(
        /টাইমজোন \(IANA Timezone\)/i,
      ) as HTMLInputElement;
      expect(timezoneInput.value).toBe('Asia/Tokyo');
    } finally {
      spy.mockRestore();
    }
  });

  it('submits updated learning settings and renders localized success status banner', async () => {
    vi.mocked(updateLearningSettingsAction).mockResolvedValueOnce({
      success: true,
      message: 'শেখার সেটিংস সংরক্ষিত হয়েছে (Learning settings saved successfully).',
      values: {
        timezone: 'Europe/London',
        preferred_daily_hours: '3.5',
      },
    });

    render(<LearningSettingsForm initialProfile={MOCK_PROFILE} />);

    const timezoneInput = screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i);
    const hoursInput = screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i);

    fireEvent.change(timezoneInput, { target: { value: 'Europe/London' } });
    fireEvent.change(hoursInput, { target: { value: '3.5' } });

    const submitBtn = screen.getByRole('button', {
      name: /সেটিংস সংরক্ষণ করুন/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/শেখার সেটিংস সংরক্ষিত হয়েছে/i),
      ).toBeInTheDocument();
    });

    const passedFormData = vi.mocked(updateLearningSettingsAction).mock.calls[0][1];
    expect(passedFormData.get('timezone')).toBe('Europe/London');
    expect(passedFormData.get('preferred_daily_hours')).toBe('3.5');
  });

  it('prevents saving fallback defaults and disables form inputs when loadError is present', () => {
    render(
      <LearningSettingsForm
        initialProfile={null}
        loadError="Unable to reach the server to load learning settings. Please retry before saving."
      />,
    );

    const loadAlert = screen.getByRole('alert');
    expect(loadAlert).toHaveTextContent(/Unable to reach the server/i);
    expect(
      screen.getByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toBeDisabled();
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toBeDisabled();
  });

  it('renders accessible retry button when loadError is present and triggers reload', () => {
    const mockOnRetry = vi.fn();
    const { rerender } = render(
      <LearningSettingsForm
        initialProfile={null}
        loadError="Unable to reach the server to load learning settings. Please retry before saving."
        onRetry={mockOnRetry}
      />,
    );

    const retryBtn = screen.getByRole('button', {
      name: /পুনরায় চেষ্টা করুন \(Retry\)/i,
    });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockOnRetry).toHaveBeenCalledTimes(1);

    // Default fallback to router.refresh() when onRetry is omitted
    rerender(
      <LearningSettingsForm
        initialProfile={null}
        loadError="Unable to reach the server to load learning settings. Please retry before saving."
      />,
    );
    const retryBtnDefault = screen.getByRole('button', {
      name: /পুনরায় চেষ্টা করুন \(Retry\)/i,
    });
    fireEvent.click(retryBtnDefault);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('synchronizes form values with newly loaded profile when retry succeeds and loadError clears', () => {
    const { rerender } = render(
      <LearningSettingsForm
        initialProfile={null}
        loadError="Unable to reach the server to load learning settings. Please retry before saving."
      />,
    );

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('Asia/Dhaka');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(2);
    expect(screen.getByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i })).toBeDisabled();

    const loadedProfile: ProfileResponse = {
      ...MOCK_PROFILE,
      timezone: 'Europe/Berlin',
      preferred_daily_hours: 4.5,
    };

    rerender(
      <LearningSettingsForm
        initialProfile={loadedProfile}
        loadError={undefined}
      />,
    );

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('Europe/Berlin');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(4.5);
    expect(screen.getByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i })).not.toBeDisabled();
  });

  it('preserves unsaved user edits when component rerenders with a new initialProfile object reference', () => {
    const { rerender } = render(
      <LearningSettingsForm initialProfile={MOCK_PROFILE} />,
    );

    const timezoneInput = screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i);
    const hoursInput = screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i);

    fireEvent.change(timezoneInput, { target: { value: 'Asia/Tokyo' } });
    fireEvent.change(hoursInput, { target: { value: '5' } });

    expect(timezoneInput).toHaveValue('Asia/Tokyo');
    expect(hoursInput).toHaveValue(5);

    const freshProfileRef: ProfileResponse = {
      ...MOCK_PROFILE,
    };

    rerender(<LearningSettingsForm initialProfile={freshProfileRef} />);

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('Asia/Tokyo');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(5);
  });

  it('keeps saved values when component rerenders with the same initialProfile after a successful save', async () => {
    vi.mocked(updateLearningSettingsAction).mockResolvedValueOnce({
      success: true,
      message: 'শেখার সেটিংস সংরক্ষিত হয়েছে (Learning settings saved successfully).',
      values: {
        timezone: 'Europe/London',
        preferred_daily_hours: '3.5',
      },
    });

    const { rerender } = render(<LearningSettingsForm initialProfile={MOCK_PROFILE} />);
    const timezoneInput = screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i);
    const hoursInput = screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i);

    fireEvent.change(timezoneInput, { target: { value: 'Europe/London' } });
    fireEvent.change(hoursInput, { target: { value: '3.5' } });

    const submitBtn = screen.getByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/শেখার সেটিংস সংরক্ষিত হয়েছে/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('Europe/London');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(3.5);

    rerender(<LearningSettingsForm initialProfile={MOCK_PROFILE} />);

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('Europe/London');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(3.5);
  });

  it('synchronizes form values when component rerenders with a genuinely changed initialProfile after save', async () => {
    vi.mocked(updateLearningSettingsAction).mockResolvedValueOnce({
      success: true,
      message: 'শেখার সেটিংস সংরক্ষিত হয়েছে (Learning settings saved successfully).',
      values: {
        timezone: 'Europe/London',
        preferred_daily_hours: '3.5',
      },
    });

    const { rerender } = render(<LearningSettingsForm initialProfile={MOCK_PROFILE} />);
    const timezoneInput = screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i);
    const hoursInput = screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i);

    fireEvent.change(timezoneInput, { target: { value: 'Europe/London' } });
    fireEvent.change(hoursInput, { target: { value: '3.5' } });

    const submitBtn = screen.getByRole('button', { name: /সেটিংস সংরক্ষণ করুন/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/শেখার সেটিংস সংরক্ষিত হয়েছে/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('Europe/London');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(3.5);

    // Rerender with genuinely changed initialProfile (e.g. external update or server revalidation)
    const updatedProfile: ProfileResponse = {
      ...MOCK_PROFILE,
      timezone: 'America/New_York',
      preferred_daily_hours: 4,
    };
    rerender(<LearningSettingsForm initialProfile={updatedProfile} />);

    expect(screen.getByLabelText(/টাইমজোন \(IANA Timezone\)/i)).toHaveValue('America/New_York');
    expect(screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i)).toHaveValue(4);
  });

  it('renders field-level validation errors for invalid timezone or non-0.5-multiple daily hours and clears alert on edit', async () => {
    vi.mocked(updateLearningSettingsAction).mockResolvedValueOnce({
      error: 'Preferred daily hours must be between 0.5 and 12 in 0.5-hour increments.',
      code: 'VALIDATION_FAILED',
      fieldErrors: {
        timezone: 'Please enter a valid IANA timezone (e.g. Asia/Dhaka, UTC).',
        preferred_daily_hours:
          'Preferred daily hours must be between 0.5 and 12 in 0.5-hour increments.',
      },
      values: {
        timezone: 'Invalid/Zone',
        preferred_daily_hours: '1.3',
      },
    });

    render(<LearningSettingsForm initialProfile={MOCK_PROFILE} />);

    const submitBtn = screen.getByRole('button', {
      name: /সেটিংস সংরক্ষণ করুন/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Please enter a valid IANA timezone/i),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText(
          /Preferred daily hours must be between 0\.5 and 12 in 0\.5-hour increments/i,
        ).length,
      ).toBeGreaterThanOrEqual(1);
    });

    const hoursInput = screen.getByLabelText(/দৈনিক অধ্যয়নের সময়/i);
    fireEvent.change(hoursInput, { target: { value: '2.0' } });

    expect(
      screen.queryByText(/Please enter a valid IANA timezone/i),
    ).not.toBeInTheDocument();
  });
});
