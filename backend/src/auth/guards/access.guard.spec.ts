import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AccessGuard } from './access.guard.js';
import { DatabaseService } from '../services/database.service.js';
import type { AccessPolicy } from '../policy.js';
function fixture(policy: AccessPolicy, answers: any[]) {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(policy);
  const query = vi
    .fn()
    .mockImplementation(() => Promise.resolve(answers.shift()));
  const database = {
    transaction: vi.fn((_id, fn) => fn({ query })),
  } as unknown as DatabaseService;
  const guard = new AccessGuard(reflector, database);
  const context = {
    getHandler: () => function () {},
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({
        user: { sub: '11111111-1111-4111-8111-111111111111', role: 'ADMIN' },
      }),
    }),
  } as unknown as ExecutionContext;
  return { guard, context, query };
}
describe('Reviewed AccessGuard policy order', () => {
  it('fails closed when mapping is missing', async () => {
    const f = fixture({}, [[]]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('checks suspension before admin and features', async () => {
    const f = fixture({ admin: true, feature: 'ai_mentor' }, [
      [{ status: 'suspended' }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('allows suspended auth/me exception', async () => {
    const f = fixture({ allowSuspended: true }, [[{ status: 'suspended' }]]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  it('does not trust ADMIN on the JWT request', async () => {
    const f = fixture({ admin: true }, [[{ status: 'active' }], []]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'ADMIN_REQUIRED' },
    });
  });
  it('global off beats positive override', async () => {
    const f = fixture({ feature: 'ai_mentor' }, [
      [{ status: 'active' }],
      [{ enabled: false, default_user_enabled: true, override: true }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'FEATURE_DISABLED' },
    });
  });
  it('negative override beats positive default', async () => {
    const f = fixture({ feature: 'ai_mentor' }, [
      [{ status: 'active' }],
      [{ enabled: true, default_user_enabled: true, override: false }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'FEATURE_DISABLED' },
    });
  });
  it('positive override grants when default off', async () => {
    const f = fixture({ feature: 'ai_mentor' }, [
      [{ status: 'active' }],
      [{ enabled: true, default_user_enabled: false, override: true }],
    ]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  it('preserves existing reads under generation feature off', async () => {
    const f = fixture({ feature: 'roadmap_generator', existingRead: true }, [
      [{ status: 'active' }],
    ]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('technology update reads still require effective feature', async () => {
    const f = fixture({ feature: 'technology_update', existingRead: true }, [
      [{ status: 'active' }],
      [{ enabled: false }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'FEATURE_DISABLED' },
    });
  });
});
