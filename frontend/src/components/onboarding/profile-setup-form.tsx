'use client';

import {
  type SyntheticEvent,
  useActionState,
  useEffect,
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
import { Button } from '@/components/ui/button';
import { FieldShell, Input } from '@/components/ui/input';
import { AlertCircleIcon, CheckCircleIcon } from '@/components/ui/icons';
import { cn } from '@/components/ui/cn';
import {
  normalizeBdPhone,
  normalizeEmail,
  validateBdPhoneOnChange,
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

const ONBOARDING_STEPS = [
  { number: 1, label: '1. Profile' },
  { number: 2, label: '2. Skills' },
  { number: 3, label: '3. Preferences' },
  { number: 4, label: '4. Career Goal' },
  { number: 5, label: '5. Confirm Level' },
] as const;

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

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2 py-0.5 text-caption font-medium text-feedback-success-text">
      <CheckCircleIcon className="h-3 w-3 shrink-0 text-feedback-success-icon" />
      <span>Verified</span>
    </span>
  );
}

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
function ProfileSetupFormInner({
  initialProfile,
  initialContact = EMPTY_CONTACT,
  initialFullName = '',
  loadError,
  userId,
}: ProfileSetupFormProps) {
  const [state, formAction, isPending] = useActionState<
    ProfileSetupActionState,
    FormData
  >(saveProfileSetupAction, {});

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

  const [clientErrors, setClientErrors] = useState<
    Partial<Record<ProfileSetupFieldKey, string>>
  >({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: ProfileSetupActionState;
    fields: Set<ProfileSetupFieldKey>;
  } | null>(null);
  const [dismissedSuccessState, setDismissedSuccessState] =
    useState<ProfileSetupActionState | null>(null);

  const phoneBlurredRef = useRef(false);
  const hydratedRef = useRef(false);
  const processedResultRef = useRef<ProfileSetupActionState | null>(null);
  const errorAlertRef = useRef<HTMLDivElement | null>(null);

  const { values, hasDraft, skillsNoneTouched, educationTouched } = formState;
  const effectiveProfile = state.profile ?? initialProfile;
  const emailVerified = Boolean(initialContact.emailVerified && initialContact.email);
  const phoneVerified = Boolean(initialContact.phoneVerified && initialContact.phone);
  const contactEmailProp = initialContact.email;
  const contactPhoneProp = initialContact.phone;
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
    Boolean(state.success) && dismissedSuccessState !== state;

  // Effect 1: Success handling - processes each useActionState result at most once,
  // and reconciles later verified contact prop updates without wiping unsaved edits.
  useEffect(() => {
    const isNewSuccess =
      Boolean(state.success) && processedResultRef.current !== state;
    if (isNewSuccess) {
      processedResultRef.current = state;
      clearDraft(userId);
    }

    if (!isNewSuccess && !emailVerified && !phoneVerified) {
      return;
    }

    setFormState((prev) => {
      if (isNewSuccess) {
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
      }

      const nextEmail = emailVerified ? contactEmailProp : prev.values.email;
      const nextPhone = phoneVerified ? contactPhoneProp : prev.values.phone;
      if (nextEmail === prev.values.email && nextPhone === prev.values.phone) {
        return prev;
      }

      return {
        ...prev,
        values: {
          ...prev.values,
          email: nextEmail,
          phone: nextPhone,
        },
      };
    });
  }, [
    state,
    userId,
    emailVerified,
    phoneVerified,
    contactEmailProp,
    contactPhoneProp,
  ]);

  // Effect 2: Error alert focus - focuses visible server alert when error occurs
  useEffect(() => {
    if (visibleAlertState?.error && errorAlertRef.current) {
      errorAlertRef.current.focus();
    }
  }, [visibleAlertState]);

  const setFieldError = (field: ProfileSetupFieldKey, error?: string) => {
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
  };

  const dismissServerField = (field: ProfileSetupFieldKey) => {
    setDismissedServer((prev) => {
      if (!state?.fieldErrors?.[field]) return prev;
      if (prev?.ref === state && prev.fields.has(field)) return prev;
      const fields = new Set(prev?.ref === state ? prev.fields : []);
      fields.add(field);
      return { ref: state, fields };
    });
  };

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
  const commitFieldPatch = (
    patch: Partial<ProfileSetupFormValues>,
    options?: {
      skillsNoneTouched?: boolean;
      educationTouched?: boolean;
    },
  ) => {
    dismissAlert();
    if (state.success) {
      setDismissedSuccessState(state);
    }
    const nextSkillsNoneTouched =
      options?.skillsNoneTouched ?? skillsNoneTouched;
    const nextEducationTouched =
      options?.educationTouched ?? educationTouched;
    const updatedValues: ProfileSetupFormValues = {
      ...values,
      ...patch,
      email: emailVerified ? initialContact.email : (patch.email ?? values.email),
      phone: phoneVerified ? initialContact.phone : (patch.phone ?? values.phone),
    };
    setFormState((prev) => ({
      ...prev,
      values: updatedValues,
      skillsNoneTouched: nextSkillsNoneTouched,
      educationTouched: nextEducationTouched,
    }));
    saveDraft(
      userId,
      updatedValues,
      nextSkillsNoneTouched,
      nextEducationTouched,
    );
  };

  const handleFormActivity = (e: SyntheticEvent<HTMLFormElement>) => {
    onFormActivity(e);
  };

  const handleToggleSkillsNone = () => {
    if (isPending || !isBeginner) {
      return;
    }
    dismissServerField('existing_skills_none');
    setFieldError('existing_skills_none', undefined);
    commitFieldPatch(
      { existing_skills_none: !values.existing_skills_none },
      { skillsNoneTouched: true },
    );
  };

  const handleExperienceLevelChange = (nextLevel: string) => {
    if (isPending) {
      return;
    }
    dismissServerField('experience_level');
    if (getFieldError('experience_level')) {
      const check = validateExperienceLevel(nextLevel);
      setFieldError('experience_level', check.ok ? undefined : check.error);
    }

    if (nextLevel !== 'beginner') {
      dismissServerField('existing_skills_none');
      setFieldError('existing_skills_none', undefined);
      const mustClearBaseline =
        Boolean(effectiveProfile?.existing_skills_none) ||
        values.existing_skills_none;
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
  };

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
      ? { ok: true as const, value: normalizeEmail(initialContact.email) }
      : validateOptionalEmail(displayedEmail);
    if (!emailCheck.ok) {
      errors.email = emailCheck.error;
    }

    const phoneCheck = phoneVerified
      ? {
          ok: true as const,
          value:
            normalizeBdPhone(initialContact.phone) ??
            initialContact.phone.trim(),
        }
      : validateOptionalBdPhone(displayedPhone);
    if (!phoneCheck.ok) {
      errors.phone = phoneCheck.error;
      if (displayedPhone.trim()) {
        phoneBlurredRef.current = true;
      }
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

  const baselineSkillsNone = Boolean(effectiveProfile?.existing_skills_none);
  const effectiveSkillsNoneTouched =
    skillsNoneTouched || values.existing_skills_none !== baselineSkillsNone;
  const storedSkills = effectiveProfile?.existing_skills ?? [];
  const showDraftRestored = hasDraft && !isSuccessVisible;

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

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1 of 5 Modern Multi-Step Header */}
      <div
        role="progressbar"
        aria-valuenow={1}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-label="Onboarding progress: Step 1 of 5"
        className="flex flex-col gap-5 rounded-xl border border-border-subtle bg-surface-subtle px-6 py-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="text-label-lg font-semibold text-text-primary">
              Profile Setup
            </span>
            <span className="inline-flex items-center rounded-full border border-border-default bg-surface-default px-2.5 py-0.5 text-caption font-medium text-text-secondary">
              Step 1 of 5
            </span>
          </div>
          <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 font-mono text-caption font-semibold tabular-nums text-teal-700 dark:text-teal-300">
            20% Complete
          </span>
        </div>

        <ol className="grid grid-cols-5 items-start">
          {ONBOARDING_STEPS.map((step, idx) => {
            const isActive = idx === 0;
            const isLast = idx === ONBOARDING_STEPS.length - 1;
            return (
              <li
                key={step.label}
                className="relative flex flex-col items-center px-1 text-center"
              >
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute top-3.5 left-1/2 h-0.5 w-full bg-border-subtle"
                  />
                )}
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-caption transition-all',
                    isActive
                      ? 'bg-teal-500 font-semibold text-slate-950 ring-4 ring-teal-500/20'
                      : 'border border-border-default bg-surface-default font-medium text-text-muted',
                  )}
                >
                  {step.number}
                </span>
                <span
                  className={cn(
                    'sr-only mt-2.5 text-caption leading-tight sm:not-sr-only',
                    isActive
                      ? 'font-semibold text-text-brand'
                      : 'text-text-muted',
                  )}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

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

      {visibleAlertState?.error && (
        <div ref={errorAlertRef} tabIndex={-1} className="focus:outline-none">
          <AuthAlert
            result={{
              ...visibleAlertState,
              retryAfterSeconds: visibleAlertState.retryAfterSeconds ?? undefined,
            }}
          />
        </div>
      )}

      {isSuccessVisible && state.message && (
        <Alert variant="success" role="status" title={state.message}>
          Your profile details and study preferences are saved. Next onboarding steps (Skills, Preferences, Career Goal) arrive in M05.
        </Alert>
      )}

      <form
        action={formAction}
        noValidate
        onFocusCapture={handleFormActivity}
        onChangeCapture={handleFormActivity}
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        {/* Full Name (Required, 2-100 chars) */}
        <Input
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
          onChange={(e) => {
            const v = e.target.value;
            dismissServerField('full_name');
            if (/[\u0000-\u001F\u007F]/.test(v)) {
              setFieldError('full_name', 'Full name cannot contain control characters.');
            } else if (clientErrors.full_name) {
              const check = validateFullName(v);
              setFieldError('full_name', check.ok ? undefined : check.error);
            }
            commitFieldPatch({ full_name: v });
          }}
          onBlur={(e) => {
            const check = validateFullName(e.target.value);
            if (!check.ok) {
              setFieldError('full_name', check.error);
              return;
            }
            setFieldError('full_name', undefined);
            if (check.value !== values.full_name) {
              commitFieldPatch({ full_name: check.value });
            }
          }}
        />

        {/* Email & Phone Contacts (Prefilled Verified Contact = readOnly) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            id="email"
            name="email"
            variant="email"
            label="Email Address"
            required={!emailVerified && !phoneVerified && !displayedPhone.trim()}
            readOnly={emailVerified || isPending}
            labelBadge={emailVerified ? <VerifiedBadge /> : undefined}
            value={displayedEmail}
            error={emailError}
            placeholder="you@example.com"
            onChange={(e) => {
              if (emailVerified) return;
              const v = e.target.value;
              dismissServerField('email');
              if (!v.trim()) {
                setFieldError('email', undefined);
              } else if (clientErrors.email) {
                const check = validateOptionalEmail(v);
                setFieldError('email', check.ok ? undefined : check.error);
              }
              commitFieldPatch({ email: v });
            }}
            onBlur={(e) => {
              if (emailVerified) return;
              if (!e.target.value.trim()) {
                setFieldError('email', undefined);
                return;
              }
              const check = validateOptionalEmail(e.target.value);
              if (!check.ok) {
                setFieldError('email', check.error);
                return;
              }
              setFieldError('email', undefined);
              if (check.value !== values.email) {
                commitFieldPatch({ email: check.value });
              }
            }}
          />

          <Input
            id="phone"
            name="phone"
            variant="phone_bd"
            label="Phone Number"
            required={!emailVerified && !phoneVerified && !displayedEmail.trim()}
            readOnly={phoneVerified || isPending}
            labelBadge={phoneVerified ? <VerifiedBadge /> : undefined}
            value={displayedPhone}
            error={phoneError}
            placeholder="01XXXXXXXXX"
            onChange={(e) => {
              if (phoneVerified) return;
              const v = e.target.value;
              dismissServerField('phone');
              const check = validateBdPhoneOnChange(v, phoneBlurredRef.current);
              if (check.resetBlurred) phoneBlurredRef.current = false;
              setFieldError('phone', check.error);
              if (!emailVerified && clientErrors.email && !displayedEmail.trim() && check.ok && v.trim()) {
                setFieldError('email', undefined);
              }
              commitFieldPatch({ phone: v });
            }}
            onBlur={(e) => {
              if (phoneVerified) return;
              if (!e.target.value.trim()) {
                phoneBlurredRef.current = false;
                setFieldError('phone', undefined);
                return;
              }
              phoneBlurredRef.current = true;
              const check = validateOptionalBdPhone(e.target.value);
              setFieldError('phone', check.ok ? undefined : check.error);
            }}
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
          <Input
            id="education"
            name="education"
            variant="text"
            label="Education (Optional)"
            maxLength={EDUCATION_MAX}
            readOnly={isPending}
            value={values.education}
            error={educationError}
            placeholder="e.g. BSc in CSE, Diploma in Engineering"
            onChange={(e) => {
              const v = e.target.value;
              dismissServerField('education');
              if (
                /[\u0000-\u001F\u007F]/.test(v) ||
                v.trim().length > EDUCATION_MAX ||
                clientErrors.education
              ) {
                const check = validateEducation(v);
                setFieldError('education', check.ok ? undefined : check.error);
              }
              commitFieldPatch({ education: v }, { educationTouched: true });
            }}
            onBlur={(e) => {
              const check = validateEducation(e.target.value);
              setFieldError('education', check.ok ? undefined : check.error);
            }}
          />
        </div>

        {/* Core Profile 2x2 Responsive Grid */}
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          {/* Grid Cell 1 (Top-Left): Current Role / Profession (Required, 2-120 chars) */}
          <Input
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
            onChange={(e) => {
              const v = e.target.value;
              dismissServerField('current_role');
              if (/[\u0000-\u001F\u007F]/.test(v)) {
                setFieldError(
                  'current_role',
                  'Current role cannot contain control characters.',
                );
              } else if (
                clientErrors.current_role ||
                v.trim().length > CURRENT_ROLE_MAX
              ) {
                const check = validateCurrentRole(v);
                setFieldError('current_role', check.ok ? undefined : check.error);
              }
              commitFieldPatch({ current_role: v });
            }}
            onBlur={(e) => {
              const check = validateCurrentRole(e.target.value);
              if (!check.ok) {
                setFieldError('current_role', check.error);
                return;
              }
              setFieldError('current_role', undefined);
              if (check.value !== values.current_role) {
                commitFieldPatch({ current_role: check.value });
              }
            }}
          />

          {/* Grid Cell 2 (Top-Right): Experience Level (Required, beginner | junior | mid | senior) */}
          <FieldShell
            id="experience_level"
            label="Experience Level"
            required
            error={experienceLevelError}
          >
            <div className="group relative">
              <select
                id="experience_level"
                name="experience_level"
                required
                aria-disabled={isPending || undefined}
                tabIndex={isPending ? -1 : undefined}
                value={values.experience_level}
                onChange={(e) => handleExperienceLevelChange(e.target.value)}
                onBlur={(e) => {
                  const check = validateExperienceLevel(e.target.value);
                  setFieldError(
                    'experience_level',
                    check.ok ? undefined : check.error,
                  );
                }}
                aria-invalid={experienceLevelError ? 'true' : undefined}
                aria-describedby={
                  experienceLevelError ? 'experience_level-error' : undefined
                }
                className={cn(
                  SELECT_BASE_CLASS,
                  selectBorderClass(Boolean(experienceLevelError)),
                  isPending &&
                    'pointer-events-none bg-surface-subtle opacity-(--opacity-disabled)',
                )}
              >
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
              </select>
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
            </div>
          </FieldShell>

          {/* Grid Cell 3 (Bottom-Left): Complete Beginner interactive switch */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-label-lg text-text-primary">
                Skill Baseline
              </span>
            </div>
            <div
              className={cn(
                'flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors duration-(--duration-fast) ease-standard',
                isBeginner && values.existing_skills_none
                  ? 'border-teal-500/50 bg-teal-500/5'
                  : 'border-border-default bg-surface-subtle hover:border-border-strong',
                !isBeginner &&
                  'cursor-not-allowed opacity-60 hover:border-border-default',
              )}
            >
              <input
                type="hidden"
                name="existing_skills_none"
                value={
                  isBeginner && values.existing_skills_none ? 'true' : 'false'
                }
              />
              <input
                type="hidden"
                name="existing_skills_none_touched"
                value={effectiveSkillsNoneTouched ? 'true' : 'false'}
              />
              <span
                id="existing_skills_none_label"
                className={cn(
                  'truncate text-body transition-colors',
                  isBeginner && values.existing_skills_none
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
                aria-checked={isBeginner ? values.existing_skills_none : false}
                aria-labelledby="existing_skills_none_label"
                aria-invalid={skillsError ? 'true' : undefined}
                aria-describedby={
                  skillsError ? 'existing_skills_none-error' : undefined
                }
                disabled={isPending || !isBeginner}
                onClick={handleToggleSkillsNone}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed',
                  isBeginner && values.existing_skills_none
                    ? 'bg-teal-500'
                    : 'bg-neutral-300 dark:bg-slate-700',
                )}
              >
                <span className="sr-only">
                  {isBeginner && values.existing_skills_none
                    ? 'Complete Beginner: On'
                    : 'Complete Beginner: Off'}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transition-transform duration-(--duration-fast) ease-standard',
                    isBeginner && values.existing_skills_none
                      ? 'translate-x-5'
                      : 'translate-x-0.5',
                  )}
                />
              </button>
            </div>

            {storedSkills.length > 0 &&
              !(isBeginner && values.existing_skills_none) && (
                <p className="text-caption text-text-secondary">
                  <span>Stored skills preserved: </span>
                  <span className="font-medium text-text-primary">
                    {storedSkills.map((s) => s.name).join(', ')}
                  </span>
                </p>
              )}

            {skillsError && (
              <p
                id="existing_skills_none-error"
                className="flex items-center gap-1.5 text-caption leading-snug text-text-danger"
              >
                <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
                <span>{skillsError}</span>
              </p>
            )}
          </div>

          {/* Grid Cell 4 (Bottom-Right): Preferred Daily Hours (Required) */}
          <Input
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
            onChange={(e) => {
              const v = e.target.value;
              dismissServerField('preferred_daily_hours');
              if (clientErrors.preferred_daily_hours) {
                const check = validateDailyHours(v);
                setFieldError(
                  'preferred_daily_hours',
                  check.ok ? undefined : check.error,
                );
              }
              commitFieldPatch({ preferred_daily_hours: v });
            }}
            onBlur={(e) => {
              const check = validateDailyHours(e.target.value);
              setFieldError(
                'preferred_daily_hours',
                check.ok ? undefined : check.error,
              );
            }}
          />
        </div>

        {/* Footer Actions Bar */}
        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/80">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
          >
            Go to Dashboard
          </Link>

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-1.5 rounded-full border border-border-subtle bg-surface-subtle px-4 text-label-lg font-medium text-text-disabled"
            >
              <LockIcon className="h-3.5 w-3.5 shrink-0" />
              <span>Next: Skills</span>
            </button>

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
      </form>
    </div>
  );
}
