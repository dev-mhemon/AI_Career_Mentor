import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  AIRequestDTO,
  RoadmapGenerationOutput,
  UiLanguage,
} from '../../ai/ai.types.js';
import { AiGatewayService } from '../../ai/services/ai-gateway.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type { JobQueryExecutor } from '../../jobs/services/job-producer.service.js';
import type {
  ClaimedJobRow,
  JobExecutionResult,
  JobHandler,
} from '../../jobs/services/postgres-job-queue.consumer.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import {
  ITEM_PRIORITY_VALUES,
  SKILL_GAP_TYPE_VALUES,
  type ItemPriority,
  type SkillGapType,
} from '../dto/roadmap.dto.js';
import { computeSizeGuardrail } from './roadmap.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const VALID_TOPIC_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);
const DEFAULT_SOFT_SIZE_MAX_TOPICS = 45;
const R26_MIN_OPERATIONAL_LIMIT = 1;
const R26_MAX_OPERATIONAL_LIMIT = 10_000;

export const SUPPORTED_ROADMAP_JOB_KINDS = [
  'roadmap_generate',
  'roadmap_revision',
] as const;

export type SupportedRoadmapJobKind =
  (typeof SUPPORTED_ROADMAP_JOB_KINDS)[number];

interface ParsedGeneratePayload {
  kind: 'roadmap_generate';
  careerGoalId: string;
  goalUpdatedAt: string;
  profileUpdatedAt: string;
}

interface ParsedRevisionPayload {
  kind: 'roadmap_revision';
  roadmapId: string;
  baseVersionNo: number;
  instruction?: string;
  refreshStale: boolean;
  roadmapVersion: number;
}

type ParsedRoadmapJobPayload = ParsedGeneratePayload | ParsedRevisionPayload;

interface NormalizedPhase {
  phase_no: number;
  title: string;
  milestones: Array<{ id: string; title: string }>;
}

interface NormalizedRoadmapItem {
  lineage_id: string;
  raw_topic_id: string;
  skill_id: string;
  phase_no: number;
  phase_title: string;
  title: string;
  priority: ItemPriority;
  gap_type: SkillGapType;
  required_depth: string | null;
  estimated_effort_hours: number | null;
  sequence_no: number;
  depends_on_lineage_ids: string[];
  reason: string | null;
  sources: Array<{ publisher: string; url: string }>;
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

function extractExactTimestamp(row: {
  updated_at_exact?: string | null;
  updated_at?: Date | string | null;
}): string | null {
  if (
    typeof row.updated_at_exact === 'string' &&
    row.updated_at_exact.trim().length > 0
  ) {
    return row.updated_at_exact.trim();
  }
  if (row.updated_at instanceof Date) {
    return row.updated_at.toISOString();
  }
  if (typeof row.updated_at === 'string' && row.updated_at.trim().length > 0) {
    return row.updated_at.trim();
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

function buildValidTopicSlug(title: string, disambiguator?: string): string {
  const ascii = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const hashSuffix = createHash('sha256')
    .update(`${title}:${disambiguator ?? ''}`, 'utf8')
    .digest('hex')
    .slice(0, 8);
  let candidate = ascii;
  if (!candidate) {
    candidate = `topic-${hashSuffix}`;
  } else if (disambiguator) {
    candidate = `${candidate.slice(0, 80)}-${hashSuffix}`.replace(/-+$/g, '');
  } else {
    candidate = candidate.slice(0, 96).replace(/-+$/g, '');
  }
  if (!VALID_TOPIC_SLUG_PATTERN.test(candidate)) {
    return `topic-${hashSuffix}`;
  }
  return candidate;
}

function assertDagAcyclic(edges: Map<string, string[]>): void {
  const state = new Map<string, number>();

  const visit = (node: string): void => {
    const current = state.get(node) ?? 0;
    if (current === 1) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI roadmap output contains cyclic dependencies',
        undefined,
        true,
      );
    }
    if (current === 2) {
      return;
    }
    state.set(node, 1);
    for (const dep of edges.get(node) ?? []) {
      visit(dep);
    }
    state.set(node, 2);
  };

  for (const node of edges.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      visit(node);
    }
  }
}

