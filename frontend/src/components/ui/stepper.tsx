'use client';

import { cn } from './cn';

export type StepperStepStatus = 'completed' | 'current' | 'upcoming';

export interface StepperStep {
  id: string;
  label: string;
  status: StepperStepStatus;
  /**
   * For interactive steppers (`onStepClick` provided):
   * - `true`: step button is unlocked and clickable (unless `disabled` is true and status !== 'current').
   * - `false`: step button is locked/disabled (`aria-disabled="true"`).
   */
  interactive?: boolean;
  /**
   * Optional override when a revisited current step was already completed earlier.
   * Keeps the connector line filled and preserves `(completed)` screen-reader status.
   */
  completed?: boolean;
}

export interface StepperProps {
  steps: ReadonlyArray<StepperStep>;
  title: string;
  stepCounterText: string;
  percentComplete: number;
  onStepClick?: (stepId: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  progressAriaLabel?: string;
  progressValueNow?: number;
  progressValueMin?: number;
  progressValueMax?: number;
  progressValueText?: string;
  className?: string;
}

export function Stepper({
  steps,
  title,
  stepCounterText,
  percentComplete,
  onStepClick,
  disabled = false,
  ariaLabel = 'Steps',
  progressAriaLabel,
  progressValueNow,
  progressValueMin = 0,
  progressValueMax = 100,
  progressValueText,
  className,
}: StepperProps) {
  const isInteractive = typeof onStepClick === 'function';
  const boundedPercent = Math.max(0, Math.min(100, percentComplete));
  const clampedPercent = Math.round(boundedPercent);
  const resolvedValueNow =
    progressValueNow ??
    progressValueMin +
      ((progressValueMax - progressValueMin) * boundedPercent) / 100;
  const resolvedProgressLabel =
    progressAriaLabel ?? `${title} (${stepCounterText})`;

  const stepList = (
    <ol
      role="list"
      aria-label={!isInteractive ? ariaLabel : undefined}
      className="relative flex items-start justify-between"
    >
      {steps.map((step, index) => {
        const isCurrent = step.status === 'current';
        const isCompleted = step.status === 'completed' || step.completed === true;
        const isLast = index === steps.length - 1;
        const stepNumber = index + 1;
        const isUnlocked =
          step.interactive !== undefined
            ? step.interactive
            : isCompleted || isCurrent;

        const circleClassName = cn(
          'relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-caption transition-colors duration-(--duration-fast) motion-reduce:transition-none',
          isCurrent
            ? 'bg-teal-500 font-semibold text-slate-950 ring-4 ring-teal-500/20'
            : isCompleted
              ? 'border border-teal-500 bg-[#e6f6f4] font-semibold text-teal-700 ring-2 ring-white group-hover:border-teal-600 group-hover:bg-teal-100 dark:bg-teal-950 dark:text-teal-300 dark:ring-slate-900 dark:group-hover:bg-teal-900'
              : isInteractive && isUnlocked
                ? 'border border-teal-500/60 bg-white font-medium text-text-primary ring-2 ring-white group-hover:border-teal-500 group-hover:bg-teal-50 dark:bg-slate-900 dark:ring-slate-900 dark:group-hover:bg-teal-950'
                : 'border border-border-default bg-white font-medium text-text-muted ring-2 ring-white dark:bg-slate-900 dark:ring-slate-900',
        );

        const connectorLine = !isLast ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-3.5 left-[calc(50%+14px)] z-0 h-0.5 w-[calc(100%-28px)] -translate-y-1/2 transition-colors duration-(--duration-fast)',
              isCompleted ? 'bg-teal-500/60' : 'bg-border-subtle',
            )}
          />
        ) : null;

        if (isInteractive) {
          const isLocked = !isUnlocked;
          const isButtonDisabled = isLocked || (disabled && !isCurrent);
          const canNavigate = isUnlocked && !isCurrent && !disabled;
          const buttonAriaLabel = isCompleted
            ? `${step.label} (completed)`
            : isCurrent
              ? `${step.label} (current step)`
              : step.label;

          return (
            <li
              key={step.id}
              className="relative flex flex-1 flex-col items-center px-1 text-center"
            >
              {connectorLine}
              <button
                type="button"
                disabled={isButtonDisabled}
                aria-disabled={isButtonDisabled ? 'true' : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={buttonAriaLabel}
                onClick={() => {
                  if (canNavigate) {
                    onStepClick(step.id);
                  }
                }}
                className={cn(
                  'group relative z-10 flex flex-col items-center rounded-lg px-1.5 transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
                  isButtonDisabled
                    ? 'cursor-not-allowed opacity-60'
                    : canNavigate
                      ? 'cursor-pointer'
                      : 'cursor-default',
                )}
              >
                <span aria-hidden="true" className={circleClassName}>
                  {isCompleted && !isCurrent ? '✓' : stepNumber}
                </span>
                <span
                  className={cn(
                    'mt-2.5 text-[11px] leading-tight transition-colors duration-(--duration-fast) sm:text-caption',
                    isCurrent
                      ? 'font-semibold text-text-brand'
                      : canNavigate
                        ? isCompleted
                          ? 'font-medium text-text-primary group-hover:text-text-brand'
                          : 'font-medium text-text-secondary group-hover:text-text-brand'
                        : 'text-text-muted',
                  )}
                >
                  {step.label}
                </span>
                {isCompleted && <span className="sr-only">(completed)</span>}
              </button>
            </li>
          );
        }

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex flex-1 flex-col items-center px-1 text-center"
          >
            {connectorLine}
            <span aria-hidden="true" className={circleClassName}>
              {isCompleted && !isCurrent ? '✓' : stepNumber}
            </span>
            <span
              className={cn(
                'mt-2.5 text-[11px] leading-tight sm:text-caption',
                isCurrent ? 'font-semibold text-text-brand' : 'text-text-muted',
              )}
            >
              {step.label}
            </span>
            {isCompleted && <span className="sr-only">(completed)</span>}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-5 rounded-xl bg-surface-subtle px-6 py-5',
        className,
      )}
    >
      <div
        role="progressbar"
        aria-valuenow={resolvedValueNow}
        aria-valuemin={progressValueMin}
        aria-valuemax={progressValueMax}
        aria-valuetext={progressValueText}
        aria-label={resolvedProgressLabel}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-label-lg font-semibold text-text-primary">
            {title}
          </span>
          <span className="inline-flex items-center rounded-full border border-border-default bg-surface-default px-2.5 py-0.5 text-caption font-medium text-text-secondary">
            {stepCounterText}
          </span>
        </div>
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 font-mono text-caption font-semibold tabular-nums text-teal-700 dark:text-teal-300">
          {clampedPercent}% Complete
        </span>
      </div>

      {isInteractive ? (
        <nav aria-label={ariaLabel}>{stepList}</nav>
      ) : (
        stepList
      )}
    </div>
  );
}
