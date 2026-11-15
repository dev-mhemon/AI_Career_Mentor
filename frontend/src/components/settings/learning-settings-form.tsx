'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
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

const COMMON_TIMEZONES: readonly string[] = [
  'Asia/Dhaka',
  'UTC',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Karachi',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const SELECT_BASE_CLASS =
  'min-h-11 w-full cursor-pointer appearance-none truncate rounded-md border bg-surface-default py-2 pl-3 pr-10 text-body text-text-primary transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled';

const LEGACY_SAVED_SUFFIX = '(Learning settings saved successfully).';

function getSupportedTimezones(): readonly string[] {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      const zones = Intl.supportedValuesOf('timeZone');
      if (Array.isArray(zones) && zones.length > 0) {
        return zones;
      }
    }
  } catch {
    // Fall back to COMMON_TIMEZONES when runtime lacks supportedValuesOf('timeZone')
  }
  return COMMON_TIMEZONES;
}

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
    timezone: profile?.timezone?.trim() || 'Asia/Dhaka',
    preferred_daily_hours:
      profile?.preferred_daily_hours !== null &&
      profile?.preferred_daily_hours !== undefined
        ? String(profile.preferred_daily_hours)
        : '2',
  };
}

/**
 * Screen 22 (`/settings`) Learning Preferences Form component (`EP-P04`).
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

  const timezoneSelectRef = useRef<HTMLSelectElement | null>(null);
  const [values, setValues] = useState<LearningSettingsFormValues>(() =>
    buildInitialValues(initialProfile),
  );
  const [dismissedState, setDismissedState] =
    useState<LearningSettingsActionState | null>(null);
  const [clearedTimezoneErrorState, setClearedTimezoneErrorState] =
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

  useEffect(() => {
    // React 19 calls HTMLFormElement.reset() after <form action={...}> completes;
    // keep the controlled select's DOM value synchronized with state.
    if (timezoneSelectRef.current && timezoneSelectRef.current.value !== values.timezone) {
      timezoneSelectRef.current.value = values.timezone;
    }
  }, [values.timezone, state]);

  const activeState = state === dismissedState ? {} : state;
  const isTimezoneErrorCleared = clearedTimezoneErrorState === state;

  const handleAutoDetect = () => {
    const detected = detectBrowserTimezone();
    setClearedTimezoneErrorState(state);
    if (!state.fieldErrors?.preferred_daily_hours) {
      setDismissedState(state);
    }
    setIsDirty(true);
    setValues((prev) => ({
      ...prev,
      timezone: detected,
    }));
  };

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDismissedState(state);
    setClearedTimezoneErrorState(state);
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
          Learning Settings
        </h2>
        <p className="mt-2 text-body-sm text-text-secondary">
          Learning settings cannot be modified while your account is suspended.
        </p>
      </section>
    );
  }

  const timezoneError = isTimezoneErrorCleared
    ? undefined
    : activeState.fieldErrors?.timezone;

  const globalError =
    activeState.error &&
    !(
      isTimezoneErrorCleared &&
      state.fieldErrors?.timezone &&
      activeState.error === state.fieldErrors.timezone
    )
      ? activeState.error
      : undefined;

  const timezoneOptions = (() => {
    const seen = new Set<string>(COMMON_TIMEZONES);
    for (const tz of getSupportedTimezones()) {
      seen.add(tz);
    }
    const trimmedTimezone = values.timezone?.trim();
    if (trimmedTimezone) {
      seen.add(trimmedTimezone);
    }
    return Array.from(seen);
  })();

  const successMessage =
    activeState.message && activeState.message.includes(LEGACY_SAVED_SUFFIX)
      ? 'Learning settings saved successfully.'
      : activeState.message;

  const timezoneDescribedBy = timezoneError
    ? 'learning-timezone-error'
    : undefined;

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
          Learning Settings
        </h2>
        <p className="text-body-sm text-text-secondary">
          Configure your daily study schedule and local timezone.
        </p>
      </div>

      {loadError && (
        <Alert
          variant="warning"
          role="alert"
          retryLabel="Retry"
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

      {globalError && (
        <Alert
          variant={
            activeState.retryAfterSeconds && activeState.retryAfterSeconds > 0
              ? 'warning'
              : 'error_retryable'
          }
          role="alert"
          retryAfterSeconds={activeState.retryAfterSeconds}
          resetKey={activeState}
          className="mt-4"
        >
          {globalError}
        </Alert>
      )}

      {activeState.success && successMessage && (
        <Alert variant="success" role="status" className="mt-4">
          {successMessage}
        </Alert>
      )}

      <form action={formAction} className="mt-5 flex flex-col gap-5">
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="learning-timezone"
                className="text-label-lg text-text-primary"
              >
                Timezone
              </label>
              <button
                type="button"
                disabled={isPending || Boolean(loadError)}
                onClick={handleAutoDetect}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-700 transition-colors hover:border-teal-500/60 hover:bg-teal-500/20 dark:text-teal-300 disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  focusable="false"
                  className="shrink-0"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                  <path d="M2 12h20" />
                </svg>
                <span>Auto-detect</span>
              </button>
            </div>

            <div className="group relative">
              <select
                ref={timezoneSelectRef}
                id="learning-timezone"
                name="timezone"
                required
                disabled={Boolean(loadError)}
                aria-disabled={isPending || undefined}
                tabIndex={isPending ? -1 : undefined}
                value={values.timezone}
                onChange={handleTimezoneChange}
                aria-invalid={Boolean(timezoneError)}
                aria-describedby={timezoneDescribedBy}
                className={cn(
                  SELECT_BASE_CLASS,
                  timezoneError
                    ? 'border-border-danger border-2 focus:outline-none focus:ring-2 focus:ring-border-danger'
                    : 'border-border-default hover:border-border-strong focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-focus-ring',
                  isPending &&
                    'pointer-events-none bg-surface-subtle opacity-(--opacity-disabled)',
                )}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
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
            label="Preferred Daily Hours"
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
          />
        </div>

        <div className="pt-1">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isPending}
            loadingText="Saving..."
            disabled={Boolean(loadError)}
          >
            Save
          </Button>
        </div>
      </form>
    </section>
  );
}
