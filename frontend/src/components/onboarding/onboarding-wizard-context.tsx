'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import type {
  CareerGoalResponse,
  CareerLevel,
  ProfileResponse,
} from '@/lib/api/client';
import type { M05Invoke } from '@/lib/api/error-mapper';
import type { ProfileContactInfo } from '@/lib/profile/actions';
import {
  ONBOARDING_STEP_ORDER,
  computeProfileCompletion,
  stepKeyToNumber,
  type OnboardingStepKey,
  type ProfileCompletionResult,
} from '@/lib/onboarding/completion';
import type { OnboardingStepNumber } from '@/components/ui/multi-step-form-wrapper';

export interface OnboardingWizardState {
  currentStep: OnboardingStepKey;
  profile: ProfileResponse | null;
  fullName: string;
  contact: ProfileContactInfo;
  goals: CareerGoalResponse[];
  activeGoal: CareerGoalResponse | null;
  activeDraftGoalId: string | null;
  /** Explicit user-selected (or server-confirmed) target level; `null` when only AI `suggested_level` is available. */
  explicitTargetLevel: CareerLevel | null;
  targetLevel: CareerLevel | null;
}

export type OnboardingWizardAction =
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'GO_TO_STEP'; step: OnboardingStepKey }
  | {
      type: 'SYNC_PROFILE';
      profile: ProfileResponse | null;
      fullName?: string;
      contactPatch?: { email?: string; phone?: string };
    }
  | {
      type: 'SET_ACTIVE_GOAL';
      goal: CareerGoalResponse;
      targetLevel?: CareerLevel | null;
    };

function isUnconfirmedGoal(goal: CareerGoalResponse): boolean {
  return (
    goal.status === 'clarifying' || goal.status === 'awaiting_confirmation'
  );
}

/**
 * Builds deterministic initial reducer state from server-fetched profile and non-discontinued goals.
 * Resumes any existing unconfirmed draft goal so Step 4 uses EP-C06 instead of creating duplicates.
 */
export function createInitialWizardState(params: {
  initialStep: OnboardingStepKey;
  initialProfile: ProfileResponse | null;
  initialGoals: CareerGoalResponse[];
  initialContact: ProfileContactInfo;
  initialFullName: string;
}): OnboardingWizardState {
  const activeGoals = params.initialGoals.filter(
    (g) => g.status !== 'discontinued',
  );
  const draftGoal = activeGoals.find(isUnconfirmedGoal) ?? null;
  const activeGoal = draftGoal ?? activeGoals[0] ?? null;
  const explicitTargetLevel = activeGoal?.target_level ?? null;
  const targetLevel =
    explicitTargetLevel ?? activeGoal?.suggested_level ?? null;

  return {
    currentStep: params.initialStep,
    profile: params.initialProfile,
    fullName: params.initialFullName,
    contact: params.initialContact,
    goals: activeGoals,
    activeGoal,
    activeDraftGoalId: draftGoal ? draftGoal.id : null,
    explicitTargetLevel,
    targetLevel,
  };
}

/**
 * Computes the highest step index (`0..4`) unlocked for strictly sequential navigation.
 * Steps `0..firstIncompleteStep` are unlocked (completed prior steps + single frontier step).
 * Step 5 (`confirm`, index 4) is unlocked only when steps 1–4 are complete AND an active goal exists.
 */
export function getMaxUnlockedStepIndex(
  completion: ProfileCompletionResult,
  activeGoal: CareerGoalResponse | null,
): number {
  const frontierIdx = ONBOARDING_STEP_ORDER.indexOf(
    completion.firstIncompleteStep,
  );
  if (frontierIdx === 4 && activeGoal === null) {
    return 3;
  }
  return frontierIdx;
}

/**
 * Pure state-machine reducer for the unified 5-step onboarding wizard.
 * All step transitions occur exclusively in client memory with zero router navigation.
 */
