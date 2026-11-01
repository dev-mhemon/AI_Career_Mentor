'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  saveProfileSetupAction,
  type ProfileSetupActionState,
  type ProfileSetupFormValues,
} from '@/lib/profile/actions';
import type { ProfileResponse } from '@/lib/api/client';

const DRAFT_STORAGE_KEY = 'mentor_onboarding_profile_draft';

const ONBOARDING_STEPS = [
  '1. প্রোফাইল (Profile)',
  '2. স্কিলস (Skills)',
  '3. পছন্দ (Preferences)',
  '4. লক্ষ্য (Career Goal)',
  '5. নিশ্চিতকরণ (Confirm Level)',
];

/**
 * Props for the `ProfileSetupForm` component on Screen 07 (`/onboarding/profile`).
 */
export interface ProfileSetupFormProps {
  initialProfile: ProfileResponse | null;
  loadError?: string;
  userId?: string;
}

/**
 * Resolves the browser's IANA timezone or falls back to `Asia/Dhaka`.
 */
function detectBrowserTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof resolved === 'string' && resolved.trim().length > 0
      ? resolved
      : 'Asia/Dhaka';
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
 * Builds server-deterministic initial controlled form state using ONLY initialProfile props.
 * Avoids hydration mismatch by not reading window, sessionStorage, or browser Intl during initial render.
 */
function buildInitialState(
  profile: ProfileResponse | null,
): ProfileSetupFormValues {
  return {
    current_role: profile?.current_role ?? '',
    education: profile?.education ?? '',
    experience_level: profile?.experience_level ?? '',
    existing_skills_none: profile?.existing_skills_none ?? false,
    timezone: profile?.timezone ?? '',
    preferred_daily_hours:
      profile?.preferred_daily_hours !== null &&
      profile?.preferred_daily_hours !== undefined
        ? String(profile.preferred_daily_hours)
        : '',
  };
}

/**
 * Screen 07 (`/onboarding/profile`) client form component consuming EP-P01, EP-P02, and EP-P04.
 * Preserves optional education, explicit beginner `None`, and user inputs across failed loads/saves.
 * Enforces account-scoped draft isolation and SSR hydration safety.
 */
