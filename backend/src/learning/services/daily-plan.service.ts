import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import type {
  PageMetaDTO,
  RoadmapStatus,
} from '../../roadmap/dto/roadmap.dto.js';
import {
  assertValidLearningHours,
  PG_INT4_MAX,
  type CreateDailyPlanDTO,
  type DailyPlanResponseDTO,
  type GetDailyPlanQueryDTO,
  type PaginatedDailyPlanResult,
  type PlanDayDTO,
  type PlanDayStatus,
  type PlanItemStatus,
  type RebuildDailyPlanDTO,
} from '../dto/learning.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_ITEM_EFFORT_HOURS = 1.0;

interface RoadmapForPlanRow {
  id: string;
  status: RoadmapStatus;
  is_focus: boolean;
  current_version_id: string | null;
}

interface DailyPlanRow {
  id: string;
  roadmap_id: string;
  hours_per_day: number | string;
  status: 'active' | 'completed';
  roadmap_version_id: string | null;
  plan_revision: number | string;
  roadmap_version_no?: number | string | null;
  is_focus?: boolean;
}

interface RoadmapItemForScheduleRow {
  id: string;
  lineage_id: string;
  topic_id: string;
  title: string;
  phase_no: number | string;
  sequence_no: number | string;
  estimated_effort_hours: number | string | null;
}

interface PlanItemRow {
  id: string;
  plan_id?: string;
  day_no: number | string;
  sort_order: number | string;
  lineage_id: string;
  topic_id: string;
  title: string;
  allocated_hours: number | string | null;
  status: PlanItemStatus;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  reconciled_by_merge_id: string | null;
}

export interface SchedulablePlanItem {
  lineage_id: string;
  topic_id: string;
  title: string;
  effort_hours: number;
  reconciled_by_merge_id?: string | null;
}

export interface ScheduledPlanItem extends SchedulablePlanItem {
  day_no: number;
  sort_order: number;
  allocated_hours: number;
}

function toNullableIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function extractReturningRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  if (
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    (typeof raw[1] === 'number' || raw[1] === null || raw[1] === undefined)
  ) {
    return raw[0] as T[];
  }
  return raw as T[];
}

function unwrapPgError(error: unknown): {
  code?: string;
  constraint?: string;
} {
  if (!error || typeof error !== 'object') {
    return {};
  }
  const err = error as {
    code?: unknown;
    constraint?: unknown;
    driverError?: { code?: unknown; constraint?: unknown };
  };
  return {
    code:
      typeof err.driverError?.code === 'string'
        ? err.driverError.code
        : typeof err.code === 'string'
          ? err.code
          : undefined,
    constraint:
      typeof err.driverError?.constraint === 'string'
        ? err.driverError.constraint
        : typeof err.constraint === 'string'
          ? err.constraint
          : undefined,
  };
}

function normalizePositiveEffortHours(
  raw: number | string | null | undefined,
): number {
  const parsed = raw === null || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ITEM_EFFORT_HOURS;
  }
  const clamped = Math.min(999.9, Math.max(0.1, parsed));
  return Math.round(clamped * 10) / 10;
}

/**
 * Deterministic greedy sequential day packer (`PRD` §27).
 *
 * Each roadmap item (`lineage_id`) occupies exactly one `daily_plan_items` slot
 * (`uq_daily_plan_items_lineage`), grouped greedily into sequential days `startDayNo..N`
 * without exceeding `hoursPerDay` once at least one item is placed on the current day.
 */
export function packItemsIntoDays(
  items: readonly SchedulablePlanItem[],
  hoursPerDay: number,
  startDayNo = 1,
): ScheduledPlanItem[] {
  const scheduled: ScheduledPlanItem[] = [];
  let currentDay = Math.max(1, Math.trunc(startDayNo));
  let usedHours = 0;
  let sortOrder = 0;

  for (const item of items) {
    const effort = normalizePositiveEffortHours(item.effort_hours);
    if (sortOrder > 0 && usedHours + effort > hoursPerDay + 1e-9) {
      currentDay += 1;
      usedHours = 0;
      sortOrder = 0;
    }
    sortOrder += 1;
    scheduled.push({
      ...item,
      day_no: currentDay,
      sort_order: sortOrder,
      allocated_hours: effort,
    });
    usedHours = Math.round((usedHours + effort) * 10) / 10;
  }

  return scheduled;
}

function encodeDayCursor(dayNo: number): string {
  return Buffer.from(JSON.stringify({ day_no: dayNo }), 'utf8').toString(
    'base64url',
  );
}

