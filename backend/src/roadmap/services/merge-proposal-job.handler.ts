import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AIRequestDTO,
  MergeProposalOutput,
  UiLanguage,
} from '../../ai/ai.types.js';
import { AiGatewayService } from '../../ai/services/ai-gateway.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type { JobQueryExecutor } from '../../jobs/services/job-producer.service.js';
import type {
  ClaimedJobRow,
  JobCommitContext,
  JobExecutionResult,
  JobHandler,
} from '../../jobs/services/postgres-job-queue.consumer.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import {
  hasNulOrUnpairedSurrogate,
  ITEM_PRIORITY_VALUES,
  SKILL_GAP_TYPE_VALUES,
  type ItemPriority,
  type SkillGapType,
} from '../dto/roadmap.dto.js';
import {
  MERGE_OP_VALUES,
  MERGE_ORIGIN_VALUES,
  type MergeDailyPlanImpactDTO,
  type MergeOp,
  type MergeOrigin,
  type MergeSizeImpactDTO,
} from '../dto/roadmap-merge.dto.js';
import { buildValidTopicSlug } from './roadmap-job.handler.js';

export { buildValidTopicSlug };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);
const VALID_CAREER_LEVELS: ReadonlySet<string> = new Set([
  'junior',
  'mid',
  'senior',
]);

const DEFAULT_SOFT_SIZE_MAX_TOPICS = 45;
const R26_MIN_OPERATIONAL_LIMIT = 1;
const R26_MAX_OPERATIONAL_LIMIT = 10_000;
const MERGE_ENVELOPE_BYTE_BUDGET = 63_000;
const DEFAULT_ITEM_EFFORT_HOURS = 1.0;

export const SUPPORTED_MERGE_PROPOSAL_JOB_KINDS = ['merge_proposal'] as const;

export type SupportedMergeProposalJobKind =
  (typeof SUPPORTED_MERGE_PROPOSAL_JOB_KINDS)[number];

interface ParsedMergeJobPayload {
  kind: 'merge_proposal';
  roadmapId: string;
  baseVersionNo: number;
  origin: MergeOrigin;
  instruction?: string;
  targetLevel?: CareerLevel;
  sourceRef?: string;
}

interface BaseRoadmapItemRow {
  id: string;
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
  sources: unknown;
}

export interface NormalizedMergeOperation {
  sort_order: number;
  op: MergeOp;
  lineage_id: string | null;
  raw_topic_id: string | null;
  title: string | null;
  priority: ItemPriority | null;
  reason: string;
  payload: Record<string, unknown>;
}

interface NormalizedMergeOutput {
  reason: string;
  target_level: CareerLevel | null;
  operations: NormalizedMergeOperation[];
}

interface PersistedMergeOperation extends NormalizedMergeOperation {
  resolved_topic_id: string | null;
  resolved_skill_id: string | null;
  normalized_payload: Record<string, unknown>;
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

function unwrapDriverError(error: unknown): {
  code: string;
  constraint: string;
  message: string;
  detail: string;
} {
  if (!error || typeof error !== 'object') {
    return { code: '', constraint: '', message: '', detail: '' };
  }
  const obj = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    detail?: unknown;
    driverError?: {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      detail?: unknown;
    };
  };
  const driver = obj.driverError;
  return {
    code:
      typeof driver?.code === 'string'
        ? driver.code
        : typeof obj.code === 'string'
          ? obj.code
          : '',
    constraint:
      typeof driver?.constraint === 'string'
        ? driver.constraint
        : typeof obj.constraint === 'string'
          ? obj.constraint
          : '',
    message:
      typeof driver?.message === 'string'
        ? driver.message
        : typeof obj.message === 'string'
          ? obj.message
          : '',
    detail:
      typeof driver?.detail === 'string'
        ? driver.detail
        : typeof obj.detail === 'string'
          ? obj.detail
          : '',
  };
}

function parseNumericScalar(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return Number(value);
  }
  return Number.NaN;
}

export function buildMergeSizeImpact(
  before: number,
  after: number,
  softLimit: number,
): MergeSizeImpactDTO {
  const safeBefore = Math.max(0, Math.trunc(before));
  const safeAfter = Math.max(0, Math.trunc(after));
  const safeLimit = Math.max(1, Math.trunc(softLimit));
  const delta = safeAfter - safeBefore;
  const materiallyLarge = safeAfter > safeLimit;

  let warning: string | null = null;
  if (materiallyLarge) {
    warning =
      delta > 0
        ? `This proposal adds ${delta} topic${delta === 1 ? '' : 's'} (${safeAfter} active topics), exceeding the recommended soft limit of ${safeLimit}.`
        : `This roadmap would contain ${safeAfter} active topics, exceeding the recommended soft limit of ${safeLimit}.`;
  }

  return {
    active_topics_before: safeBefore,
    active_topics_after: safeAfter,
    before: safeBefore,
    after: safeAfter,
    delta,
    soft_limit: safeLimit,
    materially_large: materiallyLarge,
    warning,
  };
}

export function assertMergeGraphAcyclic(
  edgesByNode: ReadonlyMap<string, readonly string[]>,
): void {
  const state = new Map<string, 0 | 1 | 2>();

  const dfs = (node: string): void => {
    const current = state.get(node) ?? 0;
    if (current === 1) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Simulated post-merge roadmap contains a dependency cycle',
        undefined,
        true,
      );
    }
    if (current === 2) {
      return;
    }
    state.set(node, 1);
    const deps = edgesByNode.get(node) ?? [];
    for (const dep of deps) {
      dfs(dep);
    }
    state.set(node, 2);
  };

  for (const node of edgesByNode.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      dfs(node);
    }
  }
}

function parseMergeJobPayload(job: ClaimedJobRow): ParsedMergeJobPayload {
  const rawEnvelope = job.input_payload;
  if (!rawEnvelope || typeof rawEnvelope !== 'object') {
    fail(400, 'INVALID_JOB_PAYLOAD', 'Job input_payload is missing');
  }
  const args = (rawEnvelope as { args?: Record<string, unknown> }).args;
  const refs = (rawEnvelope as { expected_refs?: Record<string, unknown> })
    .expected_refs;
  if (!args || typeof args !== 'object' || !refs || typeof refs !== 'object') {
    fail(
      400,
      'INVALID_JOB_PAYLOAD',
      'Job envelope args or expected_refs missing',
    );
  }

  const roadmapId =
    typeof args.roadmap_id === 'string'
      ? args.roadmap_id.trim().toLowerCase()
      : '';
  const baseVersionNo = Number(args.base_version_no);
  const refVersionNo = Number(refs.base_version_no);
  const origin =
    typeof args.origin === 'string' ? args.origin.trim().toLowerCase() : '';

  if (
    !UUID_PATTERN.test(roadmapId) ||
    !Number.isInteger(baseVersionNo) ||
    baseVersionNo < 1 ||
    !Number.isInteger(refVersionNo) ||
    refVersionNo !== baseVersionNo ||
    !MERGE_ORIGIN_VALUES.includes(origin as MergeOrigin)
  ) {
    fail(400, 'INVALID_JOB_PAYLOAD', 'Invalid merge_proposal job payload');
  }

  const targetLevelRaw =
    typeof args.target_level === 'string'
      ? args.target_level.trim().toLowerCase()
      : undefined;
  if (
    targetLevelRaw !== undefined &&
    !VALID_CAREER_LEVELS.has(targetLevelRaw)
  ) {
    fail(400, 'INVALID_JOB_PAYLOAD', 'Invalid target_level in job payload');
  }
  if (origin === 'level_change' && !targetLevelRaw) {
    fail(
      400,
      'INVALID_JOB_PAYLOAD',
      'level_change merge_proposal requires target_level',
    );
  }

  const instruction =
    typeof args.instruction === 'string' && args.instruction.trim().length > 0
      ? args.instruction.trim()
      : undefined;
  if (origin === 'user_request' && !instruction) {
    fail(
      400,
      'INVALID_JOB_PAYLOAD',
      'user_request merge_proposal requires instruction',
    );
  }

  const sourceRef =
    typeof args.source_ref === 'string' && args.source_ref.trim().length > 0
      ? args.source_ref.trim()
      : undefined;

  return {
    kind: 'merge_proposal',
    roadmapId,
    baseVersionNo,
    origin: origin as MergeOrigin,
    instruction,
    targetLevel: targetLevelRaw as CareerLevel | undefined,
    sourceRef,
  };
}