export function ProfileSetupForm({
  initialProfile,
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
  }>(() => ({
    values: buildInitialState(initialProfile),
    hasDraft: false,
    skillsNoneTouched: false,
  }));

  const [dismissedActionState, setDismissedActionState] =
    useState<ProfileSetupActionState | null>(null);
  const errorAlertRef = useRef<HTMLDivElement | null>(null);

  const { values, hasDraft, skillsNoneTouched } = formState;
  const effectiveProfile = state.profile ?? initialProfile;

  // Mount effect: safely restores draft from sessionStorage, detects timezone, and initializes skillsNoneTouched
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const detectedTz = detectBrowserTimezone();
    const fallbackTz = loadError ? '' : detectedTz;
    const storageKey = getDraftStorageKey(userId);
    let restoredValues: Partial<ProfileSetupFormValues> | null = null;
    let storedTouched: boolean | undefined = undefined;

    // 1. Unconditionally clean up legacy un-scoped draft when userId is present
    if (userId) {
      try {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Ignore legacy storage removal errors
      }
    }

    // 2. Read and parse account-scoped draft
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
          };
          const draftUserId =
            typeof draftObj.user_id === 'string' ? draftObj.user_id : undefined;

          // Account-scoped isolation: reject and clear draft belonging to another user
          if (userId && draftUserId && draftUserId !== userId) {
            window.sessionStorage.removeItem(storageKey);
          } else {
            const payloadValues =
              draftObj.values && typeof draftObj.values === 'object'
                ? (draftObj.values as Record<string, unknown>)
                : (parsed as Record<string, unknown>);

            if (payloadValues && typeof payloadValues === 'object') {
              restoredValues = payloadValues as Partial<ProfileSetupFormValues>;
              storedTouched =
                typeof draftObj.skills_none_touched === 'boolean'
                  ? draftObj.skills_none_touched
                  : typeof payloadValues.skills_none_touched === 'boolean'
                    ? (payloadValues.skills_none_touched as boolean)
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

    const serverTz = initialProfile?.timezone;
    const serverSkillsNone = Boolean(initialProfile?.existing_skills_none);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormState((prev) => {
      if (restoredValues) {
        const draftTz =
          typeof restoredValues.timezone === 'string' &&
          restoredValues.timezone.length > 0
            ? restoredValues.timezone
            : serverTz || fallbackTz;

        const draftSkillsNone =
          typeof restoredValues.existing_skills_none === 'boolean'
            ? restoredValues.existing_skills_none
            : serverSkillsNone;

        const isTouched =
          storedTouched !== undefined
            ? storedTouched
            : draftSkillsNone !== serverSkillsNone;

        return {
          hasDraft: true,
          skillsNoneTouched: isTouched,
          values: {
            current_role:
              typeof restoredValues?.current_role === 'string'
                ? restoredValues.current_role
                : prev.values.current_role,
            education:
              typeof restoredValues?.education === 'string'
                ? restoredValues.education
                : prev.values.education,
            experience_level:
              typeof restoredValues?.experience_level === 'string'
                ? restoredValues.experience_level
                : prev.values.experience_level,
            existing_skills_none:
              typeof restoredValues?.existing_skills_none === 'boolean'
                ? restoredValues.existing_skills_none
                : prev.values.existing_skills_none,
            timezone: draftTz,
            preferred_daily_hours:
              typeof restoredValues?.preferred_daily_hours === 'string'
                ? restoredValues.preferred_daily_hours
                : prev.values.preferred_daily_hours,
          },
        };
      }

      if (!serverTz && !loadError) {
        return {
          ...prev,
          values: {
            ...prev.values,
            timezone: prev.values.timezone || detectedTz,
          },
        };
      }

      return prev;
    });
  }, [initialProfile, loadError, userId]);

  const isActionStateDismissed = state === dismissedActionState;
  const isErrorDismissed = isActionStateDismissed;
  const isSuccessVisible = Boolean(state.success) && !isActionStateDismissed;

  // Effect 1: Success handling - clears draft and reconciles values when save succeeds
  useEffect(() => {
    if (state.success) {
      clearDraft(userId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormState((prev) => {
        if (!state.values) {
          return prev.hasDraft ? { ...prev, hasDraft: false } : prev;
        }

        return {
          hasDraft: false,
          skillsNoneTouched: false,
          values: {
            current_role: state.values.current_role ?? prev.values.current_role,
            education: state.values.education ?? prev.values.education,
            experience_level:
              state.values.experience_level ?? prev.values.experience_level,
            existing_skills_none:
              typeof state.values.existing_skills_none === 'boolean'
                ? state.values.existing_skills_none
                : prev.values.existing_skills_none,
            timezone: state.values.timezone ?? prev.values.timezone,
            preferred_daily_hours:
              state.values.preferred_daily_hours ??
              prev.values.preferred_daily_hours,
          },
        };
      });
    }
  }, [state, userId]);

  // Effect 2: Error alert focus - focuses alert when error occurs and is not dismissed
  useEffect(() => {
    if (state.error && !isErrorDismissed && errorAlertRef.current) {
      errorAlertRef.current.focus();
    }
  }, [state, isErrorDismissed]);

  /**
   * Updates a controlled field value, dismisses stale action errors/success banners, and persists the local draft in sessionStorage.
   */
  const updateField = <K extends keyof ProfileSetupFormValues>(
    key: K,
    nextValue: ProfileSetupFormValues[K],
    overrideTouched?: boolean,
  ) => {
    setDismissedActionState(state);
    const nextTouched = overrideTouched ?? skillsNoneTouched;
    const updatedValues: ProfileSetupFormValues = { ...values, [key]: nextValue };
    setFormState((prev) => ({
      ...prev,
      values: updatedValues,
      skillsNoneTouched: nextTouched,
    }));
    saveDraft(userId, updatedValues, nextTouched);
  };

  /**
   * Toggles the explicit beginner `None` (`existing_skills_none`) switch and persists touched state.
   */
  const handleToggleSkillsNone = () => {
    const nextSkillsNone = !values.existing_skills_none;
    updateField('existing_skills_none', nextSkillsNone, true);
  };

  const baselineSkillsNone = Boolean(effectiveProfile?.existing_skills_none);
  const effectiveSkillsNoneTouched =
    skillsNoneTouched || values.existing_skills_none !== baselineSkillsNone;
  const fieldErrors = isErrorDismissed ? {} : (state.fieldErrors ?? {});
  const storedSkills = effectiveProfile?.existing_skills ?? [];
  const showDraftRestored = hasDraft && !isSuccessVisible;

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1 of 5 Progress Indicator (C09 Component 04) */}
      <div
        role="progressbar"
        aria-valuenow={1}
        aria-valuemin={1}
        aria-valuemax={5}
        aria-label="Onboarding progress: Step 1 of 5"
        className="flex flex-col gap-2"
      >
        <div className="flex items-center justify-between text-xs font-medium text-foreground/70">
          <span>ধাপ ১ / ৫ (Step 1 of 5): প্রোফাইল সেটআপ (Profile Setup)</span>
          <span>20%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full w-1/5 rounded-full bg-foreground transition-all" />
        </div>
        <ol className="hidden gap-2 text-xs text-foreground/60 sm:grid sm:grid-cols-5">
          {ONBOARDING_STEPS.map((label, idx) => (
            <li
              key={label}
              className={
                idx === 0
                  ? 'font-semibold text-foreground'
                  : 'text-foreground/50'
              }
            >
              {label}
            </li>
          ))}
        </ol>
      </div>

      {/* Initial Profile Load Warning Banner (preserves form usability on failed GET /profile) */}
      {loadError && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          <p className="font-medium">প্রোফাইল লোড করা যায়নি (Profile load warning)</p>
          <p className="mt-1">{loadError}</p>
        </div>
      )}

      {showDraftRestored && (
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-foreground/70"
        >
          ড্রাফট সংরক্ষিত (Saved locally — unsaved changes restored).
        </p>
      )}

      {state.error && !isErrorDismissed && (
        <div
          ref={errorAlertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300 focus:outline-none"
        >
          <p>{state.error}</p>
          {state.retryAfterSeconds !== null &&
            state.retryAfterSeconds !== undefined && (
              <p className="mt-1 text-xs">
                অনুগ্রহ করে {state.retryAfterSeconds} সেকেন্ড পর আবার চেষ্টা করুন (Retry after{' '}
                {state.retryAfterSeconds}s).
              </p>
            )}
        </div>
      )}

      {isSuccessVisible && state.message && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-800 dark:text-green-200"
        >
          <p className="font-medium">{state.message}</p>
          <p className="mt-1 text-xs">
            আপনি এখন ড্যাশবোর্ডে যেতে পারেন। পরবর্তী ধাপগুলো (Skills, Preferences, Career Goal) M05-এ যুক্ত হবে।
          </p>
        </div>
      )}

      <form action={formAction} noValidate className="flex flex-col gap-5">
        {/* Current Role / Profession (Required, <= 120 chars) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="current_role"
            className="text-sm font-medium text-foreground"
          >
            বর্তমান পেশা বা ভূমিকা (Current Role / Profession) <span aria-hidden="true">*</span>
          </label>
          <input
            id="current_role"
            name="current_role"
            type="text"
            required
            maxLength={120}
            disabled={isPending}
            value={values.current_role}
            onChange={(e) => updateField('current_role', e.target.value)}
            aria-invalid={Boolean(fieldErrors.current_role)}
            aria-describedby={
              fieldErrors.current_role ? 'current_role-error' : 'current_role-hint'
            }
            placeholder="যেমন: Student, Frontend Developer, QA Engineer"
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
          />
          <p id="current_role-hint" className="text-xs text-foreground/60">
            সর্বোচ্চ ১২০ অক্ষর (Maximum 120 characters).
          </p>
          {fieldErrors.current_role && (
            <p id="current_role-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.current_role}
            </p>
          )}
        </div>

        {/* Education (Optional, <= 200 chars) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="education"
            className="text-sm font-medium text-foreground"
          >
            শিক্ষাগত যোগ্যতা — ঐচ্ছিক (Education — Optional)
          </label>
          <input
            id="education"
            name="education"
            type="text"
            maxLength={200}
            disabled={isPending}
            value={values.education}
            onChange={(e) => updateField('education', e.target.value)}
            aria-invalid={Boolean(fieldErrors.education)}
            aria-describedby={
              fieldErrors.education ? 'education-error' : 'education-hint'
            }
            placeholder="যেমন: BSc in CSE, Diploma in Engineering (ঐচ্ছিক / Optional)"
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
          />
          <p id="education-hint" className="text-xs text-foreground/60">
            এই তথ্যটি ঐচ্ছিক — ফাঁকা রাখা যাবে (Optional field — not required for profile completion).
          </p>
          {fieldErrors.education && (
            <p id="education-error" role="alert" className="text-xs text-red-600">
              {fieldErrors.education}
            </p>
          )}
        </div>

        {/* Experience Level (Required, beginner | junior | mid | senior — no forced junior fallback) */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="experience_level"
            className="text-sm font-medium text-foreground"
          >
            অভিজ্ঞতার স্তর (Experience Level) <span aria-hidden="true">*</span>
          </label>
          <select
            id="experience_level"
            name="experience_level"
            required
            disabled={isPending}
            value={values.experience_level}
            onChange={(e) => updateField('experience_level', e.target.value)}
            aria-invalid={Boolean(fieldErrors.experience_level)}
            aria-describedby={
              fieldErrors.experience_level
                ? 'experience_level-error'
                : 'experience_level-hint'
            }
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground focus:border-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
          >
            <option value="">
              অভিজ্ঞতার স্তর নির্বাচন করুন (Select experience level)
            </option>
            <option value="beginner">
              Beginner — সম্পূর্ণ নতুন / শিক্ষার্থী (Complete Beginner)
            </option>
            <option value="junior">
              Junior — প্রাথমিক পেশাদার অভিজ্ঞতা (Junior)
            </option>
            <option value="mid">
              Mid-Level — মধ্যম পর্যায়ের অভিজ্ঞতা (Mid-Level)
            </option>
            <option value="senior">
              Senior — অভিজ্ঞ পেশাদার (Senior)
            </option>
          </select>
          <p id="experience_level-hint" className="text-xs text-foreground/60">
            নতুনদের জন্য Beginner নির্বাচন করুন (Choose Beginner if starting from zero).
          </p>
          {fieldErrors.experience_level && (
            <p
              id="experience_level-error"
              role="alert"
              className="text-xs text-red-600"
            >
              {fieldErrors.experience_level}
            </p>
          )}
        </div>

        {/* Explicit Beginner "None" Skills Toggle (C01 §14 / C05 EP-P02 / C09 Component 08) */}
        <div className="flex flex-col gap-2 rounded-lg border border-foreground/15 bg-foreground/[0.02] p-4">
          <input
            type="hidden"
            name="existing_skills_none"
            value={values.existing_skills_none ? 'true' : 'false'}
          />
          <input
            type="hidden"
            name="existing_skills_none_touched"
            value={effectiveSkillsNoneTouched ? 'true' : 'false'}
          />
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span
                id="existing_skills_none_label"
                className="text-sm font-medium text-foreground"
              >
                আমার এখনো কোনো টেক স্কিল নেই (None — Complete Beginner)
              </span>
              <span
                id="existing_skills_none_hint"
                className="text-xs text-foreground/60"
              >
                নতুনদের জন্য বৈধ — কোনো কৃত্রিম স্কিল তৈরি করা হবে না (Valid for beginners; creates no fabricated skills).
              </span>
            </div>
            <button
              type="button"
              id="existing_skills_none_toggle"
              role="switch"
              aria-checked={values.existing_skills_none}
              aria-labelledby="existing_skills_none_label"
              aria-describedby="existing_skills_none_hint"
              disabled={isPending}
              onClick={handleToggleSkillsNone}
              className={`relative inline-flex h-11 min-w-[76px] items-center justify-center rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50 ${
                values.existing_skills_none
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-foreground/30 bg-background text-foreground'
              }`}
            >
              {values.existing_skills_none ? 'None: ON' : 'None: OFF'}
            </button>
          </div>

          {storedSkills.length > 0 && !values.existing_skills_none && (
            <div className="mt-1 text-xs text-foreground/70">
              <span>সংরক্ষিত স্কিল (Stored skills preserved): </span>
              <span className="font-medium">
                {storedSkills.map((s) => s.name).join(', ')}
              </span>
            </div>
          )}

          {(fieldErrors.existing_skills || fieldErrors.existing_skills_none) && (
            <p role="alert" className="text-xs text-red-600">
              {fieldErrors.existing_skills || fieldErrors.existing_skills_none}
            </p>
          )}
        </div>

        {/* IANA Timezone & Preferred Daily Hours (EP-P04) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="timezone"
              className="text-sm font-medium text-foreground"
            >
              টাইমজোন (IANA Timezone)
            </label>
            <input
              id="timezone"
              name="timezone"
              type="text"
              disabled={isPending}
              value={values.timezone}
              onChange={(e) => updateField('timezone', e.target.value)}
              aria-invalid={Boolean(fieldErrors.timezone)}
              aria-describedby={
                fieldErrors.timezone ? 'timezone-error' : 'timezone-hint'
              }
              placeholder="Asia/Dhaka"
              className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
            />
            <p id="timezone-hint" className="text-xs text-foreground/60">
              উদাহরণ: Asia/Dhaka, UTC
            </p>
            {fieldErrors.timezone && (
              <p id="timezone-error" role="alert" className="text-xs text-red-600">
                {fieldErrors.timezone}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="preferred_daily_hours"
              className="text-sm font-medium text-foreground"
            >
              দৈনিক শেখার সময় — ঘণ্টা (Preferred Daily Hours)
            </label>
            <input
              id="preferred_daily_hours"
              name="preferred_daily_hours"
              type="number"
              min="0.5"
              max="12"
              step="0.5"
              disabled={isPending}
              value={values.preferred_daily_hours}
              onChange={(e) =>
                updateField('preferred_daily_hours', e.target.value)
              }
              aria-invalid={Boolean(fieldErrors.preferred_daily_hours)}
              aria-describedby={
                fieldErrors.preferred_daily_hours
                  ? 'preferred_daily_hours-error'
                  : 'preferred_daily_hours-hint'
              }
              placeholder="2"
              className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
            />
            <p id="preferred_daily_hours-hint" className="text-xs text-foreground/60">
              ০.৫ থেকে ১২ ঘণ্টা, ০.৫ ধাপে (0.5 to 12 hours in 0.5 steps).
            </p>
            {fieldErrors.preferred_daily_hours && (
              <p
                id="preferred_daily_hours-error"
                role="alert"
                className="text-xs text-red-600"
              >
                {fieldErrors.preferred_daily_hours}
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons: Save Profile, Disabled M05 Next Step, and Working Skip to Dashboard */}
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={isPending}
            className="h-11 rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
          >
            {isPending
              ? 'সংরক্ষণ হচ্ছে... (Saving...)'
              : 'প্রোফাইল সংরক্ষণ করুন (Save Profile)'}
          </button>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-describedby="m05-step-note"
              className="h-11 cursor-not-allowed rounded-lg border border-foreground/15 px-4 text-sm font-medium text-foreground/40"
            >
              পরবর্তী: স্কিলস (Next: Skills — M05)
            </button>

            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-foreground/20 px-4 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              ড্যাশবোর্ডে যান (Skip to Dashboard)
            </Link>
          </div>
        </div>

        <p id="m05-step-note" className="text-xs text-foreground/60">
          দ্রষ্টব্য: প্রোফাইল সম্পূর্ণ না হলেও আপনি যেকোনো সময় ড্যাশবোর্ড ব্যবহার করতে পারবেন (Profile completion is only required before roadmap generation; Steps 2–5 are scheduled for Milestone M05).
        </p>
      </form>
    </div>
  );
}
