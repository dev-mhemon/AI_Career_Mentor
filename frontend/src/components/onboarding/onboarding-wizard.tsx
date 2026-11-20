'use client';

import { memo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CareerGoalResponse, ProfileResponse } from '@/lib/api/client';
import type { M05Invoke } from '@/lib/api/error-mapper';
import type { ProfileContactInfo } from '@/lib/profile/actions';
import type { OnboardingStepKey } from '@/lib/onboarding/completion';
import { cn } from '@/components/ui/cn';
import { ProfileSetupForm } from './profile-setup-form';
import { SkillsSetupForm } from './skills-setup-form';
import { PreferencesSetupForm } from './preferences-setup-form';
import { GoalSetupForm } from './goal-setup-form';
import { GoalClarifyForm } from './goal-clarify-form';
import {
  OnboardingWizardProvider,
  useOnboardingWizard,
} from './onboarding-wizard-context';

const WIZARD_STEPS: ReadonlyArray<{
  key: OnboardingStepKey;
  number: 1 | 2 | 3 | 4 | 5;
  label: string;
  title: string;
}> = [
  { key: 'profile', number: 1, label: '1. Profile', title: 'Profile Setup' },
  { key: 'skills', number: 2, label: '2. Skills', title: 'Skills' },
  {
    key: 'preferences',
    number: 3,
    label: '3. Preferences',
    title: 'Learning Preferences',
  },
  { key: 'goal', number: 4, label: '4. Career Goal', title: 'Career Goal' },
  {
    key: 'confirm',
    number: 5,
    label: '5. Confirm Role',
    title: 'Clarify & Confirm',
  },
] as const;

/**
 * Dynamic compound stepper reading live completion percentage and per-step status
 * directly from `OnboardingWizardProvider`.
 */
