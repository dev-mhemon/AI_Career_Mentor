import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionalQueryExecutor } from '../profile/profile.service.js';
import {
  DailyPlanReconciler,
  type DailyPlanUndoSnapshot,
} from './services/daily-plan-reconciler.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const MERGE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_MERGE_ID = '33333333-3333-4333-8333-333333333399';
const RESULT_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const PREV_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const L = (n: number) => `aaaa000${n}-0000-4000-8000-00000000000${n}`;
const T = (n: number) => `bbbb000${n}-0000-4000-8000-00000000000${n}`;
const I = (n: number) => `cccc000${n}-0000-4000-8000-00000000000${n}`;

function expectContractError(error: unknown, status: number, code: string) {
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
  expect(
    ((error as HttpException).getResponse() as { code?: string }).code,
  ).toBe(code);
}

function item(
  n: number,
  day: number,
  status: 'pending' | 'in_progress' | 'completed',
  sort = 1,
  mergeId: string | null = null,
) {
  return {
    id: I(n),
    day_no: day,
    sort_order: sort,
    lineage_id: L(n),
    topic_id: T(n),
    allocated_hours: '1.0',
    status,
    reconciled_by_merge_id: mergeId,
  };
}

function makeTx(opts: {
  planStatus: 'active' | 'completed';
  items: ReturnType<typeof item>[];
  quizItemIds?: string[];
  startedQuizItemIds?: string[];
  remainingSummary?: { total_count: number; unfinished_count: number };
}) {
  const log: Array<{ sql: string; params?: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    log.push({ sql, params });
    if (sql.includes('DELETE FROM public.daily_plan_items')) return [];
    if (sql.includes('DELETE FROM public.quiz_attempts')) return [];
    if (sql.includes('UPDATE public.ai_requests')) return [];
    if (
      sql.includes('COUNT(*) FILTER') &&
      sql.includes('FROM public.daily_plan_items')
    ) {
      return opts.remainingSummary ? [opts.remainingSummary] : [];
    }
    if (sql.includes('FROM public.daily_plan_items')) return opts.items;
    if (sql.includes('FROM public.daily_plans')) {
      return [
        {
          id: PLAN_ID,
          hours_per_day: '2.0',
          status: opts.planStatus,
          roadmap_version_id: PREV_VERSION_ID,
          plan_revision: 3,
        },
      ];
    }
    if (sql.includes('FROM public.quiz_attempts')) {
      const ids = sql.includes("status <> 'generated'")
        ? (opts.startedQuizItemIds ?? opts.quizItemIds ?? [])
        : (opts.quizItemIds ?? []);
      return ids.map((id) => ({
        daily_plan_item_id: id,
      }));
    }
    return [];
  });
  return { tx: { query } as unknown as TransactionalQueryExecutor, log };
}

