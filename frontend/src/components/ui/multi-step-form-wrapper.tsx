import { memo, type ReactNode } from 'react';
import { Alert } from './alert';
import { Stepper } from './stepper';
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
    <Stepper
      title={active.title}
      stepCounterText={`Step ${currentStep} of ${total}`}
      percentComplete={Math.round((currentStep / total) * 100)}
      ariaLabel="Onboarding steps"
      progressAriaLabel={`Onboarding progress: Step ${currentStep} of ${total}`}
      progressValueNow={currentStep}
      progressValueMin={1}
      progressValueMax={total}
      progressValueText={`Step ${currentStep} of ${total}: ${active.title}`}
      steps={ONBOARDING_STEPS.map((step) => ({
        id: String(step.number),
        label: step.label,
        status:
          step.number === currentStep
            ? 'current'
            : step.number < currentStep
              ? 'completed'
              : 'upcoming',
      }))}
    />
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
