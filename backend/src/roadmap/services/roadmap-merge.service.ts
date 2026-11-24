import { Inject, Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { JobProducerService } from '../../jobs/services/job-producer.service.js';
import {
  DailyPlanReconciler,
  type DailyPlanUndoSnapshot,
} from '../../learning/services/daily-plan-reconciler.service.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import {
  hasNulOrUnpairedSurrogate,
  type ItemPriority,
  type RoadmapStatus,
  type SkillGapType,
} from '../dto/roadmap.dto.js';
import {
  MERGE_OP_VALUES,
  MERGE_STATUS_VALUES,
  USER_MERGE_ORIGIN_VALUES,
  type AcceptMergeProposalDTO,
  type CreateMergeProposalDTO,
  type MergeAcceptResponseDTO,
  type MergeUndoResponseDTO,
  type ListMergeProposalsQueryDTO,
  type MergeDailyPlanImpactDTO,
  type MergeJobAcceptedDTO,
  type MergeOp,
  type MergeOperationDTO,
  type MergeOrigin,
  type MergeProposalDTO,
  type MergeRejectResponseDTO,
  type MergeStatus,
  type MergeSummaryDTO,
  type PaginatedMergeListDTO,
  type UserMergeOrigin,
} from '../dto/roadmap-merge.dto.js';
import {
  assertMergeGraphAcyclic,
  buildMergeSizeImpact,
  computeDailyPlanImpactPreviewInTx,
} from './merge-proposal-job.handler.js';
import {
  resolvePreferredLanguage,
  type RequestMutationContextOptions,
} from './roadmap.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_CURSOR_TIMESTAMPTZ_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?|[+-]15(?::?00)?)$/;
const CAREER_LEVEL_SET: ReadonlySet<string> = new Set([
  'junior',
  'mid',
  'senior',
]);

const DEFAULT_SOFT_SIZE_MAX_TOPICS = 45;
const R26_MIN_OPERATIONAL_LIMIT = 1;
const R26_MAX_OPERATIONAL_LIMIT = 10_000;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_POLL_RETRY_AFTER_SECONDS = 3;

interface MergeListRow {
  id: string;
  roadmap_id: string;
  origin: MergeOrigin;
  status: MergeStatus;
  base_version_no: number | string;
  result_version_id?: string | null;
  target_level: CareerLevel | null;
  reason: string | null;
  size_after?: number | string | null;
  materially_large: boolean;
  undo_snapshot?: unknown;
  undo_window_closed_at: Date | string | null;
  created_at: Date | string;
  created_at_cursor?: string | null;
  accepted_at: Date | string | null;
  rejected_at: Date | string | null;
  undone_at: Date | string | null;
}

interface MergeDetailRow {
  id: string;
  roadmap_id: string;
  roadmap_status: RoadmapStatus;
  roadmap_current_version_id?: string | null;
  origin: MergeOrigin;
  status: MergeStatus;
  base_version_id: string;
  base_version_no: number | string;
  result_version_id: string | null;
  target_level: CareerLevel | null;
  instruction: string | null;
  reason: string | null;
  size_before: number | string | null;
  size_after: number | string | null;
  materially_large: boolean;
  daily_plan_impact: unknown;
  undo_snapshot?: unknown;
  accepted_at: Date | string | null;
  rejected_at: Date | string | null;
  undone_at: Date | string | null;
  undo_window_closed_at: Date | string | null;
  created_at: Date | string;
}

interface CurrentPlanUndoState {
  id: string;
  plan_revision?: number | string | null;
}

interface MergeItemRow {
  id: string;
  sort_order: number | string;
  op: MergeOp;
  lineage_id: string | null;
  topic_id: string | null;
  skill_id: string | null;
  title: string | null;
  topic_title: string | null;
  base_title: string | null;
  priority: ItemPriority | null;
  reason: string | null;
  payload: unknown;
}

function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return new Date(0).toISOString();
}

function toNullableIsoTimestamp(
  value: Date | string | null | undefined,
): string | null {
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

function isValidCalendarTimestamp(raw: string): boolean {
  if (!PG_CURSOR_TIMESTAMPTZ_PATTERN.test(raw)) {
    return false;
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return false;
  }
  return !Number.isNaN(Date.parse(raw));
}

function encodeMergeCursor(createdAt: Date | string, id: string): string {
  return Buffer.from(
    JSON.stringify({
      created_at: toIsoTimestamp(createdAt),
      id: id.toLowerCase(),
    }),
    'utf8',
  ).toString('base64url');
}

function decodeMergeCursor(rawCursor: string): {
  createdAt: string;
  id: string;
} {
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { created_at?: unknown; id?: unknown };
    const createdAt =
      typeof parsed?.created_at === 'string' ? parsed.created_at.trim() : '';
    if (
      !createdAt ||
      !isValidCalendarTimestamp(createdAt) ||
      typeof parsed?.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id.trim())
    ) {
      throw new Error('Malformed merge cursor');
    }
    return {
      createdAt,
      id: parsed.id.trim().toLowerCase(),
    };
  } catch {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor must be a valid opaque pagination token',
      },
    ]);
  }
}

function normalizePersistedDailyPlanImpact(
  raw: unknown,
): MergeDailyPlanImpactDTO {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      has_active_plan: false,
      completed_days_unchanged: 0,
      future_days_affected: 0,
    };
  }
  const rec = raw as Record<string, unknown>;
  const completed = Number(rec.completed_days_unchanged);
  const future = Number(rec.future_days_affected);
  const hasActivePlan =
    typeof rec.has_active_plan === 'boolean'
      ? rec.has_active_plan
      : (Number.isFinite(completed) && completed > 0) ||
        (Number.isFinite(future) && future > 0);
  return {
    has_active_plan: hasActivePlan,
    completed_days_unchanged:
      Number.isFinite(completed) && completed >= 0 ? Math.trunc(completed) : 0,
    future_days_affected:
      Number.isFinite(future) && future >= 0 ? Math.trunc(future) : 0,
  };
}

function isUndoSnapshotPlanCompatible(
  undoSnapshot: unknown,
  currentPlan: CurrentPlanUndoState | null | undefined,
): boolean {
  const snapshot =
    undoSnapshot &&
    typeof undoSnapshot === 'object' &&
    !Array.isArray(undoSnapshot)
      ? (undoSnapshot as { daily_plan?: DailyPlanUndoSnapshot | null })
      : null;
  const snapshotPlan = snapshot?.daily_plan ?? null;

  if (!currentPlan?.id) {
    return snapshotPlan === null;
  }
  if (!snapshotPlan?.plan_id) {
    // A Daily Plan was created after the merge on the merged version; cannot safely undo.
    return false;
  }
  if (
    String(snapshotPlan.plan_id).toLowerCase() !==
    String(currentPlan.id).toLowerCase()
  ) {
    return false;
  }
  if (
    currentPlan.plan_revision !== undefined &&
    currentPlan.plan_revision !== null
  ) {
    const expectedRevision =
      typeof snapshotPlan.reconciled_plan_revision === 'number' &&
      Number.isFinite(snapshotPlan.reconciled_plan_revision)
        ? snapshotPlan.reconciled_plan_revision
        : typeof snapshotPlan.plan_revision === 'number' &&
            Number.isFinite(snapshotPlan.plan_revision)
          ? snapshotPlan.plan_revision + 1
          : null;
    if (
      expectedRevision !== null &&
      Number(currentPlan.plan_revision) !== expectedRevision
    ) {
      return false;
    }
  }
  return true;
}

function isMergeUndoAvailable(params: {
  roadmapStatus: RoadmapStatus;
  roadmapCurrentVersionId?: string | null;
  mergeStatus: MergeStatus;
  resultVersionId?: string | null;
  undoWindowClosedAt: Date | string | null;
  undoSnapshot: unknown;
  currentPlan: CurrentPlanUndoState | null | undefined;
}): boolean {
  if (
    params.roadmapStatus !== 'locked' ||
    params.mergeStatus !== 'accepted' ||
    params.undoWindowClosedAt !== null
  ) {
    return false;
  }
  if (
    params.roadmapCurrentVersionId &&
    params.resultVersionId !== undefined &&
    (!params.resultVersionId ||
      String(params.roadmapCurrentVersionId).toLowerCase() !==
        String(params.resultVersionId).toLowerCase())
  ) {
    return false;
  }
  return isUndoSnapshotPlanCompatible(params.undoSnapshot, params.currentPlan);
}

