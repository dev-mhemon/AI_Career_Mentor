import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { AuditService, decodeKeysetCursor } from './services/audit.service.js';
import { UsageService } from './services/usage.service.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const LOG_ID_1 = '33333333-3333-4333-8333-333333333333';
const LOG_ID_2 = '44444444-4444-4444-8444-444444444444';

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

class FixedClockUsageService extends UsageService {
  constructor(
    database: DatabaseService,
    private readonly fixedTodayUtcMs: number,
  ) {
    super(database);
  }

  protected override getTodayUtcMidnightMs(): number {
    return this.fixedTodayUtcMs;
  }
}

describe('AuditService (EP-AD07) & UsageService (EP-AD08 / R30)', () => {
  describe('AuditService.listAuditLogs (EP-AD07)', () => {
    it('applies actor_id, target_user_id, action, from, to filters and preserves microsecond precision across keyset cursor pages', async () => {
      const capturedQueries: Array<{ sql: string; params?: unknown[] }> = [];

      const { database } = createMockDb(async (sql, params) => {
        capturedQueries.push({ sql, params });
        if (capturedQueries.length === 1) {
          return [
            {
              id: LOG_ID_1,
              actor_id: ADMIN_ID,
              action: 'user.suspend',
              target_type: 'user',
              target_id: TARGET_ID,
              before_state: { status: 'active' },
              after_state: { status: 'suspended', reason: 'Abuse' },
              http_request_id: '77777777-7777-4777-8777-777777777777',
              created_at: new Date('2026-11-24T12:00:00.123Z'),
              created_at_cursor: '2026-11-24T12:00:00.123900Z',
            },
            {
              id: LOG_ID_2,
              actor_id: ADMIN_ID,
              action: 'user.suspend',
              target_type: 'user',
              target_id: TARGET_ID,
              before_state: { status: 'active' },
              after_state: { status: 'suspended', reason: 'Older' },
              http_request_id: null,
              created_at: new Date('2026-11-24T12:00:00.123Z'),
              created_at_cursor: '2026-11-24T12:00:00.123100Z',
            },
          ];
        }
        return [
          {
            id: LOG_ID_2,
            actor_id: ADMIN_ID,
            action: 'user.suspend',
            target_type: 'user',
            target_id: TARGET_ID,
            before_state: { status: 'active' },
            after_state: { status: 'suspended', reason: 'Older' },
            http_request_id: null,
            created_at: new Date('2026-11-24T12:00:00.123Z'),
            created_at_cursor: '2026-11-24T12:00:00.123100Z',
          },
        ];
      });

      const service = new AuditService(database);
      const res = await service.listAuditLogs(ADMIN_ID, {
        actor_id: ADMIN_ID,
        target_user_id: TARGET_ID,
        action: 'user.suspend',
        from: '2026-11-20T00:00:00Z',
        to: '2026-11-25T00:00:00Z',
        limit: 1,
      });

      expect(capturedQueries[0].sql).toContain('a.actor_id = $1::uuid');
      expect(capturedQueries[0].sql).toContain('a.target_user_id = $2::uuid');
      expect(capturedQueries[0].sql).toContain('a.action = $3');
      expect(capturedQueries[0].sql).toContain(
        'a.created_at >= $4::timestamptz',
      );
      expect(capturedQueries[0].sql).toContain(
        'a.created_at <= $5::timestamptz',
      );
      expect(capturedQueries[0].params?.[5]).toBe(2); // limit + 1

      expect(res.items).toEqual([
        {
          id: LOG_ID_1,
          actor_id: ADMIN_ID,
          action: 'user.suspend',
          target_type: 'user',
          target_id: TARGET_ID,
          before: { status: 'active' },
          after: { status: 'suspended', reason: 'Abuse' },
          request_id: '77777777-7777-4777-8777-777777777777',
          created_at: '2026-11-24T12:00:00.123Z',
        },
      ]);
      expect(res.meta.limit).toBe(1);
      expect(decodeKeysetCursor(res.meta.next_cursor!)).toEqual({
        createdAt: '2026-11-24T12:00:00.123900Z',
        id: LOG_ID_1,
      });

      // Consume the emitted microsecond cursor on page 2 -> must preserve .123900Z boundary and return .123100Z event
      const page2 = await service.listAuditLogs(ADMIN_ID, {
        actor_id: ADMIN_ID,
        target_user_id: TARGET_ID,
        action: 'user.suspend',
        from: '2026-11-20T00:00:00Z',
        to: '2026-11-25T00:00:00Z',
        limit: 1,
        cursor: res.meta.next_cursor!,
      });

      expect(capturedQueries[1].sql).toContain(
        '(a.created_at < $6::timestamptz OR (a.created_at = $6::timestamptz AND a.id < $7::uuid))',
      );
      expect(capturedQueries[1].params?.[5]).toBe(
        '2026-11-24T12:00:00.123900Z',
      );
      expect(capturedQueries[1].params?.[6]).toBe(LOG_ID_1);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].id).toBe(LOG_ID_2);
      expect(page2.meta.next_cursor).toBeNull();
    });

    it('rejects from > to and malformed timestamps with 422 VALIDATION_FAILED', async () => {
      const { database } = createMockDb(async () => []);
      const service = new AuditService(database);

      await expect(
        service.listAuditLogs(ADMIN_ID, {
          from: '2026-11-25T00:00:00Z',
          to: '2026-11-24T00:00:00Z',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });

      await expect(
        service.listAuditLogs(ADMIN_ID, {
          from: '2026-02-30T00:00:00Z',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('UsageService.getUsageSummary (EP-AD08 / R30)', () => {
    it('defaults to last 30 inclusive UTC dates including today and zero-fills every UTC day bucket', async () => {
      let calledParams: unknown[] | undefined;
      const { database } = createMockDb(async (_sql, params) => {
        calledParams = params;
        return [
          {
            summary: {
              range: { from: '2026-10-27', to: '2026-11-25' },
              users: { total: 100, active_last_7_days: 55 },
              counts: {
                roadmaps_locked: 42,
                quizzes_submitted: 210,
                mentor_messages: 650,
                technology_updates_generated: 30,
              },
              ai: {
                requests: 15,
                failures: 2,
                fallbacks_used: 1,
                usage_units: { input: 10000, output: 4000 },
                estimated_cost_usd: 0.125,
                by_day: [
                  {
                    day: '2026-11-25',
                    requests: 15,
                    failures: 2,
                    fallbacks_used: 1,
                    input_units: 10000,
                    output_units: 4000,
                    estimated_cost_usd: 0.125,
                  },
                ],
                by_feature: [
                  {
                    feature_key: 'ai_mentor',
                    requests: 10,
                    estimated_cost_usd: 0.08,
                  },
                ],
                by_provider: [
                  {
                    provider_id: 'gemini',
                    requests: 15,
                    estimated_cost_usd: 0.125,
                  },
                ],
              },
            },
          },
        ];
      });

      const service = new FixedClockUsageService(
        database,
        Date.UTC(2026, 10, 25), // 2026-11-25 UTC
      );

      const res = await service.getUsageSummary(ADMIN_ID);

      expect(calledParams).toEqual(['2026-10-27', '2026-11-25']);
      expect(res.range).toEqual({ from: '2026-10-27', to: '2026-11-25' });
      expect(res.series.group_by).toBe('day');
      expect(res.series.buckets).toHaveLength(30);
      expect(res.ai.by_day).toHaveLength(30);
      expect(res.series.buckets[0]).toEqual({
        key: '2026-10-27',
        requests: 0,
        estimated_cost_usd: 0,
        failures: 0,
        fallbacks_used: 0,
        input_units: 0,
        output_units: 0,
      });
      expect(res.series.buckets[29]).toEqual({
        key: '2026-11-25',
        requests: 15,
        estimated_cost_usd: 0.125,
        failures: 2,
        fallbacks_used: 1,
        input_units: 10000,
        output_units: 4000,
      });
    });

    it('maps feature and provider series buckets with explicit null for unavailable dimensions per R30', async () => {
      const { database } = createMockDb(async () => [
        {
          summary: {
            ai: {
              requests: 20,
              failures: 0,
              fallbacks_used: 0,
              usage_units: { input: 2000, output: 1000 },
              estimated_cost_usd: 0.05,
              by_day: [],
              by_feature: [
                {
                  feature_key: 'roadmap_generator',
                  requests: 8,
                  estimated_cost_usd: 0.03,
                },
                {
                  feature_key: 'ai_mentor',
                  requests: 12,
                  estimated_cost_usd: 0.02,
                },
              ],
              by_provider: [
                {
                  provider_id: 'gemini',
                  requests: 20,
                  estimated_cost_usd: 0.05,
                },
              ],
            },
          },
        },
      ]);

      const service = new FixedClockUsageService(
        database,
        Date.UTC(2026, 10, 25),
      );

      const byFeature = await service.getUsageSummary(ADMIN_ID, {
        from: '2026-11-24',
        to: '2026-11-25',
        group_by: 'feature',
      });
      expect(byFeature.series).toEqual({
        group_by: 'feature',
        buckets: [
          {
            key: 'roadmap_generator',
            requests: 8,
            estimated_cost_usd: 0.03,
            failures: null,
            fallbacks_used: null,
            input_units: null,
            output_units: null,
          },
          {
            key: 'ai_mentor',
            requests: 12,
            estimated_cost_usd: 0.02,
            failures: null,
            fallbacks_used: null,
            input_units: null,
            output_units: null,
          },
        ],
      });

      const byProvider = await service.getUsageSummary(ADMIN_ID, {
        from: '2026-11-24',
        to: '2026-11-25',
        group_by: 'provider',
      });
      expect(byProvider.series).toEqual({
        group_by: 'provider',
        buckets: [
          {
            key: 'gemini',
            requests: 20,
            estimated_cost_usd: 0.05,
            failures: null,
            fallbacks_used: null,
            input_units: null,
            output_units: null,
          },
        ],
      });
    });

    it('accepts exact 366 inclusive UTC days (leap year) and rejects 367 days, from > to, and impossible dates with 422', async () => {
      const { database } = createMockDb(async () => [{ summary: {} }]);
      const service = new FixedClockUsageService(
        database,
        Date.UTC(2026, 10, 25),
      );

      // 2024 is a leap year: 2024-01-01..2024-12-31 = exact 366 inclusive UTC days -> PASS
      const maxValid = await service.getUsageSummary(ADMIN_ID, {
        from: '2024-01-01',
        to: '2024-12-31',
      });
      expect(maxValid.series.buckets).toHaveLength(366);

      // 367 inclusive UTC days -> 422
      await expect(
        service.getUsageSummary(ADMIN_ID, {
          from: '2024-01-01',
          to: '2025-01-01',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });

      // Impossible calendar date -> 422
      await expect(
        service.getUsageSummary(ADMIN_ID, {
          from: '2026-02-30',
          to: '2026-03-01',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });

      // Reversed range -> 422
      await expect(
        service.getUsageSummary(ADMIN_ID, {
          from: '2026-11-25',
          to: '2026-11-24',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
    });
  });
});
