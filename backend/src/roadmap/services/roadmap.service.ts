import { Inject, Injectable } from '@nestjs/common';
import type { JobLanguage } from '../../jobs/services/job-producer.service.js';
import { JobProducerService } from '../../jobs/services/job-producer.service.js';
import type { EnqueuedJobAcceptedDto } from '../../jobs/services/job-producer.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { missingFields } from '../../common/profile-completeness.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import {
  hasNulOrUnpairedSurrogate,
  ITEM_PRIORITY_VALUES,
  ROADMAP_STATUS_VALUES,
  SKILL_GAP_TYPE_VALUES,
  type ArchiveRoadmapDTO,
  type ArchiveRoadmapResponseDTO,
  type FocusSwitchResponseDTO,
  type GenerateRoadmapRequestDTO,
  type GetRoadmapQueryDTO,
  type ItemPriority,
  type LevelOutlineDTO,
  type ListRoadmapsQueryDTO,
  type ListRoadmapVersionsQueryDTO,
  type LockRoadmapDTO,
  type LockRoadmapResponseDTO,
  type RevisionRequestDTO,
  type RoadmapDetailDTO,
  type RoadmapItemDTO,
  type RoadmapListResponseDTO,
  type RoadmapMilestoneDTO,
  type RoadmapPhaseDTO,
  type RoadmapSizeGuardrailDTO,
  type RoadmapSourceRefDTO,
  type RoadmapStatus,
  type RoadmapSummaryBlockDTO,
  type RoadmapSummaryDTO,
  type RoadmapVersionDTO,
  type RoadmapVersionListResponseDTO,
  type RoadmapVersionOrigin,
  type RoadmapVersionState,
  type SkillGapType,
} from '../dto/roadmap.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Matches an ISO-8601 / PostgreSQL `timestamptz` string with up to 6 fractional digits
 * and an explicit timezone (`Z` or `±HH[:MM]`).
 */
const PG_CURSOR_TIMESTAMPTZ_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?|[+-]15(?::?00)?)$/;

const POSITIVE_INT_PATTERN = /^[1-9][0-9]*$/;
const CAREER_LEVEL_SET: ReadonlySet<string> = new Set([
  'junior',
  'mid',
  'senior',
]);

const MAX_ACTIVE_ROADMAPS = 3;
const DEFAULT_SOFT_SIZE_MAX_TOPICS = 45;
const DEFAULT_ROADMAP_DRAFTS_PER_24H = 5;
const R26_MIN_OPERATIONAL_LIMIT = 1;
const R26_MAX_OPERATIONAL_LIMIT = 10_000;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const PG_INT4_MAX = 2_147_483_647;

interface CareerGoalForGenerationRow {
  id: string;
  user_id?: string;
  status: string;
  confirmed_role_id: string | null;
  target_level: CareerLevel | null;
  updated_at?: Date | string;
  updated_at_exact?: string | null;
}

interface ProfileForGenerationRow {
  current_role_title: string | null;
  education: string | null;
  experience_level: string | null;
  learning_preference: string | null;
  preferred_daily_hours: number | string | null;
  timezone: string | null;
  existing_skills_none: boolean | null;
  self_reported_skill_ids: string[] | null;
  updated_at?: Date | string;
  updated_at_exact?: string | null;
}

interface RoadmapSummaryRow {
  id: string;
  career_goal_id: string;
  canonical_role_id: string;
  role_name: string;
  target_level: CareerLevel;
  status: RoadmapStatus;
  is_focus: boolean;
  current_version_id: string | null;
  current_version_no: number | string | null;
  draft_version_no: number | string | null;
  has_open_draft: boolean;
  has_open_merge: boolean;
  has_daily_plan: boolean;
  current_stale: boolean | null;
  draft_stale: boolean | null;
  locked_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  updated_at_cursor?: string | null;
}

interface RoadmapHeaderRow {
  id: string;
  user_id?: string;
  career_goal_id: string;
  canonical_role_id: string;
  role_name?: string;
  target_level: CareerLevel;
  status: RoadmapStatus;
  is_focus: boolean;
  current_version_id: string | null;
  locked_at: Date | string | null;
  archived_at?: Date | string | null;
  created_at: Date | string;
  updated_at?: Date | string;
}

interface RoadmapVersionRow {
  id: string;
  roadmap_id?: string;
  version_no: number | string;
  state: RoadmapVersionState;
  created_by: RoadmapVersionOrigin;
  target_level: CareerLevel;
  base_version_id: string | null;
  merge_id: string | null;
  summary?: unknown;
  phases?: unknown;
  level_outline?: unknown;
  warnings?: unknown;
  stale: boolean;
  stale_reason?: string | null;
  locked_at: Date | string | null;
  superseded_at: Date | string | null;
  created_at: Date | string;
}

interface RoadmapItemRow {
  id: string;
  version_id?: string;
  lineage_id: string;
  topic_id: string;
  skill_id: string;
  phase_no: number | string;
  phase_title: string | null;
  title: string;
  priority: string;
  gap_type: string;
  required_depth: string | null;
  estimated_effort_hours: number | string | null;
  sequence_no: number | string;
  depends_on_lineage_ids: string[] | null;
  reason: string | null;
  retired: boolean;
  sources: unknown;
}

