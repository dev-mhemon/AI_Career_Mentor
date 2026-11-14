'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateLearningSettingsAction,
  type LearningSettingsActionState,
  type LearningSettingsFormValues,
} from '@/lib/profile/actions';
import type { ProfileResponse } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircleIcon } from '@/components/ui/icons';
import { cn } from '@/components/ui/cn';

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

  const handleHoursChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
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
        className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
      >
        <h2
          id="learning-settings-heading"
          className="text-heading-sm text-text-primary"
        >
          শেখার সেটিংস (Learning Settings)
        </h2>
        <p className="mt-2 text-body-sm text-text-secondary">
          স্থগিত অ্যাকাউন্ট থেকে শেখার সেটিংস পরিবর্তন করা সম্ভব নয় (Learning settings cannot be modified while your account is suspended).
        </p>
      </section>
    );
  }

  const timezoneError = activeState.fieldErrors?.timezone;

  return (
    <section
      aria-labelledby="learning-settings-heading"
      className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="learning-settings-heading"
          className="text-heading-sm text-text-primary"
        >
          শেখার সেটিংস (Learning Settings)
        </h2>
        <p className="text-body-sm text-text-secondary">
          আপনার দৈনিক অধ্যয়নের লক্ষ্যমাত্রা এবং টাইমজোন নির্ধারণ করুন (Configure your daily study commitment and IANA timezone).
        </p>
      </div>

      {loadError && (
        <Alert
          variant="warning"
          role="alert"
          retryLabel="পুনরায় চেষ্টা করুন (Retry)"
          onRetry={() => {
            if (onRetry) {
              onRetry();
            } else {
              router.refresh();
            }
          }}
          className="mt-4"
        >
          {loadError}
        </Alert>
      )}

      {activeState.error && (
        <Alert
          variant={
            activeState.retryAfterSeconds && activeState.retryAfterSeconds > 0
              ? 'warning'
              : 'error_retryable'
          }
          role="alert"
          retryAfterSeconds={activeState.retryAfterSeconds}
          className="mt-4"
        >
          {activeState.error}
        </Alert>
      )}

      {activeState.success && activeState.message && (
        <Alert variant="success" role="status" className="mt-4">
          {activeState.message}
        </Alert>
      )}

      <form action={formAction} className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor="learning-timezone"
              className="text-label-lg text-text-primary"
            >
              টাইমজোন (IANA Timezone)
            </label>
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={isPending || Boolean(loadError)}
              onClick={handleAutoDetect}
            >
              স্বয়ংক্রিয়ভাবে শনাক্ত করুন (Auto-detect)
            </Button>
          </div>
          <input
            id="learning-timezone"
            name="timezone"
            type="text"
            required
            disabled={Boolean(loadError)}
            readOnly={isPending}
            value={values.timezone}
            onChange={handleTimezoneChange}
            placeholder="Asia/Dhaka"
            aria-invalid={Boolean(timezoneError)}
            aria-describedby={timezoneError ? 'learning-timezone-error' : undefined}
            className={cn(
              'min-h-11 w-full rounded-md border bg-surface-default px-3 py-2 text-body text-text-primary placeholder:text-text-muted',
              'transition-colors duration-(--duration-fast) ease-standard',
              'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled read-only:bg-surface-subtle',
              timezoneError
                ? 'border-border-danger border-2'
                : 'border-border-default hover:border-border-strong focus:border-border-focus',
            )}
          />
          {timezoneError && (
            <p
              id="learning-timezone-error"
              role="alert"
              className="flex items-start gap-1 text-caption text-text-danger"
            >
              <AlertCircleIcon className="mt-0.5 shrink-0" />
              <span>{timezoneError}</span>
            </p>
          )}
        </div>

        <Input
          id="learning-preferred-daily-hours"
          name="preferred_daily_hours"
          variant="number"
          label="দৈনিক অধ্যয়নের সময় — ঘণ্টা (Preferred Daily Hours)"
          min="0.5"
          max="12"
          step="0.5"
          required
          disabled={Boolean(loadError)}
          readOnly={isPending}
          value={values.preferred_daily_hours}
          onChange={handleHoursChange}
          placeholder="2"
          error={activeState.fieldErrors?.preferred_daily_hours}
          hint="০.৫ থেকে ১২ ঘণ্টার মধ্যে (০.৫ ঘণ্টার ধাপে, যেমন ১.৫ বা ২.০)।"
        />

        <div className="pt-1">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isPending}
            loadingText="সংরক্ষণ করা হচ্ছে... (Saving...)"
            disabled={Boolean(loadError)}
          >
            সেটিংস সংরক্ষণ করুন (Save Learning Settings)
          </Button>
        </div>
      </form>
    </section>
  );
}
