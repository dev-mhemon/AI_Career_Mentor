import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  MAX_RATING_COMMENT_CODEPOINTS,
  MAX_REPORT_COMMENT_CODEPOINTS,
  UUID_PATTERN,
  normalizeFeedbackComment,
  validateRatingTargetType,
  validateReportReason,
  validateReportTargetType,
  type RatingRequestDTO,
  type RatingResponseDTO,
  type RatingTarget,
  type ReportRequestDTO,
  type ReportResponseDTO,
  type ReportTarget,
} from '../dto/feedback.dto.js';
import {
  SharedContentQualityService,
  type FeedbackQueryExecutor,
} from './shared-content-quality.service.js';

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

function isPostgresUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const candidate = err as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return candidate.code === '23505' || candidate.driverError?.code === '23505';
}

interface RatingUpsertRow {
  target_type: string;
  target_id: string;
  score: number | string;
}

interface ReportInsertRow {
  id: string;
}

/**
 * Quality Feedback service implementing `EP-F01` (`POST /api/v1/ratings`) and
 * `EP-F02` (`POST /api/v1/reports`) (`C05` §14.12 / §15.11, `PRD` §24 / §32, `R11`, `R24`, `R27`, `R34`).
 */
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SharedContentQualityService)
    private readonly sharedContentQuality: SharedContentQualityService,
  ) {}

  private assertAuthenticatedUserId(userId: unknown): string {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Application account required');
    }
    return userId.trim().toLowerCase();
  }

  private assertTargetUuid(raw: unknown, field = 'target_id'): string {
    if (typeof raw !== 'string' || !UUID_PATTERN.test(raw.trim())) {
      fail(422, 'VALIDATION_FAILED', 'Invalid request', [
        {
          field,
          code: 'VALIDATION_FAILED',
          message: 'Field has an invalid value',
        },
      ]);
    }
    return raw.trim().toLowerCase();
  }

  private assertRatingScore(raw: unknown): number {
    if (
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > 5
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid request', [
        {
          field: 'score',
          code: 'VALIDATION_FAILED',
          message: 'score must be an integer between 1 and 5',
        },
      ]);
    }
    return raw;
  }

  /**
   * Verifies `EP-F01` per-target ownership/delivery/exposure (`R34` — polymorphic UUID is never proof of access).
   */
  private async assertRatableTargetVisibleInTx(
    db: FeedbackQueryExecutor,
    userId: string,
    targetType: RatingTarget,
    targetId: string,
  ): Promise<void> {
    let rows: Array<{ id: string }> = [];

    switch (targetType) {
      case 'roadmap_draft': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT rv.id
             FROM public.roadmap_versions rv
             JOIN public.roadmaps r ON r.id = rv.roadmap_id
            WHERE rv.id = $2
              AND r.user_id = $1
              AND rv.user_id = $1
              AND (
                rv.state = 'draft'::public.roadmap_version_state
                OR rv.created_by <> 'merge'::public.roadmap_version_origin
              )
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
      case 'roadmap_merge': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT rm.id
             FROM public.roadmap_merges rm
             JOIN public.roadmaps r ON r.id = rm.roadmap_id
            WHERE rm.id = $2
              AND r.user_id = $1
              AND rm.user_id = $1
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
      case 'topic_content': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT t.id
             FROM public.topics t
            WHERE t.id = $2
              AND t.status = 'approved'::public.content_status
              AND t.deleted_at IS NULL
              AND (
                EXISTS (
                  SELECT 1
                    FROM public.roadmap_items ri
                    JOIN public.topics t_ri ON t_ri.id = ri.topic_id
                   WHERE ri.user_id = $1
                     AND ri.retired = false
                     AND (
                       ri.topic_id = t.id
                       OR (
                         t_ri.skill_id = t.skill_id
                         AND t_ri.slug = t.slug
                         AND t_ri.career_level = t.career_level
                       )
                     )
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.daily_plan_items dpi
                    JOIN public.topics t_dpi ON t_dpi.id = dpi.topic_id
                   WHERE dpi.user_id = $1
                     AND (
                       dpi.topic_id = t.id
                       OR (
                         t_dpi.skill_id = t.skill_id
                         AND t_dpi.slug = t.slug
                         AND t_dpi.career_level = t.career_level
                       )
                      )
                )
              )
            LIMIT 1
            FOR SHARE OF t`,
          [userId, targetId],
        );
        break;
      }
      case 'technology_update': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT tu.id
             FROM public.technology_updates tu
             JOIN public.update_delivery_history udh ON udh.update_id = tu.id
            WHERE tu.id = $2
              AND udh.user_id = $1
              AND udh.state = 'available'::public.update_state
              AND private.effective_feature_access($1, 'technology_update'::public.feature_key) = true
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      fail(404, 'TARGET_NOT_FOUND', 'Target not found or not visible');
    }
  }

  /**
   * Verifies `EP-F02` per-target ownership/prior-exposure (`R34` — hidden shared `topic_content` and
   * `quiz_question` remain reportable when the caller's stored roadmap/plan/attempt proves prior exposure).
   */
  private async assertReportableTargetExposedInTx(
    db: FeedbackQueryExecutor,
    userId: string,
    targetType: ReportTarget,
    targetId: string,
  ): Promise<void> {
    let rows: Array<{ id: string }> = [];

    switch (targetType) {
      case 'roadmap_content': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT r.id
             FROM public.roadmaps r
            WHERE r.id = $2
              AND r.user_id = $1
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
      case 'topic_content': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT t.id
             FROM public.topics t
            WHERE t.id = $2
              AND t.status <> 'draft'::public.content_status
              AND t.deleted_at IS NULL
              AND (
                EXISTS (
                  SELECT 1
                    FROM public.roadmap_items ri
                    JOIN public.topics t_ri ON t_ri.id = ri.topic_id
                   WHERE ri.user_id = $1
                     AND (
                       ri.topic_id = t.id
                       OR (
                         t_ri.skill_id = t.skill_id
                         AND t_ri.slug = t.slug
                         AND t_ri.career_level = t.career_level
                       )
                     )
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.daily_plan_items dpi
                    JOIN public.topics t_dpi ON t_dpi.id = dpi.topic_id
                   WHERE dpi.user_id = $1
                     AND (
                       dpi.topic_id = t.id
                       OR (
                         t_dpi.skill_id = t.skill_id
                         AND t_dpi.slug = t.slug
                         AND t_dpi.career_level = t.career_level
                       )
                     )
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.quiz_attempts qa
                    JOIN public.quizzes q ON q.id = qa.quiz_id
                    JOIN public.topics t_q ON t_q.id = q.topic_id
                   WHERE qa.user_id = $1
                     AND (
                       q.topic_id = t.id
                       OR (
                         t_q.skill_id = t.skill_id
                         AND t_q.slug = t.slug
                         AND t_q.career_level = t.career_level
                       )
                     )
                )
              )
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
      case 'quiz_question': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT qq.id
             FROM public.quiz_questions qq
            WHERE qq.id = $2
              AND EXISTS (
                SELECT 1
                  FROM public.quiz_attempts qa
                 WHERE qa.user_id = $1
                   AND qq.id = ANY(qa.question_ids)
              )
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
      case 'practice_review': {
        rows = await db.query<Array<{ id: string }>>(
          `SELECT pr.id
             FROM public.practice_reviews pr
            WHERE pr.id = $2
              AND pr.user_id = $1
            LIMIT 1`,
          [userId, targetId],
        );
        break;
      }
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      fail(404, 'TARGET_NOT_FOUND', 'Target not found or not visible');
    }
  }

  /**
   * `EP-F01` (`POST /api/v1/ratings`, `200 OK`, `AZ-USER`, `Gate: none`, `R24 foreground = true`).
   */
  async submitRating(
    userId: string,
    dto: RatingRequestDTO,
  ): Promise<RatingResponseDTO> {
    const normalizedUserId = this.assertAuthenticatedUserId(userId);
    const targetType = validateRatingTargetType(dto?.target_type);
    const targetId = this.assertTargetUuid(dto?.target_id, 'target_id');
    const score = this.assertRatingScore(dto?.score);
    const comment = normalizeFeedbackComment(
      dto?.comment,
      MAX_RATING_COMMENT_CODEPOINTS,
      'comment',
    );

    const saved = await this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertRatableTargetVisibleInTx(
          db,
          normalizedUserId,
          targetType,
          targetId,
        );

        const raw = await db.query<unknown>(
          `INSERT INTO public.user_ratings (
             user_id,
             target_type,
             target_id,
             score,
             comment
           )
           VALUES ($1, $2::public.rating_target, $3, $4, $5)
           ON CONFLICT (user_id, target_type, target_id)
           DO UPDATE SET
             score = EXCLUDED.score,
             comment = EXCLUDED.comment,
             updated_at = now()
           RETURNING target_type::text AS target_type, target_id, score`,
          [normalizedUserId, targetType, targetId, score, comment],
        );

        const row = extractReturningRows<RatingUpsertRow>(raw)[0];
        if (!row) {
          fail(500, 'INTERNAL_ERROR', 'Failed to persist rating');
        }
        return {
          target_type: row.target_type as RatingTarget,
          target_id: String(row.target_id),
          score: Number(row.score),
        };
      },
      true,
      true,
      true,
    );

    this.sharedContentQuality.recordRatingSubmitted({
      targetType: saved.target_type,
      targetId: saved.target_id,
      score: saved.score,
    });

    return saved;
  }

  /**
   * `EP-F02` (`POST /api/v1/reports`, `201 Created`, `AZ-USER`, `Gate: none`, `R24 foreground = true`).
   *
   * Implements `R27`: inside a `READ COMMITTED` transaction, acquires the target-scoped
   * `pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))` in a separate
   * preceding SQL statement BEFORE executing `INSERT INTO public.content_reports` so the
   * `AFTER INSERT` trigger (`trg_content_reports_threshold`) evaluates a fresh post-lock snapshot.
   */
  async submitReport(
    userId: string,
    dto: ReportRequestDTO,
  ): Promise<ReportResponseDTO> {
    const normalizedUserId = this.assertAuthenticatedUserId(userId);
    const targetType = validateReportTargetType(dto?.target_type);
    const targetId = this.assertTargetUuid(dto?.target_id, 'target_id');
    const reason = validateReportReason(dto?.reason);
    const comment = normalizeFeedbackComment(
      dto?.comment,
      MAX_REPORT_COMMENT_CODEPOINTS,
      'comment',
    );

    const saved = await this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertReportableTargetExposedInTx(
          db,
          normalizedUserId,
          targetType,
          targetId,
        );

        // R27: preceding READ COMMITTED statement acquires target advisory lock BEFORE INSERT snapshot.
        await db.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))`,
          [targetType, targetId],
        );

        // Self-heal valid integral decimal JSONB representations (e.g. 2.0) to canonical JSONB
        // integer before INSERT so frozen trigger trg_content_reports_threshold's ::integer cast
        // never fails (including on private practice_review reports); matches 0 rows (zero row
        // locks) when already canonical integer.
        await db.query(
          `UPDATE public.system_configurations
              SET config_value = to_jsonb((config_value #>> '{}')::numeric::integer)
            WHERE config_key = 'quality.report_auto_hide_threshold'
              AND jsonb_typeof(config_value) = 'number'
              AND (config_value #>> '{}') ~ '^[0-9]+\\.[0-9]+$'
              AND ((config_value #>> '{}')::numeric = trunc((config_value #>> '{}')::numeric))`,
        );

        let raw: unknown;
        try {
          // ON CONFLICT DO NOTHING avoids raising a DB unique-violation error that could log bound
          // comment parameters (R11) while still enforcing uq_content_reports_user_target atomically.
          raw = await db.query<unknown>(
            `INSERT INTO public.content_reports (
               user_id,
               target_type,
               target_id,
               reason,
               comment
             )
             VALUES ($1, $2::public.report_target, $3, $4::public.report_reason, $5)
             ON CONFLICT (user_id, target_type, target_id) DO NOTHING
             RETURNING id`,
            [normalizedUserId, targetType, targetId, reason, comment],
          );
        } catch (err: unknown) {
          if (isPostgresUniqueViolation(err)) {
            fail(
              409,
              'REPORT_ALREADY_SUBMITTED',
              'You have already submitted a report for this item',
            );
          }
          throw err;
        }

        const row = extractReturningRows<ReportInsertRow>(raw)[0];
        if (!row?.id) {
          fail(
            409,
            'REPORT_ALREADY_SUBMITTED',
            'You have already submitted a report for this item',
          );
        }
        return {
          report_id: String(row.id),
          status: 'received' as const,
        };
      },
      true,
      true,
      true,
    );

    this.sharedContentQuality.recordReportSubmitted({
      targetType,
      targetId,
      reason,
    });

    return saved;
  }
}
