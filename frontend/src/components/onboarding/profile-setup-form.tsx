'use client';

import {
  memo,
  type ChangeEvent,
  type RefObject,
  type SyntheticEvent,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  saveProfileSetupAction,
  type ProfileContactInfo,
  type ProfileSetupActionState,
  type ProfileSetupFieldKey,
  type ProfileSetupFormValues,
} from '@/lib/profile/actions';
import type { ProfileResponse } from '@/lib/api/client';
import { AuthAlert, useDismissedActionState } from '@/components/auth/auth-alert';
import { Alert } from '@/components/ui/alert';
import { Toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { FieldShell, Input } from '@/components/ui/input';
import { AlertCircleIcon, CheckCircleIcon } from '@/components/ui/icons';
import { cn } from '@/components/ui/cn';
import { OnboardingStepHeader } from '@/components/ui/multi-step-form-wrapper';
import {
  normalizeBdPhone,
  normalizeEmail,
} from '@/lib/validation/auth-schemas';
import {
  CURRENT_ROLE_MAX,
  EDUCATION_MAX,
  FULL_NAME_MAX,
  validateCurrentRole,
  validateDailyHours,
  validateEducation,
  validateExperienceLevel,
  validateFullName,
  validateIanaTimezone,
  validateOptionalBdPhone,
  validateOptionalEmail,
} from '@/lib/validation/profile-schemas';

const SELECT_BASE_CLASS =
  'min-h-11 w-full cursor-pointer appearance-none truncate rounded-md border bg-surface-default py-2 pl-3 pr-10 text-body text-text-primary transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled';

function selectBorderClass(hasError: boolean): string {
  return hasError
    ? 'border-border-danger border-2 focus:outline-none focus:ring-2 focus:ring-border-danger'
    : 'border-border-default hover:border-border-strong focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-focus-ring';
}

const DRAFT_STORAGE_KEY = 'mentor_onboarding_profile_draft';

const FIELD_ORDER: readonly ProfileSetupFieldKey[] = [
  'full_name',
  'email',
  'phone',
  'education',
  'current_role',
  'experience_level',
  'existing_skills_none',
  'preferred_daily_hours',
];

const EMPTY_CONTACT: ProfileContactInfo = {
  email: '',
  emailVerified: false,
  phone: '',
  phoneVerified: false,
};

const EMPTY_STORED_SKILLS: NonNullable<ProfileResponse['existing_skills']> = [];

const MemoizedInput = memo(Input);

const EXPERIENCE_LEVEL_OPTIONS = (
  <>
    <option value="">Select your experience level</option>
    <option value="beginner">
      Beginner — Complete newcomer or student
    </option>
    <option value="junior">
      Junior — Early-career developer (0–2 years)
    </option>
    <option value="mid">
      Mid-Level — Solid hands-on experience (2–5 years)
    </option>
    <option value="senior">
      Senior — Experienced engineer or lead (5+ years)
    </option>
  </>
);

const SELECT_CHEVRON_ICON = (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 transition-colors duration-200 group-hover:text-slate-600 group-focus-within:text-teal-500 dark:group-hover:text-slate-200"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="transition-transform duration-200 ease-out group-hover:translate-y-0.5 group-focus-within:rotate-180"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  </span>
);

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

const VERIFIED_BADGE = (
  <span className="inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2 py-0.5 text-caption font-medium text-feedback-success-text">
    <CheckCircleIcon className="h-3 w-3 shrink-0 text-feedback-success-icon" />
    <span>Verified</span>
  </span>
);

const ExperienceLevelField = memo(function ExperienceLevelField({
  selectRef,
  value,
  error,
  isPending,
  onChange,
}: {
  selectRef: RefObject<HTMLSelectElement | null>;
  value: string;
  error?: string;
  isPending: boolean;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <FieldShell
      id="experience_level"
      label="Experience Level"
      required
      error={error}
    >
      <div className="group relative">
        <select
          ref={selectRef}
          id="experience_level"
          name="experience_level"
          required
          aria-disabled={isPending || undefined}
          tabIndex={isPending ? -1 : undefined}
          value={value}
          onChange={onChange}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'experience_level-error' : undefined}
          className={cn(
            SELECT_BASE_CLASS,
            selectBorderClass(Boolean(error)),
            isPending &&
              'pointer-events-none bg-surface-subtle opacity-(--opacity-disabled)',
          )}
        >
          {EXPERIENCE_LEVEL_OPTIONS}
        </select>
        {SELECT_CHEVRON_ICON}
      </div>
    </FieldShell>
  );
});