export function onboardingWizardReducer(
  state: OnboardingWizardState,
  action: OnboardingWizardAction,
): OnboardingWizardState {
  switch (action.type) {
    case 'NEXT': {
      const completion = computeProfileCompletion(
        state.profile,
        state.goals,
        state.fullName,
      );
      const maxUnlockedIndex = getMaxUnlockedStepIndex(
        completion,
        state.activeGoal,
      );
      const idx = ONBOARDING_STEP_ORDER.indexOf(state.currentStep);
      const targetIndex = Math.min(idx + 1, ONBOARDING_STEP_ORDER.length - 1);
      if (targetIndex > maxUnlockedIndex || targetIndex === idx) {
        return state;
      }
      return { ...state, currentStep: ONBOARDING_STEP_ORDER[targetIndex] };
    }
    case 'BACK': {
      const idx = ONBOARDING_STEP_ORDER.indexOf(state.currentStep);
      const prevStep = ONBOARDING_STEP_ORDER[Math.max(idx - 1, 0)];
      return prevStep === state.currentStep
        ? state
        : { ...state, currentStep: prevStep };
    }
    case 'GO_TO_STEP': {
      const completion = computeProfileCompletion(
        state.profile,
        state.goals,
        state.fullName,
      );
      const maxUnlockedIndex = getMaxUnlockedStepIndex(
        completion,
        state.activeGoal,
      );
      const targetIndex = ONBOARDING_STEP_ORDER.indexOf(action.step);
      if (
        targetIndex < 0 ||
        targetIndex > maxUnlockedIndex ||
        action.step === state.currentStep
      ) {
        return state;
      }
      return { ...state, currentStep: action.step };
    }
    case 'SYNC_PROFILE': {
      const nextContact: ProfileContactInfo = action.contactPatch
        ? {
            ...state.contact,
            email: state.contact.emailVerified
              ? state.contact.email
              : (action.contactPatch.email ?? state.contact.email),
            phone: state.contact.phoneVerified
              ? state.contact.phone
              : (action.contactPatch.phone ?? state.contact.phone),
          }
        : state.contact;

      return {
        ...state,
        profile: action.profile ?? state.profile,
        fullName:
          action.fullName !== undefined ? action.fullName : state.fullName,
        contact: nextContact,
      };
    }
    case 'SET_ACTIVE_GOAL': {
      const exists = state.goals.some((g) => g.id === action.goal.id);
      const nextGoals = exists
        ? state.goals.map((g) => (g.id === action.goal.id ? action.goal : g))
        : [action.goal, ...state.goals];
      const nextDraftId = isUnconfirmedGoal(action.goal)
        ? action.goal.id
        : (nextGoals.find(isUnconfirmedGoal)?.id ?? null);
      const isSameGoal = state.activeGoal?.id === action.goal.id;
      const nextExplicitTargetLevel: CareerLevel | null =
        action.targetLevel !== undefined
          ? action.targetLevel
          : isSameGoal
            ? (state.explicitTargetLevel ?? action.goal.target_level ?? null)
            : (action.goal.target_level ?? null);
      const nextTargetLevel: CareerLevel | null =
        nextExplicitTargetLevel ??
        action.goal.target_level ??
        action.goal.suggested_level ??
        null;

      return {
        ...state,
        goals: nextGoals,
        activeGoal: action.goal,
        activeDraftGoalId: nextDraftId,
        explicitTargetLevel: nextExplicitTargetLevel,
        targetLevel: nextTargetLevel,
      };
    }
  }
}

export interface OnboardingWizardContextValue {
  state: OnboardingWizardState;
  completion: ProfileCompletionResult;
  currentStepNumber: OnboardingStepNumber;
  maxUnlockedIndex: number;
  /** True while the active step form has an in-flight submit request (blocks stepper jumps). */
  isStepSubmitting: boolean;
  setStepSubmitting: (submitting: boolean) => void;
  userId?: string;
  profileLoadError?: string | null;
  goalsLoadError?: string | null;
  invoke: M05Invoke;
  dispatch: (action: OnboardingWizardAction) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: OnboardingStepKey) => void;
  syncProfile: (
    profile: ProfileResponse | null,
    fullName?: string,
    contactPatch?: { email?: string; phone?: string },
  ) => void;
  setActiveGoal: (
    goal: CareerGoalResponse,
    targetLevel?: CareerLevel | null,
  ) => void;
}

