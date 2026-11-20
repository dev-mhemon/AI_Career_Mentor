import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import {
  MultiStepFormWrapper,
  type MultiStepFormStatus,
  type OnboardingStepNumber,
} from '@/components/ui/multi-step-form-wrapper';

export interface StepFrameProps {
  currentStep: OnboardingStepNumber;
  /** When true, omits the step progress header because an outer shell (e.g., OnboardingWizard or CareerProfile) owns chrome. */
  embedded?: boolean;
  heading?: string;
  description?: ReactNode;
  status?: MultiStepFormStatus;
  errorMessage?: string | null;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Renders either the standalone `MultiStepFormWrapper` (with stepper) or a clean embedded step section
 * sharing the exact same heading, alert, body spacing, and footer actions layout.
 */
export function StepFrame({
  currentStep,
  embedded = false,
  heading,
  description,
  status = 'editing',
  errorMessage,
  children,
  actions,
}: StepFrameProps) {
  if (!embedded) {
    return (
      <MultiStepFormWrapper
        currentStep={currentStep}
        heading={heading}
        description={description}
        status={status}
        errorMessage={errorMessage}
        actions={actions}
      >
        {children}
      </MultiStepFormWrapper>
    );
  }

  const submitting = status === 'submitting';
  return (
    <section
      aria-label={heading ?? `Step ${currentStep}`}
      aria-busy={submitting ? 'true' : undefined}
      className="flex flex-col gap-6"
    >
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
