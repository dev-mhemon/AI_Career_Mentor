import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import {
  ITEM_PRIORITY_VALUES,
  type ItemPriority,
  type PageMetaDTO,
} from '../../roadmap/dto/roadmap.dto.js';
import {
  LEARNING_STATE_VALUES,
  PG_INT4_MAX,
  RESOURCE_TYPE_VALUES,
  type LearningResourceDTO,
  type LearningResourceListResponseDTO,
  type LearningState,
  type ListLearningResourcesQueryDTO,
  type ListTopicsQueryDTO,
  type ResourceType,
  type TopicDetailDTO,
  type TopicImportantQuestionDTO,
  type TopicListResponseDTO,
  type TopicSourceRefDTO,
  type TopicSummaryDTO,
} from '../dto/learning.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

export interface CanonicalTopicRow {
  id: string;
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
  content_version: number | string;
  status: 'draft' | 'approved' | 'hidden' | 'retired';
  explanation_markdown: string | null;
  important_questions: unknown;
  language: 'bn' | 'en' | 'mixed';
  approved_at: Date | string | null;
}

export interface LearningResourceRow {
  id: string;
  title: string;
  publisher: string;
  url: string;
  resource_type: string;
  retrieved_at: Date | string | null;
  created_at?: Date | string;
}

interface OwnedTopicAccessRow {
  topic_id: string;
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
  content_version: number | string;
  status: 'draft' | 'approved' | 'hidden' | 'retired';
  explanation_markdown: string | null;
  important_questions: unknown;
  required_depth: string | null;
  learning_state: LearningState | null;
}

interface TopicSummaryRow {
  item_id: string;
  sequence_no: number | string;
  topic_id: string;
  title: string;
  skill_id: string;
  priority: ItemPriority;
  career_level: CareerLevel;
  learning_state: LearningState | null;
  plan_day_no: number | string | null;
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

function normalizeImportantQuestions(
  raw: unknown,
): TopicImportantQuestionDTO[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: TopicImportantQuestionDTO[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as { question?: unknown }).question === 'string' &&
      typeof (item as { answer_markdown?: unknown }).answer_markdown ===
        'string'
    ) {
      out.push({
        question: (item as { question: string }).question,
        answer_markdown: (item as { answer_markdown: string }).answer_markdown,
      });
    }
  }
  return out;
}

function normalizeResourceType(raw: string): ResourceType {
  return (RESOURCE_TYPE_VALUES as readonly string[]).includes(raw)
    ? (raw as ResourceType)
    : 'other';
}

function encodeTopicCursor(sequenceNo: number, itemId: string): string {
  return Buffer.from(
    JSON.stringify({ sequence_no: sequenceNo, id: itemId }),
    'utf8',
  ).toString('base64url');
}

function decodeTopicCursor(raw: string): { sequenceNo: number; id: string } {
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
  const seq = (parsed as { sequence_no?: unknown }).sequence_no;
  const id = (parsed as { id?: unknown }).id;
  if (
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    seq > PG_INT4_MAX ||
    typeof id !== 'string' ||
    !UUID_PATTERN.test(id)
  ) {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor');
  }
  return { sequenceNo: seq, id: id.toLowerCase() };
}

function encodeResourceCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeResourceCursor(raw: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor');
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

/**
 * Service implementing `C05` §14.6 Topic & Learning Resource read endpoints (`EP-L05`, `EP-L06`, `EP-L07`)
 * and shared canonical approved-topic resolution (`PRD` §23, §28, §30).
 *
 * Guarantees:
 * - Strict tenant scoping: users can only inspect topics referenced in their own roadmaps.
 * - Canonical resolution by `(skill_id, slug, career_level)` with `status = 'approved' AND deleted_at IS NULL`
 *   so regenerated versions after report auto-hiding are served without mutating append-only `roadmap_items`.
 * - Never exposes internal `ai_generation_id`, `provider_key`, or `model_id` fields.
 */
@Injectable()
export class TopicContentService {
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

  /**
   * Resolves the single active approved canonical topic row for `(skillId, slug, careerLevel)`.
   */
  async findApprovedCanonicalTopicInTx(
    db: TransactionalQueryExecutor,
    skillId: string,
    slug: string,
    careerLevel: CareerLevel,
  ): Promise<CanonicalTopicRow | null> {
    const rows = await db.query<CanonicalTopicRow[]>(
      `SELECT id,
              skill_id,
              slug,
              title,
              career_level::text AS career_level,
              content_version,
              status::text AS status,
              explanation_markdown,
              important_questions,
              language::text AS language,
              approved_at
         FROM public.topics
        WHERE skill_id = $1
          AND slug = $2
          AND career_level = $3::public.career_level
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        ORDER BY content_version DESC
        LIMIT 1`,
      [skillId, slug, careerLevel],
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  /**
   * Loads approved attribution-only `learning_resources` for a topic.
   */
  async loadApprovedResourcesInTx(
    db: TransactionalQueryExecutor,
    topicId: string,
  ): Promise<LearningResourceRow[]> {
    const rows = await db.query<LearningResourceRow[]>(
      `SELECT id,
              title,
              publisher,
              url,
              resource_type::text AS resource_type,
              retrieved_at,
              created_at
         FROM public.learning_resources
        WHERE topic_id = $1
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC`,
      [topicId],
    );
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Checks whether the caller has already submitted a content report for `topic_content`.
   */
  async hasUserReportedTopicInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    topicId: string,
  ): Promise<boolean> {
    const rows = await db.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.content_reports
        WHERE user_id = $1
          AND target_type = 'topic_content'::public.report_target
          AND target_id = $2
        LIMIT 1`,
      [userId, topicId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Builds a safe `TopicDetailDTO` (zero provider/model/internal provenance leakage).
   */
  async buildTopicDetailInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    topic: CanonicalTopicRow,
    learningState: LearningState,
    requiredDepth: string,
  ): Promise<TopicDetailDTO> {
    const isApproved = topic.status === 'approved';
    if (!isApproved) {
      return {
        topic_id: String(topic.id),
        title: String(topic.title),
        career_level: topic.career_level,
        content_version: Number(topic.content_version),
        explanation_markdown: null,
        important_questions: [],
        sources: [],
        learning_state: learningState,
        required_depth: requiredDepth,
        rating_allowed: false,
        report_allowed: false,
      };
    }

    const [resources, alreadyReported] = await Promise.all([
      this.loadApprovedResourcesInTx(db, topic.id),
      this.hasUserReportedTopicInTx(db, userId, topic.id),
    ]);
    const sources: TopicSourceRefDTO[] = resources.map((res) => {
      const retrievedAt = toNullableIso(res.retrieved_at);
      return {
        publisher: String(res.publisher),
        url: String(res.url),
        ...(retrievedAt ? { retrieved_at: retrievedAt } : {}),
      };
    });

    return {
      topic_id: String(topic.id),
      title: String(topic.title),
      career_level: topic.career_level,
      content_version: Number(topic.content_version),
      explanation_markdown: String(topic.explanation_markdown ?? ''),
      important_questions: normalizeImportantQuestions(
        topic.important_questions,
      ),
      sources,
      learning_state: learningState,
      required_depth: requiredDepth,
      rating_allowed: true,
      report_allowed: !alreadyReported,
    };
  }

  private async verifyUserTopicAccessInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    topicId: string,
  ): Promise<OwnedTopicAccessRow | null> {
    const rows = await db.query<OwnedTopicAccessRow[]>(
      `SELECT t_req.id AS topic_id,
              t_req.skill_id,
              t_req.slug,
              t_req.title,
              t_req.career_level::text AS career_level,
              t_req.content_version,
              t_req.status::text AS status,
              t_req.explanation_markdown,
              t_req.important_questions,
              ri.required_depth,
              sp.learning_state::text AS learning_state
         FROM public.topics t_req
         JOIN public.roadmap_items ri
           ON ri.user_id = $1
          AND ri.retired = false
         JOIN public.topics t_ri
           ON t_ri.id = ri.topic_id
          AND t_ri.skill_id = t_req.skill_id
          AND t_ri.slug = t_req.slug
          AND t_ri.career_level = t_req.career_level
         LEFT JOIN public.skill_progress sp
           ON sp.user_id = $1
          AND sp.skill_id = t_req.skill_id
          AND sp.career_level = t_req.career_level
        WHERE t_req.id = $2
          AND t_req.deleted_at IS NULL
        ORDER BY CASE WHEN ri.topic_id = $2 THEN 0 ELSE 1 END, ri.created_at DESC
        LIMIT 1`,
      [userId, topicId],
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  /**
   * `EP-L05` (`GET /api/v1/learning/topics`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async listTopics(
    userId: string,
    query?: ListTopicsQueryDTO,
  ): Promise<TopicListResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const explicitRoadmapId =
      query?.roadmap_id !== undefined
        ? this.assertUuid(query.roadmap_id, 'roadmap_id', 'Roadmap id')
        : undefined;

    let priorityFilter: ItemPriority | undefined;
    if (query?.priority !== undefined) {
      const candidate = String(query.priority).trim().toLowerCase();
      if (!(ITEM_PRIORITY_VALUES as readonly string[]).includes(candidate)) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid topic priority filter', [
          {
            field: 'priority',
            code: 'INVALID_ENUM_VALUE',
            message: 'priority must be core, supporting, or optional',
          },
        ]);
      }
      priorityFilter = candidate as ItemPriority;
    }

    let learningStateFilter: LearningState | undefined;
    if (query?.learning_state !== undefined) {
      const candidate = String(query.learning_state).trim().toLowerCase();
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
      learningStateFilter = candidate as LearningState;
    }

    const limit = this.normalizeLimit(query?.limit);
    const decodedCursor =
      query?.cursor !== undefined ? decodeTopicCursor(query.cursor) : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        let roadmapRow:
          | {
              id: string;
              current_version_id: string | null;
              target_level: CareerLevel;
            }
          | undefined;

        if (explicitRoadmapId) {
          const rows = await db.query<
            Array<{
              id: string;
              current_version_id: string | null;
              target_level: CareerLevel;
            }>
          >(
            `SELECT id, current_version_id, target_level::text AS target_level
               FROM public.roadmaps
              WHERE user_id = $1
                AND id = $2
              LIMIT 1`,
            [normalizedUserId, explicitRoadmapId],
          );
          roadmapRow = Array.isArray(rows) ? rows[0] : undefined;
          if (!roadmapRow) {
            fail(404, 'RESOURCE_NOT_FOUND', 'Roadmap not found');
          }
        } else {
          const rows = await db.query<
            Array<{
              id: string;
              current_version_id: string | null;
              target_level: CareerLevel;
            }>
          >(
            `SELECT id, current_version_id, target_level::text AS target_level
               FROM public.roadmaps
              WHERE user_id = $1
                AND status = 'locked'::public.roadmap_status
                AND is_focus = true
              LIMIT 1`,
            [normalizedUserId],
          );
          roadmapRow = Array.isArray(rows) ? rows[0] : undefined;
          if (!roadmapRow) {
            return {
              items: [],
              meta: { limit, next_cursor: null },
            };
          }
        }

        let versionId = roadmapRow.current_version_id;
        if (!versionId) {
          const draftRows = await db.query<Array<{ id: string }>>(
            `SELECT id
               FROM public.roadmap_versions
              WHERE user_id = $1
                AND roadmap_id = $2
              ORDER BY version_no DESC
              LIMIT 1`,
            [normalizedUserId, roadmapRow.id],
          );
          versionId = Array.isArray(draftRows)
            ? (draftRows[0]?.id ?? null)
            : null;
        }
        if (!versionId) {
          return {
            items: [],
            meta: { limit, next_cursor: null },
          };
        }

        const params: unknown[] = [normalizedUserId, roadmapRow.id, versionId];
        const whereClauses: string[] = [
          'ri.user_id = $1',
          'ri.version_id = $3',
          'ri.retired = false',
          '(t.deleted_at IS NULL OR t_approved.id IS NOT NULL)',
        ];

        if (priorityFilter) {
          params.push(priorityFilter);
          whereClauses.push(
            `ri.priority = $${params.length}::public.item_priority`,
          );
        }
        if (learningStateFilter) {
          params.push(learningStateFilter);
          whereClauses.push(
            `COALESCE(sp.learning_state, 'not_started'::public.learning_state) = $${params.length}::public.learning_state`,
          );
        }
        if (decodedCursor) {
          params.push(decodedCursor.sequenceNo, decodedCursor.id);
          const seqParam = `$${params.length - 1}`;
          const idParam = `$${params.length}`;
          whereClauses.push(
            `(ri.sequence_no > ${seqParam} OR (ri.sequence_no = ${seqParam} AND ri.id > ${idParam}::uuid))`,
          );
        }

        params.push(limit + 1);
        const limitParam = `$${params.length}`;

        const rows = await db.query<TopicSummaryRow[]>(
          `SELECT ri.id AS item_id,
                  ri.sequence_no,
                  COALESCE(t_approved.id, t.id) AS topic_id,
                  COALESCE(t_approved.title, t.title, ri.title) AS title,
                  ri.skill_id,
                  ri.priority::text AS priority,
                  t.career_level::text AS career_level,
                  COALESCE(sp.learning_state::text, 'not_started') AS learning_state,
                  dpi.day_no AS plan_day_no
             FROM public.roadmap_items ri
             JOIN public.topics t ON t.id = ri.topic_id
             LEFT JOIN public.topics t_approved
               ON t_approved.skill_id = t.skill_id
              AND t_approved.slug = t.slug
              AND t_approved.career_level = t.career_level
              AND t_approved.status = 'approved'::public.content_status
              AND t_approved.deleted_at IS NULL
             LEFT JOIN public.skill_progress sp
               ON sp.user_id = $1
              AND sp.skill_id = ri.skill_id
              AND sp.career_level = t.career_level
             LEFT JOIN public.daily_plans dp
               ON dp.user_id = $1
              AND dp.roadmap_id = $2
             LEFT JOIN public.daily_plan_items dpi
               ON dpi.plan_id = dp.id
              AND dpi.user_id = $1
              AND dpi.lineage_id = ri.lineage_id
            WHERE ${whereClauses.join(' AND ')}
            ORDER BY ri.sequence_no ASC, ri.id ASC
            LIMIT ${limitParam}`,
          params,
        );

        const rowList = Array.isArray(rows) ? rows : [];
        const hasMore = rowList.length > limit;
        const pageRows = hasMore ? rowList.slice(0, limit) : rowList;

        const items: TopicSummaryDTO[] = pageRows.map((row) => ({
          topic_id: String(row.topic_id),
          title: String(row.title),
          skill_id: String(row.skill_id),
          priority: row.priority,
          career_level: row.career_level,
          learning_state: row.learning_state ?? 'not_started',
          plan_day_no:
            row.plan_day_no === null || row.plan_day_no === undefined
              ? null
              : Number(row.plan_day_no),
        }));

        const lastRow = pageRows[pageRows.length - 1];
        const meta: PageMetaDTO = {
          limit,
          next_cursor:
            hasMore && lastRow
              ? encodeTopicCursor(
                  Number(lastRow.sequence_no),
                  String(lastRow.item_id),
                )
              : null,
        };

        return { items, meta };
      },
      true,
      false,
    );
  }

  /**
   * `EP-L06` (`GET /api/v1/learning/topics/:id`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getTopic(userId: string, topicId: string): Promise<TopicDetailDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedTopicId = this.assertUuid(topicId, 'id', 'Topic id');

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const access = await this.verifyUserTopicAccessInTx(
          db,
          normalizedUserId,
          normalizedTopicId,
        );
        if (!access) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Topic not found');
        }

        const approved = await this.findApprovedCanonicalTopicInTx(
          db,
          access.skill_id,
          access.slug,
          access.career_level,
        );
        const targetTopic: CanonicalTopicRow = approved ?? {
          id: access.topic_id,
          skill_id: access.skill_id,
          slug: access.slug,
          title: access.title,
          career_level: access.career_level,
          content_version: access.content_version,
          status: access.status,
          explanation_markdown: access.explanation_markdown,
          important_questions: access.important_questions,
          language: 'mixed',
          approved_at: null,
        };

        return this.buildTopicDetailInTx(
          db,
          normalizedUserId,
          targetTopic,
          access.learning_state ?? 'not_started',
          String(access.required_depth ?? ''),
        );
      },
      true,
      false,
    );
  }

  /**
   * `EP-L07` (`GET /api/v1/learning/resources`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async listResources(
    userId: string,
    query: ListLearningResourcesQueryDTO,
  ): Promise<LearningResourceListResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const topicId = this.assertUuid(query?.topic_id, 'topic_id', 'Topic id');
    const limit = this.normalizeLimit(query?.limit);
    const offset =
      query?.cursor !== undefined ? decodeResourceCursor(query.cursor) : 0;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const access = await this.verifyUserTopicAccessInTx(
          db,
          normalizedUserId,
          topicId,
        );
        if (!access) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Topic not found');
        }

        const approved = await this.findApprovedCanonicalTopicInTx(
          db,
          access.skill_id,
          access.slug,
          access.career_level,
        );
        if (!approved && access.status !== 'approved') {
          return {
            items: [],
            meta: { limit, next_cursor: null },
          };
        }
        const resolvedTopicId = approved ? approved.id : access.topic_id;

        const rows = await db.query<LearningResourceRow[]>(
          `SELECT id,
                  title,
                  publisher,
                  url,
                  resource_type::text AS resource_type,
                  retrieved_at
             FROM public.learning_resources
            WHERE topic_id = $1
              AND status = 'approved'::public.content_status
              AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            LIMIT $2
            OFFSET $3`,
          [resolvedTopicId, limit + 1, offset],
        );

        const rowList = Array.isArray(rows) ? rows : [];
        const hasMore = rowList.length > limit;
        const pageRows = hasMore ? rowList.slice(0, limit) : rowList;

        const items: LearningResourceDTO[] = pageRows.map((row) => ({
          id: String(row.id),
          title: String(row.title),
          publisher: String(row.publisher),
          url: String(row.url),
          resource_type: normalizeResourceType(String(row.resource_type)),
          retrieved_at: toNullableIso(row.retrieved_at),
        }));

        const meta: PageMetaDTO = {
          limit,
          next_cursor: hasMore
            ? encodeResourceCursor(offset + pageRows.length)
            : null,
        };

        return { items, meta };
      },
      true,
      false,
    );
  }
}
