import { Inject, Injectable } from '@nestjs/common';
import type {
  AIRequestDTO,
  QuizGenerationOutput,
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
  QUESTION_DIFFICULTY_VALUES,
  type QuestionDifficulty,
} from '../../progress/dto/progress.dto.js';
import {
  RESPONSE_HINT_VALUES,
  type QuestionType,
  type ResponseHint,
} from '../dto/quiz.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);
const JOB_READY_FORBIDDEN_PATTERN =
  /\b(job[\s-]?ready|guarantee[ds]?\s+(a\s+)?job|100%\s+placement)\b/i;

export const SUPPORTED_QUIZ_JOB_KINDS = ['quiz_generate'] as const;
export type SupportedQuizJobKind = (typeof SUPPORTED_QUIZ_JOB_KINDS)[number];

interface ParsedQuizGeneratePayload {
  dailyPlanItemId: string;
  topicId: string;
  contentVersion: number;
  variantNo: 1 | 2;
  expectedContentVersion: number | null;
}

interface PlanItemSnapshotRow {
  item_id: string;
  plan_id: string;
  roadmap_id: string;
  roadmap_status: 'draft' | 'locked' | 'archived';
  topic_id: string;
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
  content_version: number | string;
  skill_name: string;
}

interface ApprovedTopicRow {
  id: string;
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
  content_version: number | string;
  explanation_markdown: string | null;
  language: UiLanguage | null;
}

interface NormalizedQuizQuestionForInsert {
  sort_order: number;
  question_type: QuestionType;
  difficulty: QuestionDifficulty;
  prompt: string;
  options: Array<{ option_id: string; text: string }> | null;
  correct_option_id: string | null;
  explanation: string | null;
  rubric: {
    correctness_criteria: string[];
    understanding_criteria: string[];
    reasoning_criteria: string[];
  } | null;
  response_hint: ResponseHint | null;
  max_length: number | null;
  allow_i_dont_know: boolean;
}

interface NormalizedQuizForInsert {
  is_reduced: boolean;
  mcq_count: number;
  free_response_count: number;
  questions: NormalizedQuizQuestionForInsert[];
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

function parseQuizGeneratePayload(
  job: ClaimedJobRow,
): ParsedQuizGeneratePayload {
  if (job.job_kind !== 'quiz_generate') {
    fail(
      422,
      'INVALID_ENUM_VALUE',
      'Unsupported quiz job kind',
      undefined,
      false,
    );
  }
  const payload = job.input_payload;
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.v !== 1
  ) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Invalid quiz_generate job payload',
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
      : {};
  if (!args) {
    fail(
      422,
      'VALIDATION_FAILED',
      'quiz_generate job missing args',
      undefined,
      false,
    );
  }

  const dailyPlanItemId =
    typeof args.daily_plan_item_id === 'string'
      ? args.daily_plan_item_id.trim().toLowerCase()
      : '';
  const topicId =
    typeof args.topic_id === 'string' ? args.topic_id.trim().toLowerCase() : '';
  const contentVersion = Number(args.content_version);
  const variantNo = Number(args.variant_no);
  const expectedContentVersion =
    refs.content_version !== undefined && refs.content_version !== null
      ? Number(refs.content_version)
      : null;

  if (
    !UUID_PATTERN.test(dailyPlanItemId) ||
    !UUID_PATTERN.test(topicId) ||
    !Number.isInteger(contentVersion) ||
    contentVersion < 1 ||
    (variantNo !== 1 && variantNo !== 2) ||
    (expectedContentVersion !== null &&
      (!Number.isInteger(expectedContentVersion) || expectedContentVersion < 1))
  ) {
    fail(
      422,
      'VALIDATION_FAILED',
      'Invalid quiz_generate job arguments',
      undefined,
      false,
    );
  }

  return {
    dailyPlanItemId,
    topicId,
    contentVersion,
    variantNo: variantNo as 1 | 2,
    expectedContentVersion,
  };
}

/**
 * Normalizes and validates `QuizGenerationOutput` (`C08` §6.2.5) and re-indexes
 * `sort_order` contiguously (`1..mcqCount`, then `mcqCount + 1 .. total`) so
 * `uq_quiz_questions_order (quiz_id, sort_order)` never collides (`007_assessment.sql`).
 */