export interface RequestMutationContextOptions {
  idempotencyKey?: string;
  httpRequestId?: string;
  acceptLanguage?: string;
  ifMatch?: number;
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

function extractExactTimestamp(row: {
  updated_at_exact?: string | null;
  updated_at?: Date | string | null;
}): string {
  if (
    typeof row.updated_at_exact === 'string' &&
    row.updated_at_exact.trim().length > 0
  ) {
    return row.updated_at_exact.trim();
  }
  return toIsoTimestamp(row.updated_at);
}

/**
 * Unwraps TypeORM PostgreSQL `UPDATE ... RETURNING` tuple `[rows, rowCount]` into a plain row array.
 */
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

export function resolvePreferredLanguage(acceptLanguage?: string): JobLanguage {
  if (typeof acceptLanguage !== 'string' || !acceptLanguage.trim()) {
    return 'en';
  }
  const normalized = acceptLanguage.toLowerCase();
  const hasBn = /\bbn\b/.test(normalized);
  const hasEn = /\ben\b/.test(normalized);
  if (normalized.includes('mixed') || (hasBn && hasEn)) {
    return 'mixed';
  }
  if (hasBn) {
    return 'bn';
  }
  return 'en';
}

export function computeSizeGuardrail(
  activeTopicCount: number,
  softMaxTopics: number,
): RoadmapSizeGuardrailDTO {
  const safeCount = Math.max(0, Math.trunc(activeTopicCount));
  const safeLimit = Math.max(1, Math.trunc(softMaxTopics));
  const materiallyLarge = safeCount > safeLimit;
  return {
    active_topic_count: safeCount,
    soft_max_topics: safeLimit,
    materially_large: materiallyLarge,
    warning: materiallyLarge
      ? `This roadmap contains ${safeCount} active topics, exceeding the recommended soft size limit of ${safeLimit}.`
      : null,
  };
}

function encodeRoadmapCursor(updatedAt: Date | string, id: string): string {
  return Buffer.from(
    JSON.stringify({
      updated_at: toIsoTimestamp(updatedAt),
      id: id.toLowerCase(),
    }),
    'utf8',
  ).toString('base64url');
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

function decodeRoadmapCursor(rawCursor: string): {
  updatedAt: string;
  id: string;
} {
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { updated_at?: unknown; id?: unknown };
    const updatedAt =
      typeof parsed?.updated_at === 'string' ? parsed.updated_at.trim() : '';
    if (
      !updatedAt ||
      !isValidCalendarTimestamp(updatedAt) ||
      typeof parsed?.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id.trim())
    ) {
      throw new Error('Malformed roadmap cursor');
    }
    return {
      updatedAt,
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

function encodeVersionCursor(versionNo: number): string {
  return Buffer.from(
    JSON.stringify({ version_no: Math.trunc(versionNo) }),
    'utf8',
  ).toString('base64url');
}

function decodeVersionCursor(rawCursor: string): number {
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { version_no?: unknown };
    if (
      typeof parsed?.version_no !== 'number' ||
      !Number.isSafeInteger(parsed.version_no) ||
      parsed.version_no < 1 ||
      parsed.version_no > PG_INT4_MAX
    ) {
      throw new Error('Malformed version cursor');
    }
    return parsed.version_no;
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

function normalizeSummaryBlock(raw: unknown): RoadmapSummaryBlockDTO {
  const rec =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    current_situation:
      typeof rec.current_situation === 'string' ? rec.current_situation : '',
    target_interpretation:
      typeof rec.target_interpretation === 'string'
        ? rec.target_interpretation
        : '',
    expected_career_impact:
      typeof rec.expected_career_impact === 'string'
        ? rec.expected_career_impact
        : '',
    next_steps: Array.isArray(rec.next_steps)
      ? rec.next_steps.filter((s): s is string => typeof s === 'string')
      : [],
  };
}

function normalizeLevelOutline(raw: unknown): LevelOutlineDTO[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: LevelOutlineDTO[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    if (
      typeof rec.career_level !== 'string' ||
      !CAREER_LEVEL_SET.has(rec.career_level)
    ) {
      continue;
    }
    result.push({
      career_level: rec.career_level as CareerLevel,
      outline: Array.isArray(rec.outline)
        ? rec.outline.filter((line): line is string => typeof line === 'string')
        : [],
    });
  }
  return result;
}

function normalizeWarnings(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === 'string');
}

function normalizeSources(raw: unknown): RoadmapSourceRefDTO[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: RoadmapSourceRefDTO[] = [];
  for (const src of raw) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) {
      continue;
    }
    const rec = src as Record<string, unknown>;
    if (typeof rec.publisher === 'string' && typeof rec.url === 'string') {
      out.push({
        publisher: rec.publisher,
        url: rec.url,
        ...(typeof rec.retrieved_at === 'string'
          ? { retrieved_at: rec.retrieved_at }
          : {}),
      });
    }
  }
  return out;
}

function mapRoadmapItemRow(row: RoadmapItemRow): RoadmapItemDTO {
  const priority = ITEM_PRIORITY_VALUES.includes(row.priority as ItemPriority)
    ? (row.priority as ItemPriority)
    : 'core';
  const gapType = SKILL_GAP_TYPE_VALUES.includes(row.gap_type as SkillGapType)
    ? (row.gap_type as SkillGapType)
    : 'missing';
  const dependsOn = Array.isArray(row.depends_on_lineage_ids)
    ? row.depends_on_lineage_ids.map((id) => String(id))
    : [];
  const effort =
    row.estimated_effort_hours === null ||
    row.estimated_effort_hours === undefined
      ? null
      : Number(row.estimated_effort_hours);
  return {
    id: String(row.id),
    item_id: String(row.lineage_id),
    lineage_id: String(row.lineage_id),
    topic_id: String(row.topic_id),
    skill_id: String(row.skill_id),
    phase_no: Number(row.phase_no) || 1,
    phase_title: row.phase_title ?? null,
    title: String(row.title),
    priority,
    gap_type: gapType,
    required_depth: row.required_depth ?? null,
    estimated_effort_hours:
      effort !== null && Number.isFinite(effort) ? effort : null,
    sequence_no: Number(row.sequence_no) || 1,
    depends_on: dependsOn,
    depends_on_lineage_ids: dependsOn,
    reason: row.reason ?? null,
    retired: Boolean(row.retired),
    sources: normalizeSources(row.sources),
  };
}

function assembleRoadmapPhases(
  rawPhases: unknown,
  items: readonly RoadmapItemDTO[],
): RoadmapPhaseDTO[] {
  const phaseMap = new Map<number, RoadmapPhaseDTO>();
  if (Array.isArray(rawPhases)) {
    for (const rawPhase of rawPhases) {
      if (
        !rawPhase ||
        typeof rawPhase !== 'object' ||
        Array.isArray(rawPhase)
      ) {
        continue;
      }
      const rec = rawPhase as Record<string, unknown>;
      const phaseNo =
        typeof rec.phase_no === 'number' && Number.isInteger(rec.phase_no)
          ? rec.phase_no
          : Number(rec.phase_no);
      if (!Number.isInteger(phaseNo) || phaseNo < 1) {
        continue;
      }
      const milestones: RoadmapMilestoneDTO[] = [];
      if (Array.isArray(rec.milestones)) {
        for (const ms of rec.milestones) {
          if (ms && typeof ms === 'object' && !Array.isArray(ms)) {
            const msRec = ms as Record<string, unknown>;
            if (
              typeof msRec.id === 'string' &&
              typeof msRec.title === 'string'
            ) {
              milestones.push({ id: msRec.id, title: msRec.title });
            }
          }
        }
      }
      phaseMap.set(phaseNo, {
        phase_no: phaseNo,
        title:
          typeof rec.title === 'string' && rec.title.trim()
            ? rec.title.trim()
            : `Phase ${phaseNo}`,
        milestones,
        items: [],
      });
    }
  }

  for (const item of items) {
    let phase = phaseMap.get(item.phase_no);
    if (!phase) {
      phase = {
        phase_no: item.phase_no,
        title: item.phase_title ?? `Phase ${item.phase_no}`,
        milestones: [],
        items: [],
      };
      phaseMap.set(item.phase_no, phase);
    }
    phase.items.push(item);
  }

  return Array.from(phaseMap.values()).sort((a, b) => a.phase_no - b.phase_no);
}

