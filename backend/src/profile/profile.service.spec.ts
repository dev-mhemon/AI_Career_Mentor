import type { DatabaseService } from '../auth/services/database.service.js';
import { ProfileService } from './profile.service.js';

describe('C05 career goal response contract', () => {
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
      const query = vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'goal',
            alternative_role_ids: roles.map((role) => role.canonical_role_id),
          },
        ])
        .mockResolvedValueOnce(roles);
      const transaction = vi.fn((_id, operation) => operation({ query }));
      const service = new ProfileService({
        transaction,
      } as unknown as DatabaseService);

      // Exercise the consuming JSON shape: undefined must not silently omit a required field.
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
      expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [
        'owner',
        'goal',
      ]);
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
        sql.includes('UPDATE public.career_goals'),
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
      sql.includes('UPDATE public.user_profiles'),
    );
    expect(updateCall).toBeDefined();
    // $3 is education in: UPDATE public.user_profiles SET current_role_title=$2,education=$3,experience_level=$4...
    expect(updateCall![1][2]).toBeNull();
    expect(result.education).toBeNull();
    expect(result.education_level).toBeNull();
  });
});
