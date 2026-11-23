import { Inject, Injectable } from '@nestjs/common';
import { PrivacyRetentionService } from '../../account/services/privacy-retention.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { JobProducerService } from '../../jobs/services/job-producer.service.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import type { PerformanceLevel } from '../../progress/dto/progress.dto.js';
import type { ReviewStatus } from '../../quiz/dto/quiz.dto.js';
import { resolvePreferredLanguage } from '../../roadmap/services/roadmap.service.js';
import {
  REVIEW_DIMENSION_SCORE_VALUES,
  type ListPracticeReviewsQueryDTO,
  type PracticeFeedbackDTO,
  type PracticeReviewDimensionsDTO,
  type PracticeReviewSummaryDTO,
  type ReviewDimensionScore,
  type TriggerPracticeReviewOutcome,
} from '../dto/practice-review.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_POLL_RETRY_SECONDS = 3;

export interface PracticeReviewRequestOptions {
  httpRequestId?: string;
  acceptLanguage?: string;
}

interface PracticeReviewDetailRow {
  id: string;
  question_id: string;
  review_status: ReviewStatus;
  performance_level: PerformanceLevel | null;
  dimensions: unknown;
  strengths: unknown;
  mistakes: unknown;
  weaknesses: unknown;
  improvement_recommendations: unknown;
  evidence_eligible: boolean;
  has_report: boolean;
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return new Date(0).toISOString();
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim().length > 0) {
      out.push(item.trim());
    }
  }
  return out;
}

function parseDimensions(raw: unknown): PracticeReviewDimensionsDTO | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const valid = REVIEW_DIMENSION_SCORE_VALUES as readonly string[];
  if (
    typeof obj.correctness !== 'string' ||
    !valid.includes(obj.correctness) ||
    typeof obj.understanding !== 'string' ||
    !valid.includes(obj.understanding) ||
    typeof obj.reasoning !== 'string' ||
    !valid.includes(obj.reasoning)
  ) {
    return null;
  }
  return {
    correctness: obj.correctness as ReviewDimensionScore,
    understanding: obj.understanding as ReviewDimensionScore,
    reasoning: obj.reasoning as ReviewDimensionScore,
  };
}

/**
 * Service implementing `C05` §14.8 AI Practice Review API (`EP-PR01`–`EP-PR03`).
 */
