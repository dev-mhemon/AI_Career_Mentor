import { Inject, Injectable } from '@nestjs/common';
import { PrivacyRetentionService } from '../../account/services/privacy-retention.service.js';
import type {
  AIRequestDTO,
  PracticeReviewOutput,
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
  PERFORMANCE_LEVEL_VALUES,
  type PerformanceLevel,
  type QuestionDifficulty,
} from '../../progress/dto/progress.dto.js';
import { EvidenceService } from '../../progress/services/evidence.service.js';
import type { ReviewStatus } from '../../quiz/dto/quiz.dto.js';
import {
  REVIEW_DIMENSION_SCORE_VALUES,
  type PracticeReviewDimensionsDTO,
  type ReviewDimensionScore,
} from '../dto/practice-review.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);
const JOB_READY_FORBIDDEN_PATTERN =
  /\b(job[\s-]?ready|guarantee[ds]?\s+(a\s+)?job|100%\s+placement)\b/i;

export const SUPPORTED_PRACTICE_REVIEW_JOB_KINDS = ['practice_review'] as const;
export type SupportedPracticeReviewJobKind =
  (typeof SUPPORTED_PRACTICE_REVIEW_JOB_KINDS)[number];

interface ParsedPracticeReviewPayload {
  reviewId: string;
  attemptId: string;
  expectedSubmittedAt: string;
  expectedAnswerSavedAt: string;
}

interface ReviewExecutionSnapshotRow {
  review_id: string;
  attempt_id: string;
  question_id: string;
  user_id: string;
  review_status: ReviewStatus;
  attempt_status: string;
  attempt_no: number | string;
  submitted_at: Date | string | null;
  answer_text: string | null;
  raw_text_expires_at: Date | string | null;
  raw_text_purged_at: Date | string | null;
  answer_saved_at: Date | string | null;
  answer_created_at: Date | string | null;
  prompt: string;
  response_hint: string | null;
  rubric: unknown;
  difficulty: QuestionDifficulty;
  skill_id: string;
  skill_name: string;
  topic_id: string;
  topic_title: string;
  roadmap_id: string;
  career_level: CareerLevel;
}

function timestampsMatch(
  dbValue: Date | string | null | undefined,
  expectedIso: string,
): boolean {
  if (!dbValue) {
    return false;
  }
  const dbMs =
    dbValue instanceof Date
      ? dbValue.getTime()
      : new Date(String(dbValue)).getTime();
  const expectedMs = new Date(expectedIso).getTime();
  if (!Number.isFinite(dbMs) || !Number.isFinite(expectedMs)) {
    return false;
  }
  return Math.abs(dbMs - expectedMs) <= 1;
}

function parsePracticeReviewPayload(
  job: ClaimedJobRow,
): ParsedPracticeReviewPayload {
  if (job.job_kind !== 'practice_review') {
    fail(
      422,
      'INVALID_ENUM_VALUE',
      'Unsupported practice review job kind',
      undefined,
      false,
    );
  }
  const payload = job.input_payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Invalid practice_review job payload',
      undefined,
      false,
    );
  }
  if (payload.v !== 1) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Unsupported job envelope version',
      undefined,
      false,
    );
  }
  const args =
    payload.args &&
    typeof payload.args === 'object' &&
    !Array.isArray(payload.args)
      ? (payload.args as Record<string, unknown>)
      : null;
  const refs =
    payload.expected_refs &&
    typeof payload.expected_refs === 'object' &&
    !Array.isArray(payload.expected_refs)
      ? (payload.expected_refs as Record<string, unknown>)
      : null;
  if (!args || !refs) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Job envelope missing args or expected_refs',
      undefined,
      false,
    );
  }

  const reviewId =
    typeof args.review_id === 'string'
      ? args.review_id.trim().toLowerCase()
      : '';
  const attemptId =
    typeof args.attempt_id === 'string'
      ? args.attempt_id.trim().toLowerCase()
      : '';
  const expectedSubmittedAt =
    typeof refs.submitted_at === 'string' ? refs.submitted_at.trim() : '';
  const expectedAnswerSavedAt =
    typeof refs.answer_saved_at === 'string' ? refs.answer_saved_at.trim() : '';

  if (
    !UUID_PATTERN.test(reviewId) ||
    !UUID_PATTERN.test(attemptId) ||
    !expectedSubmittedAt ||
    Number.isNaN(new Date(expectedSubmittedAt).getTime()) ||
    !expectedAnswerSavedAt ||
    Number.isNaN(new Date(expectedAnswerSavedAt).getTime())
  ) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Invalid practice_review job arguments',
      undefined,
      false,
    );
  }

  return {
    reviewId,
    attemptId,
    expectedSubmittedAt,
    expectedAnswerSavedAt,
  };
}