describe('DailyPlanReconciler', () => {
  it('freezes completed / in_progress / active-quiz days, DELETEs unfrozen rows BEFORE INSERT, and snapshots them', async () => {
    const { tx, log } = makeTx({
      planStatus: 'active',
      items: [
        item(1, 1, 'completed'),
        item(2, 2, 'in_progress'),
        item(3, 3, 'pending'), // active quiz attempt -> frozen
        item(4, 4, 'pending'),
        item(5, 5, 'pending'), // retired in new version
      ],
      quizItemIds: [I(3)],
    });

    const res = await new DailyPlanReconciler().reconcileForMergeInTx(tx, {
      userId: USER_ID,
      planId: PLAN_ID,
      mergeId: MERGE_ID,
      resultVersionId: RESULT_VERSION_ID,
      activeItems: [
        { lineage_id: L(1), topic_id: T(1), sequence_no: 1, effort_hours: 1 },
        { lineage_id: L(2), topic_id: T(2), sequence_no: 2, effort_hours: 1 },
        { lineage_id: L(3), topic_id: T(3), sequence_no: 3, effort_hours: 1 },
        { lineage_id: L(4), topic_id: T(4), sequence_no: 4, effort_hours: 1 },
        { lineage_id: L(6), topic_id: T(6), sequence_no: 5, effort_hours: 1 },
      ],
    });

    const deleteIdx = log.findIndex((c) =>
      c.sql.includes('DELETE FROM public.daily_plan_items'),
    );
    const insertIdxs = log
      .map((c, i) =>
        c.sql.includes('INSERT INTO public.daily_plan_items') ? i : -1,
      )
      .filter((i) => i >= 0);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(insertIdxs).toHaveLength(2);
    expect(Math.min(...insertIdxs)).toBeGreaterThan(deleteIdx);
    expect(log[deleteIdx].params?.[2]).toEqual([I(4), I(5)]);

    // New items start AFTER the highest frozen day (3) -> day 4, tagged with the merge id
    const inserts = insertIdxs.map((i) => log[i].params as unknown[]);
    expect(inserts.map((p) => p[2])).toEqual([4, 4]);
    expect(inserts.map((p) => p[4])).toEqual([L(4), L(6)]);
    expect(inserts.every((p) => p[7] === MERGE_ID)).toBe(true);

    expect(res.undoSnapshot).toMatchObject({
      plan_id: PLAN_ID,
      roadmap_version_id: PREV_VERSION_ID,
      status: 'active',
      plan_revision: 3,
      reconciled_plan_revision: 4,
    });
    expect(res.undoSnapshot.items.map((i) => i.lineage_id)).toEqual([
      L(4),
      L(5),
    ]);
    expect(res.dailyPlanImpact).toEqual({
      has_active_plan: true,
      completed_days_unchanged: 1,
      future_days_affected: 2,
    });
  });

  it('reopens a completed plan to active when new pending work is scheduled', async () => {
    const { tx, log } = makeTx({
      planStatus: 'completed',
      items: [item(1, 1, 'completed'), item(2, 2, 'completed')],
    });
    await new DailyPlanReconciler().reconcileForMergeInTx(tx, {
      userId: USER_ID,
      planId: PLAN_ID,
      mergeId: MERGE_ID,
      resultVersionId: RESULT_VERSION_ID,
      activeItems: [
        { lineage_id: L(1), topic_id: T(1), sequence_no: 1, effort_hours: 1 },
        { lineage_id: L(2), topic_id: T(2), sequence_no: 2, effort_hours: 1 },
        { lineage_id: L(9), topic_id: T(9), sequence_no: 3, effort_hours: 1 },
      ],
    });
    expect(
      log.some((c) => c.sql.includes('DELETE FROM public.daily_plan_items')),
    ).toBe(false);
    const insert = log.find((c) =>
      c.sql.includes('INSERT INTO public.daily_plan_items'),
    );
    expect(insert?.params?.[2]).toBe(3);
    expect(insert?.params?.[4]).toBe(L(9));
    const update = log.find((c) => c.sql.includes('UPDATE public.daily_plans'));
    expect(update?.params).toEqual([
      USER_ID,
      PLAN_ID,
      RESULT_VERSION_ID,
      'active',
    ]);
  });

  it('orders scheduled items by (phase_no ASC, sequence_no ASC) matching Daily Plan creation', async () => {
    const { tx, log } = makeTx({
      planStatus: 'active',
      items: [
        item(9, 1, 'completed'),
        item(8, 2, 'pending'), // earliest incomplete day (Today) -> frozen
        item(1, 3, 'pending'),
        item(2, 4, 'pending'),
      ],
    });
    await new DailyPlanReconciler().reconcileForMergeInTx(tx, {
      userId: USER_ID,
      planId: PLAN_ID,
      mergeId: MERGE_ID,
      resultVersionId: RESULT_VERSION_ID,
      activeItems: [
        {
          lineage_id: L(9),
          topic_id: T(9),
          phase_no: 1,
          sequence_no: 1,
          effort_hours: 1,
        },
        {
          lineage_id: L(8),
          topic_id: T(8),
          phase_no: 1,
          sequence_no: 2,
          effort_hours: 1,
        },
        {
          lineage_id: L(2),
          topic_id: T(2),
          phase_no: 2,
          sequence_no: 1,
          effort_hours: 2,
        },
        {
          lineage_id: L(1),
          topic_id: T(1),
          phase_no: 1,
          sequence_no: 5,
          effort_hours: 2,
        },
      ],
    });
    const inserts = log
      .filter((c) => c.sql.includes('INSERT INTO public.daily_plan_items'))
      .map((c) => c.params as unknown[]);
    expect(inserts.map((p) => p[4])).toEqual([L(1), L(2)]);
    expect(inserts.map((p) => p[2])).toEqual([3, 4]);
  });

  it('freezes the earliest incomplete day (Today) even when all its items are pending with no quiz started', async () => {
    const { tx, log } = makeTx({
      planStatus: 'active',
      items: [
        item(1, 1, 'completed'),
        item(2, 2, 'pending'), // earliest incomplete day -> frozen
        item(3, 3, 'pending'), // future mutable day
      ],
    });
    const res = await new DailyPlanReconciler().reconcileForMergeInTx(tx, {
      userId: USER_ID,
      planId: PLAN_ID,
      mergeId: MERGE_ID,
      resultVersionId: RESULT_VERSION_ID,
      activeItems: [
        { lineage_id: L(1), topic_id: T(1), sequence_no: 1, effort_hours: 1 },
        { lineage_id: L(2), topic_id: T(2), sequence_no: 2, effort_hours: 1 },
        { lineage_id: L(6), topic_id: T(6), sequence_no: 3, effort_hours: 1 },
      ],
    });
    const deleteCall = log.find((c) =>
      c.sql.includes('DELETE FROM public.daily_plan_items'),
    );
    expect(deleteCall?.params?.[2]).toEqual([I(3)]);
    const inserts = log
      .filter((c) => c.sql.includes('INSERT INTO public.daily_plan_items'))
      .map((c) => c.params as unknown[]);
    expect(inserts.map((p) => p[2])).toEqual([3]);
    expect(inserts.map((p) => p[4])).toEqual([L(6)]);
    expect(res.dailyPlanImpact).toEqual({
      has_active_plan: true,
      completed_days_unchanged: 1,
      future_days_affected: 1,
    });
  });

  it('marks daily_plans completed when only completed frozen items remain and no new pending work is scheduled', async () => {
    const { tx, log } = makeTx({
      planStatus: 'active',
      items: [item(1, 1, 'completed')],
    });
    await new DailyPlanReconciler().reconcileForMergeInTx(tx, {
      userId: USER_ID,
      planId: PLAN_ID,
      mergeId: MERGE_ID,
      resultVersionId: RESULT_VERSION_ID,
      activeItems: [
        {
          lineage_id: L(1),
          topic_id: T(1),
          phase_no: 1,
          sequence_no: 1,
          effort_hours: 1,
        },
      ],
    });
    const update = log.find((c) => c.sql.includes('UPDATE public.daily_plans'));
    expect(update?.params).toEqual([
      USER_ID,
      PLAN_ID,
      RESULT_VERSION_ID,
      'completed',
    ]);
  });

  describe('restoreFromUndoSnapshotInTx', () => {
    const snapshot: DailyPlanUndoSnapshot = {
      plan_id: PLAN_ID,
      roadmap_version_id: PREV_VERSION_ID,
      status: 'active',
      plan_revision: 3,
      items: [
        {
          lineage_id: L(4),
          topic_id: T(4),
          day_no: 4,
          sort_order: 1,
          allocated_hours: 1,
          reconciled_by_merge_id: null,
        },
      ],
    };

    it('deletes only the undone merge rows first, re-inserts the snapshot, and restores plan version/status', async () => {
      const { tx, log } = makeTx({
        planStatus: 'active',
        items: [
          item(7, 4, 'pending', 1, MERGE_ID),
          item(8, 5, 'pending', 1, OTHER_MERGE_ID),
        ],
      });
      await new DailyPlanReconciler().restoreFromUndoSnapshotInTx(tx, {
        userId: USER_ID,
        mergeId: MERGE_ID,
        snapshot,
      });
      const selectPostMerge = log.find(
        (c) =>
          c.sql.includes('FROM public.daily_plan_items') &&
          c.sql.includes('reconciled_by_merge_id = $3'),
      );
      expect(selectPostMerge?.params).toEqual([USER_ID, PLAN_ID, MERGE_ID]);
      const deleteIdx = log.findIndex((c) =>
        c.sql.includes('DELETE FROM public.daily_plan_items'),
      );
      const insertIdx = log.findIndex((c) =>
        c.sql.includes('INSERT INTO public.daily_plan_items'),
      );
      expect(deleteIdx).toBeGreaterThan(-1);
      expect(insertIdx).toBeGreaterThan(deleteIdx);
      expect(log[deleteIdx].params?.[2]).toEqual([I(7)]);
      expect(log[insertIdx].params?.[4]).toBe(L(4));
      const update = log.find((c) =>
        c.sql.includes('UPDATE public.daily_plans'),
      );
      expect(update?.params).toEqual([
        USER_ID,
        PLAN_ID,
        PREV_VERSION_ID,
        'active',
      ]);
    });

    it('fails 409 UNDO_NOT_AVAILABLE (no writes) when a post-merge item has a started quiz attempt', async () => {
      const { tx, log } = makeTx({
        planStatus: 'active',
        items: [item(7, 4, 'pending', 1, MERGE_ID)],
        startedQuizItemIds: [I(7)],
      });
      await expect(
        new DailyPlanReconciler().restoreFromUndoSnapshotInTx(tx, {
          userId: USER_ID,
          mergeId: MERGE_ID,
          snapshot,
        }),
      ).rejects.toSatisfy((e: unknown) => {
        expectContractError(e, 409, 'UNDO_NOT_AVAILABLE');
        return true;
      });
      expect(
        log.some(
          (c) =>
            c.sql.includes('DELETE FROM') ||
            c.sql.includes('INSERT INTO') ||
            c.sql.includes('UPDATE public'),
        ),
      ).toBe(false);
    });

    it('allows Undo when only an unstarted generated quiz exists (clearing unstarted quiz/job) and preserves completed status when frozen items finished post-merge', async () => {
      const { tx, log } = makeTx({
        planStatus: 'active',
        items: [item(7, 4, 'pending', 1, MERGE_ID)],
        quizItemIds: [I(7)],
        startedQuizItemIds: [], // unstarted 'generated' quiz must NOT block Undo
        remainingSummary: { total_count: 2, unfinished_count: 0 },
      });
      await new DailyPlanReconciler().restoreFromUndoSnapshotInTx(tx, {
        userId: USER_ID,
        mergeId: MERGE_ID,
        snapshot: {
          ...snapshot,
          status: 'active',
          items: [], // frozen day finished after merge -> remaining plan items all completed
        },
      });
      const cancelJobIdx = log.findIndex((c) =>
        c.sql.includes('UPDATE public.ai_requests'),
      );
      const deleteGenQuizIdx = log.findIndex((c) =>
        c.sql.includes('DELETE FROM public.quiz_attempts'),
      );
      const deleteItemIdx = log.findIndex((c) =>
        c.sql.includes('DELETE FROM public.daily_plan_items'),
      );
      expect(cancelJobIdx).toBeGreaterThan(-1);
      expect(deleteGenQuizIdx).toBeGreaterThan(cancelJobIdx);
      expect(deleteItemIdx).toBeGreaterThan(deleteGenQuizIdx);
      expect(log[deleteGenQuizIdx].sql).toContain(
        "status = 'generated'::public.attempt_status",
      );
      const update = log.find((c) =>
        c.sql.includes('UPDATE public.daily_plans'),
      );
      expect(update?.params).toEqual([
        USER_ID,
        PLAN_ID,
        PREV_VERSION_ID,
        'completed',
      ]);
    });
  });
});