const SkillBaselineField = memo(function SkillBaselineField({
  isBeginner,
  checked,
  touched,
  isPending,
  storedSkills,
  error,
  onToggle,
}: {
  isBeginner: boolean;
  checked: boolean;
  touched: boolean;
  isPending: boolean;
  storedSkills: NonNullable<ProfileResponse['existing_skills']>;
  error?: string;
  onToggle: () => void;
}) {
  const storedSkillsText = useMemo(
    () =>
      storedSkills.length > 0
        ? storedSkills.map((s) => s.name).join(', ')
        : '',
    [storedSkills],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label-lg text-text-primary">
          Skill Baseline
        </span>
      </div>
      <div
        className={cn(
          'flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors duration-(--duration-fast) ease-standard',
          isBeginner && checked
            ? 'border-teal-500/50 bg-teal-500/5'
            : 'border-border-default bg-surface-subtle hover:border-border-strong',
          !isBeginner &&
            'cursor-not-allowed opacity-60 hover:border-border-default',
        )}
      >
        <input
          type="hidden"
          name="existing_skills_none"
          value={isBeginner && checked ? 'true' : 'false'}
        />
        <input
          type="hidden"
          name="existing_skills_none_touched"
          value={touched ? 'true' : 'false'}
        />
        <span
          id="existing_skills_none_label"
          className={cn(
            'truncate text-body transition-colors',
            isBeginner && checked
              ? 'font-medium text-teal-700 dark:text-teal-300'
              : 'font-normal text-slate-600 dark:text-slate-300',
          )}
        >
          Complete Beginner
        </span>
        <button
          type="button"
          id="existing_skills_none_toggle"
          role="switch"
          aria-checked={isBeginner ? checked : false}
          aria-labelledby="existing_skills_none_label"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'existing_skills_none-error' : undefined}
          disabled={isPending || !isBeginner}
          onClick={onToggle}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed',
            isBeginner && checked
              ? 'bg-teal-500'
              : 'bg-neutral-300 dark:bg-slate-700',
          )}
        >
          <span className="sr-only">
            {isBeginner && checked
              ? 'Complete Beginner: On'
              : 'Complete Beginner: Off'}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-(--duration-fast) ease-standard',
              isBeginner && checked ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {storedSkills.length > 0 && !(isBeginner && checked) && (
        <p className="text-caption text-text-secondary">
          <span>Stored skills preserved: </span>
          <span className="font-medium text-text-primary">
            {storedSkillsText}
          </span>
        </p>
      )}

      {error && (
        <p
          id="existing_skills_none-error"
          className="flex items-center gap-1.5 text-caption leading-snug text-text-danger"
        >
          <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
});

const ProfileFormFooter = memo(function ProfileFormFooter({
  isPending,
  canProceed,
}: {
  isPending: boolean;
  canProceed: boolean;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/80">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
      >
        Go to Dashboard
      </Link>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {canProceed && !isPending ? (
          <Link
            href="/onboarding/skills"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-border-default bg-surface-default px-4 text-label-lg font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-subtle"
          >
            <span>Next: Skills</span>
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle px-4 text-label-lg font-medium text-text-disabled"
          >
            <LockIcon className="h-3.5 w-3.5 shrink-0" />
            <span>Next: Skills</span>
          </button>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          isLoading={isPending}
          disabled={isPending}
          loadingText="Saving profile..."
          className="min-w-[160px]"
        >
          Save Profile
        </Button>
      </div>
    </div>
  );
});

/**
 * Props for the `ProfileSetupForm` component on Screen 07 (`/onboarding/profile`).
 */
export interface ProfileSetupFormProps {
  initialProfile: ProfileResponse | null;
  initialContact?: ProfileContactInfo;
  initialFullName?: string;
  loadError?: string;
  userId?: string;
}

/**
 * Returns a valid IANA timezone string or `undefined` if empty/invalid.
 */
function sanitizeIanaTimezone(candidate: unknown): string | undefined {
  if (typeof candidate !== 'string') {
    return undefined;
  }
  const check = validateIanaTimezone(candidate);
  return check.ok ? check.value : undefined;
}

/**
 * Resolves the browser's IANA timezone or falls back to `Asia/Dhaka`.
 */
function detectBrowserTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return sanitizeIanaTimezone(resolved) ?? 'Asia/Dhaka';
  } catch {
    return 'Asia/Dhaka';
  }
}

/**
 * Returns the account-scoped sessionStorage key for draft isolation.
 */
function getDraftStorageKey(userId?: string): string {
  return userId ? `${DRAFT_STORAGE_KEY}:${userId}` : DRAFT_STORAGE_KEY;
}

/**
 * Persists an account-scoped form draft and touched state to sessionStorage.
 */
function saveDraft(
  userId: string | undefined,
  formValues: ProfileSetupFormValues,
  skillsNoneTouched: boolean,
  educationTouched: boolean,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const payload = {
      ...formValues,
      user_id: userId,
      values: formValues,
      skills_none_touched: skillsNoneTouched,
      education_touched: educationTouched,
    };
    window.sessionStorage.setItem(
      getDraftStorageKey(userId),
      JSON.stringify(payload),
    );
  } catch {
    // Ignore sessionStorage write errors
  }
}