/**
 * Service implementing `C05` §14.5 Roadmap Merge lifecycle (`EP-R08`, `EP-R09`, `EP-R10`, `EP-R12`).
 *
 * Guarantees (`PRD` §18, §20–§21, `C05` §14.5):
 * - A merge proposal NEVER mutates a locked roadmap or its Daily Plan until explicit `EP-R11` acceptance.
 * - `EP-R08` enforces `roadmap_generator` write gate, locked roadmap precondition, `LEVEL_UNCHANGED`
 *   guard, optimistic `base_version_no`/`If-Match` check, single open proposal guard, and enqueues (or
 *   reuses a matching active) `merge_proposal` durable job (`202 Accepted`).
 * - `EP-R09` / `EP-R10` work even when `roadmap_generator` is disabled (`Gate: none`) and expose
 *   `user_request`, `level_change`, and `ai_proposal` rows.
 * - `EP-R12` transitions `proposed -> rejected` (`rejected_at = clock_timestamp()`) atomically without
 *   touching roadmap versions or daily plans.
 */
@Injectable()
export class RoadmapMergeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JobProducerService)
    private readonly jobProducer: JobProducerService,
    @Optional()
    @Inject(DailyPlanReconciler)
    private readonly reconciler?: DailyPlanReconciler,
  ) {}

  private getReconciler(): DailyPlanReconciler {
    if (!this.reconciler) {
      fail(500, 'INTERNAL_ERROR', 'DailyPlanReconciler is not configured');
    }
    return this.reconciler;
  }

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

  private async assertRoadmapGeneratorAccess(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const rows = await db.query<Array<{ enabled?: boolean }>>(
      "SELECT private.effective_feature_access($1, 'roadmap_generator') AS enabled",
      [userId],
    );
    if (!rows?.[0]?.enabled) {
      fail(
        403,
        'FEATURE_DISABLED',
        'Roadmap generation is currently disabled for this account',
      );
    }
  }

  private async readBoundedConfigInteger(
    db: TransactionalQueryExecutor,
    configKey: string,
    defaultValue: number,
  ): Promise<number> {
    const rows = await db.query<Array<{ config_value: unknown }>>(
      `SELECT config_value
         FROM public.system_configurations
        WHERE config_key = $1`,
      [configKey],
    );
    const raw = Array.isArray(rows) ? rows[0]?.config_value : undefined;
    const numeric =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;
    if (
      Number.isInteger(numeric) &&
      numeric >= R26_MIN_OPERATIONAL_LIMIT &&
      numeric <= R26_MAX_OPERATIONAL_LIMIT
    ) {
      return numeric;
    }
    return defaultValue;
  }

  private async hasStartedPostMergeLearningInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    mergeId: string,
  ): Promise<boolean> {
    const rows = await db.query<Array<{ blocked?: number | string }>>(
      `SELECT 1 AS blocked
         FROM public.daily_plan_items dpi
        WHERE dpi.user_id = $1
          AND dpi.reconciled_by_merge_id = $2
          AND (
            dpi.status <> 'pending'::public.plan_item_status
            OR EXISTS (
              SELECT 1
                FROM public.quiz_attempts qa
               WHERE qa.user_id = $1
                 AND qa.daily_plan_item_id = dpi.id
                 AND qa.status <> 'generated'::public.attempt_status
            )
          )
        LIMIT 1`,
      [userId, mergeId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * `EP-R08` (`POST /api/v1/roadmaps/:id/merges`, `202 Accepted`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  async createProposal(
    userId: string,
    roadmapId: string,
    dto: CreateMergeProposalDTO,
    options: RequestMutationContextOptions = {},
  ): Promise<MergeJobAcceptedDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedRoadmapId = this.assertUuid(roadmapId, 'id', 'Roadmap id');

    const rawOrigin =
      typeof dto?.origin === 'string' ? dto.origin.trim().toLowerCase() : '';
    if (!USER_MERGE_ORIGIN_VALUES.includes(rawOrigin as UserMergeOrigin)) {
      fail(
        422,
        'INVALID_ENUM_VALUE',
        'Merge proposal origin must be user_request or level_change',
        [
          {
            field: 'origin',
            code: 'INVALID_ENUM_VALUE',
            message: 'origin must be user_request or level_change',
          },
        ],
      );
    }
    const origin = rawOrigin as UserMergeOrigin;

    let targetLevel: CareerLevel | undefined;
    if (dto?.target_level !== undefined && dto.target_level !== null) {
      const normalizedLevel =
        typeof dto.target_level === 'string'
          ? dto.target_level.trim().toLowerCase()
          : '';
      if (!CAREER_LEVEL_SET.has(normalizedLevel)) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid target_level', [
          {
            field: 'target_level',
            code: 'INVALID_ENUM_VALUE',
            message: 'target_level must be junior, mid, or senior',
          },
        ]);
      }
      targetLevel = normalizedLevel as CareerLevel;
    }
    if (origin === 'level_change' && !targetLevel) {
      fail(
        422,
        'VALIDATION_FAILED',
        'target_level is required for level_change merge proposals',
        [
          {
            field: 'target_level',
            code: 'VALIDATION_FAILED',
            message: 'target_level is required when origin is level_change',
          },
        ],
      );
    }

    let instruction: string | undefined;
    if (dto?.instruction !== undefined && dto.instruction !== null) {
      if (typeof dto.instruction !== 'string') {
        fail(422, 'VALIDATION_FAILED', 'instruction must be a string', [
          {
            field: 'instruction',
            code: 'VALIDATION_FAILED',
            message: 'instruction must be a valid string',
          },
        ]);
      }
      if (hasNulOrUnpairedSurrogate(dto.instruction)) {
        fail(
          422,
          'VALIDATION_FAILED',
          'instruction contains unsupported characters',
          [
            {
              field: 'instruction',
              code: 'VALIDATION_FAILED',
              message:
                'instruction cannot contain NUL bytes or unpaired Unicode surrogates',
            },
          ],
        );
      }
      const trimmed = dto.instruction.trim();
      const len = Array.from(trimmed).length;
      if (len < 3 || len > 1_000) {
        fail(
          422,
          'VALIDATION_FAILED',
          'instruction must be between 3 and 1000 Unicode code points',
          [
            {
              field: 'instruction',
              code: 'VALIDATION_FAILED',
              message: 'instruction must be between 3 and 1000 characters',
            },
          ],
        );
      }
      instruction = trimmed;
    }
    if (origin === 'user_request' && !instruction) {
      fail(
        422,
        'VALIDATION_FAILED',
        'instruction is required for user_request merge proposals',
        [
          {
            field: 'instruction',
            code: 'VALIDATION_FAILED',
            message:
              'instruction (3–1000 chars) is required when origin is user_request',
          },
        ],
      );
    }

    const bodyBaseVersionNo = dto?.base_version_no ?? undefined;
    const headerIfMatch = options.ifMatch;
    if (
      bodyBaseVersionNo !== undefined &&
      headerIfMatch !== undefined &&
      bodyBaseVersionNo !== headerIfMatch
    ) {
      fail(
        409,
        'STALE_VERSION',
        'Conflicting base_version_no and If-Match version preconditions',
      );
    }

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

        const roadmapRows = await db.query<
          Array<{
            id: string;
            status: RoadmapStatus;
            target_level: CareerLevel;
            current_version_id: string | null;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  target_level::text AS target_level,
                  current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }
        if (roadmap.status === 'archived') {
          fail(
            409,
            'ROADMAP_ARCHIVED',
            'Archived roadmaps cannot accept merge proposals',
          );
        }
        if (roadmap.status !== 'locked' || !roadmap.current_version_id) {
          fail(
            409,
            'ROADMAP_NOT_LOCKED',
            'Only locked roadmaps can receive merge proposals',
          );
        }

        if (origin === 'level_change' && targetLevel === roadmap.target_level) {
          fail(
            422,
            'LEVEL_UNCHANGED',
            'Target career level must differ from the roadmap current target level',
            [
              {
                field: 'target_level',
                code: 'LEVEL_UNCHANGED',
                message: 'target_level matches the current roadmap level',
              },
            ],
          );
        }

        const versionRows = await db.query<
          Array<{ id: string; version_no: number | string }>
        >(
          `SELECT id, version_no
             FROM public.roadmap_versions
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, roadmap.current_version_id],
        );
        const currentVersion = Array.isArray(versionRows)
          ? versionRows[0]
          : undefined;
        if (!currentVersion) {
          fail(
            409,
            'ROADMAP_NOT_LOCKED',
            'Current locked roadmap version could not be found',
          );
        }
        const currentVersionNo = Number(currentVersion.version_no);

        if (
          (bodyBaseVersionNo !== undefined &&
            bodyBaseVersionNo !== currentVersionNo) ||
          (headerIfMatch !== undefined && headerIfMatch !== currentVersionNo)
        ) {
          fail(
            409,
            'STALE_VERSION',
            'Roadmap version has changed; reload and retry',
          );
        }

        const openMergeRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.roadmap_merges
            WHERE user_id = $1
              AND roadmap_id = $2
              AND status = 'proposed'::public.merge_status
            LIMIT 1`,
          [normalizedUserId, normalizedRoadmapId],
        );
        if (Array.isArray(openMergeRows) && openMergeRows.length > 0) {
          fail(
            409,
            'MERGE_ALREADY_PROPOSED',
            'An open merge proposal already exists for this roadmap',
          );
        }

        const language = resolvePreferredLanguage(options.acceptLanguage);

        // Reuse an in-flight identical merge_proposal job or guard against concurrent conflicting proposals
        const activeJobRows = await db.query<
          Array<{
            id: string;
            status: 'queued' | 'preparing';
            language?: string | null;
            input_payload: Record<string, unknown> | null;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  language::text AS language,
                  input_payload
             FROM public.ai_requests
            WHERE user_id = $1
              AND is_async = true
              AND job_kind = 'merge_proposal'::public.job_kind
              AND subject_type = 'roadmap'
              AND subject_id = $2
              AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            ORDER BY created_at DESC
            LIMIT 1`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const activeJob = Array.isArray(activeJobRows)
          ? activeJobRows[0]
          : undefined;
        if (activeJob?.id) {
          const activeArgs = (
            activeJob.input_payload as { args?: Record<string, unknown> } | null
          )?.args;
          const activeLanguage =
            typeof activeJob.language === 'string' && activeJob.language.trim()
              ? activeJob.language.trim().toLowerCase()
              : 'en';
          const matchesActive =
            activeArgs &&
            activeLanguage === language &&
            Number(activeArgs.base_version_no) === currentVersionNo &&
            activeArgs.origin === origin &&
            (activeArgs.target_level ?? undefined) ===
              (origin === 'level_change' ? targetLevel : undefined) &&
            (activeArgs.instruction ?? undefined) === instruction;
          if (matchesActive) {
            return {
              job_id: String(activeJob.id),
              kind: 'merge_proposal',
              status: activeJob.status,
              poll_url: `/api/v1/jobs/${activeJob.id}`,
              retry_after_seconds: DEFAULT_POLL_RETRY_AFTER_SECONDS,
            };
          }
          fail(
            409,
            'MERGE_ALREADY_PROPOSED',
            'A merge proposal generation job is already in progress for this roadmap',
          );
        }

        const enqueued = await this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'merge_proposal',
            envelope: {
              v: 1,
              args: {
                roadmap_id: normalizedRoadmapId,
                base_version_no: currentVersionNo,
                origin,
                ...(instruction !== undefined ? { instruction } : {}),
                ...(origin === 'level_change' && targetLevel !== undefined
                  ? { target_level: targetLevel }
                  : {}),
              },
              expected_refs: {
                base_version_no: currentVersionNo,
              },
            },
            idempotencyKey: options.idempotencyKey,
            subjectType: 'roadmap',
            subjectId: normalizedRoadmapId,
            httpRequestId: options.httpRequestId,
            language,
          },
          db,
        );
        return {
          ...enqueued,
          kind: 'merge_proposal',
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-R09` (`GET /api/v1/roadmaps/:id/merges`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   * Existing-data read: works even when `roadmap_generator` is OFF; surfaces `user_request`,
   * `level_change`, and `ai_proposal` rows newest-first with keyset cursor pagination.
   */
  async listProposals(
    userId: string,
    roadmapId: string,
    query: ListMergeProposalsQueryDTO = {},
  ): Promise<PaginatedMergeListDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedRoadmapId = this.assertUuid(roadmapId, 'id', 'Roadmap id');

    let statusFilter: MergeStatus | undefined;
    if (query?.status !== undefined && query.status !== null) {
      const normalizedStatus = String(query.status)
        .trim()
        .toLowerCase() as MergeStatus;
      if (!MERGE_STATUS_VALUES.includes(normalizedStatus)) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid merge status filter', [
          {
            field: 'status',
            code: 'INVALID_ENUM_VALUE',
            message:
              'status must be proposed, accepted, rejected, undone, or superseded',
          },
        ]);
      }
      statusFilter = normalizedStatus;
    }

    const rawLimit = query?.limit ?? DEFAULT_PAGE_LIMIT;
    const limit = Math.min(
      MAX_PAGE_LIMIT,
      Math.max(1, Math.trunc(Number(rawLimit) || DEFAULT_PAGE_LIMIT)),
    );

    const decodedCursor =
      typeof query?.cursor === 'string' && query.cursor.trim().length > 0
        ? decodeMergeCursor(query.cursor)
        : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const roadmapRows = await db.query<
          Array<{
            id: string;
            status: RoadmapStatus;
            current_version_id?: string | null;
          }>
        >(
          `SELECT id, status::text AS status, current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }

        const params: unknown[] = [normalizedUserId, normalizedRoadmapId];
        const whereClauses: string[] = [
          'rm.user_id = $1',
          'rm.roadmap_id = $2',
        ];

        if (statusFilter) {
          params.push(statusFilter);
          whereClauses.push(
            `rm.status = $${params.length}::public.merge_status`,
          );
        }

        if (decodedCursor) {
          params.push(decodedCursor.createdAt);
          const createdParam = `$${params.length}::timestamptz`;
          params.push(decodedCursor.id);
          const idParam = `$${params.length}::uuid`;
          whereClauses.push(
            `(rm.created_at < ${createdParam} OR (rm.created_at = ${createdParam} AND rm.id < ${idParam}))`,
          );
        }

        params.push(limit + 1);
        const limitParam = `$${params.length}`;

        const rows = await db.query<MergeListRow[]>(
          `SELECT rm.id,
                  rm.roadmap_id,
                  rm.origin::text AS origin,
                  rm.status::text AS status,
                  bv.version_no AS base_version_no,
                  rm.result_version_id,
                  rm.target_level::text AS target_level,
                  rm.reason,
                  rm.size_after,
                  rm.materially_large,
                  rm.undo_snapshot,
                  rm.undo_window_closed_at,
                  rm.created_at,
                  to_char(rm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
                  rm.accepted_at,
                  rm.rejected_at,
                  rm.undone_at
             FROM public.roadmap_merges rm
             JOIN public.roadmap_versions bv
               ON bv.id = rm.base_version_id
              AND bv.user_id = $1
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY rm.created_at DESC, rm.id DESC
            LIMIT ${limitParam}`,
          params,
        );

        const rowList = Array.isArray(rows) ? rows : [];
        const hasMore = rowList.length > limit;
        const pageRows = hasMore ? rowList.slice(0, limit) : rowList;
        const hasProposedRow = pageRows.some(
          (row) => row.status === 'proposed',
        );
        const currentSoftLimit = hasProposedRow
          ? await this.readBoundedConfigInteger(
              db,
              'roadmap.soft_size_max_topics',
              DEFAULT_SOFT_SIZE_MAX_TOPICS,
            )
          : DEFAULT_SOFT_SIZE_MAX_TOPICS;
        const hasUndoCandidate =
          roadmap.status === 'locked' &&
          pageRows.some(
            (row) =>
              row.status === 'accepted' && row.undo_window_closed_at === null,
          );
        let currentPlan: CurrentPlanUndoState | null = null;
        if (hasUndoCandidate) {
          const planRows = await db.query<CurrentPlanUndoState[]>(
            `SELECT id, plan_revision
               FROM public.daily_plans
              WHERE user_id = $1
                AND roadmap_id = $2
              LIMIT 1`,
            [normalizedUserId, normalizedRoadmapId],
          );
          currentPlan =
            Array.isArray(planRows) && planRows[0]?.id ? planRows[0] : null;
        }

        const items: MergeSummaryDTO[] = [];
        for (const row of pageRows) {
          let undoAvailable = isMergeUndoAvailable({
            roadmapStatus: roadmap.status,
            roadmapCurrentVersionId: roadmap.current_version_id,
            mergeStatus: row.status,
            resultVersionId: row.result_version_id,
            undoWindowClosedAt: row.undo_window_closed_at,
            undoSnapshot: row.undo_snapshot,
            currentPlan,
          });
          if (undoAvailable) {
            const started = await this.hasStartedPostMergeLearningInTx(
              db,
              normalizedUserId,
              String(row.id),
            );
            if (started) {
              undoAvailable = false;
            }
          }
          const rowSizeAfter =
            row.size_after !== null && row.size_after !== undefined
              ? Number(row.size_after)
              : null;
          const isMateriallyLarge =
            Boolean(row.materially_large) ||
            (row.status === 'proposed' &&
              rowSizeAfter !== null &&
              Number.isFinite(rowSizeAfter) &&
              rowSizeAfter > currentSoftLimit);
          items.push({
            id: String(row.id),
            roadmap_id: String(row.roadmap_id),
            origin: row.origin,
            status: row.status,
            base_version_no: Number(row.base_version_no),
            target_level: row.target_level ?? null,
            reason: row.reason ?? null,
            materially_large: isMateriallyLarge,
            undo_available: undoAvailable,
            created_at: toIsoTimestamp(row.created_at),
            accepted_at: toNullableIsoTimestamp(row.accepted_at),
            rejected_at: toNullableIsoTimestamp(row.rejected_at),
            undone_at: toNullableIsoTimestamp(row.undone_at),
          });
        }

        const lastRow = pageRows[pageRows.length - 1];
        const nextCursor =
          hasMore && lastRow
            ? encodeMergeCursor(
                lastRow.created_at_cursor ?? lastRow.created_at,
                String(lastRow.id),
              )
            : null;

        return {
          items,
          meta: {
            limit,
            next_cursor: nextCursor,
          },
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-R10` (`GET /api/v1/roadmaps/:id/merges/:merge_id`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   * Existing-data read: returns ordered operations, size impact, live daily plan impact (while `proposed`)
   * or persisted impact (once decided), and `undo_available`.
   */
  async getProposal(
    userId: string,
    roadmapId: string,
    mergeId: string,
  ): Promise<MergeProposalDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedRoadmapId = this.assertUuid(roadmapId, 'id', 'Roadmap id');
    const normalizedMergeId = this.assertUuid(
      mergeId,
      'merge_id',
      'Merge proposal id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const mergeRows = await db.query<MergeDetailRow[]>(
          `SELECT rm.id,
                  rm.roadmap_id,
                  r.status::text AS roadmap_status,
                  r.current_version_id AS roadmap_current_version_id,
                  rm.origin::text AS origin,
                  rm.status::text AS status,
                  rm.base_version_id,
                  bv.version_no AS base_version_no,
                  rm.result_version_id,
                  rm.target_level::text AS target_level,
                  rm.instruction,
                  rm.reason,
                  rm.size_before,
                  rm.size_after,
                  rm.materially_large,
                  rm.daily_plan_impact,
                  rm.undo_snapshot,
                  rm.accepted_at,
                  rm.rejected_at,
                  rm.undone_at,
                  rm.undo_window_closed_at,
                  rm.created_at
             FROM public.roadmap_merges rm
             JOIN public.roadmaps r
               ON r.id = rm.roadmap_id
              AND r.user_id = $1
             JOIN public.roadmap_versions bv
               ON bv.id = rm.base_version_id
              AND bv.user_id = $1
            WHERE rm.user_id = $1
              AND rm.roadmap_id = $2
              AND rm.id = $3
            LIMIT 1`,
          [normalizedUserId, normalizedRoadmapId, normalizedMergeId],
        );
        const merge = Array.isArray(mergeRows) ? mergeRows[0] : undefined;
        if (!merge) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Merge proposal not found');
        }

        const itemRows = await db.query<MergeItemRow[]>(
          `SELECT rmi.id,
                  rmi.sort_order,
                  rmi.op::text AS op,
                  rmi.lineage_id,
                  rmi.topic_id,
                  COALESCE(t.skill_id, ri.skill_id) AS skill_id,
                  rmi.title,
                  t.title AS topic_title,
                  ri.title AS base_title,
                  rmi.priority::text AS priority,
                  rmi.reason,
                  rmi.payload
             FROM public.roadmap_merge_items rmi
             LEFT JOIN public.topics t
               ON t.id = rmi.topic_id
             LEFT JOIN public.roadmap_items ri
               ON ri.version_id = $3
              AND ri.user_id = $1
              AND ri.lineage_id = rmi.lineage_id
            WHERE rmi.user_id = $1
              AND rmi.merge_id = $2
            ORDER BY rmi.sort_order ASC`,
          [normalizedUserId, normalizedMergeId, merge.base_version_id],
        );

        const operations: MergeOperationDTO[] = (
          Array.isArray(itemRows) ? itemRows : []
        ).map((row) => {
          const payload =
            row.payload &&
            typeof row.payload === 'object' &&
            !Array.isArray(row.payload)
              ? (row.payload as Record<string, unknown>)
              : {};
          const payloadSkillId =
            typeof payload.skill_id === 'string' &&
            UUID_PATTERN.test(payload.skill_id)
              ? payload.skill_id.toLowerCase()
              : null;
          const op = MERGE_OP_VALUES.includes(row.op) ? row.op : 'update_topic';
          const lineageId = row.lineage_id
            ? String(row.lineage_id).toLowerCase()
            : null;
          return {
            id: String(row.id),
            sort_order: Number(row.sort_order),
            op,
            item_id: lineageId,
            lineage_id: lineageId,
            topic_id: row.topic_id ? String(row.topic_id).toLowerCase() : null,
            skill_id: row.skill_id
              ? String(row.skill_id).toLowerCase()
              : payloadSkillId,
            title: row.title ?? row.topic_title ?? row.base_title ?? null,
            priority: row.priority ?? null,
            reason: row.reason ?? null,
            payload,
          };
        });

        const softMaxTopics = await this.readBoundedConfigInteger(
          db,
          'roadmap.soft_size_max_topics',
          DEFAULT_SOFT_SIZE_MAX_TOPICS,
        );
        const sizeBefore =
          merge.size_before !== null && merge.size_before !== undefined
            ? Number(merge.size_before)
            : 0;
        const sizeAfter =
          merge.size_after !== null && merge.size_after !== undefined
            ? Number(merge.size_after)
            : sizeBefore;
        const computedSizeImpact = buildMergeSizeImpact(
          sizeBefore,
          sizeAfter,
          softMaxTopics,
        );
        const isMateriallyLarge =
          Boolean(merge.materially_large) ||
          computedSizeImpact.materially_large;
        const sizeImpact = {
          ...computedSizeImpact,
          materially_large: isMateriallyLarge,
          warning: isMateriallyLarge
            ? (computedSizeImpact.warning ??
              'This proposal was flagged as a materially large roadmap expansion and requires acknowledgement before accepting.')
            : computedSizeImpact.warning,
        };

        const dailyPlanImpact =
          merge.status === 'proposed'
            ? await computeDailyPlanImpactPreviewInTx(
                db,
                normalizedUserId,
                normalizedRoadmapId,
                operations.map((o) => ({
                  op: o.op,
                  lineage_id: o.lineage_id,
                  payload: o.payload,
                })),
              )
            : normalizePersistedDailyPlanImpact(merge.daily_plan_impact);

        let currentPlan: CurrentPlanUndoState | null = null;
        if (
          merge.roadmap_status === 'locked' &&
          merge.status === 'accepted' &&
          merge.undo_window_closed_at === null
        ) {
          const planRows = await db.query<CurrentPlanUndoState[]>(
            `SELECT id, plan_revision
               FROM public.daily_plans
              WHERE user_id = $1
                AND roadmap_id = $2
              LIMIT 1`,
            [normalizedUserId, normalizedRoadmapId],
          );
          currentPlan =
            Array.isArray(planRows) && planRows[0]?.id ? planRows[0] : null;
        }

        let undoAvailable = isMergeUndoAvailable({
          roadmapStatus: merge.roadmap_status,
          roadmapCurrentVersionId: merge.roadmap_current_version_id,
          mergeStatus: merge.status,
          resultVersionId: merge.result_version_id,
          undoWindowClosedAt: merge.undo_window_closed_at,
          undoSnapshot: merge.undo_snapshot,
          currentPlan,
        });
        if (undoAvailable) {
          const started = await this.hasStartedPostMergeLearningInTx(
            db,
            normalizedUserId,
            String(merge.id),
          );
          if (started) {
            undoAvailable = false;
          }
        }

        return {
          id: String(merge.id),
          roadmap_id: String(merge.roadmap_id),
          origin: merge.origin,
          status: merge.status,
          base_version_id: String(merge.base_version_id),
          base_version_no: Number(merge.base_version_no),
          result_version_id: merge.result_version_id
            ? String(merge.result_version_id)
            : null,
          target_level: merge.target_level ?? null,
          instruction: merge.instruction ?? null,
          reason: merge.reason ?? null,
          operations,
          size_impact: sizeImpact,
          daily_plan_impact: dailyPlanImpact,
          undo_available: undoAvailable,
          created_at: toIsoTimestamp(merge.created_at),
          accepted_at: toNullableIsoTimestamp(merge.accepted_at),
          rejected_at: toNullableIsoTimestamp(merge.rejected_at),
          undone_at: toNullableIsoTimestamp(merge.undone_at),
          undo_window_closed_at: toNullableIsoTimestamp(
            merge.undo_window_closed_at,
          ),
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-R12` (`POST /api/v1/roadmaps/:id/merges/:merge_id/reject`, `200 OK`, `Gate: none`, `R24 foreground = true`).
   * Locks `roadmaps` and `roadmap_merges`, verifies `status === 'proposed'` (else `409 MERGE_NOT_PENDING`),
   * and marks `status = 'rejected', rejected_at = clock_timestamp()` without touching roadmap versions or daily plans.
   */
  async rejectProposal(
    userId: string,
    roadmapId: string,
    mergeId: string,
  ): Promise<MergeRejectResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedRoadmapId = this.assertUuid(roadmapId, 'id', 'Roadmap id');
    const normalizedMergeId = this.assertUuid(
      mergeId,
      'merge_id',
      'Merge proposal id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const roadmapRows = await db.query<
          Array<{ id: string; status: RoadmapStatus }>
        >(
          `SELECT id, status::text AS status
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }

        const mergeRows = await db.query<
          Array<{ id: string; status: MergeStatus }>
        >(
          `SELECT id, status::text AS status
             FROM public.roadmap_merges
            WHERE user_id = $1
              AND roadmap_id = $2
              AND id = $3
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId, normalizedMergeId],
        );
        const merge = Array.isArray(mergeRows) ? mergeRows[0] : undefined;
        if (!merge) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Merge proposal not found');
        }
        if (merge.status !== 'proposed') {
          fail(
            409,
            'MERGE_NOT_PENDING',
            'Only pending merge proposals can be rejected',
          );
        }

        const updatedRaw = await db.query<unknown>(
          `UPDATE public.roadmap_merges
              SET status = 'rejected'::public.merge_status,
                  rejected_at = clock_timestamp()
            WHERE user_id = $1
              AND roadmap_id = $2
              AND id = $3
              AND status = 'proposed'::public.merge_status
           RETURNING id, rejected_at`,
          [normalizedUserId, normalizedRoadmapId, normalizedMergeId],
        );
        const updated = extractReturningRows<{
          id: string;
          rejected_at: Date | string;
        }>(updatedRaw)[0];
        if (!updated?.id) {
          fail(409, 'MERGE_NOT_PENDING', 'Merge proposal is no longer pending');
        }

        return {
          merge_id: String(updated.id),
          status: 'rejected',
          rejected_at: toIsoTimestamp(updated.rejected_at),
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-R11` (`POST /api/v1/roadmaps/:id/merges/:merge_id/accept`, `200`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   * Single transaction, lock order: `daily_plans -> roadmaps -> roadmap_merges -> daily_plan_items`.
   */
  async acceptProposal(
    userId: string,
    roadmapId: string,
    mergeId: string,
    dto: AcceptMergeProposalDTO = {},
    options: RequestMutationContextOptions = {},
  ): Promise<MergeAcceptResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedRoadmapId = this.assertUuid(roadmapId, 'id', 'Roadmap id');
    const normalizedMergeId = this.assertUuid(
      mergeId,
      'merge_id',
      'Merge proposal id',
    );

    const bodyVersionNo = dto?.base_version_no ?? undefined;
    const headerIfMatch = options.ifMatch;
    if (bodyVersionNo === undefined && headerIfMatch === undefined) {
      fail(
        422,
        'VALIDATION_FAILED',
        'base_version_no (or If-Match) is required to accept a merge proposal',
        [
          {
            field: 'base_version_no',
            code: 'VALIDATION_FAILED',
            message: 'Provide base_version_no or an If-Match header',
          },
        ],
      );
    }
    if (
      bodyVersionNo !== undefined &&
      headerIfMatch !== undefined &&
      bodyVersionNo !== headerIfMatch
    ) {
      fail(
        409,
        'STALE_VERSION',
        'Conflicting base_version_no and If-Match version preconditions',
      );
    }
    const expectedVersionNo = (bodyVersionNo ?? headerIfMatch) as number;
    const acknowledged = dto?.acknowledge_large_expansion === true;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

        // 1. daily_plans FOR UPDATE (matches EP-L03 / EP-Q01 / EP-Q03 ordering)
        const planRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.daily_plans
            WHERE user_id = $1
              AND roadmap_id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const planId = Array.isArray(planRows) ? planRows[0]?.id : undefined;

        // 2. roadmaps FOR UPDATE
        const roadmapRows = await db.query<
          Array<{
            id: string;
            status: RoadmapStatus;
            target_level: CareerLevel;
            career_goal_id: string;
            current_version_id: string | null;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  target_level::text AS target_level,
                  career_goal_id,
                  current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }
        if (roadmap.status === 'archived') {
          fail(
            409,
            'ROADMAP_ARCHIVED',
            'Archived roadmaps cannot accept merges',
          );
        }
        if (roadmap.status !== 'locked' || !roadmap.current_version_id) {
          fail(
            409,
            'ROADMAP_NOT_LOCKED',
            'Only locked roadmaps can accept merge proposals',
          );
        }

        // 3. roadmap_merges FOR UPDATE
        const mergeRows = await db.query<
          Array<{
            id: string;
            status: MergeStatus;
            origin: MergeOrigin;
            base_version_id: string;
            target_level: CareerLevel | null;
            size_after?: number | string | null;
            materially_large: boolean;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  origin::text AS origin,
                  base_version_id,
                  target_level::text AS target_level,
                  size_after,
                  materially_large
             FROM public.roadmap_merges
            WHERE user_id = $1
              AND roadmap_id = $2
              AND id = $3
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId, normalizedMergeId],
        );
        const merge = Array.isArray(mergeRows) ? mergeRows[0] : undefined;
        if (!merge) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Merge proposal not found');
        }
        if (merge.status !== 'proposed') {
          fail(
            409,
            'MERGE_NOT_PENDING',
            'Only pending merge proposals can be accepted',
          );
        }

        const baseRows = await db.query<
          Array<{ id: string; version_no: number | string }>
        >(
          `SELECT id, version_no
             FROM public.roadmap_versions
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, merge.base_version_id],
        );
        const baseVersion = Array.isArray(baseRows) ? baseRows[0] : undefined;
        if (
          !baseVersion ||
          String(roadmap.current_version_id) !==
            String(merge.base_version_id) ||
          Number(baseVersion.version_no) !== expectedVersionNo
        ) {
          fail(
            409,
            'STALE_VERSION',
            'Roadmap version has changed; reload and retry',
          );
        }

        const currentSoftLimit = await this.readBoundedConfigInteger(
          db,
          'roadmap.soft_size_max_topics',
          DEFAULT_SOFT_SIZE_MAX_TOPICS,
        );
        const storedSizeAfter =
          merge.size_after !== null && merge.size_after !== undefined
            ? Number(merge.size_after)
            : null;
        if (
          (Boolean(merge.materially_large) ||
            (storedSizeAfter !== null && storedSizeAfter > currentSoftLimit)) &&
          !acknowledged
        ) {
          fail(
            409,
            'MERGE_EXPANSION_ACK_REQUIRED',
            'This proposal materially expands the roadmap; acknowledge to accept',
          );
        }

        const baseItems = await db.query<RoadmapItemApplyRow[]>(
          `SELECT lineage_id, topic_id, skill_id, phase_no, phase_title, title,
                  priority::text AS priority, gap_type::text AS gap_type,
                  required_depth, estimated_effort_hours, sequence_no,
                  depends_on_lineage_ids, reason, retired, retired_at, sources
             FROM public.roadmap_items
            WHERE user_id = $1
              AND version_id = $2
            ORDER BY sequence_no ASC`,
          [normalizedUserId, baseVersion.id],
        );
        const mergeItems = await db.query<MergeItemApplyRow[]>(
          `SELECT sort_order, op::text AS op, lineage_id, topic_id, title,
                  priority::text AS priority, reason, payload
             FROM public.roadmap_merge_items
            WHERE user_id = $1
              AND merge_id = $2
            ORDER BY sort_order ASC`,
          [normalizedUserId, normalizedMergeId],
        );

        const newItems = applyMergeOperations(
          Array.isArray(baseItems) ? baseItems : [],
          Array.isArray(mergeItems) ? mergeItems : [],
        );

        const activeEdges = new Map<string, string[]>();
        for (const item of newItems) {
          if (!item.retired) {
            activeEdges.set(item.lineage_id, []);
          }
        }
        if (activeEdges.size === 0) {
          fail(
            409,
            'STALE_VERSION',
            'Merge would leave the roadmap without active topics',
          );
        }
        if (activeEdges.size > currentSoftLimit && !acknowledged) {
          fail(
            409,
            'MERGE_EXPANSION_ACK_REQUIRED',
            'This proposal materially expands the roadmap; acknowledge to accept',
          );
        }
        for (const item of newItems) {
          if (!item.retired) {
            activeEdges.set(
              item.lineage_id,
              item.depends_on_lineage_ids.filter((d) => activeEdges.has(d)),
            );
          }
        }
        assertMergeGraphAcyclic(activeEdges);

        // Close any prior undoable merge FIRST (uq_roadmap_merges_one_undoable).
        await db.query(
          `UPDATE public.roadmap_merges
              SET undo_window_closed_at = clock_timestamp()
            WHERE user_id = $1
              AND roadmap_id = $2
              AND id <> $3
              AND status = 'accepted'::public.merge_status
              AND undo_window_closed_at IS NULL`,
          [normalizedUserId, normalizedRoadmapId, normalizedMergeId],
        );

        const nextNoRows = await db.query<Array<{ next_no: number | string }>>(
          `SELECT COALESCE(MAX(version_no), 0)::int + 1 AS next_no
             FROM public.roadmap_versions
            WHERE user_id = $1
              AND roadmap_id = $2`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const nextVersionNo = Number(
          Array.isArray(nextNoRows) ? nextRowsValue(nextNoRows) : 1,
        );
        const effectiveLevel: CareerLevel =
          merge.origin === 'level_change' && merge.target_level
            ? merge.target_level
            : roadmap.target_level;

        const versionRaw = await db.query<unknown>(
          `INSERT INTO public.roadmap_versions (
             roadmap_id, user_id, version_no, state, created_by, target_level,
             base_version_id, merge_id, summary, phases, level_outline, warnings,
             stale, context_hash, locked_at
           )
           SELECT roadmap_id, user_id, $3,
                  'locked'::public.roadmap_version_state,
                  'merge'::public.roadmap_version_origin,
                  $4::public.career_level,
                  id, $5, summary, phases, level_outline, warnings,
                  false, context_hash, clock_timestamp()
             FROM public.roadmap_versions
            WHERE user_id = $1
              AND id = $2
           RETURNING id`,
          [
            normalizedUserId,
            baseVersion.id,
            nextVersionNo,
            effectiveLevel,
            normalizedMergeId,
          ],
        );
        const resultVersionId = extractReturningRows<{ id: string }>(
          versionRaw,
        )[0]?.id;
        if (!resultVersionId) {
          fail(
            500,
            'DATABASE_ERROR',
            'Failed to persist merged roadmap version',
          );
        }

        const ITEM_INSERT_BATCH_SIZE = 1_000;
        for (
          let offset = 0;
          offset < newItems.length;
          offset += ITEM_INSERT_BATCH_SIZE
        ) {
          const batch = newItems.slice(offset, offset + ITEM_INSERT_BATCH_SIZE);
          const valueTuples: string[] = [];
          const itemParams: unknown[] = [];
          for (const item of batch) {
            const baseIdx = itemParams.length;
            valueTuples.push(
              `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8}, $${baseIdx + 9}::public.item_priority, $${baseIdx + 10}::public.skill_gap_type, $${baseIdx + 11}, $${baseIdx + 12}, $${baseIdx + 13}, $${baseIdx + 14}::uuid[], $${baseIdx + 15}, $${baseIdx + 16}, $${baseIdx + 17}::timestamptz, $${baseIdx + 18}::jsonb)`,
            );
            itemParams.push(
              resultVersionId,
              normalizedUserId,
              item.lineage_id,
              item.topic_id,
              item.skill_id,
              item.phase_no,
              item.phase_title,
              item.title,
              item.priority,
              item.gap_type,
              item.required_depth,
              item.estimated_effort_hours,
              item.sequence_no,
              item.depends_on_lineage_ids,
              item.reason,
              item.retired,
              item.retired_at,
              JSON.stringify(item.sources),
            );
          }
          await db.query(
            `INSERT INTO public.roadmap_items (
               version_id, user_id, lineage_id, topic_id, skill_id, phase_no,
               phase_title, title, priority, gap_type, required_depth,
               estimated_effort_hours, sequence_no, depends_on_lineage_ids,
               reason, retired, retired_at, sources
             )
             VALUES ${valueTuples.join(', ')}`,
            itemParams,
          );
        }

        // Supersede prior current version (locked|restored -> superseded) and repoint.
        await db.query(
          `UPDATE public.roadmap_versions
              SET state = 'superseded'::public.roadmap_version_state
            WHERE user_id = $1
              AND id = $2
              AND state IN ('locked'::public.roadmap_version_state,
                            'restored'::public.roadmap_version_state)`,
          [normalizedUserId, baseVersion.id],
        );
        await db.query(
          `UPDATE public.roadmaps
              SET current_version_id = $3,
                  target_level = $4::public.career_level
            WHERE user_id = $1
              AND id = $2`,
          [
            normalizedUserId,
            normalizedRoadmapId,
            resultVersionId,
            effectiveLevel,
          ],
        );
        if (merge.origin === 'level_change' && merge.target_level) {
          // Only the goal level moves; skill_progress / learning_evidence are never copied or reset.
          await db.query(
            `UPDATE public.career_goals
                SET target_level = $3::public.career_level
              WHERE user_id = $1
                AND id = $2`,
            [normalizedUserId, roadmap.career_goal_id, merge.target_level],
          );
        }

        let dailyPlanImpact: MergeDailyPlanImpactDTO = {
          has_active_plan: false,
          completed_days_unchanged: 0,
          future_days_affected: 0,
        };
        let planSnapshot: DailyPlanUndoSnapshot | null = null;
        if (planId) {
          const reconciled = await this.getReconciler().reconcileForMergeInTx(
            db,
            {
              userId: normalizedUserId,
              planId: String(planId),
              mergeId: normalizedMergeId,
              resultVersionId,
              activeItems: newItems
                .filter((i) => !i.retired)
                .map((i) => ({
                  lineage_id: i.lineage_id,
                  topic_id: i.topic_id,
                  phase_no: i.phase_no,
                  sequence_no: i.sequence_no,
                  effort_hours: i.estimated_effort_hours,
                })),
            },
          );
          dailyPlanImpact = reconciled.dailyPlanImpact;
          planSnapshot = reconciled.undoSnapshot;
        }

        await db.query(
          `UPDATE public.roadmap_merges
              SET status = 'accepted'::public.merge_status,
                  result_version_id = $3,
                  accepted_at = clock_timestamp(),
                  undo_snapshot = $4::jsonb,
                  daily_plan_impact = $5::jsonb
            WHERE user_id = $1
              AND id = $2
              AND status = 'proposed'::public.merge_status`,
          [
            normalizedUserId,
            normalizedMergeId,
            resultVersionId,
            JSON.stringify({
              previous_version_id: String(baseVersion.id),
              previous_version_no: Number(baseVersion.version_no),
              previous_target_level: roadmap.target_level,
              daily_plan: planSnapshot,
            }),
            JSON.stringify(dailyPlanImpact),
          ],
        );

        return {
          roadmap_id: normalizedRoadmapId,
          merge_id: normalizedMergeId,
          new_version_no: nextVersionNo,
          undo_available: true as const,
          daily_plan_reconciled: planId !== undefined,
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-R13` (`POST /api/v1/roadmaps/:id/merges/undo`, `200`, `H-IDEM`, `Gate: none`).
   * Single transaction, lock order: `daily_plans -> roadmaps -> roadmap_merges -> daily_plan_items`.
   */
  async undoLastMerge(
    userId: string,
    roadmapId: string,
    options: { ifMatch?: number } = {},
  ): Promise<MergeUndoResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedRoadmapId = this.assertUuid(roadmapId, 'id', 'Roadmap id');

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const planRows = await db.query<CurrentPlanUndoState[]>(
          `SELECT id, plan_revision
             FROM public.daily_plans
            WHERE user_id = $1
              AND roadmap_id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const currentPlan =
          Array.isArray(planRows) && planRows[0]?.id ? planRows[0] : null;
        const planId = currentPlan?.id;

        const roadmapRows = await db.query<
          Array<{
            id: string;
            status: RoadmapStatus;
            career_goal_id: string;
            current_version_id: string | null;
          }>
        >(
          `SELECT id, status::text AS status, career_goal_id, current_version_id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }
        if (roadmap.status === 'archived') {
          fail(409, 'ROADMAP_ARCHIVED', 'Archived roadmaps cannot undo merges');
        }
        if (roadmap.status !== 'locked') {
          fail(
            409,
            'ROADMAP_NOT_LOCKED',
            'Only locked roadmaps can undo merges',
          );
        }

        if (options.ifMatch !== undefined) {
          const curVersionRows = roadmap.current_version_id
            ? await db.query<Array<{ version_no: number | string }>>(
                `SELECT version_no
                   FROM public.roadmap_versions
                  WHERE user_id = $1
                    AND id = $2`,
                [normalizedUserId, roadmap.current_version_id],
              )
            : [];
          const curVersionNo = Array.isArray(curVersionRows)
            ? curVersionRows[0]?.version_no
            : undefined;
          if (
            curVersionNo === undefined ||
            Number(curVersionNo) !== options.ifMatch
          ) {
            fail(
              409,
              'STALE_VERSION',
              'Roadmap version has changed; refresh before undoing the merge',
            );
          }
        }

        const mergeRows = await db.query<
          Array<{
            id: string;
            origin: MergeOrigin;
            base_version_id: string;
            result_version_id: string | null;
            undo_snapshot: unknown;
          }>
        >(
          `SELECT id,
                  origin::text AS origin,
                  base_version_id,
                  result_version_id,
                  undo_snapshot
             FROM public.roadmap_merges
            WHERE user_id = $1
              AND roadmap_id = $2
              AND status = 'accepted'::public.merge_status
              AND undo_window_closed_at IS NULL
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const merge = Array.isArray(mergeRows) ? mergeRows[0] : undefined;
        const unavailable = () =>
          fail(
            409,
            'UNDO_NOT_AVAILABLE',
            'No undoable merge: none accepted, or post-merge learning has started',
          );
        if (
          !merge ||
          !merge.result_version_id ||
          String(roadmap.current_version_id) !== String(merge.result_version_id)
        ) {
          unavailable();
        }
        const activeMerge = merge as NonNullable<typeof merge>;

        const startedRows = await db.query<Array<{ id: string }>>(
          `SELECT qa.id
             FROM public.quiz_attempts qa
             JOIN public.daily_plan_items dpi ON dpi.id = qa.daily_plan_item_id
            WHERE dpi.user_id = $1
              AND dpi.reconciled_by_merge_id = $2
              AND qa.status <> 'generated'::public.attempt_status
            LIMIT 1`,
          [normalizedUserId, activeMerge.id],
        );
        if (Array.isArray(startedRows) && startedRows.length > 0) {
          unavailable();
        }

        if (
          !isMergeUndoAvailable({
            roadmapStatus: roadmap.status,
            roadmapCurrentVersionId: roadmap.current_version_id,
            mergeStatus: 'accepted',
            resultVersionId: activeMerge.result_version_id,
            undoWindowClosedAt: null,
            undoSnapshot: activeMerge.undo_snapshot,
            currentPlan,
          })
        ) {
          unavailable();
        }

        const snapshot = (activeMerge.undo_snapshot ?? {}) as {
          previous_target_level?: CareerLevel;
          daily_plan?: DailyPlanUndoSnapshot | null;
        };
        if (planId) {
          await this.getReconciler().restoreFromUndoSnapshotInTx(db, {
            userId: normalizedUserId,
            mergeId: String(activeMerge.id),
            snapshot: snapshot.daily_plan as DailyPlanUndoSnapshot,
          });
        }

        const supersededRaw = await db.query<unknown>(
          `UPDATE public.roadmap_versions
              SET state = 'superseded'::public.roadmap_version_state
            WHERE user_id = $1
              AND id = $2
              AND state = 'locked'::public.roadmap_version_state
           RETURNING id`,
          [normalizedUserId, activeMerge.result_version_id],
        );
        const restoredRaw = await db.query<unknown>(
          `UPDATE public.roadmap_versions
              SET state = 'restored'::public.roadmap_version_state
            WHERE user_id = $1
              AND id = $2
              AND state = 'superseded'::public.roadmap_version_state
           RETURNING id, version_no`,
          [normalizedUserId, activeMerge.base_version_id],
        );
        const restored = extractReturningRows<{
          id: string;
          version_no: number | string;
        }>(restoredRaw)[0];
        if (
          extractReturningRows<{ id: string }>(supersededRaw).length === 0 ||
          !restored
        ) {
          unavailable();
        }

        // Supersede any open proposals anchored to the displaced merged version.
        await db.query(
          `UPDATE public.roadmap_merges
              SET status = 'superseded'::public.merge_status,
                  updated_at = clock_timestamp()
            WHERE user_id = $1
              AND roadmap_id = $2
              AND base_version_id = $3
              AND status = 'proposed'::public.merge_status`,
          [
            normalizedUserId,
            normalizedRoadmapId,
            activeMerge.result_version_id,
          ],
        );

        const previousLevel = snapshot.previous_target_level;
        await db.query(
          `UPDATE public.roadmaps
              SET current_version_id = $3,
                  target_level = COALESCE($4::public.career_level, target_level)
            WHERE user_id = $1
              AND id = $2`,
          [
            normalizedUserId,
            normalizedRoadmapId,
            activeMerge.base_version_id,
            activeMerge.origin === 'level_change'
              ? (previousLevel ?? null)
              : null,
          ],
        );
        if (activeMerge.origin === 'level_change' && previousLevel) {
          await db.query(
            `UPDATE public.career_goals
                SET target_level = $3::public.career_level
              WHERE user_id = $1
                AND id = $2`,
            [normalizedUserId, roadmap.career_goal_id, previousLevel],
          );
        }

        await db.query(
          `UPDATE public.roadmap_merges
              SET status = 'undone'::public.merge_status,
                  undone_at = clock_timestamp(),
                  undo_window_closed_at = clock_timestamp()
            WHERE user_id = $1
              AND id = $2
              AND status = 'accepted'::public.merge_status`,
          [normalizedUserId, activeMerge.id],
        );

        return {
          restored_version_no: Number(restored!.version_no),
          merge_id: String(activeMerge.id),
          status: 'undone' as const,
        };
      },
      true,
      true,
    );
  }
}

interface RoadmapItemApplyRow {
  lineage_id: string;
  topic_id: string;
  skill_id: string;
  phase_no: number | string;
  phase_title: string | null;
  title: string;
  priority: ItemPriority;
  gap_type: SkillGapType;
  required_depth: string | null;
  estimated_effort_hours: number | string | null;
  sequence_no: number | string;
  depends_on_lineage_ids: string[] | null;
  reason: string | null;
  retired: boolean;
  retired_at: Date | string | null;
  sources: unknown;
}

interface MergeItemApplyRow {
  sort_order: number | string;
  op: MergeOp;
  lineage_id: string | null;
  topic_id: string | null;
  title: string | null;
  priority: ItemPriority | null;
  reason: string | null;
  payload: unknown;
}

interface AppliedItem {
  lineage_id: string;
  topic_id: string;
  skill_id: string;
  phase_no: number;
  phase_title: string | null;
  title: string;
  priority: ItemPriority;
  gap_type: SkillGapType;
  required_depth: string | null;
  estimated_effort_hours: number | null;
  sequence_no: number;
  depends_on_lineage_ids: string[];
  reason: string | null;
  retired: boolean;
  retired_at: string | null;
  sources: unknown[];
}

function nextRowsValue(rowsIn: Array<{ next_no: number | string }>): number {
  return Number(rowsIn[0]?.next_no ?? 1);
}

function lowerUuidArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (v): v is string => typeof v === 'string' && UUID_PATTERN.test(v),
        )
        .map((v) => v.toLowerCase())
    : [];
}

/**
 * Applies ordered merge operations onto the base version's items (pure, deterministic).
 * Existing lineages keep their `lineage_id`; retired items stay retired; `retire_topic`
 * sets `retired = true`; `add_topic` appends after the highest `sequence_no`.
 */
export function applyMergeOperations(
  baseItems: readonly RoadmapItemApplyRow[],
  ops: readonly MergeItemApplyRow[],
): AppliedItem[] {
  const nowIso = new Date().toISOString();
  const items: AppliedItem[] = baseItems.map((b) => ({
    lineage_id: String(b.lineage_id).toLowerCase(),
    topic_id: String(b.topic_id).toLowerCase(),
    skill_id: String(b.skill_id).toLowerCase(),
    phase_no: Number(b.phase_no),
    phase_title: b.phase_title ?? null,
    title: String(b.title),
    priority: b.priority,
    gap_type: b.gap_type,
    required_depth: b.required_depth ?? null,
    estimated_effort_hours:
      b.estimated_effort_hours === null ||
      b.estimated_effort_hours === undefined
        ? null
        : Number(b.estimated_effort_hours),
    sequence_no: Number(b.sequence_no),
    depends_on_lineage_ids: lowerUuidArray(b.depends_on_lineage_ids),
    reason: b.reason ?? null,
    retired: Boolean(b.retired),
    retired_at: b.retired_at ? toIsoTimestamp(b.retired_at) : null,
    sources: Array.isArray(b.sources) ? b.sources : [],
  }));
  const byLineage = new Map(items.map((i) => [i.lineage_id, i]));
  const usedTopics = new Set(items.map((i) => i.topic_id));
  let nextSeq = items.reduce((m, i) => Math.max(m, i.sequence_no), 0);

  for (const op of ops) {
    const payload =
      op.payload && typeof op.payload === 'object' && !Array.isArray(op.payload)
        ? (op.payload as Record<string, unknown>)
        : {};
    if (op.op === 'add_topic') {
      const topicId = String(op.topic_id ?? '').toLowerCase();
      const rawLineage =
        typeof payload.provisional_lineage_id === 'string'
          ? payload.provisional_lineage_id.toLowerCase()
          : '';
      const skillId =
        typeof payload.skill_id === 'string'
          ? payload.skill_id.toLowerCase()
          : '';
      if (
        !UUID_PATTERN.test(topicId) ||
        !UUID_PATTERN.test(rawLineage) ||
        !UUID_PATTERN.test(skillId) ||
        usedTopics.has(topicId) ||
        byLineage.has(rawLineage)
      ) {
        fail(
          409,
          'STALE_VERSION',
          'Merge proposal no longer applies to the current roadmap',
        );
      }
      nextSeq += 1;
      const effort = Number(payload.estimated_effort_hours);
      const added: AppliedItem = {
        lineage_id: rawLineage,
        topic_id: topicId,
        skill_id: skillId,
        phase_no: Number(payload.phase_no) >= 1 ? Number(payload.phase_no) : 1,
        phase_title:
          typeof payload.phase_title === 'string' ? payload.phase_title : null,
        title: op.title ?? 'Untitled topic',
        priority: op.priority ?? 'supporting',
        gap_type: (typeof payload.gap_type === 'string'
          ? payload.gap_type
          : 'missing') as SkillGapType,
        required_depth:
          typeof payload.required_depth === 'string'
            ? payload.required_depth
            : null,
        estimated_effort_hours: Number.isFinite(effort) ? effort : null,
        sequence_no: nextSeq,
        depends_on_lineage_ids: lowerUuidArray(payload.depends_on_lineage_ids),
        reason: op.reason ?? null,
        retired: false,
        retired_at: null,
        sources: Array.isArray(payload.sources) ? payload.sources : [],
      };
      items.push(added);
      byLineage.set(added.lineage_id, added);
      usedTopics.add(topicId);
      continue;
    }

    const target = byLineage.get(String(op.lineage_id ?? '').toLowerCase());
    if (!target || target.retired) {
      fail(
        409,
        'STALE_VERSION',
        'Merge proposal no longer applies to the current roadmap',
      );
    }
    if (op.op === 'retire_topic') {
      target.retired = true;
      target.retired_at = nowIso;
      continue;
    }
    if (op.priority) {
      target.priority = op.priority;
    }
    if (op.op === 'reclassify' && typeof payload.gap_type === 'string') {
      target.gap_type = payload.gap_type as SkillGapType;
    }
    if (op.op === 'update_topic') {
      if (op.title) target.title = op.title;
      if (typeof payload.required_depth === 'string') {
        target.required_depth = payload.required_depth;
      }
      if (op.reason) target.reason = op.reason;
      const effort = Number(payload.estimated_effort_hours);
      if (
        payload.estimated_effort_hours !== undefined &&
        Number.isFinite(effort)
      ) {
        target.estimated_effort_hours = effort;
      }
      if (Array.isArray(payload.depends_on_lineage_ids)) {
        target.depends_on_lineage_ids = lowerUuidArray(
          payload.depends_on_lineage_ids,
        );
      }
      if (Array.isArray(payload.sources)) {
        target.sources = payload.sources;
      }
    }
  }
  return items;
}