const OnboardingWizardStepper = memo(function OnboardingWizardStepper() {
  const {
    state,
    completion,
    currentStepNumber,
    maxUnlockedIndex,
    isStepSubmitting,
    goToStep,
  } = useOnboardingWizard();
  const total = WIZARD_STEPS.length;
  const active = WIZARD_STEPS[currentStepNumber - 1];

  return (
    <div className="flex flex-col gap-5 rounded-xl bg-surface-subtle px-6 py-5">
      <div
        role="progressbar"
        aria-valuenow={completion.percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`Step ${currentStepNumber} of ${total}: ${active.title} (${completion.percentage}% complete)`}
        aria-label={`Onboarding progress: Step ${currentStepNumber} of ${total}`}
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-label-lg font-semibold text-text-primary">
            {active.title}
          </span>
          <span className="inline-flex items-center rounded-full border border-border-default bg-surface-default px-2.5 py-0.5 text-caption font-medium text-text-secondary">
            Step {currentStepNumber} of {total}
          </span>
        </div>
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 font-mono text-caption font-semibold tabular-nums text-teal-700 dark:text-teal-300">
          {completion.percentage}% Complete
        </span>
      </div>

      <nav aria-label="Onboarding steps">
        <ol className="grid grid-cols-5 items-start">
          {WIZARD_STEPS.map((step, idx) => {
            const isActive = step.key === state.currentStep;
            const isDone = completion.steps[step.key];
            const isLast = idx === total - 1;
            const isUnlocked = idx <= maxUnlockedIndex;
            const isLocked = !isUnlocked;
            const isDisabled = isLocked || (isStepSubmitting && !isActive);
            const canNavigate = isUnlocked && !isActive && !isStepSubmitting;

            return (
              <li
                key={step.key}
                className="relative flex flex-col items-center px-1 text-center"
              >
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute top-3.5 left-1/2 z-0 h-0.5 w-full -translate-y-1/2 transition-colors duration-(--duration-fast)',
                      isDone ? 'bg-teal-500/60' : 'bg-border-subtle',
                    )}
                  />
                )}
                <button
                  type="button"
                  disabled={isDisabled}
                  aria-disabled={isDisabled ? 'true' : undefined}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => {
                    if (canNavigate) goToStep(step.key);
                  }}
                  aria-label={
                    isDone
                      ? `${step.label} (completed)`
                      : isActive
                        ? `${step.label} (current step)`
                        : step.label
                  }
                  className={cn(
                    'group relative z-10 flex flex-col items-center rounded-lg px-1.5 transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
                    isDisabled
                      ? 'cursor-not-allowed opacity-60'
                      : canNavigate
                        ? 'cursor-pointer'
                        : 'cursor-default',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-caption transition-colors duration-(--duration-fast) motion-reduce:transition-none',
                      isActive
                        ? 'bg-teal-500 font-semibold text-slate-950 ring-4 ring-teal-500/20'
                        : isDone
                          ? 'border border-teal-500 bg-teal-50 font-medium text-text-brand group-hover:border-teal-600 group-hover:bg-teal-100 dark:bg-teal-950 dark:group-hover:bg-teal-900'
                          : isUnlocked
                            ? 'border border-teal-500/60 bg-surface-default font-medium text-text-primary group-hover:border-teal-500 group-hover:bg-teal-50 dark:group-hover:bg-teal-950'
                            : 'border border-border-default bg-surface-default font-medium text-text-muted',
                    )}
                  >
                    {isDone && !isActive ? '✓' : step.number}
                  </span>
                  <span
                    className={cn(
                      'mt-2.5 text-[11px] leading-tight transition-colors duration-(--duration-fast) sm:text-caption',
                      isActive
                        ? 'font-semibold text-text-brand'
                        : canNavigate
                          ? isDone
                            ? 'font-medium text-text-primary group-hover:text-text-brand'
                            : 'font-medium text-text-secondary group-hover:text-text-brand'
                          : 'text-text-muted',
                    )}
                  >
                    {step.label}
                  </span>
                  {isDone && <span className="sr-only">(completed)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
});

/**
 * Compound step body mounting ONLY the currently active step (`switch (state.currentStep)`)
 * while preserving all cross-step profile & goal state in the wizard reducer.
 */
function OnboardingWizardContent() {
  const router = useRouter();
  const {
    state,
    userId,
    profileLoadError,
    goalsLoadError,
    invoke,
    nextStep,
    prevStep,
    setStepSubmitting,
    syncProfile,
    setActiveGoal,
  } = useOnboardingWizard();

  switch (state.currentStep) {
    case 'profile':
      return (
        <ProfileSetupForm
          embedded
          initialProfile={state.profile}
          initialContact={state.contact}
          initialFullName={state.fullName}
          loadError={profileLoadError ?? undefined}
          userId={userId}
          onPendingChange={setStepSubmitting}
          onSuccess={({ profile, fullName, values }) => {
            syncProfile(profile, fullName, {
              email: values?.email,
              phone: values?.phone,
            });
            nextStep();
          }}
        />
      );

    case 'skills':
      return (
        <SkillsSetupForm
          embedded
          initialProfile={state.profile}
          loadError={profileLoadError}
          invoke={invoke}
          onBack={prevStep}
          onPendingChange={setStepSubmitting}
          onProfileCommitted={(committedProfile) => {
            syncProfile(committedProfile);
          }}
          onSuccess={(updatedProfile) => {
            syncProfile(updatedProfile);
            nextStep();
          }}
        />
      );

    case 'preferences':
      return (
        <PreferencesSetupForm
          embedded
          initialProfile={state.profile}
          loadError={profileLoadError}
          invoke={invoke}
          onBack={prevStep}
          onPendingChange={setStepSubmitting}
          onSuccess={(updatedProfile) => {
            syncProfile(updatedProfile);
            nextStep();
          }}
        />
      );

    case 'goal':
      return (
        <GoalSetupForm
          embedded
          invoke={invoke}
          userId={userId}
          draftScope="onboarding"
          loadError={goalsLoadError}
          activeDraftGoalId={state.activeDraftGoalId}
          initialGoalText={state.activeGoal?.goal_text ?? ''}
          initialDailyHours={state.profile?.preferred_daily_hours ?? null}
          initialTargetLevel={state.explicitTargetLevel ?? state.targetLevel}
          initialTargetLevelSource={
            state.explicitTargetLevel ? 'explicit' : 'suggested'
          }
          onBack={prevStep}
          onPendingChange={setStepSubmitting}
          onLearningSettingsSaved={(updatedProfile) => {
            syncProfile(updatedProfile);
          }}
          onSuccess={({ goal, targetLevel, targetLevelExplicit, profile }) => {
            syncProfile(profile);
            setActiveGoal(goal, targetLevelExplicit ? targetLevel : undefined);
            nextStep();
          }}
        />
      );

    case 'confirm':
      return (
        <GoalClarifyForm
          key={state.activeGoal?.id ?? 'no-goal'}
          embedded
          goal={state.activeGoal}
          initialTargetLevel={state.explicitTargetLevel}
          userId={userId}
          draftScope="onboarding"
          loadError={goalsLoadError}
          invoke={invoke}
          onBack={prevStep}
          onPendingChange={setStepSubmitting}
          onGoalUpdated={(updatedGoal) => {
            setActiveGoal(updatedGoal);
          }}
          onSuccess={(confirmedGoal) => {
            setActiveGoal(confirmedGoal);
            router.push('/dashboard');
          }}
        />
      );
  }
}

export interface OnboardingWizardProps {
  initialStep: OnboardingStepKey;
  initialProfile: ProfileResponse | null;
  initialGoals: CareerGoalResponse[];
  initialContact: ProfileContactInfo;
  initialFullName: string;
  userId?: string;
  profileLoadError?: string | null;
  goalsLoadError?: string | null;
  invoke: M05Invoke;
  /** Optional custom compound composition; defaults to Stepper + Content inside the shared card. */
  children?: ReactNode;
}

interface OnboardingWizardCompound {
  (props: OnboardingWizardProps): ReactNode;
  Stepper: typeof OnboardingWizardStepper;
  Content: typeof OnboardingWizardContent;
}

/**
 * Unified 5-step onboarding wizard (`/onboarding`).
 * Composes `OnboardingWizardProvider` (useReducer state machine) with compound
 * `OnboardingWizard.Stepper` and `OnboardingWizard.Content` inside one persistent card.
 */
function OnboardingWizardRoot({
  initialStep,
  initialProfile,
  initialGoals,
  initialContact,
  initialFullName,
  userId,
  profileLoadError,
  goalsLoadError,
  invoke,
  children,
}: OnboardingWizardProps) {
  return (
    <OnboardingWizardProvider
      initialStep={initialStep}
      initialProfile={initialProfile}
      initialGoals={initialGoals}
      initialContact={initialContact}
      initialFullName={initialFullName}
      userId={userId}
      profileLoadError={profileLoadError}
      goalsLoadError={goalsLoadError}
      invoke={invoke}
    >
      <div className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
        <div className="flex flex-col gap-6">
          {children ?? (
            <>
              <OnboardingWizardStepper />
              <OnboardingWizardContent />
            </>
          )}
        </div>
      </div>
    </OnboardingWizardProvider>
  );
}

export const OnboardingWizard: OnboardingWizardCompound = Object.assign(
  OnboardingWizardRoot,
  {
    Stepper: OnboardingWizardStepper,
    Content: OnboardingWizardContent,
  },
);