function decodeDayCursor(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor must be a valid pagination token',
      },
    ]);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor must be a valid pagination token',
      },
    ]);
  }
  const dayNo = (parsed as { day_no?: unknown }).day_no;
  if (
    typeof dayNo !== 'number' ||
    !Number.isSafeInteger(dayNo) ||
    dayNo < 1 ||
    dayNo > PG_INT4_MAX
  ) {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor day_no must be a valid positive integer',
      },
    ]);
  }
  return dayNo;
}

function resolveDayStatus(items: readonly PlanItemRow[]): {
  status: PlanDayStatus;
  completedAt: string | null;
} {
  let completedCount = 0;
  let hasInProgress = false;
  let latestCompletedAt: string | null = null;

  for (const item of items) {
    if (item.status === 'completed') {
      completedCount += 1;
      const iso = toNullableIso(item.completed_at);
      if (iso && (!latestCompletedAt || iso > latestCompletedAt)) {
        latestCompletedAt = iso;
      }
    } else if (item.status === 'in_progress') {
      hasInProgress = true;
    }
  }

  if (items.length > 0 && completedCount === items.length) {
    return { status: 'completed', completedAt: latestCompletedAt };
  }
  if (hasInProgress || completedCount > 0) {
    return { status: 'in_progress', completedAt: null };
  }
  return { status: 'pending', completedAt: null };
}

function buildDailyPlanDays(items: readonly PlanItemRow[]): {
  days: PlanDayDTO[];
  totalDays: number;
  completedDays: number;
  nextIncompleteDayNo: number | null;
} {
  const byDay = new Map<number, PlanItemRow[]>();
  for (const item of items) {
    const dayNo = Number(item.day_no);
    const list = byDay.get(dayNo);
    if (list) {
      list.push(item);
    } else {
      byDay.set(dayNo, [item]);
    }
  }

  const sortedDayNos = Array.from(byDay.keys()).sort((a, b) => a - b);
  const days: PlanDayDTO[] = [];
  let completedDays = 0;
  let nextIncompleteDayNo: number | null = null;

  for (const dayNo of sortedDayNos) {
    const dayItems = byDay.get(dayNo) ?? [];
    dayItems.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const { status, completedAt } = resolveDayStatus(dayItems);
    if (status === 'completed') {
      completedDays += 1;
    } else if (nextIncompleteDayNo === null) {
      nextIncompleteDayNo = dayNo;
    }
    days.push({
      day_no: dayNo,
      status,
      topics: dayItems.map((entry) => ({
        plan_item_id: String(entry.id),
        topic_id: String(entry.topic_id),
        title: String(entry.title),
      })),
      completed_at: completedAt,
    });
  }

  return {
    days,
    totalDays: sortedDayNos.length,
    completedDays,
    nextIncompleteDayNo,
  };
}

/**
 * Service implementing `C05` §14.6 Daily Plan lifecycle (`EP-L01`, `EP-L02`, `EP-L03`).
 *
 * Guarantees (`PRD` §14, §16, §27):
 * - Deterministic sequential scheduling with zero AI calls.
 * - One Daily Plan per locked roadmap (`uq_daily_plans_roadmap`).
 * - Confirmed `hours_per_day` (`0.5..12` step `0.5`) saved back to `user_profiles.preferred_daily_hours`.
 * - Rebuilding never mutates `roadmap_items`, completed days, or days with an active/in-progress quiz.
 */