function unwrapDriverError(error: unknown): {
  code?: string;
  constraint?: string;
  message: string;
  detail: string;
} {
  if (!error || typeof error !== 'object') {
    return { message: String(error ?? ''), detail: '' };
  }
  const err = error as {
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
  const driver = err.driverError;
  const code =
    typeof driver?.code === 'string'
      ? driver.code
      : typeof err.code === 'string'
        ? err.code
        : undefined;
  const constraint =
    typeof driver?.constraint === 'string'
      ? driver.constraint
      : typeof err.constraint === 'string'
        ? err.constraint
        : undefined;
  const message = String(driver?.message ?? err.message ?? '');
  const detail = String(driver?.detail ?? err.detail ?? '');
  return { code, constraint, message, detail };
}

function parseJobPayload(job: ClaimedJobRow): ParsedRoadmapJobPayload {
  const payload = job.input_payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(422, 'VALIDATION_FAILED', 'Invalid job input payload');
  }
  if (payload.v !== 1) {
    fail(422, 'VALIDATION_FAILED', 'Unsupported job envelope version');
  }
  const args =
    payload.args &&
    typeof payload.args === 'object' &&
    !Array.isArray(payload.args)
      ? (payload.args as Record<string, unknown>)
      : null;
  const expectedRefs =
    payload.expected_refs &&
    typeof payload.expected_refs === 'object' &&
    !Array.isArray(payload.expected_refs)
      ? (payload.expected_refs as Record<string, unknown>)
      : null;
  if (!args || !expectedRefs) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Job envelope missing args or expected_refs',
    );
  }

  if (job.job_kind === 'roadmap_generate') {
    const careerGoalId =
      typeof args.career_goal_id === 'string'
        ? args.career_goal_id.trim().toLowerCase()
        : '';
    const goalUpdatedAt =
      typeof expectedRefs.goal_updated_at === 'string'
        ? expectedRefs.goal_updated_at.trim()
        : '';
    const profileUpdatedAt =
      typeof expectedRefs.profile_updated_at === 'string'
        ? expectedRefs.profile_updated_at.trim()
        : '';
    if (
      !UUID_PATTERN.test(careerGoalId) ||
      !goalUpdatedAt ||
      !profileUpdatedAt
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid roadmap_generate job payload');
    }
    return {
      kind: 'roadmap_generate',
      careerGoalId,
      goalUpdatedAt,
      profileUpdatedAt,
    };
  }

  if (job.job_kind === 'roadmap_revision') {
    const roadmapId =
      typeof args.roadmap_id === 'string'
        ? args.roadmap_id.trim().toLowerCase()
        : '';
    const baseVersionNo = Number(args.base_version_no);
    const roadmapVersion = Number(expectedRefs.roadmap_version);
    const refreshStale = Boolean(args.refresh_stale);
    const instruction =
      typeof args.instruction === 'string' && args.instruction.trim().length > 0
        ? args.instruction.trim()
        : undefined;
    if (
      !UUID_PATTERN.test(roadmapId) ||
      !Number.isInteger(baseVersionNo) ||
      baseVersionNo < 1 ||
      !Number.isInteger(roadmapVersion) ||
      roadmapVersion < 1 ||
      (!instruction && !refreshStale)
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid roadmap_revision job payload');
    }
    return {
      kind: 'roadmap_revision',
      roadmapId,
      baseVersionNo,
      instruction,
      refreshStale,
      roadmapVersion,
    };
  }

  fail(422, 'INVALID_ENUM_VALUE', 'Unsupported roadmap job kind');
}

function normalizeAndValidateOutput(rawOutput: unknown): {
  summary: RoadmapGenerationOutput['summary'];
  phases: NormalizedPhase[];
  items: NormalizedRoadmapItem[];
  levelOutline: RoadmapGenerationOutput['level_outline'];
  warnings: string[];
} {
  if (!rawOutput || typeof rawOutput !== 'object' || Array.isArray(rawOutput)) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI output failed validation and was discarded. Please try again.',
      undefined,
      true,
    );
  }
  const output = rawOutput as RoadmapGenerationOutput;
  if (!Array.isArray(output.phases) || output.phases.length === 0) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI roadmap output must include at least one phase',
      undefined,
      true,
    );
  }

  const phases: NormalizedPhase[] = [];
  const items: NormalizedRoadmapItem[] = [];
  const seenLineageIds = new Set<string>();
  const seenSequenceNos = new Set<number>();

  for (const rawPhase of output.phases) {
    if (!rawPhase || typeof rawPhase !== 'object' || Array.isArray(rawPhase)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Invalid phase object',
        undefined,
        true,
      );
    }
    const phaseNo = Number(rawPhase.phase_no);
    const phaseTitle =
      typeof rawPhase.title === 'string' ? rawPhase.title.trim() : '';
    if (
      !Number.isInteger(phaseNo) ||
      phaseNo < 1 ||
      !phaseTitle ||
      !Array.isArray(rawPhase.items)
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Invalid phase structure',
        undefined,
        true,
      );
    }

    const milestones: Array<{ id: string; title: string }> = [];
    if (Array.isArray(rawPhase.milestones)) {
      for (const ms of rawPhase.milestones) {
        if (
          ms &&
          typeof ms === 'object' &&
          typeof ms.id === 'string' &&
          typeof ms.title === 'string'
        ) {
          milestones.push({ id: ms.id.trim(), title: ms.title.trim() });
        }
      }
    }

    phases.push({
      phase_no: phaseNo,
      title: phaseTitle,
      milestones,
    });

    for (const rawItem of rawPhase.items) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Invalid item object',
          undefined,
          true,
        );
      }
      const skillId =
        typeof rawItem.skill_id === 'string'
          ? rawItem.skill_id.trim().toLowerCase()
          : '';
      if (!UUID_PATTERN.test(skillId)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item skill_id must be a valid UUID',
          undefined,
          true,
        );
      }

      const rawTopicId =
        typeof rawItem.topic_id === 'string'
          ? rawItem.topic_id.trim().toLowerCase()
          : '';
      const lineageId =
        rawItem.lineage_id !== undefined && rawItem.lineage_id !== null
          ? String(rawItem.lineage_id).trim().toLowerCase()
          : randomUUID().toLowerCase();
      if (!UUID_PATTERN.test(lineageId) || seenLineageIds.has(lineageId)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item lineage_id must be a unique UUID',
          undefined,
          true,
        );
      }
      seenLineageIds.add(lineageId);

      const title =
        typeof rawItem.title === 'string' ? rawItem.title.trim() : '';
      if (!title) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item title must be non-empty',
          undefined,
          true,
        );
      }

      if (
        !ITEM_PRIORITY_VALUES.includes(rawItem.priority as ItemPriority) ||
        !SKILL_GAP_TYPE_VALUES.includes(rawItem.gap_type as SkillGapType)
      ) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item priority or gap_type is invalid',
          undefined,
          true,
        );
      }

      const sequenceNo = Number(rawItem.sequence_no);
      if (
        !Number.isInteger(sequenceNo) ||
        sequenceNo < 1 ||
        seenSequenceNos.has(sequenceNo)
      ) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item sequence_no must be a unique positive integer',
          undefined,
          true,
        );
      }
      seenSequenceNos.add(sequenceNo);

      const effortRaw = rawItem.estimated_effort_hours;
      const effort =
        effortRaw === null || effortRaw === undefined
          ? null
          : Number(effortRaw);
      if (
        effort !== null &&
        (!Number.isFinite(effort) || effort < 0 || effort > 9999.9)
      ) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item estimated_effort_hours must be between 0 and 9999.9',
          undefined,
          true,
        );
      }

      if (!Array.isArray(rawItem.depends_on_lineage_ids)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'depends_on_lineage_ids must be an array',
          undefined,
          true,
        );
      }
      const deps = rawItem.depends_on_lineage_ids.map((dep) => {
        if (typeof dep !== 'string' || !UUID_PATTERN.test(dep.trim())) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Dependency lineage id must be a valid UUID',
            undefined,
            true,
          );
        }
        return dep.trim().toLowerCase();
      });

      const sources: Array<{ publisher: string; url: string }> = [];
      if (!Array.isArray(rawItem.sources)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item sources must be an array',
          undefined,
          true,
        );
      }
      for (const rawSrc of rawItem.sources) {
        if (
          !rawSrc ||
          typeof rawSrc !== 'object' ||
          typeof rawSrc.publisher !== 'string' ||
          !rawSrc.publisher.trim() ||
          typeof rawSrc.url !== 'string' ||
          !HTTP_URL_PATTERN.test(rawSrc.url.trim())
        ) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Roadmap item source URL must be a valid HTTP(S) URL',
            undefined,
            true,
          );
        }
        sources.push({
          publisher: rawSrc.publisher.trim(),
          url: rawSrc.url.trim(),
        });
      }

      items.push({
        lineage_id: lineageId,
        raw_topic_id: rawTopicId,
        skill_id: skillId,
        phase_no: phaseNo,
        phase_title: phaseTitle,
        title,
        priority: rawItem.priority,
        gap_type: rawItem.gap_type,
        required_depth:
          typeof rawItem.required_depth === 'string' &&
          rawItem.required_depth.trim()
            ? rawItem.required_depth.trim()
            : null,
        estimated_effort_hours: effort,
        sequence_no: sequenceNo,
        depends_on_lineage_ids: deps,
        reason:
          typeof rawItem.reason === 'string' && rawItem.reason.trim()
            ? rawItem.reason.trim()
            : null,
        sources,
      });
    }
  }

  if (items.length === 0) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI roadmap output must include at least one topic item',
      undefined,
      true,
    );
  }

  const dagEdges = new Map<string, string[]>();
  for (const item of items) {
    for (const dep of item.depends_on_lineage_ids) {
      if (dep === item.lineage_id || !seenLineageIds.has(dep)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap item depends_on_lineage_ids references an unknown or self lineage_id',
          undefined,
          true,
        );
      }
    }
    dagEdges.set(item.lineage_id, item.depends_on_lineage_ids);
  }
  assertDagAcyclic(dagEdges);

  const summary =
    output.summary &&
    typeof output.summary === 'object' &&
    !Array.isArray(output.summary)
      ? output.summary
      : {
          current_situation: '',
          target_interpretation: '',
          expected_career_impact: '',
          next_steps: [],
        };

  return {
    summary: {
      current_situation: String(summary.current_situation ?? ''),
      target_interpretation: String(summary.target_interpretation ?? ''),
      expected_career_impact: String(summary.expected_career_impact ?? ''),
      next_steps: Array.isArray(summary.next_steps)
        ? summary.next_steps.filter((s): s is string => typeof s === 'string')
        : [],
    },
    phases,
    items,
    levelOutline: Array.isArray(output.level_outline)
      ? output.level_outline
      : [],
    warnings: Array.isArray(output.warnings)
      ? output.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  };
}

