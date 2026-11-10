'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateLearningSettingsAction,
  type LearningSettingsActionState,
  type LearningSettingsFormValues,
} from '@/lib/profile/actions';
import type { ProfileResponse } from '@/lib/api/client';

/**
 * Properties for the `LearningSettingsForm` component on Screen 22 (`/settings`).
 */
export interface LearningSettingsFormProps {
  /** Initial profile snapshot loaded from EP-P01 (`GET /api/v1/profile`), or null if unavailable. */
  initialProfile?: ProfileResponse | null;
  /** Non-fatal error message if loading initial profile settings failed. */
  loadError?: string;
  /** Whether the user account is currently suspended. */
  isSuspended?: boolean;
  /** Optional custom retry handler when loadError is present; defaults to router.refresh(). */
  onRetry?: () => void;
}

/**
 * Resolves the browser's IANA time zone when triggered by user interaction, falling back to `Asia/Dhaka`.
 */
function detectBrowserTimezone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof resolved === 'string' && resolved.trim().length > 0
      ? resolved.trim()
      : 'Asia/Dhaka';
  } catch {
    return 'Asia/Dhaka';
  }
}

/**
 * Builds SSR-deterministic initial form values from the server-provided profile snapshot.
 */
function buildInitialValues(
  profile?: ProfileResponse | null,
): LearningSettingsFormValues {
  return {
    timezone: profile?.timezone ?? 'Asia/Dhaka',
    preferred_daily_hours:
      profile?.preferred_daily_hours !== null &&
      profile?.preferred_daily_hours !== undefined
        ? String(profile.preferred_daily_hours)
        : '2',
  };
}

/**
 * Screen 22 (`/settings`) Learning Settings Form component (`EP-P04`).
 * Allows active users to configure their IANA timezone and preferred daily study hours (`0.5` to `12.0` in `0.5` increments).
 */