function normalizeAndValidatePracticeReviewOutput(
  rawOutput: unknown,
): PracticeReviewOutput {
  if (!rawOutput || typeof rawOutput !== 'object' || Array.isArray(rawOutput)) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI output failed validation and was discarded. Please try again.',
      undefined,
      true,
    );
  }
  const output = rawOutput as PracticeReviewOutput;
  if (
    output.review_status !== 'reviewed' &&
    output.review_status !== 'not_evidence'
  ) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Practice review review_status must be reviewed or not_evidence',
      undefined,
      true,
    );
  }

  const sanitizeList = (list: unknown, fieldName: string): string[] => {
    if (!Array.isArray(list)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        `Practice review ${fieldName} must be an array`,
        undefined,
        true,
      );
    }
    const items: string[] = [];
    for (const entry of list) {
      if (typeof entry !== 'string' || !entry.trim()) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          `Practice review ${fieldName} item must be a non-empty string`,
          undefined,
          true,
        );
      }
      const trimmed = entry.trim();
      if (JOB_READY_FORBIDDEN_PATTERN.test(trimmed)) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          `Practice review ${fieldName} contains forbidden readiness language`,
          undefined,
          true,
        );
      }
      items.push(trimmed);
    }
    return items;
  };

  const strengths = sanitizeList(output.strengths, 'strengths');
  const mistakes = sanitizeList(output.mistakes, 'mistakes');
  const weaknesses = sanitizeList(output.weaknesses, 'weaknesses');
  const improvementRecommendations = sanitizeList(
    output.improvement_recommendations,
    'improvement_recommendations',
  );

  if (output.review_status === 'not_evidence') {
    return {
      review_status: 'not_evidence',
      performance_level: null,
      dimensions: null,
      strengths: [],
      mistakes: [],
      weaknesses: [],
      improvement_recommendations:
        improvementRecommendations.length > 0
          ? improvementRecommendations
          : [
              'Submit a complete free-response explanation addressing the topic concepts.',
            ],
      evidence_eligible: false,
    };
  }

  if (
    typeof output.performance_level !== 'string' ||
    !(PERFORMANCE_LEVEL_VALUES as readonly string[]).includes(
      output.performance_level,
    )
  ) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Practice review performance_level must be good or needs_work',
      undefined,
      true,
    );
  }

  const rawDims = output.dimensions;
  if (!rawDims || typeof rawDims !== 'object' || Array.isArray(rawDims)) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Reviewed practice_review output must include dimensions',
      undefined,
      true,
    );
  }
  const validScores = REVIEW_DIMENSION_SCORE_VALUES as readonly string[];
  if (
    typeof rawDims.correctness !== 'string' ||
    !validScores.includes(rawDims.correctness) ||
    typeof rawDims.understanding !== 'string' ||
    !validScores.includes(rawDims.understanding) ||
    typeof rawDims.reasoning !== 'string' ||
    !validScores.includes(rawDims.reasoning)
  ) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Practice review dimensions must be good, partial, or weak',
      undefined,
      true,
    );
  }

  const dimensions: PracticeReviewDimensionsDTO = {
    correctness: rawDims.correctness as ReviewDimensionScore,
    understanding: rawDims.understanding as ReviewDimensionScore,
    reasoning: rawDims.reasoning as ReviewDimensionScore,
  };

  return {
    review_status: 'reviewed',
    performance_level: output.performance_level as PerformanceLevel,
    dimensions,
    strengths,
    mistakes,
    weaknesses,
    improvement_recommendations:
      improvementRecommendations.length > 0
        ? improvementRecommendations
        : [
            'Review the topic explanation and practice applying these concepts.',
          ],
    evidence_eligible: Boolean(output.evidence_eligible),
  };
}