/**
 * Durable async job handler (`roadmap_generate`, `roadmap_revision`) invoked by `PostgresJobQueueConsumer`.
 *
 * Guarantees (`R12`, `R13`, `PRD` §44):
 * - Runs `AiGatewayService.execute(..., { persistTelemetry: false, signal })` strictly OUTSIDE any DB transaction.
 * - Never logs raw user instructions or AI output payloads.
 * - Verifies `expected_refs` (`STALE_JOB_INPUT` on drift) and commits domain rows inside the consumer's single tx.
 * - Supersedes any prior draft `roadmap_versions` row BEFORE inserting the new draft (`uq_roadmap_versions_one_draft`).
 */
@Injectable()
export class RoadmapJobHandler implements JobHandler {
  readonly supportedKinds = SUPPORTED_ROADMAP_JOB_KINDS;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
  ) {}

  canHandle(jobKind: string): jobKind is SupportedRoadmapJobKind {
    return (SUPPORTED_ROADMAP_JOB_KINDS as readonly string[]).includes(jobKind);
  }

  private async readBoundedConfigInteger(
    db: JobQueryExecutor,
    configKey: string,
    defaultValue: number,
  ): Promise<number> {
    try {
      const rows = await db.query<Array<{ config_value: unknown }>>(
        `SELECT config_value
           FROM public.system_configurations
          WHERE config_key = $1`,
        [configKey],
      );
      const raw = Array.isArray(rows) ? rows[0]?.config_value : undefined;
      if (
        typeof raw === 'number' &&
        Number.isInteger(raw) &&
        raw >= R26_MIN_OPERATIONAL_LIMIT &&
        raw <= R26_MAX_OPERATIONAL_LIMIT
      ) {
        return raw;
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  }

  private async verifyGenerateRefsInTx(
    tx: JobQueryExecutor,
    userId: string,
    parsed: ParsedGeneratePayload,
  ): Promise<{ ok: boolean; reason?: string }> {
    const goalRows = await tx.query<
      Array<{
        id: string;
        status: string;
        confirmed_role_id: string | null;
        target_level: CareerLevel | null;
        updated_at: Date | string;
        updated_at_exact?: string | null;
      }>
    >(
      `SELECT id,
              status::text AS status,
              confirmed_role_id,
              target_level::text AS target_level,
              updated_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_exact
         FROM public.career_goals
        WHERE user_id = $1
          AND id = $2`,
      [userId, parsed.careerGoalId],
    );
    const goal = Array.isArray(goalRows) ? goalRows[0] : undefined;
    if (
      !goal ||
      goal.status !== 'confirmed' ||
      !goal.confirmed_role_id ||
      !goal.target_level
    ) {
      return { ok: false, reason: 'GOAL_NOT_CONFIRMED' };
    }
    const goalUpdated = extractExactTimestamp(goal);
    if (goalUpdated !== parsed.goalUpdatedAt) {
      return { ok: false, reason: 'GOAL_UPDATED' };
    }

    const profileRows = await tx.query<
      Array<{
        updated_at: Date | string;
        updated_at_exact?: string | null;
      }>
    >(
      `SELECT updated_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_exact
         FROM public.user_profiles
        WHERE user_id = $1`,
      [userId],
    );
    const profile = Array.isArray(profileRows) ? profileRows[0] : undefined;
    if (!profile) {
      return { ok: false, reason: 'PROFILE_NOT_FOUND' };
    }
    const profileUpdated = extractExactTimestamp(profile);
    if (profileUpdated !== parsed.profileUpdatedAt) {
      return { ok: false, reason: 'PROFILE_UPDATED' };
    }

    const existingRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.roadmaps
        WHERE user_id = $1
          AND career_goal_id = $2
        LIMIT 1`,
      [userId, parsed.careerGoalId],
    );
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return { ok: false, reason: 'ROADMAP_ALREADY_EXISTS' };
    }

    return { ok: true };
  }

  private async verifyRevisionRefsInTx(
    tx: JobQueryExecutor,
    userId: string,
    parsed: ParsedRevisionPayload,
  ): Promise<{ ok: boolean; reason?: string }> {
    const roadmapRows = await tx.query<Array<{ id: string; status: string }>>(
      `SELECT id, status::text AS status
         FROM public.roadmaps
        WHERE user_id = $1
          AND id = $2`,
      [userId, parsed.roadmapId],
    );
    const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
    if (!roadmap || roadmap.status !== 'draft') {
      return { ok: false, reason: 'ROADMAP_NOT_DRAFT' };
    }

    const draftRows = await tx.query<
      Array<{ id: string; version_no: number | string }>
    >(
      `SELECT id, version_no
         FROM public.roadmap_versions
        WHERE user_id = $1
          AND roadmap_id = $2
          AND state = 'draft'
        LIMIT 1`,
      [userId, parsed.roadmapId],
    );
    const draft = Array.isArray(draftRows) ? draftRows[0] : undefined;
    if (!draft) {
      return { ok: false, reason: 'NO_OPEN_DRAFT' };
    }
    if (Number(draft.version_no) !== parsed.roadmapVersion) {
      return { ok: false, reason: 'ROADMAP_VERSION_DRIFT' };
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
    let parsed: ParsedRoadmapJobPayload;
    try {
      parsed = parseJobPayload(job);
    } catch {
      return { ok: false, reason: 'INVALID_PAYLOAD' };
    }

    if (parsed.kind === 'roadmap_generate') {
      return this.verifyGenerateRefsInTx(tx, userId, parsed);
    }
    return this.verifyRevisionRefsInTx(tx, userId, parsed);
  }

  /**
   * Loads minimized PII-free context in a completed read transaction (`foreground = false`),
   * then invokes `AiGatewayService.execute` strictly outside any open DB transaction.
   */
  async execute(
    job: ClaimedJobRow,
    signal: AbortSignal,
  ): Promise<JobExecutionResult> {
    if (signal.aborted) {
      fail(
        504,
        'AI_TIMEOUT',
        'AI generation timed out. Please try again.',
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
    const parsed = parseJobPayload(job);
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

        const softMaxTopics = await this.readBoundedConfigInteger(
          db,
          'roadmap.soft_size_max_topics',
          DEFAULT_SOFT_SIZE_MAX_TOPICS,
        );

        const skillRows = await db.query<
          Array<{ id: string; slug: string; canonical_name: string }>
        >(
          `SELECT id, slug, canonical_name
             FROM public.skills
            WHERE status = 'approved'
              AND deleted_at IS NULL
            ORDER BY canonical_name ASC
            LIMIT 500`,
        );
        const approvedSkills = (Array.isArray(skillRows) ? skillRows : []).map(
          (s) => ({
            id: String(s.id),
            slug: String(s.slug),
            name: String(s.canonical_name),
          }),
        );

        if (parsed.kind === 'roadmap_generate') {
          const refCheck = await this.verifyGenerateRefsInTx(
            db,
            userId,
            parsed,
          );
          if (!refCheck.ok) {
            fail(
              409,
              'STALE_JOB_INPUT',
              'Source data changed before the job ran. Please refresh and try again.',
              undefined,
              false,
            );
          }

          const goalRows = await db.query<
            Array<{
              id: string;
              goal_text: string;
              confirmed_role_id: string;
              role_name: string;
              target_level: CareerLevel;
            }>
          >(
            `SELECT cg.id,
                    cg.goal_text,
                    cg.confirmed_role_id,
                    cr.name AS role_name,
                    cg.target_level::text AS target_level
               FROM public.career_goals cg
               JOIN public.career_roles cr ON cr.id = cg.confirmed_role_id
              WHERE cg.user_id = $1
                AND cg.id = $2`,
            [userId, parsed.careerGoalId],
          );
          const goal = Array.isArray(goalRows) ? goalRows[0] : undefined;
          if (!goal) {
            fail(
              409,
              'STALE_JOB_INPUT',
              'Source data changed before the job ran. Please refresh and try again.',
              undefined,
              false,
            );
          }

          const profileRows = await db.query<
            Array<{
              current_role_title: string | null;
              education: string | null;
              experience_level: string | null;
              preferred_daily_hours: number | string | null;
              learning_preference: string | null;
              existing_skills_none: boolean;
              self_reported_skill_ids: string[] | null;
            }>
          >(
            `SELECT p.current_role_title,
                    p.education,
                    p.experience_level::text AS experience_level,
                    p.preferred_daily_hours,
                    pr.learning_preference,
                    p.existing_skills_none,
                    p.self_reported_skill_ids
               FROM public.user_profiles p
               LEFT JOIN public.user_preferences pr ON pr.user_id = p.user_id
              WHERE p.user_id = $1`,
            [userId],
          );
          const profile = Array.isArray(profileRows)
            ? profileRows[0]
            : undefined;

          return {
            context: {
              career_goal: {
                id: String(goal.id),
                canonical_role_id: String(goal.confirmed_role_id),
                role_name: String(goal.role_name),
                target_level: goal.target_level,
              },
              profile: {
                current_role: profile?.current_role_title ?? null,
                education: profile?.education ?? null,
                experience_level: profile?.experience_level ?? null,
                learning_preference: profile?.learning_preference ?? null,
                preferred_daily_hours:
                  profile?.preferred_daily_hours !== null &&
                  profile?.preferred_daily_hours !== undefined
                    ? Number(profile.preferred_daily_hours)
                    : null,
                existing_skills_none: Boolean(profile?.existing_skills_none),
                self_reported_skill_ids: Array.isArray(
                  profile?.self_reported_skill_ids,
                )
                  ? profile.self_reported_skill_ids
                  : [],
              },
              approved_skills: approvedSkills,
              soft_size_max_topics: softMaxTopics,
            },
            untrustedInputs: goal.goal_text ? [String(goal.goal_text)] : [],
          };
        }

        const refCheck = await this.verifyRevisionRefsInTx(db, userId, parsed);
        if (!refCheck.ok) {
          fail(
            409,
            'STALE_JOB_INPUT',
            'Source data changed before the job ran. Please refresh and try again.',
            undefined,
            false,
          );
        }

        const roadmapRows = await db.query<
          Array<{
            id: string;
            canonical_role_id: string;
            role_name: string;
            target_level: CareerLevel;
            draft_version_id: string;
            version_no: number | string;
            summary: unknown;
            phases: unknown;
            stale: boolean;
          }>
        >(
          `SELECT r.id,
                  r.canonical_role_id,
                  cr.name AS role_name,
                  r.target_level::text AS target_level,
                  dv.id AS draft_version_id,
                  dv.version_no,
                  dv.summary,
                  dv.phases,
                  dv.stale
             FROM public.roadmaps r
             JOIN public.career_roles cr ON cr.id = r.canonical_role_id
             JOIN public.roadmap_versions dv
               ON dv.roadmap_id = r.id
              AND dv.user_id = $1
              AND dv.state = 'draft'
            WHERE r.user_id = $1
              AND r.id = $2`,
          [userId, parsed.roadmapId],
        );
        const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
        if (!roadmap) {
          fail(
            409,
            'STALE_JOB_INPUT',
            'Source data changed before the job ran. Please refresh and try again.',
            undefined,
            false,
          );
        }

        const currentItems = await db.query<
          Array<{
            lineage_id: string;
            topic_id: string;
            skill_id: string;
            phase_no: number | string;
            title: string;
            priority: string;
            gap_type: string;
            sequence_no: number | string;
          }>
        >(
          `SELECT lineage_id,
                  topic_id,
                  skill_id,
                  phase_no,
                  title,
                  priority::text AS priority,
                  gap_type::text AS gap_type,
                  sequence_no
             FROM public.roadmap_items
            WHERE user_id = $1
              AND version_id = $2
            ORDER BY sequence_no ASC`,
          [userId, roadmap.draft_version_id],
        );

        return {
          context: {
            roadmap: {
              id: String(roadmap.id),
              canonical_role_id: String(roadmap.canonical_role_id),
              role_name: String(roadmap.role_name),
              target_level: roadmap.target_level,
              base_version_no: Number(roadmap.version_no),
              stale: Boolean(roadmap.stale),
              summary: roadmap.summary ?? {},
              phases: roadmap.phases ?? [],
              items: Array.isArray(currentItems) ? currentItems : [],
            },
            refresh_stale: parsed.refreshStale,
            approved_skills: approvedSkills,
            soft_size_max_topics: softMaxTopics,
          },
          untrustedInputs: parsed.instruction ? [parsed.instruction] : [],
        };
      },
      true,
      false,
    );

    if (signal.aborted) {
      fail(
        504,
        'AI_TIMEOUT',
        'AI generation timed out. Please try again.',
        undefined,
        true,
      );
    }

    const aiRequest: AIRequestDTO = {
      request_id: job.id,
      task: parsed.kind,
      user_id: userId,
      feature_key: 'roadmap_generator',
      context: prepared.context,
      untrusted_inputs: prepared.untrustedInputs,
      output_schema: 'roadmap.v1',
      language,
      idempotency_key: job.idempotency_key ?? job.id,
      budget: {
        max_input_units: 16_000,
        max_output_units: 12_000,
        timeout_ms: 90_000,
      },
    };

    const aiResponse = await this.aiGateway.execute<RoadmapGenerationOutput>(
      aiRequest,
      {
        persistTelemetry: false,
        signal,
      },
    );

    if (!aiResponse?.output) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output failed validation and was discarded. Please try again.',
        undefined,
        true,
      );
    }

    return {
      resultType: 'roadmap',
      resultId: job.subject_id ?? job.id,
      providerKey: aiResponse.provider_id,
      modelId: aiResponse.model_id,
      promptVersionId: aiResponse.prompt_version_id,
      outputSchemaId: 'roadmap.v1',
      fallbackUsed: aiResponse.fallback_used,
      language,
      inputUnits: aiResponse.usage_units.input,
      outputUnits: aiResponse.usage_units.output,
      latencyMs: aiResponse.latency_ms,
      output: aiResponse.output,
    };
  }

  private async resolveOrProvisionTopics(
    tx: JobQueryExecutor,
    items: readonly NormalizedRoadmapItem[],
    targetLevel: CareerLevel,
  ): Promise<Map<string, string>> {
    const resolvedByLineage = new Map<string, string>();
    const usedTopicIds = new Set<string>();

    const candidateTopicIds = Array.from(
      new Set(
        items
          .map((item) => item.raw_topic_id)
          .filter((id) => UUID_PATTERN.test(id)),
      ),
    );

    const existingById = new Map<
      string,
      { id: string; skill_id: string; career_level?: string }
    >();
    if (candidateTopicIds.length > 0) {
      const existingRows = await tx.query<
        Array<{ id: string; skill_id: string; career_level?: string }>
      >(
        `SELECT id, skill_id, career_level::text AS career_level
           FROM public.topics
          WHERE id = ANY($1::uuid[])
            AND deleted_at IS NULL`,
        [candidateTopicIds],
      );
      for (const row of Array.isArray(existingRows) ? existingRows : []) {
        existingById.set(String(row.id).toLowerCase(), {
          id: String(row.id),
          skill_id: String(row.skill_id).toLowerCase(),
          career_level: row.career_level,
        });
      }
    }

    const usedSlugKeys = new Set<string>();

    for (const item of items) {
      const existingDirect = UUID_PATTERN.test(item.raw_topic_id)
        ? existingById.get(item.raw_topic_id)
        : undefined;
      if (
        existingDirect &&
        existingDirect.skill_id === item.skill_id &&
        (!existingDirect.career_level ||
          existingDirect.career_level === targetLevel)
      ) {
        if (usedTopicIds.has(existingDirect.id)) {
          fail(
            502,
            'AI_VALIDATION_FAILED',
            'Duplicate topic_id within roadmap version',
            undefined,
            true,
          );
        }
        usedTopicIds.add(existingDirect.id);
        resolvedByLineage.set(item.lineage_id, existingDirect.id);
        continue;
      }

      let slug = buildValidTopicSlug(item.title);
      const slugKey = `${item.skill_id}:${slug}:${targetLevel}`;
      if (usedSlugKeys.has(slugKey)) {
        slug = buildValidTopicSlug(item.title, item.lineage_id);
      }
      usedSlugKeys.add(`${item.skill_id}:${slug}:${targetLevel}`);

      const bySlugRows = await tx.query<Array<{ id: string }>>(
        `SELECT id
           FROM public.topics
          WHERE skill_id = $1
            AND slug = $2
            AND career_level = $3::public.career_level
            AND deleted_at IS NULL
          ORDER BY CASE status WHEN 'approved' THEN 0 ELSE 1 END, content_version DESC
          LIMIT 1`,
        [item.skill_id, slug, targetLevel],
      );
      let topicId = Array.isArray(bySlugRows) ? bySlugRows[0]?.id : undefined;

      if (topicId && usedTopicIds.has(String(topicId))) {
        slug = buildValidTopicSlug(item.title, item.lineage_id);
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
          [item.skill_id, slug, item.title, targetLevel],
        );
        const insertedRows = extractReturningRows<{ id: string }>(insertedRaw);
        topicId = insertedRows[0]?.id;

        if (!topicId) {
          const fallbackRows = await tx.query<Array<{ id: string }>>(
            `SELECT id
               FROM public.topics
              WHERE skill_id = $1
                AND slug = $2
                AND career_level = $3::public.career_level
                AND content_version = 1
              LIMIT 1`,
            [item.skill_id, slug, targetLevel],
          );
          topicId = Array.isArray(fallbackRows)
            ? fallbackRows[0]?.id
            : undefined;
        }
      }

      if (!topicId || usedTopicIds.has(String(topicId))) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Unable to resolve distinct topic row for roadmap item',
          undefined,
          true,
        );
      }
      usedTopicIds.add(String(topicId));
      resolvedByLineage.set(item.lineage_id, String(topicId));
    }

    return resolvedByLineage;
  }

  private async insertVersionItems(
    tx: JobQueryExecutor,
    userId: string,
    versionId: string,
    items: readonly NormalizedRoadmapItem[],
    topicIdByLineage: ReadonlyMap<string, string>,
  ): Promise<void> {
    for (const item of items) {
      const topicId = topicIdByLineage.get(item.lineage_id);
      if (!topicId) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Missing resolved topic_id for roadmap item',
          undefined,
          true,
        );
      }
      await tx.query(
        `INSERT INTO public.roadmap_items (
           version_id,
           user_id,
           lineage_id,
           topic_id,
           skill_id,
           phase_no,
           phase_title,
           title,
           priority,
           gap_type,
           required_depth,
           estimated_effort_hours,
           sequence_no,
           depends_on_lineage_ids,
           reason,
           retired,
           sources
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9::public.item_priority,
           $10::public.skill_gap_type,
           $11,
           $12,
           $13,
           $14::uuid[],
           $15,
           false,
           $16::jsonb
         )`,
        [
          versionId,
          userId,
          item.lineage_id,
          topicId,
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
          JSON.stringify(item.sources),
        ],
      );
    }
  }

  /**
   * Atomically persists `roadmaps`, `roadmap_versions`, `topics`, and `roadmap_items` inside
   * `PostgresJobQueueConsumer`'s `R13` commit transaction.
   */
  async persistArtifact(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    result: JobExecutionResult,
  ): Promise<{ resultType: 'roadmap'; resultId: string }> {
    const userId = String(job.user_id ?? '')
      .trim()
      .toLowerCase();
    if (!UUID_PATTERN.test(userId)) {
      fail(401, 'AUTH_REQUIRED', 'Valid user_id is required');
    }

    // Deadlock-safe lock order: lock public.users row FOR UPDATE before roadmap tables.
    const userRows = await tx.query<Array<{ status: string }>>(
      `SELECT status::text AS status
         FROM public.users
        WHERE id = $1
        FOR UPDATE`,
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

    const parsed = parseJobPayload(job);
    const normalized = normalizeAndValidateOutput(result.output);

    const distinctSkillIds = Array.from(
      new Set(normalized.items.map((item) => item.skill_id)),
    );
    const approvedSkillRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.skills
        WHERE id = ANY($1::uuid[])
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL`,
      [distinctSkillIds],
    );
    const approvedSkillSet = new Set(
      (Array.isArray(approvedSkillRows) ? approvedSkillRows : []).map((row) =>
        String(row.id).toLowerCase(),
      ),
    );
    for (const skillId of distinctSkillIds) {
      if (!approvedSkillSet.has(skillId)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Roadmap references an unknown or unapproved skill',
          undefined,
          true,
        );
      }
    }

    const softMaxTopics = await this.readBoundedConfigInteger(
      tx,
      'roadmap.soft_size_max_topics',
      DEFAULT_SOFT_SIZE_MAX_TOPICS,
    );
    const sizeGuardrail = computeSizeGuardrail(
      normalized.items.length,
      softMaxTopics,
    );
    const warnings = [...normalized.warnings];
    if (
      sizeGuardrail.materially_large &&
      sizeGuardrail.warning &&
      !warnings.includes(sizeGuardrail.warning)
    ) {
      warnings.push(sizeGuardrail.warning);
    }

    try {
      if (parsed.kind === 'roadmap_generate') {
        const goalRows = await tx.query<
          Array<{
            id: string;
            status: string;
            confirmed_role_id: string | null;
            target_level: CareerLevel | null;
            updated_at: Date | string;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  confirmed_role_id,
                  target_level::text AS target_level,
                  updated_at
             FROM public.career_goals
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [userId, parsed.careerGoalId],
        );
        const goal = Array.isArray(goalRows) ? goalRows[0] : undefined;
        if (
          !goal ||
          goal.status !== 'confirmed' ||
          !goal.confirmed_role_id ||
          !goal.target_level
        ) {
          fail(
            409,
            'STALE_JOB_INPUT',
            'Source data changed before the job ran. Please refresh and try again.',
            undefined,
            false,
          );
        }

        const topicIdByLineage = await this.resolveOrProvisionTopics(
          tx,
          normalized.items,
          goal.target_level,
        );

        const roadmapRaw = await tx.query<unknown>(
          `INSERT INTO public.roadmaps (
             user_id,
             career_goal_id,
             canonical_role_id,
             target_level,
             status,
             is_focus
           )
           VALUES ($1, $2, $3, $4::public.career_level, 'draft'::public.roadmap_status, false)
           RETURNING id`,
          [
            userId,
            parsed.careerGoalId,
            goal.confirmed_role_id,
            goal.target_level,
          ],
        );
        const roadmapRows = extractReturningRows<{ id: string }>(roadmapRaw);
        const roadmapId = roadmapRows[0]?.id;
        if (!roadmapId) {
          fail(500, 'DATABASE_ERROR', 'Failed to persist roadmap row');
        }

        const contextHash = createHash('sha256')
          .update(
            JSON.stringify({
              career_goal_id: parsed.careerGoalId,
              canonical_role_id: goal.confirmed_role_id,
              target_level: goal.target_level,
              goal_updated_at: toIsoTimestamp(goal.updated_at),
              profile_updated_at: parsed.profileUpdatedAt,
            }),
            'utf8',
          )
          .digest('hex');

        const versionRaw = await tx.query<unknown>(
          `INSERT INTO public.roadmap_versions (
             roadmap_id,
             user_id,
             version_no,
             state,
             created_by,
             target_level,
             summary,
             phases,
             level_outline,
             warnings,
             stale,
             context_hash
           )
           VALUES (
             $1,
             $2,
             1,
             'draft'::public.roadmap_version_state,
             'ai'::public.roadmap_version_origin,
             $3::public.career_level,
             $4::jsonb,
             $5::jsonb,
             $6::jsonb,
             $7::jsonb,
             false,
             $8
           )
           RETURNING id`,
          [
            roadmapId,
            userId,
            goal.target_level,
            JSON.stringify(normalized.summary),
            JSON.stringify(normalized.phases),
            JSON.stringify(normalized.levelOutline),
            JSON.stringify(warnings),
            contextHash,
          ],
        );
        const versionRows = extractReturningRows<{ id: string }>(versionRaw);
        const versionId = versionRows[0]?.id;
        if (!versionId) {
          fail(500, 'DATABASE_ERROR', 'Failed to persist roadmap version row');
        }

        await this.insertVersionItems(
          tx,
          userId,
          versionId,
          normalized.items,
          topicIdByLineage,
        );

        return {
          resultType: 'roadmap',
          resultId: String(roadmapId),
        };
      }

      // roadmap_revision: lock roadmap -> lock & supersede active draft -> insert new draft version
      const roadmapRows = await tx.query<
        Array<{
          id: string;
          status: string;
          canonical_role_id: string;
          target_level: CareerLevel;
        }>
      >(
        `SELECT id,
                status::text AS status,
                canonical_role_id,
                target_level::text AS target_level
           FROM public.roadmaps
          WHERE user_id = $1
            AND id = $2
          FOR UPDATE`,
        [userId, parsed.roadmapId],
      );
      const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
      if (!roadmap || roadmap.status !== 'draft') {
        fail(
          409,
          'STALE_JOB_INPUT',
          'Source data changed before the job ran. Please refresh and try again.',
          undefined,
          false,
        );
      }

      const prevDraftRows = await tx.query<
        Array<{ id: string; version_no: number | string }>
      >(
        `SELECT id, version_no
           FROM public.roadmap_versions
          WHERE user_id = $1
            AND roadmap_id = $2
            AND state = 'draft'
          FOR UPDATE`,
        [userId, parsed.roadmapId],
      );
      const prevDraft = Array.isArray(prevDraftRows)
        ? prevDraftRows[0]
        : undefined;
      if (!prevDraft || Number(prevDraft.version_no) !== parsed.baseVersionNo) {
        fail(
          409,
          'STALE_JOB_INPUT',
          'Source data changed before the job ran. Please refresh and try again.',
          undefined,
          false,
        );
      }

      const topicIdByLineage = await this.resolveOrProvisionTopics(
        tx,
        normalized.items,
        roadmap.target_level,
      );

      // Supersede active draft BEFORE inserting new draft so uq_roadmap_versions_one_draft holds.
      const supersededRaw = await tx.query<unknown>(
        `UPDATE public.roadmap_versions
            SET state = 'superseded'::public.roadmap_version_state,
                superseded_at = clock_timestamp()
          WHERE user_id = $1
            AND id = $2
            AND state = 'draft'
         RETURNING id`,
        [userId, prevDraft.id],
      );
      if (extractReturningRows<{ id: string }>(supersededRaw).length === 0) {
        fail(
          409,
          'STALE_JOB_INPUT',
          'Source data changed before the job ran. Please refresh and try again.',
          undefined,
          false,
        );
      }

      const nextNoRows = await tx.query<
        Array<{ next_version_no: number | string }>
      >(
        `SELECT COALESCE(MAX(version_no), 0)::int + 1 AS next_version_no
           FROM public.roadmap_versions
          WHERE user_id = $1
            AND roadmap_id = $2`,
        [userId, parsed.roadmapId],
      );
      const nextVersionNo = Math.max(
        parsed.baseVersionNo + 1,
        Number(
          Array.isArray(nextNoRows)
            ? (nextNoRows[0]?.next_version_no ?? parsed.baseVersionNo + 1)
            : parsed.baseVersionNo + 1,
        ),
      );

      const contextHash = createHash('sha256')
        .update(
          JSON.stringify({
            roadmap_id: parsed.roadmapId,
            base_version_no: parsed.baseVersionNo,
            next_version_no: nextVersionNo,
            refresh_stale: parsed.refreshStale,
          }),
          'utf8',
        )
        .digest('hex');

      const newVersionRaw = await tx.query<unknown>(
        `INSERT INTO public.roadmap_versions (
           roadmap_id,
           user_id,
           version_no,
           state,
           created_by,
           target_level,
           base_version_id,
           summary,
           phases,
           level_outline,
           warnings,
           stale,
           context_hash
         )
         VALUES (
           $1,
           $2,
           $3,
           'draft'::public.roadmap_version_state,
           'user_request'::public.roadmap_version_origin,
           $4::public.career_level,
           $5,
           $6::jsonb,
           $7::jsonb,
           $8::jsonb,
           $9::jsonb,
           false,
           $10
         )
         RETURNING id`,
        [
          parsed.roadmapId,
          userId,
          nextVersionNo,
          roadmap.target_level,
          prevDraft.id,
          JSON.stringify(normalized.summary),
          JSON.stringify(normalized.phases),
          JSON.stringify(normalized.levelOutline),
          JSON.stringify(warnings),
          contextHash,
        ],
      );
      const newVersionRows = extractReturningRows<{ id: string }>(
        newVersionRaw,
      );
      const newVersionId = newVersionRows[0]?.id;
      if (!newVersionId) {
        fail(
          500,
          'DATABASE_ERROR',
          'Failed to persist revised roadmap version',
        );
      }

      await this.insertVersionItems(
        tx,
        userId,
        newVersionId,
        normalized.items,
        topicIdByLineage,
      );

      return {
        resultType: 'roadmap',
        resultId: parsed.roadmapId,
      };
    } catch (error) {
      const pgErr = unwrapDriverError(error);
      if (
        pgErr.code === '23514' &&
        (pgErr.message.includes('ROADMAP_LIMIT_REACHED') ||
          pgErr.detail.includes('ROADMAP_LIMIT_REACHED'))
      ) {
        fail(
          409,
          'ROADMAP_LIMIT_REACHED',
          'Maximum of 3 active career roadmaps reached',
          undefined,
          false,
        );
      }
      if (
        pgErr.code === '23505' &&
        (pgErr.constraint === 'uq_roadmaps_goal' ||
          pgErr.message.includes('uq_roadmaps_goal') ||
          pgErr.detail.includes('uq_roadmaps_goal'))
      ) {
        fail(
          409,
          'RESOURCE_CONFLICT',
          'A roadmap already exists for this career goal',
          undefined,
          false,
        );
      }
      if (
        pgErr.code === '23505' &&
        (pgErr.constraint === 'uq_roadmap_versions_one_draft' ||
          pgErr.message.includes('uq_roadmap_versions_one_draft') ||
          pgErr.detail.includes('uq_roadmap_versions_one_draft'))
      ) {
        fail(
          409,
          'STALE_JOB_INPUT',
          'Source data changed before the job ran. Please refresh and try again.',
          undefined,
          false,
        );
      }
      throw error;
    }
  }
}
