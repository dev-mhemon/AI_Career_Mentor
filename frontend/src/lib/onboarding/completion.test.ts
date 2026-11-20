import { describe, expect, it } from 'vitest';
import {
  computeProfileCompletion,
  stepKeyToNumber,
  stepNumberToKey,
  type CompletionGoalInput,
  type CompletionProfileInput,
} from './completion';

function makeProfile(
  overrides: Partial<CompletionProfileInput> = {},
): CompletionProfileInput {
  return {
    full_name: null,
    current_role: null,
    experience_level: null,
    existing_skills: [],
    existing_skills_none: false,
    learning_preference: null,
    ...overrides,
  };
}

const SAMPLE_SKILL = {
  skill_id: 'sk-1',
  name: 'TypeScript',
  alias_resolved: true,
  learning_state: 'learning' as const,
  source: 'self_reported' as const,
};

describe('computeProfileCompletion', () => {
  it('returns 0% and profile as firstIncompleteStep for null/empty profile and no goals', () => {
    expect(computeProfileCompletion(null, [])).toEqual({
      steps: {
        profile: false,
        skills: false,
        preferences: false,
        goal: false,
        confirm: false,
      },
      completedCount: 0,
      percentage: 0,
      isComplete: false,
      firstIncompleteStep: 'profile',
    });

    expect(
      computeProfileCompletion(
        makeProfile({ full_name: '   ', current_role: 'Student', experience_level: 'beginner' }),
        [{ status: 'discontinued' }],
      ),
    ).toEqual({
      steps: {
        profile: false,
        skills: false,
        preferences: false,
        goal: false,
        confirm: false,
      },
      completedCount: 0,
      percentage: 0,
      isComplete: false,
      firstIncompleteStep: 'profile',
    });
  });

  it('returns 20% and skills as firstIncompleteStep when only profile step is complete', () => {
    const result = computeProfileCompletion(
      makeProfile({
        full_name: 'Mehedi Hasan',
        current_role: 'Backend Developer',
        experience_level: 'junior',
      }),
      [],
    );

    expect(result).toEqual({
      steps: {
        profile: true,
        skills: false,
        preferences: false,
        goal: false,
        confirm: false,
      },
      completedCount: 1,
      percentage: 20,
      isComplete: false,
      firstIncompleteStep: 'skills',
    });
  });

  it('accepts fullName via the optional third argument when absent on ProfileResponse', () => {
    const result = computeProfileCompletion(
      makeProfile({
        current_role: 'Student',
        experience_level: 'beginner',
        existing_skills_none: true,
        learning_preference: 'hands_on',
      }),
      [],
      'Alice Rahman',
    );

    expect(result).toEqual({
      steps: {
        profile: true,
        skills: true,
        preferences: true,
        goal: false,
        confirm: false,
      },
      completedCount: 3,
      percentage: 60,
      isComplete: false,
      firstIncompleteStep: 'goal',
    });
  });

  it('returns 80% and confirm as firstIncompleteStep when goal is clarifying or awaiting_confirmation', () => {
    const baseProfile = makeProfile({
      full_name: 'Alice Rahman',
      current_role: 'QA Engineer',
      experience_level: 'mid',
      existing_skills: [SAMPLE_SKILL],
      learning_preference: 'mixed',
    });

    for (const status of ['clarifying', 'awaiting_confirmation'] as const) {
      const result = computeProfileCompletion(baseProfile, [{ status }]);
      expect(result).toEqual({
        steps: {
          profile: true,
          skills: true,
          preferences: true,
          goal: true,
          confirm: false,
        },
        completedCount: 4,
        percentage: 80,
        isComplete: false,
        firstIncompleteStep: 'confirm',
      });
    }
  });

  it('returns 100%, isComplete=true, and confirm as firstIncompleteStep when all 5 steps are complete', () => {
    const result = computeProfileCompletion(
      makeProfile({
        full_name: 'Alice Rahman',
        current_role: 'Frontend Developer',
        experience_level: 'senior',
        existing_skills: [SAMPLE_SKILL],
        learning_preference: 'visual',
      }),
      [{ status: 'discontinued' }, { status: 'confirmed' }],
    );

    expect(result).toEqual({
      steps: {
        profile: true,
        skills: true,
        preferences: true,
        goal: true,
        confirm: true,
      },
      completedCount: 5,
      percentage: 100,
      isComplete: true,
      firstIncompleteStep: 'confirm',
    });
  });

  it('handles out-of-order completion accurately (e.g. skills + confirmed goal done, profile & preferences incomplete)', () => {
    const goals: CompletionGoalInput[] = [{ status: 'confirmed' }];
    const result = computeProfileCompletion(
      makeProfile({
        full_name: 'Alice Rahman',
        current_role: null, // profile incomplete
        experience_level: 'junior',
        existing_skills: [SAMPLE_SKILL], // skills complete
        learning_preference: null, // preferences incomplete
      }),
      goals,
    );

    expect(result).toEqual({
      steps: {
        profile: false,
        skills: true,
        preferences: false,
        goal: true,
        confirm: true,
      },
      completedCount: 3,
      percentage: 60,
      isComplete: false,
      firstIncompleteStep: 'profile',
    });

    const missingOnlyPreferences = computeProfileCompletion(
      makeProfile({
        full_name: 'Alice Rahman',
        current_role: 'Developer',
        experience_level: 'junior',
        existing_skills_none: true,
        learning_preference: null,
      }),
      goals,
    );

    expect(missingOnlyPreferences).toEqual({
      steps: {
        profile: true,
        skills: true,
        preferences: false,
        goal: true,
        confirm: true,
      },
      completedCount: 4,
      percentage: 80,
      isComplete: false,
      firstIncompleteStep: 'preferences',
    });
  });

  it('maps step keys and step numbers symmetrically', () => {
    expect(stepKeyToNumber('profile')).toBe(1);
    expect(stepKeyToNumber('skills')).toBe(2);
    expect(stepKeyToNumber('preferences')).toBe(3);
    expect(stepKeyToNumber('goal')).toBe(4);
    expect(stepKeyToNumber('confirm')).toBe(5);

    expect(stepNumberToKey(1)).toBe('profile');
    expect(stepNumberToKey(5)).toBe('confirm');
  });
});
