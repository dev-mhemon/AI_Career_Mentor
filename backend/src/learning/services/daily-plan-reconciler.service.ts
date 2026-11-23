import { Injectable } from '@nestjs/common';
import { fail } from '../../common/http.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import { packItemsIntoDays } from './daily-plan.service.js';

const DEFAULT_ITEM_EFFORT_HOURS = 1.0;

export interface ReconcilerActiveItem {
  lineage_id: string;
  topic_id: string;
  phase_no?: number;
  sequence_no: number;
  effort_hours: number | null;
}

export interface ReconcileForMergeParams {
  userId: string;
  planId: string;
  mergeId: string;
  resultVersionId: string;
  /** Active (non-retired) items of the NEW roadmap version in sequence order. */
  activeItems: readonly ReconcilerActiveItem[];
}

export interface DailyPlanImpactSummary {
  has_active_plan: boolean;
  completed_days_unchanged: number;
  future_days_affected: number;
}

export interface DailyPlanUndoSnapshot {
  plan_id: string;
  roadmap_version_id: string | null;
  status: 'active' | 'completed';
  plan_revision: number;
  reconciled_plan_revision?: number;
  items: Array<{
    lineage_id: string;
    topic_id: string;
    day_no: number;
    sort_order: number;
    allocated_hours: number | null;
    reconciled_by_merge_id: string | null;
  }>;
}

export interface ReconcileForMergeResult {
  undoSnapshot: DailyPlanUndoSnapshot;
  dailyPlanImpact: DailyPlanImpactSummary;
}

export interface RestoreFromUndoSnapshotParams {
  userId: string;
  mergeId: string;
  snapshot: DailyPlanUndoSnapshot;
}

interface PlanRow {
  id: string;
  hours_per_day: number | string;
  status: 'active' | 'completed';
  roadmap_version_id: string | null;
  plan_revision: number | string;
}

interface PlanItemRow {
  id: string;
  day_no: number | string;
  sort_order: number | string;
  lineage_id: string;
  topic_id: string;
  allocated_hours: number | string | null;
  status: 'pending' | 'in_progress' | 'completed';
  reconciled_by_merge_id: string | null;
}

function rows<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

/**
 * Reconciles ONLY future incomplete Daily Plan days against a merged roadmap version (`PRD` §21)
 * and restores them on one-step Undo. Callers MUST already hold `daily_plans FOR UPDATE`
 * (lock order: `daily_plans -> roadmaps -> roadmap_merges -> daily_plan_items`).
 * Never mutates `roadmap_items`, completed days, in-progress days, or days with an unsubmitted quiz.
 */
@Injectable()
export class DailyPlanReconciler {
  private async loadFrozenItemIdsInTx(
    tx: TransactionalQueryExecutor,
    userId: string,
    itemIds: readonly string[],
  ): Promise<Set<string>> {
    const frozen = new Set<string>();
    if (itemIds.length === 0) {
      return frozen;
    }
    const attempts = rows<{ daily_plan_item_id: string }>(
      await tx.query(
        `SELECT DISTINCT daily_plan_item_id
           FROM public.quiz_attempts
          WHERE user_id = $1
            AND daily_plan_item_id = ANY($2::uuid[])
            AND status IN ('generated'::public.attempt_status, 'started'::public.attempt_status)`,
        [userId, itemIds],
      ),
    );
    for (const row of attempts) {
      if (row.daily_plan_item_id) {
        frozen.add(String(row.daily_plan_item_id));
      }
    }
    const jobs = rows<{ subject_id: string | null }>(
      await tx.query(
        `SELECT DISTINCT subject_id
           FROM public.ai_requests
          WHERE user_id = $1
            AND is_async = true
            AND job_kind = 'quiz_generate'::public.job_kind
            AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            AND subject_id = ANY($2::uuid[])`,
        [userId, itemIds],
      ),
    );
    for (const row of jobs) {
      if (row.subject_id) {
        frozen.add(String(row.subject_id));
      }
    }
    return frozen;
  }

