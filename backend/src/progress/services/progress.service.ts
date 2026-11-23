import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  LEARNING_STATE_VALUES,
  PG_INT4_MAX,
  type LearningState,
} from '../../learning/dto/learning.dto.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { PageMetaDTO } from '../../roadmap/dto/roadmap.dto.js';
import {
  CAREER_LEVEL_VALUES,
  type EvidenceSource,
  type GetProgressHistoryQueryDTO,
  type GetProgressQueryDTO,
  type GetSkillProgressDetailQueryDTO,
  type PaginatedProgressHistoryResult,
  type PaginatedProgressResult,
  type PerformanceLevel,
  type ProgressEventType,
  type ProgressHistoryItemDTO,
  type SkillLevelProgressDetailDTO,
  type SkillProgressDTO,
  type SkillProgressDetailDTO,
  type WeakAreaDTO,
} from '../dto/progress.dto.js';
import { isStrongEvidenceRecord } from './evidence.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

interface RoadmapContextRow {
  id: string;
  target_level: CareerLevel;
  current_version_id: string | null;
  status: 'draft' | 'locked' | 'archived';
}

interface SkillCatalogProgressRow {
  skill_id: string;
  name: string;
  career_level: CareerLevel;
  learning_state: LearningState;
  state_reason: string | null;
  last_evidence_at: Date | string | null;
  evidence_count: number | string;
}

interface SharedRoadmapSkillRow {
  skill_id: string;
  roadmap_id: string;
  required_depth: string | null;
}

interface EvidenceSummaryRow {
  id: string;
  skill_id: string;
  career_level: CareerLevel;
  topic_id: string;
  source_type: EvidenceSource;
  source_id: string;
  score_summary: Record<string, unknown> | null;
  performance_level: PerformanceLevel | null;
  attempt_no: number | string;
  occurred_at: Date | string;
}

interface HistoryRow {
  id: string;
  occurred_at: Date | string;
  skill_id: string;
  career_level: CareerLevel;
  event: ProgressEventType;
  from_state: LearningState | null;
  to_state: LearningState | null;
  reason: string | null;
  source: EvidenceSource | null;
  source_id: string | null;
  source_attempt_id: string | null;
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

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(raw: string): number {
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
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor');
  }
  const offset = (parsed as { offset?: unknown }).offset;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 1 ||
    offset > PG_INT4_MAX
  ) {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor');
  }
  return offset;
}

function encodeHistoryCursor(occurredAtIso: string, id: string): string {
  return Buffer.from(
    JSON.stringify({ occurred_at: occurredAtIso, id }),
    'utf8',
  ).toString('base64url');
}

function decodeHistoryCursor(raw: string): { occurredAt: string; id: string } {
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
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor');
  }
  const occurredAt = (parsed as { occurred_at?: unknown }).occurred_at;
  const id = (parsed as { id?: unknown }).id;
  if (
    typeof occurredAt !== 'string' ||
    Number.isNaN(new Date(occurredAt).getTime()) ||
    typeof id !== 'string' ||
    !UUID_PATTERN.test(id)
  ) {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor');
  }
  return {
    occurredAt: new Date(occurredAt).toISOString(),
    id: id.toLowerCase(),
  };
}

const STRICT_ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

function parseOptionalIsoBound(
  raw: string | undefined,
  field: string,
): string | null {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const invalidError = () =>
    fail(422, 'VALIDATION_FAILED', `${field} must be a valid ISO-8601 date`, [
      {
        field,
        code: 'INVALID_FORMAT',
        message: `${field} must be a valid ISO-8601 date or timestamp`,
      },
    ]);
  if (!STRICT_ISO_8601_PATTERN.test(trimmed)) {
    invalidError();
  }
  const datePart = trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    invalidError();
  }
  // Reject non-existent calendar dates (e.g. 2026-02-30) that V8 Date rolls forward
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    if (parsed.toISOString().slice(0, 10) !== datePart) {
      invalidError();
    }
    if (field === 'to') {
      const endOfDay = new Date(`${trimmed}T23:59:59.999Z`);
      return endOfDay.toISOString();
    }
  }
  return parsed.toISOString();
}