const OnboardingWizardContext =
  createContext<OnboardingWizardContextValue | null>(null);

export interface OnboardingWizardProviderProps {
  initialStep: OnboardingStepKey;
  initialProfile: ProfileResponse | null;
  initialGoals: CareerGoalResponse[];
  initialContact: ProfileContactInfo;
  initialFullName: string;
  userId?: string;
  profileLoadError?: string | null;
  goalsLoadError?: string | null;
  invoke: M05Invoke;
  children: ReactNode;
}

export function OnboardingWizardProvider({
  initialStep,
  initialProfile,
  initialGoals,
  initialContact,
  initialFullName,
  userId,
  profileLoadError = null,
  goalsLoadError = null,
  invoke,
  children,
}: OnboardingWizardProviderProps) {
  const [state, dispatch] = useReducer(
    onboardingWizardReducer,
    {
      initialStep,
      initialProfile,
      initialGoals,
      initialContact,
      initialFullName,
    },
    createInitialWizardState,
  );

  const [isStepSubmitting, setStepSubmitting] = useState(false);

  const completion = useMemo(
    () => computeProfileCompletion(state.profile, state.goals, state.fullName),
    [state.profile, state.goals, state.fullName],
  );

  const currentStepNumber = stepKeyToNumber(state.currentStep);
  const maxUnlockedIndex = getMaxUnlockedStepIndex(
    completion,
    state.activeGoal,
  );

  const nextStep = useCallback(() => dispatch({ type: 'NEXT' }), []);
  const prevStep = useCallback(() => {
    if (isStepSubmitting) return;
    dispatch({ type: 'BACK' });
  }, [isStepSubmitting]);
  const goToStep = useCallback(
    (step: OnboardingStepKey) => {
      if (isStepSubmitting) return;
      dispatch({ type: 'GO_TO_STEP', step });
    },
    [isStepSubmitting],
  );
  const syncProfile = useCallback(
    (
      profile: ProfileResponse | null,
      fullName?: string,
      contactPatch?: { email?: string; phone?: string },
    ) => dispatch({ type: 'SYNC_PROFILE', profile, fullName, contactPatch }),
    [],
  );
  const setActiveGoal = useCallback(
    (goal: CareerGoalResponse, targetLevel?: CareerLevel | null) =>
      dispatch({ type: 'SET_ACTIVE_GOAL', goal, targetLevel }),
    [],
  );

  const value = useMemo<OnboardingWizardContextValue>(
    () => ({
      state,
      completion,
      currentStepNumber,
      maxUnlockedIndex,
      isStepSubmitting,
      setStepSubmitting,
      userId,
      profileLoadError,
      goalsLoadError,
      invoke,
      dispatch,
      nextStep,
      prevStep,
      goToStep,
      syncProfile,
      setActiveGoal,
    }),
    [
      state,
      completion,
      currentStepNumber,
      maxUnlockedIndex,
      isStepSubmitting,
      userId,
      profileLoadError,
      goalsLoadError,
      invoke,
      nextStep,
      prevStep,
      goToStep,
      syncProfile,
      setActiveGoal,
    ],
  );

  return (
    <OnboardingWizardContext.Provider value={value}>
      {children}
    </OnboardingWizardContext.Provider>
  );
}

/** Reads the active onboarding wizard state & actions; throws if used outside `OnboardingWizardProvider`. */
export function useOnboardingWizard(): OnboardingWizardContextValue {
  const ctx = useContext(OnboardingWizardContext);
  if (!ctx) {
    throw new Error(
      'useOnboardingWizard must be used within an OnboardingWizardProvider.',
    );
  }
  return ctx;
}