/**
 * Clears account-scoped and legacy draft storage entries.
 */
function clearDraft(userId?: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(getDraftStorageKey(userId));
    if (userId) {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  } catch {
    // Ignore sessionStorage removal errors
  }
}

/**
 * Builds server-deterministic initial controlled form state using ONLY initial props.
 * Avoids hydration mismatch by not reading window, sessionStorage, or browser Intl during initial render.
 */
function buildInitialState(
  profile: ProfileResponse | null,
  contact: ProfileContactInfo,
  fullName: string,
): ProfileSetupFormValues {
  const experienceLevel = profile?.experience_level ?? '';
  return {
    full_name: fullName,
    email: contact.email,
    phone: contact.phone,
    current_role: profile?.current_role ?? '',
    education: profile?.education ?? profile?.education_level ?? '',
    experience_level: experienceLevel,
    existing_skills_none:
      experienceLevel === 'beginner'
        ? Boolean(profile?.existing_skills_none)
        : false,
    timezone: sanitizeIanaTimezone(profile?.timezone) ?? 'Asia/Dhaka',
    preferred_daily_hours:
      profile?.preferred_daily_hours !== null &&
      profile?.preferred_daily_hours !== undefined
        ? String(profile.preferred_daily_hours)
        : '',
  };
}

/**
 * Screen 07 (`/onboarding/profile`) client form component consuming EP-P01, EP-P02, EP-P04, and Supabase user metadata.
 * Keys the inner stateful form by `userId` so `useActionState`, pending flags, and ephemeral validation reset cleanly on account change.
 */
export function ProfileSetupForm(props: ProfileSetupFormProps) {
  return (
    <ProfileSetupFormInner
      key={props.userId ?? 'anonymous'}
      {...props}
    />
  );
}

/**
 * Inner stateful form for Screen 07 (`/onboarding/profile`).
 * Enforces client + server validation, verified contact prefill, optional education, explicit beginner `None`,
 * auto-reset of invalid beginner-only states, account-scoped draft isolation, and SSR hydration safety.
 */
type InternalProfileSetupActionState = ProfileSetupActionState & {
  _superseded?: boolean;
};

