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
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CheckCircleIcon } from '@/components/ui/icons';
import { cn } from '@/components/ui/cn';
import { useOptionalAppShellContext } from '@/components/ui/app-shell-context';
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
  validateEducation,
  validateExperienceLevel,
  validateFullName,
  validateIanaTimezone,
  validateOptionalBdPhone,
  validateOptionalEmail,
} from '@/lib/validation/profile-schemas';

const DRAFT_STORAGE_KEY = 'mentor_onboarding_profile_draft';

const FIELD_ORDER: readonly ProfileSetupFieldKey[] = [
  'full_name',
  'email',
  'phone',
  'education',
  'current_role',
  'experience_level',
];

const EMPTY_CONTACT: ProfileContactInfo = {
  email: '',
  emailVerified: false,
  phone: '',
  phoneVerified: false,
};

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
    <Select
      ref={selectRef}
      id="experience_level"
      name="experience_level"
      label="Experience Level"
      required
      aria-disabled={isPending || undefined}
      tabIndex={isPending ? -1 : undefined}
      value={value}
      error={error}
      onChange={onChange}
      className={cn(
        isPending &&
          'pointer-events-none bg-surface-subtle opacity-(--opacity-disabled)',
      )}
    >
      {EXPERIENCE_LEVEL_OPTIONS}
    </Select>
  );
});

const ProfileFormFooter = memo(function ProfileFormFooter({
  isPending,
  canSubmit,
  embedded = false,
  standalone = false,
  onBack,
}: {
  isPending: boolean;
  canSubmit: boolean;
  embedded?: boolean;
  standalone?: boolean;
  onBack?: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800/80">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-label-lg text-text-primary hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
        >
          Back
        </button>
      ) : embedded || standalone ? (
        <span aria-hidden="true" className="hidden sm:block" />
      ) : (
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/70"
        >
          Go to Dashboard
        </Link>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        isLoading={isPending}
        disabled={!canSubmit || isPending}
        loadingText={standalone ? 'Saving changes...' : 'Saving profile...'}
        className="min-w-[160px]"
      >
        {standalone ? 'Save Changes' : 'Save & Next'}
      </Button>
    </div>
  );
});

/**
 * Props for the `ProfileSetupForm` component on Screen 07 (`/onboarding`, Step 1 of 5) or standalone `/profile`.
 */