function assertValidJsonStrings(value: unknown, depth = 0): void {
  if (depth > 32) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI merge proposal payload nesting depth exceeded',
      undefined,
      true,
    );
  }
  if (typeof value === 'string') {
    if (hasNulOrUnpairedSurrogate(value)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI merge proposal contains invalid control or surrogate characters',
        undefined,
        true,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertValidJsonStrings(item, depth + 1);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (hasNulOrUnpairedSurrogate(key)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'AI merge proposal contains invalid control or surrogate characters in key',
          undefined,
          true,
        );
      }
      assertValidJsonStrings(entry, depth + 1);
    }
  }
}

function resolveUnambiguousOperationsOrder(
  operations: readonly unknown[],
): Array<{ rawOp: Record<string, unknown>; resolvedOrder: number }> {
  const count = operations.length;
  const records: Record<string, unknown>[] = [];
  const explicitEntries: Array<{ idx: number; order: number }> = [];
  const omittedIndices: number[] = [];
  const seenExplicit = new Set<number>();

  for (let idx = 0; idx < count; idx += 1) {
    const rawOp = operations[idx];
    if (!rawOp || typeof rawOp !== 'object' || Array.isArray(rawOp)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Each merge operation must be an object',
        undefined,
        true,
      );
    }
    const rec = rawOp as Record<string, unknown>;
    records.push(rec);

    const rawOrder = rec.sort_order;
    if (rawOrder === undefined || rawOrder === null) {
      omittedIndices.push(idx);
      continue;
    }
    if (
      typeof rawOrder !== 'number' ||
      !Number.isInteger(rawOrder) ||
      rawOrder < 0
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Merge operation sort_order must be a non-negative integer',
        undefined,
        true,
      );
    }
    if (seenExplicit.has(rawOrder)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Merge proposal contains duplicate operation sort_order values',
        undefined,
        true,
      );
    }
    seenExplicit.add(rawOrder);
    explicitEntries.push({ idx, order: rawOrder });
  }

  const assigned = new Array<number>(count);
  const hasZero = seenExplicit.has(0);

  if (omittedIndices.length === 0) {
    for (const entry of explicitEntries) {
      assigned[entry.idx] = hasZero ? entry.order + 1 : entry.order;
    }
  } else if (explicitEntries.length === 0) {
    for (let idx = 0; idx < count; idx += 1) {
      assigned[idx] = idx + 1;
    }
  } else {
    const usedSlots = new Set<number>();
    for (const entry of explicitEntries) {
      const normalizedOrder = hasZero ? entry.order + 1 : entry.order;
      if (normalizedOrder < 1 || normalizedOrder > count) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Merge proposal operation sort_order sequence is ambiguous',
          undefined,
          true,
        );
      }
      assigned[entry.idx] = normalizedOrder;
      usedSlots.add(normalizedOrder);
    }
    const unusedSlots: number[] = [];
    for (let slot = 1; slot <= count; slot += 1) {
      if (!usedSlots.has(slot)) {
        unusedSlots.push(slot);
      }
    }
    if (unusedSlots.length !== omittedIndices.length) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Merge proposal operation sort_order sequence is ambiguous',
        undefined,
        true,
      );
    }
    for (let i = 0; i < omittedIndices.length; i += 1) {
      assigned[omittedIndices[i]] = unusedSlots[i];
    }
  }

  return records
    .map((rawOp, idx) => ({ rawOp, resolvedOrder: assigned[idx] }))
    .sort((a, b) => a.resolvedOrder - b.resolvedOrder);
}

function normalizeMergeProposalOutput(raw: unknown): NormalizedMergeOutput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI merge proposal output must be an object',
      undefined,
      true,
    );
  }
  assertValidJsonStrings(raw);
  const output = raw as Partial<MergeProposalOutput>;

  if (typeof output.reason !== 'string' || output.reason.trim().length === 0) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI merge proposal must include a non-empty reason',
      undefined,
      true,
    );
  }

  let targetLevel: CareerLevel | null = null;
  if (output.target_level !== null && output.target_level !== undefined) {
    if (
      typeof output.target_level !== 'string' ||
      !VALID_CAREER_LEVELS.has(output.target_level.trim().toLowerCase())
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI merge proposal target_level is invalid',
        undefined,
        true,
      );
    }
    targetLevel = output.target_level.trim().toLowerCase() as CareerLevel;
  }

  if (!Array.isArray(output.operations) || output.operations.length === 0) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI merge proposal must include at least one operation',
      undefined,
      true,
    );
  }

  const orderedOps = resolveUnambiguousOperationsOrder(output.operations);

  const normalizedOps: NormalizedMergeOperation[] = [];
  for (let i = 0; i < orderedOps.length; i += 1) {
    const rawOp = orderedOps[i].rawOp;

    const opKind =
      typeof rawOp.op === 'string' ? rawOp.op.trim().toLowerCase() : '';
    if (!MERGE_OP_VALUES.includes(opKind as MergeOp)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Invalid merge operation kind',
        undefined,
        true,
      );
    }

    const opReason =
      typeof rawOp.reason === 'string' ? rawOp.reason.trim() : '';
    if (!opReason) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Each merge operation requires a non-empty reason',
        undefined,
        true,
      );
    }

    let lineageId: string | null = null;
    if (rawOp.lineage_id !== null && rawOp.lineage_id !== undefined) {
      if (
        typeof rawOp.lineage_id !== 'string' ||
        !UUID_PATTERN.test(rawOp.lineage_id.trim())
      ) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Merge operation lineage_id must be a valid UUID',
          undefined,
          true,
        );
      }
      lineageId = rawOp.lineage_id.trim().toLowerCase();
    }

    let rawTopicId: string | null = null;
    if (rawOp.topic_id !== null && rawOp.topic_id !== undefined) {
      if (typeof rawOp.topic_id !== 'string') {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Merge operation topic_id must be a string when provided',
          undefined,
          true,
        );
      }
      const trimmedTopicId = rawOp.topic_id.trim();
      rawTopicId = trimmedTopicId.length > 0 ? trimmedTopicId : null;
    }

    const title =
      typeof rawOp.title === 'string' && rawOp.title.trim().length > 0
        ? rawOp.title.trim().slice(0, 240)
        : null;

    if (opKind === 'add_topic') {
      if (!rawTopicId) {
        if (!title) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'add_topic merge operation requires topic_id or title',
            undefined,
            true,
          );
        }
        rawTopicId = buildValidTopicSlug(title, String(i + 1));
      }
      lineageId = null;
    } else if (!lineageId) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        `${opKind} merge operation requires lineage_id`,
        undefined,
        true,
      );
    }

    let priority: ItemPriority | null = null;
    if (rawOp.priority !== null && rawOp.priority !== undefined) {
      if (typeof rawOp.priority !== 'string') {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Invalid merge operation priority',
          undefined,
          true,
        );
      }
      const normalizedPriority = rawOp.priority.trim().toLowerCase();
      if (normalizedPriority.length > 0) {
        if (
          !ITEM_PRIORITY_VALUES.includes(normalizedPriority as ItemPriority)
        ) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Invalid merge operation priority',
            undefined,
            true,
          );
        }
        priority = normalizedPriority as ItemPriority;
      }
    }

    let normalizedPayload: Record<string, unknown> = {};
    if (rawOp.payload !== undefined && rawOp.payload !== null) {
      if (typeof rawOp.payload !== 'object' || Array.isArray(rawOp.payload)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Merge operation payload must be a JSON object',
          undefined,
          true,
        );
      }
      normalizedPayload = { ...rawOp.payload };
    }

    normalizedOps.push({
      sort_order: i + 1,
      op: opKind as MergeOp,
      lineage_id: lineageId,
      raw_topic_id: rawTopicId,
      title,
      priority,
      reason: opReason.slice(0, 1_000),
      payload: normalizedPayload,
    });
  }

  return {
    reason: output.reason.trim().slice(0, 1_000),
    target_level: targetLevel,
    operations: normalizedOps,
  };
}