function ProfileSetupFormInner({
  initialProfile,
  initialContact = EMPTY_CONTACT,
  initialFullName = '',
  loadError,
  userId,
}: ProfileSetupFormProps) {
  const isMountedRef = useRef(true);
  const draftVersionRef = useRef(0);

  const [state, formAction, isPending] = useActionState<
    InternalProfileSetupActionState,
    FormData
  >(async (prevState, formData) => {
    const submittedDraftVersion = draftVersionRef.current;
    const result = await saveProfileSetupAction(prevState, formData);
    const isSuperseded =
      !isMountedRef.current ||
      draftVersionRef.current !== submittedDraftVersion;
    if (result?.success && !isSuperseded) {
      clearDraft(userId);
    }
    if (isSuperseded) {
      return { ...result, _superseded: true };
    }
    return result;
  }, {});

  const [formState, setFormState] = useState<{
    values: ProfileSetupFormValues;
    hasDraft: boolean;
    skillsNoneTouched: boolean;
    educationTouched: boolean;
  }>(() => ({
    values: buildInitialState(initialProfile, initialContact, initialFullName),
    hasDraft: false,
    skillsNoneTouched: false,
    educationTouched: false,
  }));

  const [lastHandledState, setLastHandledState] = useState(state);
  const [clientErrors, setClientErrors] = useState<
    Partial<Record<ProfileSetupFieldKey, string>>
  >({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: ProfileSetupActionState;
    fields: Set<ProfileSetupFieldKey>;
  } | null>(null);
  const [dismissedSuccessState, setDismissedSuccessState] =
    useState<InternalProfileSetupActionState | null>(null);

  const hydratedRef = useRef(false);
  const errorAlertRef = useRef<HTMLDivElement | null>(null);
  const experienceSelectRef = useRef<HTMLSelectElement | null>(null);
  const formStateRef = useRef(formState);
  const stateRef = useRef(state);

  const emailVerified = Boolean(initialContact.emailVerified && initialContact.email);
  const phoneVerified = Boolean(initialContact.phoneVerified && initialContact.phone);
  const contactEmailProp = initialContact.email;
  const contactPhoneProp = initialContact.phone;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Render-time reconciliation when useActionState emits a new submission result:
  // updates formState in the same render pass without a post-commit useEffect cascade.
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success && !state._superseded) {
      setFormState((prev) => {
        if (!state.values) {
          return prev.hasDraft ? { ...prev, hasDraft: false } : prev;
        }
        const reconciledLevel =
          state.values.experience_level ?? prev.values.experience_level;
        const reconciledSkillsNone =
          reconciledLevel === 'beginner'
            ? typeof state.values.existing_skills_none === 'boolean'
              ? state.values.existing_skills_none
              : prev.values.existing_skills_none
            : false;

        return {
          hasDraft: false,
          skillsNoneTouched: false,
          educationTouched: false,
          values: {
            full_name: state.values.full_name ?? prev.values.full_name,
            email: emailVerified
              ? contactEmailProp
              : (state.values.email ?? prev.values.email),
            phone: phoneVerified
              ? contactPhoneProp
              : (state.values.phone ?? prev.values.phone),
            current_role: state.values.current_role ?? prev.values.current_role,
            education: state.values.education ?? prev.values.education,
            experience_level: reconciledLevel,
            existing_skills_none: reconciledSkillsNone,
            timezone:
              sanitizeIanaTimezone(state.values.timezone) ??
              sanitizeIanaTimezone(prev.values.timezone) ??
              'Asia/Dhaka',
            preferred_daily_hours:
              state.values.preferred_daily_hours ??
              prev.values.preferred_daily_hours,
          },
        };
      });
    }
  }

  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { values, hasDraft, skillsNoneTouched, educationTouched } = formState;

  useEffect(() => {
    // React 19 calls HTMLFormElement.reset() after <form action={...}> completes;
    // keep the controlled experience select DOM value synchronized with state.
    if (
      experienceSelectRef.current &&
      experienceSelectRef.current.value !== values.experience_level
    ) {
      experienceSelectRef.current.value = values.experience_level;
    }
  });
  const effectiveProfile = state.profile ?? initialProfile;
  const displayedEmail = emailVerified ? contactEmailProp : values.email;
  const displayedPhone = phoneVerified ? contactPhoneProp : values.phone;
  const isBeginner = values.experience_level === 'beginner';

  const {
    visibleState: visibleAlertState,
    dismiss: dismissAlert,
    onFormActivity,
  } = useDismissedActionState(state);

  // Mount effect (per keyed userId instance): restores userId-scoped draft once,
  // enforces verified server contact precedence, and detects browser timezone when unset.
  useEffect(() => {
    if (typeof window === 'undefined' || hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;

    const detectedTz = detectBrowserTimezone();
    const storageKey = getDraftStorageKey(userId);
    let restoredValues: Record<string, unknown> | null = null;
    let storedTouched: boolean | undefined = undefined;
    let storedEducationTouched: boolean | undefined = undefined;

    if (userId) {
      try {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Ignore legacy storage removal errors
      }
    }

    try {
      const rawDraft = window.sessionStorage.getItem(storageKey);
      if (rawDraft) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(rawDraft);
        } catch {
          window.sessionStorage.removeItem(storageKey);
          parsed = null;
        }

        if (parsed && typeof parsed === 'object') {
          const draftObj = parsed as {
            user_id?: unknown;
            values?: unknown;
            skills_none_touched?: unknown;
            education_touched?: unknown;
          };
          const draftUserId =
            typeof draftObj.user_id === 'string' ? draftObj.user_id : undefined;

          if (userId && draftUserId && draftUserId !== userId) {
            window.sessionStorage.removeItem(storageKey);
          } else {
            const payloadValues =
              draftObj.values && typeof draftObj.values === 'object'
                ? (draftObj.values as Record<string, unknown>)
                : (parsed as Record<string, unknown>);

            if (payloadValues && typeof payloadValues === 'object') {
              restoredValues = payloadValues;
              storedTouched =
                typeof draftObj.skills_none_touched === 'boolean'
                  ? draftObj.skills_none_touched
                  : typeof payloadValues.skills_none_touched === 'boolean'
                    ? (payloadValues.skills_none_touched as boolean)
                    : undefined;
              storedEducationTouched =
                typeof draftObj.education_touched === 'boolean'
                  ? draftObj.education_touched
                  : typeof payloadValues.education_touched === 'boolean'
                    ? (payloadValues.education_touched as boolean)
                    : undefined;
            } else {
              window.sessionStorage.removeItem(storageKey);
            }
          }
        } else if (rawDraft) {
          window.sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      // Ignore sessionStorage read errors
    }

    const contactSnapshot: ProfileContactInfo = {
      email: contactEmailProp,
      emailVerified,
      phone: contactPhoneProp,
      phoneVerified,
    };
    const baseline = buildInitialState(
      initialProfile,
      contactSnapshot,
      initialFullName,
    );
    const serverTz = sanitizeIanaTimezone(initialProfile?.timezone);
    const serverSkillsNone = Boolean(initialProfile?.existing_skills_none);
    const serverEducation =
      initialProfile?.education ?? initialProfile?.education_level ?? '';
    const hasServerBaseline = Boolean(initialProfile) && !loadError;

    setFormState(() => {
      if (restoredValues) {
        const draftTz =
          sanitizeIanaTimezone(restoredValues.timezone) ??
          serverTz ??
          detectedTz;

        const restoredLevel =
          typeof restoredValues.experience_level === 'string'
            ? restoredValues.experience_level
            : baseline.experience_level;

        const rawDraftSkillsNone =
          typeof restoredValues.existing_skills_none === 'boolean'
            ? restoredValues.existing_skills_none
            : serverSkillsNone;

        const restoredSkillsNone =
          restoredLevel === 'beginner' ? rawDraftSkillsNone : false;

        const isTouched =
          storedTouched !== undefined
            ? storedTouched
            : restoredSkillsNone !== serverSkillsNone;

        const rawDraftEducation =
          typeof restoredValues.education === 'string'
            ? restoredValues.education
            : typeof restoredValues.education_level === 'string'
              ? restoredValues.education_level
              : undefined;

        const restoredEducationTouched =
          typeof storedEducationTouched === 'boolean'
            ? storedEducationTouched
            : hasServerBaseline &&
              typeof rawDraftEducation === 'string' &&
              rawDraftEducation.trim().length > 0 &&
              rawDraftEducation !== serverEducation;

        // Verified server contacts always take precedence over any local draft entry;
        // explicit "" in a draft for an unverified contact is treated as an intentional removal.
        const resolvedEmail = emailVerified
          ? contactEmailProp
          : typeof restoredValues.email === 'string'
            ? restoredValues.email
            : baseline.email;
        const resolvedPhone = phoneVerified
          ? contactPhoneProp
          : typeof restoredValues.phone === 'string'
            ? restoredValues.phone
            : baseline.phone;

        return {
          hasDraft: true,
          skillsNoneTouched: isTouched,
          educationTouched: restoredEducationTouched,
          values: {
            full_name:
              typeof restoredValues.full_name === 'string'
                ? restoredValues.full_name
                : baseline.full_name,
            email: resolvedEmail,
            phone: resolvedPhone,
            current_role:
              typeof restoredValues.current_role === 'string'
                ? restoredValues.current_role
                : baseline.current_role,
            education:
              restoredEducationTouched && typeof rawDraftEducation === 'string'
                ? rawDraftEducation
                : serverEducation,
            experience_level: restoredLevel,
            existing_skills_none: restoredSkillsNone,
            timezone: draftTz,
            preferred_daily_hours:
              typeof restoredValues.preferred_daily_hours === 'string'
                ? restoredValues.preferred_daily_hours
                : baseline.preferred_daily_hours,
          },
        };
      }

      return {
        hasDraft: false,
        skillsNoneTouched: false,
        educationTouched: false,
        values: {
          ...baseline,
          timezone: serverTz ?? detectedTz,
        },
      };
    });
  }, [
    initialProfile,
    contactEmailProp,
    contactPhoneProp,
    emailVerified,
    phoneVerified,
    initialFullName,
    loadError,
    userId,
  ]);

  const isSuccessVisible =
    Boolean(state.success) &&
    !state._superseded &&
    dismissedSuccessState !== state;

  const handleDismissSuccessToast = useCallback(() => {
    setDismissedSuccessState(stateRef.current);
  }, []);

  // Error alert focus - focuses visible server alert when error occurs
  useEffect(() => {
    if (visibleAlertState?.error && errorAlertRef.current) {
      errorAlertRef.current.focus();
    }
  }, [visibleAlertState]);

  const setFieldError = useCallback(
    (field: ProfileSetupFieldKey, error?: string) => {
      setClientErrors((prev) => {
        if (!error) {
          if (!prev[field]) return prev;
          const next = { ...prev };
          delete next[field];
          return next;
        }
        if (prev[field] === error) return prev;
        return { ...prev, [field]: error };
      });
    },
    [],
  );

  const dismissServerField = useCallback((field: ProfileSetupFieldKey) => {
    const currentState = stateRef.current;
    setDismissedServer((prev) => {
      if (!currentState?.fieldErrors?.[field]) return prev;
      if (prev?.ref === currentState && prev.fields.has(field)) return prev;
      const fields = new Set(prev?.ref === currentState ? prev.fields : []);
      fields.add(field);
      return { ref: currentState, fields };
    });
  }, []);

  const getFieldError = (field: ProfileSetupFieldKey): string | undefined => {
    if (clientErrors[field]) return clientErrors[field];
    if (
      dismissedServer?.ref === state &&
      dismissedServer.fields.has(field)
    ) {
      return undefined;
    }
    return state?.fieldErrors?.[field];
  };

  /**
   * Updates controlled field values, dismisses stale errors/success banners, and persists account-scoped draft.
   */
  const commitFieldPatch = useCallback(
    (
      patch: Partial<ProfileSetupFormValues>,
      options?: {
        skillsNoneTouched?: boolean;
        educationTouched?: boolean;
      },
    ) => {
      dismissAlert();
      const currentState = stateRef.current;
      if (currentState.success) {
        setDismissedSuccessState(currentState);
      }
      const current = formStateRef.current;
      const nextSkillsNoneTouched =
        options?.skillsNoneTouched ?? current.skillsNoneTouched;
      const nextEducationTouched =
        options?.educationTouched ?? current.educationTouched;
      const updatedValues: ProfileSetupFormValues = {
        ...current.values,
        ...patch,
        email: emailVerified
          ? contactEmailProp
          : (patch.email ?? current.values.email),
        phone: phoneVerified
          ? contactPhoneProp
          : (patch.phone ?? current.values.phone),
      };
      const nextFormState = {
        ...current,
        values: updatedValues,
        skillsNoneTouched: nextSkillsNoneTouched,
        educationTouched: nextEducationTouched,
      };
      formStateRef.current = nextFormState;
      draftVersionRef.current += 1;
      setFormState(nextFormState);
      saveDraft(
        userId,
        updatedValues,
        nextSkillsNoneTouched,
        nextEducationTouched,
      );
    },
    [
      dismissAlert,
      emailVerified,
      contactEmailProp,
      phoneVerified,
      contactPhoneProp,
      userId,
    ],
  );

  const handleFullNameChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      dismissServerField('full_name');
      setFieldError('full_name', undefined);
      commitFieldPatch({ full_name: v });
    },
    [commitFieldPatch, dismissServerField, setFieldError],
  );

  const handleFullNameBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const check = validateFullName(e.target.value);
      if (check.ok && check.value !== formStateRef.current.values.full_name) {
        commitFieldPatch({ full_name: check.value });
      }
    },
    [commitFieldPatch],
  );

  const handleEmailChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (emailVerified) return;
      const v = e.target.value;
      dismissServerField('email');
      setFieldError('email', undefined);
      commitFieldPatch({ email: v });
    },
    [commitFieldPatch, dismissServerField, emailVerified, setFieldError],
  );

  const handleEmailBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (emailVerified || !e.target.value.trim()) return;
      const check = validateOptionalEmail(e.target.value);
      if (check.ok && check.value !== formStateRef.current.values.email) {
        commitFieldPatch({ email: check.value });
      }
    },
    [commitFieldPatch, emailVerified],
  );

  const handlePhoneChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (phoneVerified) return;
      const v = e.target.value;
      dismissServerField('phone');
      setFieldError('phone', undefined);
      if (
        !emailVerified &&
        !formStateRef.current.values.email.trim() &&
        v.trim()
      ) {
        setFieldError('email', undefined);
      }
      commitFieldPatch({ phone: v });
    },
    [
      commitFieldPatch,
      dismissServerField,
      emailVerified,
      phoneVerified,
      setFieldError,
    ],
  );

  const handleEducationChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      dismissServerField('education');
      setFieldError('education', undefined);
      commitFieldPatch({ education: v }, { educationTouched: true });
    },
    [commitFieldPatch, dismissServerField, setFieldError],
  );

  const handleCurrentRoleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      dismissServerField('current_role');
      setFieldError('current_role', undefined);
      commitFieldPatch({ current_role: v });
    },
    [commitFieldPatch, dismissServerField, setFieldError],
  );

  const handleDailyHoursChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      dismissServerField('preferred_daily_hours');
      setFieldError('preferred_daily_hours', undefined);
      commitFieldPatch({ preferred_daily_hours: v });
    },
    [commitFieldPatch, dismissServerField, setFieldError],
  );

  const handleToggleSkillsNone = useCallback(() => {
    const current = formStateRef.current.values;
    if (isPending || current.experience_level !== 'beginner') {
      return;
    }
    dismissServerField('existing_skills_none');
    setFieldError('existing_skills_none', undefined);
    commitFieldPatch(
      { existing_skills_none: !current.existing_skills_none },
      { skillsNoneTouched: true },
    );
  }, [commitFieldPatch, dismissServerField, isPending, setFieldError]);

  const effectiveSkillsNoneBaseline = Boolean(
    effectiveProfile?.existing_skills_none,
  );

  const handleExperienceLevelChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      if (isPending) {
        return;
      }
      const nextLevel = e.target.value;
      dismissServerField('experience_level');
      setFieldError('experience_level', undefined);

      if (nextLevel !== 'beginner') {
        dismissServerField('existing_skills_none');
        setFieldError('existing_skills_none', undefined);
        const mustClearBaseline =
          effectiveSkillsNoneBaseline ||
          formStateRef.current.values.existing_skills_none;
        commitFieldPatch(
          {
            experience_level: nextLevel,
            existing_skills_none: false,
          },
          mustClearBaseline ? { skillsNoneTouched: true } : undefined,
        );
        return;
      }

      commitFieldPatch({ experience_level: nextLevel });
    },
    [
      commitFieldPatch,
      dismissServerField,
      effectiveSkillsNoneBaseline,
      isPending,
      setFieldError,
    ],
  );

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    if (isPending) {
      e.preventDefault();
      return;
    }

    const errors: Partial<Record<ProfileSetupFieldKey, string>> = {};

    const fullNameCheck = validateFullName(values.full_name);
    if (!fullNameCheck.ok) {
      errors.full_name = fullNameCheck.error;
    }

    const emailCheck = emailVerified
      ? { ok: true as const, value: normalizeEmail(contactEmailProp) }
      : validateOptionalEmail(displayedEmail);
    if (!emailCheck.ok) {
      errors.email = emailCheck.error;
    }

    const phoneCheck = phoneVerified
      ? {
          ok: true as const,
          value:
            normalizeBdPhone(contactPhoneProp) ?? contactPhoneProp.trim(),
        }
      : validateOptionalBdPhone(displayedPhone);
    if (!phoneCheck.ok) {
      errors.phone = phoneCheck.error;
    }

    if (
      emailCheck.ok &&
      phoneCheck.ok &&
      !emailCheck.value &&
      !phoneCheck.value
    ) {
      errors.email = 'Enter a valid email address or phone number.';
    }

    const roleCheck = validateCurrentRole(values.current_role);
    if (!roleCheck.ok) {
      errors.current_role = roleCheck.error;
    }

    const eduCheck = validateEducation(values.education);
    if (!eduCheck.ok) {
      errors.education = eduCheck.error;
    }

    const levelCheck = validateExperienceLevel(values.experience_level);
    if (!levelCheck.ok) {
      errors.experience_level = levelCheck.error;
    } else if (values.existing_skills_none && levelCheck.value !== 'beginner') {
      errors.existing_skills_none =
        'Complete Beginner mode is only available when Experience Level is Beginner.';
    }

    const resolvedSubmitTimezone =
      sanitizeIanaTimezone(values.timezone) ?? detectBrowserTimezone();
    const tzCheck = validateIanaTimezone(resolvedSubmitTimezone);
    if (!tzCheck.ok) {
      errors.timezone = tzCheck.error;
    }

    const hoursCheck = validateDailyHours(values.preferred_daily_hours);
    if (!hoursCheck.ok) {
      errors.preferred_daily_hours = hoursCheck.error;
    }

    if (Object.keys(errors).length > 0) {
      e.preventDefault();
      dismissAlert();
      setClientErrors(errors);
      const firstInvalidKey = FIELD_ORDER.find((key) => Boolean(errors[key]));
      if (firstInvalidKey && typeof document !== 'undefined') {
        const elId =
          firstInvalidKey === 'existing_skills_none'
            ? 'existing_skills_none_toggle'
            : firstInvalidKey;
        document.getElementById(elId)?.focus();
      }
      return;
    }

    setClientErrors({});
    if (state.success) {
      setDismissedSuccessState(state);
    }
  };

  const baselineSkillsNone = effectiveSkillsNoneBaseline;
  const effectiveSkillsNoneTouched =
    skillsNoneTouched || values.existing_skills_none !== baselineSkillsNone;
  const storedSkills = effectiveProfile?.existing_skills ?? EMPTY_STORED_SKILLS;
  const showDraftRestored = hasDraft && !isSuccessVisible;

  const alertResult = useMemo(
    () =>
      visibleAlertState?.error
        ? {
            ...visibleAlertState,
            retryAfterSeconds: visibleAlertState.retryAfterSeconds ?? undefined,
          }
        : null,
    [visibleAlertState],
  );

  const fullNameError = getFieldError('full_name');
  const emailError = getFieldError('email');
  const phoneError = getFieldError('phone');
  const currentRoleError = getFieldError('current_role');
  const educationError = getFieldError('education');
  const experienceLevelError = getFieldError('experience_level');
  const skillsError =
    getFieldError('existing_skills') ?? getFieldError('existing_skills_none');
  const dailyHoursError = getFieldError('preferred_daily_hours');
  const resolvedTimezone = sanitizeIanaTimezone(values.timezone) ?? 'Asia/Dhaka';
  const isEmailRequired =
    !emailVerified && !phoneVerified && !displayedPhone.trim();
  const isPhoneRequired =
    !emailVerified && !phoneVerified && !displayedEmail.trim();

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1 of 5 Modern Multi-Step Header */}
      <OnboardingStepHeader currentStep={1} />

      {/* Initial Profile Load Warning Banner (preserves form usability on failed GET /profile) */}
      {loadError && (
        <Alert
          variant="warning"
          role="alert"
          title="Could not load saved profile"
        >
          {loadError}
        </Alert>
      )}

      {showDraftRestored && (
        <p
          role="status"
          aria-live="polite"
          className="text-caption text-text-muted"
        >
          Draft restored — your unsaved edits are loaded for this session.
        </p>
      )}

      {alertResult && (
        <div
          ref={errorAlertRef}
          tabIndex={-1}
          className="outline-none focus:outline-none focus-visible:outline-none"
        >
          <AuthAlert result={alertResult} />
        </div>
      )}

      {isSuccessVisible && (
        <Toast
          variant="success"
          position="top-center"
          role="status"
          ariaLive="polite"
          autoDismissMs={4000}
          onDismiss={handleDismissSuccessToast}
        >
          Profile saved.
        </Toast>
      )}

      <form
        action={formAction}
        noValidate
        onFocusCapture={onFormActivity}
        onChangeCapture={onFormActivity}
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        {/* Full Name (Required, 2-100 chars) */}
        <MemoizedInput
          id="full_name"
          name="full_name"
          variant="text"
          label="Full Name"
          required
          maxLength={FULL_NAME_MAX}
          autoComplete="name"
          readOnly={isPending}
          value={values.full_name}
          error={fullNameError}
          placeholder="Enter your full name"
          onChange={handleFullNameChange}
          onBlur={handleFullNameBlur}
        />

        {/* Email & Phone Contacts (Prefilled Verified Contact = readOnly) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MemoizedInput
            id="email"
            name="email"
            variant="email"
            label="Email Address"
            required={isEmailRequired}
            readOnly={emailVerified || isPending}
            labelBadge={emailVerified ? VERIFIED_BADGE : undefined}
            value={displayedEmail}
            error={emailError}
            placeholder="Enter your email"
            onChange={handleEmailChange}
            onBlur={handleEmailBlur}
          />

          <MemoizedInput
            id="phone"
            name="phone"
            variant="phone_bd"
            label="Phone Number"
            required={isPhoneRequired}
            readOnly={phoneVerified || isPending}
            labelBadge={phoneVerified ? VERIFIED_BADGE : undefined}
            value={displayedPhone}
            error={phoneError}
            placeholder="01XXXXXXXXX"
            onChange={handlePhoneChange}
          />
        </div>

        {/* Education (Optional, <= 200 chars) */}
        <div>
          <input
            type="hidden"
            name="education_touched"
            value={educationTouched ? 'true' : 'false'}
          />
          <input
            type="hidden"
            id="timezone"
            name="timezone"
            value={resolvedTimezone}
          />
          <MemoizedInput
            id="education"
            name="education"
            variant="text"
            label="Education (Optional)"
            maxLength={EDUCATION_MAX}
            readOnly={isPending}
            value={values.education}
            error={educationError}
            placeholder="e.g. BSc in CSE, Diploma in Engineering"
            onChange={handleEducationChange}
          />
        </div>

        {/* Core Profile 2x2 Responsive Grid */}
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          {/* Grid Cell 1 (Top-Left): Current Role / Profession (Required, 2-120 chars) */}
          <MemoizedInput
            id="current_role"
            name="current_role"
            variant="text"
            label="Current Role / Profession"
            required
            maxLength={CURRENT_ROLE_MAX}
            readOnly={isPending}
            value={values.current_role}
            error={currentRoleError}
            placeholder="e.g. Student, Frontend Developer, QA Engineer"
            onChange={handleCurrentRoleChange}
          />

          {/* Grid Cell 2 (Top-Right): Experience Level (Required, beginner | junior | mid | senior) */}
          <ExperienceLevelField
            selectRef={experienceSelectRef}
            value={values.experience_level}
            error={experienceLevelError}
            isPending={isPending}
            onChange={handleExperienceLevelChange}
          />

          {/* Grid Cell 3 (Bottom-Left): Complete Beginner interactive switch */}
          <SkillBaselineField
            isBeginner={isBeginner}
            checked={values.existing_skills_none}
            touched={effectiveSkillsNoneTouched}
            isPending={isPending}
            storedSkills={storedSkills}
            error={skillsError}
            onToggle={handleToggleSkillsNone}
          />

          {/* Grid Cell 4 (Bottom-Right): Preferred Daily Hours (Required) */}
          <MemoizedInput
            id="preferred_daily_hours"
            name="preferred_daily_hours"
            variant="number"
            label="Preferred Daily Hours"
            required
            min={0.5}
            max={12}
            step={0.5}
            readOnly={isPending}
            value={values.preferred_daily_hours}
            error={dailyHoursError}
            placeholder="2"
            onChange={handleDailyHoursChange}
          />
        </div>

        {/* Footer Actions Bar */}
        <ProfileFormFooter
          isPending={isPending}
          canProceed={
            Boolean(state.success) ||
            Boolean(
              initialProfile?.current_role && initialProfile?.experience_level,
            )
          }
        />
      </form>
    </div>
  );
}