@Injectable()
export class PracticeReviewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PrivacyRetentionService)
    private readonly privacyRetentionService: PrivacyRetentionService,
    @Inject(JobProducerService)
    private readonly jobProducer: JobProducerService,
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

  private async assertAiPracticeReviewFeatureEnabledInTx(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const rows = await db.query<Array<{ allowed: boolean }>>(
      `SELECT private.effective_feature_access($1, 'ai_practice_review'::public.feature_key) AS allowed`,
      [userId],
    );
    if (!Array.isArray(rows) || rows[0]?.allowed !== true) {
      fail(
        403,
        'FEATURE_DISABLED',
        'AI Practice Review is currently unavailable',
      );
    }
  }

  private async loadFeedbackDtoInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    reviewId: string,
  ): Promise<PracticeFeedbackDTO> {
    const rows = await db.query<PracticeReviewDetailRow[]>(
      `SELECT pr.id,
              pr.question_id,
              pr.review_status::text AS review_status,
              pr.performance_level::text AS performance_level,
              pr.dimensions,
              pr.strengths,
              pr.mistakes,
              pr.weaknesses,
              pr.improvement_recommendations,
              pr.evidence_eligible,
              EXISTS (
                SELECT 1
                  FROM public.content_reports cr
                 WHERE cr.user_id = pr.user_id
                   AND cr.target_type = 'practice_review'::public.report_target
                   AND cr.target_id = pr.id
              ) AS has_report
         FROM public.practice_reviews pr
        WHERE pr.id = $1
          AND pr.user_id = $2
        LIMIT 1`,
      [reviewId, userId],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) {
      fail(404, 'RESOURCE_NOT_FOUND', 'Practice review not found');
    }

    return {
      id: String(row.id),
      question_id: String(row.question_id),
      review_status: row.review_status,
      performance_level: row.performance_level ?? null,
      dimensions: parseDimensions(row.dimensions),
      strengths: parseStringArray(row.strengths),
      mistakes: parseStringArray(row.mistakes),
      weaknesses: parseStringArray(row.weaknesses),
      improvement_recommendations: parseStringArray(
        row.improvement_recommendations,
      ),
      evidence_eligible: Boolean(row.evidence_eligible),
      reportable: !row.has_report,
    };
  }

  /**
   * `EP-PR01` (`GET /api/v1/practice-review`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async listReviewsForAttempt(
    userId: string,
    query: ListPracticeReviewsQueryDTO,
  ): Promise<PracticeReviewSummaryDTO[]> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const attemptId = this.assertUuid(
      query?.quiz_attempt_id,
      'quiz_attempt_id',
      'Quiz attempt id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const attemptRows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.quiz_attempts
            WHERE id = $1
              AND user_id = $2
            LIMIT 1`,
          [attemptId, normalizedUserId],
        );
        if (!Array.isArray(attemptRows) || !attemptRows[0]) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        const rows = await db.query<
          Array<{
            id: string;
            question_id: string;
            review_status: ReviewStatus;
            performance_level: PerformanceLevel | null;
          }>
        >(
          `SELECT pr.id,
                  pr.question_id,
                  pr.review_status::text AS review_status,
                  pr.performance_level::text AS performance_level
             FROM public.practice_reviews pr
             JOIN public.quiz_questions qq ON qq.id = pr.question_id
            WHERE pr.attempt_id = $1
              AND pr.user_id = $2
            ORDER BY qq.sort_order ASC, pr.id ASC`,
          [attemptId, normalizedUserId],
        );

        return (Array.isArray(rows) ? rows : []).map((row) => ({
          id: String(row.id),
          question_id: String(row.question_id),
          review_status: row.review_status,
          performance_level: row.performance_level ?? null,
        }));
      },
      true,
      false,
    );
  }

  /**
   * `EP-PR02` (`GET /api/v1/practice-review/:id/feedback`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getReviewFeedback(
    userId: string,
    reviewId: string,
  ): Promise<PracticeFeedbackDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedReviewId = this.assertUuid(
      reviewId,
      'id',
      'Practice review id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) =>
        this.loadFeedbackDtoInTx(db, normalizedUserId, normalizedReviewId),
      true,
      false,
    );
  }

  /**
   * `EP-PR03` (`POST /api/v1/practice-review/:id/review`, `200`/`202`, `Gate: write (ai_practice_review)`, `R24 foreground = true`).
   */
  async triggerOrRetryReview(
    userId: string,
    reviewId: string,
    options?: PracticeReviewRequestOptions,
  ): Promise<TriggerPracticeReviewOutcome> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedReviewId = this.assertUuid(
      reviewId,
      'id',
      'Practice review id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertAiPracticeReviewFeatureEnabledInTx(
          db,
          normalizedUserId,
        );

        const lookupRows = await db.query<
          Array<{ id: string; attempt_id: string }>
        >(
          `SELECT id, attempt_id
             FROM public.practice_reviews
            WHERE id = $1
              AND user_id = $2
            LIMIT 1`,
          [normalizedReviewId, normalizedUserId],
        );
        const lookup = Array.isArray(lookupRows) ? lookupRows[0] : undefined;
        if (!lookup) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Practice review not found');
        }

        // Lock order: quiz_attempts -> practice_reviews
        const attemptRows = await db.query<
          Array<{
            id: string;
            status: string;
            submitted_at: Date | string | null;
          }>
        >(
          `SELECT id,
                  status::text AS status,
                  submitted_at
             FROM public.quiz_attempts
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [lookup.attempt_id, normalizedUserId],
        );
        const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        const reviewRows = await db.query<
          Array<{
            id: string;
            attempt_id: string;
            question_id: string;
            review_status: ReviewStatus;
            answer_text: string | null;
            raw_text_expires_at: Date | string | null;
            raw_text_purged_at: Date | string | null;
            answer_saved_at: Date | string | null;
            answer_created_at: Date | string | null;
          }>
        >(
          `SELECT pr.id,
                  pr.attempt_id,
                  pr.question_id,
                  pr.review_status::text AS review_status,
                  ans.answer_text,
                  ans.raw_text_expires_at,
                  ans.raw_text_purged_at,
                  ans.saved_at AS answer_saved_at,
                  ans.created_at AS answer_created_at
             FROM public.practice_reviews pr
             JOIN public.quiz_answers ans
               ON ans.id = pr.answer_id
              AND ans.user_id = pr.user_id
            WHERE pr.id = $1
              AND pr.user_id = $2
            FOR UPDATE OF pr`,
          [normalizedReviewId, normalizedUserId],
        );
        const review = Array.isArray(reviewRows) ? reviewRows[0] : undefined;
        if (!review) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Practice review not found');
        }

        // 1. Already reviewed -> idempotent 200 OK without re-running AI
        if (review.review_status === 'reviewed') {
          const body = await this.loadFeedbackDtoInTx(
            db,
            normalizedUserId,
            normalizedReviewId,
          );
          return {
            statusCode: 200,
            body,
          };
        }

        // 2. Non-attempt / junk marked not_evidence -> 409 REVIEW_NOT_RETRYABLE
        if (review.review_status === 'not_evidence') {
          fail(
            409,
            'REVIEW_NOT_RETRYABLE',
            'This response was recorded as a non-attempt and cannot be retried for AI review',
          );
        }

        // 3. Raw text purged or past 90-day privacy retention cutoff -> 410 RAW_RESPONSE_EXPIRED
        if (
          review.raw_text_purged_at !== null ||
          typeof review.answer_text !== 'string' ||
          review.answer_text.trim().length === 0 ||
          this.privacyRetentionService.isRawTextExpired({
            created_at:
              review.answer_created_at ?? review.answer_saved_at ?? new Date(0),
            raw_text_expires_at: review.raw_text_expires_at,
          })
        ) {
          fail(
            410,
            'RAW_RESPONSE_EXPIRED',
            'The raw free-response text has expired under the 90-day privacy retention policy',
          );
        }

        // 4. Serialize concurrent retry requests & reuse existing active practice_review job
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `practice-review:${normalizedUserId}:${normalizedReviewId}`,
        ]);

        const activeJobs = await db.query<
          Array<{ id: string; status: 'queued' | 'preparing' }>
        >(
          `SELECT id, status::text AS status
             FROM public.ai_requests
            WHERE user_id = $1
              AND job_kind = 'practice_review'::public.job_kind
              AND subject_type = 'practice_review'
              AND subject_id = $2
              AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            ORDER BY created_at DESC
            LIMIT 1`,
          [normalizedUserId, normalizedReviewId],
        );
        const activeJob = Array.isArray(activeJobs) ? activeJobs[0] : undefined;
        if (activeJob?.id) {
          return {
            statusCode: 202,
            body: {
              job_id: String(activeJob.id),
              kind: 'practice_review',
              status: activeJob.status,
              poll_url: `/api/v1/jobs/${String(activeJob.id)}`,
              retry_after_seconds: DEFAULT_POLL_RETRY_SECONDS,
            },
          };
        }

        await db.query(
          `UPDATE public.practice_reviews
              SET review_status = 'pending'::public.review_status,
                  failure_code = NULL
            WHERE id = $1
              AND user_id = $2`,
          [normalizedReviewId, normalizedUserId],
        );

        const submittedAtIso = toIsoString(attempt.submitted_at);
        const answerSavedAtIso = toIsoString(
          review.answer_saved_at ?? attempt.submitted_at,
        );
        const language = resolvePreferredLanguage(options?.acceptLanguage);

        const job = await this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'practice_review',
            envelope: {
              v: 1,
              args: {
                review_id: normalizedReviewId,
                attempt_id: String(review.attempt_id),
              },
              expected_refs: {
                submitted_at: submittedAtIso,
                answer_saved_at: answerSavedAtIso,
              },
            },
            subjectType: 'practice_review',
            subjectId: normalizedReviewId,
            httpRequestId: options?.httpRequestId,
            language,
          },
          db,
        );

        return {
          statusCode: 202,
          body: job,
        };
      },
      true,
      true,
    );
  }
}