  private async insertItemInTx(
    tx: TransactionalQueryExecutor,
    userId: string,
    planId: string,
    item: {
      day_no: number;
      sort_order: number;
      lineage_id: string;
      topic_id: string;
      allocated_hours: number | null;
      reconciled_by_merge_id: string | null;
    },
  ): Promise<void> {
    await tx.query(
      `INSERT INTO public.daily_plan_items (
         plan_id, user_id, day_no, sort_order, lineage_id, topic_id,
         allocated_hours, status, reconciled_by_merge_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending'::public.plan_item_status, $8)`,
      [
        planId,
        userId,
        item.day_no,
        item.sort_order,
        item.lineage_id,
        item.topic_id,
        item.allocated_hours,
        item.reconciled_by_merge_id,
      ],
    );
  }

  /**
   * Re-sequences future unfrozen days for `resultVersionId`. DELETEs unfrozen pending rows BEFORE
   * inserting, so `uq_daily_plan_items_lineage` / `uq_daily_plan_items_slot` never collide.
   */
  async reconcileForMergeInTx(
    tx: TransactionalQueryExecutor,
    params: ReconcileForMergeParams,
  ): Promise<ReconcileForMergeResult> {
    const { userId, planId, mergeId, resultVersionId } = params;

    const plan = rows<PlanRow>(
      await tx.query(
        `SELECT id, hours_per_day, status::text AS status, roadmap_version_id, plan_revision
           FROM public.daily_plans
          WHERE user_id = $1 AND id = $2`,
        [userId, planId],
      ),
    )[0];
    if (!plan) {
      fail(404, 'DAILY_PLAN_NOT_FOUND', 'Daily Plan not found');
    }

    const items = rows<PlanItemRow>(
      await tx.query(
        `SELECT id, day_no, sort_order, lineage_id, topic_id, allocated_hours,
                status::text AS status, reconciled_by_merge_id
           FROM public.daily_plan_items
          WHERE user_id = $1 AND plan_id = $2
          ORDER BY day_no ASC, sort_order ASC
            FOR UPDATE`,
        [userId, planId],
      ),
    );

    const quizFrozenIds = await this.loadFrozenItemIdsInTx(
      tx,
      userId,
      items.map((i) => String(i.id)),
    );

    const frozenDays = new Set<number>();
    const completedDayCandidates = new Map<number, boolean>();
    for (const item of items) {
      const dayNo = Number(item.day_no);
      const done = item.status === 'completed';
      completedDayCandidates.set(
        dayNo,
        (completedDayCandidates.get(dayNo) ?? true) && done,
      );
      if (
        done ||
        item.status === 'in_progress' ||
        quizFrozenIds.has(String(item.id))
      ) {
        frozenDays.add(dayNo);
      }
    }
    let completedDaysUnchanged = 0;
    for (const isDone of completedDayCandidates.values()) {
      if (isDone) completedDaysUnchanged += 1;
    }
    const maxFrozenDay = frozenDays.size > 0 ? Math.max(...frozenDays) : 0;

    const frozenItems = items.filter((i) => frozenDays.has(Number(i.day_no)));
    const mutableItems = items.filter((i) => !frozenDays.has(Number(i.day_no)));
    const frozenLineages = new Set(
      frozenItems.map((i) => String(i.lineage_id).toLowerCase()),
    );

    const previousPlanRevision = Number(plan.plan_revision);
    const undoSnapshot: DailyPlanUndoSnapshot = {
      plan_id: String(plan.id),
      roadmap_version_id: plan.roadmap_version_id
        ? String(plan.roadmap_version_id)
        : null,
      status: plan.status,
      plan_revision: previousPlanRevision,
      reconciled_plan_revision: previousPlanRevision + 1,
      items: mutableItems.map((i) => ({
        lineage_id: String(i.lineage_id).toLowerCase(),
        topic_id: String(i.topic_id).toLowerCase(),
        day_no: Number(i.day_no),
        sort_order: Number(i.sort_order),
        allocated_hours:
          i.allocated_hours === null || i.allocated_hours === undefined
            ? null
            : Number(i.allocated_hours),
        reconciled_by_merge_id: i.reconciled_by_merge_id
          ? String(i.reconciled_by_merge_id)
          : null,
      })),
    };

    // DELETE first (lineage/slot uniqueness), then re-insert.
    if (mutableItems.length > 0) {
      await tx.query(
        `DELETE FROM public.daily_plan_items
          WHERE user_id = $1
            AND plan_id = $2
            AND id = ANY($3::uuid[])
            AND status = 'pending'::public.plan_item_status`,
        [userId, planId, mutableItems.map((i) => String(i.id))],
      );
    }

    const schedulable = [...params.activeItems]
      .filter((i) => !frozenLineages.has(String(i.lineage_id).toLowerCase()))
      .sort(
        (a, b) =>
          (a.phase_no ?? 1) - (b.phase_no ?? 1) ||
          a.sequence_no - b.sequence_no,
      )
      .map((i) => ({
        lineage_id: String(i.lineage_id).toLowerCase(),
        topic_id: String(i.topic_id).toLowerCase(),
        title: '',
        effort_hours:
          i.effort_hours !== null && i.effort_hours > 0
            ? i.effort_hours
            : DEFAULT_ITEM_EFFORT_HOURS,
      }));
    const scheduled = packItemsIntoDays(
      schedulable,
      Number(plan.hours_per_day),
      maxFrozenDay + 1,
    );
    for (const item of scheduled) {
      await this.insertItemInTx(tx, userId, planId, {
        day_no: item.day_no,
        sort_order: item.sort_order,
        lineage_id: item.lineage_id,
        topic_id: item.topic_id,
        allocated_hours: item.allocated_hours,
        reconciled_by_merge_id: mergeId,
      });
    }

    // Derive plan status from remaining rows (frozen + newly scheduled).
    const hasUnfinishedFrozen = frozenItems.some(
      (i) => i.status !== 'completed',
    );
    const nextStatus: 'active' | 'completed' =
      hasUnfinishedFrozen || scheduled.length > 0
        ? 'active'
        : frozenItems.length > 0
          ? 'completed'
          : plan.status;
    await tx.query(
      `UPDATE public.daily_plans
          SET roadmap_version_id = $3,
              status = $4::public.plan_status,
              plan_revision = plan_revision + 1
        WHERE user_id = $1 AND id = $2`,
      [userId, planId, resultVersionId, nextStatus],
    );

    const newDays = new Set(scheduled.map((s) => s.day_no));
    const oldDays = new Set(mutableItems.map((i) => Number(i.day_no)));
    return {
      undoSnapshot,
      dailyPlanImpact: {
        has_active_plan: true,
        completed_days_unchanged: completedDaysUnchanged,
        future_days_affected: Math.max(newDays.size, oldDays.size),
      },
    };
  }