/**
 * Computes a read-only preview of Daily Plan reconciliation impact (`PRD` §21, `C05` §15.5)
 * without mutating `daily_plans` or `daily_plan_items`.
 */
export async function computeDailyPlanImpactPreviewInTx(
  db: JobQueryExecutor,
  userId: string,
  roadmapId: string,
  operations: ReadonlyArray<{
    op: MergeOp;
    lineage_id: string | null;
    payload?: Record<string, unknown>;
  }>,
): Promise<MergeDailyPlanImpactDTO> {
  const planRows = await db.query<
    Array<{ id: string; hours_per_day: number | string; status: string }>
  >(
    `SELECT id, hours_per_day, status::text AS status
       FROM public.daily_plans
      WHERE user_id = $1
        AND roadmap_id = $2
      LIMIT 1`,
    [userId, roadmapId],
  );
  const plan = Array.isArray(planRows) ? planRows[0] : undefined;
  if (!plan?.id) {
    return {
      has_active_plan: false,
      completed_days_unchanged: 0,
      future_days_affected: 0,
    };
  }

  const itemRows = await db.query<
    Array<{
      id: string;
      day_no: number | string;
      lineage_id: string;
      status: string;
    }>
  >(
    `SELECT id, day_no, lineage_id, status::text AS status
       FROM public.daily_plan_items
      WHERE user_id = $1
        AND plan_id = $2
      ORDER BY day_no ASC, sort_order ASC`,
    [userId, plan.id],
  );
  const items = Array.isArray(itemRows) ? itemRows : [];
  if (items.length === 0) {
    const addedCount = operations.filter((o) => o.op === 'add_topic').length;
    return {
      has_active_plan: true,
      completed_days_unchanged: 0,
      future_days_affected: addedCount > 0 ? 1 : 0,
    };
  }

  const itemIds = items.map((i) => String(i.id));
  const activeQuizItemIds = new Set<string>();

  const activeAttemptRows = await db.query<
    Array<{ daily_plan_item_id: string }>
  >(
    `SELECT DISTINCT daily_plan_item_id
       FROM public.quiz_attempts
      WHERE user_id = $1
        AND daily_plan_item_id = ANY($2::uuid[])
        AND status IN ('generated'::public.attempt_status, 'started'::public.attempt_status)`,
    [userId, itemIds],
  );
  for (const row of Array.isArray(activeAttemptRows) ? activeAttemptRows : []) {
    if (row.daily_plan_item_id) {
      activeQuizItemIds.add(String(row.daily_plan_item_id));
    }
  }

  const activeQuizJobRows = await db.query<
    Array<{ subject_id: string | null }>
  >(
    `SELECT DISTINCT subject_id
       FROM public.ai_requests
      WHERE user_id = $1
        AND is_async = true
        AND job_kind = 'quiz_generate'::public.job_kind
        AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
        AND subject_id = ANY($2::uuid[])`,
    [userId, itemIds],
  );
  for (const row of Array.isArray(activeQuizJobRows) ? activeQuizJobRows : []) {
    if (row.subject_id) {
      activeQuizItemIds.add(String(row.subject_id));
    }
  }

  const byDay = new Map<number, typeof items>();
  for (const item of items) {
    const dayNo = Number(item.day_no);
    const list = byDay.get(dayNo);
    if (list) {
      list.push(item);
    } else {
      byDay.set(dayNo, [item]);
    }
  }

  let completedDaysUnchanged = 0;
  let mutableFutureDayCount = 0;

  for (const [, dayItems] of byDay.entries()) {
    const allCompleted =
      dayItems.length > 0 && dayItems.every((i) => i.status === 'completed');
    if (allCompleted) {
      completedDaysUnchanged += 1;
      continue;
    }
    const isFrozen = dayItems.some(
      (i) =>
        i.status === 'completed' ||
        i.status === 'in_progress' ||
        activeQuizItemIds.has(String(i.id)),
    );
    if (!isFrozen) {
      mutableFutureDayCount += 1;
    }
  }

  const hoursPerDay = Math.max(0.5, Number(plan.hours_per_day) || 1);
  const addedOps = operations.filter((o) => o.op === 'add_topic');
  let estimatedAddedDays = 0;
  if (addedOps.length > 0) {
    let addedHours = 0;
    for (const op of addedOps) {
      const parsedEffort = parseNumericScalar(
        op.payload?.estimated_effort_hours,
      );
      addedHours +=
        Number.isFinite(parsedEffort) && parsedEffort > 0
          ? parsedEffort
          : DEFAULT_ITEM_EFFORT_HOURS;
    }
    estimatedAddedDays = Math.max(1, Math.ceil(addedHours / hoursPerDay));
  }

  const futureDaysAffected =
    mutableFutureDayCount > 0
      ? mutableFutureDayCount +
        (addedOps.length > 0 ? Math.max(0, estimatedAddedDays - 1) : 0)
      : estimatedAddedDays;

  return {
    has_active_plan: true,
    completed_days_unchanged: completedDaysUnchanged,
    future_days_affected: Math.max(0, futureDaysAffected),
  };
}

/**
 * Durable async job handler (`merge_proposal`) invoked by `PostgresJobQueueConsumer`.
 *
 * Guarantees (`PRD` §18, §20–§21, `R12`, `R13`, `C05` §14.5):
 * - Runs `AiGatewayService.execute` strictly outside DB transactions (`persistTelemetry: false`).
 * - Validates every proposed operation against the locked base version (`lineage_id` active,
 *   canonical `public.topics` row resolved/created for `add_topic`, simulated post-merge graph
 *   non-empty and DAG-acyclic).
 * - Computes `size_before`, `size_after`, `materially_large`, and `daily_plan_impact` server-side.
 * - Never mutates `roadmap_versions`, `roadmap_items`, `daily_plans`, or `daily_plan_items`.
 */