/**
 * Durable async job handler for `practice_review` (`C08` §6.2.6, `R12`, `R13`).
 */
@Injectable()
export class PracticeReviewJobHandler implements JobHandler {
  readonly supportedKinds = SUPPORTED_PRACTICE_REVIEW_JOB_KINDS;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
    @Inject(PrivacyRetentionService)
    private readonly privacyRetentionService: PrivacyRetentionService,
    @Inject(EvidenceService)
    private readonly evidenceService: EvidenceService,
  ) {}

  canHandle(jobKind: string): jobKind is SupportedPracticeReviewJobKind {
    return (SUPPORTED_PRACTICE_REVIEW_JOB_KINDS as readonly string[]).includes(
      jobKind,
    );
  }

  private async runRead<T>(
    operation: (db: JobQueryExecutor) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        null,
        (db) => operation(db),
        false,
        false,
        true,
      );
    }
    return operation(this.database);
  }

  async execute(
    job: ClaimedJobRow,
    signal: AbortSignal,
  ): Promise<JobExecutionResult> {
    const parsed = parsePracticeReviewPayload(job);

    const row = await this.runRead(async (db) => {
      const rows = await db.query<ReviewExecutionSnapshotRow[]>(
        `SELECT pr.id AS review_id,
                pr.attempt_id,
                pr.question_id,
                pr.user_id,
                pr.review_status::text AS review_status,
                qa.status::text AS attempt_status,
                qa.attempt_no,
                qa.submitted_at,
                ans.answer_text,
                ans.raw_text_expires_at,
                ans.raw_text_purged_at,
                ans.saved_at AS answer_saved_at,
                ans.created_at AS answer_created_at,
                qq.prompt,
                qq.response_hint::text AS response_hint,
                qq.rubric,
                qq.difficulty::text AS difficulty,
                t.skill_id,
                s.canonical_name AS skill_name,
                t.id AS topic_id,
                t.title AS topic_title,
                dp.roadmap_id,
                t.career_level::text AS career_level
           FROM public.practice_reviews pr
           JOIN public.quiz_attempts qa
             ON qa.id = pr.attempt_id
            AND qa.user_id = pr.user_id
           JOIN public.quiz_answers ans
             ON ans.id = pr.answer_id
            AND ans.user_id = pr.user_id
           JOIN public.quiz_questions qq
             ON qq.id = pr.question_id
           JOIN public.daily_plan_items dpi
             ON dpi.id = qa.daily_plan_item_id
           JOIN public.daily_plans dp
             ON dp.id = dpi.plan_id
           JOIN public.quizzes q
             ON q.id = qa.quiz_id
           JOIN public.topics t
             ON t.id = q.topic_id
           JOIN public.skills s
             ON s.id = t.skill_id
          WHERE pr.id = $1
            AND pr.attempt_id = $2
            AND pr.user_id = $3
          LIMIT 1`,
        [parsed.reviewId, parsed.attemptId, job.user_id],
      );
      return Array.isArray(rows) ? rows[0] : undefined;
    });

    if (!row) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    const language: UiLanguage =
      typeof job.language === 'string' && VALID_LANGUAGES.has(job.language)
        ? (job.language as UiLanguage)
        : 'mixed';

    if (
      row.review_status === 'reviewed' ||
      row.review_status === 'not_evidence'
    ) {
      return {
        resultType: 'practice_review',
        resultId: parsed.reviewId,
        providerKey: '',
        modelId: '',
        promptVersionId: '',
        outputSchemaId: 'practice_review.v1',
        fallbackUsed: false,
        language,
        inputUnits: 0,
        outputUnits: 0,
        latencyMs: 1,
        output: null,
        skipAiGeneration: true,
      };
    }

    if (
      row.raw_text_purged_at !== null ||
      typeof row.answer_text !== 'string' ||
      row.answer_text.trim().length === 0 ||
      this.privacyRetentionService.isRawTextExpired({
        created_at: row.answer_created_at ?? row.answer_saved_at ?? new Date(0),
        raw_text_expires_at: row.raw_text_expires_at,
      })
    ) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Raw free-response text has expired or been purged.',
        undefined,
        false,
      );
    }

    if (
      !timestampsMatch(row.submitted_at, parsed.expectedSubmittedAt) ||
      !timestampsMatch(row.answer_saved_at, parsed.expectedAnswerSavedAt)
    ) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    const aiRequest: AIRequestDTO = {
      request_id: job.id,
      user_id: job.user_id,
      task: 'practice_review',
      feature_key: 'ai_practice_review',
      output_schema: 'practice_review.v1',
      language,
      idempotency_key: job.idempotency_key ?? job.id,
      untrusted_inputs: [row.answer_text],
      context: {
        review_id: parsed.reviewId,
        attempt_id: parsed.attemptId,
        question_id: row.question_id,
        question_prompt: row.prompt,
        response_hint: row.response_hint ?? 'text',
        rubric: row.rubric ?? {},
        difficulty: row.difficulty,
        career_level: row.career_level,
        topic_id: row.topic_id,
        topic_title: row.topic_title,
        skill_id: row.skill_id,
        skill_name: row.skill_name,
      },
      budget: {
        max_input_units: 8_000,
        max_output_units: 3_000,
        timeout_ms: 45_000,
      },
    };

    const aiResponse = await this.aiGateway.execute<PracticeReviewOutput>(
      aiRequest,
      { persistTelemetry: false, signal },
    );
    if (aiResponse.status !== 'ok' || !aiResponse.output) {
      fail(
        502,
        'AI_GENERATION_FAILED',
        'AI generation failed. No partial data was saved.',
        undefined,
        true,
      );
    }

    const validatedOutput = normalizeAndValidatePracticeReviewOutput(
      aiResponse.output,
    );

    return {
      resultType: 'practice_review',
      resultId: parsed.reviewId,
      providerKey: aiResponse.provider_id,
      modelId: aiResponse.model_id,
      promptVersionId: aiResponse.prompt_version_id,
      outputSchemaId: 'practice_review.v1',
      fallbackUsed: aiResponse.fallback_used,
      language,
      inputUnits: aiResponse.usage_units.input,
      outputUnits: aiResponse.usage_units.output,
      latencyMs: aiResponse.latency_ms,
      output: validatedOutput,
    };
  }

  async verifyExpectedRefs(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
  ): Promise<{ ok: boolean; reason?: string }> {
    const parsed = parsePracticeReviewPayload(job);

    const rows = await tx.query<
      Array<{
        review_id: string;
        review_status: ReviewStatus;
        attempt_status: string;
        submitted_at: Date | string | null;
        answer_text: string | null;
        raw_text_expires_at: Date | string | null;
        raw_text_purged_at: Date | string | null;
        answer_saved_at: Date | string | null;
        answer_created_at: Date | string | null;
      }>
    >(
      `SELECT pr.id AS review_id,
              pr.review_status::text AS review_status,
              qa.status::text AS attempt_status,
              qa.submitted_at,
              ans.answer_text,
              ans.raw_text_expires_at,
              ans.raw_text_purged_at,
              ans.saved_at AS answer_saved_at,
              ans.created_at AS answer_created_at
         FROM public.practice_reviews pr
         JOIN public.quiz_attempts qa
           ON qa.id = pr.attempt_id
          AND qa.user_id = pr.user_id
         JOIN public.quiz_answers ans
           ON ans.id = pr.answer_id
          AND ans.user_id = pr.user_id
        WHERE pr.id = $1
          AND pr.attempt_id = $2
          AND pr.user_id = $3
        LIMIT 1`,
      [parsed.reviewId, parsed.attemptId, job.user_id],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) {
      return { ok: false, reason: 'PRACTICE_REVIEW_NOT_FOUND' };
    }
    if (
      row.attempt_status !== 'submitted' &&
      row.attempt_status !== 'feedback_available'
    ) {
      return { ok: false, reason: 'ATTEMPT_NOT_SUBMITTED' };
    }
    if (!timestampsMatch(row.submitted_at, parsed.expectedSubmittedAt)) {
      return { ok: false, reason: 'SUBMITTED_AT_DRIFT' };
    }
    if (!timestampsMatch(row.answer_saved_at, parsed.expectedAnswerSavedAt)) {
      return { ok: false, reason: 'ANSWER_SAVED_AT_DRIFT' };
    }
    if (
      row.review_status !== 'reviewed' &&
      row.review_status !== 'not_evidence'
    ) {
      if (
        row.raw_text_purged_at !== null ||
        typeof row.answer_text !== 'string' ||
        row.answer_text.trim().length === 0 ||
        this.privacyRetentionService.isRawTextExpired({
          created_at:
            row.answer_created_at ?? row.answer_saved_at ?? new Date(0),
          raw_text_expires_at: row.raw_text_expires_at,
        })
      ) {
        return { ok: false, reason: 'RAW_RESPONSE_EXPIRED' };
      }
    }

    return { ok: true };
  }

  async persistArtifact(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    result: JobExecutionResult,
    context?: JobCommitContext,
  ): Promise<{ resultType: 'practice_review'; resultId: string }> {
    const parsed = parsePracticeReviewPayload(job);

    // Lock order: quiz_attempts -> practice_reviews
    const attemptRows = await tx.query<
      Array<{
        id: string;
        status: string;
        attempt_no: number | string;
        performance_level: PerformanceLevel | null;
        improvement_recommendations: unknown;
        topic_id: string;
        roadmap_id: string;
        career_level: CareerLevel;
        skill_id: string;
      }>
    >(
      `SELECT qa.id,
              qa.status::text AS status,
              qa.attempt_no,
              qa.performance_level::text AS performance_level,
              qa.improvement_recommendations,
              q.topic_id,
              dp.roadmap_id,
              t.career_level::text AS career_level,
              t.skill_id
         FROM public.quiz_attempts qa
         JOIN public.daily_plan_items dpi ON dpi.id = qa.daily_plan_item_id
         JOIN public.daily_plans dp ON dp.id = dpi.plan_id
         JOIN public.quizzes q ON q.id = qa.quiz_id
         JOIN public.topics t ON t.id = q.topic_id
        WHERE qa.id = $1
          AND qa.user_id = $2
        FOR UPDATE OF qa`,
      [parsed.attemptId, job.user_id],
    );
    const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
    if (!attempt) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    const reviewRows = await tx.query<
      Array<{
        id: string;
        question_id: string;
        review_status: ReviewStatus;
        difficulty: QuestionDifficulty;
        answer_text: string | null;
        raw_text_expires_at: Date | string | null;
        raw_text_purged_at: Date | string | null;
        answer_saved_at: Date | string | null;
        answer_created_at: Date | string | null;
      }>
    >(
      `SELECT pr.id,
              pr.question_id,
              pr.review_status::text AS review_status,
              qq.difficulty::text AS difficulty,
              ans.answer_text,
              ans.raw_text_expires_at,
              ans.raw_text_purged_at,
              ans.saved_at AS answer_saved_at,
              ans.created_at AS answer_created_at
         FROM public.practice_reviews pr
         JOIN public.quiz_questions qq ON qq.id = pr.question_id
         JOIN public.quiz_answers ans
           ON ans.id = pr.answer_id
          AND ans.user_id = pr.user_id
        WHERE pr.id = $1
          AND pr.attempt_id = $2
          AND pr.user_id = $3
        FOR UPDATE OF pr`,
      [parsed.reviewId, parsed.attemptId, job.user_id],
    );
    const review = Array.isArray(reviewRows) ? reviewRows[0] : undefined;
    if (!review) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    if (
      review.review_status === 'reviewed' ||
      review.review_status === 'not_evidence'
    ) {
      await this.finalizeAttemptIfReadyInTx(tx, job.user_id, attempt);
      return {
        resultType: 'practice_review',
        resultId: parsed.reviewId,
      };
    }

    if (
      review.raw_text_purged_at !== null ||
      typeof review.answer_text !== 'string' ||
      review.answer_text.trim().length === 0 ||
      this.privacyRetentionService.isRawTextExpired({
        created_at:
          review.answer_created_at ?? review.answer_saved_at ?? new Date(0),
        raw_text_expires_at: review.raw_text_expires_at ?? null,
      })
    ) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Raw free-response text has expired or been purged.',
        undefined,
        false,
      );
    }

    if (result.skipAiGeneration === true) {
      fail(
        502,
        'AI_GENERATION_FAILED',
        'AI generation failed. No partial data was saved.',
        undefined,
        true,
      );
    }

    const normalized = normalizeAndValidatePracticeReviewOutput(result.output);

    if (normalized.review_status === 'not_evidence') {
      await tx.query(
        `UPDATE public.practice_reviews
            SET review_status = 'not_evidence'::public.review_status,
                performance_level = NULL,
                dimensions = NULL,
                strengths = '[]'::jsonb,
                mistakes = '[]'::jsonb,
                weaknesses = '[]'::jsonb,
                improvement_recommendations = $2::jsonb,
                evidence_eligible = false,
                ai_generation_id = $3,
                failure_code = NULL,
                reviewed_at = clock_timestamp()
          WHERE id = $1
            AND user_id = $4`,
        [
          parsed.reviewId,
          JSON.stringify(normalized.improvement_recommendations),
          context?.aiGenerationId ?? null,
          job.user_id,
        ],
      );
    } else {
      await tx.query(
        `UPDATE public.practice_reviews
            SET review_status = 'reviewed'::public.review_status,
                performance_level = $2::public.performance_level,
                dimensions = $3::jsonb,
                strengths = $4::jsonb,
                mistakes = $5::jsonb,
                weaknesses = $6::jsonb,
                improvement_recommendations = $7::jsonb,
                evidence_eligible = $8,
                ai_generation_id = $9,
                failure_code = NULL,
                reviewed_at = clock_timestamp()
          WHERE id = $1
            AND user_id = $10`,
        [
          parsed.reviewId,
          normalized.performance_level,
          JSON.stringify(normalized.dimensions),
          JSON.stringify(normalized.strengths),
          JSON.stringify(normalized.mistakes),
          JSON.stringify(normalized.weaknesses),
          JSON.stringify(normalized.improvement_recommendations),
          normalized.evidence_eligible,
          context?.aiGenerationId ?? null,
          job.user_id,
        ],
      );

      if (
        normalized.evidence_eligible &&
        normalized.performance_level &&
        normalized.dimensions
      ) {
        await this.evidenceService.record(tx, {
          user_id: job.user_id,
          skill_id: attempt.skill_id,
          career_level: attempt.career_level,
          roadmap_id: attempt.roadmap_id,
          topic_id: attempt.topic_id,
          source_type: 'practice_review',
          source_id: parsed.reviewId,
          difficulty: review.difficulty,
          score_summary: {
            dimensions: normalized.dimensions,
            performance_level: normalized.performance_level,
          },
          performance_level: normalized.performance_level,
          attempt_no: Number(attempt.attempt_no),
          occurred_at: new Date().toISOString(),
          evidence_eligible: true,
        });
      }
    }

    await this.finalizeAttemptIfReadyInTx(tx, job.user_id, attempt);

    return {
      resultType: 'practice_review',
      resultId: parsed.reviewId,
    };
  }

  async onTerminalFailure(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    errorCode: string,
  ): Promise<void> {
    if (job.job_kind !== 'practice_review') {
      return;
    }

    let reviewId =
      typeof job.subject_id === 'string' &&
      UUID_PATTERN.test(job.subject_id.trim())
        ? job.subject_id.trim().toLowerCase()
        : null;
    let attemptId: string | null = null;

    const args =
      job.input_payload &&
      typeof job.input_payload === 'object' &&
      !Array.isArray(job.input_payload) &&
      job.input_payload.args &&
      typeof job.input_payload.args === 'object' &&
      !Array.isArray(job.input_payload.args)
        ? (job.input_payload.args as Record<string, unknown>)
        : null;

    if (
      args &&
      typeof args.review_id === 'string' &&
      UUID_PATTERN.test(args.review_id.trim())
    ) {
      reviewId = args.review_id.trim().toLowerCase();
    }
    if (
      args &&
      typeof args.attempt_id === 'string' &&
      UUID_PATTERN.test(args.attempt_id.trim())
    ) {
      attemptId = args.attempt_id.trim().toLowerCase();
    }

    if (!reviewId) {
      return;
    }

    if (attemptId) {
      await tx.query(
        `SELECT id
           FROM public.quiz_attempts
          WHERE id = $1
            AND user_id = $2
          FOR UPDATE`,
        [attemptId, job.user_id],
      );
    }

    await tx.query(
      `UPDATE public.practice_reviews
          SET review_status = 'failed'::public.review_status,
              failure_code = $3,
              reviewed_at = NULL
        WHERE id = $1
          AND user_id = $2
          AND review_status = 'pending'::public.review_status`,
      [reviewId, job.user_id, errorCode.slice(0, 80)],
    );
  }

  private async finalizeAttemptIfReadyInTx(
    tx: JobQueryExecutor,
    userId: string,
    attempt: {
      id: string;
      status: string;
      performance_level: PerformanceLevel | null;
      improvement_recommendations: unknown;
    },
  ): Promise<void> {
    const reviews = await tx.query<
      Array<{
        review_status: ReviewStatus;
        performance_level: PerformanceLevel | null;
        improvement_recommendations: unknown;
      }>
    >(
      `SELECT pr.review_status::text AS review_status,
              pr.performance_level::text AS performance_level,
              pr.improvement_recommendations
         FROM public.practice_reviews pr
         LEFT JOIN public.quiz_questions qq ON qq.id = pr.question_id
        WHERE pr.attempt_id = $1
          AND pr.user_id = $2
        ORDER BY qq.sort_order ASC NULLS LAST, pr.id ASC`,
      [attempt.id, userId],
    );
    const list = Array.isArray(reviews) ? reviews : [];
    if (list.length === 0) {
      return;
    }

    const hasPending = list.some((r) => r.review_status === 'pending');
    const hasFailed = list.some((r) => r.review_status === 'failed');
    if (hasPending || hasFailed) {
      return;
    }

    const mergedRecommendations: string[] = [];
    const appendRecs = (raw: unknown) => {
      if (!Array.isArray(raw)) {
        return;
      }
      for (const item of raw) {
        if (
          typeof item === 'string' &&
          item.trim().length > 0 &&
          !JOB_READY_FORBIDDEN_PATTERN.test(item) &&
          !mergedRecommendations.includes(item.trim())
        ) {
          mergedRecommendations.push(item.trim());
        }
      }
    };

    appendRecs(attempt.improvement_recommendations);
    for (const r of list) {
      appendRecs(r.improvement_recommendations);
    }

    const combinedPerformance = this.combinePerformanceLevels(
      attempt.performance_level,
      list
        .filter((r) => r.review_status === 'reviewed')
        .map((r) => r.performance_level),
    );

    await tx.query(
      `UPDATE public.quiz_attempts
          SET status = 'feedback_available'::public.attempt_status,
              reviewed_at = COALESCE(reviewed_at, clock_timestamp()),
              performance_level = $3::public.performance_level,
              improvement_recommendations = $4::jsonb
        WHERE id = $1
          AND user_id = $2`,
      [
        attempt.id,
        userId,
        combinedPerformance,
        JSON.stringify(mergedRecommendations.slice(0, 6)),
      ],
    );
  }

  private combinePerformanceLevels(
    attemptPerf: PerformanceLevel | null,
    reviewPerfs: ReadonlyArray<PerformanceLevel | null>,
  ): PerformanceLevel {
    const levels: PerformanceLevel[] = [];
    if (attemptPerf === 'good' || attemptPerf === 'needs_work') {
      levels.push(attemptPerf);
    }
    for (const p of reviewPerfs) {
      if (p === 'good' || p === 'needs_work') {
        levels.push(p);
      }
    }
    if (levels.length === 0) {
      return 'needs_work';
    }
    const goodCount = levels.filter((lvl) => lvl === 'good').length;
    return goodCount >= Math.ceil(levels.length / 2) ? 'good' : 'needs_work';
  }
}
