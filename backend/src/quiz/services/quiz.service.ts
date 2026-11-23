import { Inject, Injectable } from '@nestjs/common';
import { PrivacyRetentionService } from '../../account/services/privacy-retention.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { JobProducerService } from '../../jobs/services/job-producer.service.js';
import type { AttemptStatus } from '../../learning/dto/learning.dto.js';
import { DailyPlanService } from '../../learning/services/daily-plan.service.js';
import { TopicContentService } from '../../learning/services/topic-content.service.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { TransactionalQueryExecutor } from '../../profile/profile.service.js';
import type {
  PerformanceLevel,
  ProgressChangeSummaryDTO,
  QuestionDifficulty,
} from '../../progress/dto/progress.dto.js';
import { EvidenceService } from '../../progress/services/evidence.service.js';
import { resolvePreferredLanguage } from '../../roadmap/services/roadmap.service.js';
import type {
  GenerateQuizOutcome,
  QuestionType,
  QuizAnswerInputDTO,
  QuizAnswersPatchDTO,
  QuizAnswersSavedResponseDTO,
  QuizAttemptDTO,
  QuizGenerateDTO,
  QuizQuestionDTO,
  QuizQuestionOptionDTO,
  QuizResultDTO,
  QuizResultQuestionDTO,
  QuizSubmissionDTO,
  QuizSubmitResponseDTO,
  RetryQuizOutcome,
  ReviewStatus,
  SavedQuizAnswerDTO,
} from '../dto/quiz.dto.js';
import { QuizGradingService } from './quiz-grading.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_POLL_RETRY_SECONDS = 3;
const MAX_PATCH_ANSWERS = 40;
const MAX_ANSWER_TEXT_LENGTH = 8_000;

interface PlanItemLookupRow {
  id: string;
  plan_id: string;
  day_no: number | string;
  sort_order: number | string;
  status: 'pending' | 'in_progress' | 'completed';
  topic_id: string;
  roadmap_id: string;
  roadmap_status: 'draft' | 'locked' | 'archived';
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
}

interface QuizAttemptRow {
  id: string;
  user_id: string;
  daily_plan_item_id: string;
  quiz_id: string;
  attempt_no: number | string;
  retry_of_attempt_id: string | null;
  status: AttemptStatus;
  question_ids: string[];
  started_at: Date | string | null;
  submitted_at: Date | string | null;
  reviewed_at: Date | string | null;
  mcq_correct: number | string | null;
  mcq_total: number | string | null;
  performance_level: PerformanceLevel | null;
  improvement_recommendations: unknown;
}

/**
 * Safe projection from `public.quiz_questions` for pre-submission views (`EP-Q01`, `EP-Q02`, `EP-Q03`, `EP-Q07`).
 * Strictly omits `correct_option_id`, `explanation`, `rubric`, and `ai_generation_id`.
 */
interface SafeQuizQuestionRow {
  id: string;
  sort_order: number | string;
  question_type: QuestionType;
  difficulty: QuestionDifficulty;
  prompt: string;
  options: unknown;
  response_hint: string | null;
  max_length: number | string | null;
  allow_i_dont_know: boolean;
}

/**
 * Post-submission question projection (`EP-Q05` grading / `EP-Q06` results).
 * Still omits `rubric` on `EP-Q06` wire responses.
 */
interface GradingQuizQuestionRow extends SafeQuizQuestionRow {
  correct_option_id: string | null;
  explanation: string | null;
  rubric?: unknown;
}

interface SavedAnswerRow {
  id: string;
  question_id: string;
  selected_option_id: string | null;
  answer_text: string | null;
  i_dont_know: boolean;
  is_correct: boolean | null;
  saved_at: Date | string;
  raw_text_expires_at?: Date | string | null;
  raw_text_purged_at?: Date | string | null;
  created_at?: Date | string | null;
}

interface PracticeReviewRow {
  id: string;
  question_id: string;
  review_status: ReviewStatus;
  performance_level: PerformanceLevel | null;
  improvement_recommendations?: unknown;
}

export interface QuizRequestOptions {
  httpRequestId?: string;
  acceptLanguage?: string;
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

/**
 * Synthesizes a learner-safe reference explanation for post-submit free-response review (`EP-Q06`)
 * without exposing the raw grading `rubric` JSON object on the wire.
 */
function buildFreeResponseReferenceExplanation(
  explanation: string | null | undefined,
  rawRubric: unknown,
): string | null {
  if (typeof explanation === 'string' && explanation.trim().length > 0) {
    return explanation.trim();
  }
  if (!rawRubric || typeof rawRubric !== 'object') {
    return null;
  }
  const candidate = rawRubric as {
    correctness_criteria?: unknown;
    understanding_criteria?: unknown;
    reasoning_criteria?: unknown;
  };
  const collect = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((item): item is string => typeof item === 'string')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  const points = [
    ...collect(candidate.correctness_criteria),
    ...collect(candidate.understanding_criteria),
    ...collect(candidate.reasoning_criteria),
  ];
  if (points.length === 0) {
    return null;
  }
  return `Key concepts expected in a complete response:\n• ${points.join('\n• ')}`;
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

function normalizeQuestionOptions(
  raw: unknown,
): QuizQuestionOptionDTO[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: QuizQuestionOptionDTO[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as { option_id?: unknown }).option_id === 'string' &&
      typeof (item as { text?: unknown }).text === 'string'
    ) {
      out.push({
        option_id: (item as { option_id: string }).option_id,
        text: (item as { text: string }).text,
      });
    }
  }
  return out;
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0,
    )
    .map((s) => s.trim());
}

/**
 * Service implementing `C05` §14.7 / §15.7 Quiz API (`EP-Q01`–`EP-Q07`).
 */