/**
 * Service implementing `C05` §14.5 Roadmap API (`EP-R01`–`EP-R07`, `EP-R14`, `EP-R15`).
 *
 * Enforces:
 * - Deadlock-safe lock ordering (`public.users FOR UPDATE` via `DatabaseService.transaction` before domain locks).
 * - Write-boundary `private.effective_feature_access(user_id, 'roadmap_generator')` recheck on mutating AI/lock routes.
 * - Generation-off read, focus-switch, and archive accessibility (`Gate: none`).
 * - Safe partial unique index mutations (`uq_roadmaps_one_focus`: `is_focus = false` before `is_focus = true`).
 * - No raw instruction logging and no nested `DatabaseService.transaction(...)` calls.
 */
@Injectable()
export class RoadmapService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(JobProducerService)
    private readonly jobProducer: JobProducerService,
  ) {}

  private assertValidUserId(userId: string): string {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }
    return userId.trim();
  }

  private assertValidRoadmapId(roadmapId: string): string {
    if (typeof roadmapId !== 'string' || !UUID_PATTERN.test(roadmapId.trim())) {
      fail(400, 'INVALID_FORMAT', 'Roadmap id must be a valid UUID', [
        {
          field: 'id',
          code: 'INVALID_FORMAT',
          message: 'id must be a valid UUID',
        },
      ]);
    }
    return roadmapId.trim();
  }

  private async assertRoadmapGeneratorAccess(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const rows = await db.query<Array<{ enabled?: boolean }>>(
      "SELECT private.effective_feature_access($1, 'roadmap_generator') AS enabled",
      [userId],
    );
    const access = Array.isArray(rows) ? rows[0] : undefined;
    if (!access?.enabled) {
      fail(403, 'FEATURE_DISABLED', 'Roadmap generation access is disabled');
    }
  }

  private async readBoundedConfigInteger(
    db: TransactionalQueryExecutor,
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

  private async assertDraftQuotaWithin24h(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const limit = await this.readBoundedConfigInteger(
      db,
      'ai_quota.roadmap_drafts_per_24h',
      DEFAULT_ROADMAP_DRAFTS_PER_24H,
    );
    const rows = await db.query<Array<{ used_count: number | string }>>(
      `SELECT count(*)::int AS used_count
         FROM public.ai_requests
        WHERE user_id = $1
          AND task IN ('roadmap_generate'::public.ai_task, 'roadmap_revision'::public.ai_task)
          AND status <> 'failed'::public.job_status
          AND created_at > clock_timestamp() - interval '24 hours'`,
      [userId],
    );
    const usedCount = Number(
      Array.isArray(rows) ? (rows[0]?.used_count ?? 0) : 0,
    );
    if (Number.isFinite(usedCount) && usedCount >= limit) {
      fail(
        429,
        'RATE_LIMITED',
        'Daily roadmap draft generation limit reached. Please try again later.',
        undefined,
        true,
        3_600,
      );
    }
  }

  private async loadRoadmapDetailInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    roadmapId: string,
    selector:
      { mode: 'current' | 'draft' } | { mode: 'version_no'; versionNo: number },
  ): Promise<RoadmapDetailDTO> {
    const roadmapRows = await db.query<RoadmapHeaderRow[]>(
      `SELECT r.id,
              r.user_id,
              r.career_goal_id,
              r.canonical_role_id,
              cr.name AS role_name,
              r.target_level::text AS target_level,
              r.status::text AS status,
              r.is_focus,
              r.current_version_id,
              r.locked_at,
              r.created_at
         FROM public.roadmaps r
         JOIN public.career_roles cr ON cr.id = r.canonical_role_id
        WHERE r.user_id = $1
          AND r.id = $2`,
      [userId, roadmapId],
    );
    const roadmap = Array.isArray(roadmapRows) ? roadmapRows[0] : undefined;
    if (!roadmap) {
      fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
    }

    let versionRows: RoadmapVersionRow[];
    if (selector.mode === 'version_no') {
      versionRows = await db.query<RoadmapVersionRow[]>(
        `SELECT id,
                roadmap_id,
                version_no,
                state::text AS state,
                created_by::text AS created_by,
                target_level::text AS target_level,
                base_version_id,
                merge_id,
                summary,
                phases,
                level_outline,
                warnings,
                stale,
                stale_reason,
                locked_at,
                superseded_at,
                created_at
           FROM public.roadmap_versions
          WHERE user_id = $1
            AND roadmap_id = $2
            AND version_no = $3`,
        [userId, roadmapId, selector.versionNo],
      );
    } else if (selector.mode === 'draft') {
      versionRows = await db.query<RoadmapVersionRow[]>(
        `SELECT id,
                roadmap_id,
                version_no,
                state::text AS state,
                created_by::text AS created_by,
                target_level::text AS target_level,
                base_version_id,
                merge_id,
                summary,
                phases,
                level_outline,
                warnings,
                stale,
                stale_reason,
                locked_at,
                superseded_at,
                created_at
           FROM public.roadmap_versions
          WHERE user_id = $1
            AND roadmap_id = $2
            AND state = 'draft'
          LIMIT 1`,
        [userId, roadmapId],
      );
    } else if (roadmap.current_version_id) {
      versionRows = await db.query<RoadmapVersionRow[]>(
        `SELECT id,
                roadmap_id,
                version_no,
                state::text AS state,
                created_by::text AS created_by,
                target_level::text AS target_level,
                base_version_id,
                merge_id,
                summary,
                phases,
                level_outline,
                warnings,
                stale,
                stale_reason,
                locked_at,
                superseded_at,
                created_at
           FROM public.roadmap_versions
          WHERE user_id = $1
            AND roadmap_id = $2
            AND id = $3`,
        [userId, roadmapId, roadmap.current_version_id],
      );
    } else {
      versionRows = await db.query<RoadmapVersionRow[]>(
        `SELECT id,
                roadmap_id,
                version_no,
                state::text AS state,
                created_by::text AS created_by,
                target_level::text AS target_level,
                base_version_id,
                merge_id,
                summary,
                phases,
                level_outline,
                warnings,
                stale,
                stale_reason,
                locked_at,
                superseded_at,
                created_at
           FROM public.roadmap_versions
          WHERE user_id = $1
            AND roadmap_id = $2
          ORDER BY (state = 'draft') DESC, version_no DESC
          LIMIT 1`,
        [userId, roadmapId],
      );
    }

    const version = Array.isArray(versionRows) ? versionRows[0] : undefined;
    if (!version) {
      fail(404, 'VERSION_NOT_FOUND', 'Roadmap version not found');
    }

    const rawItems = await db.query<RoadmapItemRow[]>(
      `SELECT id,
              version_id,
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
        ORDER BY phase_no ASC, sequence_no ASC, id ASC`,
      [userId, version.id],
    );

    const items = (Array.isArray(rawItems) ? rawItems : []).map(
      mapRoadmapItemRow,
    );
    const activeTopicCount = items.filter((item) => !item.retired).length;
    const softMaxTopics = await this.readBoundedConfigInteger(
      db,
      'roadmap.soft_size_max_topics',
      DEFAULT_SOFT_SIZE_MAX_TOPICS,
    );
    const sizeGuardrail = computeSizeGuardrail(activeTopicCount, softMaxTopics);

    return {
      id: String(roadmap.id),
      career_goal_id: String(roadmap.career_goal_id),
      canonical_role_id: String(roadmap.canonical_role_id),
      role_name: String(roadmap.role_name ?? ''),
      target_level: version.target_level ?? roadmap.target_level,
      status: roadmap.status,
      is_focus: Boolean(roadmap.is_focus),
      version_id: String(version.id),
      version_no: Number(version.version_no),
      version_state: version.state,
      summary: normalizeSummaryBlock(version.summary),
      phases: assembleRoadmapPhases(version.phases, items),
      items,
      level_outline: normalizeLevelOutline(version.level_outline),
      size_guardrail: sizeGuardrail,
      warnings: normalizeWarnings(version.warnings),
      stale: Boolean(version.stale),
      stale_reason: version.stale_reason ?? null,
      locked_at:
        selector.mode === 'version_no'
          ? toNullableIsoTimestamp(version.locked_at)
          : toNullableIsoTimestamp(version.locked_at ?? roadmap.locked_at),
      created_at: toIsoTimestamp(version.created_at ?? roadmap.created_at),
    };
  }

  /**
   * `EP-R01` (`POST /api/v1/roadmaps/generate`, `202 Accepted`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  async generateRoadmap(
    userId: string,
    dto: GenerateRoadmapRequestDTO,
    options: RequestMutationContextOptions = {},
  ): Promise<EnqueuedJobAcceptedDto> {
    const normalizedUserId = this.assertValidUserId(userId);
    const rawGoalId =
      typeof dto?.career_goal_id === 'string'
        ? dto.career_goal_id.trim().toLowerCase()
        : '';
    if (!UUID_PATTERN.test(rawGoalId)) {
      fail(422, 'VALIDATION_FAILED', 'career_goal_id must be a valid UUID', [
        {
          field: 'career_goal_id',
          code: 'VALIDATION_FAILED',
          message: 'career_goal_id must be a valid UUID',
        },
      ]);
    }
    if (dto?.level_confirmed !== true) {
      fail(
        422,
        'LEVEL_NOT_CONFIRMED',
        'Target career level must be confirmed before generating a roadmap',
        [
          {
            field: 'level_confirmed',
            code: 'LEVEL_NOT_CONFIRMED',
            message: 'level_confirmed must be true',
          },
        ],
      );
    }
    const normalizedTargetLevel =
      typeof dto?.target_level === 'string'
        ? (dto.target_level.trim().toLowerCase() as CareerLevel)
        : undefined;
    if (
      normalizedTargetLevel === undefined ||
      !CAREER_LEVEL_SET.has(normalizedTargetLevel)
    ) {
      fail(
        422,
        'INVALID_ENUM_VALUE',
        'target_level must be junior, mid, or senior',
        [
          {
            field: 'target_level',
            code: 'INVALID_ENUM_VALUE',
            message: 'target_level must be junior, mid, or senior',
          },
        ],
      );
    }

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

        const goalRows = await db.query<CareerGoalForGenerationRow[]>(
          `SELECT id,
                  user_id,
                  status::text AS status,
                  confirmed_role_id,
                  target_level::text AS target_level,
                  updated_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_exact
             FROM public.career_goals
            WHERE user_id = $1
              AND id = $2
            FOR UPDATE`,
          [normalizedUserId, rawGoalId],
        );
        const goal = Array.isArray(goalRows) ? goalRows[0] : undefined;
        if (!goal) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Career goal not found');
        }
        if (
          goal.status !== 'confirmed' ||
          !goal.confirmed_role_id ||
          !goal.target_level
        ) {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Career goal must be confirmed before generating a roadmap',
          );
        }
        if (normalizedTargetLevel !== goal.target_level) {
          fail(
            422,
            'VALIDATION_FAILED',
            'target_level must match the confirmed goal target_level',
            [
              {
                field: 'target_level',
                code: 'VALIDATION_FAILED',
                message:
                  'target_level does not match the confirmed career goal level',
              },
            ],
          );
        }

        const profileRows = await db.query<ProfileForGenerationRow[]>(
          `SELECT p.current_role_title,
                  p.education,
                  p.experience_level::text AS experience_level,
                  pr.learning_preference,
                  p.preferred_daily_hours,
                  p.timezone,
                  p.existing_skills_none,
                  p.self_reported_skill_ids,
                  p.updated_at,
                  to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_exact
             FROM public.user_profiles p
             LEFT JOIN public.user_preferences pr ON pr.user_id = p.user_id
            WHERE p.user_id = $1`,
          [normalizedUserId],
        );
        const profile = Array.isArray(profileRows) ? profileRows[0] : undefined;
        const missing = missingFields(profile ?? {}, true);
        if (missing.length > 0) {
          fail(
            422,
            'PROFILE_INCOMPLETE',
            'Complete required profile fields before generating a roadmap',
            missing.map((field) => ({
              field,
              code: 'PROFILE_INCOMPLETE',
              message: `${field} is required`,
            })),
          );
        }

        const existingRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.roadmaps
            WHERE user_id = $1
              AND career_goal_id = $2
            LIMIT 1`,
          [normalizedUserId, rawGoalId],
        );
        if (Array.isArray(existingRows) && existingRows.length > 0) {
          fail(
            409,
            'RESOURCE_CONFLICT',
            'A roadmap already exists for this career goal',
          );
        }

        const activeCountRows = await db.query<
          Array<{ active_count?: number | string; count?: number | string }>
        >(
          `SELECT count(*)::int AS active_count
             FROM public.roadmaps
            WHERE user_id = $1
              AND status <> 'archived'`,
          [normalizedUserId],
        );
        const activeCountRow = Array.isArray(activeCountRows)
          ? activeCountRows[0]
          : undefined;
        const activeCount =
          Number(activeCountRow?.active_count ?? activeCountRow?.count ?? 0) ||
          0;
        if (activeCount >= MAX_ACTIVE_ROADMAPS) {
          fail(
            409,
            'ROADMAP_LIMIT_REACHED',
            'Maximum of 3 active career roadmaps reached',
          );
        }

        await this.assertDraftQuotaWithin24h(db, normalizedUserId);

        const goalUpdatedAt = extractExactTimestamp(goal);
        const profileUpdatedAt = extractExactTimestamp(profile ?? {});
        const language = resolvePreferredLanguage(options.acceptLanguage);

        return this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'roadmap_generate',
            envelope: {
              v: 1,
              args: { career_goal_id: rawGoalId },
              expected_refs: {
                goal_updated_at: goalUpdatedAt,
                profile_updated_at: profileUpdatedAt,
              },
            },
            idempotencyKey: options.idempotencyKey,
            subjectType: 'career_goal',
            subjectId: rawGoalId,
            httpRequestId: options.httpRequestId,
            language,
          },
          db,
        );
      },
      true,
      true,
    );
  }

  /**
   * `EP-R02` (`GET /api/v1/roadmaps`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async listRoadmaps(
    userId: string,
    query: ListRoadmapsQueryDTO = {},
  ): Promise<RoadmapListResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);

    let statusFilter: RoadmapStatus | undefined;
    if (query?.status !== undefined && query.status !== null) {
      const normalizedStatus = String(query.status).trim() as RoadmapStatus;
      if (!ROADMAP_STATUS_VALUES.includes(normalizedStatus)) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid roadmap status filter', [
          {
            field: 'status',
            code: 'INVALID_ENUM_VALUE',
            message: 'status must be draft, locked, or archived',
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
        ? decodeRoadmapCursor(query.cursor)
        : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const params: unknown[] = [normalizedUserId];
        const whereClauses: string[] = ['r.user_id = $1'];

        if (statusFilter) {
          params.push(statusFilter);
          whereClauses.push(
            `r.status = $${params.length}::public.roadmap_status`,
          );
        }

        if (decodedCursor) {
          params.push(decodedCursor.updatedAt);
          const updatedAtParam = `$${params.length}::timestamptz`;
          params.push(decodedCursor.id);
          const idParam = `$${params.length}::uuid`;
          whereClauses.push(
            `(r.updated_at < ${updatedAtParam} OR (r.updated_at = ${updatedAtParam} AND r.id < ${idParam}))`,
          );
        }

        params.push(limit + 1);
        const limitParam = `$${params.length}`;

        const rows = await db.query<RoadmapSummaryRow[]>(
          `SELECT r.id,
                  r.career_goal_id,
                  r.canonical_role_id,
                  cr.name AS role_name,
                  r.target_level::text AS target_level,
                  r.status::text AS status,
                  r.is_focus,
                  r.current_version_id,
                  cv.version_no AS current_version_no,
                  dv.version_no AS draft_version_no,
                  (dv.id IS NOT NULL) AS has_open_draft,
                  EXISTS (
                    SELECT 1
                      FROM public.roadmap_merges rm
                     WHERE rm.roadmap_id = r.id
                       AND rm.user_id = $1
                       AND rm.status = 'proposed'
                  ) AS has_open_merge,
                  EXISTS (
                    SELECT 1
                      FROM public.daily_plans dp
                     WHERE dp.roadmap_id = r.id
                       AND dp.user_id = $1
                  ) AS has_daily_plan,
                  COALESCE(cv.stale, false) AS current_stale,
                  COALESCE(dv.stale, false) AS draft_stale,
                  r.locked_at,
                  r.archived_at,
                  r.created_at,
                  r.updated_at,
                  to_char(r.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_cursor
             FROM public.roadmaps r
             JOIN public.career_roles cr ON cr.id = r.canonical_role_id
             LEFT JOIN public.roadmap_versions cv
               ON cv.id = r.current_version_id
              AND cv.user_id = $1
             LEFT JOIN public.roadmap_versions dv
               ON dv.roadmap_id = r.id
              AND dv.user_id = $1
              AND dv.state = 'draft'
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY r.updated_at DESC, r.id DESC
            LIMIT ${limitParam}`,
          params,
        );

        const rowList = Array.isArray(rows) ? rows : [];
        const hasMore = rowList.length > limit;
        const pageRows = hasMore ? rowList.slice(0, limit) : rowList;

        const items: RoadmapSummaryDTO[] = pageRows.map((row) => ({
          id: String(row.id),
          career_goal_id: String(row.career_goal_id),
          canonical_role_id: String(row.canonical_role_id),
          role_name: String(row.role_name),
          target_level: row.target_level,
          status: row.status,
          is_focus: Boolean(row.is_focus),
          current_version_id: row.current_version_id
            ? String(row.current_version_id)
            : null,
          current_version_no:
            row.current_version_no !== null &&
            row.current_version_no !== undefined
              ? Number(row.current_version_no)
              : null,
          draft_version_no:
            row.draft_version_no !== null && row.draft_version_no !== undefined
              ? Number(row.draft_version_no)
              : null,
          has_open_draft: Boolean(row.has_open_draft),
          has_open_merge: Boolean(row.has_open_merge),
          has_daily_plan: Boolean(row.has_daily_plan),
          stale: Boolean(row.current_stale || row.draft_stale),
          stale_draft: Boolean(row.draft_stale),
          locked_at: toNullableIsoTimestamp(row.locked_at),
          archived_at: toNullableIsoTimestamp(row.archived_at),
          created_at: toIsoTimestamp(row.created_at),
          updated_at: toIsoTimestamp(row.updated_at),
        }));

        const lastRow = pageRows[pageRows.length - 1];
        const nextCursor =
          hasMore && lastRow
            ? encodeRoadmapCursor(
                lastRow.updated_at_cursor ?? lastRow.updated_at,
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
   * `EP-R03` (`GET /api/v1/roadmaps/:id`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getRoadmap(
    userId: string,
    roadmapId: string,
    query: GetRoadmapQueryDTO = {},
  ): Promise<RoadmapDetailDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);

    const rawVersion =
      typeof query?.version === 'string' && query.version.trim().length > 0
        ? query.version.trim()
        : 'current';

    let selector:
      { mode: 'current' | 'draft' } | { mode: 'version_no'; versionNo: number };
    if (rawVersion === 'current' || rawVersion === 'draft') {
      selector = { mode: rawVersion };
    } else if (POSITIVE_INT_PATTERN.test(rawVersion)) {
      const parsed = Number(rawVersion);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > PG_INT4_MAX) {
        fail(400, 'INVALID_FORMAT', 'Invalid roadmap version query parameter', [
          {
            field: 'version',
            code: 'INVALID_FORMAT',
            message: 'version must be current, draft, or a positive integer',
          },
        ]);
      }
      selector = { mode: 'version_no', versionNo: parsed };
    } else {
      fail(400, 'INVALID_FORMAT', 'Invalid roadmap version query parameter', [
        {
          field: 'version',
          code: 'INVALID_FORMAT',
          message: 'version must be current, draft, or a positive integer',
        },
      ]);
    }

    return this.database.transaction(
      normalizedUserId,
      async (db) =>
        this.loadRoadmapDetailInTx(
          db,
          normalizedUserId,
          normalizedRoadmapId,
          selector,
        ),
      true,
      false,
    );
  }

  /**
   * `EP-R04` (`POST /api/v1/roadmaps/:id/revision`, `202 Accepted`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  async requestRevision(
    userId: string,
    roadmapId: string,
    dto: RevisionRequestDTO,
    options: RequestMutationContextOptions = {},
  ): Promise<EnqueuedJobAcceptedDto> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);

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
      const codePointCount = Array.from(trimmed).length;
      if (codePointCount < 1 || codePointCount > 2_000) {
        fail(
          422,
          'VALIDATION_FAILED',
          'instruction must be between 1 and 2000 Unicode code points',
          [
            {
              field: 'instruction',
              code: 'VALIDATION_FAILED',
              message:
                'instruction must contain between 1 and 2000 Unicode code points',
            },
          ],
        );
      }
      instruction = trimmed;
    }

    if (
      dto?.refresh_stale !== undefined &&
      dto.refresh_stale !== null &&
      typeof dto.refresh_stale !== 'boolean'
    ) {
      fail(422, 'VALIDATION_FAILED', 'refresh_stale must be a boolean', [
        {
          field: 'refresh_stale',
          code: 'VALIDATION_FAILED',
          message: 'refresh_stale must be a boolean',
        },
      ]);
    }
    const refreshStale = dto?.refresh_stale === true;

    if (instruction === undefined && !refreshStale) {
      fail(
        422,
        'VALIDATION_FAILED',
        'Either instruction or refresh_stale=true is required',
        [
          {
            field: 'instruction',
            code: 'VALIDATION_FAILED',
            message: 'Provide an instruction or set refresh_stale=true',
          },
        ],
      );
    }

    const bodyExpectedVersionNo = dto?.expected_version_no;
    const headerIfMatch = options.ifMatch;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRoadmapGeneratorAccess(db, normalizedUserId);

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
        if (roadmap.status !== 'draft') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Only draft roadmaps can be revised via draft revision',
          );
        }

        const draftRows = await db.query<
          Array<{ id: string; version_no: number | string; stale: boolean }>
        >(
          `SELECT id, version_no, stale
             FROM public.roadmap_versions
            WHERE user_id = $1
              AND roadmap_id = $2
              AND state = 'draft'
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const draft = Array.isArray(draftRows) ? draftRows[0] : undefined;
        if (!draft) {
          fail(409, 'NO_OPEN_DRAFT', 'No open draft version found');
        }
        const baseVersionNo = Number(draft.version_no);
        if (
          (bodyExpectedVersionNo !== undefined &&
            baseVersionNo !== bodyExpectedVersionNo) ||
          (headerIfMatch !== undefined && baseVersionNo !== headerIfMatch)
        ) {
          fail(
            409,
            'STALE_VERSION',
            'Draft version has changed; reload and retry',
          );
        }

        await this.assertDraftQuotaWithin24h(db, normalizedUserId);

        const language = resolvePreferredLanguage(options.acceptLanguage);
        return this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'roadmap_revision',
            envelope: {
              v: 1,
              args: {
                roadmap_id: normalizedRoadmapId,
                base_version_no: baseVersionNo,
                ...(instruction !== undefined ? { instruction } : {}),
                refresh_stale: refreshStale,
              },
              expected_refs: {
                roadmap_version: baseVersionNo,
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
      },
      true,
      true,
    );
  }

  /**
   * `EP-R05` (`POST /api/v1/roadmaps/:id/lock`, `200 OK`, `H-IDEM`, `Gate: write (roadmap_generator)`).
   */
  async lockRoadmap(
    userId: string,
    roadmapId: string,
    dto: LockRoadmapDTO = {},
    options: RequestMutationContextOptions = {},
  ): Promise<LockRoadmapResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);

    if (
      dto?.expected_version_no !== undefined &&
      dto?.version_no !== undefined &&
      dto.expected_version_no !== dto.version_no
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'expected_version_no and version_no must match when both are provided',
        [
          {
            field: 'expected_version_no',
            code: 'VALIDATION_FAILED',
            message: 'Conflicting version numbers provided',
          },
        ],
      );
    }

    const bodyExpectedVersionNo = dto?.expected_version_no ?? dto?.version_no;
    const headerIfMatch = options.ifMatch;
    if (bodyExpectedVersionNo === undefined && headerIfMatch === undefined) {
      fail(
        422,
        'VALIDATION_FAILED',
        'A version precondition (expected_version_no, version_no, or If-Match) is required to lock a roadmap',
        [
          {
            field: 'expected_version_no',
            code: 'VALIDATION_FAILED',
            message:
              'Provide expected_version_no, version_no, or an If-Match header',
          },
        ],
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
            is_focus: boolean;
            current_version_id: string | null;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  is_focus,
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
        if (roadmap.status !== 'draft') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Only draft roadmaps can be locked',
          );
        }

        const draftRows = await db.query<
          Array<{
            id: string;
            version_no: number | string;
            stale: boolean;
            state: RoadmapVersionState;
          }>
        >(
          `SELECT id,
                  version_no,
                  stale,
                  state::text AS state
             FROM public.roadmap_versions
            WHERE user_id = $1
              AND roadmap_id = $2
              AND state = 'draft'
            FOR UPDATE`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const draft = Array.isArray(draftRows) ? draftRows[0] : undefined;
        if (!draft) {
          fail(409, 'NO_OPEN_DRAFT', 'No open draft version found');
        }
        const draftVersionNo = Number(draft.version_no);
        if (
          (bodyExpectedVersionNo !== undefined &&
            draftVersionNo !== bodyExpectedVersionNo) ||
          (headerIfMatch !== undefined && draftVersionNo !== headerIfMatch)
        ) {
          fail(
            409,
            'STALE_VERSION',
            'Draft version has changed; reload and retry',
          );
        }
        if (draft.stale === true && dto?.acknowledge_stale !== true) {
          fail(
            409,
            'DRAFT_STALE',
            'Draft is stale; refresh or acknowledge staleness before locking',
          );
        }

        const countRows = await db.query<
          Array<{ active_topic_count?: number | string }>
        >(
          `SELECT count(*)::int AS active_topic_count
             FROM public.roadmap_items
            WHERE user_id = $1
              AND version_id = $2
              AND retired = false`,
          [normalizedUserId, draft.id],
        );
        const activeTopicCount = Number(
          Array.isArray(countRows)
            ? (countRows[0]?.active_topic_count ?? 0)
            : 0,
        );
        const softMaxTopics = await this.readBoundedConfigInteger(
          db,
          'roadmap.soft_size_max_topics',
          DEFAULT_SOFT_SIZE_MAX_TOPICS,
        );
        const sizeGuardrail = computeSizeGuardrail(
          activeTopicCount,
          softMaxTopics,
        );
        if (
          sizeGuardrail.materially_large &&
          dto?.confirm_large_roadmap !== true
        ) {
          fail(
            422,
            'LARGE_ROADMAP_CONFIRMATION_REQUIRED',
            'Large roadmap requires explicit confirmation before locking',
            [
              {
                field: 'confirm_large_roadmap',
                code: 'LARGE_ROADMAP_CONFIRMATION_REQUIRED',
                message:
                  sizeGuardrail.warning ??
                  'Roadmap exceeds soft size threshold; confirm_large_roadmap=true required',
              },
            ],
          );
        }

        const lockedVersionRaw = await db.query<unknown>(
          `UPDATE public.roadmap_versions
              SET state = 'locked'::public.roadmap_version_state,
                  locked_at = clock_timestamp()
            WHERE user_id = $1
              AND id = $2
              AND state = 'draft'
           RETURNING id, version_no, locked_at`,
          [normalizedUserId, draft.id],
        );
        const lockedVersion = extractReturningRows<{
          id: string;
          version_no: number | string;
          locked_at: Date | string;
        }>(lockedVersionRaw)[0];
        if (!lockedVersion) {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Unable to lock roadmap version',
          );
        }

        const existingFocusRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.roadmaps
            WHERE user_id = $1
              AND is_focus = true
            LIMIT 1`,
          [normalizedUserId],
        );
        const hasExistingFocus =
          Array.isArray(existingFocusRows) && existingFocusRows.length > 0;
        const shouldAutoFocus = !hasExistingFocus;

        const lockedRoadmapRaw = await db.query<unknown>(
          `UPDATE public.roadmaps
              SET status = 'locked'::public.roadmap_status,
                  current_version_id = $3,
                  locked_at = clock_timestamp(),
                  is_focus = $4
            WHERE user_id = $1
              AND id = $2
              AND status = 'draft'
           RETURNING id, is_focus, current_version_id, locked_at`,
          [normalizedUserId, normalizedRoadmapId, draft.id, shouldAutoFocus],
        );
        const lockedRoadmap = extractReturningRows<{
          id: string;
          is_focus: boolean;
          current_version_id: string;
          locked_at: Date | string;
        }>(lockedRoadmapRaw)[0];
        if (!lockedRoadmap) {
          fail(409, 'INVALID_STATE_TRANSITION', 'Unable to lock roadmap');
        }

        const profileRows = await db.query<
          Array<{ preferred_daily_hours: number | string | null }>
        >(
          `SELECT preferred_daily_hours
             FROM public.user_profiles
            WHERE user_id = $1`,
          [normalizedUserId],
        );
        const rawHours = Array.isArray(profileRows)
          ? profileRows[0]?.preferred_daily_hours
          : null;
        const preferredDailyHours =
          rawHours === null || rawHours === undefined ? null : Number(rawHours);

        return {
          roadmap_id: String(lockedRoadmap.id),
          status: 'locked',
          version_no: Number(lockedVersion.version_no),
          current_version_id: String(lockedRoadmap.current_version_id),
          is_focus: Boolean(lockedRoadmap.is_focus),
          locked_at: toIsoTimestamp(
            lockedRoadmap.locked_at ?? lockedVersion.locked_at,
          ),
          next_step: 'confirm_learning_hours',
          preferred_daily_hours:
            preferredDailyHours !== null && Number.isFinite(preferredDailyHours)
              ? preferredDailyHours
              : null,
          size_guardrail: sizeGuardrail,
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-R06` (`GET /api/v1/roadmaps/:id/versions`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async listVersions(
    userId: string,
    roadmapId: string,
    query: ListRoadmapVersionsQueryDTO = {},
  ): Promise<RoadmapVersionListResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);

    const rawLimit = query?.limit ?? DEFAULT_PAGE_LIMIT;
    const limit = Math.min(
      MAX_PAGE_LIMIT,
      Math.max(1, Math.trunc(Number(rawLimit) || DEFAULT_PAGE_LIMIT)),
    );
    const cursorVersionNo =
      typeof query?.cursor === 'string' && query.cursor.trim().length > 0
        ? decodeVersionCursor(query.cursor)
        : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const roadmapRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.roadmaps
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, normalizedRoadmapId],
        );
        if (!Array.isArray(roadmapRows) || roadmapRows.length === 0) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }

        const params: unknown[] = [normalizedUserId, normalizedRoadmapId];
        const whereClauses = ['user_id = $1', 'roadmap_id = $2'];
        if (cursorVersionNo !== null) {
          params.push(cursorVersionNo);
          whereClauses.push(`version_no < $${params.length}`);
        }
        params.push(limit + 1);
        const limitParam = `$${params.length}`;

        const rows = await db.query<RoadmapVersionRow[]>(
          `SELECT id,
                  version_no,
                  state::text AS state,
                  created_by::text AS created_by,
                  target_level::text AS target_level,
                  base_version_id,
                  merge_id,
                  stale,
                  locked_at,
                  superseded_at,
                  created_at
             FROM public.roadmap_versions
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY version_no DESC
            LIMIT ${limitParam}`,
          params,
        );

        const rowList = Array.isArray(rows) ? rows : [];
        const hasMore = rowList.length > limit;
        const pageRows = hasMore ? rowList.slice(0, limit) : rowList;

        const items: RoadmapVersionDTO[] = pageRows.map((row) => ({
          id: String(row.id),
          version_no: Number(row.version_no),
          state: row.state,
          created_by: row.created_by,
          target_level: row.target_level,
          base_version_id: row.base_version_id
            ? String(row.base_version_id)
            : null,
          merge_id: row.merge_id ? String(row.merge_id) : null,
          stale: Boolean(row.stale),
          locked_at: toNullableIsoTimestamp(row.locked_at),
          superseded_at: toNullableIsoTimestamp(row.superseded_at),
          created_at: toIsoTimestamp(row.created_at),
        }));

        const last = items[items.length - 1];
        return {
          items,
          meta: {
            limit,
            next_cursor:
              hasMore && last ? encodeVersionCursor(last.version_no) : null,
          },
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-R07` (`GET /api/v1/roadmaps/:id/versions/:version_no`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getVersion(
    userId: string,
    roadmapId: string,
    versionNo: number,
  ): Promise<RoadmapDetailDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);
    if (
      typeof versionNo !== 'number' ||
      !Number.isSafeInteger(versionNo) ||
      versionNo < 1 ||
      versionNo > PG_INT4_MAX
    ) {
      fail(400, 'INVALID_FORMAT', 'version_no must be a positive integer', [
        {
          field: 'version_no',
          code: 'INVALID_FORMAT',
          message: 'version_no must be a positive integer',
        },
      ]);
    }

    return this.database.transaction(
      normalizedUserId,
      async (db) =>
        this.loadRoadmapDetailInTx(db, normalizedUserId, normalizedRoadmapId, {
          mode: 'version_no',
          versionNo,
        }),
      true,
      false,
    );
  }

  /**
   * `EP-R14` (`POST /api/v1/roadmaps/:id/focus`, `200 OK`, `Gate: none`, `R24 foreground = true`).
   * Clears `is_focus = false` on any previously focused roadmap BEFORE setting `is_focus = true`
   * on the target locked roadmap (`uq_roadmaps_one_focus` safe).
   */
  async setFocus(
    userId: string,
    roadmapId: string,
  ): Promise<FocusSwitchResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const lockedRoadmaps = await db.query<
          Array<{ id: string; status: RoadmapStatus; is_focus: boolean }>
        >(
          `SELECT id, status::text AS status, is_focus
             FROM public.roadmaps
            WHERE user_id = $1
            ORDER BY id ASC
            FOR UPDATE`,
          [normalizedUserId],
        );
        const roadmaps = Array.isArray(lockedRoadmaps) ? lockedRoadmaps : [];
        const target = roadmaps.find(
          (r) =>
            String(r.id).toLowerCase() === normalizedRoadmapId.toLowerCase(),
        );
        if (!target) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
        }
        if (target.status !== 'locked') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Only locked roadmaps can be selected as the Focus roadmap',
          );
        }

        const hasOtherFocus = roadmaps.some(
          (r) =>
            Boolean(r.is_focus) &&
            String(r.id).toLowerCase() !== normalizedRoadmapId.toLowerCase(),
        );
        if (hasOtherFocus) {
          // Clear previous Focus BEFORE setting new Focus so uq_roadmaps_one_focus never collides.
          await db.query(
            `UPDATE public.roadmaps
                SET is_focus = false
              WHERE user_id = $1
                AND is_focus = true
                AND id <> $2`,
            [normalizedUserId, normalizedRoadmapId],
          );
        }

        if (!target.is_focus) {
          await db.query(
            `UPDATE public.roadmaps
                SET is_focus = true
              WHERE user_id = $1
                AND id = $2
                AND status = 'locked'`,
            [normalizedUserId, normalizedRoadmapId],
          );
        }

        const planRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.daily_plans
            WHERE user_id = $1
              AND roadmap_id = $2
            LIMIT 1`,
          [normalizedUserId, normalizedRoadmapId],
        );
        const existingPlan = Array.isArray(planRows) ? planRows[0] : undefined;
        if (existingPlan?.id) {
          return {
            focus_roadmap_id: String(target.id),
            daily_plan: {
              state: 'existing',
              plan_id: String(existingPlan.id),
              requires_learning_hours: false,
            },
          };
        }

        const profileRows = await db.query<
          Array<{ preferred_daily_hours: number | string | null }>
        >(
          `SELECT preferred_daily_hours
             FROM public.user_profiles
            WHERE user_id = $1`,
          [normalizedUserId],
        );
        const rawHours = Array.isArray(profileRows)
          ? profileRows[0]?.preferred_daily_hours
          : null;
        const parsedHours =
          rawHours === null || rawHours === undefined ? null : Number(rawHours);
        const hasLearningHours =
          parsedHours !== null &&
          Number.isFinite(parsedHours) &&
          parsedHours > 0;

        return {
          focus_roadmap_id: String(target.id),
          daily_plan: {
            state: 'missing',
            plan_id: null,
            requires_learning_hours: !hasLearningHours,
          },
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-R15` (`POST /api/v1/roadmaps/:id/archive`, `200 OK`, `Gate: none`, `R24 foreground = true`).
   * Sets `status = 'archived', is_focus = false` FIRST before deterministically promoting another
   * active `locked` roadmap (`ORDER BY locked_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1 FOR UPDATE`).
   */
  async archiveRoadmap(
    userId: string,
    roadmapId: string,
    dto?: ArchiveRoadmapDTO,
  ): Promise<ArchiveRoadmapResponseDTO> {
    const normalizedUserId = this.assertValidUserId(userId);
    const normalizedRoadmapId = this.assertValidRoadmapId(roadmapId);

    let archiveReason: string | null = null;
    if (dto?.reason !== undefined && dto.reason !== null) {
      if (
        typeof dto.reason !== 'string' ||
        hasNulOrUnpairedSurrogate(dto.reason)
      ) {
        fail(422, 'VALIDATION_FAILED', 'Archive reason contains invalid text', [
          {
            field: 'reason',
            code: 'VALIDATION_FAILED',
            message: 'reason must be well-formed Unicode text',
          },
        ]);
      }
      const trimmed = dto.reason.trim();
      if ([...trimmed].length > 500) {
        fail(
          422,
          'VALIDATION_FAILED',
          'Archive reason cannot exceed 500 characters',
          [
            {
              field: 'reason',
              code: 'VALIDATION_FAILED',
              message: 'reason must be at most 500 characters',
            },
          ],
        );
      }
      archiveReason = trimmed.length > 0 ? trimmed : null;
    }

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const roadmapRows = await db.query<
          Array<{
            id: string;
            career_goal_id: string;
            status: RoadmapStatus;
            is_focus: boolean;
          }>
        >(
          `SELECT id,
                  career_goal_id,
                  status::text AS status,
                  is_focus
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
          fail(409, 'INVALID_STATE_TRANSITION', 'Roadmap is already archived');
        }

        const wasFocus = Boolean(roadmap.is_focus);

        // Clear is_focus = false and set status = 'archived' FIRST so uq_roadmaps_one_focus stays valid.
        await db.query(
          `UPDATE public.roadmaps
              SET status = 'archived'::public.roadmap_status,
                  is_focus = false,
                  archived_at = clock_timestamp(),
                  archive_reason = COALESCE($3, archive_reason)
            WHERE user_id = $1
              AND id = $2`,
          [normalizedUserId, normalizedRoadmapId, archiveReason],
        );

        await db.query(
          `UPDATE public.career_goals
              SET status = 'discontinued'::public.goal_status,
                  discontinued_at = COALESCE(discontinued_at, clock_timestamp())
            WHERE user_id = $1
              AND id = $2
              AND status <> 'discontinued'`,
          [normalizedUserId, roadmap.career_goal_id],
        );

        let newFocusRoadmapId: string | null = null;
        if (wasFocus) {
          const replacementRows = await db.query<Array<{ id: string }>>(
            `SELECT id
               FROM public.roadmaps
              WHERE user_id = $1
                AND status = 'locked'
                AND id <> $2
              ORDER BY locked_at DESC NULLS LAST, created_at DESC, id DESC
              LIMIT 1
              FOR UPDATE`,
            [normalizedUserId, normalizedRoadmapId],
          );
          const replacement = Array.isArray(replacementRows)
            ? replacementRows[0]
            : undefined;
          if (replacement?.id) {
            newFocusRoadmapId = String(replacement.id);
            await db.query(
              `UPDATE public.roadmaps
                  SET is_focus = true
                WHERE user_id = $1
                  AND id = $2
                  AND status = 'locked'`,
              [normalizedUserId, newFocusRoadmapId],
            );
          }
        } else {
          const existingFocusRows = await db.query<Array<{ id: string }>>(
            `SELECT id
               FROM public.roadmaps
              WHERE user_id = $1
                AND status = 'locked'
                AND is_focus = true
              LIMIT 1`,
            [normalizedUserId],
          );
          const existingFocus = Array.isArray(existingFocusRows)
            ? existingFocusRows[0]
            : undefined;
          newFocusRoadmapId = existingFocus?.id
            ? String(existingFocus.id)
            : null;
        }

        return {
          archived_roadmap_id: String(roadmap.id),
          status: 'archived',
          new_focus_roadmap_id: newFocusRoadmapId,
        };
      },
      true,
      true,
    );
  }
}