export function normalizeAndReindexGeneratedQuiz(
  rawOutput: unknown,
  variantNo: 1 | 2,
): NormalizedQuizForInsert {
  if (!rawOutput || typeof rawOutput !== 'object' || Array.isArray(rawOutput)) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI output failed validation and was discarded. Please try again.',
      undefined,
      true,
    );
  }
  const output = rawOutput as QuizGenerationOutput;
  if (
    typeof output.is_reduced !== 'boolean' ||
    !Array.isArray(output.mcq_questions) ||
    !Array.isArray(output.free_response_questions)
  ) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Quiz output structure is invalid',
      undefined,
      true,
    );
  }

  const mcqCount = output.mcq_questions.length;
  const frCount = output.free_response_questions.length;
  if (mcqCount + frCount < 1) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Generated quiz must contain at least one question',
      undefined,
      true,
    );
  }
  if (!output.is_reduced && variantNo === 1) {
    if (mcqCount !== 20 || frCount < 5 || frCount > 10) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Standard quiz must contain 20 MCQs and 5 to 10 free-response questions',
        undefined,
        true,
      );
    }
  }

  const sortedMcqs = [...output.mcq_questions].sort(
    (a, b) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0),
  );
  const sortedFrs = [...output.free_response_questions].sort(
    (a, b) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0),
  );

  const questions: NormalizedQuizQuestionForInsert[] = [];
  let nextSortOrder = 1;

  for (const rawMcq of sortedMcqs) {
    const prompt =
      typeof rawMcq?.prompt === 'string' ? rawMcq.prompt.trim() : '';
    const explanation =
      typeof rawMcq?.explanation === 'string' ? rawMcq.explanation.trim() : '';
    const difficulty = rawMcq?.difficulty;
    if (
      !prompt ||
      prompt.length > 4_000 ||
      !explanation ||
      explanation.length > 4_000 ||
      JOB_READY_FORBIDDEN_PATTERN.test(prompt) ||
      JOB_READY_FORBIDDEN_PATTERN.test(explanation) ||
      typeof difficulty !== 'string' ||
      !(QUESTION_DIFFICULTY_VALUES as readonly string[]).includes(difficulty) ||
      typeof rawMcq?.allow_i_dont_know !== 'boolean' ||
      !Array.isArray(rawMcq?.options) ||
      rawMcq.options.length < 2 ||
      rawMcq.options.length > 6
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Invalid MCQ question in generated quiz',
        undefined,
        true,
      );
    }

    const options: Array<{ option_id: string; text: string }> = [];
    const seenOptionIds = new Set<string>();
    for (const rawOpt of rawMcq.options) {
      const optionId =
        typeof rawOpt?.option_id === 'string' ? rawOpt.option_id.trim() : '';
      const text = typeof rawOpt?.text === 'string' ? rawOpt.text.trim() : '';
      if (
        !optionId ||
        optionId.length > 64 ||
        !text ||
        text.length > 1_000 ||
        seenOptionIds.has(optionId)
      ) {
        fail(
          502,
          'AI_VALIDATION_FAILED',
          'Invalid MCQ option in generated quiz',
          undefined,
          true,
        );
      }
      seenOptionIds.add(optionId);
      options.push({ option_id: optionId, text });
    }

    const correctOptionId =
      typeof rawMcq.correct_option_id === 'string'
        ? rawMcq.correct_option_id.trim()
        : '';
    if (!correctOptionId || !seenOptionIds.has(correctOptionId)) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'MCQ correct_option_id does not match options',
        undefined,
        true,
      );
    }

    questions.push({
      sort_order: nextSortOrder,
      question_type: 'mcq',
      difficulty: difficulty as QuestionDifficulty,
      prompt,
      options,
      correct_option_id: correctOptionId,
      explanation,
      rubric: null,
      response_hint: null,
      max_length: null,
      allow_i_dont_know: rawMcq.allow_i_dont_know,
    });
    nextSortOrder += 1;
  }

  for (const rawFr of sortedFrs) {
    const prompt = typeof rawFr?.prompt === 'string' ? rawFr.prompt.trim() : '';
    const difficulty = rawFr?.difficulty;
    const responseHint = rawFr?.response_hint;
    const maxLength = Number(rawFr?.max_length);
    const rubric = rawFr?.rubric;

    const parseCriteriaList = (rawList: unknown): string[] | null => {
      if (!Array.isArray(rawList)) {
        return null;
      }
      const parsed: string[] = [];
      for (const entry of rawList) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          return null;
        }
        parsed.push(entry.trim());
      }
      return parsed;
    };

    const correctnessCriteria =
      rubric && typeof rubric === 'object'
        ? parseCriteriaList(rubric.correctness_criteria)
        : null;
    const understandingCriteria =
      rubric && typeof rubric === 'object'
        ? parseCriteriaList(rubric.understanding_criteria)
        : null;
    const reasoningCriteria =
      rubric && typeof rubric === 'object'
        ? parseCriteriaList(rubric.reasoning_criteria)
        : null;

    if (
      !prompt ||
      prompt.length > 4_000 ||
      JOB_READY_FORBIDDEN_PATTERN.test(prompt) ||
      typeof difficulty !== 'string' ||
      !(QUESTION_DIFFICULTY_VALUES as readonly string[]).includes(difficulty) ||
      typeof responseHint !== 'string' ||
      !(RESPONSE_HINT_VALUES as readonly string[]).includes(responseHint) ||
      typeof rawFr?.allow_i_dont_know !== 'boolean' ||
      !Number.isInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > 8_000 ||
      !correctnessCriteria ||
      !understandingCriteria ||
      !reasoningCriteria
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Invalid free-response question in generated quiz',
        undefined,
        true,
      );
    }

    questions.push({
      sort_order: nextSortOrder,
      question_type: 'free_response',
      difficulty: difficulty as QuestionDifficulty,
      prompt,
      options: null,
      correct_option_id: null,
      explanation: null,
      rubric: {
        correctness_criteria: correctnessCriteria,
        understanding_criteria: understandingCriteria,
        reasoning_criteria: reasoningCriteria,
      },
      response_hint: responseHint as ResponseHint,
      max_length: maxLength,
      allow_i_dont_know: rawFr.allow_i_dont_know,
    });
    nextSortOrder += 1;
  }

  return {
    is_reduced: output.is_reduced,
    mcq_count: mcqCount,
    free_response_count: frCount,
    questions,
  };
}