function computeRetryImproved(
  evidenceRowsDesc: readonly EvidenceSummaryRow[],
): boolean | null {
  const quizRows = evidenceRowsDesc.filter(
    (r) => r.source_type === 'quiz_attempt',
  );
  const retryRows = quizRows.filter((r) => Number(r.attempt_no) === 2);
  if (retryRows.length === 0) {
    return null;
  }

  let comparedBaselineCount = 0;
  for (const retry of retryRows) {
    const initial = quizRows.find(
      (r) =>
        Number(r.attempt_no) === 1 &&
        r.topic_id === retry.topic_id &&
        new Date(r.occurred_at).getTime() <=
          new Date(retry.occurred_at).getTime(),
    );
    if (!initial) {
      continue;
    }
    comparedBaselineCount += 1;
    const retryCorrect = Number(retry.score_summary?.mcq_correct ?? 0);
    const retryTotal = Number(retry.score_summary?.mcq_total ?? 0);
    const initCorrect = Number(initial.score_summary?.mcq_correct ?? 0);
    const initTotal = Number(initial.score_summary?.mcq_total ?? 0);
    const retryRatio = retryTotal > 0 ? retryCorrect / retryTotal : 0;
    const initRatio = initTotal > 0 ? initCorrect / initTotal : 0;

    if (
      retryRatio > initRatio ||
      (initial.performance_level === 'needs_work' &&
        retry.performance_level === 'good')
    ) {
      return true;
    }
  }
  return comparedBaselineCount > 0 ? false : null;
}

/**
 * Service implementing `C05` §14.9 / §15.9 / `R29` Progress read endpoints (`EP-G01`, `EP-G02`, `EP-G03`).
 *
 * Guarantees:
 * - Always runs with `Gate: none` and `R24 foreground = false` (readable even when feature flags are OFF).
 * - Strict tenant isolation (`user_id = $1`).
 * - Never fabricates progress (`EP-G02` returns only actual stored levels) and never exposes raw answer text or `"Job Ready"` wording.
 */
@Injectable()
export class ProgressService {
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