@Injectable()
export class MergeProposalJobHandler implements JobHandler {
  readonly supportedKinds = SUPPORTED_MERGE_PROPOSAL_JOB_KINDS;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
  ) {}

  canHandle(jobKind: string): jobKind is SupportedMergeProposalJobKind {
    return (SUPPORTED_MERGE_PROPOSAL_JOB_KINDS as readonly string[]).includes(
      jobKind,
    );
  }

  private async readBoundedConfigInteger(
    db: JobQueryExecutor,
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

  private async verifyMergeRefsInTx(
    tx: JobQueryExecutor,
    userId: string,
    parsed: ParsedMergeJobPayload,
  ): Promise<{ ok: boolean; reason?: string }> {
    const roadmapRows = await tx.query<
      Array<{
        id: string;
        status: string;
        current_version_id: string | null;
        target_level: CareerLevel;
      }>
    >(
      `SELECT id,
              status::text AS status,
              current_version_id,
              target_level::text AS target_level
         FROM public.roadmaps
        WHERE user_id = $1
          AND id = $2`,
      [userId, parsed.roadmapId],
    );
    const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
    if (
      !roadmap ||
      roadmap.status !== 'locked' ||
      !roadmap.current_version_id
    ) {
      return { ok: false, reason: 'ROADMAP_NOT_LOCKED' };
    }

    if (
      parsed.origin === 'level_change' &&
      parsed.targetLevel === roadmap.target_level
    ) {
      return { ok: false, reason: 'LEVEL_UNCHANGED' };
    }

    const versionRows = await tx.query<
      Array<{ id: string; version_no: number | string }>
    >(
      `SELECT id, version_no
         FROM public.roadmap_versions
        WHERE user_id = $1
          AND id = $2`,
      [userId, roadmap.current_version_id],
    );
    const currentVersion = Array.isArray(versionRows)
      ? versionRows[0]
      : undefined;
    if (
      !currentVersion ||
      Number(currentVersion.version_no) !== parsed.baseVersionNo
    ) {
      return { ok: false, reason: 'BASE_VERSION_DRIFT' };
    }

    const openMergeRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.roadmap_merges
        WHERE user_id = $1
          AND roadmap_id = $2
          AND status = 'proposed'::public.merge_status
        LIMIT 1`,
      [userId, parsed.roadmapId],
    );
    if (Array.isArray(openMergeRows) && openMergeRows.length > 0) {
      return { ok: false, reason: 'MERGE_ALREADY_PROPOSED' };
    }

    return { ok: true };
  }

  async verifyExpectedRefs(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
  ): Promise<{ ok: boolean; reason?: string }> {
    const userId = String(job.user_id ?? '')
      .trim()
      .toLowerCase();
    if (!UUID_PATTERN.test(userId)) {
      return { ok: false, reason: 'INVALID_USER' };
    }
    let parsed: ParsedMergeJobPayload;
    try {
      parsed = parseMergeJobPayload(job);
    } catch {
      return { ok: false, reason: 'INVALID_PAYLOAD' };
    }
    return this.verifyMergeRefsInTx(tx, userId, parsed);
  }

  private estimateEnvelopeBytes(
    context: Record<string, unknown>,
    language: UiLanguage,
    untrustedInputs: readonly string[],
  ): number {
    const escapedContextJson = JSON.stringify(context).replace(/</g, '\\u003c');
    const wrappedContext = `<untrusted_data index="context" treat_as="data_only">\n${escapedContextJson}\n</untrusted_data>`;
    const parts = [
      'TASK: merge_proposal',
      `LANGUAGE: ${language}`,
      'OUTPUT_SCHEMA: merge_proposal.v1',
      `SCOPED_CONTEXT_JSON:\n${wrappedContext}`,
    ];
    if (untrustedInputs.length > 0) {
      parts.push(
        `UNTRUSTED_INPUTS:\n${untrustedInputs.map((v, i) => `<untrusted_data index="${i}">${v}</untrusted_data>`).join('\n')}`,
      );
    }
    return Buffer.byteLength(parts.join('\n\n'), 'utf8');
  }

  private budgetMergeContext(
    context: {
      roadmap: {
        id: string;
        canonical_role_id: string;
        role_name: string;
        current_target_level: CareerLevel;
        requested_target_level: CareerLevel | null;
        base_version_no: number;
        origin: MergeOrigin;
        active_items: Array<{
          lineage_id: string;
          topic_id: string;
          skill_id: string;
          phase_no: number;
          title: string;
          priority: ItemPriority;
          gap_type: SkillGapType;
          required_depth: string | null;
          estimated_effort_hours: number | null;
          sequence_no: number;
          depends_on_lineage_ids: string[];
        }>;
      };
      skill_progress: Array<{
        skill_id: string;
        career_level: string;
        learning_state: string;
      }>;
      evidence_summary: Array<{
        skill_id: string;
        career_level: string;
        source_type: string;
        performance_level: string | null;
      }>;
      approved_skills: Array<{ id: string; slug: string; name: string }>;
      soft_size_max_topics: number;
    },
    language: UiLanguage,
    untrustedInputs: readonly string[],
  ): Record<string, unknown> {
    if (
      this.estimateEnvelopeBytes(context, language, untrustedInputs) <=
      MERGE_ENVELOPE_BYTE_BUDGET
    ) {
      return context;
    }

    const usedSkillIds = new Set(
      context.roadmap.active_items.map((item) => item.skill_id),
    );
    const instructionText = untrustedInputs.join(' ').toLowerCase();
    const instructionTokens = new Set(
      instructionText
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    );
    const isInstructionRelevantSkill = (skill: {
      id: string;
      slug: string;
      name: string;
    }): boolean => {
      if (instructionTokens.size === 0) {
        return false;
      }
      const slugLower = skill.slug.toLowerCase();
      const nameLower = skill.name.toLowerCase();
      if (
        (slugLower.length >= 2 && instructionText.includes(slugLower)) ||
        (nameLower.length >= 2 && instructionText.includes(nameLower))
      ) {
        return true;
      }
      const skillTokens = `${slugLower} ${nameLower}`
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 2);
      return skillTokens.some((t) => instructionTokens.has(t));
    };

    const prioritizedSkills = context.approved_skills.filter(
      (s) => usedSkillIds.has(s.id) || isInstructionRelevantSkill(s),
    );
    let nextContext: Record<string, unknown> = {
      ...context,
      approved_skills: prioritizedSkills,
    };
    if (
      this.estimateEnvelopeBytes(nextContext, language, untrustedInputs) <=
      MERGE_ENVELOPE_BYTE_BUDGET
    ) {
      return nextContext;
    }

    nextContext = {
      ...nextContext,
      evidence_summary: context.evidence_summary.slice(0, 30),
      roadmap: {
        ...context.roadmap,
        active_items: context.roadmap.active_items.map((item) => ({
          ...item,
          required_depth: null,
        })),
      },
    };
    if (
      this.estimateEnvelopeBytes(nextContext, language, untrustedInputs) <=
      MERGE_ENVELOPE_BYTE_BUDGET
    ) {
      return nextContext;
    }

    const usedSkills = prioritizedSkills.filter((s) => usedSkillIds.has(s.id));
    const instructionOnlySkills = prioritizedSkills
      .filter((s) => !usedSkillIds.has(s.id))
      .slice(0, 30);
    return {
      ...nextContext,
      approved_skills: [...usedSkills, ...instructionOnlySkills],
    };
  }

  /**
   * Loads PII-free locked roadmap + skill/evidence grounding in a read transaction,
   * then invokes `AiGatewayService.execute` strictly outside any DB transaction.
   */
  async execute(
    job: ClaimedJobRow,
    signal: AbortSignal,
  ): Promise<JobExecutionResult> {
    if (signal.aborted) {
      fail(
        504,
        'AI_TIMEOUT',
        'AI merge proposal generation timed out. Please try again.',
        undefined,
        true,
      );
    }

    const userId = String(job.user_id ?? '')
      .trim()
      .toLowerCase();
    if (!UUID_PATTERN.test(userId)) {
      fail(401, 'AUTH_REQUIRED', 'Valid user_id is required on job');
    }
    const parsed = parseMergeJobPayload(job);
    const language: UiLanguage =
      typeof job.language === 'string' && VALID_LANGUAGES.has(job.language)
        ? (job.language as UiLanguage)
        : 'en';

    const prepared = await this.database.transaction(
      userId,
      async (db) => {
        const accessRows = await db.query<Array<{ enabled?: boolean }>>(
          "SELECT private.effective_feature_access($1, 'roadmap_generator') AS enabled",
          [userId],
        );
        if (!accessRows?.[0]?.enabled) {
          fail(
            403,
            'FEATURE_DISABLED',
            'Feature is disabled for this account.',
            undefined,
            false,
          );
        }

        const refCheck = await this.verifyMergeRefsInTx(db, userId, parsed);
        if (!refCheck.ok) {
          fail(
            409,
            'STALE_JOB_INPUT',
            'Source roadmap changed before merge proposal ran. Please refresh and try again.',
            undefined,
            false,
          );
        }

        const softMaxTopics = await this.readBoundedConfigInteger(
          db,
          'roadmap.soft_size_max_topics',
          DEFAULT_SOFT_SIZE_MAX_TOPICS,
        );

        const roadmapRows = await db.query<
          Array<{
            id: string;
            canonical_role_id: string;
            role_name: string;
            target_level: CareerLevel;
            current_version_id: string;
          }>
        >(
          `SELECT r.id,
                  r.canonical_role_id,
                  cr.name AS role_name,
                  r.target_level::text AS target_level,
                  r.current_version_id
             FROM public.roadmaps r
             JOIN public.career_roles cr ON cr.id = r.canonical_role_id
            WHERE r.user_id = $1
              AND r.id = $2`,
          [userId, parsed.roadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap?.current_version_id) {
          fail(
            409,
            'STALE_JOB_INPUT',
            'Locked roadmap version is no longer available.',
            undefined,
            false,
          );
        }

        const itemRows = await db.query<BaseRoadmapItemRow[]>(
          `SELECT id,
                  lineage_id,
                  topic_id,
                  skill_id,
                  phase_no,
                  phase_title,
                  title,
                  priority::text AS priority,
                  gap_type::text AS gap_type,
                  required_depth,
                  estimated_effort_hours,
                  sequence_no,
                  depends_on_lineage_ids,
                  reason,
                  retired,
                  sources
             FROM public.roadmap_items
            WHERE user_id = $1
              AND version_id = $2
              AND retired = false
            ORDER BY sequence_no ASC`,
          [userId, roadmap.current_version_id],
        );

        const skillProgressRows = await db.query<
          Array<{
            skill_id: string;
            career_level: string;
            learning_state: string;
          }>
        >(
          `SELECT skill_id,
                  career_level::text AS career_level,
                  learning_state::text AS learning_state
             FROM public.skill_progress
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT 200`,
          [userId],
        );

        const evidenceRows = await db.query<
          Array<{
            skill_id: string;
            career_level: string;
            source_type: string;
            performance_level: string | null;
          }>
        >(
          `SELECT skill_id,
                  career_level::text AS career_level,
                  source_type::text AS source_type,
                  performance_level::text AS performance_level
             FROM public.learning_evidence
            WHERE user_id = $1
            ORDER BY occurred_at DESC
            LIMIT 100`,
          [userId],
        );

        const approvedSkillRows = await db.query<
          Array<{ id: string; slug: string; canonical_name: string }>
        >(
          `SELECT id, slug, canonical_name
             FROM public.skills
            WHERE status = 'approved'::public.content_status
              AND deleted_at IS NULL
            ORDER BY canonical_name ASC
            LIMIT 500`,
        );

        return {
          roadmap,
          softMaxTopics,
          activeItems: (Array.isArray(itemRows) ? itemRows : []).map((row) => ({
            lineage_id: String(row.lineage_id).toLowerCase(),
            topic_id: String(row.topic_id).toLowerCase(),
            skill_id: String(row.skill_id).toLowerCase(),
            phase_no: Number(row.phase_no),
            title: String(row.title),
            priority: row.priority,
            gap_type: row.gap_type,
            required_depth: row.required_depth ?? null,
            estimated_effort_hours:
              row.estimated_effort_hours !== null &&
              row.estimated_effort_hours !== undefined
                ? Number(row.estimated_effort_hours)
                : null,
            sequence_no: Number(row.sequence_no),
            depends_on_lineage_ids: Array.isArray(row.depends_on_lineage_ids)
              ? row.depends_on_lineage_ids.map((id) => String(id).toLowerCase())
              : [],
          })),
          skillProgress: (Array.isArray(skillProgressRows)
            ? skillProgressRows
            : []
          ).map((row) => ({
            skill_id: String(row.skill_id).toLowerCase(),
            career_level: String(row.career_level),
            learning_state: String(row.learning_state),
          })),
          evidenceSummary: (Array.isArray(evidenceRows)
            ? evidenceRows
            : []
          ).map((row) => ({
            skill_id: String(row.skill_id).toLowerCase(),
            career_level: String(row.career_level),
            source_type: String(row.source_type),
            performance_level: row.performance_level ?? null,
          })),
          approvedSkills: (Array.isArray(approvedSkillRows)
            ? approvedSkillRows
            : []
          ).map((s) => ({
            id: String(s.id).toLowerCase(),
            slug: String(s.slug),
            name: String(s.canonical_name),
          })),
        };
      },
      true,
      false,
    );

    const untrustedInputs: string[] = [];
    if (parsed.instruction) {
      untrustedInputs.push(parsed.instruction);
    }

    const context = this.budgetMergeContext(
      {
        roadmap: {
          id: String(prepared.roadmap.id),
          canonical_role_id: String(prepared.roadmap.canonical_role_id),
          role_name: String(prepared.roadmap.role_name),
          current_target_level: prepared.roadmap.target_level,
          requested_target_level: parsed.targetLevel ?? null,
          base_version_no: parsed.baseVersionNo,
          origin: parsed.origin,
          active_items: prepared.activeItems,
        },
        skill_progress: prepared.skillProgress,
        evidence_summary: prepared.evidenceSummary,
        approved_skills: prepared.approvedSkills,
        soft_size_max_topics: prepared.softMaxTopics,
      },
      language,
      untrustedInputs,
    );

    const requestDto: AIRequestDTO = {
      request_id: job.id,
      task: 'merge_proposal',
      user_id: userId,
      feature_key: 'roadmap_generator',
      context,
      untrusted_inputs: untrustedInputs,
      output_schema: 'merge_proposal.v1',
      language,
      idempotency_key: job.idempotency_key ?? job.id,
      budget: {
        max_input_units: 16_000,
        max_output_units: 8_000,
        timeout_ms: 90_000,
      },
    };

    const aiResponse = await this.aiGateway.execute(requestDto, {
      persistTelemetry: false,
      signal,
    });

    normalizeMergeProposalOutput(aiResponse.output);

    return {
      resultType: 'roadmap_merge',
      resultId: parsed.roadmapId,
      providerKey: aiResponse.provider_id,
      modelId: aiResponse.model_id,
      promptVersionId: aiResponse.prompt_version_id,
      outputSchemaId: 'merge_proposal.v1',
      fallbackUsed: aiResponse.fallback_used,
      language,
      inputUnits: aiResponse.usage_units.input,
      outputUnits: aiResponse.usage_units.output,
      latencyMs: aiResponse.latency_ms,
      output: aiResponse.output,
    };
  }

  private async resolveOrProvisionAddTopicInTx(
    tx: JobQueryExecutor,
    op: NormalizedMergeOperation,
    effectiveLevel: CareerLevel,
    fallbackSkillId: string,
    usedTopicIds: Set<string>,
  ): Promise<{ topicId: string; skillId: string; title: string }> {
    const rawTopicId = op.raw_topic_id ?? '';
    const rawSkillField = op.payload.skill_id;
    let suppliedSkillId: string | null = null;
    if (
      rawSkillField !== undefined &&
      rawSkillField !== null &&
      !(typeof rawSkillField === 'string' && rawSkillField.trim() === '')
    ) {
      if (
        typeof rawSkillField !== 'string' ||
        !UUID_PATTERN.test(rawSkillField.trim())
      ) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'add_topic payload.skill_id must be a valid UUID',
          undefined,
          true,
        );
      }
      suppliedSkillId = rawSkillField.trim().toLowerCase();
    }

    // 1. Check direct existing topic_id UUID reference
    let referencedTopicSkillId: string | null = null;
    if (UUID_PATTERN.test(rawTopicId)) {
      const existingRows = await tx.query<
        Array<{
          id: string;
          skill_id: string;
          title: string;
          career_level?: string;
        }>
      >(
        `SELECT id, skill_id, title, career_level::text AS career_level
           FROM public.topics
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1`,
        [rawTopicId.toLowerCase()],
      );
      const existing = Array.isArray(existingRows)
        ? existingRows[0]
        : undefined;
      if (existing) {
        const existingId = String(existing.id).toLowerCase();
        if (usedTopicIds.has(existingId)) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Merge proposal attempts to add a topic that is already active in the roadmap',
            undefined,
            true,
          );
        }
        if (
          !existing.career_level ||
          existing.career_level === effectiveLevel
        ) {
          usedTopicIds.add(existingId);
          return {
            topicId: existingId,
            skillId: String(existing.skill_id).toLowerCase(),
            title: op.title ?? String(existing.title),
          };
        }
        if (existing.skill_id) {
          referencedTopicSkillId = String(existing.skill_id).toLowerCase();
        }
      }
    }

    // 2. Resolve and verify approved skill_id (supplied UUID, referenced topic's skill, or fallback active skill)
    const candidateSkillId =
      suppliedSkillId ?? referencedTopicSkillId ?? fallbackSkillId;
    const skillRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.skills
        WHERE id = $1
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        LIMIT 1`,
      [candidateSkillId],
    );
    if (!Array.isArray(skillRows) || !skillRows[0]?.id) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'add_topic merge operation references an unknown or unapproved skill_id',
        undefined,
        true,
      );
    }
    const resolvedSkillId = String(skillRows[0].id).toLowerCase();

    // 3. If a non-UUID topic_id slug was supplied, look up that canonical slug first
    const suppliedSlug =
      rawTopicId && !UUID_PATTERN.test(rawTopicId)
        ? buildValidTopicSlug(rawTopicId)
        : null;
    if (suppliedSlug) {
      const bySuppliedSlugRows = await tx.query<
        Array<{ id: string; title?: string }>
      >(
        `SELECT id, title
           FROM public.topics
          WHERE skill_id = $1
            AND slug = $2
            AND career_level = $3::public.career_level
            AND deleted_at IS NULL
          ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, content_version DESC
          LIMIT 1`,
        [resolvedSkillId, suppliedSlug, effectiveLevel],
      );
      const foundBySupplied = Array.isArray(bySuppliedSlugRows)
        ? bySuppliedSlugRows[0]
        : undefined;
      if (foundBySupplied?.id) {
        const foundId = String(foundBySupplied.id).toLowerCase();
        if (usedTopicIds.has(foundId)) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Merge proposal attempts to add a topic that is already active in the roadmap',
            undefined,
            true,
          );
        }
        usedTopicIds.add(foundId);
        return {
          topicId: foundId,
          skillId: resolvedSkillId,
          title: op.title ?? String(foundBySupplied.title ?? suppliedSlug),
        };
      }
    }

    const title = op.title ?? '';
    if (!title) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'add_topic merge operation requires a topic title when topic_id does not exist',
        undefined,
        true,
      );
    }

    let slug = buildValidTopicSlug(title);
    let topicId: string | undefined;
    if (slug !== suppliedSlug) {
      const bySlugRows = await tx.query<Array<{ id: string }>>(
        `SELECT id
           FROM public.topics
          WHERE skill_id = $1
            AND slug = $2
            AND career_level = $3::public.career_level
            AND deleted_at IS NULL
          ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, content_version DESC
          LIMIT 1`,
        [resolvedSkillId, slug, effectiveLevel],
      );
      topicId =
        Array.isArray(bySlugRows) && bySlugRows[0]?.id
          ? String(bySlugRows[0].id).toLowerCase()
          : undefined;
    }

    if (topicId && usedTopicIds.has(topicId)) {
      slug = buildValidTopicSlug(title, `${op.sort_order}:${rawTopicId}`);
      topicId = undefined;
    }

    if (!topicId) {
      const insertedRaw = await tx.query<unknown>(
        `INSERT INTO public.topics (
           skill_id,
           slug,
           title,
           career_level,
           content_version,
           status
         )
         VALUES ($1, $2, $3, $4::public.career_level, 1, 'draft'::public.content_status)
         ON CONFLICT (skill_id, slug, career_level, content_version) DO NOTHING
         RETURNING id`,
        [resolvedSkillId, slug, title, effectiveLevel],
      );
      const inserted = extractReturningRows<{ id: string }>(insertedRaw)[0];
      topicId = inserted?.id ? String(inserted.id).toLowerCase() : undefined;

      if (!topicId) {
        const fallbackRows = await tx.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.topics
            WHERE skill_id = $1
              AND slug = $2
              AND career_level = $3::public.career_level
              AND content_version = 1
              AND deleted_at IS NULL
            LIMIT 1`,
          [resolvedSkillId, slug, effectiveLevel],
        );
        topicId =
          Array.isArray(fallbackRows) && fallbackRows[0]?.id
            ? String(fallbackRows[0].id).toLowerCase()
            : undefined;
      }
    }

    if (!topicId || usedTopicIds.has(topicId)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Unable to resolve distinct canonical topic for add_topic merge operation',
        undefined,
        true,
      );
    }

    usedTopicIds.add(topicId);
    return { topicId, skillId: resolvedSkillId, title };
  }

  /**
   * Validates all operations against the locked base version, verifies post-merge DAG acyclicity
   * and non-empty active path, computes server-side size/plan impact, and atomically inserts
   * `roadmap_merges` + append-only `roadmap_merge_items` inside `PostgresJobQueueConsumer`'s tx.
   */
  async persistArtifact(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    result: JobExecutionResult,
    context?: JobCommitContext,
  ): Promise<{ resultType: 'roadmap_merge'; resultId: string }> {
    const userId = String(job.user_id ?? '')
      .trim()
      .toLowerCase();
    if (!UUID_PATTERN.test(userId)) {
      fail(401, 'AUTH_REQUIRED', 'Valid user_id is required');
    }

    // Match consumer commit gate's `users FOR SHARE` lock mode to prevent lock-upgrade deadlocks.
    const userRows = await tx.query<Array<{ status: string }>>(
      `SELECT status::text AS status
         FROM public.users
        WHERE id = $1
        FOR SHARE`,
      [userId],
    );
    const owner = Array.isArray(userRows) ? userRows[0] : undefined;
    if (!owner || owner.status !== 'active') {
      fail(
        403,
        'ACCOUNT_SUSPENDED',
        'Account is not active for job completion.',
        undefined,
        false,
      );
    }

    const parsed = parseMergeJobPayload(job);
    const normalized = normalizeMergeProposalOutput(result.output);

    const roadmapRows = await tx.query<
      Array<{
        id: string;
        status: string;
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
      [userId, parsed.roadmapId],
    );
    const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
    if (
      !roadmap ||
      roadmap.status !== 'locked' ||
      !roadmap.current_version_id
    ) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source roadmap is no longer locked. Please refresh and try again.',
        undefined,
        false,
      );
    }

    const versionRows = await tx.query<
      Array<{ id: string; version_no: number | string }>
    >(
      `SELECT id, version_no
         FROM public.roadmap_versions
        WHERE user_id = $1
          AND id = $2`,
      [userId, roadmap.current_version_id],
    );
    const baseVersion = Array.isArray(versionRows) ? versionRows[0] : undefined;
    if (
      !baseVersion ||
      Number(baseVersion.version_no) !== parsed.baseVersionNo
    ) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Roadmap version changed before merge proposal committed. Please refresh and try again.',
        undefined,
        false,
      );
    }

    const openMergeRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.roadmap_merges
        WHERE user_id = $1
          AND roadmap_id = $2
          AND status = 'proposed'::public.merge_status
        LIMIT 1`,
      [userId, parsed.roadmapId],
    );
    if (Array.isArray(openMergeRows) && openMergeRows.length > 0) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'An open merge proposal already exists for this roadmap.',
        undefined,
        false,
      );
    }

    const baseItemsRaw = await tx.query<BaseRoadmapItemRow[]>(
      `SELECT id,
              lineage_id,
              topic_id,
              skill_id,
              phase_no,
              phase_title,
              title,
              priority::text AS priority,
              gap_type::text AS gap_type,
              required_depth,
              estimated_effort_hours,
              sequence_no,
              depends_on_lineage_ids,
              reason,
              retired,
              sources
         FROM public.roadmap_items
        WHERE user_id = $1
          AND version_id = $2
        ORDER BY sequence_no ASC`,
      [userId, baseVersion.id],
    );
    const baseItems = Array.isArray(baseItemsRaw) ? baseItemsRaw : [];

    const activeBaseByLineage = new Map<string, BaseRoadmapItemRow>();
    const allBaseByLineage = new Map<string, BaseRoadmapItemRow>();
    const usedTopicIds = new Set<string>();
    let fallbackSkillId: string | null = null;

    for (const item of baseItems) {
      const lid = String(item.lineage_id).toLowerCase();
      allBaseByLineage.set(lid, item);
      if (!item.retired) {
        activeBaseByLineage.set(lid, item);
        usedTopicIds.add(String(item.topic_id).toLowerCase());
        if (!fallbackSkillId) {
          fallbackSkillId = String(item.skill_id).toLowerCase();
        }
      }
    }

    if (activeBaseByLineage.size === 0 || !fallbackSkillId) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Base locked roadmap has no active topics to merge against.',
        undefined,
        false,
      );
    }

    const effectiveTargetLevel: CareerLevel =
      parsed.origin === 'level_change'
        ? (parsed.targetLevel ?? roadmap.target_level)
        : roadmap.target_level;
    const persistedTargetLevel: CareerLevel | null =
      parsed.origin === 'level_change' ? (parsed.targetLevel ?? null) : null;

    // Simulate post-merge active graph for strict validation prior to any DB insert
    const simulatedNodes = new Map<
      string,
      {
        retired: boolean;
        depends_on: string[];
      }
    >();
    for (const [lid, item] of activeBaseByLineage.entries()) {
      simulatedNodes.set(lid, {
        retired: false,
        depends_on: Array.isArray(item.depends_on_lineage_ids)
          ? item.depends_on_lineage_ids.map((d) => String(d).toLowerCase())
          : [],
      });
    }

    const persistedOps: PersistedMergeOperation[] = [];

    for (const op of normalized.operations) {
      if (op.op === 'add_topic') {
        const resolved = await this.resolveOrProvisionAddTopicInTx(
          tx,
          op,
          effectiveTargetLevel,
          fallbackSkillId,
          usedTopicIds,
        );

        const provisionalLineageId =
          typeof op.payload.provisional_lineage_id === 'string' &&
          UUID_PATTERN.test(op.payload.provisional_lineage_id.trim()) &&
          !allBaseByLineage.has(
            op.payload.provisional_lineage_id.trim().toLowerCase(),
          ) &&
          !simulatedNodes.has(
            op.payload.provisional_lineage_id.trim().toLowerCase(),
          )
            ? op.payload.provisional_lineage_id.trim().toLowerCase()
            : randomUUID();

        const rawDeps = Array.isArray(op.payload.depends_on_lineage_ids)
          ? op.payload.depends_on_lineage_ids
          : [];
        const normalizedDeps: string[] = [];
        for (const dep of rawDeps) {
          if (typeof dep !== 'string' || !UUID_PATTERN.test(dep.trim())) {
            fail(
              502,
              'AI_VALIDATION_FAILED',
              'add_topic depends_on_lineage_ids contains invalid UUID',
              undefined,
              true,
            );
          }
          normalizedDeps.push(dep.trim().toLowerCase());
        }

        const rawGapType =
          typeof op.payload.gap_type === 'string'
            ? op.payload.gap_type.trim().toLowerCase()
            : 'missing';
        if (!SKILL_GAP_TYPE_VALUES.includes(rawGapType as SkillGapType)) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'add_topic payload.gap_type is invalid',
            undefined,
            true,
          );
        }

        const rawPhaseNo =
          op.payload.phase_no !== undefined && op.payload.phase_no !== null
            ? parseNumericScalar(op.payload.phase_no)
            : 1;
        if (!Number.isInteger(rawPhaseNo) || rawPhaseNo < 1) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'add_topic payload.phase_no must be a positive integer',
            undefined,
            true,
          );
        }

        let effortHours: number | null = DEFAULT_ITEM_EFFORT_HOURS;
        if (
          op.payload.estimated_effort_hours !== undefined &&
          op.payload.estimated_effort_hours !== null
        ) {
          const parsedEffort = parseNumericScalar(
            op.payload.estimated_effort_hours,
          );
          if (
            !Number.isFinite(parsedEffort) ||
            parsedEffort < 0 ||
            parsedEffort > 9999.9
          ) {
            fail(
              502,
              'AI_VALIDATION_FAILED',
              'add_topic estimated_effort_hours is out of range',
              undefined,
              true,
            );
          }
          effortHours = parsedEffort;
        }

        const normalizedSources: Array<{ publisher: string; url: string }> = [];
        if (Array.isArray(op.payload.sources)) {
          for (const rawSrc of op.payload.sources) {
            if (
              !rawSrc ||
              typeof rawSrc !== 'object' ||
              typeof (rawSrc as { publisher?: unknown }).publisher !==
                'string' ||
              !(rawSrc as { publisher: string }).publisher.trim() ||
              typeof (rawSrc as { url?: unknown }).url !== 'string' ||
              !HTTP_URL_PATTERN.test((rawSrc as { url: string }).url.trim())
            ) {
              fail(
                502,
                'AI_VALIDATION_FAILED',
                'add_topic source URL must be a valid HTTP(S) URL',
                undefined,
                true,
              );
            }
            normalizedSources.push({
              publisher: (rawSrc as { publisher: string }).publisher.trim(),
              url: (rawSrc as { url: string }).url.trim(),
            });
          }
        }

        simulatedNodes.set(provisionalLineageId, {
          retired: false,
          depends_on: normalizedDeps,
        });

        persistedOps.push({
          ...op,
          title: resolved.title,
          priority: op.priority ?? 'supporting',
          resolved_topic_id: resolved.topicId,
          resolved_skill_id: resolved.skillId,
          normalized_payload: {
            ...op.payload,
            provisional_lineage_id: provisionalLineageId,
            skill_id: resolved.skillId,
            phase_no: rawPhaseNo,
            gap_type: rawGapType,
            estimated_effort_hours: effortHours,
            depends_on_lineage_ids: normalizedDeps,
            sources: normalizedSources,
          },
        });
        continue;
      }

      // Existing-item operations: update_topic, reprioritize, reclassify, retire_topic
      const targetLineage = op.lineage_id;
      if (!targetLineage) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          `${op.op} requires a valid lineage_id`,
          undefined,
          true,
        );
      }

      const baseItem = activeBaseByLineage.get(targetLineage);
      const simNode = simulatedNodes.get(targetLineage);
      if (!baseItem || !simNode || simNode.retired) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          `${op.op} references an unknown or already-retired lineage_id`,
          undefined,
          true,
        );
      }

      let normalizedExistingDeps: string[] | undefined;
      if (op.op === 'retire_topic') {
        simNode.retired = true;
      } else {
        if (op.op === 'reprioritize' && !op.priority) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'reprioritize operation requires a target priority',
            undefined,
            true,
          );
        }
        if (op.op === 'reclassify') {
          const rawGap =
            typeof op.payload.gap_type === 'string'
              ? op.payload.gap_type.trim().toLowerCase()
              : null;
          if (
            rawGap !== null &&
            !SKILL_GAP_TYPE_VALUES.includes(rawGap as SkillGapType)
          ) {
            fail(
              502,
              'AI_VALIDATION_FAILED',
              'reclassify payload.gap_type is invalid',
              undefined,
              true,
            );
          }
          if (!rawGap && !op.priority) {
            fail(
              502,
              'AI_VALIDATION_FAILED',
              'reclassify operation requires gap_type or priority',
              undefined,
              true,
            );
          }
        }
        if (Array.isArray(op.payload.depends_on_lineage_ids)) {
          const nextDeps: string[] = [];
          for (const dep of op.payload.depends_on_lineage_ids) {
            if (typeof dep !== 'string' || !UUID_PATTERN.test(dep.trim())) {
              fail(
                502,
                'AI_VALIDATION_FAILED',
                'Merge operation depends_on_lineage_ids contains invalid UUID',
                undefined,
                true,
              );
            }
            nextDeps.push(dep.trim().toLowerCase());
          }
          simNode.depends_on = nextDeps;
          normalizedExistingDeps = nextDeps;
        }
      }

      persistedOps.push({
        ...op,
        title: op.title ?? String(baseItem.title),
        resolved_topic_id: String(baseItem.topic_id).toLowerCase(),
        resolved_skill_id: String(baseItem.skill_id).toLowerCase(),
        normalized_payload: {
          ...op.payload,
          ...(normalizedExistingDeps !== undefined
            ? { depends_on_lineage_ids: normalizedExistingDeps }
            : {}),
        },
      });
    }

    // Validate simulated post-merge active graph: non-empty, valid dependencies, and DAG-acyclic
    const activeSimulatedEdges = new Map<string, string[]>();
    for (const [lid, node] of simulatedNodes.entries()) {
      if (!node.retired) {
        activeSimulatedEdges.set(lid, []);
      }
    }

    if (activeSimulatedEdges.size === 0) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Merge proposal cannot retire every active topic in the roadmap',
        undefined,
        true,
      );
    }

    for (const [lid, node] of simulatedNodes.entries()) {
      if (node.retired) {
        continue;
      }
      const filteredDeps: string[] = [];
      for (const dep of node.depends_on) {
        if (dep === lid) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Simulated post-merge roadmap item cannot depend on itself',
            undefined,
            true,
          );
        }
        const depNode = simulatedNodes.get(dep);
        if (!depNode) {
          const retiredBaseDep = allBaseByLineage.get(dep);
          if (retiredBaseDep?.retired) {
            // Already-retired lineage in the base version: drop cleanly during reconciliation.
            continue;
          }
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Simulated post-merge roadmap references an unknown dependency lineage_id',
            undefined,
            true,
          );
        }
        // Dependencies pointing to retired items are dropped during reconciliation; active deps checked for cycles
        if (!depNode.retired) {
          filteredDeps.push(dep);
        }
      }
      activeSimulatedEdges.set(lid, filteredDeps);
    }

    assertMergeGraphAcyclic(activeSimulatedEdges);

    const softMaxTopics = await this.readBoundedConfigInteger(
      tx,
      'roadmap.soft_size_max_topics',
      DEFAULT_SOFT_SIZE_MAX_TOPICS,
    );
    const sizeImpact = buildMergeSizeImpact(
      activeBaseByLineage.size,
      activeSimulatedEdges.size,
      softMaxTopics,
    );

    const dailyPlanImpact = await computeDailyPlanImpactPreviewInTx(
      tx,
      userId,
      parsed.roadmapId,
      persistedOps.map((o) => ({
        op: o.op,
        lineage_id: o.lineage_id,
        payload: o.normalized_payload,
      })),
    );

    try {
      const mergeRaw = await tx.query<unknown>(
        `INSERT INTO public.roadmap_merges (
           roadmap_id,
           user_id,
           origin,
           status,
           base_version_id,
           target_level,
           instruction,
           reason,
           size_before,
           size_after,
           materially_large,
           daily_plan_impact,
           ai_generation_id
         )
         VALUES (
           $1,
           $2,
           $3::public.merge_origin,
           'proposed'::public.merge_status,
           $4,
           $5::public.career_level,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11::jsonb,
           $12
         )
         RETURNING id`,
        [
          parsed.roadmapId,
          userId,
          parsed.origin,
          baseVersion.id,
          persistedTargetLevel,
          parsed.instruction ?? null,
          normalized.reason,
          sizeImpact.before,
          sizeImpact.after,
          sizeImpact.materially_large,
          JSON.stringify(dailyPlanImpact),
          context?.aiGenerationId ?? null,
        ],
      );
      const mergeId = extractReturningRows<{ id: string }>(mergeRaw)[0]?.id;
      if (!mergeId) {
        fail(500, 'DATABASE_ERROR', 'Failed to persist roadmap_merges row');
      }

      for (const op of persistedOps) {
        await tx.query(
          `INSERT INTO public.roadmap_merge_items (
             merge_id,
             user_id,
             sort_order,
             op,
             lineage_id,
             topic_id,
             title,
             priority,
             reason,
             payload
           )
           VALUES (
             $1,
             $2,
             $3,
             $4::public.merge_op,
             $5,
             $6,
             $7,
             $8::public.item_priority,
             $9,
             $10::jsonb
           )`,
          [
            mergeId,
            userId,
            op.sort_order,
            op.op,
            op.op === 'add_topic' ? null : op.lineage_id,
            op.resolved_topic_id,
            op.title,
            op.priority,
            op.reason,
            JSON.stringify(op.normalized_payload),
          ],
        );
      }

      return {
        resultType: 'roadmap_merge',
        resultId: String(mergeId),
      };
    } catch (error) {
      const pgErr = unwrapDriverError(error);
      if (
        pgErr.code === '23505' &&
        (pgErr.constraint === 'uq_roadmap_merges_one_open' ||
          pgErr.message.includes('uq_roadmap_merges_one_open') ||
          pgErr.detail.includes('uq_roadmap_merges_one_open'))
      ) {
        fail(
          409,
          'STALE_JOB_INPUT',
          'An open merge proposal already exists for this roadmap.',
          undefined,
          false,
        );
      }
      throw error;
    }
  }
}