@Injectable()
export class DailyPlanService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private assertUuid(value: unknown, field: string, label: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
      fail(400, 'INVALID_FORMAT', `${label} must be a valid UUID`, [
        {
          field,
          code: 'INVALID_FORMAT',
          message: `${field} must be a valid UUID`,
        },
      ]);
    }
    return value.trim().toLowerCase();
  }

  private normalizeLimit(raw?: number): number {
    if (raw === undefined) {
      return DEFAULT_PAGE_LIMIT;
    }
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > MAX_PAGE_LIMIT
    ) {
      fail(422, 'VALIDATION_FAILED', 'limit must be between 1 and 100', [
        {
          field: 'limit',
          code: 'VALIDATION_FAILED',
          message: 'limit must be an integer between 1 and 100',
        },
      ]);
    }
    return raw;
  }

  private async assertDailyPlanFeatureEnabledInTx(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const rows = await db.query<Array<{ allowed: boolean }>>(
      `SELECT private.effective_feature_access($1, 'daily_plan'::public.feature_key) AS allowed`,
      [userId],
    );
    const allowed = Array.isArray(rows) ? rows[0]?.allowed : false;
    if (allowed !== true) {
      fail(
        403,
        'FEATURE_DISABLED',
        'Daily plan generation is currently disabled. Existing plans and topics remain accessible.',
      );
    }
  }

  private async loadPlanItemsInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    planId: string,
    forUpdate = false,
  ): Promise<PlanItemRow[]> {
    const lockClause = forUpdate ? '\n        FOR UPDATE OF dpi' : '';
    const rows = await db.query<PlanItemRow[]>(
      `SELECT dpi.id,
              dpi.plan_id,
              dpi.day_no,
              dpi.sort_order,
              dpi.lineage_id,
              dpi.topic_id,
              t.title,
              dpi.allocated_hours,
              dpi.status::text AS status,
              dpi.started_at,
              dpi.completed_at,
              dpi.reconciled_by_merge_id
         FROM public.daily_plan_items dpi
         JOIN public.topics t ON t.id = dpi.topic_id
        WHERE dpi.plan_id = $1
          AND dpi.user_id = $2
        ORDER BY dpi.day_no ASC, dpi.sort_order ASC${lockClause}`,
      [planId, userId],
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async resolveVersionNoInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    versionId: string | null,
  ): Promise<number> {
    if (!versionId) {
      return 1;
    }
    const rows = await db.query<Array<{ version_no: number | string }>>(
      `SELECT version_no
         FROM public.roadmap_versions
        WHERE id = $1
          AND user_id = $2
        LIMIT 1`,
      [versionId, userId],
    );
    const versionNo = Array.isArray(rows) ? Number(rows[0]?.version_no) : NaN;
    return Number.isInteger(versionNo) && versionNo >= 1 ? versionNo : 1;
  }

  /**
   * `EP-L01` (`GET /api/v1/learning/daily-plan`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getDailyPlan(
    userId: string,
    query?: GetDailyPlanQueryDTO,
  ): Promise<PaginatedDailyPlanResult> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const explicitRoadmapId =
      query?.roadmap_id !== undefined
        ? this.assertUuid(query.roadmap_id, 'roadmap_id', 'Roadmap id')
        : undefined;
    const limit = this.normalizeLimit(query?.limit);
    const cursorDayNo =
      query?.cursor !== undefined ? decodeDayCursor(query.cursor) : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        let roadmap: RoadmapForPlanRow | undefined;
        if (explicitRoadmapId) {
          const rows = await db.query<RoadmapForPlanRow[]>(
            `SELECT id, status::text AS status, is_focus, current_version_id
               FROM public.roadmaps
              WHERE user_id = $1
                AND id = $2
              LIMIT 1`,
            [normalizedUserId, explicitRoadmapId],
          );
          roadmap = Array.isArray(rows) ? rows[0] : undefined;
          if (!roadmap) {
            fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
          }
        } else {
          const rows = await db.query<RoadmapForPlanRow[]>(
            `SELECT id, status::text AS status, is_focus, current_version_id
               FROM public.roadmaps
              WHERE user_id = $1
                AND status = 'locked'::public.roadmap_status
                AND is_focus = true
              LIMIT 1`,
            [normalizedUserId],
          );
          roadmap = Array.isArray(rows) ? rows[0] : undefined;
          if (!roadmap) {
            fail(
              404,
              'NO_FOCUS_ROADMAP',
              'No Focus Roadmap is currently selected',
            );
          }
        }

        const planRows = await db.query<DailyPlanRow[]>(
          `SELECT id,
                  roadmap_id,
                  hours_per_day,
                  status::text AS status,
                  roadmap_version_id,
                  plan_revision
             FROM public.daily_plans
            WHERE user_id = $1
              AND roadmap_id = $2
            LIMIT 1`,
          [normalizedUserId, roadmap.id],
        );
        const planRow = Array.isArray(planRows) ? planRows[0] : undefined;
        if (!planRow) {
          fail(
            404,
            'DAILY_PLAN_NOT_FOUND',
            'No Daily Plan exists for this roadmap',
          );
        }

        const [versionNo, items] = await Promise.all([
          this.resolveVersionNoInTx(
            db,
            normalizedUserId,
            planRow.roadmap_version_id ?? roadmap.current_version_id,
          ),
          this.loadPlanItemsInTx(db, normalizedUserId, planRow.id),
        ]);

        const built = buildDailyPlanDays(items);
        const filteredDays =
          cursorDayNo !== null
            ? built.days.filter((d) => d.day_no > cursorDayNo)
            : built.days;
        const hasMore = filteredDays.length > limit;
        const pageDays = hasMore ? filteredDays.slice(0, limit) : filteredDays;
        const lastDay = pageDays[pageDays.length - 1];

        const meta: PageMetaDTO = {
          limit,
          next_cursor:
            hasMore && lastDay ? encodeDayCursor(lastDay.day_no) : null,
        };

        return {
          plan: {
            plan_id: String(planRow.id),
            roadmap_id: String(planRow.roadmap_id),
            is_focus: Boolean(roadmap.is_focus),
            hours_per_day: Number(planRow.hours_per_day),
            roadmap_version_no: versionNo,
            next_incomplete_day_no: built.nextIncompleteDayNo,
            total_days: built.totalDays,
            completed_days: built.completedDays,
            days: pageDays,
          },
          meta,
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-L02` (`POST /api/v1/learning/daily-plans`, `201 Created`, `H-IDEM`, `Gate: write (daily_plan)`, `R24 foreground = true`).
   */
  async createDailyPlan(
    userId: string,
    dto: CreateDailyPlanDTO,
  ): Promise<DailyPlanResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const roadmapId = this.assertUuid(
      dto?.roadmap_id,
      'roadmap_id',
      'Roadmap id',
    );
    const hoursPerDay = assertValidLearningHours(dto?.hours_per_day);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertDailyPlanFeatureEnabledInTx(db, normalizedUserId);

        const roadmapRows = await db.query<RoadmapForPlanRow[]>(
          `SELECT id, status::text AS status, is_focus, current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, roadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }
        if (roadmap.status === 'archived') {
          fail(
            409,
            'ROADMAP_ARCHIVED',
            'Cannot create a Daily Plan for an archived roadmap',
          );
        }
        if (roadmap.status !== 'locked' || !roadmap.current_version_id) {
          fail(
            409,
            'ROADMAP_NOT_LOCKED',
            'Roadmap must be locked before creating a Daily Plan',
          );
        }

        const existingPlanRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.daily_plans
            WHERE user_id = $1
              AND roadmap_id = $2
            LIMIT 1`,
          [normalizedUserId, roadmapId],
        );
        if (Array.isArray(existingPlanRows) && existingPlanRows.length > 0) {
          fail(
            409,
            'DAILY_PLAN_EXISTS',
            'A Daily Plan already exists for this roadmap',
          );
        }

        const versionNo = await this.resolveVersionNoInTx(
          db,
          normalizedUserId,
          roadmap.current_version_id,
        );

        const roadmapItemsRaw = await db.query<RoadmapItemForScheduleRow[]>(
          `SELECT ri.id,
                  ri.lineage_id,
                  ri.topic_id,
                  COALESCE(t.title, ri.title) AS title,
                  ri.phase_no,
                  ri.sequence_no,
                  ri.estimated_effort_hours
             FROM public.roadmap_items ri
             JOIN public.topics t ON t.id = ri.topic_id
            WHERE ri.user_id = $1
              AND ri.version_id = $2
              AND ri.retired = false
            ORDER BY ri.phase_no ASC, ri.sequence_no ASC, ri.id ASC`,
          [normalizedUserId, roadmap.current_version_id],
        );
        const roadmapItems = Array.isArray(roadmapItemsRaw)
          ? roadmapItemsRaw
          : [];
        if (roadmapItems.length === 0) {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Locked roadmap has no active topics to schedule',
          );
        }

        const scheduled = packItemsIntoDays(
          roadmapItems.map((item) => ({
            lineage_id: String(item.lineage_id),
            topic_id: String(item.topic_id),
            title: String(item.title),
            effort_hours: normalizePositiveEffortHours(
              item.estimated_effort_hours,
            ),
          })),
          hoursPerDay,
          1,
        );

        let insertedPlan: DailyPlanRow | undefined;
        try {
          const insertedRaw = await db.query<unknown>(
            `INSERT INTO public.daily_plans (
               user_id,
               roadmap_id,
               hours_per_day,
               status,
               roadmap_version_id,
               plan_revision
             )
             VALUES ($1, $2, $3, 'active'::public.plan_status, $4, 1)
             RETURNING id, roadmap_id, hours_per_day, status::text AS status, roadmap_version_id, plan_revision`,
            [
              normalizedUserId,
              roadmapId,
              hoursPerDay,
              roadmap.current_version_id,
            ],
          );
          insertedPlan = extractReturningRows<DailyPlanRow>(insertedRaw)[0];
        } catch (error) {
          const pg = unwrapPgError(error);
          if (
            pg.code === '23505' &&
            (!pg.constraint || pg.constraint === 'uq_daily_plans_roadmap')
          ) {
            fail(
              409,
              'DAILY_PLAN_EXISTS',
              'A Daily Plan already exists for this roadmap',
            );
          }
          throw error;
        }

        if (!insertedPlan?.id) {
          fail(500, 'DATABASE_ERROR', 'Failed to persist Daily Plan');
        }

        const insertedItems: PlanItemRow[] = [];
        for (const item of scheduled) {
          const rawItem = await db.query<unknown>(
            `INSERT INTO public.daily_plan_items (
               plan_id,
               user_id,
               day_no,
               sort_order,
               lineage_id,
               topic_id,
               allocated_hours,
               status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending'::public.plan_item_status)
             RETURNING id, day_no, sort_order, lineage_id, topic_id, allocated_hours, status::text AS status, started_at, completed_at, reconciled_by_merge_id`,
            [
              insertedPlan.id,
              normalizedUserId,
              item.day_no,
              item.sort_order,
              item.lineage_id,
              item.topic_id,
              item.allocated_hours,
            ],
          );
          const created =
            extractReturningRows<Omit<PlanItemRow, 'title'>>(rawItem)[0];
          if (!created?.id) {
            fail(500, 'DATABASE_ERROR', 'Failed to persist Daily Plan item');
          }
          insertedItems.push({
            ...created,
            title: item.title,
          });
        }

        await db.query(
          `UPDATE public.user_profiles
              SET preferred_daily_hours = $2
            WHERE user_id = $1`,
          [normalizedUserId, hoursPerDay],
        );

        const built = buildDailyPlanDays(insertedItems);
        return {
          plan_id: String(insertedPlan.id),
          roadmap_id: String(insertedPlan.roadmap_id),
          is_focus: Boolean(roadmap.is_focus),
          hours_per_day: hoursPerDay,
          roadmap_version_no: versionNo,
          next_incomplete_day_no: built.nextIncompleteDayNo,
          total_days: built.totalDays,
          completed_days: built.completedDays,
          days: built.days,
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-L03` (`POST /api/v1/learning/daily-plans/:id/rebuild`, `200 OK`, `Gate: write (daily_plan)`, `R24 foreground = true`).
   *
   * Freezes all completed days and any day containing an `in_progress` item or unsubmitted
   * `quiz_attempts` row (`status IN ('generated', 'started')`). Deletes and reinserts ONLY
   * unfrozen `pending` items starting at `maxFrozenDayNo + 1`, never modifying `roadmap_items`.
   */
  async rebuildDailyPlan(
    userId: string,
    planId: string,
    dto: RebuildDailyPlanDTO,
  ): Promise<DailyPlanResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedPlanId = this.assertUuid(planId, 'id', 'Daily Plan id');
    const hoursPerDay = assertValidLearningHours(dto?.hours_per_day);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertDailyPlanFeatureEnabledInTx(db, normalizedUserId);

        const planRows = await db.query<DailyPlanRow[]>(
          `SELECT id,
                  roadmap_id,
                  hours_per_day,
                  status::text AS status,
                  roadmap_version_id,
                  plan_revision
             FROM public.daily_plans
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedPlanId],
        );
        const plan = Array.isArray(planRows) ? planRows[0] : undefined;
        if (!plan) {
          fail(404, 'DAILY_PLAN_NOT_FOUND', 'Daily Plan not found');
        }

        const roadmapRows = await db.query<RoadmapForPlanRow[]>(
          `SELECT id, status::text AS status, is_focus, current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2
            FOR SHARE`,
          [normalizedUserId, plan.roadmap_id],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }
        if (roadmap.status === 'archived') {
          fail(
            409,
            'ROADMAP_ARCHIVED',
            'Cannot rebuild a Daily Plan for an archived roadmap',
          );
        }
        if (roadmap.status !== 'locked') {
          fail(
            409,
            'ROADMAP_NOT_LOCKED',
            'Roadmap must be locked to rebuild its Daily Plan',
          );
        }

        const existingItems = await this.loadPlanItemsInTx(
          db,
          normalizedUserId,
          plan.id,
          true,
        );
        const itemIds = existingItems.map((i) => String(i.id));

        const inProgressQuizItemIds = new Set<string>();
        if (itemIds.length > 0) {
          const activeQuizRows = await db.query<
            Array<{ daily_plan_item_id: string }>
          >(
            `SELECT DISTINCT daily_plan_item_id
               FROM public.quiz_attempts
              WHERE user_id = $1
                AND daily_plan_item_id = ANY($2::uuid[])
                AND status IN ('generated'::public.attempt_status, 'started'::public.attempt_status)`,
            [normalizedUserId, itemIds],
          );
          for (const row of Array.isArray(activeQuizRows)
            ? activeQuizRows
            : []) {
            if (row.daily_plan_item_id) {
              inProgressQuizItemIds.add(String(row.daily_plan_item_id));
            }
          }
        }

        const frozenDayNos = new Set<number>();
        for (const item of existingItems) {
          if (
            item.status === 'completed' ||
            item.status === 'in_progress' ||
            inProgressQuizItemIds.has(String(item.id))
          ) {
            frozenDayNos.add(Number(item.day_no));
          }
        }

        let maxFrozenDayNo = 0;
        for (const dayNo of frozenDayNos) {
          if (dayNo > maxFrozenDayNo) {
            maxFrozenDayNo = dayNo;
          }
        }

        const frozenItems: PlanItemRow[] = [];
        const mutableItems: PlanItemRow[] = [];
        for (const item of existingItems) {
          if (frozenDayNos.has(Number(item.day_no))) {
            frozenItems.push(item);
          } else {
            mutableItems.push(item);
          }
        }

        const finalItems: PlanItemRow[] = [...frozenItems];

        if (mutableItems.length > 0) {
          const mutableIds = mutableItems.map((i) => String(i.id));
          await db.query(
            `DELETE FROM public.daily_plan_items
              WHERE plan_id = $1
                AND user_id = $2
                AND id = ANY($3::uuid[])`,
            [plan.id, normalizedUserId, mutableIds],
          );

          const repacked = packItemsIntoDays(
            mutableItems.map((item) => ({
              lineage_id: String(item.lineage_id),
              topic_id: String(item.topic_id),
              title: String(item.title),
              effort_hours: normalizePositiveEffortHours(item.allocated_hours),
              reconciled_by_merge_id: item.reconciled_by_merge_id,
            })),
            hoursPerDay,
            maxFrozenDayNo + 1,
          );

          for (const item of repacked) {
            const rawInserted = await db.query<unknown>(
              `INSERT INTO public.daily_plan_items (
                 plan_id,
                 user_id,
                 day_no,
                 sort_order,
                 lineage_id,
                 topic_id,
                 allocated_hours,
                 status,
                 reconciled_by_merge_id
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending'::public.plan_item_status, $8)
               RETURNING id, day_no, sort_order, lineage_id, topic_id, allocated_hours, status::text AS status, started_at, completed_at, reconciled_by_merge_id`,
              [
                plan.id,
                normalizedUserId,
                item.day_no,
                item.sort_order,
                item.lineage_id,
                item.topic_id,
                item.allocated_hours,
                item.reconciled_by_merge_id ?? null,
              ],
            );
            const created =
              extractReturningRows<Omit<PlanItemRow, 'title'>>(rawInserted)[0];
            if (!created?.id) {
              fail(
                500,
                'DATABASE_ERROR',
                'Failed to persist rebuilt Daily Plan item',
              );
            }
            finalItems.push({
              ...created,
              title: item.title,
            });
          }
        }

        await db.query(
          `UPDATE public.daily_plans
              SET hours_per_day = $3,
                  plan_revision = plan_revision + 1
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, plan.id, hoursPerDay],
        );

        await db.query(
          `UPDATE public.user_profiles
              SET preferred_daily_hours = $2
            WHERE user_id = $1`,
          [normalizedUserId, hoursPerDay],
        );

        const versionNo = await this.resolveVersionNoInTx(
          db,
          normalizedUserId,
          plan.roadmap_version_id ?? roadmap.current_version_id,
        );
        const built = buildDailyPlanDays(finalItems);

        return {
          plan_id: String(plan.id),
          roadmap_id: String(plan.roadmap_id),
          is_focus: Boolean(roadmap.is_focus),
          hours_per_day: hoursPerDay,
          roadmap_version_no: versionNo,
          next_incomplete_day_no: built.nextIncompleteDayNo,
          total_days: built.totalDays,
          completed_days: built.completedDays,
          days: built.days,
        };
      },
      true,
      true,
    );
  }
}