export interface ProfileSetupFormProps {
  initialProfile: ProfileResponse | null;
  initialContact?: ProfileContactInfo;
  initialFullName?: string;
  loadError?: string;
  userId?: string;
  /** Rendering mode: `'wizard'` (default onboarding step) or `'standalone'` (dedicated `/profile` page). */
  mode?: 'wizard' | 'standalone';
  /** Notifies an outer wizard container whenever submission enters or exits pending state. */
  onPendingChange?: (pending: boolean) => void;
  /** Optional callback fired on successful save instead of router navigation (for wizard / inline reuse). */
  onSuccess?: (payload: {
    profile: ProfileResponse | null;
    fullName: string;
    values?: ProfileSetupFormValues;
  }) => void;
  /** Optional Back handler when embedded inside a multi-step container. */
  onBack?: () => void;
  /** When true, omits the standalone stepper header so an outer shell owns stepper chrome. */
  embedded?: boolean;
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
 * Screen 07 (`/onboarding`) client form component consuming EP-P01, EP-P02, EP-P04, and Supabase user metadata.
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
 * Inner stateful form for Screen 07 (`/onboarding`).
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
  mode = 'wizard',
  onPendingChange,
  onSuccess,
  onBack,
  embedded = false,
}: ProfileSetupFormProps) {
  const isStandalone = mode === 'standalone';
  const router = useRouter();
  const appShell = useOptionalAppShellContext();
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
      const submittedFullName = formData.get('full_name');
      const committedFullName =
        result.values?.full_name ??
        (typeof submittedFullName === 'string' ? submittedFullName.trim() : '');
      const committedRole =
        result.profile?.current_role?.trim() ??
        result.values?.current_role?.trim() ??
        '';
      appShell?.syncState({
        user: {
          ...(committedFullName ? { fullName: committedFullName } : {}),
          ...(committedRole ? { currentRole: committedRole } : {}),
        },
      });
      if (onSuccess) {
        onSuccess({
          profile: result.profile ?? null,
          fullName: committedFullName,
          values: result.values,
        });
      } else if (!isStandalone) {
        router.push('/onboarding');
      }
    }
    if (isSuperseded) {
      return { ...result, _superseded: true };
    }
    return result;
  }, {});

  const [savedBaseline, setSavedBaseline] = useState<ProfileSetupFormValues>(
    () => buildInitialState(initialProfile, initialContact, initialFullName),
  );
  const [hasPendingMetadataRetry, setHasPendingMetadataRetry] = useState(false);
  const [formState, setFormState] = useState<{
    values: ProfileSetupFormValues;
    hasDraft: boolean;
    educationTouched: boolean;
  }>(() => ({
    values: buildInitialState(initialProfile, initialContact, initialFullName),
    hasDraft: false,
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

  useEffect(() => {
    onPendingChange?.(isPending);
    return () => {
      onPendingChange?.(false);
    };
  }, [isPending, onPendingChange]);

  // Render-time reconciliation when useActionState emits a new submission result:
  // updates formState in the same render pass without a post-commit useEffect cascade.
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.success && !state._superseded) {
      setHasPendingMetadataRetry(false);
      const nextBaselineValues: ProfileSetupFormValues | null = state.values
        ? {
            full_name: state.values.full_name ?? formState.values.full_name,
            email: emailVerified
              ? contactEmailProp
              : (state.values.email ?? formState.values.email),
            phone: phoneVerified
              ? contactPhoneProp
              : (state.values.phone ?? formState.values.phone),
            current_role:
              state.values.current_role ?? formState.values.current_role,
            education: state.values.education ?? formState.values.education,
            experience_level:
              state.values.experience_level ??
              formState.values.experience_level,
            existing_skills_none:
              state.values.existing_skills_none ??
              formState.values.existing_skills_none,
            timezone:
              sanitizeIanaTimezone(state.values.timezone) ??
              sanitizeIanaTimezone(formState.values.timezone) ??
              'Asia/Dhaka',
            preferred_daily_hours:
              state.values.preferred_daily_hours ??
              formState.values.preferred_daily_hours,
          }
        : null;

      if (nextBaselineValues) {
        setSavedBaseline(nextBaselineValues);
      } else {
        setSavedBaseline(formState.values);
      }

      setFormState((prev) => {
        if (!nextBaselineValues) {
          return prev.hasDraft ? { ...prev, hasDraft: false } : prev;
        }
        return {
          hasDraft: false,
          educationTouched: false,
          values: nextBaselineValues,
        };
      });
    } else if (!state.success && !state._superseded && state.profile) {
      // Partial save (e.g. EP-P02/EP-P04 succeeded while Supabase metadata write failed):
      // advance baseline ONLY for server-committed profile fields while preserving all user inputs
      // and keeping Save Changes enabled until the metadata write succeeds.
      const committed = state.profile;
      setHasPendingMetadataRetry(true);
      setSavedBaseline((prev) => ({
        ...prev,
        current_role: committed.current_role ?? prev.current_role,
        education: committed.education ?? committed.education_level ?? '',
        experience_level: committed.experience_level ?? prev.experience_level,
        existing_skills_none:
          committed.experience_level === 'beginner'
            ? Boolean(committed.existing_skills_none)
            : false,
        timezone: sanitizeIanaTimezone(committed.timezone) ?? prev.timezone,
        preferred_daily_hours:
          committed.preferred_daily_hours !== null &&
          committed.preferred_daily_hours !== undefined
            ? String(committed.preferred_daily_hours)
            : prev.preferred_daily_hours,
      }));
    }
  }

  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { values, hasDraft, educationTouched } = formState;

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
  const displayedEmail = emailVerified ? contactEmailProp : values.email;
  const displayedPhone = phoneVerified ? contactPhoneProp : values.phone;

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
            existing_skills_none: baseline.existing_skills_none,
            timezone: draftTz,
            preferred_daily_hours: baseline.preferred_daily_hours,
          },
        };
      }

      return {
        hasDraft: false,
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
        educationTouched?: boolean;
      },
    ) => {
      dismissAlert();
      const currentState = stateRef.current;
      if (currentState.success) {
        setDismissedSuccessState(currentState);
      }
      const current = formStateRef.current;
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
        educationTouched: nextEducationTouched,
      };
      formStateRef.current = nextFormState;
      draftVersionRef.current += 1;
      setFormState(nextFormState);
      saveDraft(
        userId,
        updatedValues,
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

  const handleExperienceLevelChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      if (isPending) {
        return;
      }
      const nextLevel = e.target.value;
      dismissServerField('experience_level');
      setFieldError('experience_level', undefined);
      commitFieldPatch({ experience_level: nextLevel });
    },
    [commitFieldPatch, dismissServerField, isPending, setFieldError],
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
    }

    const resolvedSubmitTimezone =
      sanitizeIanaTimezone(values.timezone) ?? detectBrowserTimezone();
    const tzCheck = validateIanaTimezone(resolvedSubmitTimezone);
    if (!tzCheck.ok) {
      errors.timezone = tzCheck.error;
    }

    if (Object.keys(errors).length > 0) {
      e.preventDefault();
      dismissAlert();
      setClientErrors(errors);
      const firstInvalidKey = FIELD_ORDER.find((key) => Boolean(errors[key]));
      if (firstInvalidKey && typeof document !== 'undefined') {
        document.getElementById(firstInvalidKey)?.focus();
      }
      return;
    }

    setClientErrors({});
    if (state.success) {
      setDismissedSuccessState(state);
    }
  };

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
  const resolvedTimezone = sanitizeIanaTimezone(values.timezone) ?? 'Asia/Dhaka';
  const hasRequiredContact =
    emailVerified ||
    phoneVerified ||
    displayedEmail.trim().length > 0 ||
    displayedPhone.trim().length > 0;
  const showContactHelper = !hasRequiredContact;
  const isDirty =
    !isStandalone ||
    hasPendingMetadataRetry ||
    values.full_name.trim() !== savedBaseline.full_name.trim() ||
    (!emailVerified && values.email.trim() !== savedBaseline.email.trim()) ||
    (!phoneVerified && values.phone.trim() !== savedBaseline.phone.trim()) ||
    values.education.trim() !== savedBaseline.education.trim() ||
    values.current_role.trim() !== savedBaseline.current_role.trim() ||
    values.experience_level !== savedBaseline.experience_level;

  const canSubmit =
    values.full_name.trim().length > 0 &&
    values.current_role.trim().length > 0 &&
    values.experience_level.trim().length > 0 &&
    hasRequiredContact &&
    isDirty;

  return (
    <div className="flex flex-col gap-6">
      {isStandalone ? null : embedded ? (
        <div className="flex flex-col gap-1">
          <h1 dir="auto" className="text-heading-xl text-text-primary">
            Complete Your Profile
          </h1>
          <p dir="auto" className="text-body-sm text-text-secondary">
            Tell us who you are and your current experience level. Fields marked with{' '}
            <span aria-hidden="true" className="font-medium text-text-danger">
              *
            </span>
            <span className="sr-only">an asterisk</span> are required.
          </p>
        </div>
      ) : (
        /* Step 1 of 5 Modern Multi-Step Header */
        <OnboardingStepHeader currentStep={1} />
      )}

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
          {isStandalone ? 'Profile updated successfully.' : 'Profile saved.'}
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
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MemoizedInput
              id="email"
              name="email"
              variant="email"
              label="Email Address"
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
              readOnly={phoneVerified || isPending}
              labelBadge={phoneVerified ? VERIFIED_BADGE : undefined}
              value={displayedPhone}
              error={phoneError}
              placeholder="01XXXXXXXXX"
              onChange={handlePhoneChange}
            />
          </div>
          {showContactHelper && (
            <p className="text-caption text-text-secondary">
              Provide at least one contact method (email or phone).
            </p>
          )}
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

        {/* Core Profile Responsive Grid */}
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          {/* Grid Cell 1 (Left): Current Role / Profession (Required, 2-120 chars) */}
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

          {/* Grid Cell 2 (Right): Experience Level (Required, beginner | junior | mid | senior) */}
          <ExperienceLevelField
            selectRef={experienceSelectRef}
            value={values.experience_level}
            error={experienceLevelError}
            isPending={isPending}
            onChange={handleExperienceLevelChange}
          />
        </div>

        {/* Footer Actions Bar */}
        <ProfileFormFooter
          isPending={isPending}
          canSubmit={canSubmit}
          embedded={embedded}
          standalone={isStandalone}
          onBack={onBack}
        />
      </form>
    </div>
  );
}
