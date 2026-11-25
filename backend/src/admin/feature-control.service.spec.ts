import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { ADMIN_FEATURE_KEYS } from './dto/admin.dto.js';
import { AuditService } from './services/audit.service.js';
import { FeatureControlService } from './services/feature-control.service.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OVERRIDE_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';

function createMockDb(
  handler: (sql: string, params?: unknown[]) => Promise<unknown[]>,
) {
  const queryMock = vi.fn(handler);
  const database = {
    transaction: vi.fn(
      async (
        _userId: string | null,
        operation: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => operation({ query: queryMock }),
    ),
  };
  return {
    database: database as unknown as DatabaseService,
    queryMock,
  };
}

describe('FeatureControlService (EP-AD04..EP-AD06)', () => {
  it('EP-AD04 lists all 7 global features in canonical deterministic order', async () => {
    const { database } = createMockDb(async () =>
      [...ADMIN_FEATURE_KEYS].reverse().map((key) => ({
        feature_key: key,
        enabled: true,
        updated_at: '2026-11-24T00:00:00.000Z',
        updated_by: ADMIN_ID,
      })),
    );

    const service = new FeatureControlService(
      database,
      new AuditService(database),
    );
    const list = await service.listGlobalFeatures(ADMIN_ID);

    expect(list.map((row) => row.feature_key)).toEqual([...ADMIN_FEATURE_KEYS]);
  });

  it('EP-AD05 toggles global feature atomically with audit log and rejects unknown feature_key with 422 UNKNOWN_FEATURE', async () => {
    let auditParams: unknown[] | undefined;
    const { database } = createMockDb(async (sql, params) => {
      if (sql.includes('AS is_admin')) {
        return [{ status: 'active', is_admin: true }];
      }
      if (sql.includes('FROM public.feature_controls')) {
        return [
          {
            feature_key: 'roadmap_generator',
            enabled: true,
            updated_at: '2026-11-20T00:00:00.000Z',
            updated_by: null,
          },
        ];
      }
      if (sql.startsWith('UPDATE public.feature_controls')) {
        // Real TypeORM Postgres driver returns [rows, affectedCount] for UPDATE ... RETURNING.
        return [
          [
            {
              feature_key: 'roadmap_generator',
              enabled: false,
              updated_at: new Date('2026-11-25T00:00:00.000Z'),
              updated_by: ADMIN_ID,
            },
          ],
          1,
        ];
      }
      if (sql.includes('INSERT INTO public.admin_audit_logs')) {
        auditParams = params;
        return [];
      }
      return [];
    });

    const service = new FeatureControlService(
      database,
      new AuditService(database),
    );

    await expect(
      service.setGlobalFeature(
        ADMIN_ID,
        { feature_key: 'not_a_real_feature', enabled: false },
        { requestId: REQUEST_ID, ipAddress: '198.51.100.1' },
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'UNKNOWN_FEATURE' },
    });

    const result = await service.setGlobalFeature(
      ADMIN_ID,
      { feature_key: 'roadmap_generator', enabled: false },
      { requestId: REQUEST_ID, ipAddress: '198.51.100.1' },
    );

    expect(result).toEqual({
      feature_key: 'roadmap_generator',
      enabled: false,
      updated_at: '2026-11-25T00:00:00.000Z',
      updated_by: ADMIN_ID,
    });
    expect(result.feature_key).toBe('roadmap_generator');
    expect(typeof result.enabled).toBe('boolean');
    expect(typeof result.updated_at).toBe('string');
    expect(result.updated_by).toBe(ADMIN_ID);
    expect(auditParams?.[1]).toBe('feature.global_update');
    expect(auditParams?.[5]).toBe(
      JSON.stringify({ feature_key: 'roadmap_generator', enabled: true }),
    );
    expect(auditParams?.[6]).toBe(
      JSON.stringify({ feature_key: 'roadmap_generator', enabled: false }),
    );
  });

  it('EP-AD06 sets per-user override true/false and deletes row on null (reverting technology_update to default OFF)', async () => {
    let userOverride: boolean | null = null;
    let globalTechEnabled = true;
    let userStatus: 'active' | 'suspended' = 'active';
    const executedActions: string[] = [];

    const { database } = createMockDb(async (sql, params) => {
      if (sql.includes('FROM public.users') && sql.includes('FOR UPDATE')) {
        return [{ id: ADMIN_ID }, { id: USER_ID }];
      }
      if (sql.includes('AS is_admin')) {
        return [{ status: 'active', is_admin: true }];
      }
      if (
        sql.includes('FROM public.user_access_overrides') &&
        sql.includes('FOR UPDATE')
      ) {
        return userOverride === null
          ? []
          : [{ id: OVERRIDE_ID, enabled: userOverride }];
      }
      if (sql.includes('INSERT INTO public.user_access_overrides')) {
        userOverride = Boolean(params?.[2]);
        executedActions.push(`upsert:${String(userOverride)}`);
        return [{ id: OVERRIDE_ID }];
      }
      if (sql.includes('DELETE FROM public.user_access_overrides')) {
        userOverride = null;
        executedActions.push('delete');
        return [];
      }
      if (sql.includes('INSERT INTO public.admin_audit_logs')) {
        executedActions.push(`audit:${String(params?.[1])}`);
        return [];
      }
      if (sql.includes('FROM public.users u')) {
        return [
          {
            id: USER_ID,
            email: 'user@example.com',
            phone: null,
            status: userStatus,
            created_at: '2026-11-01T00:00:00.000Z',
            last_active_at: null,
          },
        ];
      }
      if (sql.includes('FROM public.feature_controls fc')) {
        return ADMIN_FEATURE_KEYS.map((key) => ({
          feature_key: key,
          global_enabled:
            key === 'technology_update' ? globalTechEnabled : true,
          default_user_enabled: key !== 'technology_update',
          user_override: key === 'technology_update' ? userOverride : null,
        }));
      }
      if (sql.includes('AS mentor_messages')) {
        return [
          {
            roadmaps: 0,
            quizzes_submitted: 0,
            mentor_messages: 0,
            ai_requests: 0,
          },
        ];
      }
      return [];
    });

    const service = new FeatureControlService(
      database,
      new AuditService(database),
    );

    // 1. Enable technology_update for user
    const enabledRes = await service.setUserFeature(
      ADMIN_ID,
      USER_ID,
      { feature_key: 'technology_update', enabled: true },
      { requestId: REQUEST_ID, ipAddress: '198.51.100.2' },
    );
    expect(enabledRes.technology_update_enabled).toBe(true);
    expect(
      enabledRes.feature_access.find(
        (f) => f.feature_key === 'technology_update',
      ),
    ).toEqual({
      feature_key: 'technology_update',
      global_enabled: true,
      user_override: true,
      effective: true,
    });

    // 2. Global OFF beats user override ON
    globalTechEnabled = false;
    const globalOffRes = await service.setUserFeature(
      ADMIN_ID,
      USER_ID,
      { feature_key: 'technology_update', enabled: true },
      { requestId: REQUEST_ID, ipAddress: '198.51.100.2' },
    );
    expect(globalOffRes.technology_update_enabled).toBe(false);
    expect(
      globalOffRes.feature_access.find(
        (f) => f.feature_key === 'technology_update',
      )?.effective,
    ).toBe(false);

    // 3. Suspended user beats all overrides even when global ON
    globalTechEnabled = true;
    userStatus = 'suspended';
    const suspendedRes = await service.setUserFeature(
      ADMIN_ID,
      USER_ID,
      { feature_key: 'technology_update', enabled: true },
      { requestId: REQUEST_ID, ipAddress: '198.51.100.2' },
    );
    expect(
      suspendedRes.feature_access.every((f) => f.effective === false),
    ).toBe(true);

    // 4. Setting enabled: null deletes override row and reverts technology_update to default OFF
    userStatus = 'active';
    const clearedRes = await service.setUserFeature(
      ADMIN_ID,
      USER_ID,
      { feature_key: 'technology_update', enabled: null },
      { requestId: REQUEST_ID, ipAddress: '198.51.100.2' },
    );
    expect(clearedRes.technology_update_enabled).toBe(false);
    expect(
      clearedRes.feature_access.find(
        (f) => f.feature_key === 'technology_update',
      ),
    ).toEqual({
      feature_key: 'technology_update',
      global_enabled: true,
      user_override: null,
      effective: false,
    });
    expect(executedActions).toContain('delete');
    expect(executedActions).toContain('audit:feature.user_override_clear');
  });
});