export function LearningSettingsForm({
  initialProfile = null,
  loadError,
  isSuspended = false,
  onRetry,
}: LearningSettingsFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    LearningSettingsActionState,
    FormData
  >(updateLearningSettingsAction, {});

  const [values, setValues] = useState<LearningSettingsFormValues>(() =>
    buildInitialValues(initialProfile),
  );
  const [dismissedState, setDismissedState] =
    useState<LearningSettingsActionState | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const [prevHadLoadError, setPrevHadLoadError] = useState(Boolean(loadError));
  const [syncedProfileSnapshot, setSyncedProfileSnapshot] = useState<{
    timezone: string | null;
    preferred_daily_hours: number | null;
  }>(() => ({
    timezone: initialProfile?.timezone ?? null,
    preferred_daily_hours: initialProfile?.preferred_daily_hours ?? null,
  }));
  const [prevSuccessfulState, setPrevSuccessfulState] = useState(state);

  if (state !== prevSuccessfulState) {
    setPrevSuccessfulState(state);
    if (state?.success) {
      setIsDirty(false);
      if (state.values) {
        setValues({
          timezone: state.values.timezone,
          preferred_daily_hours: state.values.preferred_daily_hours,
        });
      }
    }
  }

  const incomingTimezone = initialProfile?.timezone ?? null;
  const incomingHours = initialProfile?.preferred_daily_hours ?? null;
  const currentHadLoadError = Boolean(loadError);
  const incomingProfileChanged =
    incomingTimezone !== syncedProfileSnapshot.timezone ||
    incomingHours !== syncedProfileSnapshot.preferred_daily_hours;

  // Render-time profile snapshot reconciliation and convergence invariant:
  // When props (initialProfile or loadError) change, setSyncedProfileSnapshot updates
  // syncedProfileSnapshot to match incomingTimezone and incomingHours (strictly normalized as string | null
  // and number | null, including null === null when initialProfile is null or fields are omitted),
  // and setPrevHadLoadError records currentHadLoadError.
  // On the immediate re-render triggered by React state updates during render, incomingProfileChanged is false
  // and currentHadLoadError === prevHadLoadError, guaranteeing single-pass convergence without infinite loops.
  if (currentHadLoadError !== prevHadLoadError || incomingProfileChanged) {
    setPrevHadLoadError(currentHadLoadError);
    setSyncedProfileSnapshot({
      timezone: incomingTimezone,
      preferred_daily_hours: incomingHours,
    });

    const justClearedLoadError = prevHadLoadError && !currentHadLoadError;
    const shouldSync =
      (justClearedLoadError || (!isDirty && incomingProfileChanged)) &&
      !currentHadLoadError &&
      Boolean(initialProfile);

    if (shouldSync && initialProfile) {
      setValues(buildInitialValues(initialProfile));
      if (justClearedLoadError) {
        setIsDirty(false);
      }
    }
  }

  const activeState = state === dismissedState ? {} : state;

  const handleAutoDetect = () => {
    setDismissedState(state);
    setIsDirty(true);
    setValues((prev) => ({
      ...prev,
      timezone: detectBrowserTimezone(),
    }));
  };

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDismissedState(state);
    setIsDirty(true);
    setValues((prev) => ({ ...prev, timezone: e.target.value }));
  };

  const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDismissedState(state);
    setIsDirty(true);
    setValues((prev) => ({
      ...prev,
      preferred_daily_hours: e.target.value,
    }));
  };

  if (isSuspended) {
    return (
      <section
        aria-labelledby="learning-settings-heading"
        className="rounded-lg border border-foreground/15 bg-background p-5"
      >
        <h2
          id="learning-settings-heading"
          className="text-base font-semibold text-foreground"
        >
          শেখার সেটিংস (Learning Settings)
        </h2>
        <p className="mt-2 text-sm text-foreground/60">
          স্থগিত অ্যাকাউন্ট থেকে শেখার সেটিংস পরিবর্তন করা সম্ভব নয় (Learning settings cannot be modified while your account is suspended).
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="learning-settings-heading"
      className="rounded-lg border border-foreground/15 bg-background p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="learning-settings-heading"
          className="text-base font-semibold text-foreground"
        >
          শেখার সেটিংস (Learning Settings)
        </h2>
        <p className="text-sm text-foreground/60">
          আপনার দৈনিক অধ্যয়নের লক্ষ্যমাত্রা এবং টাইমজোন নির্ধারণ করুন (Configure your daily study commitment and IANA timezone).
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              if (onRetry) {
                onRetry();
              } else {
                router.refresh();
              }
            }}
            className="shrink-0 font-medium underline underline-offset-4 hover:text-amber-950 dark:hover:text-amber-100"
          >
            পুনরায় চেষ্টা করুন (Retry)
          </button>
        </div>
      )}

      {activeState.error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {activeState.error}
        </div>
      )}

      {activeState.success && activeState.message && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200"
        >
          {activeState.message}
        </div>
      )}

      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="learning-timezone"
              className="text-sm font-medium text-foreground"
            >
              টাইমজোন (IANA Timezone)
            </label>
            <button
              type="button"
              disabled={isPending || Boolean(loadError)}
              onClick={handleAutoDetect}
              className="text-xs font-medium text-foreground/80 underline underline-offset-4 hover:text-foreground disabled:opacity-50"
            >
              স্বয়ংক্রিয়ভাবে শনাক্ত করুন (Auto-detect)
            </button>
          </div>
          <input
            id="learning-timezone"
            name="timezone"
            type="text"
            required
            disabled={isPending || Boolean(loadError)}
            value={values.timezone}
            onChange={handleTimezoneChange}
            placeholder="Asia/Dhaka"
            aria-invalid={Boolean(activeState.fieldErrors?.timezone)}
            aria-describedby={
              activeState.fieldErrors?.timezone
                ? 'learning-timezone-error'
                : undefined
            }
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
          />
          {activeState.fieldErrors?.timezone && (
            <p
              id="learning-timezone-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {activeState.fieldErrors.timezone}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="learning-preferred-daily-hours"
            className="text-sm font-medium text-foreground"
          >
            দৈনিক অধ্যয়নের সময় — ঘণ্টা (Preferred Daily Hours)
          </label>
          <input
            id="learning-preferred-daily-hours"
            name="preferred_daily_hours"
            type="number"
            min="0.5"
            max="12"
            step="0.5"
            required
            disabled={isPending || Boolean(loadError)}
            value={values.preferred_daily_hours}
            onChange={handleHoursChange}
            placeholder="2"
            aria-invalid={Boolean(
              activeState.fieldErrors?.preferred_daily_hours,
            )}
            aria-describedby={
              activeState.fieldErrors?.preferred_daily_hours
                ? 'learning-hours-error'
                : 'learning-hours-hint'
            }
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
          />
          <p id="learning-hours-hint" className="text-xs text-foreground/60">
            ০.৫ থেকে ১২ ঘণ্টার মধ্যে (০.৫ ঘণ্টার ধাপে, যেমন ১.৫ বা ২.০)।
          </p>
          {activeState.fieldErrors?.preferred_daily_hours && (
            <p
              id="learning-hours-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {activeState.fieldErrors.preferred_daily_hours}
            </p>
          )}
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={isPending || Boolean(loadError)}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
          >
            {isPending
              ? 'সংরক্ষণ করা হচ্ছে... (Saving...)'
              : 'সেটিংস সংরক্ষণ করুন (Save Learning Settings)'}
          </button>
        </div>
      </form>
    </section>
  );
}
