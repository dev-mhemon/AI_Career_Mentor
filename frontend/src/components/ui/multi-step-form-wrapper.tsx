import { memo, type ReactNode } from 'react';
import { cn } from './cn';
import { Alert } from './alert';
import type { ErrorTone } from '@/lib/api/error-mapper';

export const ONBOARDING_STEPS = [
  { number: 1, label: '1. Profile', title: 'Profile Setup' },
  { number: 2, label: '2. Skills', title: 'Skills' },
  { number: 3, label: '3. Preferences', title: 'Learning Preferences' },
  { number: 4, label: '4. Career Goal', title: 'Career Goal' },
  { number: 5, label: '5. Confirm Role', title: 'Clarify & Confirm' },
] as const;

export type OnboardingStepNumber = 1 | 2 | 3 | 4 | 5;

/**
 * Step progress header (`StepIndicator` contract): `role="progressbar"` + `aria-current="step"`.
 * Memoized so typing in step forms never re-renders the stepper.
 */
export const OnboardingStepHeader = memo(function OnboardingStepHeader({
  currentStep,
}: {
  currentStep: OnboardingStepNumber;
}) {
  const total = ONBOARDING_STEPS.length;
  const active = ONBOARDING_STEPS[currentStep - 1];
  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border-subtle bg-surface-subtle px-6 py-5">
      <div
        role="progressbar"
        aria-valuenow={currentStep}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuetext={`Step ${currentStep} of ${total}: ${active.title}`}
        aria-label={`Onboarding progress: Step ${currentStep} of ${total}`}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-label-lg font-semibold text-text-primary">
            {active.title}
          </span>
          <span className="inline-flex items-center rounded-full border border-border-default bg-surface-default px-2.5 py-0.5 text-caption font-medium text-text-secondary">
            Step {currentStep} of {total}
          </span>
        </div>
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 font-mono text-caption font-semibold tabular-nums text-teal-700 dark:text-teal-300">
          {Math.round((currentStep / total) * 100)}% Complete
        </span>
      </div>

      <ol aria-label="Onboarding steps" className="grid grid-cols-5 items-start">
          {ONBOARDING_STEPS.map((step, idx) => {
            const isActive = step.number === currentStep;
            const isDone = step.number < currentStep;
            const isLast = idx === total - 1;
            return (
              <li
                key={step.label}
                aria-current={isActive ? 'step' : undefined}
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
                    'relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-caption transition-all motion-reduce:transition-none',
                    isActive
                      ? 'bg-teal-500 font-semibold text-slate-950 ring-4 ring-teal-500/20'
                      : isDone
                        ? 'border border-teal-500 bg-teal-500/15 font-medium text-text-brand'
                        : 'border border-border-default bg-surface-default font-medium text-text-muted',
                  )}
                >
                  {isDone ? '✓' : step.number}
                </span>
                <span
                  className={cn(
                    'mt-2.5 text-[11px] leading-tight sm:text-caption',
                    isActive
                      ? 'font-semibold text-text-brand'
                      : 'text-text-muted',
                  )}
                >
                  {step.label}
                </span>
                {isDone && <span className="sr-only">(completed)</span>}
              </li>
            );
          })}
      </ol>
    </div>
  );
});

/** Maps a mapped-error tone to the matching `Alert` variant. */
export function toneToAlertVariant(
  tone: ErrorTone,
): 'info' | 'warning' | 'error_retryable' {
  return tone === 'error' ? 'error_retryable' : tone === 'info' ? 'info' : 'warning';
}

export type MultiStepFormStatus =
  | 'editing'
  | 'submitting'
  | 'saved_local'
  | 'network_error';

export interface MultiStepFormWrapperProps {
  currentStep: OnboardingStepNumber;
  heading?: string;
  description?: ReactNode;
  status?: MultiStepFormStatus;
  /** Inline error banner content (already mapped to safe copy). */
  errorMessage?: string | null;
  children: ReactNode;
  /** Footer slot: back / continue actions. */
  actions?: ReactNode;
}

/**
 * Component #09 `MultiStepFormWrapper` (`onboarding_wizard` variant).
 * Renders the 5-step header, the step body, a polite status region and the back/continue action slot.
 */
export function MultiStepFormWrapper({
  currentStep,
  heading,
  description,
  status = 'editing',
  errorMessage,
  children,
  actions,
}: MultiStepFormWrapperProps) {
  const submitting = status === 'submitting';
  return (
    <section
      aria-label={`Onboarding step ${currentStep} of ${ONBOARDING_STEPS.length}`}
      aria-busy={submitting ? 'true' : undefined}
      className="flex flex-col gap-6"
    >
      <OnboardingStepHeader currentStep={currentStep} />

      {(heading || description) && (
        <div className="flex flex-col gap-1">
          {heading && (
            <h1 dir="auto" className="text-heading-xl text-text-primary">
              {heading}
            </h1>
          )}
          {description && (
            <p dir="auto" className="text-body-sm text-text-secondary">
              {description}
            </p>
          )}
        </div>
      )}

      <div role="status" aria-live="polite" aria-busy="false" className="empty:hidden">
        {status === 'saved_local' && (
          <p className="text-caption text-feedback-success-text">
            ড্রাফট সংরক্ষিত (Saved locally)
          </p>
        )}
        {submitting && (
          <p className="text-caption text-text-secondary">Saving…</p>
        )}
      </div>

      {(errorMessage || status === 'network_error') && (
        <Alert variant="warning" role="alert">
          {errorMessage || 'Network problem. Your input is kept; try again.'}
        </Alert>
      )}

      <div aria-busy={submitting ? 'true' : undefined} className="flex flex-col gap-6">
        {children}
      </div>

      {actions && (
        <div className="flex flex-col-reverse gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
          {actions}
        </div>
      )}
    </section>
  );
}
