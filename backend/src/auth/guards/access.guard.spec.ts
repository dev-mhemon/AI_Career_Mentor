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
        user: {
          sub: '11111111-1111-4111-8111-111111111111',
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          role: 'ADMIN',
        },
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
    const f = fixture({ allowSuspended: true, accountInspection: true }, [
      [{ status: 'suspended' }],
    ]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  it('allows suspended user with unrevoked approved session on AZ-SUSP routes like logout', async () => {
    const f = fixture({ allowSuspended: true }, [
      [
        {
          status: 'suspended',
          verified_contact: true,
          session_approved: false,
          unrevoked_session_approved: true,
        },
      ],
    ]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  it('denies suspended user on AZ-SUSP route when session is revoked or unapproved', async () => {
    const f = fixture({ allowSuspended: true }, [
      [
        {
          status: 'suspended',
          verified_contact: true,
          session_approved: false,
          unrevoked_session_approved: false,
        },
      ],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'UNVERIFIED_ACCOUNT' },
    });
  });
  it('denies an active verified account when the current session is unapproved', async () => {
    const f = fixture({}, [
      [{ status: 'active', verified_contact: true, session_approved: false }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'UNVERIFIED_ACCOUNT' },
    });
  });
  it('rejects a token whose session was revoked by resetPassword or logout', async () => {
    const f = fixture({}, [
      [{ status: 'active', verified_contact: true, session_approved: false }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      status: 403,
      response: {
        code: 'UNVERIFIED_ACCOUNT',
        message: 'Approved session required',
      },
    });
  });
  it('fails closed with 401 when sessionId is missing on request user', async () => {
    const f = fixture({}, []);
    const context = {
      ...f.context,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: '11111111-1111-4111-8111-111111111111' },
        }),
      }),
    } as unknown as ExecutionContext;
    await expect(f.guard.canActivate(context)).rejects.toMatchObject({
      status: 401,
      response: { code: 'AUTH_REQUIRED' },
    });
  });
  it('fails closed when the approval lookup is unavailable', async () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue({});
    const database = {
      transaction: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as DatabaseService;
    const guard = new AccessGuard(reflector, database);
    const context = fixture({}, []).context;

    await expect(guard.canActivate(context)).rejects.toThrow(
      'database unavailable',
    );
  });
  it('does not trust ADMIN on the JWT request', async () => {
    const f = fixture({ admin: true }, [
      [
        {
          status: 'active',
          verified_contact: true,
          session_approved: true,
        },
      ],
      [],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'ADMIN_REQUIRED' },
    });
  });
  it('global off beats positive override', async () => {
    const f = fixture({ feature: 'ai_mentor' }, [
      [{ status: 'active', verified_contact: true, session_approved: true }],
      [{ enabled: false, default_user_enabled: true, override: true }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'FEATURE_DISABLED' },
    });
  });
  it('negative override beats positive default', async () => {
    const f = fixture({ feature: 'ai_mentor' }, [
      [{ status: 'active', verified_contact: true, session_approved: true }],
      [{ enabled: true, default_user_enabled: true, override: false }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'FEATURE_DISABLED' },
    });
  });
  it('positive override grants when default off', async () => {
    const f = fixture({ feature: 'ai_mentor' }, [
      [{ status: 'active', verified_contact: true, session_approved: true }],
      [{ enabled: true, default_user_enabled: false, override: true }],
    ]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
  });
  it('preserves existing reads under generation feature off', async () => {
    const f = fixture({ feature: 'roadmap_generator', existingRead: true }, [
      [{ status: 'active', verified_contact: true, session_approved: true }],
    ]);
    expect(await f.guard.canActivate(f.context)).toBe(true);
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('technology update reads still require effective feature', async () => {
    const f = fixture({ feature: 'technology_update', existingRead: true }, [
      [{ status: 'active', verified_contact: true, session_approved: true }],
      [{ enabled: false }],
    ]);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({
      response: { code: 'FEATURE_DISABLED' },
    });
  });
});
