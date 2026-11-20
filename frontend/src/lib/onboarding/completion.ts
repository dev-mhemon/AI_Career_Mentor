import type { CareerGoalResponse, ProfileResponse } from '@/lib/api/client';
import type { OnboardingStepNumber } from '@/components/ui/multi-step-form-wrapper';

export type OnboardingStepKey =
  | 'profile'
  | 'skills'
  | 'preferences'
  | 'goal'
  | 'confirm';

export const ONBOARDING_STEP_ORDER: readonly OnboardingStepKey[] = [
  'profile',
  'skills',
  'preferences',
  'goal',
  'confirm',
] as const;

export type CompletionProfileInput = Pick<
  ProfileResponse,
  | 'current_role'
  | 'experience_level'
  | 'existing_skills'
  | 'existing_skills_none'
  | 'learning_preference'
> & {
  full_name?: string | null;
  unresolved_skills?: ProfileResponse['unresolved_skills'];
};

export type CompletionGoalInput = Pick<CareerGoalResponse, 'status'>;

export interface ProfileCompletionSteps {
  profile: boolean;
  skills: boolean;
  preferences: boolean;
  goal: boolean;
  confirm: boolean;
}

export type ProfileCompletionCount = 0 | 1 | 2 | 3 | 4 | 5;
export type ProfileCompletionPercentage = 0 | 20 | 40 | 60 | 80 | 100;

export interface ProfileCompletionResult {
  steps: ProfileCompletionSteps;
  completedCount: ProfileCompletionCount;
  percentage: ProfileCompletionPercentage;
  isComplete: boolean;
  firstIncompleteStep: OnboardingStepKey;
}

const ACTIVE_GOAL_STATUSES: ReadonlySet<CareerGoalResponse['status']> = new Set([
  'clarifying',
  'awaiting_confirmation',
  'confirmed',
]);

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Pure single-source-of-truth profile completion calculator across the 5 onboarding steps (20% each).
 *
 * Accepts `fullName` either on `profile.full_name` or via the optional third `fullName` parameter
 * (useful when combining EP-P01 `ProfileResponse` with Supabase `user_metadata.full_name`).
 */
export function computeProfileCompletion(
  profile: CompletionProfileInput | null | undefined,
  goals: ReadonlyArray<CompletionGoalInput> | null | undefined = [],
  fullName?: string | null,
): ProfileCompletionResult {
  const resolvedFullName =
    fullName !== undefined ? fullName : (profile?.full_name ?? null);
  const goalList = goals ?? [];

  const hasPendingAmbiguousSkills = (profile?.unresolved_skills ?? []).some(
    (item) => item.candidates.length > 0,
  );

  const steps: ProfileCompletionSteps = {
    profile:
      isNonEmptyString(resolvedFullName) &&
      isNonEmptyString(profile?.current_role) &&
      isNonEmptyString(profile?.experience_level),
    skills:
      !hasPendingAmbiguousSkills &&
      (profile?.existing_skills_none === true ||
        (profile?.existing_skills?.length ?? 0) > 0),
    preferences: isNonEmptyString(profile?.learning_preference),
    goal: goalList.some((g) => ACTIVE_GOAL_STATUSES.has(g.status)),
    confirm: goalList.some((g) => g.status === 'confirmed'),
  };

  let count = 0;
  let firstIncompleteStep: OnboardingStepKey | null = null;
  for (const key of ONBOARDING_STEP_ORDER) {
    if (steps[key]) {
      count += 1;
    } else if (firstIncompleteStep === null) {
      firstIncompleteStep = key;
    }
  }

  const completedCount = count as ProfileCompletionCount;
  const percentage = (completedCount * 20) as ProfileCompletionPercentage;

  return {
    steps,
    completedCount,
    percentage,
    isComplete: percentage === 100,
    firstIncompleteStep: firstIncompleteStep ?? 'confirm',
  };
}

/** Maps a canonical onboarding step key to its 1-based step number. */
export function stepKeyToNumber(step: OnboardingStepKey): OnboardingStepNumber {
  switch (step) {
    case 'profile':
      return 1;
    case 'skills':
      return 2;
    case 'preferences':
      return 3;
    case 'goal':
      return 4;
    case 'confirm':
      return 5;
  }
}

/** Maps a 1-based step number to its canonical onboarding step key. */
export function stepNumberToKey(num: OnboardingStepNumber): OnboardingStepKey {
  return ONBOARDING_STEP_ORDER[num - 1];
}
