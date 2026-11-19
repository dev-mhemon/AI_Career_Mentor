import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { ProfileService } from './profile.service.js';

describe('ProfileService (EP-P01–EP-P05, R07, R29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('C05 career goal response contract (R29)', () => {
    it.each([
      [
        {
          canonical_role_id: '11111111-1111-4111-8111-111111111111',
          name: 'Backend Development',
        },
        {
          canonical_role_id: '22222222-2222-4222-8222-222222222222',
          name: 'Frontend Development',
        },
      ],
      [],
    ])(
      'serializes every alternative as a complete RoleOptionDTO: %j',
      async (...roles) => {
        const query = vi.fn<
          (sql: string, params?: unknown[]) => Promise<unknown[]>
        >(async (sql: string) => {
          if (sql.includes('FROM public.career_goals')) {
            return [
              {
                id: 'goal',
                goal_text: 'Backend Developer',
                status: 'awaiting_confirmation',
                clarification_round: 0,
                clarification_question: null,
                proposed_role_id: null,
                alternative_role_ids: roles.map(
                  (role) => role.canonical_role_id,
                ),
                suggested_level: 'junior',
                target_level: null,
                roadmap_id: null,
                created_at: '2026-10-10T08:00:00Z',
              },
            ];
          }
          if (sql.includes('FROM public.career_roles')) {
            return roles;
          }
          return [];
        });
        const transaction = vi.fn((_id, operation) => operation({ query }));
        const service = new ProfileService({
          transaction,
        } as unknown as DatabaseService);

        const response = JSON.parse(
          JSON.stringify(await service.readGoal('owner', 'goal')),
        );
        expect(response.alternative_roles).toEqual(
          roles.map((role) => ({
            canonical_role_id: role.canonical_role_id,
            name: role.name,
            rationale: null,
          })),
        );
        expect(transaction).toHaveBeenCalledWith('owner', expect.any(Function));
        const goalCall = query.mock.calls.find(([sql]) =>
          String(sql).includes('FROM public.career_goals'),
        );
        expect(goalCall?.[1]).toEqual(['owner', 'goal']);
      },
    );
  });

  describe('C05 EP-C05 transaction feature boundary', () => {
    it('rejects a feature disabled after the request guard without confirming a goal', async () => {
      const query = vi.fn().mockResolvedValue([{ enabled: false }]);
      const transaction = vi.fn((_id, operation) => operation({ query }));
      const service = new ProfileService({
        transaction,
      } as unknown as DatabaseService);
      await expect(
        service.confirm('owner', 'goal', {
          canonical_role_id: 'role',
          target_level: 'mid',
        }),
      ).rejects.toMatchObject({
        response: { code: 'FEATURE_DISABLED' },
        status: 403,
      });
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('UPDATE public.career_goals'),
        ),
      ).toBe(false);
    });
  });

  describe('ProfileService.patch explicit clearing of education and education_level', () => {
    it.each([
      [{ education: '' }],
      [{ education: '   ' }],
      [{ education_level: '' }],
      [{ education_level: '   ' }],
    ])('clears education to null in DB when input is %j', async (input) => {
      const oldProfile = {
        user_id: 'user-1',
        current_role_title: 'Developer',
        education: 'BSc in CSE',
        experience_level: 'junior',
        self_reported_skill_ids: [],
        existing_skills_none: false,
        learning_preference: 'mixed',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
      };
      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM public.user_profiles')) {
          return [oldProfile];
        }
        if (sql.includes('UPDATE public.user_profiles')) {
          return [];
        }
        if (sql.includes('SELECT DISTINCT target_level')) {
          return [];
        }
        if (sql.includes('SELECT id FROM public.career_goals')) {
          return [];
        }
        if (sql.includes('SELECT p.*,pr.learning_preference')) {
          return [{ ...oldProfile, education: null }];
        }
        if (sql.includes('SELECT s.id AS skill_id')) {
          return [];
        }
        return [];
      });
      const transaction = vi.fn((_id, operation) => operation({ query }));
      const service = new ProfileService({
        transaction,
      } as unknown as DatabaseService);

      const result = (await service.patch('user-1', input as any)) as any;

      const updateCall = query.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE public.user_profiles'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1][2]).toBeNull();
      expect(result.education).toBeNull();
      expect(result.education_level).toBeNull();
    });
  });

  describe('R07 & R29 skill resolution, 100-skill cap, explicit None, and stronger-evidence preservation', () => {
    it('rejects existing_skills_none=true combined with non-empty existing_skills with 422 VALIDATION_FAILED', async () => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM public.user_profiles')) {
          return [
            {
              user_id: 'user-1',
              self_reported_skill_ids: [],
              existing_skills_none: false,
            },
          ];
        }
        return [];
      });
      const transaction = vi.fn((_id, op) => op({ query }));
      const service = new ProfileService({
        transaction,
      } as unknown as DatabaseService);

      await expect(
        service.patch('user-1', {
          existing_skills_none: true,
          existing_skills: [{ name: 'React' }],
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('UPDATE public.user_profiles'),
        ),
      ).toBe(false);
    });

    it('creates no artificial skills when existing_skills_none=true and returns progress_initialization=deferred_until_level_confirmation before confirmed goal', async () => {
      const baseProfile = {
        user_id: 'user-1',
        current_role_title: 'Student',
        education: null,
        experience_level: 'beginner',
        self_reported_skill_ids: [],
        existing_skills_none: true,
        learning_preference: 'mixed',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        updated_at: '2026-10-10T08:00:00Z',
      };
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM public.user_profiles')) {
          return [baseProfile];
        }
        if (sql.includes('SELECT DISTINCT target_level')) {
          return [];
        }
        if (sql.includes('SELECT p.*,pr.learning_preference')) {
          return [baseProfile];
        }
        if (sql.includes('SELECT s.id AS skill_id')) {
          return [];
        }
        if (sql.includes('SELECT id FROM public.career_goals')) {
          return [];
        }
        return [];
      });
      const transaction = vi.fn((_id, op) => op({ query }));
      const service = new ProfileService({
        transaction,
      } as unknown as DatabaseService);

      const res = await service.patch('user-1', { existing_skills_none: true });
      expect(res.existing_skills).toEqual([]);
      expect(res.existing_skills_none).toBe(true);
      expect(res.progress_initialization).toBe(
        'deferred_until_level_confirmation',
      );
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('INSERT INTO public.skill_progress'),
        ),
      ).toBe(false);
    });

    it('returns R29 UnresolvedSkillDTO candidates when skill alias is ambiguous and sets existing_skills_none=false when skills resolve', async () => {
      const baseProfile = {
        user_id: 'user-1',
        current_role_title: 'Junior Dev',
        education: 'BSc',
        experience_level: 'junior',
        self_reported_skill_ids: [],
        existing_skills_none: true,
        learning_preference: 'hands_on',
        preferred_daily_hours: 2,
        timezone: 'Asia/Dhaka',
        timezone_detected: true,
        updated_at: '2026-10-10T08:00:00Z',
      };
      const reactId = '11111111-1111-4111-8111-111111111111';
      const candidateId = '22222222-2222-4222-8222-222222222222';
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT * FROM public.user_profiles')) {
          return [baseProfile];
        }
        if (sql.includes('SELECT DISTINCT s.id FROM public.skills')) {
          if (params?.[1] === 'React.js') {
            return [{ id: reactId }];
          }
          return [];
        }
        if (sql.includes('canonical_name ILIKE')) {
          return [{ skill_id: candidateId, name: 'Node.js' }];
        }
        if (sql.includes('SELECT DISTINCT target_level')) {
          return [{ target_level: 'junior' }];
        }
        if (sql.includes('INSERT INTO public.skill_progress')) {
          return [{ id: 'sp-1' }];
        }
        if (sql.includes('SELECT p.*,pr.learning_preference')) {
          return [
            {
              ...baseProfile,
              self_reported_skill_ids: [reactId],
              existing_skills_none: false,
            },
          ];
        }
        if (sql.includes('SELECT s.id AS skill_id')) {
          return [
            {
              skill_id: reactId,
              name: 'React',
              alias_resolved: false,
              learning_state: 'learning',
              source: 'self_reported',
            },
          ];
        }
        if (sql.includes('SELECT id FROM public.career_goals')) {
          return [{ id: 'goal-1' }];
        }
        return [];
      });
      const transaction = vi.fn((_id, op) => op({ query }));
      const service = new ProfileService({
        transaction,
      } as unknown as DatabaseService);

      const res = JSON.parse(
        JSON.stringify(
          await service.patch('user-1', {
            existing_skills: [{ name: 'React.js' }, { name: 'node' }],
          }),
        ),
      );
      expect(res.existing_skills_none).toBe(false);
      expect(res.progress_initialization).toBe('initialized');
      expect(res.unresolved_skills).toEqual([
        {
          input: 'node',
          candidates: [{ skill_id: candidateId, name: 'Node.js' }],
        },
      ]);

      const progressInsert = query.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO public.skill_progress'),
      );
      expect(progressInsert).toBeDefined();
      expect(String(progressInsert![0])).toContain(
        "WHERE skill_progress.learning_state='not_started'",
      );
      expect(progressInsert![1]).toEqual(['user-1', 'junior']);
    });

    it('EP-P05 alias upserts user-scoped user_skill_aliases, enforces 100-skill cap, and initializes confirmed levels', async () => {
      const skillId = '33333333-3333-4333-8333-333333333333';
      const existing100 = Array.from(
        { length: 100 },
        (_, idx) =>
          `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      );
      const queryCap = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.skills WHERE id=$1')) {
          return [{ id: skillId }];
        }
        if (sql.includes('SELECT self_reported_skill_ids')) {
          return [{ self_reported_skill_ids: existing100 }];
        }
        return [];
      });
      const serviceCap = new ProfileService({
        transaction: vi.fn((_id, op) => op({ query: queryCap })),
      } as unknown as DatabaseService);

      await expect(
        serviceCap.alias('user-1', { input: 'node', skill_id: skillId }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });

      const queryOk = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.skills WHERE id=$1')) {
          return [{ id: skillId }];
        }
        if (sql.includes('SELECT self_reported_skill_ids')) {
          return [{ self_reported_skill_ids: [] }];
        }
        if (sql.includes('SELECT DISTINCT target_level')) {
          return [{ target_level: 'mid' }];
        }
        if (sql.includes('INSERT INTO public.skill_progress')) {
          return [{ id: 'sp-mid' }];
        }
        return [];
      });
      const serviceOk = new ProfileService({
        transaction: vi.fn((_id, op) => op({ query: queryOk })),
      } as unknown as DatabaseService);

      const aliasRes = await serviceOk.alias('user-1', {
        input: 'node',
        skill_id: skillId,
      });
      expect(aliasRes).toEqual({
        input: 'node',
        skill_id: skillId,
        scope: 'user',
        added_to_profile: true,
        progress_initialization: 'initialized',
      });
      expect(
        queryOk.mock.calls.some(([sql]) =>
          String(sql).includes('INSERT INTO public.user_skill_aliases'),
        ),
      ).toBe(true);
      expect(
        queryOk.mock.calls.some(([sql]) =>
          String(sql).includes('INSERT INTO public.skill_aliases'),
        ),
      ).toBe(false);
    });

    it('accepts 80 Unicode code points (including supplementary characters) and rejects 81 code points (including variation-selector sequences) in patch and alias before SQL', async () => {
      const skillId = '33333333-3333-4333-8333-333333333333';
      const valid80Supplementary = `${'a'.repeat(79)}🚀`;
      const invalid81VariationSelector = `${'a'.repeat(79)}\u2764\uFE0F`;
      const invalid81Supplementary = `${'a'.repeat(80)}🚀`;

      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM public.user_profiles')) {
          return [
            {
              user_id: 'user-1',
              current_role_title: 'Dev',
              education: null,
              experience_level: 'junior',
              self_reported_skill_ids: [],
              existing_skills_none: false,
            },
          ];
        }
        if (sql.includes('SELECT DISTINCT s.id FROM public.skills')) {
          return [{ id: skillId }];
        }
        if (sql.includes('FROM public.skills WHERE id=$1')) {
          return [{ id: skillId }];
        }
        if (sql.includes('SELECT self_reported_skill_ids')) {
          return [{ self_reported_skill_ids: [] }];
        }
        if (sql.includes('SELECT DISTINCT target_level')) {
          return [];
        }
        if (sql.includes('SELECT p.*,pr.learning_preference')) {
          return [
            {
              user_id: 'user-1',
              current_role_title: 'Dev',
              education: null,
              experience_level: 'junior',
              self_reported_skill_ids: [skillId],
              existing_skills_none: false,
              learning_preference: 'mixed',
              preferred_daily_hours: 2,
              timezone: 'Asia/Dhaka',
              timezone_detected: true,
              updated_at: '2026-10-10T08:00:00Z',
            },
          ];
        }
        if (sql.includes('SELECT s.id AS skill_id')) {
          return [];
        }
        if (sql.includes('SELECT id FROM public.career_goals')) {
          return [];
        }
        return [];
      });

      const service = new ProfileService({
        transaction: vi.fn((_id, op) => op({ query })),
      } as unknown as DatabaseService);

      const patchRes = await service.patch('user-1', {
        existing_skills: [{ name: valid80Supplementary }],
      });
      expect(patchRes.existing_skills_none).toBe(false);

      query.mockClear();
      await expect(
        service.patch('user-1', {
          existing_skills: [{ name: invalid81VariationSelector }],
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('FROM public.skills'),
        ),
      ).toBe(false);

      await expect(
        service.patch('user-1', {
          existing_skills: [{ name: invalid81Supplementary }],
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });

      const aliasRes = await service.alias('user-1', {
        input: valid80Supplementary,
        skill_id: skillId,
      });
      expect(aliasRes.input).toBe(valid80Supplementary);

      query.mockClear();
      await expect(
        service.alias('user-1', {
          input: invalid81VariationSelector,
          skill_id: skillId,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
      expect(query).not.toHaveBeenCalled();

      await expect(
        service.alias('user-1', {
          input: invalid81Supplementary,
          skill_id: skillId,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
    });
  });
});
