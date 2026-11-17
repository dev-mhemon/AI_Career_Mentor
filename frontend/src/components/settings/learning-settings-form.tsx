'use client';

import {
  memo,
  type ChangeEvent,
  type RefObject,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  updateLearningSettingsAction,
  type LearningSettingsActionState,
  type LearningSettingsFormValues,
} from '@/lib/profile/actions';
import type { ProfileResponse } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Toast } from '@/components/ui/toast';
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

const MemoizedInput = memo(Input);

const AUTO_DETECT_GLOBE_ICON = (
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
);

const TIMEZONE_CHEVRON_ICON = (
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

const EMPTY_TIMEZONE_CATALOG: {
  list: readonly string[];
  set: ReadonlySet<string>;
} = {
  list: [],
  set: new Set<string>(),
};

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

function buildBaseTimezoneCatalog(): {
  list: readonly string[];
  set: ReadonlySet<string>;
} {
  const seen = new Set<string>(COMMON_TIMEZONES);
  for (const tz of getSupportedTimezones()) {
    seen.add(tz);
  }
  return {
    list: Array.from(seen),
    set: seen,
  };
}

const LearningSettingsHeader = memo(function LearningSettingsHeader() {
  return (
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
  );
});

const TimezoneSelectField = memo(function TimezoneSelectField({
  selectRef,
  value,
  options,
  error,
  disabled,
  isPending,
  onChange,
  onAutoDetect,
}: {
  selectRef: RefObject<HTMLSelectElement | null>;
  value: string;
  options: readonly string[];
  error?: string;
  disabled: boolean;
  isPending: boolean;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  onAutoDetect: () => void;
}) {
  const timezoneDescribedBy = error ? 'learning-timezone-error' : undefined;

  return (
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
          disabled={isPending || disabled}
          onClick={onAutoDetect}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-700 transition-colors hover:border-teal-500/60 hover:bg-teal-500/20 dark:text-teal-300 disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)"
        >
          {AUTO_DETECT_GLOBE_ICON}
          <span>Auto-detect</span>
        </button>
      </div>

      <div className="group relative">
        <select
          ref={selectRef}
          id="learning-timezone"
          name="timezone"
          required
          disabled={disabled}
          aria-disabled={isPending || undefined}
          tabIndex={isPending ? -1 : undefined}
          value={value}
          onChange={onChange}
          aria-invalid={Boolean(error)}
          aria-describedby={timezoneDescribedBy}
          className={cn(
            SELECT_BASE_CLASS,
            error
              ? 'border-border-danger border-2 focus:outline-none focus:ring-2 focus:ring-border-danger'
              : 'border-border-default hover:border-border-strong focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-focus-ring',
            isPending &&
              'pointer-events-none bg-surface-subtle opacity-(--opacity-disabled)',
          )}
        >
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {TIMEZONE_CHEVRON_ICON}
      </div>

      {error && (
        <p
          id="learning-timezone-error"
          role="alert"
          className="flex items-start gap-1 text-caption text-text-danger"
        >
          <AlertCircleIcon className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
});

const LearningSettingsFooter = memo(function LearningSettingsFooter({
  isPending,
  disabled,
}: {
  isPending: boolean;
  disabled: boolean;
}) {
  return (
    <div className="pt-1">
      <Button
        type="submit"
        variant="primary"
        size="lg"
        isLoading={isPending}
        loadingText="Saving..."
        disabled={disabled}
      >
        Save
      </Button>
    </div>
  );
});

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

  const baseTimezoneCatalog = useMemo(
    () => (isSuspended ? EMPTY_TIMEZONE_CATALOG : buildBaseTimezoneCatalog()),
    [isSuspended],
  );

  const timezoneOptions = useMemo(() => {
    if (isSuspended) {
      return EMPTY_TIMEZONE_CATALOG.list;
    }
    const trimmedTimezone = values.timezone?.trim();
    if (!trimmedTimezone || baseTimezoneCatalog.set.has(trimmedTimezone)) {
      return baseTimezoneCatalog.list;
    }
    return [...baseTimezoneCatalog.list, trimmedTimezone];
  }, [baseTimezoneCatalog, isSuspended, values.timezone]);

  const handleRetry = useCallback(() => {
    if (onRetry) {
      onRetry();
    } else {
      router.refresh();
    }
  }, [onRetry, router]);

  const handleAutoDetect = useCallback(() => {
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
  }, [state]);

  const handleTimezoneChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      setDismissedState(state);
      setClearedTimezoneErrorState(state);
      setIsDirty(true);
      setValues((prev) => ({ ...prev, timezone: e.target.value }));
    },
    [state],
  );

  const handleHoursChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDismissedState(state);
      setIsDirty(true);
      setValues((prev) => ({
        ...prev,
        preferred_daily_hours: e.target.value,
      }));
    },
    [state],
  );

  const handleDismissToast = useCallback(() => {
    setDismissedState(state);
  }, [state]);

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

  const hasLoadError = Boolean(loadError);

  return (
    <section
      aria-labelledby="learning-settings-heading"
      className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <LearningSettingsHeader />

      {loadError && (
        <Alert
          variant="warning"
          role="alert"
          retryLabel="Retry"
          onRetry={handleRetry}
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

      {activeState.success && (
        <Toast
          variant="success"
          role="status"
          ariaLive="polite"
          autoDismissMs={4000}
          onDismiss={handleDismissToast}
        >
          Learning settings saved.
        </Toast>
      )}

      <form action={formAction} className="mt-5 flex flex-col gap-5">
        <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
          <TimezoneSelectField
            selectRef={timezoneSelectRef}
            value={values.timezone}
            options={timezoneOptions}
            error={timezoneError}
            disabled={hasLoadError}
            isPending={isPending}
            onChange={handleTimezoneChange}
            onAutoDetect={handleAutoDetect}
          />

          <MemoizedInput
            id="learning-preferred-daily-hours"
            name="preferred_daily_hours"
            variant="number"
            label="Preferred Daily Hours"
            min="0.5"
            max="12"
            step="0.5"
            required
            disabled={hasLoadError}
            readOnly={isPending}
            value={values.preferred_daily_hours}
            onChange={handleHoursChange}
            placeholder="2"
            error={activeState.fieldErrors?.preferred_daily_hours}
          />
        </div>

        <LearningSettingsFooter isPending={isPending} disabled={hasLoadError} />
      </form>
    </section>
  );
}
