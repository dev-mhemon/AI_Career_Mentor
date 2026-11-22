'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createDailyPlan,
  createIdempotencyKey,
  getDailyPlan,
  rebuildDailyPlan,
  type DailyPlanResponseDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { ClockIcon, MinusIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';

const PRESET_HOURS = [0.5, 1, 1.5, 2, 3, 4] as const;
const MIN_HOURS = 0.5;
const MAX_HOURS = 12;
const DETERMINISTIC_HTTP_STATUSES = new Set([400, 403, 404, 409, 422, 429]);

export interface HoursPromptModalProps {
  open: boolean;
  mode: 'create' | 'rebuild';
  accessToken: string;
  roadmapId: string;
  roadmapTitle?: string;
  planId?: string;
  initialHours?: number | null;
  onClose: () => void;
  onSuccess: (plan: DailyPlanResponseDTO) => void;
}

function parseHoursInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < MIN_HOURS || num > MAX_HOURS) {
    return null;
  }
  const doubled = num * 2;
  if (!Number.isInteger(doubled)) {
    return null;
  }
  return doubled / 2;
}

function formatHoursLabel(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours}h`;
}

interface HoursPromptFormProps {
  mode: 'create' | 'rebuild';
  accessToken: string;
  roadmapId: string;
  roadmapTitle?: string;
  planId?: string;
  initialHours?: number | null;
  submitting: boolean;
  onSubmittingChange: (submitting: boolean) => void;
  onClose: () => void;
  onSuccess: (plan: DailyPlanResponseDTO) => void;
}

function HoursPromptForm({
  mode,
  accessToken,
  roadmapId,
  roadmapTitle,
  planId,
  initialHours,
  submitting,
  onSubmittingChange,
  onClose,
  onSuccess,
}: HoursPromptFormProps) {
  const defaultValue =
    typeof initialHours === 'number' &&
    Number.isFinite(initialHours) &&
    initialHours >= MIN_HOURS &&
    initialHours <= MAX_HOURS
      ? String(Math.round(initialHours * 2) / 2)
      : '';

  const [hoursInput, setHoursInput] = useState<string>(defaultValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<MappedError | null>(null);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(null);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState(0);

  const pendingCreateKeyRef = useRef<{ signature: string; key: string } | null>(
    null,
  );

  useEffect(() => {
    if (cooldownUntilMs === null) {
      return;
    }
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldownUntilMs - Date.now()) / 1_000),
      );
      if (remaining <= 0) {
        setCooldownUntilMs(null);
        setCooldownSecondsLeft(0);
      } else {
        setCooldownSecondsLeft(remaining);
      }
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [cooldownUntilMs]);

  const cooldownActive = cooldownUntilMs !== null && cooldownSecondsLeft > 0;
  const parsedHours = parseHoursInput(hoursInput);
  const isCreate = mode === 'create';

  const adjustHours = (delta: number) => {
    const base = parsedHours ?? 1;
    const next = Math.min(
      MAX_HOURS,
      Math.max(MIN_HOURS, Math.round((base + delta) * 2) / 2),
    );
    setHoursInput(String(next));
    setValidationError(null);
    setSubmitError(null);
  };

  const selectPreset = (hours: number) => {
    setHoursInput(String(hours));
    setValidationError(null);
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || cooldownActive) {
      return;
    }

    const validated = parseHoursInput(hoursInput);
    if (validated === null) {
      setValidationError(
        'Enter daily study hours between 0.5 and 12 in 0.5-hour increments.',
      );
      return;
    }
    if (!isCreate && !planId) {
      setValidationError('Missing Daily Plan identifier for rebuild.');
      return;
    }

    setValidationError(null);
    setSubmitError(null);
    onSubmittingChange(true);

    try {
      let plan: DailyPlanResponseDTO;
      if (isCreate) {
        const signature = `${roadmapId}:${validated}`;
        const idempotencyKey =
          pendingCreateKeyRef.current?.signature === signature
            ? pendingCreateKeyRef.current.key
            : createIdempotencyKey();
        pendingCreateKeyRef.current = { signature, key: idempotencyKey };

        plan = await createDailyPlan(
          accessToken,
          { roadmap_id: roadmapId, hours_per_day: validated },
          idempotencyKey,
        );
        pendingCreateKeyRef.current = null;
      } else {
        plan = await rebuildDailyPlan(accessToken, planId!, {
          hours_per_day: validated,
        });
      }
      onSubmittingChange(false);
      onSuccess(plan);
    } catch (err) {
      if (
        isCreate &&
        err instanceof ApiError &&
        err.code === 'DAILY_PLAN_EXISTS'
      ) {
        pendingCreateKeyRef.current = null;
        try {
          const existing = await getDailyPlan(accessToken, {
            roadmap_id: roadmapId,
            limit: 20,
          });
          onSubmittingChange(false);
          onSuccess(existing.plan);
          return;
        } catch {
          // Fall through to mapped error if recovery fetch fails.
        }
      }
      if (
        isCreate &&
        err instanceof ApiError &&
        DETERMINISTIC_HTTP_STATUSES.has(err.statusCode)
      ) {
        pendingCreateKeyRef.current = null;
      }
      const mapped = mapApiError(err);
      if (
        err instanceof ApiError &&
        err.statusCode === 429 &&
        typeof mapped.retryAfterSeconds === 'number' &&
        mapped.retryAfterSeconds > 0
      ) {
        const secs = Math.max(1, Math.ceil(mapped.retryAfterSeconds));
        setCooldownUntilMs(Date.now() + secs * 1_000);
        setCooldownSecondsLeft(secs);
      }
      setSubmitError(mapped);
    } finally {
      onSubmittingChange(false);
    }
  };

  const weeklyHours =
    parsedHours !== null ? Number((parsedHours * 7).toFixed(1)) : null;

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <Modal.Header>
        <div className="min-w-0">
          <Modal.Title>
            {isCreate
              ? 'Confirm Daily Learning Hours'
              : 'Rebuild Daily Plan'}
          </Modal.Title>
          <Modal.Description>
            {isCreate
              ? `Choose how many hours per day you can study${roadmapTitle ? ` for ${roadmapTitle}` : ''}. Your confirmed hours will also be saved to your profile.`
              : `Update your daily study pace${roadmapTitle ? ` for ${roadmapTitle}` : ''}. Only future pending days will be re-sequenced.`}
          </Modal.Description>
        </div>
        <Modal.Close disabled={submitting} />
      </Modal.Header>

      <Modal.Body className="flex flex-col gap-5">
        {!isCreate && (
          <Alert variant="info" role="status">
            Rebuilding never changes your locked roadmap, completed days, or any
            day with an in-progress quiz.
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-label-md font-medium text-text-primary">
            Quick select
          </span>
          <div
            role="group"
            aria-label="Daily learning hours presets"
            className="flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap"
          >
            {PRESET_HOURS.map((preset) => {
              const selected = parsedHours === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={submitting}
                  aria-pressed={selected}
                  onClick={() => selectPreset(preset)}
                  className={cn(
                    'inline-flex h-10 min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3.5 text-label-md font-medium leading-none transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50',
                    selected
                      ? 'border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-400 dark:bg-teal-950/60 dark:text-teal-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                  )}
                >
                  <ClockIcon className="block h-3.5 w-3.5 shrink-0" />
                  <span>{formatHoursLabel(preset)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="daily-hours-input"
            className="text-label-md font-medium text-text-primary"
          >
            Hours per day (0.5 – 12, step 0.5)
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease daily hours by 0.5"
              disabled={
                submitting ||
                (parsedHours !== null && parsedHours <= MIN_HOURS)
              }
              onClick={() => adjustHours(-0.5)}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <MinusIcon className="block h-4 w-4 shrink-0" />
            </button>
            <input
              id="daily-hours-input"
              name="hours_per_day"
              type="number"
              inputMode="decimal"
              min={MIN_HOURS}
              max={MAX_HOURS}
              step={0.5}
              placeholder="e.g. 2"
              value={hoursInput}
              disabled={submitting}
              aria-invalid={validationError ? 'true' : undefined}
              aria-describedby="daily-hours-hint"
              onChange={(e) => {
                setHoursInput(e.target.value);
                setValidationError(null);
                setSubmitError(null);
              }}
              className={cn(
                'h-11 min-w-0 flex-1 rounded-lg border bg-surface-default px-3.5 text-center font-mono text-body-md font-semibold tabular-nums text-text-primary outline-none transition-colors focus:border-border-focus focus:ring-2 focus:ring-focus-ring/25',
                validationError
                  ? 'border-border-danger'
                  : 'border-border-strong',
              )}
            />
            <button
              type="button"
              aria-label="Increase daily hours by 0.5"
              disabled={
                submitting ||
                (parsedHours !== null && parsedHours >= MAX_HOURS)
              }
              onClick={() => adjustHours(0.5)}
              className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <svg
                width={16}
                height={16}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
                className="block h-4 w-4 shrink-0"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          <p
            id="daily-hours-hint"
            className={cn(
              'text-caption',
              validationError ? 'text-text-danger' : 'text-text-secondary',
            )}
          >
            {validationError
              ? validationError
              : weeklyHours !== null
                ? `Approx. ${weeklyHours} hours / week across sequential learning days (missed calendar days never skip content).`
                : 'Select a preset or enter your available hours per day (0.5 to 12 in 0.5 steps).'}
          </p>
        </div>

        {submitError && (
          <Alert
            variant={
              submitError.tone === 'info'
                ? 'info'
                : submitError.tone === 'warning'
                  ? 'warning'
                  : 'error_retryable'
            }
            role="alert"
            retryAfterSeconds={submitError.retryAfterSeconds}
          >
            {submitError.message}
          </Alert>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button
          type="button"
          variant="secondary"
          disabled={submitting}
          onClick={onClose}
          className="w-full justify-center sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          loadingText={isCreate ? 'Creating plan...' : 'Rebuilding plan...'}
          disabled={submitting || cooldownActive}
          className="w-full justify-center sm:w-auto"
        >
          {cooldownActive
            ? `Retry in ${cooldownSecondsLeft}s`
            : isCreate
              ? 'Create Daily Plan'
              : 'Save & Rebuild Plan'}
        </Button>
      </Modal.Footer>
    </form>
  );
}

/**
 * Reusable `Modal` (`hours_prompt` variant, Spec #10) for confirming daily learning hours
 * across `/today`, `/daily-plan`, `/dashboard`, and M06 Lock/Focus handoffs.
 */
export function HoursPromptModal({
  open,
  mode,
  accessToken,
  roadmapId,
  roadmapTitle,
  planId,
  initialHours,
  onClose,
  onSuccess,
}: HoursPromptModalProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleClose = () => {
    if (submitting) {
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      disableClose={submitting}
      size="md"
    >
      <HoursPromptForm
        mode={mode}
        accessToken={accessToken}
        roadmapId={roadmapId}
        roadmapTitle={roadmapTitle}
        planId={planId}
        initialHours={initialHours}
        submitting={submitting}
        onSubmittingChange={setSubmitting}
        onClose={handleClose}
        onSuccess={onSuccess}
      />
    </Modal>
  );
}