@Injectable()
export class QuizService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(TopicContentService)
    private readonly topicContentService: TopicContentService,
    @Inject(DailyPlanService)
    private readonly dailyPlanService: DailyPlanService,
    @Inject(QuizGradingService)
    private readonly quizGradingService: QuizGradingService,
    @Inject(EvidenceService)
    private readonly evidenceService: EvidenceService,
    @Inject(JobProducerService)
    private readonly jobProducer: JobProducerService,
    @Inject(PrivacyRetentionService)
    private readonly privacyRetentionService: PrivacyRetentionService,
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

  private async assertQuizPracticeFeatureEnabledInTx(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<void> {
    const rows = await db.query<Array<{ allowed: boolean }>>(
      `SELECT private.effective_feature_access($1, 'quiz_practice'::public.feature_key) AS allowed`,
      [userId],
    );
    const allowed = Array.isArray(rows) ? rows[0]?.allowed : false;
    if (allowed !== true) {
      fail(
        403,
        'FEATURE_DISABLED',
        'Practice quiz generation and submission are currently disabled. Existing quiz results remain accessible.',
      );
    }
  }

  private async isAiPracticeReviewEnabledInTx(
    db: TransactionalQueryExecutor,
    userId: string,
  ): Promise<boolean> {
    const rows = await db.query<Array<{ allowed: boolean }>>(
      `SELECT private.effective_feature_access($1, 'ai_practice_review'::public.feature_key) AS allowed`,
      [userId],
    );
    return Array.isArray(rows) && rows[0]?.allowed === true;
  }

  /**
   * Builds a safe pre-submission `QuizAttemptDTO` (`EP-Q01`, `EP-Q02`, `EP-Q03`, `EP-Q07`).
   * Strictly projects ONLY safe question fields — answer keys (`correct_option_id`, `explanation`, `rubric`)
   * are never queried or serialized.
   */
  private async buildSafeQuizAttemptDtoInTx(
    db: TransactionalQueryExecutor,
    attempt: QuizAttemptRow,
    topicId: string,
    careerLevel: CareerLevel,
    topicTitle?: string | null,
  ): Promise<QuizAttemptDTO> {
    const qRows = await db.query<SafeQuizQuestionRow[]>(
      `SELECT id,
              sort_order,
              question_type::text AS question_type,
              difficulty::text AS difficulty,
              prompt,
              options,
              response_hint,
              max_length,
              allow_i_dont_know
         FROM public.quiz_questions
        WHERE id = ANY($1::uuid[])
        ORDER BY sort_order ASC`,
      [attempt.question_ids],
    );
    const qMap = new Map<string, SafeQuizQuestionRow>();
    for (const q of Array.isArray(qRows) ? qRows : []) {
      qMap.set(String(q.id), q);
    }

    const orderedQuestions: QuizQuestionDTO[] = [];
    for (const qId of attempt.question_ids) {
      const q = qMap.get(String(qId));
      if (!q) {
        continue;
      }
      orderedQuestions.push({
        question_id: String(q.id),
        type: q.question_type,
        difficulty: q.difficulty,
        prompt: String(q.prompt),
        options:
          q.question_type === 'mcq'
            ? normalizeQuestionOptions(q.options)
            : null,
        response_hint:
          q.question_type === 'free_response'
            ? (q.response_hint ?? 'text')
            : null,
        max_length:
          q.question_type === 'free_response'
            ? q.max_length !== null && q.max_length !== undefined
              ? Number(q.max_length)
              : MAX_ANSWER_TEXT_LENGTH
            : null,
        allow_i_dont_know: Boolean(q.allow_i_dont_know),
      });
    }

    const ansRows = await db.query<SavedAnswerRow[]>(
      `SELECT id,
              question_id,
              selected_option_id,
              answer_text,
              i_dont_know,
              is_correct,
              saved_at,
              raw_text_expires_at,
              raw_text_purged_at,
              created_at
         FROM public.quiz_answers
        WHERE attempt_id = $1
          AND user_id = $2
        ORDER BY created_at ASC, id ASC`,
      [attempt.id, attempt.user_id],
    );
    const savedAnswers: SavedQuizAnswerDTO[] = (
      Array.isArray(ansRows) ? ansRows : []
    ).map((a) => {
      const isExpired =
        (a.raw_text_purged_at !== null && a.raw_text_purged_at !== undefined) ||
        Boolean(
          this.privacyRetentionService?.isRawTextExpired?.({
            created_at: a.created_at ?? a.saved_at ?? new Date(0),
            raw_text_expires_at: a.raw_text_expires_at ?? null,
          }),
        );
      return {
        question_id: String(a.question_id),
        selected_option_id: a.selected_option_id ?? null,
        text: isExpired ? null : (a.answer_text ?? null),
        i_dont_know: Boolean(a.i_dont_know),
      };
    });

    return {
      attempt_id: String(attempt.id),
      status: attempt.status,
      attempt_no: Number(attempt.attempt_no),
      topic_id: String(topicId),
      ...(typeof topicTitle === 'string' && topicTitle.trim().length > 0
        ? { topic_title: topicTitle.trim() }
        : {}),
      career_level: careerLevel,
      questions: orderedQuestions,
      saved_answers: savedAnswers,
      submitted_at: toNullableIso(attempt.submitted_at),
    };
  }

  private async findApprovedSharedQuizInTx(
    db: TransactionalQueryExecutor,
    topicId: string,
    contentVersion: number,
    variantNo: 1 | 2,
  ): Promise<{ quizId: string; questionIds: string[] } | null> {
    const quizRows = await db.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.quizzes
        WHERE topic_id = $1
          AND content_version = $2
          AND variant_no = $3
          AND status = 'approved'::public.content_status
        LIMIT 1`,
      [topicId, contentVersion, variantNo],
    );
    const quiz = Array.isArray(quizRows) ? quizRows[0] : undefined;
    if (!quiz?.id) {
      return null;
    }

    const qRows = await db.query<
      Array<{ id: string; hidden_at: Date | string | null }>
    >(
      `SELECT id, hidden_at
         FROM public.quiz_questions
        WHERE quiz_id = $1
        ORDER BY sort_order ASC`,
      [quiz.id],
    );
    const qList = Array.isArray(qRows) ? qRows : [];
    if (qList.length === 0 || qList.some((q) => q.hidden_at !== null)) {
      return null;
    }

    return {
      quizId: String(quiz.id),
      questionIds: qList.map((q) => String(q.id)),
    };
  }

  private validateAndNormalizeAnswersPatch(
    rawAnswers: unknown,
    questionsById: ReadonlyMap<string, SafeQuizQuestionRow>,
    allowEmptyArray = false,
  ): Array<{
    questionId: string;
    selectedOptionId: string | null;
    answerText: string | null;
    iDontKnow: boolean;
  }> {
    if (!Array.isArray(rawAnswers)) {
      fail(422, 'VALIDATION_FAILED', 'answers must be an array', [
        {
          field: 'answers',
          code: 'VALIDATION_FAILED',
          message: 'answers must be an array',
        },
      ]);
    }
    if (!allowEmptyArray && rawAnswers.length === 0) {
      fail(
        422,
        'VALIDATION_FAILED',
        'answers must contain between 1 and 40 items',
        [
          {
            field: 'answers',
            code: 'VALIDATION_FAILED',
            message: 'answers must contain at least 1 item',
          },
        ],
      );
    }
    if (rawAnswers.length > MAX_PATCH_ANSWERS) {
      fail(
        422,
        'VALIDATION_FAILED',
        `At most ${MAX_PATCH_ANSWERS} answers can be saved per request`,
        [
          {
            field: 'answers',
            code: 'VALIDATION_FAILED',
            message: `answers cannot exceed ${MAX_PATCH_ANSWERS} items`,
          },
        ],
      );
    }

    const byQuestionId = new Map<
      string,
      {
        questionId: string;
        selectedOptionId: string | null;
        answerText: string | null;
        iDontKnow: boolean;
      }
    >();

    for (let idx = 0; idx < rawAnswers.length; idx += 1) {
      const raw = rawAnswers[idx] as QuizAnswerInputDTO | undefined;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail(422, 'VALIDATION_FAILED', `answers[${idx}] must be an object`, [
          {
            field: `answers[${idx}]`,
            code: 'VALIDATION_FAILED',
            message: 'Answer entry must be an object',
          },
        ]);
      }

      if (
        typeof raw.question_id !== 'string' ||
        !UUID_PATTERN.test(raw.question_id.trim())
      ) {
        fail(
          422,
          'VALIDATION_FAILED',
          `answers[${idx}].question_id must be a valid UUID`,
          [
            {
              field: `answers[${idx}].question_id`,
              code: 'INVALID_FORMAT',
              message: 'question_id must be a valid UUID',
            },
          ],
        );
      }
      const questionId = raw.question_id.trim().toLowerCase();
      const question = questionsById.get(questionId);
      if (!question) {
        fail(
          422,
          'QUESTION_NOT_IN_QUIZ',
          `Question ${questionId} does not belong to this quiz attempt`,
          [
            {
              field: `answers[${idx}].question_id`,
              code: 'QUESTION_NOT_IN_QUIZ',
              message: 'Question does not belong to this quiz attempt',
            },
          ],
        );
      }

      if (
        raw.i_dont_know !== undefined &&
        typeof raw.i_dont_know !== 'boolean'
      ) {
        fail(
          422,
          'VALIDATION_FAILED',
          `answers[${idx}].i_dont_know must be a boolean`,
        );
      }
      const iDontKnow = raw.i_dont_know === true;

      const hasSelectedOption =
        raw.selected_option_id !== undefined && raw.selected_option_id !== null;
      const hasText = raw.text !== undefined && raw.text !== null;

      if (iDontKnow) {
        if (!question.allow_i_dont_know) {
          fail(
            422,
            'VALIDATION_FAILED',
            'This question does not allow I do not know',
          );
        }
        if (hasSelectedOption || hasText) {
          fail(
            422,
            'VALIDATION_FAILED',
            'i_dont_know=true cannot be combined with selected_option_id or text',
            [
              {
                field: `answers[${idx}].i_dont_know`,
                code: 'VALIDATION_FAILED',
                message: 'i_dont_know excludes selected_option_id and text',
              },
            ],
          );
        }
        byQuestionId.set(questionId, {
          questionId,
          selectedOptionId: null,
          answerText: null,
          iDontKnow: true,
        });
        continue;
      }

      if (hasSelectedOption && hasText) {
        fail(
          422,
          'VALIDATION_FAILED',
          'Answer cannot include both selected_option_id and text',
        );
      }

      if (question.question_type === 'mcq') {
        if (
          !hasSelectedOption ||
          typeof raw.selected_option_id !== 'string' ||
          !raw.selected_option_id.trim()
        ) {
          fail(
            422,
            'VALIDATION_FAILED',
            'MCQ answer requires a valid selected_option_id or i_dont_know=true',
            [
              {
                field: `answers[${idx}].selected_option_id`,
                code: 'VALIDATION_FAILED',
                message: 'selected_option_id is required for MCQ answers',
              },
            ],
          );
        }
        const selectedOptionId = raw.selected_option_id.trim();
        const validOptions = normalizeQuestionOptions(question.options) ?? [];
        if (!validOptions.some((o) => o.option_id === selectedOptionId)) {
          fail(
            422,
            'VALIDATION_FAILED',
            `Invalid selected_option_id for question ${questionId}`,
            [
              {
                field: `answers[${idx}].selected_option_id`,
                code: 'VALIDATION_FAILED',
                message:
                  'selected_option_id is not a valid option for this question',
              },
            ],
          );
        }
        byQuestionId.set(questionId, {
          questionId,
          selectedOptionId,
          answerText: null,
          iDontKnow: false,
        });
      } else {
        if (!hasText || typeof raw.text !== 'string') {
          fail(
            422,
            'VALIDATION_FAILED',
            'Free-response answer requires text or i_dont_know=true',
            [
              {
                field: `answers[${idx}].text`,
                code: 'VALIDATION_FAILED',
                message: 'text is required for free-response answers',
              },
            ],
          );
        }
        if (raw.text.includes('\u0000')) {
          fail(
            422,
            'VALIDATION_FAILED',
            'Answer text cannot contain NUL bytes',
          );
        }
        const trimmedText = raw.text.trim();
        const maxAllowed = Math.min(
          MAX_ANSWER_TEXT_LENGTH,
          question.max_length !== null && question.max_length !== undefined
            ? Number(question.max_length)
            : MAX_ANSWER_TEXT_LENGTH,
        );
        if (
          trimmedText.length === 0 ||
          raw.text.length > maxAllowed ||
          raw.text.length > MAX_ANSWER_TEXT_LENGTH
        ) {
          fail(
            422,
            'VALIDATION_FAILED',
            `Free-response text must be non-empty and at most ${maxAllowed} characters`,
            [
              {
                field: `answers[${idx}].text`,
                code: 'VALIDATION_FAILED',
                message: `text must be between 1 and ${maxAllowed} characters`,
              },
            ],
          );
        }
        byQuestionId.set(questionId, {
          questionId,
          selectedOptionId: null,
          answerText: raw.text,
          iDontKnow: false,
        });
      }
    }

    return Array.from(byQuestionId.values());
  }

  private async upsertAnswersInTx(
    db: TransactionalQueryExecutor,
    userId: string,
    attemptId: string,
    normalizedAnswers: ReadonlyArray<{
      questionId: string;
      selectedOptionId: string | null;
      answerText: string | null;
      iDontKnow: boolean;
    }>,
  ): Promise<string> {
    const retentionDays =
      this.privacyRetentionService.getRawResponseRetentionDays();
    const rawTextExpiresAt = new Date(
      Date.now() + retentionDays * 86_400_000,
    ).toISOString();
    let latestSavedAtIso = new Date().toISOString();

    for (const ans of normalizedAnswers) {
      const upsertedRaw = await db.query<unknown>(
        `INSERT INTO public.quiz_answers (
           attempt_id,
           user_id,
           question_id,
           selected_option_id,
           answer_text,
           i_dont_know,
           saved_at,
           raw_text_expires_at,
           raw_text_purged_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           clock_timestamp(),
           $7::timestamptz,
           NULL
         )
         ON CONFLICT (attempt_id, question_id) DO UPDATE
           SET selected_option_id = EXCLUDED.selected_option_id,
               answer_text = EXCLUDED.answer_text,
               i_dont_know = EXCLUDED.i_dont_know,
               saved_at = clock_timestamp(),
               raw_text_expires_at = EXCLUDED.raw_text_expires_at,
               raw_text_purged_at = NULL
         RETURNING saved_at`,
        [
          attemptId,
          userId,
          ans.questionId,
          ans.selectedOptionId,
          ans.answerText,
          ans.iDontKnow,
          rawTextExpiresAt,
        ],
      );
      const row = extractReturningRows<{ saved_at: Date | string }>(
        upsertedRaw,
      )[0];
      const iso = toNullableIso(row?.saved_at);
      if (iso) {
        latestSavedAtIso = iso;
      }
    }

    return latestSavedAtIso;
  }

  /**
   * `EP-Q01` (`POST /api/v1/quiz/generate`, `H-IDEM`, `Gate: write (quiz_practice)`, `R24 foreground = true`).
   */
  async generateOrFetchQuizAttempt(
    userId: string,
    dto: QuizGenerateDTO,
    options?: QuizRequestOptions,
  ): Promise<GenerateQuizOutcome> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const dailyPlanItemId = this.assertUuid(
      dto?.daily_plan_item_id,
      'daily_plan_item_id',
      'Daily Plan item id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertQuizPracticeFeatureEnabledInTx(db, normalizedUserId);

        const lookupRows = await db.query<PlanItemLookupRow[]>(
          `SELECT dpi.id,
                  dpi.plan_id,
                  dpi.day_no,
                  dpi.sort_order,
                  dpi.status::text AS status,
                  dpi.topic_id,
                  dp.roadmap_id,
                  r.status::text AS roadmap_status,
                  t.skill_id,
                  t.slug,
                  t.title,
                  t.career_level::text AS career_level
             FROM public.daily_plan_items dpi
             JOIN public.daily_plans dp ON dp.id = dpi.plan_id
             JOIN public.roadmaps r ON r.id = dp.roadmap_id
             JOIN public.topics t ON t.id = dpi.topic_id
            WHERE dpi.id = $1
              AND dpi.user_id = $2
            LIMIT 1`,
          [dailyPlanItemId, normalizedUserId],
        );
        const item = Array.isArray(lookupRows) ? lookupRows[0] : undefined;
        if (!item) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Daily Plan item not found');
        }

        // Lock in EP-L03-compatible order: daily_plans -> roadmaps -> daily_plan_items
        await db.query(
          `SELECT id FROM public.daily_plans WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [item.plan_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.roadmaps WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [item.roadmap_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.daily_plan_items WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [item.id, normalizedUserId],
        );

        if (item.roadmap_status !== 'locked') {
          fail(
            409,
            'PLAN_ITEM_NOT_AVAILABLE',
            'Practice quiz is only available for items in an unarchived locked roadmap',
          );
        }

        // Check if an attempt already exists for this plan item (resume -> 200)
        const existingAttemptRows = await db.query<QuizAttemptRow[]>(
          `SELECT id,
                  user_id,
                  daily_plan_item_id,
                  quiz_id,
                  attempt_no,
                  retry_of_attempt_id,
                  status::text AS status,
                  question_ids,
                  started_at,
                  submitted_at,
                  reviewed_at,
                  mcq_correct,
                  mcq_total,
                  performance_level::text AS performance_level,
                  improvement_recommendations
             FROM public.quiz_attempts
            WHERE user_id = $1
              AND daily_plan_item_id = $2
            ORDER BY attempt_no DESC
            LIMIT 1`,
          [normalizedUserId, item.id],
        );
        const existingAttempt = Array.isArray(existingAttemptRows)
          ? existingAttemptRows[0]
          : undefined;
        if (existingAttempt) {
          const attemptDto = await this.buildSafeQuizAttemptDtoInTx(
            db,
            existingAttempt,
            item.topic_id,
            item.career_level,
            item.title,
          );
          return {
            statusCode: 200,
            body: attemptDto,
          };
        }

        // Verify item is the next incomplete sequential day or an already-started day
        const nextDayRows = await db.query<
          Array<{ next_day_no: number | string | null }>
        >(
          `SELECT MIN(day_no)::int AS next_day_no
             FROM public.daily_plan_items
            WHERE plan_id = $1
              AND user_id = $2
              AND status <> 'completed'::public.plan_item_status`,
          [item.plan_id, normalizedUserId],
        );
        const nextIncompleteDayNo =
          Array.isArray(nextDayRows) &&
          nextDayRows[0]?.next_day_no !== null &&
          nextDayRows[0]?.next_day_no !== undefined
            ? Number(nextDayRows[0].next_day_no)
            : null;

        const itemDayNo = Number(item.day_no);
        const isAvailableDay =
          item.status === 'in_progress' ||
          (nextIncompleteDayNo !== null && itemDayNo === nextIncompleteDayNo);
        if (!isAvailableDay) {
          fail(
            409,
            'PLAN_ITEM_NOT_AVAILABLE',
            'This plan day is not currently available for quiz generation',
          );
        }

        // Resolve canonical approved topic content
        const approvedTopic =
          await this.topicContentService.findApprovedCanonicalTopicInTx(
            db,
            item.skill_id,
            item.slug,
            item.career_level,
          );
        if (!approvedTopic) {
          fail(
            409,
            'PLAN_ITEM_NOT_AVAILABLE',
            'Topic study content is still preparing; please wait until the topic is ready before generating the quiz',
          );
        }

        const effectiveTopicId = String(approvedTopic.id);
        const effectiveContentVersion = Number(approvedTopic.content_version);

        // Check if shared approved quiz (variant_no = 1) already exists -> 201 Created
        const sharedQuiz = await this.findApprovedSharedQuizInTx(
          db,
          effectiveTopicId,
          effectiveContentVersion,
          1,
        );
        if (sharedQuiz) {
          const insertedAttemptRaw = await db.query<unknown>(
            `INSERT INTO public.quiz_attempts (
               user_id,
               daily_plan_item_id,
               quiz_id,
               attempt_no,
               retry_of_attempt_id,
               status,
               question_ids
             )
             VALUES (
               $1,
               $2,
               $3,
               1,
               NULL,
               'generated'::public.attempt_status,
               $4::uuid[]
             )
             ON CONFLICT (daily_plan_item_id, attempt_no) DO NOTHING
             RETURNING id,
                       user_id,
                       daily_plan_item_id,
                       quiz_id,
                       attempt_no,
                       retry_of_attempt_id,
                       status::text AS status,
                       question_ids,
                       started_at,
                       submitted_at,
                       reviewed_at,
                       mcq_correct,
                       mcq_total,
                       performance_level::text AS performance_level,
                       improvement_recommendations`,
            [
              normalizedUserId,
              item.id,
              sharedQuiz.quizId,
              sharedQuiz.questionIds,
            ],
          );
          const createdAttempt =
            extractReturningRows<QuizAttemptRow>(insertedAttemptRaw)[0];
          if (createdAttempt) {
            const attemptDto = await this.buildSafeQuizAttemptDtoInTx(
              db,
              createdAttempt,
              effectiveTopicId,
              item.career_level,
              approvedTopic.title ?? item.title,
            );
            return {
              statusCode: 201,
              body: attemptDto,
            };
          }
        }

        // Check for existing active user-owned quiz_generate job
        const activeJobRows = await db.query<
          Array<{ id: string; status: 'queued' | 'preparing' }>
        >(
          `SELECT id, status::text AS status
             FROM public.ai_requests
            WHERE user_id = $1
              AND is_async = true
              AND job_kind = 'quiz_generate'::public.job_kind
              AND subject_type = 'daily_plan_item'
              AND subject_id = $2
              AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            ORDER BY created_at DESC
            LIMIT 1`,
          [normalizedUserId, item.id],
        );
        const existingJob = Array.isArray(activeJobRows)
          ? activeJobRows[0]
          : undefined;
        if (existingJob?.id) {
          return {
            statusCode: 202,
            body: {
              job_id: String(existingJob.id),
              kind: 'quiz_generate',
              status: existingJob.status,
              poll_url: `/api/v1/jobs/${existingJob.id}`,
              retry_after_seconds: DEFAULT_POLL_RETRY_SECONDS,
            },
          };
        }

        const language = resolvePreferredLanguage(options?.acceptLanguage);
        const enqueuedJob = await this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'quiz_generate',
            envelope: {
              v: 1,
              args: {
                daily_plan_item_id: String(item.id),
                topic_id: effectiveTopicId,
                content_version: effectiveContentVersion,
                variant_no: 1,
              },
              expected_refs: {
                content_version: effectiveContentVersion,
              },
            },
            subjectType: 'daily_plan_item',
            subjectId: String(item.id),
            httpRequestId: options?.httpRequestId,
            language,
          },
          db,
        );

        return {
          statusCode: 202,
          body: enqueuedJob,
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-Q02` (`GET /api/v1/quiz/:id`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getQuizAttempt(
    userId: string,
    attemptId: string,
  ): Promise<QuizAttemptDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedAttemptId = this.assertUuid(
      attemptId,
      'id',
      'Quiz attempt id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const rows = await db.query<
          Array<
            QuizAttemptRow & {
              topic_id: string;
              title?: string;
              career_level: CareerLevel;
            }
          >
        >(
          `SELECT qa.id,
                  qa.user_id,
                  qa.daily_plan_item_id,
                  qa.quiz_id,
                  qa.attempt_no,
                  qa.retry_of_attempt_id,
                  qa.status::text AS status,
                  qa.question_ids,
                  qa.started_at,
                  qa.submitted_at,
                  qa.reviewed_at,
                  qa.mcq_correct,
                  qa.mcq_total,
                  qa.performance_level::text AS performance_level,
                  qa.improvement_recommendations,
                  q.topic_id,
                  t.title,
                  t.career_level::text AS career_level
             FROM public.quiz_attempts qa
             JOIN public.quizzes q ON q.id = qa.quiz_id
             JOIN public.topics t ON t.id = q.topic_id
            WHERE qa.id = $1
              AND qa.user_id = $2
            LIMIT 1`,
          [normalizedAttemptId, normalizedUserId],
        );
        const attempt = Array.isArray(rows) ? rows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        return this.buildSafeQuizAttemptDtoInTx(
          db,
          attempt,
          attempt.topic_id,
          attempt.career_level,
          attempt.title,
        );
      },
      true,
      false,
    );
  }

  /**
   * `EP-Q03` (`POST /api/v1/quiz/:id/start`, `200 OK`, `Gate: write (quiz_practice)`, `R24 foreground = true`).
   *
   * Idempotent if already `'started'`. Starting an attempt on a post-merge plan item
   * automatically closes the roadmap merge Undo window via `trg_quiz_attempts_close_undo` (`PRD` §21).
   */
  async startQuizAttempt(
    userId: string,
    attemptId: string,
  ): Promise<QuizAttemptDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedAttemptId = this.assertUuid(
      attemptId,
      'id',
      'Quiz attempt id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertQuizPracticeFeatureEnabledInTx(db, normalizedUserId);

        const lookupRows = await db.query<
          Array<{
            id: string;
            daily_plan_item_id: string;
            plan_id: string;
            roadmap_id: string;
            topic_id: string;
            title?: string;
            career_level: CareerLevel;
          }>
        >(
          `SELECT qa.id,
                  qa.daily_plan_item_id,
                  dpi.plan_id,
                  dp.roadmap_id,
                  q.topic_id,
                  t.title,
                  t.career_level::text AS career_level
             FROM public.quiz_attempts qa
             JOIN public.daily_plan_items dpi ON dpi.id = qa.daily_plan_item_id
             JOIN public.daily_plans dp ON dp.id = dpi.plan_id
             JOIN public.quizzes q ON q.id = qa.quiz_id
             JOIN public.topics t ON t.id = q.topic_id
            WHERE qa.id = $1
              AND qa.user_id = $2
            LIMIT 1`,
          [normalizedAttemptId, normalizedUserId],
        );
        const lookup = Array.isArray(lookupRows) ? lookupRows[0] : undefined;
        if (!lookup) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        // Lock in EP-L03-compatible order: daily_plans -> roadmaps -> daily_plan_items -> quiz_attempts
        await db.query(
          `SELECT id FROM public.daily_plans WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [lookup.plan_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.roadmaps WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [lookup.roadmap_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.daily_plan_items WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [lookup.daily_plan_item_id, normalizedUserId],
        );

        const attemptRows = await db.query<QuizAttemptRow[]>(
          `SELECT id,
                  user_id,
                  daily_plan_item_id,
                  quiz_id,
                  attempt_no,
                  retry_of_attempt_id,
                  status::text AS status,
                  question_ids,
                  started_at,
                  submitted_at,
                  reviewed_at,
                  mcq_correct,
                  mcq_total,
                  performance_level::text AS performance_level,
                  improvement_recommendations
             FROM public.quiz_attempts
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [normalizedAttemptId, normalizedUserId],
        );
        const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        if (attempt.status !== 'generated' && attempt.status !== 'started') {
          fail(
            409,
            'INVALID_STATE_TRANSITION',
            'Quiz attempt has already been submitted and cannot be started again',
          );
        }

        let currentAttempt = attempt;
        if (attempt.status === 'generated') {
          const updatedRaw = await db.query<unknown>(
            `UPDATE public.quiz_attempts
                SET status = 'started'::public.attempt_status,
                    started_at = COALESCE(started_at, clock_timestamp())
              WHERE id = $1
                AND user_id = $2
             RETURNING id,
                       user_id,
                       daily_plan_item_id,
                       quiz_id,
                       attempt_no,
                       retry_of_attempt_id,
                       status::text AS status,
                       question_ids,
                       started_at,
                       submitted_at,
                       reviewed_at,
                       mcq_correct,
                       mcq_total,
                       performance_level::text AS performance_level,
                       improvement_recommendations`,
            [attempt.id, normalizedUserId],
          );
          const updated = extractReturningRows<QuizAttemptRow>(updatedRaw)[0];
          if (updated) {
            currentAttempt = updated;
          }
        }

        await db.query(
          `UPDATE public.daily_plan_items
              SET status = CASE
                    WHEN status = 'pending'::public.plan_item_status
                      THEN 'in_progress'::public.plan_item_status
                    ELSE status
                  END,
                  started_at = COALESCE(started_at, clock_timestamp())
            WHERE id = $1
              AND user_id = $2`,
          [lookup.daily_plan_item_id, normalizedUserId],
        );

        return this.buildSafeQuizAttemptDtoInTx(
          db,
          currentAttempt,
          lookup.topic_id,
          lookup.career_level,
          lookup.title,
        );
      },
      true,
      true,
    );
  }

  /**
   * `EP-Q04` (`PATCH /api/v1/quiz/:id/answers`, `200 OK`, `Gate: write (quiz_practice)`, `R24 foreground = true`).
   */
  async saveAnswers(
    userId: string,
    attemptId: string,
    dto: QuizAnswersPatchDTO,
  ): Promise<QuizAnswersSavedResponseDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedAttemptId = this.assertUuid(
      attemptId,
      'id',
      'Quiz attempt id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertQuizPracticeFeatureEnabledInTx(db, normalizedUserId);

        const attemptRows = await db.query<QuizAttemptRow[]>(
          `SELECT id,
                  user_id,
                  daily_plan_item_id,
                  quiz_id,
                  attempt_no,
                  retry_of_attempt_id,
                  status::text AS status,
                  question_ids,
                  started_at,
                  submitted_at,
                  reviewed_at,
                  mcq_correct,
                  mcq_total,
                  performance_level::text AS performance_level,
                  improvement_recommendations
             FROM public.quiz_attempts
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [normalizedAttemptId, normalizedUserId],
        );
        const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }
        if (attempt.status === 'generated') {
          fail(
            409,
            'QUIZ_NOT_STARTED',
            'Start the quiz attempt before saving answers',
          );
        }
        if (attempt.status !== 'started') {
          fail(
            409,
            'QUIZ_ALREADY_SUBMITTED',
            'Quiz attempt has already been submitted',
          );
        }

        const qRows = await db.query<SafeQuizQuestionRow[]>(
          `SELECT id,
                  sort_order,
                  question_type::text AS question_type,
                  difficulty::text AS difficulty,
                  prompt,
                  options,
                  response_hint,
                  max_length,
                  allow_i_dont_know
             FROM public.quiz_questions
            WHERE id = ANY($1::uuid[])`,
          [attempt.question_ids],
        );
        const questionsById = new Map<string, SafeQuizQuestionRow>();
        for (const q of Array.isArray(qRows) ? qRows : []) {
          questionsById.set(String(q.id), q);
        }

        const normalizedAnswers = this.validateAndNormalizeAnswersPatch(
          dto?.answers,
          questionsById,
          false,
        );

        const savedAtIso = await this.upsertAnswersInTx(
          db,
          normalizedUserId,
          attempt.id,
          normalizedAnswers,
        );

        return {
          saved: normalizedAnswers.length,
          saved_at: savedAtIso,
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-Q05` (`POST /api/v1/quiz/:id/submit`, `H-IDEM`, `Gate: write (quiz_practice)`, `R24 foreground = true`).
   */
  async submitQuizAttempt(
    userId: string,
    attemptId: string,
    dto: QuizSubmissionDTO,
    options?: QuizRequestOptions,
  ): Promise<{ statusCode: 200 | 202; body: QuizSubmitResponseDTO }> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedAttemptId = this.assertUuid(
      attemptId,
      'id',
      'Quiz attempt id',
    );
    if (
      dto?.confirm_unanswered !== undefined &&
      typeof dto.confirm_unanswered !== 'boolean'
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        'confirm_unanswered must be a boolean when provided',
        [
          {
            field: 'confirm_unanswered',
            code: 'VALIDATION_FAILED',
            message: 'confirm_unanswered must be a boolean',
          },
        ],
      );
    }

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertQuizPracticeFeatureEnabledInTx(db, normalizedUserId);

        const lookupRows = await db.query<
          Array<{
            id: string;
            daily_plan_item_id: string;
            plan_id: string;
            roadmap_id: string;
            topic_id: string;
            skill_id: string;
            title: string;
            career_level: CareerLevel;
          }>
        >(
          `SELECT qa.id,
                  qa.daily_plan_item_id,
                  dpi.plan_id,
                  dp.roadmap_id,
                  q.topic_id,
                  t.skill_id,
                  t.title,
                  t.career_level::text AS career_level
             FROM public.quiz_attempts qa
             JOIN public.daily_plan_items dpi ON dpi.id = qa.daily_plan_item_id
             JOIN public.daily_plans dp ON dp.id = dpi.plan_id
             JOIN public.quizzes q ON q.id = qa.quiz_id
             JOIN public.topics t ON t.id = q.topic_id
            WHERE qa.id = $1
              AND qa.user_id = $2
            LIMIT 1`,
          [normalizedAttemptId, normalizedUserId],
        );
        const lookup = Array.isArray(lookupRows) ? lookupRows[0] : undefined;
        if (!lookup) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        // Lock in EP-L03-compatible order: daily_plans -> roadmaps -> daily_plan_items -> quiz_attempts
        await db.query(
          `SELECT id FROM public.daily_plans WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [lookup.plan_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.roadmaps WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [lookup.roadmap_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.daily_plan_items WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [lookup.daily_plan_item_id, normalizedUserId],
        );

        const attemptRows = await db.query<QuizAttemptRow[]>(
          `SELECT id,
                  user_id,
                  daily_plan_item_id,
                  quiz_id,
                  attempt_no,
                  retry_of_attempt_id,
                  status::text AS status,
                  question_ids,
                  started_at,
                  submitted_at,
                  reviewed_at,
                  mcq_correct,
                  mcq_total,
                  performance_level::text AS performance_level,
                  improvement_recommendations
             FROM public.quiz_attempts
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [normalizedAttemptId, normalizedUserId],
        );
        const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }
        if (attempt.status === 'generated') {
          fail(
            409,
            'QUIZ_NOT_STARTED',
            'Start the quiz attempt before submitting',
          );
        }
        if (attempt.status !== 'started') {
          fail(
            409,
            'QUIZ_ALREADY_SUBMITTED',
            'Quiz attempt has already been submitted',
          );
        }

        const qRows = await db.query<GradingQuizQuestionRow[]>(
          `SELECT id,
                  sort_order,
                  question_type::text AS question_type,
                  difficulty::text AS difficulty,
                  prompt,
                  options,
                  correct_option_id,
                  explanation,
                  response_hint,
                  max_length,
                  allow_i_dont_know
             FROM public.quiz_questions
            WHERE id = ANY($1::uuid[])
            ORDER BY sort_order ASC`,
          [attempt.question_ids],
        );
        const questionsById = new Map<string, GradingQuizQuestionRow>();
        for (const q of Array.isArray(qRows) ? qRows : []) {
          questionsById.set(String(q.id), q);
        }

        if (dto?.answers !== undefined && dto.answers !== null) {
          const normalizedPatch = this.validateAndNormalizeAnswersPatch(
            dto.answers,
            questionsById,
            true,
          );
          if (normalizedPatch.length > 0) {
            await this.upsertAnswersInTx(
              db,
              normalizedUserId,
              attempt.id,
              normalizedPatch,
            );
          }
        }

        const savedAnswerRows = await db.query<SavedAnswerRow[]>(
          `SELECT id,
                  question_id,
                  selected_option_id,
                  answer_text,
                  i_dont_know,
                  is_correct,
                  saved_at
             FROM public.quiz_answers
            WHERE attempt_id = $1
              AND user_id = $2`,
          [attempt.id, normalizedUserId],
        );
        const answersByQuestionId = new Map<string, SavedAnswerRow>();
        for (const row of Array.isArray(savedAnswerRows)
          ? savedAnswerRows
          : []) {
          answersByQuestionId.set(String(row.question_id), row);
        }

        let answeredCount = 0;
        for (const qId of attempt.question_ids) {
          const ans = answersByQuestionId.get(String(qId));
          if (
            ans &&
            (ans.i_dont_know === true ||
              (typeof ans.selected_option_id === 'string' &&
                ans.selected_option_id.trim().length > 0) ||
              (typeof ans.answer_text === 'string' &&
                ans.answer_text.trim().length > 0))
          ) {
            answeredCount += 1;
          }
        }

        if (answeredCount === 0) {
          fail(
            422,
            'NO_ANSWERS_SUBMITTED',
            'Submit at least one response (or choose I do not know) before submitting the quiz',
          );
        }
        if (
          answeredCount < attempt.question_ids.length &&
          dto?.confirm_unanswered !== true
        ) {
          fail(
            422,
            'UNANSWERED_CONFIRMATION_REQUIRED',
            'Some questions are unanswered. Set confirm_unanswered=true to confirm submission',
          );
        }

        const orderedQuestions = attempt.question_ids
          .map((qId) => questionsById.get(String(qId)))
          .filter((q): q is GradingQuizQuestionRow => q !== undefined);

        const mcqQuestions = orderedQuestions.filter(
          (q) => q.question_type === 'mcq',
        );
        const frQuestions = orderedQuestions.filter(
          (q) => q.question_type === 'free_response',
        );

        // 1. Deterministic MCQ grading from stored answer key
        const mcqGrade = this.quizGradingService.gradeMcqQuestions(
          mcqQuestions,
          answersByQuestionId,
          lookup.title,
        );
        for (const [qId, isCorrect] of mcqGrade.isCorrectByQuestionId) {
          if (answersByQuestionId.has(qId)) {
            await db.query(
              `UPDATE public.quiz_answers
                  SET is_correct = $3
                WHERE attempt_id = $1
                  AND question_id = $2`,
              [attempt.id, qId, isCorrect],
            );
          }
        }

        const submittedAtIso = new Date().toISOString();
        const aiReviewAllowed = await this.isAiPracticeReviewEnabledInTx(
          db,
          normalizedUserId,
        );
        const language = resolvePreferredLanguage(options?.acceptLanguage);
        const retentionDays =
          this.privacyRetentionService.getRawResponseRetentionDays();
        const rawTextExpiresAt = new Date(
          Date.now() + retentionDays * 86_400_000,
        ).toISOString();

        // 2. Process free-response answers & enqueue AI Practice Review jobs
        let firstReviewJobId: string | null = null;
        let pendingReviewCount = 0;
        let failedReviewCount = 0;

        for (const frQuestion of frQuestions) {
          let answerRow = answersByQuestionId.get(String(frQuestion.id));
          if (!answerRow) {
            // Unanswered confirmed FR question: create an i_dont_know answer row so practice_reviews FK is satisfied
            const insertedBlankRaw = await db.query<unknown>(
              `INSERT INTO public.quiz_answers (
                 attempt_id,
                 user_id,
                 question_id,
                 selected_option_id,
                 answer_text,
                 i_dont_know,
                 saved_at,
                 raw_text_expires_at
               )
               VALUES ($1, $2, $3, NULL, NULL, true, clock_timestamp(), $4::timestamptz)
               RETURNING id, question_id, selected_option_id, answer_text, i_dont_know, is_correct, saved_at`,
              [attempt.id, normalizedUserId, frQuestion.id, rawTextExpiresAt],
            );
            answerRow =
              extractReturningRows<SavedAnswerRow>(insertedBlankRaw)[0];
          }
          if (!answerRow?.id) {
            continue;
          }

          const isJunk = this.quizGradingService.isJunkOrNonAttemptFreeResponse(
            answerRow.answer_text,
            Boolean(answerRow.i_dont_know),
          );

          if (isJunk) {
            await db.query(
              `INSERT INTO public.practice_reviews (
                 user_id,
                 attempt_id,
                 answer_id,
                 question_id,
                 review_status,
                 performance_level,
                 dimensions,
                 strengths,
                 mistakes,
                 weaknesses,
                 improvement_recommendations,
                 evidence_eligible,
                 reviewed_at
               )
               VALUES (
                 $1,
                 $2,
                 $3,
                 $4,
                 'not_evidence'::public.review_status,
                 NULL,
                 NULL,
                 '[]'::jsonb,
                 '[]'::jsonb,
                 '[]'::jsonb,
                 $5::jsonb,
                 false,
                 clock_timestamp()
               )
               ON CONFLICT (answer_id) DO NOTHING`,
              [
                normalizedUserId,
                attempt.id,
                answerRow.id,
                frQuestion.id,
                JSON.stringify([
                  'Provide a complete technical response on retry to receive AI Practice Review feedback.',
                ]),
              ],
            );
          } else if (aiReviewAllowed) {
            const insertedReviewRaw = await db.query<unknown>(
              `INSERT INTO public.practice_reviews (
                 user_id,
                 attempt_id,
                 answer_id,
                 question_id,
                 review_status,
                 evidence_eligible
               )
               VALUES (
                 $1,
                 $2,
                 $3,
                 $4,
                 'pending'::public.review_status,
                 false
               )
               ON CONFLICT (answer_id) DO UPDATE
                 SET review_status = 'pending'::public.review_status
               RETURNING id`,
              [normalizedUserId, attempt.id, answerRow.id, frQuestion.id],
            );
            const reviewRow = extractReturningRows<{ id: string }>(
              insertedReviewRaw,
            )[0];
            if (reviewRow?.id) {
              pendingReviewCount += 1;
              const answerSavedAtIso =
                toNullableIso(answerRow.saved_at) ?? submittedAtIso;
              const job = await this.jobProducer.enqueue(
                {
                  userId: normalizedUserId,
                  kind: 'practice_review',
                  envelope: {
                    v: 1,
                    args: {
                      review_id: String(reviewRow.id),
                      attempt_id: String(attempt.id),
                    },
                    expected_refs: {
                      submitted_at: submittedAtIso,
                      answer_saved_at: answerSavedAtIso,
                    },
                  },
                  subjectType: 'practice_review',
                  subjectId: String(reviewRow.id),
                  httpRequestId: options?.httpRequestId,
                  language,
                },
                db,
              );
              if (!firstReviewJobId) {
                firstReviewJobId = job.job_id;
              }
            }
          } else {
            // ai_practice_review is disabled: record retryable failed review so quiz submission & day unlock still succeed!
            failedReviewCount += 1;
            await db.query(
              `INSERT INTO public.practice_reviews (
                 user_id,
                 attempt_id,
                 answer_id,
                 question_id,
                 review_status,
                 failure_code,
                 evidence_eligible
               )
               VALUES (
                 $1,
                 $2,
                 $3,
                 $4,
                 'failed'::public.review_status,
                 'FEATURE_DISABLED',
                 false
               )
               ON CONFLICT (answer_id) DO NOTHING`,
              [normalizedUserId, attempt.id, answerRow.id, frQuestion.id],
            );
          }
        }

        const nextAttemptStatus: AttemptStatus =
          pendingReviewCount > 0 || failedReviewCount > 0
            ? 'submitted'
            : 'feedback_available';
        const reviewedAtIso =
          nextAttemptStatus === 'feedback_available' ? submittedAtIso : null;

        await db.query(
          `UPDATE public.quiz_attempts
              SET status = $2::public.attempt_status,
                  submitted_at = $3::timestamptz,
                  reviewed_at = $4::timestamptz,
                  mcq_correct = $5,
                  mcq_total = $6,
                  performance_level = $7::public.performance_level,
                  improvement_recommendations = $8::jsonb
            WHERE id = $1
              AND user_id = $9`,
          [
            attempt.id,
            nextAttemptStatus,
            submittedAtIso,
            reviewedAtIso,
            mcqGrade.correct,
            mcqGrade.total,
            mcqGrade.performanceLevel,
            JSON.stringify(mcqGrade.defaultRecommendations),
            normalizedUserId,
          ],
        );

        // 3. Unlock next Daily Plan day regardless of score (`PRD` §33)
        const unlockOutcome =
          await this.dailyPlanService.markPlanItemCompletedInTx(
            db,
            normalizedUserId,
            lookup.plan_id,
            lookup.daily_plan_item_id,
          );

        // 4. Record MCQ learning evidence via internal EvidenceService (`EP-G04`)
        if (mcqGrade.total > 0) {
          await this.evidenceService.record(db, {
            user_id: normalizedUserId,
            skill_id: lookup.skill_id,
            career_level: lookup.career_level,
            roadmap_id: lookup.roadmap_id,
            topic_id: lookup.topic_id,
            source_type: 'quiz_attempt',
            source_id: String(attempt.id),
            difficulty: mcqGrade.dominantDifficulty,
            score_summary: {
              mcq_correct: mcqGrade.correct,
              mcq_total: mcqGrade.total,
            },
            performance_level: mcqGrade.performanceLevel,
            attempt_no: Number(attempt.attempt_no),
            occurred_at: submittedAtIso,
            evidence_eligible: true,
          });
        }

        return {
          statusCode: firstReviewJobId ? 202 : 200,
          body: {
            attempt_id: String(attempt.id),
            status: nextAttemptStatus,
            mcq_score: {
              correct: mcqGrade.correct,
              total: mcqGrade.total,
            },
            plan_day_unlocked: unlockOutcome.planDayUnlocked,
            next_plan_day_no: unlockOutcome.nextPlanDayNo,
            review_job_id: firstReviewJobId,
          },
        };
      },
      true,
      true,
    );
  }

  /**
   * `EP-Q06` (`GET /api/v1/quiz/:id/result`, `200 OK`, `Gate: none`, `R24 foreground = false`).
   */
  async getQuizResult(
    userId: string,
    attemptId: string,
  ): Promise<QuizResultDTO> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedAttemptId = this.assertUuid(
      attemptId,
      'id',
      'Quiz attempt id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const attemptRows = await db.query<
          Array<
            QuizAttemptRow & {
              topic_id: string;
              skill_id: string;
              title?: string;
              career_level: CareerLevel;
            }
          >
        >(
          `SELECT qa.id,
                  qa.user_id,
                  qa.daily_plan_item_id,
                  qa.quiz_id,
                  qa.attempt_no,
                  qa.retry_of_attempt_id,
                  qa.status::text AS status,
                  qa.question_ids,
                  qa.started_at,
                  qa.submitted_at,
                  qa.reviewed_at,
                  qa.mcq_correct,
                  qa.mcq_total,
                  qa.performance_level::text AS performance_level,
                  qa.improvement_recommendations,
                  q.topic_id,
                  t.skill_id,
                  t.title,
                  t.career_level::text AS career_level
             FROM public.quiz_attempts qa
             JOIN public.quizzes q ON q.id = qa.quiz_id
             JOIN public.topics t ON t.id = q.topic_id
            WHERE qa.id = $1
              AND qa.user_id = $2
            LIMIT 1`,
          [normalizedAttemptId, normalizedUserId],
        );
        const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }
        if (attempt.status === 'generated' || attempt.status === 'started') {
          fail(
            409,
            'QUIZ_NOT_SUBMITTED',
            'Quiz results are only available after the quiz has been submitted',
          );
        }

        const [qRows, ansRows, reviewRows, attempt2Rows, changeRows] =
          await Promise.all([
            db.query<GradingQuizQuestionRow[]>(
              `SELECT id,
                      sort_order,
                      question_type::text AS question_type,
                      difficulty::text AS difficulty,
                      prompt,
                      options,
                      correct_option_id,
                      explanation,
                      rubric,
                      response_hint,
                      max_length,
                      allow_i_dont_know
                 FROM public.quiz_questions
                WHERE id = ANY($1::uuid[])
                ORDER BY sort_order ASC`,
              [attempt.question_ids],
            ),
            db.query<SavedAnswerRow[]>(
              `SELECT id,
                      question_id,
                      selected_option_id,
                      answer_text,
                      i_dont_know,
                      is_correct,
                      saved_at,
                      raw_text_expires_at,
                      raw_text_purged_at,
                      created_at
                 FROM public.quiz_answers
                WHERE attempt_id = $1
                  AND user_id = $2`,
              [attempt.id, normalizedUserId],
            ),
            db.query<PracticeReviewRow[]>(
              `SELECT pr.id,
                      pr.question_id,
                      pr.review_status::text AS review_status,
                      pr.performance_level::text AS performance_level,
                      pr.improvement_recommendations
                 FROM public.practice_reviews pr
                 LEFT JOIN public.quiz_questions qq ON qq.id = pr.question_id
                WHERE pr.attempt_id = $1
                  AND pr.user_id = $2
                ORDER BY qq.sort_order ASC NULLS LAST, pr.id ASC`,
              [attempt.id, normalizedUserId],
            ),
            db.query<Array<{ id: string }>>(
              `SELECT id
                 FROM public.quiz_attempts
                WHERE user_id = $1
                  AND daily_plan_item_id = $2
                  AND attempt_no = 2
                LIMIT 1`,
              [normalizedUserId, attempt.daily_plan_item_id],
            ),
            db.query<
              Array<{
                skill_id: string;
                career_level: CareerLevel;
                from_state: string;
                to_state: string;
                reason: string | null;
              }>
            >(
              `SELECT ah.skill_id,
                      ah.career_level::text AS career_level,
                      ah.from_state::text AS from_state,
                      ah.to_state::text AS to_state,
                      ah.reason
                 FROM public.achievement_history ah
                WHERE ah.user_id = $1
                  AND ah.event_type = 'state_change'::public.progress_event_type
                  AND (
                    (ah.source_type = 'quiz_attempt'::public.evidence_source AND ah.source_id = $2)
                    OR (
                      ah.source_type = 'practice_review'::public.evidence_source
                      AND ah.source_id IN (
                        SELECT pr.id FROM public.practice_reviews pr WHERE pr.attempt_id = $2 AND pr.user_id = $1
                      )
                    )
                  )
                ORDER BY ah.occurred_at DESC, ah.id DESC
                LIMIT 1`,
              [normalizedUserId, attempt.id],
            ),
          ]);

        const scopedQuestionIds = attempt.question_ids.map(String);
        const scopedReviewIds = (
          Array.isArray(reviewRows) ? reviewRows : []
        ).map((r) => String(r.id));
        const reportRows =
          scopedQuestionIds.length > 0 || scopedReviewIds.length > 0
            ? await db.query<Array<{ target_type: string; target_id: string }>>(
                `SELECT target_type::text AS target_type, target_id
                   FROM public.content_reports
                  WHERE user_id = $1
                    AND (
                      (target_type = 'quiz_question'::public.report_target AND target_id = ANY($2::uuid[]))
                      OR (target_type = 'practice_review'::public.report_target AND target_id = ANY($3::uuid[]))
                    )`,
                [normalizedUserId, scopedQuestionIds, scopedReviewIds],
              )
            : [];

        const qMap = new Map<string, GradingQuizQuestionRow>();
        for (const q of Array.isArray(qRows) ? qRows : []) {
          qMap.set(String(q.id), q);
        }

        const ansMap = new Map<string, SavedAnswerRow>();
        for (const a of Array.isArray(ansRows) ? ansRows : []) {
          ansMap.set(String(a.question_id), a);
        }

        const reviewMap = new Map<string, PracticeReviewRow>();
        for (const r of Array.isArray(reviewRows) ? reviewRows : []) {
          reviewMap.set(String(r.question_id), r);
        }

        const reportedTargets = new Set<string>();
        for (const rep of Array.isArray(reportRows) ? reportRows : []) {
          reportedTargets.add(`${rep.target_type}:${rep.target_id}`);
        }

        const resultQuestions: QuizResultQuestionDTO[] = [];
        for (const qId of attempt.question_ids) {
          const q = qMap.get(String(qId));
          if (!q) {
            continue;
          }
          if (q.question_type === 'mcq') {
            const ans = ansMap.get(String(q.id));
            const yourAnswer =
              ans && !ans.i_dont_know ? (ans.selected_option_id ?? null) : null;
            const correctAnswer = String(q.correct_option_id ?? '');
            const isCorrect =
              ans?.is_correct !== null && ans?.is_correct !== undefined
                ? Boolean(ans.is_correct)
                : this.quizGradingService.gradeMcqAnswer(
                    yourAnswer,
                    Boolean(ans?.i_dont_know),
                    correctAnswer,
                  );

            resultQuestions.push({
              question_id: String(q.id),
              type: 'mcq',
              your_answer: yourAnswer,
              correct_answer: correctAnswer,
              is_correct: isCorrect,
              explanation: q.explanation ?? null,
              reportable: !reportedTargets.has(`quiz_question:${q.id}`),
            });
          } else {
            const ans = ansMap.get(String(q.id));
            const rev = reviewMap.get(String(q.id));
            const reviewId = rev?.id ? String(rev.id) : null;
            const isExpired =
              ans !== undefined &&
              ((ans.raw_text_purged_at !== null &&
                ans.raw_text_purged_at !== undefined) ||
                Boolean(
                  this.privacyRetentionService?.isRawTextExpired?.({
                    created_at: ans.created_at ?? ans.saved_at ?? new Date(0),
                    raw_text_expires_at: ans.raw_text_expires_at ?? null,
                  }),
                ));
            const userAnswer =
              ans &&
              !ans.i_dont_know &&
              !isExpired &&
              typeof ans.answer_text === 'string' &&
              ans.answer_text.trim().length > 0
                ? ans.answer_text
                : null;
            resultQuestions.push({
              question_id: String(q.id),
              type: 'free_response',
              user_answer: userAnswer,
              explanation: buildFreeResponseReferenceExplanation(
                q.explanation,
                q.rubric,
              ),
              practice_review_id: reviewId,
              review_status: rev?.review_status ?? 'not_evidence',
              reportable: reviewId
                ? !reportedTargets.has(`practice_review:${reviewId}`)
                : !reportedTargets.has(`quiz_question:${q.id}`),
            });
          }
        }

        const latestChange = Array.isArray(changeRows)
          ? changeRows[0]
          : undefined;
        const progressChange: ProgressChangeSummaryDTO | null = latestChange
          ? {
              skill_id: String(latestChange.skill_id),
              career_level: latestChange.career_level,
              from: latestChange.from_state as ProgressChangeSummaryDTO['from'],
              to: latestChange.to_state as ProgressChangeSummaryDTO['to'],
              reason: String(latestChange.reason ?? ''),
            }
          : null;

        const hasAttempt2 =
          Array.isArray(attempt2Rows) && attempt2Rows.length > 0;
        const attemptNo = Number(attempt.attempt_no);

        const mergedRecommendations: string[] = [];
        const appendRecs = (raw: unknown) => {
          for (const rec of normalizeStringArray(raw)) {
            if (!mergedRecommendations.includes(rec)) {
              mergedRecommendations.push(rec);
            }
          }
        };
        appendRecs(attempt.improvement_recommendations);
        for (const rev of Array.isArray(reviewRows) ? reviewRows : []) {
          if (rev.review_status === 'reviewed') {
            appendRecs(rev.improvement_recommendations);
          }
        }

        return {
          attempt_id: String(attempt.id),
          status: attempt.status,
          attempt_no: attemptNo,
          ...(typeof attempt.title === 'string' &&
          attempt.title.trim().length > 0
            ? { topic_title: attempt.title.trim() }
            : {}),
          mcq_score: {
            correct: Math.max(0, Number(attempt.mcq_correct ?? 0)),
            total: Math.max(0, Number(attempt.mcq_total ?? 0)),
          },
          performance_level: attempt.performance_level ?? null,
          questions: resultQuestions,
          improvement_recommendations: mergedRecommendations.slice(0, 6),
          progress_change: progressChange,
          retry_available: attemptNo === 1 && !hasAttempt2,
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-Q07` (`POST /api/v1/quiz/:id/retry`, `H-IDEM`, `Gate: write (quiz_practice)`, `R24 foreground = true`).
   */
  async retryQuizAttempt(
    userId: string,
    attemptId: string,
    options?: QuizRequestOptions,
  ): Promise<RetryQuizOutcome> {
    const normalizedUserId = this.assertUuid(userId, 'user_id', 'User id');
    const normalizedAttemptId = this.assertUuid(
      attemptId,
      'id',
      'Quiz attempt id',
    );

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        await this.assertQuizPracticeFeatureEnabledInTx(db, normalizedUserId);

        const lookupRows = await db.query<
          Array<{
            id: string;
            daily_plan_item_id: string;
            plan_id: string;
            roadmap_id: string;
            roadmap_status: 'draft' | 'locked' | 'archived';
            topic_id: string;
            skill_id: string;
            slug: string;
            title?: string;
            career_level: CareerLevel;
          }>
        >(
          `SELECT qa.id,
                  qa.daily_plan_item_id,
                  dpi.plan_id,
                  dp.roadmap_id,
                  r.status::text AS roadmap_status,
                  q.topic_id,
                  t.skill_id,
                  t.slug,
                  t.title,
                  t.career_level::text AS career_level
             FROM public.quiz_attempts qa
             JOIN public.daily_plan_items dpi ON dpi.id = qa.daily_plan_item_id
             JOIN public.daily_plans dp ON dp.id = dpi.plan_id
             JOIN public.roadmaps r ON r.id = dp.roadmap_id
             JOIN public.quizzes q ON q.id = qa.quiz_id
             JOIN public.topics t ON t.id = q.topic_id
            WHERE qa.id = $1
              AND qa.user_id = $2
            LIMIT 1`,
          [normalizedAttemptId, normalizedUserId],
        );
        const lookup = Array.isArray(lookupRows) ? lookupRows[0] : undefined;
        if (!lookup) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }

        // Lock in EP-L03-compatible order: daily_plans -> roadmaps -> daily_plan_items -> quiz_attempts
        await db.query(
          `SELECT id FROM public.daily_plans WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [lookup.plan_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.roadmaps WHERE id = $1 AND user_id = $2 FOR SHARE`,
          [lookup.roadmap_id, normalizedUserId],
        );
        await db.query(
          `SELECT id FROM public.daily_plan_items WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [lookup.daily_plan_item_id, normalizedUserId],
        );

        const attemptRows = await db.query<QuizAttemptRow[]>(
          `SELECT id,
                  user_id,
                  daily_plan_item_id,
                  quiz_id,
                  attempt_no,
                  retry_of_attempt_id,
                  status::text AS status,
                  question_ids,
                  started_at,
                  submitted_at,
                  reviewed_at,
                  mcq_correct,
                  mcq_total,
                  performance_level::text AS performance_level,
                  improvement_recommendations
             FROM public.quiz_attempts
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [normalizedAttemptId, normalizedUserId],
        );
        const attempt = Array.isArray(attemptRows) ? attemptRows[0] : undefined;
        if (!attempt) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Quiz attempt not found');
        }
        if (attempt.status === 'generated' || attempt.status === 'started') {
          fail(
            409,
            'QUIZ_NOT_SUBMITTED',
            'Submit the initial quiz attempt before requesting a retry',
          );
        }
        if (Number(attempt.attempt_no) >= 2) {
          fail(
            409,
            'RETRY_LIMIT_REACHED',
            'Only one retry is permitted per topic quiz',
          );
        }

        const existingAttempt2Rows = await db.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.quiz_attempts
            WHERE user_id = $1
              AND daily_plan_item_id = $2
              AND attempt_no = 2
            LIMIT 1`,
          [normalizedUserId, lookup.daily_plan_item_id],
        );
        if (
          Array.isArray(existingAttempt2Rows) &&
          existingAttempt2Rows.length > 0
        ) {
          fail(
            409,
            'RETRY_LIMIT_REACHED',
            'Only one retry is permitted per topic quiz',
          );
        }

        const approvedTopic =
          await this.topicContentService.findApprovedCanonicalTopicInTx(
            db,
            lookup.skill_id,
            lookup.slug,
            lookup.career_level,
          );
        if (!approvedTopic) {
          fail(
            409,
            'PLAN_ITEM_NOT_AVAILABLE',
            'Topic study content is currently unavailable; please refresh before retrying this quiz',
          );
        }
        const effectiveTopicId = String(approvedTopic.id);
        const effectiveContentVersion = Number(approvedTopic.content_version);

        const sharedVariant2Quiz = await this.findApprovedSharedQuizInTx(
          db,
          effectiveTopicId,
          effectiveContentVersion,
          2,
        );
        if (sharedVariant2Quiz) {
          const insertedAttempt2Raw = await db.query<unknown>(
            `INSERT INTO public.quiz_attempts (
               user_id,
               daily_plan_item_id,
               quiz_id,
               attempt_no,
               retry_of_attempt_id,
               status,
               question_ids
             )
             VALUES (
               $1,
               $2,
               $3,
               2,
               $4,
               'generated'::public.attempt_status,
               $5::uuid[]
             )
             ON CONFLICT (daily_plan_item_id, attempt_no) DO NOTHING
             RETURNING id,
                       user_id,
                       daily_plan_item_id,
                       quiz_id,
                       attempt_no,
                       retry_of_attempt_id,
                       status::text AS status,
                       question_ids,
                       started_at,
                       submitted_at,
                       reviewed_at,
                       mcq_correct,
                       mcq_total,
                       performance_level::text AS performance_level,
                       improvement_recommendations`,
            [
              normalizedUserId,
              lookup.daily_plan_item_id,
              sharedVariant2Quiz.quizId,
              attempt.id,
              sharedVariant2Quiz.questionIds,
            ],
          );
          const createdAttempt2 =
            extractReturningRows<QuizAttemptRow>(insertedAttempt2Raw)[0];
          if (!createdAttempt2) {
            fail(
              409,
              'RETRY_LIMIT_REACHED',
              'Only one retry is permitted per topic quiz',
            );
          }
          const attempt2Dto = await this.buildSafeQuizAttemptDtoInTx(
            db,
            createdAttempt2,
            effectiveTopicId,
            lookup.career_level,
            approvedTopic?.title ?? lookup.title,
          );
          return {
            statusCode: 201,
            body: attempt2Dto,
          };
        }

        // Check for existing active user-owned quiz_generate job for variant 2
        const activeJobRows = await db.query<
          Array<{ id: string; status: 'queued' | 'preparing' }>
        >(
          `SELECT id, status::text AS status
             FROM public.ai_requests
            WHERE user_id = $1
              AND is_async = true
              AND job_kind = 'quiz_generate'::public.job_kind
              AND subject_type = 'daily_plan_item'
              AND subject_id = $2
              AND COALESCE((input_payload->'args'->>'variant_no')::int, 1) = 2
              AND status IN ('queued'::public.job_status, 'preparing'::public.job_status)
            ORDER BY created_at DESC
            LIMIT 1`,
          [normalizedUserId, lookup.daily_plan_item_id],
        );
        const existingJob = Array.isArray(activeJobRows)
          ? activeJobRows[0]
          : undefined;
        if (existingJob?.id) {
          return {
            statusCode: 202,
            body: {
              job_id: String(existingJob.id),
              kind: 'quiz_generate',
              status: existingJob.status,
              poll_url: `/api/v1/jobs/${existingJob.id}`,
              retry_after_seconds: DEFAULT_POLL_RETRY_SECONDS,
            },
          };
        }

        const language = resolvePreferredLanguage(options?.acceptLanguage);
        const enqueuedJob = await this.jobProducer.enqueue(
          {
            userId: normalizedUserId,
            kind: 'quiz_generate',
            envelope: {
              v: 1,
              args: {
                daily_plan_item_id: String(lookup.daily_plan_item_id),
                topic_id: effectiveTopicId,
                content_version: effectiveContentVersion,
                variant_no: 2,
              },
              expected_refs: {
                content_version: effectiveContentVersion,
              },
            },
            subjectType: 'daily_plan_item',
            subjectId: String(lookup.daily_plan_item_id),
            httpRequestId: options?.httpRequestId,
            language,
          },
          db,
        );

        return {
          statusCode: 202,
          body: enqueuedJob,
        };
      },
      true,
      true,
    );
  }
}
