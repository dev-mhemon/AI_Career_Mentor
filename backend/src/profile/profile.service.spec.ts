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