  /**
   * Restores the pre-merge future plan. Fails `409 UNDO_NOT_AVAILABLE` when any post-merge item
   * (`reconciled_by_merge_id = mergeId`) has progressed or has a started quiz attempt
   * (`status <> 'generated'`, matching `trg_quiz_attempts_close_undo`). Unstarted `generated`
   * quiz attempts and queued/preparing `quiz_generate` jobs on removed items are cleanly cleared
   * in the same transaction.
   */
  async restoreFromUndoSnapshotInTx(
    tx: TransactionalQueryExecutor,
    params: RestoreFromUndoSnapshotParams,
  ): Promise<void> {
    const { userId, mergeId, snapshot } = params;
    const planId = snapshot.plan_id;

    const normalizedMergeId = mergeId.toLowerCase();
    const postMerge = rows<PlanItemRow>(
      await tx.query(
        `SELECT id, day_no, sort_order, lineage_id, topic_id, allocated_hours,
                status::text AS status, reconciled_by_merge_id
           FROM public.daily_plan_items
          WHERE user_id = $1
            AND plan_id = $2
            AND reconciled_by_merge_id = $3
            FOR UPDATE`,
        [userId, planId, mergeId],
      ),
    ).filter(
      (i) =>
        String(i.reconciled_by_merge_id ?? '').toLowerCase() ===
        normalizedMergeId,
    );
    const ids = postMerge.map((i) => String(i.id));
    const startedAttemptRows = ids.length
      ? rows<{ daily_plan_item_id: string }>(
          await tx.query(
            `SELECT DISTINCT daily_plan_item_id
               FROM public.quiz_attempts
              WHERE user_id = $1
                AND daily_plan_item_id = ANY($2::uuid[])
                AND status <> 'generated'::public.attempt_status`,
            [userId, ids],
          ),
        )
      : [];
    if (
      postMerge.some((i) => i.status !== 'pending') ||
      startedAttemptRows.length > 0
    ) {
      fail(
        409,
        'UNDO_NOT_AVAILABLE',
        'Post-merge learning has started; use a new merge proposal instead',
      );
    }

    if (ids.length > 0) {
      await tx.query(
        `UPDATE public.ai_requests
            SET status = 'failed'::public.job_status,
                error_code = 'STALE_JOB_INPUT',
                error_message = 'Daily plan item removed by merge undo',
                retryable = false
          WHERE user_id = $1
            AND is_async = true
            AND job_kind = 'quiz_generate'::public.job_kind
            AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            AND subject_id = ANY($2::uuid[])`,
        [userId, ids],
      );
      await tx.query(
        `DELETE FROM public.quiz_attempts
          WHERE user_id = $1
            AND daily_plan_item_id = ANY($2::uuid[])
            AND status = 'generated'::public.attempt_status`,
        [userId, ids],
      );
      await tx.query(
        `DELETE FROM public.daily_plan_items
          WHERE user_id = $1
            AND plan_id = $2
            AND id = ANY($3::uuid[])`,
        [userId, planId, ids],
      );
    }
    for (const item of snapshot.items) {
      await this.insertItemInTx(tx, userId, planId, item);
    }

    let nextStatus: 'active' | 'completed';
    if (snapshot.items.length > 0) {
      nextStatus = 'active';
    } else {
      const remainingRows = rows<{
        unfinished_count?: number | string;
        total_count?: number | string;
        status?: string;
      }>(
        await tx.query(
          `SELECT COUNT(*) FILTER (WHERE status <> 'completed'::public.plan_item_status)::int AS unfinished_count,
                  COUNT(*)::int AS total_count
             FROM public.daily_plan_items
            WHERE user_id = $1
              AND plan_id = $2`,
          [userId, planId],
        ),
      );
      const summary = remainingRows[0];
      if (
        summary &&
        summary.total_count !== undefined &&
        summary.unfinished_count !== undefined
      ) {
        const total = Number(summary.total_count);
        const unfinished = Number(summary.unfinished_count);
        nextStatus = total > 0 && unfinished === 0 ? 'completed' : 'active';
      } else if (
        remainingRows.length > 0 &&
        remainingRows.every((r) => typeof r.status === 'string')
      ) {
        nextStatus = remainingRows.every((r) => r.status === 'completed')
          ? 'completed'
          : 'active';
      } else {
        nextStatus = snapshot.status;
      }
    }

    await tx.query(
      `UPDATE public.daily_plans
          SET roadmap_version_id = $3,
              status = $4::public.plan_status,
              plan_revision = plan_revision + 1
        WHERE user_id = $1 AND id = $2`,
      [userId, planId, snapshot.roadmap_version_id, nextStatus],
    );
  }
}