  private parseCareerLevelFilter(raw?: string): CareerLevel | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const candidate = String(raw).trim().toLowerCase();
    if (!(CAREER_LEVEL_VALUES as readonly string[]).includes(candidate)) {
      fail(422, 'INVALID_ENUM_VALUE', 'Invalid career_level filter', [
        {
          field: 'career_level',
          code: 'INVALID_ENUM_VALUE',
          message: 'career_level must be junior, mid, or senior',
        },
      ]);
    }
    return candidate as CareerLevel;
  }

  private parseLearningStateFilter(raw?: string): LearningState | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const candidate = String(raw).trim().toLowerCase();
    if (!(LEARNING_STATE_VALUES as readonly string[]).includes(candidate)) {
      fail(422, 'INVALID_ENUM_VALUE', 'Invalid learning_state filter', [
        {
          field: 'learning_state',
          code: 'INVALID_ENUM_VALUE',
          message:
            'learning_state must be not_started, learning, practicing, or proficient',
        },
      ]);
    }
    return candidate as LearningState;
  }

  /**
   * `EP-G01` (`GET /api/v1/progress`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getProgress(
    userId: string,
    query?: GetProgressQueryDTO,
  ): Promise<PaginatedProgressResult> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const explicitRoadmapId =
      query?.roadmap_id !== undefined
        ? this.assertUuid(query.roadmap_id, 'roadmap_id', 'Roadmap id')
        : undefined;
    const careerLevelFilter = this.parseCareerLevelFilter(query?.career_level);
    const learningStateFilter = this.parseLearningStateFilter(
      query?.learning_state,
    );
    const limit = this.normalizeLimit(query?.limit);
    const offset =
      query?.cursor !== undefined ? decodeOffsetCursor(query.cursor) : 0;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        let roadmap: RoadmapContextRow | undefined;
        if (explicitRoadmapId) {
          const rows = await db.query<RoadmapContextRow[]>(
            `SELECT r.id,
                    COALESCE(rv.target_level, cg.target_level, 'junior'::public.career_level)::text AS target_level,
                    r.current_version_id,
                    r.status::text AS status
               FROM public.roadmaps r
               LEFT JOIN public.roadmap_versions rv ON rv.id = r.current_version_id
               LEFT JOIN public.career_goals cg ON cg.id = r.career_goal_id
              WHERE r.user_id = $1
                AND r.id = $2
              LIMIT 1`,
            [normalizedUserId, explicitRoadmapId],
          );
          roadmap = Array.isArray(rows) ? rows[0] : undefined;
          if (!roadmap) {
            fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
          }
        } else {
          const rows = await db.query<RoadmapContextRow[]>(
            `SELECT r.id,
                    COALESCE(rv.target_level, cg.target_level, 'junior'::public.career_level)::text AS target_level,
                    r.current_version_id,
                    r.status::text AS status
               FROM public.roadmaps r
               LEFT JOIN public.roadmap_versions rv ON rv.id = r.current_version_id
               LEFT JOIN public.career_goals cg ON cg.id = r.career_goal_id
              WHERE r.user_id = $1
                AND r.status = 'locked'::public.roadmap_status
                AND r.is_focus = true
              LIMIT 1`,
            [normalizedUserId],
          );
          roadmap = Array.isArray(rows) ? rows[0] : undefined;
        }

        const effectiveCareerLevel: CareerLevel =
          careerLevelFilter ?? roadmap?.target_level ?? 'junior';

        let itemsTotal = 0;
        let itemsCompleted = 0;
        if (roadmap?.id) {
          const countsRows = await db.query<
            Array<{
              items_total: number | string;
              items_completed: number | string;
            }>
          >(
            `SELECT (
                      SELECT COUNT(*)::int
                        FROM public.roadmap_items ri
                       WHERE ri.user_id = $1
                         AND ri.version_id = $3
                         AND ri.retired = false
                    ) AS items_total,
                    (
                      SELECT COUNT(DISTINCT dpi.lineage_id)::int
                        FROM public.daily_plans dp
                        JOIN public.daily_plan_items dpi
                          ON dpi.plan_id = dp.id
                         AND dpi.user_id = $1
                        JOIN public.roadmap_items cri
                          ON cri.user_id = $1
                         AND cri.version_id = $3
                         AND cri.lineage_id = dpi.lineage_id
                         AND cri.retired = false
                       WHERE dp.user_id = $1
                         AND dp.roadmap_id = $2
                         AND dpi.status = 'completed'::public.plan_item_status
                    ) AS items_completed`,
            [normalizedUserId, roadmap.id, roadmap.current_version_id],
          );
          const countRow = Array.isArray(countsRows)
            ? countsRows[0]
            : undefined;
          itemsTotal = Math.max(0, Number(countRow?.items_total ?? 0));
          itemsCompleted = Math.max(0, Number(countRow?.items_completed ?? 0));
        }

        // Load active roadmap curriculum skills ordered by Daily Plan day / roadmap sequence (or fallback to all user skill_progress when no roadmap is active)
        const skillRows = await db.query<SkillCatalogProgressRow[]>(
          roadmap?.current_version_id
            ? `SELECT s.id AS skill_id,
                      s.canonical_name AS name,
                      COALESCE(sp.career_level, $3::public.career_level)::text AS career_level,
                      COALESCE(sp.learning_state, 'not_started'::public.learning_state)::text AS learning_state,
                      sp.state_reason,
                      sp.last_evidence_at,
                      COALESCE(sp.evidence_count, 0) AS evidence_count
                 FROM public.skills s
                 LEFT JOIN public.roadmap_items ri
                   ON ri.user_id = $1
                  AND ri.version_id = $2
                  AND ri.skill_id = s.id
                  AND ri.retired = false
                 LEFT JOIN public.daily_plans dp
                   ON dp.user_id = $1
                  AND dp.roadmap_id = $4
                 LEFT JOIN public.daily_plan_items dpi
                   ON dpi.plan_id = dp.id
                  AND dpi.user_id = $1
                  AND dpi.lineage_id = ri.lineage_id
                 LEFT JOIN public.skill_progress sp
                   ON sp.user_id = $1
                  AND sp.skill_id = s.id
                  AND sp.career_level = $3::public.career_level
                WHERE ri.id IS NOT NULL
                  AND s.deleted_at IS NULL
                GROUP BY s.id,
                         s.canonical_name,
                         sp.career_level,
                         sp.learning_state,
                         sp.state_reason,
                         sp.last_evidence_at,
                         sp.evidence_count
                ORDER BY COALESCE(MIN(dpi.day_no), 2147483647) ASC,
                         COALESCE(MIN(ri.sequence_no), 2147483647) ASC,
                         LOWER(s.canonical_name) ASC,
                         s.id ASC`
            : `SELECT s.id AS skill_id,
                      s.canonical_name AS name,
                      sp.career_level::text AS career_level,
                      sp.learning_state::text AS learning_state,
                      sp.state_reason,
                      sp.last_evidence_at,
                      sp.evidence_count
                 FROM public.skill_progress sp
                 JOIN public.skills s ON s.id = sp.skill_id
                WHERE sp.user_id = $1
                  AND s.deleted_at IS NULL
                ORDER BY LOWER(s.canonical_name) ASC, sp.career_level ASC`,
          roadmap?.current_version_id
            ? [
                normalizedUserId,
                roadmap.current_version_id,
                effectiveCareerLevel,
                roadmap.id,
              ]
            : [normalizedUserId],
        );

        const rawSkills = Array.isArray(skillRows) ? skillRows : [];

        // Load cross-roadmap sharing across all non-archived roadmaps of this user
        const sharedRows = await db.query<SharedRoadmapSkillRow[]>(
          `SELECT DISTINCT ri.skill_id,
                  r.id AS roadmap_id,
                  ri.required_depth
             FROM public.roadmaps r
             JOIN public.roadmap_items ri
               ON ri.user_id = r.user_id
              AND ri.version_id = r.current_version_id
              AND ri.retired = false
            WHERE r.user_id = $1
              AND r.status <> 'archived'::public.roadmap_status`,
          [normalizedUserId],
        );
        const sharedBySkill = new Map<string, string[]>();
        for (const row of Array.isArray(sharedRows) ? sharedRows : []) {
          const list = sharedBySkill.get(String(row.skill_id)) ?? [];
          const rmId = String(row.roadmap_id);
          if (rmId !== roadmap?.id && !list.includes(rmId)) {
            list.push(rmId);
            sharedBySkill.set(String(row.skill_id), list);
          }
        }

        // Load recent evidence for weak_area detection
        const evidenceRows = await db.query<EvidenceSummaryRow[]>(
          `SELECT id,
                  skill_id,
                  career_level::text AS career_level,
                  topic_id,
                  source_type::text AS source_type,
                  source_id,
                  score_summary,
                  performance_level::text AS performance_level,
                  attempt_no,
                  occurred_at
             FROM public.learning_evidence
            WHERE user_id = $1
            ORDER BY occurred_at DESC, created_at DESC`,
          [normalizedUserId],
        );
        const evidenceBySkillLevel = new Map<string, EvidenceSummaryRow[]>();
        for (const row of Array.isArray(evidenceRows) ? evidenceRows : []) {
          const key = `${row.skill_id}:${row.career_level}`;
          const list = evidenceBySkillLevel.get(key) ?? [];
          list.push(row);
          evidenceBySkillLevel.set(key, list);
        }

        const allMatchedSkills: SkillProgressDTO[] = [];
        const weakAreas: WeakAreaDTO[] = [];

        for (const row of rawSkills) {
          if (careerLevelFilter && row.career_level !== careerLevelFilter) {
            continue;
          }
          if (
            learningStateFilter &&
            row.learning_state !== learningStateFilter
          ) {
            continue;
          }

          const evKey = `${row.skill_id}:${row.career_level}`;
          const evList = evidenceBySkillLevel.get(evKey) ?? [];
          const recentTwo = evList.slice(0, 2);
          const weakCount = recentTwo.filter(
            (e) =>
              e.performance_level === 'needs_work' ||
              !isStrongEvidenceRecord(e),
          ).length;
          const needsWorkCount = recentTwo.filter(
            (e) => e.performance_level === 'needs_work',
          ).length;
          const isWeakArea =
            row.learning_state !== 'proficient' &&
            evList.length > 0 &&
            weakCount > 0 &&
            !isStrongEvidenceRecord(evList[0]!);

          if (isWeakArea) {
            const latestNeedsWork =
              evList[0]?.performance_level === 'needs_work';
            const reason =
              needsWorkCount >= 2
                ? 'Two recent attempts rated needs_work'
                : latestNeedsWork
                  ? 'Most recent practice attempt rated needs_work'
                  : weakCount >= 2
                    ? 'Two recent practice attempts scored below the strong-evidence benchmark'
                    : 'Most recent practice attempt scored below the strong-evidence benchmark';
            weakAreas.push({
              skill_id: String(row.skill_id),
              name: String(row.name),
              reason,
            });
          }

          allMatchedSkills.push({
            skill_id: String(row.skill_id),
            name: String(row.name),
            career_level: row.career_level,
            learning_state: row.learning_state,
            shared_with_roadmap_ids:
              sharedBySkill.get(String(row.skill_id)) ?? [],
            weak_area: isWeakArea,
            last_evidence_at: toNullableIso(row.last_evidence_at),
            state_reason: row.state_reason ?? null,
          });
        }

        const pagedSkills = allMatchedSkills.slice(offset, offset + limit);
        const hasMore = offset + limit < allMatchedSkills.length;
        const meta: PageMetaDTO = {
          limit,
          next_cursor: hasMore
            ? encodeOffsetCursor(offset + pagedSkills.length)
            : null,
        };

        return {
          progress: {
            roadmap_id: roadmap?.id ? String(roadmap.id) : null,
            career_level: effectiveCareerLevel,
            roadmap_progress: {
              items_total: itemsTotal,
              items_completed: itemsCompleted,
            },
            skills: pagedSkills,
            weak_areas: weakAreas,
          },
          meta,
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-G02` (`GET /api/v1/progress/skills/:skill_id`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   *
   * Returns at most the selected `career_level` when filtered and all available stored rows otherwise (`R29`).
   * Never fabricates progress or returns raw answer text.
   */
  async getSkillProgressDetail(
    userId: string,
    skillId: string,
    query?: GetSkillProgressDetailQueryDTO,
  ): Promise<SkillProgressDetailDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedSkillId = this.assertUuid(skillId, 'skill_id', 'Skill id');
    const careerLevelFilter = this.parseCareerLevelFilter(query?.career_level);

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const skillRows = await db.query<
          Array<{ id: string; canonical_name: string }>
        >(
          `SELECT id, canonical_name
             FROM public.skills
            WHERE id = $1
              AND deleted_at IS NULL
            LIMIT 1`,
          [normalizedSkillId],
        );
        const skill = Array.isArray(skillRows) ? skillRows[0] : undefined;
        if (!skill) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Skill not found');
        }

        const progressParams: unknown[] = [normalizedUserId, normalizedSkillId];
        const levelClause = careerLevelFilter
          ? ' AND career_level = $3::public.career_level'
          : '';
        if (careerLevelFilter) {
          progressParams.push(careerLevelFilter);
        }

        const progressRows = await db.query<
          Array<{
            career_level: CareerLevel;
            learning_state: LearningState;
            state_reason: string | null;
            last_evidence_at: Date | string | null;
          }>
        >(
          `SELECT career_level::text AS career_level,
                  learning_state::text AS learning_state,
                  state_reason,
                  last_evidence_at
             FROM public.skill_progress
            WHERE user_id = $1
              AND skill_id = $2${levelClause}
            ORDER BY CASE career_level
              WHEN 'junior'::public.career_level THEN 1
              WHEN 'mid'::public.career_level THEN 2
              WHEN 'senior'::public.career_level THEN 3
              ELSE 4
            END ASC`,
          progressParams,
        );

        const evidenceRows = await db.query<EvidenceSummaryRow[]>(
          `SELECT id,
                  skill_id,
                  career_level::text AS career_level,
                  topic_id,
                  source_type::text AS source_type,
                  source_id,
                  score_summary,
                  performance_level::text AS performance_level,
                  attempt_no,
                  occurred_at
             FROM public.learning_evidence
            WHERE user_id = $1
              AND skill_id = $2${levelClause}
            ORDER BY occurred_at DESC, created_at DESC`,
          progressParams,
        );

        const reqRows = await db.query<
          Array<{
            roadmap_id: string;
            career_level: CareerLevel;
            required_depth: string | null;
          }>
        >(
          `SELECT DISTINCT r.id AS roadmap_id,
                  t.career_level::text AS career_level,
                  ri.required_depth
             FROM public.roadmaps r
             JOIN public.roadmap_items ri
               ON ri.user_id = r.user_id
              AND ri.version_id = r.current_version_id
              AND ri.retired = false
             JOIN public.topics t ON t.id = ri.topic_id
            WHERE r.user_id = $1
              AND ri.skill_id = $2
              AND r.status <> 'archived'::public.roadmap_status`,
          [normalizedUserId, normalizedSkillId],
        );

        const evidenceByLevel = new Map<CareerLevel, EvidenceSummaryRow[]>();
        for (const ev of Array.isArray(evidenceRows) ? evidenceRows : []) {
          const list = evidenceByLevel.get(ev.career_level) ?? [];
          list.push(ev);
          evidenceByLevel.set(ev.career_level, list);
        }

        const reqsByLevel = new Map<
          CareerLevel,
          Array<{ roadmap_id: string; required_depth: string | null }>
        >();
        for (const req of Array.isArray(reqRows) ? reqRows : []) {
          const list = reqsByLevel.get(req.career_level) ?? [];
          list.push({
            roadmap_id: String(req.roadmap_id),
            required_depth: req.required_depth ?? null,
          });
          reqsByLevel.set(req.career_level, list);
        }

        const levels: SkillLevelProgressDetailDTO[] = (
          Array.isArray(progressRows) ? progressRows : []
        ).map((row) => {
          const levelEvidence = evidenceByLevel.get(row.career_level) ?? [];
          const quizAttempts = levelEvidence.filter(
            (e) => e.source_type === 'quiz_attempt',
          ).length;
          const practiceReviews = levelEvidence.filter(
            (e) => e.source_type === 'practice_review',
          ).length;

          return {
            career_level: row.career_level,
            learning_state: row.learning_state,
            state_reason: row.state_reason ?? null,
            last_evidence_at: toNullableIso(row.last_evidence_at),
            evidence_summary: {
              count: levelEvidence.length,
              quiz_attempts: quizAttempts,
              practice_reviews: practiceReviews,
              retry_improved: computeRetryImproved(levelEvidence),
            },
            roadmap_requirements: reqsByLevel.get(row.career_level) ?? [],
          };
        });

        return {
          skill_id: String(skill.id),
          name: String(skill.canonical_name),
          levels,
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-G03` (`GET /api/v1/progress/history`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   *
   * Derives `source_attempt_id` from `practice_reviews.attempt_id` for `practice_review` sources
   * and from `source_id` for `quiz_attempt` sources (`R29`).
   */
  async getProgressHistory(
    userId: string,
    query?: GetProgressHistoryQueryDTO,
  ): Promise<PaginatedProgressHistoryResult> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const skillIdFilter =
      query?.skill_id !== undefined
        ? this.assertUuid(query.skill_id, 'skill_id', 'Skill id')
        : undefined;
    const fromIso = parseOptionalIsoBound(query?.from, 'from');
    const toIso = parseOptionalIsoBound(query?.to, 'to');
    if (
      fromIso &&
      toIso &&
      new Date(fromIso).getTime() > new Date(toIso).getTime()
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'from date must be less than or equal to to date',
        [
          {
            field: 'from',
            code: 'VALIDATION_FAILED',
            message: 'from must not be after to',
          },
        ],
      );
    }

    const limit = this.normalizeLimit(query?.limit);
    const decodedCursor =
      query?.cursor !== undefined ? decodeHistoryCursor(query.cursor) : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const params: unknown[] = [normalizedUserId];
        const whereClauses: string[] = [
          'ah.user_id = $1',
          `NOT (
            ah.event_type = 'evidence_added'::public.progress_event_type
            AND ah.source_id IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM public.achievement_history ah2
               WHERE ah2.user_id = ah.user_id
                 AND ah2.skill_id = ah.skill_id
                 AND ah2.career_level = ah.career_level
                 AND ah2.source_type = ah.source_type
                 AND ah2.source_id = ah.source_id
                 AND ah2.event_type = 'state_change'::public.progress_event_type
            )
          )`,
        ];

        if (skillIdFilter) {
          params.push(skillIdFilter);
          whereClauses.push(`ah.skill_id = $${params.length}`);
        }
        if (fromIso) {
          params.push(fromIso);
          whereClauses.push(`ah.occurred_at >= $${params.length}::timestamptz`);
        }
        if (toIso) {
          params.push(toIso);
          whereClauses.push(`ah.occurred_at <= $${params.length}::timestamptz`);
        }
        if (decodedCursor) {
          params.push(decodedCursor.occurredAt, decodedCursor.id);
          const timeParam = `$${params.length - 1}`;
          const idParam = `$${params.length}`;
          whereClauses.push(
            `(ah.occurred_at < ${timeParam}::timestamptz OR (ah.occurred_at = ${timeParam}::timestamptz AND ah.id < ${idParam}::uuid))`,
          );
        }

        params.push(limit + 1);
        const limitParam = `$${params.length}`;

        const rows = await db.query<HistoryRow[]>(
          `SELECT ah.id,
                  ah.occurred_at,
                  ah.skill_id,
                  ah.career_level::text AS career_level,
                  ah.event_type::text AS event,
                  ah.from_state::text AS from_state,
                  ah.to_state::text AS to_state,
                  ah.reason,
                  ah.source_type::text AS source,
                  ah.source_id,
                  CASE
                    WHEN ah.source_type = 'quiz_attempt'::public.evidence_source THEN ah.source_id
                    WHEN ah.source_type = 'practice_review'::public.evidence_source THEN pr.attempt_id
                    ELSE NULL
                  END AS source_attempt_id
             FROM public.achievement_history ah
             LEFT JOIN public.practice_reviews pr
               ON ah.source_type = 'practice_review'::public.evidence_source
              AND pr.id = ah.source_id
              AND pr.user_id = $1
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY ah.occurred_at DESC, ah.id DESC
            LIMIT ${limitParam}`,
          params,
        );

        const rowList = Array.isArray(rows) ? rows : [];
        const hasMore = rowList.length > limit;
        const pageRows = hasMore ? rowList.slice(0, limit) : rowList;

        const items: ProgressHistoryItemDTO[] = pageRows.map((row) => ({
          id: String(row.id),
          occurred_at:
            toNullableIso(row.occurred_at) ?? new Date(0).toISOString(),
          skill_id: String(row.skill_id),
          career_level: row.career_level,
          event: row.event,
          from_state: row.from_state ?? null,
          to_state: row.to_state ?? null,
          reason: row.reason ?? null,
          source: row.source ?? null,
          source_id: row.source_id ? String(row.source_id) : null,
          source_attempt_id: row.source_attempt_id
            ? String(row.source_attempt_id)
            : null,
        }));

        const lastItem = items[items.length - 1];
        const meta: PageMetaDTO = {
          limit,
          next_cursor:
            hasMore && lastItem
              ? encodeHistoryCursor(lastItem.occurred_at, lastItem.id)
              : null,
        };

        return {
          items,
          meta,
        };
      },
      true,
      false,
    );
  }
}