/**
 * Durable async job handler for `quiz_generate` (`C08` §6.2.5, `R12`, `R13`).
 */
@Injectable()
export class QuizGenerateJobHandler implements JobHandler {
  readonly supportedKinds = SUPPORTED_QUIZ_JOB_KINDS;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
  ) {}

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

  private async findApprovedSharedQuizWithQuestions(
    db: JobQueryExecutor,
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

  async execute(
    job: ClaimedJobRow,
    signal: AbortSignal,
  ): Promise<JobExecutionResult> {
    const parsed = parseQuizGeneratePayload(job);

    const snapshot = await this.runRead(async (db) => {
      const itemRows = await db.query<PlanItemSnapshotRow[]>(
        `SELECT dpi.id AS item_id,
                dpi.plan_id,
                dp.roadmap_id,
                r.status::text AS roadmap_status,
                dpi.topic_id,
                t.skill_id,
                t.slug,
                t.title,
                t.career_level::text AS career_level,
                t.content_version,
                s.canonical_name AS skill_name
           FROM public.daily_plan_items dpi
           JOIN public.daily_plans dp ON dp.id = dpi.plan_id
           JOIN public.roadmaps r ON r.id = dp.roadmap_id
           JOIN public.topics t ON t.id = dpi.topic_id
           JOIN public.skills s ON s.id = t.skill_id
          WHERE dpi.id = $1
            AND dpi.user_id = $2
          LIMIT 1`,
        [parsed.dailyPlanItemId, job.user_id],
      );
      const item = Array.isArray(itemRows) ? itemRows[0] : undefined;
      if (!item || item.roadmap_status !== 'locked') {
        return {
          item: null,
          approvedTopic: null,
          existingAttemptId: null,
          reusableQuiz: null,
        };
      }

      const existingAttemptRows = await db.query<Array<{ id: string }>>(
        `SELECT id
           FROM public.quiz_attempts
          WHERE user_id = $1
            AND daily_plan_item_id = $2
            AND attempt_no = $3
          LIMIT 1`,
        [job.user_id, item.item_id, parsed.variantNo],
      );
      const existingAttemptId =
        Array.isArray(existingAttemptRows) && existingAttemptRows[0]?.id
          ? String(existingAttemptRows[0].id)
          : null;

      const approvedRows = await db.query<ApprovedTopicRow[]>(
        `SELECT id,
                skill_id,
                slug,
                title,
                career_level::text AS career_level,
                content_version,
                explanation_markdown,
                language::text AS language
           FROM public.topics
          WHERE skill_id = $1
            AND slug = $2
            AND career_level = $3::public.career_level
            AND status = 'approved'::public.content_status
            AND deleted_at IS NULL
          ORDER BY content_version DESC
          LIMIT 1`,
        [item.skill_id, item.slug, item.career_level],
      );
      const approvedTopic = Array.isArray(approvedRows)
        ? (approvedRows[0] ?? null)
        : null;
      if (!approvedTopic) {
        return {
          item,
          approvedTopic: null,
          existingAttemptId,
          reusableQuiz: null,
        };
      }

      const reusableQuiz = await this.findApprovedSharedQuizWithQuestions(
        db,
        approvedTopic.id,
        Number(approvedTopic.content_version),
        parsed.variantNo,
      );

      return {
        item,
        approvedTopic,
        existingAttemptId,
        reusableQuiz,
      };
    });

    if (!snapshot.item || !snapshot.approvedTopic) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    if (snapshot.existingAttemptId || snapshot.reusableQuiz) {
      return {
        resultType: 'quiz_attempt',
        resultId: snapshot.existingAttemptId ?? parsed.dailyPlanItemId,
        providerKey: '',
        modelId: '',
        promptVersionId: '',
        outputSchemaId: 'quiz_generate.v1',
        fallbackUsed: false,
        language: snapshot.approvedTopic.language ?? 'mixed',
        inputUnits: 0,
        outputUnits: 0,
        latencyMs: 1,
        output: null,
        skipAiGeneration: true,
      };
    }

    const language: UiLanguage =
      typeof job.language === 'string' && VALID_LANGUAGES.has(job.language)
        ? (job.language as UiLanguage)
        : (snapshot.approvedTopic.language ?? 'mixed');

    const aiRequest: AIRequestDTO = {
      request_id: job.id,
      user_id: job.user_id,
      task: 'quiz_generate',
      feature_key: 'quiz_practice',
      output_schema: 'quiz_generate.v1',
      language,
      idempotency_key: job.idempotency_key ?? job.id,
      untrusted_inputs: [snapshot.approvedTopic.title],
      context: {
        topic_id: snapshot.approvedTopic.id,
        slug: snapshot.approvedTopic.slug,
        skill_id: snapshot.approvedTopic.skill_id,
        skill_name: snapshot.item.skill_name,
        career_level: snapshot.approvedTopic.career_level,
        content_version: Number(snapshot.approvedTopic.content_version),
        variant_no: parsed.variantNo,
        explanation_guidance:
          'Provide a clear 2-3 sentence conceptual explanation for every multiple-choice and free-response question covering why the correct answer works and why common distractors fail.',
      },
      budget: {
        max_input_units: 10_000,
        max_output_units: 8_000,
        timeout_ms: 60_000,
      },
    };

    const aiResponse = await this.aiGateway.execute<QuizGenerationOutput>(
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

    return {
      resultType: 'quiz_attempt',
      resultId: parsed.dailyPlanItemId,
      providerKey: aiResponse.provider_id,
      modelId: aiResponse.model_id,
      promptVersionId: aiResponse.prompt_version_id,
      outputSchemaId: 'quiz_generate.v1',
      fallbackUsed: aiResponse.fallback_used,
      language,
      inputUnits: aiResponse.usage_units.input,
      outputUnits: aiResponse.usage_units.output,
      latencyMs: aiResponse.latency_ms,
      output: aiResponse.output,
    };
  }

  async verifyExpectedRefs(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
  ): Promise<{ ok: boolean; reason?: string }> {
    const parsed = parseQuizGeneratePayload(job);

    const rows = await tx.query<PlanItemSnapshotRow[]>(
      `SELECT dpi.id AS item_id,
              dpi.plan_id,
              dp.roadmap_id,
              r.status::text AS roadmap_status,
              dpi.topic_id,
              t.skill_id,
              t.slug,
              t.title,
              t.career_level::text AS career_level,
              t.content_version,
              s.canonical_name AS skill_name
         FROM public.daily_plan_items dpi
         JOIN public.daily_plans dp ON dp.id = dpi.plan_id
         JOIN public.roadmaps r ON r.id = dp.roadmap_id
         JOIN public.topics t ON t.id = dpi.topic_id
         JOIN public.skills s ON s.id = t.skill_id
        WHERE dpi.id = $1
          AND dpi.user_id = $2
        LIMIT 1`,
      [parsed.dailyPlanItemId, job.user_id],
    );
    const item = Array.isArray(rows) ? rows[0] : undefined;
    if (!item) {
      return { ok: false, reason: 'PLAN_ITEM_NOT_FOUND' };
    }
    if (item.roadmap_status !== 'locked') {
      return { ok: false, reason: 'ROADMAP_NOT_LOCKED' };
    }

    const approvedRows = await tx.query<
      Array<{ id: string; content_version: number | string }>
    >(
      `SELECT id, content_version
         FROM public.topics
        WHERE skill_id = $1
          AND slug = $2
          AND career_level = $3::public.career_level
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        ORDER BY content_version DESC
        LIMIT 1`,
      [item.skill_id, item.slug, item.career_level],
    );
    const approved = Array.isArray(approvedRows) ? approvedRows[0] : undefined;
    if (!approved) {
      return { ok: false, reason: 'APPROVED_TOPIC_NOT_FOUND' };
    }
    if (
      parsed.expectedContentVersion !== null &&
      Number(approved.content_version) !== parsed.expectedContentVersion
    ) {
      return { ok: false, reason: 'TOPIC_CONTENT_VERSION_DRIFT' };
    }

    return { ok: true };
  }

  async persistArtifact(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    result: JobExecutionResult,
    context?: JobCommitContext,
  ): Promise<{ resultType: 'quiz_attempt'; resultId: string }> {
    const parsed = parseQuizGeneratePayload(job);

    // 1. Resolve plan_id and roadmap_id, then lock in EP-L03-compatible order:
    // daily_plans FOR SHARE -> roadmaps FOR SHARE -> daily_plan_items FOR UPDATE
    const lookupRows = await tx.query<
      Array<{ plan_id: string; roadmap_id: string }>
    >(
      `SELECT dpi.plan_id, dp.roadmap_id
         FROM public.daily_plan_items dpi
         JOIN public.daily_plans dp ON dp.id = dpi.plan_id
        WHERE dpi.id = $1
          AND dpi.user_id = $2
        LIMIT 1`,
      [parsed.dailyPlanItemId, job.user_id],
    );
    const lookup = Array.isArray(lookupRows) ? lookupRows[0] : undefined;
    if (!lookup) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    await tx.query(
      `SELECT id FROM public.daily_plans WHERE id = $1 AND user_id = $2 FOR SHARE`,
      [lookup.plan_id, job.user_id],
    );
    const roadmapRows = await tx.query<Array<{ status: string }>>(
      `SELECT status::text AS status FROM public.roadmaps WHERE id = $1 AND user_id = $2 FOR SHARE`,
      [lookup.roadmap_id, job.user_id],
    );
    if (roadmapRows?.[0]?.status !== 'locked') {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    const itemRows = await tx.query<Array<{ id: string; topic_id: string }>>(
      `SELECT id, topic_id
         FROM public.daily_plan_items
        WHERE id = $1
          AND user_id = $2
        FOR UPDATE`,
      [parsed.dailyPlanItemId, job.user_id],
    );
    const lockedItem = Array.isArray(itemRows) ? itemRows[0] : undefined;
    if (!lockedItem) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    // 2. Check if attempt already exists for (daily_plan_item_id, variantNo)
    const existingAttemptRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.quiz_attempts
        WHERE user_id = $1
          AND daily_plan_item_id = $2
          AND attempt_no = $3
        LIMIT 1`,
      [job.user_id, lockedItem.id, parsed.variantNo],
    );
    if (Array.isArray(existingAttemptRows) && existingAttemptRows[0]?.id) {
      return {
        resultType: 'quiz_attempt',
        resultId: String(existingAttemptRows[0].id),
      };
    }

    let retryOfAttemptId: string | null = null;
    if (parsed.variantNo === 2) {
      const attempt1Rows = await tx.query<
        Array<{ id: string; status: string }>
      >(
        `SELECT id, status::text AS status
           FROM public.quiz_attempts
          WHERE user_id = $1
            AND daily_plan_item_id = $2
            AND attempt_no = 1
          LIMIT 1`,
        [job.user_id, lockedItem.id],
      );
      const attempt1 = Array.isArray(attempt1Rows)
        ? attempt1Rows[0]
        : undefined;
      if (
        !attempt1 ||
        attempt1.status === 'generated' ||
        attempt1.status === 'started'
      ) {
        fail(
          409,
          'STALE_JOB_INPUT',
          'Initial quiz attempt must be submitted before generating a retry',
          undefined,
          false,
        );
      }
      retryOfAttemptId = String(attempt1.id);
    }

    // 3. Resolve canonical approved topic
    const topicMetaRows = await tx.query<
      Array<{ skill_id: string; slug: string; career_level: CareerLevel }>
    >(
      `SELECT skill_id, slug, career_level::text AS career_level
         FROM public.topics
        WHERE id = $1
        LIMIT 1`,
      [lockedItem.topic_id],
    );
    const topicMeta = Array.isArray(topicMetaRows)
      ? topicMetaRows[0]
      : undefined;
    if (!topicMeta) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Topic metadata not found',
        undefined,
        false,
      );
    }

    const approvedTopicRows = await tx.query<
      Array<{ id: string; content_version: number | string }>
    >(
      `SELECT id, content_version
         FROM public.topics
        WHERE skill_id = $1
          AND slug = $2
          AND career_level = $3::public.career_level
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        ORDER BY content_version DESC
        LIMIT 1`,
      [topicMeta.skill_id, topicMeta.slug, topicMeta.career_level],
    );
    const approvedTopic = Array.isArray(approvedTopicRows)
      ? approvedTopicRows[0]
      : undefined;
    if (!approvedTopic) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Approved canonical topic not found',
        undefined,
        false,
      );
    }

    const effectiveTopicId = String(approvedTopic.id);
    const effectiveContentVersion = Number(approvedTopic.content_version);

    // 4. Serialize shared quiz persistence per (topic_id, content_version, variant_no)
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `quiz:${effectiveTopicId}:${effectiveContentVersion}:${parsed.variantNo}`,
    ]);

    let sharedQuiz = await this.findApprovedSharedQuizWithQuestions(
      tx,
      effectiveTopicId,
      effectiveContentVersion,
      parsed.variantNo,
    );

    if (!sharedQuiz) {
      if (result.skipAiGeneration === true) {
        fail(
          502,
          'AI_GENERATION_FAILED',
          'AI generation failed. No partial data was saved.',
          undefined,
          true,
        );
      }

      const normalized = normalizeAndReindexGeneratedQuiz(
        result.output,
        parsed.variantNo,
      );
      const aiGenerationId = context?.aiGenerationId ?? null;

      // Upsert public.quizzes on uq_quizzes_version (topic_id, content_version, variant_no)
      const upsertedQuizRaw = await tx.query<unknown>(
        `INSERT INTO public.quizzes (
           topic_id,
           content_version,
           variant_no,
           status,
           mcq_count,
           free_response_count,
           is_reduced,
           ai_generation_id,
           approved_at,
           hidden_at,
           hidden_reason
         )
         VALUES (
           $1,
           $2,
           $3,
           'approved'::public.content_status,
           $4,
           $5,
           $6,
           $7,
           clock_timestamp(),
           NULL,
           NULL
         )
         ON CONFLICT (topic_id, content_version, variant_no) DO UPDATE
           SET status = 'approved'::public.content_status,
               mcq_count = EXCLUDED.mcq_count,
               free_response_count = EXCLUDED.free_response_count,
               is_reduced = EXCLUDED.is_reduced,
               ai_generation_id = EXCLUDED.ai_generation_id,
               approved_at = clock_timestamp(),
               hidden_at = NULL,
               hidden_reason = NULL
         RETURNING id`,
        [
          effectiveTopicId,
          effectiveContentVersion,
          parsed.variantNo,
          normalized.mcq_count,
          normalized.free_response_count,
          normalized.is_reduced,
          aiGenerationId,
        ],
      );
      const quizRow = extractReturningRows<{ id: string }>(upsertedQuizRaw)[0];
      if (!quizRow?.id) {
        fail(500, 'DATABASE_ERROR', 'Failed to persist shared quiz');
      }
      const quizId = String(quizRow.id);

      // Remove any prior unreferenced draft/hidden questions before inserting contiguously re-indexed questions
      await tx.query(
        `DELETE FROM public.quiz_questions q
          WHERE q.quiz_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM public.quiz_answers a WHERE a.question_id = q.id
            )`,
        [quizId],
      );

      const questionIds: string[] = [];
      for (const q of normalized.questions) {
        const insertedQRaw = await tx.query<unknown>(
          `INSERT INTO public.quiz_questions (
             quiz_id,
             sort_order,
             question_type,
             difficulty,
             prompt,
             options,
             correct_option_id,
             explanation,
             rubric,
             response_hint,
             max_length,
             allow_i_dont_know
           )
           VALUES (
             $1,
             $2,
             $3::public.question_type,
             $4::public.question_difficulty,
             $5,
             $6::jsonb,
             $7,
             $8,
             $9::jsonb,
             $10,
             $11,
             $12
           )
           RETURNING id`,
          [
            quizId,
            q.sort_order,
            q.question_type,
            q.difficulty,
            q.prompt,
            q.options ? JSON.stringify(q.options) : null,
            q.correct_option_id,
            q.explanation,
            q.rubric ? JSON.stringify(q.rubric) : null,
            q.response_hint,
            q.max_length,
            q.allow_i_dont_know,
          ],
        );
        const insertedQ = extractReturningRows<{ id: string }>(insertedQRaw)[0];
        if (!insertedQ?.id) {
          fail(500, 'DATABASE_ERROR', 'Failed to persist quiz question');
        }
        questionIds.push(String(insertedQ.id));
      }

      sharedQuiz = { quizId, questionIds };
    }

    // 5. Create the user's quiz_attempts row
    const insertedAttemptRaw = await tx.query<unknown>(
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
         $4,
         $5,
         'generated'::public.attempt_status,
         $6::uuid[]
       )
       ON CONFLICT (daily_plan_item_id, attempt_no) DO NOTHING
       RETURNING id`,
      [
        job.user_id,
        lockedItem.id,
        sharedQuiz.quizId,
        parsed.variantNo,
        retryOfAttemptId,
        sharedQuiz.questionIds,
      ],
    );
    const insertedAttempt = extractReturningRows<{ id: string }>(
      insertedAttemptRaw,
    )[0];

    let attemptId = insertedAttempt?.id ? String(insertedAttempt.id) : null;
    if (!attemptId) {
      const fallbackRows = await tx.query<Array<{ id: string }>>(
        `SELECT id
           FROM public.quiz_attempts
          WHERE user_id = $1
            AND daily_plan_item_id = $2
            AND attempt_no = $3
          LIMIT 1`,
        [job.user_id, lockedItem.id, parsed.variantNo],
      );
      attemptId = fallbackRows?.[0]?.id ? String(fallbackRows[0].id) : null;
    }

    if (!attemptId) {
      fail(500, 'DATABASE_ERROR', 'Failed to persist quiz attempt');
    }

    return {
      resultType: 'quiz_attempt',
      resultId: attemptId,
    };
  }
}
