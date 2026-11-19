import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CareerGoalCreateDTO,
  CareerGoalListQueryDTO,
  GoalClarificationDTO,
  GoalConfirmDTO,
} from '../career/dto/career-goal.dto.js';
import { missingFields } from '../common/profile-completeness.js';
import {
  AliasInput,
  ConfirmGoal,
  LearningPatch,
  PreferencesPatch,
  ProfilePatch,
} from './profile.dto.js';

describe('Foundation & Career/Profile DTO validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires no artificial skills for None', () => {
    expect(
      missingFields(
        {
          current_role_title: 'Student',
          education: 'BSc',
          experience_level: 'beginner',
          learning_preference: 'mixed',
          preferred_daily_hours: 1,
          timezone: 'Asia/Dhaka',
          existing_skills_none: true,
          self_reported_skill_ids: [],
        },
        true,
      ),
    ).toEqual([]);
  });

  it('rejects fractional non-half-hour settings', async () => {
    expect(
      await validate(
        plainToInstance(LearningPatch, { preferred_daily_hours: 1.2 }),
      ),
    ).not.toHaveLength(0);
  });

  it('rejects invalid timezone', async () => {
    expect(
      await validate(
        plainToInstance(LearningPatch, { timezone: 'not/a-zone' }),
      ),
    ).not.toHaveLength(0);
  });

  it('trims roles and rejects blank names', async () => {
    const p = plainToInstance(ProfilePatch, {
      current_role: '  Student ',
      existing_skills: [{ name: ' ' }],
    });
    expect(p.current_role).toBe('Student');
    expect(await validate(p)).not.toHaveLength(0);
  });

  it('enforces the 100-skill cap on ProfilePatch.existing_skills', async () => {
    const valid100 = plainToInstance(ProfilePatch, {
      existing_skills: Array.from({ length: 100 }, (_, idx) => ({
        name: `Skill-${idx + 1}`,
      })),
    });
    expect(await validate(valid100)).toHaveLength(0);

    const invalid101 = plainToInstance(ProfilePatch, {
      existing_skills: Array.from({ length: 101 }, (_, idx) => ({
        name: `Skill-${idx + 1}`,
      })),
    });
    expect(await validate(invalid101)).not.toHaveLength(0);
  });

  it('rejects invalid skill UUID and normalizes valid UUID to lowercase on AliasInput & ConfirmGoal', async () => {
    expect(
      await validate(
        plainToInstance(AliasInput, { input: 'Node', skill_id: 'invalid' }),
      ),
    ).not.toHaveLength(0);

    const validAlias = plainToInstance(AliasInput, {
      input: '  Node.js  ',
      skill_id: '  11111111-1111-4111-8111-111111111111  ',
    });
    expect(await validate(validAlias)).toHaveLength(0);
    expect(validAlias.input).toBe('Node.js');
    expect(validAlias.skill_id).toBe('11111111-1111-4111-8111-111111111111');

    const valid80Rocket = plainToInstance(AliasInput, {
      input: `${'a'.repeat(79)}🚀`,
      skill_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(await validate(valid80Rocket)).toHaveLength(0);

    const invalid81HeartVariation = plainToInstance(AliasInput, {
      input: `${'a'.repeat(79)}\u2764\uFE0F`,
      skill_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(await validate(invalid81HeartVariation)).not.toHaveLength(0);

    const validConfirm = plainToInstance(ConfirmGoal, {
      canonical_role_id: '  22222222-2222-4222-8222-222222222222 ',
      target_level: 'mid',
    });
    expect(await validate(validConfirm)).toHaveLength(0);
    expect(validConfirm.canonical_role_id).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('accepts empty string and whitespace for education and education_level to support clearing', async () => {
    const p1 = plainToInstance(ProfilePatch, { education: '' });
    expect(await validate(p1)).toHaveLength(0);

    const p2 = plainToInstance(ProfilePatch, { education: '   ' });
    expect(p2.education).toBe('');
    expect(await validate(p2)).toHaveLength(0);

    const p3 = plainToInstance(ProfilePatch, { education_level: '' });
    expect(await validate(p3)).toHaveLength(0);

    const p4 = plainToInstance(ProfilePatch, { education_level: '   ' });
    expect(p4.education_level).toBe('');
    expect(await validate(p4)).toHaveLength(0);

    const p5 = plainToInstance(ProfilePatch, { education: 'a'.repeat(201) });
    expect(await validate(p5)).not.toHaveLength(0);
  });

  it('validates PreferencesPatch learning_preference allowlist', async () => {
    expect(
      await validate(
        plainToInstance(PreferencesPatch, { learning_preference: 'hands_on' }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(PreferencesPatch, { learning_preference: 'invalid' }),
      ),
    ).not.toHaveLength(0);
  });

  it('validates CareerGoalCreateDTO 3..300 trimmed chars and rejects NUL or unpaired surrogates', async () => {
    const valid = plainToInstance(CareerGoalCreateDTO, {
      goal_text: '  Backend developer in Node.js  ',
    });
    expect(valid.goal_text).toBe('Backend developer in Node.js');
    expect(await validate(valid)).toHaveLength(0);

    const tooShort = plainToInstance(CareerGoalCreateDTO, {
      goal_text: '  ab  ',
    });
    expect(await validate(tooShort)).not.toHaveLength(0);

    const tooLong = plainToInstance(CareerGoalCreateDTO, {
      goal_text: 'a'.repeat(301),
    });
    expect(await validate(tooLong)).not.toHaveLength(0);

    const withNul = plainToInstance(CareerGoalCreateDTO, {
      goal_text: 'Backend\u0000Developer',
    });
    expect(await validate(withNul)).not.toHaveLength(0);

    const withUnpairedSurrogate = plainToInstance(CareerGoalCreateDTO, {
      goal_text: 'Backend \uD800 Developer',
    });
    expect(await validate(withUnpairedSurrogate)).not.toHaveLength(0);
  });

  it('validates GoalClarificationDTO 1..300 trimmed chars and GoalConfirmDTO enums', async () => {
    const validAnswer = plainToInstance(GoalClarificationDTO, {
      answer: '  Server-side APIs  ',
    });
    expect(validAnswer.answer).toBe('Server-side APIs');
    expect(await validate(validAnswer)).toHaveLength(0);

    const emptyAnswer = plainToInstance(GoalClarificationDTO, {
      answer: '   ',
    });
    expect(await validate(emptyAnswer)).not.toHaveLength(0);

    const validConfirm = plainToInstance(GoalConfirmDTO, {
      canonical_role_id: '11111111-1111-4111-8111-111111111111',
      target_level: 'senior',
    });
    expect(await validate(validConfirm)).toHaveLength(0);

    const invalidLevel = plainToInstance(GoalConfirmDTO, {
      canonical_role_id: '11111111-1111-4111-8111-111111111111',
      target_level: 12345 as unknown as string,
    });
    expect(await validate(invalidLevel)).not.toHaveLength(0);
  });

  it('validates CareerGoalListQueryDTO optional status, limit, and cursor', async () => {
    const validQuery = plainToInstance(CareerGoalListQueryDTO, {
      status: 'confirmed',
      limit: '25',
      cursor:
        'eyJjcmVhdGVkX2F0IjoiMjAyNi0xMC0xMFQwODowMDowMFoiLCJpZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSJ9',
    });
    expect(await validate(validQuery)).toHaveLength(0);
    expect(validQuery.limit).toBe(25);

    const emptyCursorQuery = plainToInstance(CareerGoalListQueryDTO, {
      cursor: '   ',
    });
    expect(await validate(emptyCursorQuery)).toHaveLength(0);
    expect(emptyCursorQuery.cursor).toBeUndefined();

    const badLimit = plainToInstance(CareerGoalListQueryDTO, {
      limit: 101,
    });
    expect(await validate(badLimit)).not.toHaveLength(0);
  });
});
