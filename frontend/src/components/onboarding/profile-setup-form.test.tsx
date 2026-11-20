import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProfileSetupForm } from '@/components/onboarding/profile-setup-form';
import type { ProfileResponse } from '@/lib/api/client';
import { saveProfileSetupAction } from '@/lib/profile/actions';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}));

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

const EMAIL_CONTACT = {
  email: 'alice@example.com',
  emailVerified: true,
  phone: '',
  phoneVerified: false,
};

const PHONE_CONTACT = {
  email: '',
  emailVerified: false,
  phone: '+8801712345678',
  phoneVerified: true,
};

function fillValidFields({
  fullName = 'Alice Rahman',
  role = 'Frontend Developer',
  level = 'mid',
}: {
  fullName?: string;
  role?: string;
  level?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText(/full name/i), {
    target: { value: fullName },
  });
  fireEvent.change(screen.getByLabelText(/current role \/ profession/i), {
    target: { value: role },
  });
  fireEvent.change(screen.getByLabelText(/experience level/i), {
    target: { value: level },
  });
}

describe('ProfileSetupForm (Screen 07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders modern 5-step header, Education above 2x2 grid, hidden auto-detected timezone, redesigned Complete Beginner switch, and clean footer without M05 note', () => {
    const { container } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
      />,
    );

    const progressbar = screen.getByRole('progressbar', {
      name: /step 1 of 5/i,
    });
    expect(progressbar.parentElement).toHaveClass('px-6', 'py-5');
    expect(progressbar).toHaveAttribute('aria-valuenow', '1');
    expect(progressbar).toHaveAttribute('aria-valuemin', '1');
    expect(progressbar).toHaveAttribute('aria-valuemax', '5');
    expect(screen.getByText('Profile Setup')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
    expect(screen.getByText('20% Complete')).toBeInTheDocument();
    expect(screen.getByText('1. Profile')).toHaveClass('mt-2.5');
    expect(screen.getByText('2. Skills')).toHaveClass('mt-2.5');
    expect(screen.getByText('3. Preferences')).toBeInTheDocument();
    expect(screen.getByText('4. Career Goal')).toBeInTheDocument();
    expect(screen.getByText('5. Confirm Role')).toBeInTheDocument();

    const fullNameInput = screen.getByLabelText(/full name/i);
    expect(fullNameInput).toBeRequired();
    expect(fullNameInput).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText('Min 2 – Max 100 characters'),
    ).not.toBeInTheDocument();

    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText(/verified primary email/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/optional secondary email/i),
    ).not.toBeInTheDocument();

    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText(/optional bangladesh mobile/i),
    ).not.toBeInTheDocument();

    const educationInput = screen.getByLabelText(/education \(optional\)/i);
    expect(educationInput).not.toBeRequired();
    expect(educationInput).not.toHaveAttribute('aria-describedby');
    expect(educationInput).toHaveValue('');
    expect(screen.queryByText('Max 200 characters')).not.toBeInTheDocument();

    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    expect(roleInput).toBeRequired();
    expect(roleInput).not.toHaveAttribute('aria-describedby');
    expect(roleInput).toHaveValue('');
    expect(
      screen.queryByText('Min 2 – Max 120 characters'),
    ).not.toBeInTheDocument();

    // Education appears BEFORE Current Role / Profession in DOM order
    expect(
      educationInput.compareDocumentPosition(roleInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const levelSelect = screen.getByLabelText(/experience level/i);
    expect(levelSelect).toBeRequired();
    expect(levelSelect).toHaveValue('');
    expect(levelSelect).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText('Choose Beginner if you are starting from scratch.'),
    ).not.toBeInTheDocument();
    expect(levelSelect).toHaveClass('appearance-none', 'pr-10', 'truncate');
    const selectWrapper = levelSelect.closest('.group.relative');
    expect(selectWrapper).not.toBeNull();
    expect(selectWrapper?.querySelector('svg')).not.toBeNull();

    // Visible Timezone input is removed; auto-detected hidden input carries timezone
    expect(
      screen.queryByRole('textbox', { name: /timezone/i }),
    ).not.toBeInTheDocument();
    const hiddenTz = container.querySelector(
      'input[type="hidden"][name="timezone"]',
    ) as HTMLInputElement;
    expect(hiddenTz).not.toBeNull();
    expect(hiddenTz.value).toBeTruthy();

    expect(
      screen.queryByLabelText(/preferred daily hours/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Skill Baseline')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: /complete beginner/i }),
    ).not.toBeInTheDocument();

    // 2 core controls sit inside the md:grid-cols-2 grid
    const coreGrid = container.querySelector('.md\\:grid-cols-2');
    expect(coreGrid).not.toBeNull();
    expect(coreGrid).toContainElement(roleInput);
    expect(coreGrid).toContainElement(levelSelect);
    expect(coreGrid).not.toContainElement(educationInput);

    const dashboardLink = screen.getByRole('link', { name: /go to dashboard/i });
    expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    expect(dashboardLink).toHaveClass(
      'border',
      'border-slate-300',
      'rounded-lg',
    );

    expect(
      screen.queryByRole('button', { name: /next: skills/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /next: skills/i }),
    ).not.toBeInTheDocument();
    const saveAndNextButton = screen.getByRole('button', {
      name: /save & next/i,
    });
    expect(saveAndNextButton).toBeDisabled();
    expect(saveAndNextButton).toHaveAttribute('type', 'submit');

    expect(screen.queryByText(/milestone m05/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/you can visit your dashboard anytime/i),
    ).not.toBeInTheDocument();
  });

  it('validates Full Name on submit, clears error on change, and collapses extra whitespace on valid blur', async () => {
    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
      />,
    );

    const fullNameInput = screen.getByLabelText(/full name/i);
    const submitBtn = screen.getByRole('button', { name: /save & next/i });

    fireEvent.change(screen.getByLabelText(/current role \/ profession/i), {
      target: { value: 'Frontend Engineer' },
    });
    fireEvent.change(screen.getByLabelText(/experience level/i), {
      target: { value: 'junior' },
    });

    // Empty Full Name keeps Save & Next disabled; programmatic submit still blocks with inline error
    expect(submitBtn).toBeDisabled();
    await act(async () => {
      fireEvent.submit(fullNameInput.closest('form')!);
    });
    expect(saveProfileSetupAction).not.toHaveBeenCalled();
    expect(fullNameInput).toHaveAttribute('aria-invalid', 'true');
    expect(fullNameInput).toHaveAttribute('aria-describedby', 'full_name-error');
    expect(screen.getByText('Enter your full name.')).toBeInTheDocument();

    // Editing clears existing error immediately without triggering new error on keystroke/blur
    fireEvent.change(fullNameInput, { target: { value: 'A' } });
    expect(submitBtn).toBeEnabled();
    expect(screen.queryByText('Enter your full name.')).not.toBeInTheDocument();
    fireEvent.blur(fullNameInput);
    expect(
      screen.queryByText('Full name must be at least 2 characters.'),
    ).not.toBeInTheDocument();

    // Too short on submit
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(
      screen.getByText('Full name must be at least 2 characters.'),
    ).toBeInTheDocument();

    // Digit-only -> cleared on change, shown on submit
    fireEvent.change(fullNameInput, { target: { value: '12345' } });
    expect(
      screen.queryByText('Full name must be at least 2 characters.'),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(
      screen.getByText('Full name cannot contain only digits.'),
    ).toBeInTheDocument();

    // Valid name collapses extra internal whitespace on blur and clears error
    fireEvent.change(fullNameInput, { target: { value: '  Alice   Rahman  ' } });
    expect(
      screen.queryByText('Full name cannot contain only digits.'),
    ).not.toBeInTheDocument();
    fireEvent.blur(fullNameInput);
    expect(fullNameInput).toHaveValue('Alice Rahman');
    expect(fullNameInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(fullNameInput).not.toHaveAttribute('aria-describedby');
  });

  it('auto-prefills Verified readOnly Email for email-signup users and validates optional Phone on submit', async () => {
    const { container } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
      />,
    );

    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput).toHaveValue('alice@example.com');
    expect(emailInput).toHaveAttribute('placeholder', 'Enter your email');
    expect(emailInput).toHaveAttribute('readonly');
    expect(screen.getByText('Verified')).toBeInTheDocument();

    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).not.toHaveAttribute('readonly');
    expect(phoneInput).toHaveAttribute('placeholder', '01XXXXXXXXX');
    expect(screen.getByText('+88')).toBeInTheDocument();

    // Invalid BD prefix does not error while typing before submit
    fillValidFields();
    fireEvent.change(phoneInput, { target: { value: '01234' } });
    expect(
      screen.queryByText(/enter a valid bangladesh mobile number/i),
    ).not.toBeInTheDocument();

    // Submitting displays phone validation error
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });
    expect(
      screen.getByText(/enter a valid bangladesh mobile number/i),
    ).toBeInTheDocument();

    // Editing phone clears error immediately and keeps canonical +8801XXXXXXXXX in hidden input
    fireEvent.change(phoneInput, { target: { value: '01712345678' } });
    expect(
      screen.queryByText(/enter a valid bangladesh mobile number/i),
    ).not.toBeInTheDocument();
    expect(phoneInput).not.toHaveAttribute('aria-invalid', 'true');
    const hiddenPhone = container.querySelector(
      'input[type="hidden"][name="phone"]',
    ) as HTMLInputElement;
    expect(hiddenPhone.value).toBe('+8801712345678');
  });

  it('auto-prefills Verified readOnly Phone (+88 + 01XXXXXXXXX) for phone-signup users and validates optional Email on submit', async () => {
    const { container } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={PHONE_CONTACT}
      />,
    );

    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).toHaveValue('01712345678');
    expect(phoneInput).toHaveAttribute('readonly');
    const bdPrefix = screen.getByText('+88').parentElement;
    expect(bdPrefix).toHaveClass(
      'self-stretch',
      'bg-slate-200/75',
      'border-slate-300/90',
      'text-slate-700',
      'font-semibold',
    );
    expect(bdPrefix?.className).not.toMatch(/rounded-l-/);
    expect(bdPrefix?.parentElement).toHaveClass(
      'overflow-hidden',
      'p-0',
      'rounded-md',
      'min-h-11',
    );
    expect(screen.getByText('Verified')).toBeInTheDocument();

    const hiddenPhone = container.querySelector(
      'input[type="hidden"][name="phone"]',
    ) as HTMLInputElement;
    expect(hiddenPhone.value).toBe('+8801712345678');

    const emailInput = screen.getByLabelText(/email address/i);
    expect(emailInput).not.toHaveAttribute('readonly');
    expect(emailInput).toHaveAttribute('placeholder', 'Enter your email');
    fillValidFields();
    fireEvent.change(emailInput, { target: { value: 'not-valid' } });
    fireEvent.blur(emailInput);
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: '  Alt@Example.COM ' } });
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
    fireEvent.blur(emailInput);
    expect(emailInput).toHaveValue('alt@example.com');
    expect(emailInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects >200 char education on submit (clearing on change) and falls back hidden timezone to Asia/Dhaka on invalid browser tz', async () => {
    const tzSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({
        timeZone: 'Invalid/Zone',
      } as Intl.ResolvedDateTimeFormatOptions);

    try {
      const { container } = render(
        <ProfileSetupForm
          initialProfile={{ ...EMPTY_PROFILE, timezone: null }}
          initialContact={EMAIL_CONTACT}
        />,
      );

      const hiddenTz = container.querySelector(
        'input[type="hidden"][name="timezone"]',
      ) as HTMLInputElement;
      expect(hiddenTz.value).toBe('Asia/Dhaka');

      fillValidFields();

      const educationInput = screen.getByLabelText(/education \(optional\)/i);

      fireEvent.change(educationInput, { target: { value: 'x'.repeat(201) } });
      fireEvent.blur(educationInput);
      expect(
        screen.queryByText('Education must be 200 characters or fewer.'),
      ).not.toBeInTheDocument();

      const submitBtn = screen.getByRole('button', { name: /save & next/i });
      await act(async () => {
        fireEvent.click(submitBtn);
      });
      expect(saveProfileSetupAction).not.toHaveBeenCalled();
      expect(
        screen.getByText('Education must be 200 characters or fewer.'),
      ).toBeInTheDocument();

      // Editing clears error immediately
      fireEvent.change(educationInput, { target: { value: 'BSc' } });
      expect(
        screen.queryByText('Education must be 200 characters or fewer.'),
      ).not.toBeInTheDocument();
    } finally {
      tzSpy.mockRestore();
    }
  });

  it('populates stored profile values and preserves hidden daily hours', () => {
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

    const { container } = render(
      <ProfileSetupForm
        initialProfile={storedProfile}
        initialContact={EMAIL_CONTACT}
        initialFullName="Alice Rahman"
      />,
    );

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Rahman');
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Frontend Developer',
    );
    expect(screen.getByLabelText(/education \(optional\)/i)).toHaveValue(
      'BSc in CSE',
    );
    expect(screen.getByLabelText(/experience level/i)).toHaveValue('junior');
    const hiddenTz = container.querySelector(
      'input[type="hidden"][name="timezone"]',
    ) as HTMLInputElement;
    expect(hiddenTz.value).toBe('Asia/Dhaka');
    const hiddenHours = container.querySelector(
      'input[name="preferred_daily_hours"]',
    );
    expect(hiddenHours).toBeNull();
    expect(
      screen.queryByLabelText(/preferred daily hours/i),
    ).not.toBeInTheDocument();
  });

  it('never overwrites verified email or phone from server props with empty/stale draft values', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-verified-prec',
      JSON.stringify({
        user_id: 'user-verified-prec',
        values: {
          full_name: 'Alice Updated Draft',
          email: '',
          phone: '',
          current_role: 'Cloud Engineer',
          education: '',
          experience_level: 'mid',
          existing_skills_none: false,
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: '2',
        },
      }),
    );

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: 'verified@example.com',
          emailVerified: true,
          phone: '+8801712345678',
          phoneVerified: true,
        }}
        userId="user-verified-prec"
      />,
    );

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Alice Updated Draft');
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('Cloud Engineer');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('verified@example.com');
    expect(screen.getByLabelText(/phone number/i)).toHaveValue('01712345678');
  });

  it('persists unsaved draft in sessionStorage on field edits', () => {
    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
        userId="user-draft"
      />,
    );

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'CS Student Name' },
    });
    fireEvent.change(screen.getByLabelText(/current role \/ profession/i), {
      target: { value: 'CS Student' },
    });
    fireEvent.change(screen.getByLabelText(/experience level/i), {
      target: { value: 'beginner' },
    });

    const rawDraft = window.sessionStorage.getItem(
      'mentor_onboarding_profile_draft:user-draft',
    );
    expect(rawDraft).not.toBeNull();
    const parsedDraft = JSON.parse(rawDraft!);
    expect(parsedDraft.full_name).toBe('CS Student Name');
    expect(parsedDraft.current_role).toBe('CS Student');
    expect(parsedDraft.experience_level).toBe('beginner');
  });

  it('preserves user draft and renders warning alert when initial GET /profile fails', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft',
      JSON.stringify({
        full_name: 'Self Learner',
        current_role: 'Self-Taught Learner',
        education: '',
        experience_level: 'beginner',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '1.5',
      }),
    );

    render(
      <ProfileSetupForm
        initialProfile={null}
        initialContact={EMAIL_CONTACT}
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
            full_name: 'Cloud User',
            current_role: 'Cloud Architect',
            education: 'MSc in CS',
            experience_level: 'senior',
            existing_skills_none: false,
            timezone: '',
            preferred_daily_hours: '3',
          },
        }),
      );

      const { container } = render(
        <ProfileSetupForm
          initialProfile={{ ...EMPTY_PROFILE, timezone: null }}
          initialContact={EMAIL_CONTACT}
          userId="user-42"
        />,
      );

      expect(screen.getByRole('status')).toHaveTextContent(/draft restored/i);
      expect(screen.getByLabelText(/full name/i)).toHaveValue('Cloud User');
      expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
        'Cloud Architect',
      );
      expect(screen.getByLabelText(/education \(optional\)/i)).toHaveValue(
        'MSc in CS',
      );
      expect(screen.getByLabelText(/experience level/i)).toHaveValue('senior');
      const hiddenTz = container.querySelector(
        'input[type="hidden"][name="timezone"]',
      ) as HTMLInputElement;
      expect(hiddenTz.value).toBe('Europe/London');
    } finally {
      tzSpy.mockRestore();
    }
  });

  it('dismisses server error alert banner immediately on focus and edit, and re-shows on subsequent failure', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      error: 'Validation failed. Please correct the highlighted errors.',
      fieldErrors: {
        current_role: 'Server rejected role.',
      },
    });

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
      />,
    );

    fillValidFields();

    const submitBtn = screen.getByRole('button', { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/validation failed/i);
    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    expect(roleInput).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Server rejected role.')).toBeInTheDocument();

    // Focus any field immediately dismisses server alert banner
    const fullNameInput = screen.getByLabelText(/full name/i);
    fireEvent.focus(fullNameInput);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Edit the errored field clears its server field error & aria-invalid
    fireEvent.change(roleInput, { target: { value: 'Staff Engineer' } });
    expect(roleInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Server rejected role.')).not.toBeInTheDocument();

    // Next submission failure re-shows alert banner
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      error: 'Another server error occurred.',
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /another server error occurred/i,
    );
  });

  it('disables submit button while submission is in flight (double-submit guard)', async () => {
    let resolveSubmit!: (val: { success: boolean; message: string }) => void;
    vi.mocked(saveProfileSetupAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
      />,
    );
    fillValidFields();

    const submitBtn = screen.getByRole('button', { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByRole('button', { name: /saving profile/i })).toBeDisabled();

    await act(async () => {
      resolveSubmit({ success: true, message: 'Profile saved successfully.' });
    });

    expect(screen.getByRole('button', { name: /save & next/i })).not.toBeDisabled();
    expect(mockPush).toHaveBeenCalledWith('/onboarding');
  });

  it('rejects and clears a sessionStorage draft belonging to a different user_id (account isolation)', () => {
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-B',
      JSON.stringify({
        user_id: 'user-A',
        values: {
          full_name: 'Account A Name',
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
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
        userId="user-B"
      />,
    );

    expect(screen.getByLabelText(/full name/i)).toHaveValue('');
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft:user-B'),
    ).toBeNull();
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft'),
    ).toBeNull();
  });

  it('cleans up malformed JSON in legacy or scoped draft keys without throwing', () => {
    window.sessionStorage.setItem('mentor_onboarding_profile_draft', '{ bad');
    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-corrupt',
      '{ corrupt json',
    );

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
        userId="user-corrupt"
      />,
    );

    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('');
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft'),
    ).toBeNull();
    expect(
      window.sessionStorage.getItem('mentor_onboarding_profile_draft:user-corrupt'),
    ).toBeNull();
  });

  it('auto-detects browser timezone in hidden input even when loadError is present and initialProfile is null', () => {
    const tzSpy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({
        timeZone: 'Asia/Tokyo',
      } as Intl.ResolvedDateTimeFormatOptions);

    try {
      const { container } = render(
        <ProfileSetupForm
          initialProfile={null}
          initialContact={EMAIL_CONTACT}
          loadError="Unable to reach the server. Please enter your details below."
          userId="user-load-err"
        />,
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        /unable to reach the server/i,
      );
      const hiddenTz = container.querySelector(
        'input[type="hidden"][name="timezone"]',
      ) as HTMLInputElement;
      expect(hiddenTz.value).toBe('Asia/Tokyo');
      const hiddenHours = container.querySelector(
        'input[name="preferred_daily_hours"]',
      );
      expect(hiddenHours).toBeNull();
    } finally {
      tzSpy.mockRestore();
    }
  });

  it('persists new draft in sessionStorage when editing or toggling beginner None after a successful save', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'Profile saved successfully.',
      values: {
        full_name: 'Alice Rahman',
        email: 'alice@example.com',
        phone: '',
        current_role: 'Full Stack Engineer',
        education: 'BSc in CSE',
        experience_level: 'beginner',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
        userId="user-edit-after-save"
      />,
    );

    fillValidFields({ role: 'Full Stack Engineer', level: 'beginner' });

    const submitBtn = screen.getByRole('button', { name: /save & next/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Profile saved.');
    const toastContainer = toast.closest('.fixed');
    expect(toastContainer).toBeInTheDocument();
    expect(toastContainer).toHaveClass('top-4', 'left-1/2', '-translate-x-1/2');
    expect(
      window.sessionStorage.getItem(
        'mentor_onboarding_profile_draft:user-edit-after-save',
      ),
    ).toBeNull();

    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    fireEvent.change(roleInput, { target: { value: 'Lead Architect' } });

    expect(
      screen.queryByText('Profile saved.'),
    ).not.toBeInTheDocument();

    const savedDraft = window.sessionStorage.getItem(
      'mentor_onboarding_profile_draft:user-edit-after-save',
    );
    expect(savedDraft).not.toBeNull();
    expect(JSON.parse(savedDraft!).values.current_role).toBe('Lead Architect');

    // Subsequent save succeeds -> success message re-appears; beginner switch dismisses it
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'Profile saved successfully.',
      values: {
        full_name: 'Alice Rahman',
        email: 'alice@example.com',
        phone: '',
        current_role: 'Lead Architect',
        education: 'BSc in CSE',
        experience_level: 'beginner',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(screen.getByText('Profile saved.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/experience level/i), {
      target: { value: 'junior' },
    });
    expect(
      screen.queryByText('Profile saved.'),
    ).not.toBeInTheDocument();
  });

  it('reconciles controlled form inputs with state.values upon successful save and cleared education', async () => {
    const profileWithEducation: ProfileResponse = {
      ...EMPTY_PROFILE,
      current_role: 'Full Stack Engineer',
      education: 'BSc in CSE',
      experience_level: 'mid',
      preferred_daily_hours: 2,
    };

    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'Profile saved successfully.',
      profile: {
        ...profileWithEducation,
        education: null,
      },
      values: {
        full_name: 'Senior Alice',
        email: 'alice@example.com',
        phone: '+8801712345678',
        current_role: 'Senior Staff Engineer',
        education: '',
        experience_level: 'senior',
        existing_skills_none: false,
        timezone: 'UTC',
        preferred_daily_hours: '4',
      },
    });

    const { container } = render(
      <ProfileSetupForm
        initialProfile={profileWithEducation}
        initialContact={EMAIL_CONTACT}
        initialFullName="Alice"
        userId="user-reconcile"
      />,
    );

    const educationInput = screen.getByLabelText(/education \(optional\)/i);
    expect(educationInput).toHaveValue('BSc in CSE');
    fireEvent.change(educationInput, { target: { value: '' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });

    expect(screen.getByLabelText(/full name/i)).toHaveValue('Senior Alice');
    expect(screen.getByLabelText(/phone number/i)).toHaveValue('01712345678');
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Senior Staff Engineer',
    );
    expect(educationInput).toHaveValue('');
    expect(screen.getByLabelText(/experience level/i)).toHaveValue('senior');
    const hiddenTz = container.querySelector(
      'input[type="hidden"][name="timezone"]',
    ) as HTMLInputElement;
    expect(hiddenTz.value).toBe('UTC');
  });

  it('preserves education_touched across reload without overwriting server education from an untouched blank draft', () => {
    const profileWithEducation: ProfileResponse = {
      ...EMPTY_PROFILE,
      current_role: 'Backend Engineer',
      education: 'BSc in Software Engineering',
      experience_level: 'beginner',
      existing_skills_none: false,
    };

    window.sessionStorage.setItem(
      'mentor_onboarding_profile_draft:user-edu-touched',
      JSON.stringify({
        user_id: 'user-edu-touched',
        education_touched: false,
        values: {
          full_name: 'Backend Alice',
          current_role: 'Senior Backend Engineer',
          education: '',
          experience_level: 'beginner',
          existing_skills_none: false,
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: '2.5',
        },
      }),
    );

    const { container, unmount } = render(
      <ProfileSetupForm
        initialProfile={profileWithEducation}
        initialContact={EMAIL_CONTACT}
        userId="user-edu-touched"
      />,
    );

    const educationInput = screen.getByLabelText(/education \(optional\)/i);
    const getEduTouched = (root: HTMLElement) =>
      root.querySelector('input[name="education_touched"]') as HTMLInputElement;

    expect(educationInput).toHaveValue('BSc in Software Engineering');
    expect(getEduTouched(container)).toHaveValue('false');

    // Explicit clear marks education_touched = true and persists across remount
    fireEvent.change(educationInput, { target: { value: '' } });
    expect(getEduTouched(container)).toHaveValue('true');

    unmount();

    const { container: remountContainer } = render(
      <ProfileSetupForm
        initialProfile={profileWithEducation}
        initialContact={EMAIL_CONTACT}
        userId="user-edu-touched"
      />,
    );

    expect(
      screen.getByLabelText(/education \(optional\)/i),
    ).toHaveValue('');
    expect(getEduTouched(remountContainer)).toHaveValue('true');
  });

  it('requires at least one contact when neither email nor phone is verified', async () => {
    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: '',
          emailVerified: false,
          phone: '',
          phoneVerified: false,
        }}
      />,
    );

    fillValidFields();
    const submitBtn = screen.getByRole('button', { name: /save & next/i });
    expect(submitBtn).toBeDisabled();

    await act(async () => {
      fireEvent.submit(submitBtn.closest('form')!);
    });

    expect(saveProfileSetupAction).not.toHaveBeenCalled();
    expect(
      screen.getByText('Enter a valid email address or phone number.'),
    ).toBeInTheDocument();

    // Entering a valid phone clears the missing-contact error and enables Save & Next
    const phoneInput = screen.getByLabelText(/phone number/i);
    fireEvent.change(phoneInput, { target: { value: '01712345678' } });
    expect(submitBtn).toBeEnabled();
    expect(
      screen.queryByText('Enter a valid email address or phone number.'),
    ).not.toBeInTheDocument();
  });

  it('resets form values and clears errors cleanly when userId prop changes', () => {
    const { rerender } = render(
      <ProfileSetupForm
        initialProfile={{ ...EMPTY_PROFILE, current_role: 'User A Role' }}
        initialContact={{
          email: 'a@example.com',
          emailVerified: true,
          phone: '',
          phoneVerified: false,
        }}
        initialFullName="User A"
        userId="user-A"
      />,
    );

    expect(screen.getByLabelText(/full name/i)).toHaveValue('User A');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('a@example.com');

    rerender(
      <ProfileSetupForm
        initialProfile={{ ...EMPTY_PROFILE, current_role: 'User B Role' }}
        initialContact={{
          email: '',
          emailVerified: false,
          phone: '+8801712345678',
          phoneVerified: true,
        }}
        initialFullName="User B"
        userId="user-B"
      />,
    );

    expect(screen.getByLabelText(/full name/i)).toHaveValue('User B');
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('User B Role');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    expect(screen.getByLabelText(/phone number/i)).toHaveValue('01712345678');
  });

  it('preserves explicit empty string in draft for cleared unverified phone and email across remount', () => {
    const emailPrimaryWithPhoneContact = {
      email: 'alice@example.com',
      emailVerified: true,
      phone: '+8801712345678',
      phoneVerified: false,
    };

    const { unmount } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={emailPrimaryWithPhoneContact}
        initialFullName="Alice"
        userId="user-clear-phone"
      />,
    );

    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(phoneInput).toHaveValue('01712345678');
    fireEvent.change(phoneInput, { target: { value: '' } });
    expect(phoneInput).toHaveValue('');

    unmount();

    const { unmount: unmountRemount } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={emailPrimaryWithPhoneContact}
        initialFullName="Alice"
        userId="user-clear-phone"
      />,
    );

    expect(screen.getByLabelText(/phone number/i)).toHaveValue('');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('alice@example.com');
    unmountRemount();

    // Also verify clearing an unverified secondary email stays empty across remount
    const phonePrimaryWithEmailContact = {
      email: 'secondary@example.com',
      emailVerified: false,
      phone: '+8801812345678',
      phoneVerified: true,
    };

    const secondMount = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={phonePrimaryWithEmailContact}
        initialFullName="Bob"
        userId="user-clear-email"
      />,
    );

    const emailInput = secondMount.getByLabelText(/email address/i);
    expect(emailInput).toHaveValue('secondary@example.com');
    fireEvent.change(emailInput, { target: { value: '' } });
    secondMount.unmount();

    const thirdMount = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={phonePrimaryWithEmailContact}
        initialFullName="Bob"
        userId="user-clear-email"
      />,
    );
    expect(thirdMount.getByLabelText(/email address/i)).toHaveValue('');
    expect(thirdMount.getByLabelText(/phone number/i)).toHaveValue('01812345678');
  });

  it('processes each successful save result once so later prop updates do not wipe unsaved edits', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'Profile saved successfully.',
      profile: {
        ...EMPTY_PROFILE,
        current_role: 'Saved Role',
      },
      values: {
        full_name: 'Saved Alice',
        email: 'alice@example.com',
        phone: '',
        current_role: 'Saved Role',
        education: 'BSc',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    const { rerender } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={EMAIL_CONTACT}
        initialFullName="Alice"
        userId="user-reconcile-once"
      />,
    );

    fillValidFields({ fullName: 'Saved Alice', role: 'Saved Role' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });
    expect(screen.getByText('Profile saved.')).toBeInTheDocument();

    // User makes subsequent unsaved edits
    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    const fullNameInput = screen.getByLabelText(/full name/i);
    fireEvent.change(roleInput, { target: { value: 'Unsaved Staff Role' } });
    fireEvent.change(fullNameInput, { target: { value: 'Unsaved Alice Edit' } });

    const draftKey = 'mentor_onboarding_profile_draft:user-reconcile-once';
    expect(window.sessionStorage.getItem(draftKey)).not.toBeNull();

    // Later prop update arrives without a new action submission
    rerender(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          ...EMAIL_CONTACT,
          phone: '+8801712345678',
          phoneVerified: true,
        }}
        initialFullName="Alice Server Refresh"
        userId="user-reconcile-once"
      />,
    );

    // Unsaved edits and session draft survive; newly verified contact updates cleanly
    expect(roleInput).toHaveValue('Unsaved Staff Role');
    expect(fullNameInput).toHaveValue('Unsaved Alice Edit');
    expect(screen.getByLabelText(/phone number/i)).toHaveValue('01712345678');
    expect(window.sessionStorage.getItem(draftKey)).not.toBeNull();
  });

  it('resets previous user saved useActionState and stored skills when userId changes', async () => {
    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      message: 'User A saved.',
      profile: {
        ...EMPTY_PROFILE,
        current_role: 'User A Saved Role',
        existing_skills: [
          {
            skill_id: 'skill-a',
            name: 'GoLang',
            alias_resolved: true,
            learning_state: 'learning',
            source: 'self_reported',
          },
        ],
      },
      values: {
        full_name: 'User A Saved',
        email: 'a@example.com',
        phone: '',
        current_role: 'User A Saved Role',
        education: '',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2',
      },
    });

    const { rerender } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: 'a@example.com',
          emailVerified: true,
          phone: '',
          phoneVerified: false,
        }}
        initialFullName="User A"
        userId="user-key-A"
      />,
    );

    fillValidFields({ fullName: 'User A Saved', role: 'User A Saved Role' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });
    expect(screen.getByText('Profile saved.')).toBeInTheDocument();

    // Switching userId unmounts User A's keyed inner form, discarding prior useActionState
    rerender(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: 'b@example.com',
          emailVerified: true,
          phone: '',
          phoneVerified: false,
        }}
        initialFullName="User B"
        userId="user-key-B"
      />,
    );

    expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('User B');
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue('');
    expect(screen.getByLabelText(/email address/i)).toHaveValue('b@example.com');
  });

  it('auto-dismisses the Profile saved toast after timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
        success: true,
        message: 'Profile saved successfully.',
      });

      render(
        <ProfileSetupForm
          initialProfile={EMPTY_PROFILE}
          initialContact={EMAIL_CONTACT}
        />,
      );
      fillValidFields();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
      });

      expect(screen.getByText('Profile saved.')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clear a newer User A draft when an unmounted deferred save resolves', async () => {
    let resolveDeferredSave!: (value: {
      success?: boolean;
      message?: string;
    }) => void;
    vi.mocked(saveProfileSetupAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDeferredSave = resolve;
        }),
    );

    const { rerender } = render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: 'a@example.com',
          emailVerified: true,
          phone: '',
          phoneVerified: false,
        }}
        userId="user-A"
      />,
    );

    fillValidFields({ fullName: 'User A Original', role: 'Backend Dev' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save & next/i }));
    });
    expect(saveProfileSetupAction).toHaveBeenCalledTimes(1);

    // Unmount User A by switching to User B before deferred save completes
    rerender(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: 'b@example.com',
          emailVerified: true,
          phone: '',
          phoneVerified: false,
        }}
        userId="user-B"
      />,
    );

    // Remount User A and create a newer draft edit
    rerender(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{
          email: 'a@example.com',
          emailVerified: true,
          phone: '',
          phoneVerified: false,
        }}
        userId="user-A"
      />,
    );

    fireEvent.change(screen.getByLabelText(/current role \/ profession/i), {
      target: { value: 'Staff Systems Architect' },
    });

    const draftKey = 'mentor_onboarding_profile_draft:user-A';
    expect(
      JSON.parse(window.sessionStorage.getItem(draftKey)!).values.current_role,
    ).toBe('Staff Systems Architect');

    // Original unmounted save resolves -> must NOT wipe User A's newer draft or state
    await act(async () => {
      resolveDeferredSave({
        success: true,
        message: 'Profile saved successfully.',
      });
    });

    const preserved = window.sessionStorage.getItem(draftKey);
    expect(preserved).not.toBeNull();
    expect(JSON.parse(preserved!).values.current_role).toBe(
      'Staff Systems Architect',
    );
    expect(screen.getByLabelText(/current role \/ profession/i)).toHaveValue(
      'Staff Systems Architect',
    );
    expect(screen.queryByText('Profile saved.')).not.toBeInTheDocument();
  });

  it('preserves existing_skills_none=true for returning beginners after editing full name without sending preferred_daily_hours', async () => {
    const beginnerProfile: ProfileResponse = {
      ...EMPTY_PROFILE,
      current_role: 'Student',
      experience_level: 'beginner',
      existing_skills: [],
      existing_skills_none: true,
      preferred_daily_hours: 6,
    };
    const onSuccess = vi.fn();
    let submittedFormData: FormData | null = null;
    vi.mocked(saveProfileSetupAction).mockImplementationOnce(
      async (_prev, formData) => {
        submittedFormData = formData;
        return {
          success: true,
          message: 'Profile saved successfully.',
          profile: beginnerProfile,
          values: {
            full_name: 'Alice Updated',
            email: 'alice@example.com',
            phone: '',
            current_role: 'Student',
            education: '',
            experience_level: 'beginner',
            existing_skills_none: true,
            timezone: 'Asia/Dhaka',
            preferred_daily_hours: '6',
          },
        };
      },
    );

    render(
      <ProfileSetupForm
        mode="standalone"
        initialProfile={beginnerProfile}
        initialContact={EMAIL_CONTACT}
        initialFullName="Alice"
        userId="beginner-user"
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: 'Alice Updated' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });

    expect(submittedFormData).not.toBeNull();
    expect(submittedFormData!.get('preferred_daily_hours')).toBeNull();
    expect(submittedFormData!.get('existing_skills_none')).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ existing_skills_none: true }),
        values: expect.objectContaining({ existing_skills_none: true }),
      }),
    );
  });

  it('updates dirty baseline ONLY for server-committed fields on partial save error while preserving user inputs for retry', async () => {
    const initialProfile: ProfileResponse = {
      ...EMPTY_PROFILE,
      current_role: 'Junior Dev',
      experience_level: 'junior',
    };
    const committedProfile: ProfileResponse = {
      ...initialProfile,
      current_role: 'Senior Dev',
      experience_level: 'senior',
    };

    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      error:
        'Your role and study schedule were saved, but we could not save your name or contact details. Please try again.',
      retryable: true,
      profile: committedProfile,
      values: {
        full_name: 'Alice New Name',
        email: 'alice@example.com',
        phone: '',
        current_role: 'Senior Dev',
        education: '',
        experience_level: 'senior',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '',
      },
    });

    render(
      <ProfileSetupForm
        mode="standalone"
        initialProfile={initialProfile}
        initialContact={EMAIL_CONTACT}
        initialFullName="Alice Old"
        userId="partial-user"
      />,
    );

    const nameInput = screen.getByLabelText(/full name/i);
    const roleInput = screen.getByLabelText(/current role \/ profession/i);
    const levelSelect = screen.getByLabelText(/experience level/i);
    const saveBtn = screen.getByRole('button', { name: /save changes/i });

    expect(saveBtn).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: 'Alice New Name' } });
    fireEvent.change(roleInput, { target: { value: 'Senior Dev' } });
    fireEvent.change(levelSelect, { target: { value: 'senior' } });
    expect(saveBtn).toBeEnabled();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // Error alert shown, all user inputs preserved, and Save Changes remains enabled to retry failed metadata write
    expect(screen.getByRole('alert')).toHaveTextContent(/could not save your name/i);
    expect(nameInput).toHaveValue('Alice New Name');
    expect(roleInput).toHaveValue('Senior Dev');
    expect(saveBtn).toBeEnabled();

    // Even if full_name is reverted, Save Changes stays enabled until the metadata retry succeeds
    fireEvent.change(nameInput, { target: { value: 'Alice Old' } });
    expect(saveBtn).toBeEnabled();

    vi.mocked(saveProfileSetupAction).mockResolvedValueOnce({
      success: true,
      profile: committedProfile,
      values: {
        full_name: 'Alice Old',
        email: 'alice@example.com',
        phone: '',
        current_role: 'Senior Dev',
        education: '',
        experience_level: 'senior',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '',
      },
    });
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(saveBtn).toBeDisabled();
  });

  it('shows a visible helper note when both email and phone are blank without marking both inputs required', () => {
    render(
      <ProfileSetupForm
        initialProfile={EMPTY_PROFILE}
        initialContact={{ email: '', emailVerified: false, phone: '', phoneVerified: false }}
        userId="no-contact-user"
      />,
    );

    const emailInput = screen.getByLabelText(/email address/i);
    const phoneInput = screen.getByLabelText(/phone number/i);
    expect(emailInput).not.toBeRequired();
    expect(phoneInput).not.toBeRequired();
    expect(
      screen.getByText('Provide at least one contact method (email or phone).'),
    ).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    expect(
      screen.queryByText('Provide at least one contact method (email or phone).'),
    ).not.toBeInTheDocument();
  });
});
