import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { TransactionalQueryExecutor } from '../profile/profile.service.js';
import { assertValidLearningHours } from './dto/learning.dto.js';
import {
  DailyPlanService,
  packItemsIntoDays,
} from './services/daily-plan.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const TOPIC_1 = '55555555-5555-4555-8555-555555555551';
const TOPIC_2 = '55555555-5555-4555-8555-555555555552';
const TOPIC_3 = '55555555-5555-4555-8555-555555555553';
const LINEAGE_1 = '66666666-6666-4666-8666-666666666661';
const LINEAGE_2 = '66666666-6666-4666-8666-666666666662';
const LINEAGE_3 = '66666666-6666-4666-8666-666666666663';
const ITEM_1 = '77777777-7777-4777-8777-777777777771';
const ITEM_2 = '77777777-7777-4777-8777-777777777772';
const ITEM_3 = '77777777-7777-4777-8777-777777777773';

function expectContractError(
  error: unknown,
  status: number,
  code: string,
): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(status);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(code);
}

describe('DailyPlanService (EP-L01, EP-L02, EP-L03)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let service: DailyPlanService;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        _userId: string,
        op: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => op({ query: queryMock }),
    );
    databaseMock = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;
    service = new DailyPlanService(databaseMock);
  });

  describe('assertValidLearningHours & packItemsIntoDays', () => {
    it('enforces 0.5..12 in 0.5 increments and rejects booleans/strings/null/missing with 422 LEARNING_HOURS_REQUIRED', () => {
      expect(assertValidLearningHours(0.5)).toBe(0.5);
      expect(assertValidLearningHours(2)).toBe(2);
      expect(assertValidLearningHours(1.5)).toBe(1.5);
      expect(assertValidLearningHours(12)).toBe(12);

      for (const bad of [
        undefined,
        null,
        true,
        false,
        '2',
        NaN,
        Infinity,
        0,
        -1,
        0.25,
        1.3,
        12.5,
      ]) {
        try {
          assertValidLearningHours(bad);
          expect.fail(`Expected rejection for ${String(bad)}`);
        } catch (err) {
          expectContractError(err, 422, 'LEARNING_HOURS_REQUIRED');
        }
      }
    });

    it('packs items deterministically into sequential days respecting hours_per_day', () => {
      const packed = packItemsIntoDays(
        [
          {
            lineage_id: LINEAGE_1,
            topic_id: TOPIC_1,
            title: 'Topic A',
            effort_hours: 1,
          },
          {
            lineage_id: LINEAGE_2,
            topic_id: TOPIC_2,
            title: 'Topic B',
            effort_hours: 1,
          },
          {
            lineage_id: LINEAGE_3,
            topic_id: TOPIC_3,
            title: 'Topic C',
            effort_hours: 3,
          },
        ],
        2,
        1,
      );
      expect(packed.map((p) => [p.title, p.day_no, p.sort_order])).toEqual([
        ['Topic A', 1, 1],
        ['Topic B', 1, 2],
        ['Topic C', 2, 1],
      ]);
    });
  });

  describe('EP-L01 getDailyPlan', () => {
    it('returns paginated Focus Roadmap Daily Plan with foreground=false and opaque day cursor', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('is_focus = true')
        ) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              is_focus: true,
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.daily_plans')) {
          return [
            {
              id: PLAN_ID,
              roadmap_id: ROADMAP_ID,
              hours_per_day: '2.0',
              status: 'active',
              roadmap_version_id: VERSION_ID,
              plan_revision: 1,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ version_no: 2 }];
        }
        if (sql.includes('FROM public.daily_plan_items dpi')) {
          return [
            {
              id: ITEM_1,
              day_no: 1,
              sort_order: 1,
              lineage_id: LINEAGE_1,
              topic_id: TOPIC_1,
              title: 'SQL Basics',
              allocated_hours: '2.0',
              status: 'completed',
              started_at: '2026-11-20T10:00:00.000Z',
              completed_at: '2026-11-20T11:00:00.000Z',
              reconciled_by_merge_id: null,
            },
            {
              id: ITEM_2,
              day_no: 2,
              sort_order: 1,
              lineage_id: LINEAGE_2,
              topic_id: TOPIC_2,
              title: 'SQL Joins',
              allocated_hours: '2.0',
              status: 'pending',
              started_at: null,
              completed_at: null,
              reconciled_by_merge_id: null,
            },
            {
              id: ITEM_3,
              day_no: 3,
              sort_order: 1,
              lineage_id: LINEAGE_3,
              topic_id: TOPIC_3,
              title: 'Indexes',
              allocated_hours: '2.0',
              status: 'pending',
              started_at: null,
              completed_at: null,
              reconciled_by_merge_id: null,
            },
          ];
        }
        return [];
      });

      const page1 = await service.getDailyPlan(USER_ID, { limit: 2 });
      expect(transactionMock).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Function),
        true,
        false,
      );
      expect(page1.plan.plan_id).toBe(PLAN_ID);
      expect(page1.plan.is_focus).toBe(true);
      expect(page1.plan.roadmap_version_no).toBe(2);
      expect(page1.plan.total_days).toBe(3);
      expect(page1.plan.completed_days).toBe(1);
      expect(page1.plan.next_incomplete_day_no).toBe(2);
      expect(page1.plan.days).toHaveLength(2);
      expect(page1.meta.next_cursor).toBeTruthy();

      const page2 = await service.getDailyPlan(USER_ID, {
        limit: 2,
        cursor: page1.meta.next_cursor ?? undefined,
      });
      expect(page2.plan.days.map((d) => d.day_no)).toEqual([3]);
      expect(page2.meta.next_cursor).toBeNull();
    });

    it('throws 404 NO_FOCUS_ROADMAP when roadmap_id omitted and no Focus exists, and rejects out-of-range int4 cursor', async () => {
      queryMock.mockResolvedValueOnce([]);
      await expect(service.getDailyPlan(USER_ID)).rejects.toSatisfy((err) => {
        expectContractError(err, 404, 'NO_FOCUS_ROADMAP');
        return true;
      });

      const overflowCursor = Buffer.from(
        JSON.stringify({ day_no: 2_147_483_648 }),
        'utf8',
      ).toString('base64url');
      await expect(
        service.getDailyPlan(USER_ID, { cursor: overflowCursor }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 400, 'INVALID_FORMAT');
        return true;
      });
    });
  });

  describe('EP-L02 createDailyPlan', () => {
    it('creates plan deterministically, excludes retired items, saves preferred_daily_hours, and uses foreground=true', async () => {
      let profileUpdatedWithHours: unknown = null;
      let itemCounter = 0;

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('effective_feature_access')) {
          return [{ allowed: true }];
        }
        if (
          sql.includes('FROM public.roadmaps') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              is_focus: true,
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.daily_plans')) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ version_no: 1 }];
        }
        if (sql.includes('FROM public.roadmap_items ri')) {
          expect(sql).toContain('ri.retired = false');
          return [
            {
              id: 'a1',
              lineage_id: LINEAGE_1,
              topic_id: TOPIC_1,
              title: 'HTTP Basics',
              phase_no: 1,
              sequence_no: 1,
              estimated_effort_hours: '1.0',
            },
            {
              id: 'a2',
              lineage_id: LINEAGE_2,
              topic_id: TOPIC_2,
              title: 'REST Design',
              phase_no: 1,
              sequence_no: 2,
              estimated_effort_hours: '1.0',
            },
            {
              id: 'a3',
              lineage_id: LINEAGE_3,
              topic_id: TOPIC_3,
              title: 'Postgres Locks',
              phase_no: 2,
              sequence_no: 3,
              estimated_effort_hours: '2.5',
            },
          ];
        }
        if (sql.includes('INSERT INTO public.daily_plans')) {
          return [
            [
              {
                id: PLAN_ID,
                roadmap_id: ROADMAP_ID,
                hours_per_day: '2.0',
                status: 'active',
                roadmap_version_id: VERSION_ID,
                plan_revision: 1,
              },
            ],
            1,
          ];
        }
        if (sql.includes('INSERT INTO public.daily_plan_items')) {
          itemCounter += 1;
          return [
            [
              {
                id: `77777777-7777-4777-8777-77777777777${itemCounter}`,
                day_no: params?.[2],
                sort_order: params?.[3],
                lineage_id: params?.[4],
                topic_id: params?.[5],
                allocated_hours: params?.[6],
                status: 'pending',
                started_at: null,
                completed_at: null,
                reconciled_by_merge_id: null,
              },
            ],
            1,
          ];
        }
        if (sql.includes('UPDATE public.user_profiles')) {
          profileUpdatedWithHours = params?.[1];
          return [];
        }
        return [];
      });

      const created = await service.createDailyPlan(USER_ID, {
        roadmap_id: ROADMAP_ID,
        hours_per_day: 2,
      });

      expect(transactionMock).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Function),
        true,
        true,
      );
      expect(profileUpdatedWithHours).toBe(2);
      expect(created.plan_id).toBe(PLAN_ID);
      expect(created.hours_per_day).toBe(2);
      expect(created.total_days).toBe(2);
      expect(created.next_incomplete_day_no).toBe(1);
      expect(created.days[0]?.topics.map((t) => t.title)).toEqual([
        'HTTP Basics',
        'REST Design',
      ]);
      expect(created.days[1]?.topics.map((t) => t.title)).toEqual([
        'Postgres Locks',
      ]);
    });

    it('rejects draft roadmap with 409 ROADMAP_NOT_LOCKED and maps 23505 race to 409 DAILY_PLAN_EXISTS', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ allowed: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'draft',
              is_focus: false,
              current_version_id: null,
            },
          ];
        }
        return [];
      });

      await expect(
        service.createDailyPlan(USER_ID, {
          roadmap_id: ROADMAP_ID,
          hours_per_day: 2,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'ROADMAP_NOT_LOCKED');
        return true;
      });

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ allowed: true }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              is_focus: true,
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('FROM public.roadmap_versions'))
          return [{ version_no: 1 }];
        if (sql.includes('FROM public.roadmap_items ri')) {
          return [
            {
              id: 'a1',
              lineage_id: LINEAGE_1,
              topic_id: TOPIC_1,
              title: 'HTTP Basics',
              phase_no: 1,
              sequence_no: 1,
              estimated_effort_hours: '1.0',
            },
          ];
        }
        if (sql.includes('INSERT INTO public.daily_plans')) {
          throw { code: '23505', constraint: 'uq_daily_plans_roadmap' };
        }
        return [];
      });

      await expect(
        service.createDailyPlan(USER_ID, {
          roadmap_id: ROADMAP_ID,
          hours_per_day: 2,
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'DAILY_PLAN_EXISTS');
        return true;
      });
    });
  });

  describe('EP-L03 rebuildDailyPlan', () => {
    it('freezes completed days AND days with unsubmitted quiz attempts, repacks only future pending days, and never mutates roadmap_items', async () => {
      let deletedIds: unknown = null;
      const reinserted: Array<{ day_no: unknown; lineage_id: unknown }> = [];
      let profileSavedHours: unknown = null;

      queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('effective_feature_access'))
          return [{ allowed: true }];
        if (
          sql.includes('FROM public.daily_plans') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            {
              id: PLAN_ID,
              roadmap_id: ROADMAP_ID,
              hours_per_day: '1.0',
              status: 'active',
              roadmap_version_id: VERSION_ID,
              plan_revision: 1,
            },
          ];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              is_focus: true,
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.daily_plan_items dpi')) {
          expect(sql).toContain('FOR UPDATE OF dpi');
          return [
            {
              id: ITEM_1,
              day_no: 1,
              sort_order: 1,
              lineage_id: LINEAGE_1,
              topic_id: TOPIC_1,
              title: 'Day 1 Done',
              allocated_hours: '1.0',
              status: 'completed',
              started_at: '2026-11-20T10:00:00.000Z',
              completed_at: '2026-11-20T11:00:00.000Z',
              reconciled_by_merge_id: null,
            },
            {
              id: ITEM_2,
              day_no: 2,
              sort_order: 1,
              lineage_id: LINEAGE_2,
              topic_id: TOPIC_2,
              title: 'Day 2 Active Quiz',
              allocated_hours: '1.0',
              status: 'pending',
              started_at: null,
              completed_at: null,
              reconciled_by_merge_id: null,
            },
            {
              id: ITEM_3,
              day_no: 3,
              sort_order: 1,
              lineage_id: LINEAGE_3,
              topic_id: TOPIC_3,
              title: 'Day 3 Future Pending',
              allocated_hours: '1.0',
              status: 'pending',
              started_at: null,
              completed_at: null,
              reconciled_by_merge_id: null,
            },
          ];
        }
        if (sql.includes('FROM public.quiz_attempts')) {
          // Day 2 item has an unsubmitted quiz -> must stay frozen!
          return [{ daily_plan_item_id: ITEM_2 }];
        }
        if (sql.includes('FROM public.ai_requests')) {
          return [];
        }
        if (sql.includes('DELETE FROM public.daily_plan_items')) {
          deletedIds = params?.[2];
          return [];
        }
        if (sql.includes('INSERT INTO public.daily_plan_items')) {
          reinserted.push({ day_no: params?.[2], lineage_id: params?.[4] });
          return [
            [
              {
                id: '99999999-9999-4999-8999-999999999999',
                day_no: params?.[2],
                sort_order: params?.[3],
                lineage_id: params?.[4],
                topic_id: params?.[5],
                allocated_hours: params?.[6],
                status: 'pending',
                started_at: null,
                completed_at: null,
                reconciled_by_merge_id: null,
              },
            ],
            1,
          ];
        }
        if (sql.includes('UPDATE public.daily_plans')) {
          expect(sql).toContain('plan_revision = plan_revision + 1');
          return [];
        }
        if (sql.includes('UPDATE public.user_profiles')) {
          profileSavedHours = params?.[1];
          return [];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ version_no: 1 }];
        }
        throw new Error(`Unexpected SQL in rebuildDailyPlan test: ${sql}`);
      });

      const rebuilt = await service.rebuildDailyPlan(USER_ID, PLAN_ID, {
        hours_per_day: 3,
      });

      // Only ITEM_3 deleted & reinserted starting at maxFrozenDayNo (2) + 1 = Day 3
      expect(deletedIds).toEqual([ITEM_3]);
      expect(reinserted).toEqual([{ day_no: 3, lineage_id: LINEAGE_3 }]);
      expect(profileSavedHours).toBe(3);
      expect(rebuilt.hours_per_day).toBe(3);
      expect(rebuilt.completed_days).toBe(1);
      expect(rebuilt.days.map((d) => [d.day_no, d.status])).toEqual([
        [1, 'completed'],
        [2, 'pending'],
        [3, 'pending'],
      ]);
      // Verify zero mutations (UPDATE or DELETE) on roadmap_items
      expect(
        queryMock.mock.calls.some(([sql]) =>
          String(sql).includes('roadmap_items'),
        ),
      ).toBe(false);
    });

    it('rejects rebuild on archived roadmap with 409 ROADMAP_ARCHIVED', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('effective_feature_access'))
          return [{ allowed: true }];
        if (sql.includes('FROM public.daily_plans')) {
          return [
            {
              id: PLAN_ID,
              roadmap_id: ROADMAP_ID,
              hours_per_day: '2.0',
              status: 'active',
              roadmap_version_id: VERSION_ID,
              plan_revision: 1,
            },
          ];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'archived',
              is_focus: false,
              current_version_id: VERSION_ID,
            },
          ];
        }
        return [];
      });

      await expect(
        service.rebuildDailyPlan(USER_ID, PLAN_ID, { hours_per_day: 2 }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 409, 'ROADMAP_ARCHIVED');
        return true;
      });
    });
  });

  describe('markPlanItemCompletedInTx', () => {
    it('sets planDayUnlocked=true only when earliest incomplete day advances (false on same-day progress, final day completion, or retry)', async () => {
      const scenarios: Array<{
        before: number | null;
        after: number | null;
        expectedUnlocked: boolean;
      }> = [
        { before: 1, after: 2, expectedUnlocked: true },
        { before: 1, after: 1, expectedUnlocked: false },
        { before: 2, after: null, expectedUnlocked: false },
        { before: 2, after: 2, expectedUnlocked: false },
      ];

      for (const s of scenarios) {
        let selectCalls = 0;
        const txQuery = vi.fn(async (sql: string) => {
          if (sql.includes('SELECT day_no')) {
            selectCalls += 1;
            const val = selectCalls === 1 ? s.before : s.after;
            return val === null ? [] : [{ day_no: val }];
          }
          if (sql.includes('UPDATE public.daily_plan_items')) {
            return [[{ id: ITEM_1, day_no: 1 }], 1];
          }
          return [];
        });

        const res = await service.markPlanItemCompletedInTx(
          { query: txQuery } as unknown as TransactionalQueryExecutor,
          USER_ID,
          PLAN_ID,
          ITEM_1,
        );
        expect(res).toEqual({
          planDayUnlocked: s.expectedUnlocked,
          nextPlanDayNo: s.after,
        });
      }
    });
  });
});
