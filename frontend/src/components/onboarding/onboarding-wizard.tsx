'use client';

import { memo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CareerGoalResponse, ProfileResponse } from '@/lib/api/client';
import type { M05Invoke } from '@/lib/api/error-mapper';
import type { ProfileContactInfo } from '@/lib/profile/actions';
import type { OnboardingStepKey } from '@/lib/onboarding/completion';
import { ProfileSetupForm } from './profile-setup-form';
import { SkillsSetupForm } from './skills-setup-form';
import { PreferencesSetupForm } from './preferences-setup-form';
import { Stepper } from '@/components/ui/stepper';
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
    <Stepper
      title={active.title}
      stepCounterText={`Step ${currentStepNumber} of ${total}`}
      percentComplete={completion.percentage}
      ariaLabel="Onboarding steps"
      progressAriaLabel={`Onboarding progress: Step ${currentStepNumber} of ${total}`}
      progressValueNow={completion.percentage}
      progressValueMin={0}
      progressValueMax={100}
      progressValueText={`Step ${currentStepNumber} of ${total}: ${active.title} (${completion.percentage}% complete)`}
      disabled={isStepSubmitting}
      onStepClick={(stepId) => goToStep(stepId as OnboardingStepKey)}
      steps={WIZARD_STEPS.map((step, idx) => {
        const isActive = step.key === state.currentStep;
        const isDone = completion.steps[step.key];
        return {
          id: step.key,
          label: step.label,
          status: isActive ? 'current' : isDone ? 'completed' : 'upcoming',
          completed: isDone,
          interactive: idx <= maxUnlockedIndex,
        };
      })}
    />
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
