import { Inject, Injectable } from '@nestjs/common';
import type {
  AIRequestDTO,
  TopicContentOutput,
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
  RESOURCE_TYPE_VALUES,
  type ResourceType,
} from '../dto/learning.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/.+/i;
const VALID_CAREER_LEVELS: ReadonlySet<string> = new Set([
  'junior',
  'mid',
  'senior',
]);
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);

export const SUPPORTED_LEARNING_JOB_KINDS = ['topic_content'] as const;
export type SupportedLearningJobKind =
  (typeof SUPPORTED_LEARNING_JOB_KINDS)[number];

interface ParsedTopicContentPayload {
  topicId: string;
  skillId: string;
  careerLevel: CareerLevel;
  contentVersion: number;
  expectedContentVersion: number;
}

interface TopicLookupRow {
  id: string;
  skill_id: string;
  slug: string;
  title: string;
  career_level: CareerLevel;
  content_version: number | string;
  status: 'draft' | 'approved' | 'hidden' | 'retired';
  language?: UiLanguage | null;
  skill_name?: string | null;
}

interface NormalizedTopicContent {
  explanation_markdown: string;
  important_questions: Array<{ question: string; answer_markdown: string }>;
  language: UiLanguage;
  sources: Array<{
    title: string;
    publisher: string;
    url: string;
    resource_type: ResourceType;
  }>;
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

function parseTopicContentPayload(
  job: ClaimedJobRow,
): ParsedTopicContentPayload {
  if (job.job_kind !== 'topic_content') {
    fail(422, 'INVALID_ENUM_VALUE', 'Unsupported learning job kind');
  }
  const payload = job.input_payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(422, 'VALIDATION_FAILED', 'Invalid topic_content job payload');
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
    );
  }

  const topicId =
    typeof args.topic_id === 'string' ? args.topic_id.trim().toLowerCase() : '';
  const skillId =
    typeof args.skill_id === 'string' ? args.skill_id.trim().toLowerCase() : '';
  const careerLevel =
    typeof args.career_level === 'string'
      ? args.career_level.trim().toLowerCase()
      : '';
  const contentVersion = Number(args.content_version);
  const expectedContentVersion = Number(refs.content_version);

  if (
    !UUID_PATTERN.test(topicId) ||
    !UUID_PATTERN.test(skillId) ||
    !VALID_CAREER_LEVELS.has(careerLevel) ||
    !Number.isInteger(contentVersion) ||
    contentVersion < 1 ||
    !Number.isInteger(expectedContentVersion) ||
    expectedContentVersion < 1
  ) {
    fail(422, 'VALIDATION_FAILED', 'Invalid topic_content job arguments');
  }

  return {
    topicId,
    skillId,
    careerLevel: careerLevel as CareerLevel,
    contentVersion,
    expectedContentVersion,
  };
}

function normalizeAndValidateTopicContent(
  rawOutput: unknown,
): NormalizedTopicContent {
  if (!rawOutput || typeof rawOutput !== 'object' || Array.isArray(rawOutput)) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'AI output failed validation and was discarded. Please try again.',
      undefined,
      true,
    );
  }
  const output = rawOutput as TopicContentOutput;
  const explanation =
    typeof output.explanation_markdown === 'string'
      ? output.explanation_markdown.trim()
      : '';
  if (!explanation || explanation.length > 50_000) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Topic explanation_markdown must be non-empty',
      undefined,
      true,
    );
  }
  const language =
    typeof output.language === 'string' && VALID_LANGUAGES.has(output.language)
      ? output.language
      : null;
  if (!language) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Topic content language must be bn, en, or mixed',
      undefined,
      true,
    );
  }
  if (
    !Array.isArray(output.important_questions) ||
    !Array.isArray(output.sources)
  ) {
    fail(
      502,
      'AI_VALIDATION_FAILED',
      'Topic content must include important_questions and sources arrays',
      undefined,
      true,
    );
  }

  const importantQuestions: Array<{
    question: string;
    answer_markdown: string;
  }> = [];
  for (const rawQa of output.important_questions) {
    if (
      !rawQa ||
      typeof rawQa !== 'object' ||
      typeof rawQa.question !== 'string' ||
      !rawQa.question.trim() ||
      typeof rawQa.answer_markdown !== 'string' ||
      !rawQa.answer_markdown.trim()
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Topic important_questions entry is invalid',
        undefined,
        true,
      );
    }
    importantQuestions.push({
      question: rawQa.question.trim(),
      answer_markdown: rawQa.answer_markdown.trim(),
    });
  }

  const sources: NormalizedTopicContent['sources'] = [];
  for (const rawSrc of output.sources) {
    if (
      !rawSrc ||
      typeof rawSrc !== 'object' ||
      typeof rawSrc.title !== 'string' ||
      !rawSrc.title.trim() ||
      typeof rawSrc.publisher !== 'string' ||
      !rawSrc.publisher.trim() ||
      typeof rawSrc.url !== 'string' ||
      !HTTP_URL_PATTERN.test(rawSrc.url.trim()) ||
      typeof rawSrc.resource_type !== 'string' ||
      !(RESOURCE_TYPE_VALUES as readonly string[]).includes(
        rawSrc.resource_type,
      )
    ) {
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'Topic learning resource entry is invalid',
        undefined,
        true,
      );
    }
    sources.push({
      title: rawSrc.title.trim(),
      publisher: rawSrc.publisher.trim(),
      url: rawSrc.url.trim(),
      resource_type: rawSrc.resource_type as ResourceType,
    });
  }

  return {
    explanation_markdown: explanation,
    important_questions: importantQuestions,
    language,
    sources,
  };
}

/**
 * Durable async job handler for `topic_content` (`C08` §6.2.4, `R12`, `R13`).
 *
 * Guarantees:
 * - Short-circuits without calling the LLM if an approved canonical `(skill_id, slug, career_level)`
 *   topic already exists (`skipAiGeneration = true`).
 * - Executes `AiGatewayService.execute(..., { persistTelemetry: false, signal })` strictly outside
 *   DB transactions using `prompts/topic-content.v1` and `OutputValidatorService.validateTopicContent`.
 * - Serializes concurrent approvals per canonical key using `pg_advisory_xact_lock(hashtext(...))`
 *   so `uq_topics_one_approved` is never violated.
 * - Updates `draft` rows in place to `approved`; for `hidden` rows, inserts a new `content_version + 1`
 *   approved row without mutating append-only `roadmap_items.topic_id`.
 * - Links `topics.ai_generation_id` atomically from `JobCommitContext.aiGenerationId` and inserts
 *   approved attribution links into `public.learning_resources`.
 */
@Injectable()
export class TopicContentJobHandler implements JobHandler {
  readonly supportedKinds = SUPPORTED_LEARNING_JOB_KINDS;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
  ) {}

  canHandle(jobKind: string): jobKind is SupportedLearningJobKind {
    return (SUPPORTED_LEARNING_JOB_KINDS as readonly string[]).includes(
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
    const parsed = parseTopicContentPayload(job);

    const snapshot = await this.runRead(async (db) => {
      const topicRows = await db.query<TopicLookupRow[]>(
        `SELECT t.id,
                t.skill_id,
                t.slug,
                t.title,
                t.career_level::text AS career_level,
                t.content_version,
                t.status::text AS status,
                t.language::text AS language,
                s.canonical_name AS skill_name
           FROM public.topics t
           JOIN public.skills s ON s.id = t.skill_id
          WHERE t.id = $1
            AND t.deleted_at IS NULL
          LIMIT 1`,
        [parsed.topicId],
      );
      const target = Array.isArray(topicRows) ? topicRows[0] : undefined;
      if (!target) {
        return { target: null, approved: null };
      }

      const approvedRows = await db.query<
        Array<{ id: string; language: UiLanguage | null }>
      >(
        `SELECT id, language::text AS language
           FROM public.topics
          WHERE skill_id = $1
            AND slug = $2
            AND career_level = $3::public.career_level
            AND status = 'approved'::public.content_status
            AND deleted_at IS NULL
          LIMIT 1`,
        [target.skill_id, target.slug, target.career_level],
      );
      const approved = Array.isArray(approvedRows) ? approvedRows[0] : null;
      return { target, approved };
    });

    if (!snapshot.target) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    // Shared canonical content already approved: reuse cleanly without calling LLM.
    if (snapshot.approved?.id) {
      return {
        resultType: 'topic',
        resultId: String(snapshot.approved.id),
        providerKey: '',
        modelId: '',
        promptVersionId: '',
        outputSchemaId: 'topic_content.v1',
        fallbackUsed: false,
        language: snapshot.approved.language ?? 'mixed',
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
        : 'mixed';

    const aiRequest: AIRequestDTO = {
      request_id: job.id,
      user_id: job.user_id,
      task: 'topic_content',
      feature_key: 'daily_plan',
      output_schema: 'topic_content.v1',
      language,
      idempotency_key: job.idempotency_key ?? job.id,
      untrusted_inputs: [snapshot.target.title],
      context: {
        topic_id: snapshot.target.id,
        slug: snapshot.target.slug,
        skill_id: snapshot.target.skill_id,
        skill_name: snapshot.target.skill_name ?? '',
        career_level: snapshot.target.career_level,
        content_version: Number(snapshot.target.content_version),
      },
      budget: {
        max_input_units: 8_000,
        max_output_units: 4_000,
        timeout_ms: 45_000,
      },
    };

    const aiResponse = await this.aiGateway.execute<TopicContentOutput>(
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
      resultType: 'topic',
      resultId: String(snapshot.target.id),
      providerKey: aiResponse.provider_id,
      modelId: aiResponse.model_id,
      promptVersionId: aiResponse.prompt_version_id,
      outputSchemaId: 'topic_content.v1',
      fallbackUsed: aiResponse.fallback_used,
      language: aiResponse.output.language ?? language,
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
    const parsed = parseTopicContentPayload(job);

    const rows = await tx.query<TopicLookupRow[]>(
      `SELECT id,
              skill_id,
              slug,
              title,
              career_level::text AS career_level,
              content_version,
              status::text AS status
         FROM public.topics
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1`,
      [parsed.topicId],
    );
    const target = Array.isArray(rows) ? rows[0] : undefined;
    if (!target) {
      return { ok: false, reason: 'TOPIC_NOT_FOUND' };
    }

    const approvedRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.topics
        WHERE skill_id = $1
          AND slug = $2
          AND career_level = $3::public.career_level
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        LIMIT 1`,
      [target.skill_id, target.slug, target.career_level],
    );
    if (Array.isArray(approvedRows) && approvedRows.length > 0) {
      return { ok: true };
    }

    if (Number(target.content_version) !== parsed.expectedContentVersion) {
      return { ok: false, reason: 'TOPIC_CONTENT_VERSION_DRIFT' };
    }
    return { ok: true };
  }

  async persistArtifact(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    result: JobExecutionResult,
    context?: JobCommitContext,
  ): Promise<{ resultType: 'topic'; resultId: string }> {
    const parsed = parseTopicContentPayload(job);

    const targetRows = await tx.query<TopicLookupRow[]>(
      `SELECT id,
              skill_id,
              slug,
              title,
              career_level::text AS career_level,
              content_version,
              status::text AS status
         FROM public.topics
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE`,
      [parsed.topicId],
    );
    const target = Array.isArray(targetRows) ? targetRows[0] : undefined;
    if (!target) {
      fail(
        409,
        'STALE_JOB_INPUT',
        'Source data changed before the job ran. Please refresh and try again.',
        undefined,
        false,
      );
    }

    // Serialize concurrent approvals for the same canonical topic key (`uq_topics_one_approved`)
    const canonicalLockKey = `${target.skill_id}:${target.slug}:${target.career_level}`;
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      canonicalLockKey,
    ]);

    const concurrentApprovedRows = await tx.query<Array<{ id: string }>>(
      `SELECT id
         FROM public.topics
        WHERE skill_id = $1
          AND slug = $2
          AND career_level = $3::public.career_level
          AND status = 'approved'::public.content_status
          AND deleted_at IS NULL
        LIMIT 1`,
      [target.skill_id, target.slug, target.career_level],
    );
    const concurrentApproved = Array.isArray(concurrentApprovedRows)
      ? concurrentApprovedRows[0]
      : undefined;
    if (concurrentApproved?.id) {
      return {
        resultType: 'topic',
        resultId: String(concurrentApproved.id),
      };
    }

    if (result.skipAiGeneration === true) {
      // Approved row disappeared between execute() and commit gate -> retryable generation failure.
      fail(
        502,
        'AI_GENERATION_FAILED',
        'AI generation failed. No partial data was saved.',
        undefined,
        true,
      );
    }

    const normalized = normalizeAndValidateTopicContent(result.output);
    const aiGenerationId = context?.aiGenerationId ?? null;
    let approvedTopicId: string;

    if (target.status === 'draft') {
      const updatedRaw = await tx.query<unknown>(
        `UPDATE public.topics
            SET status = 'approved'::public.content_status,
                explanation_markdown = $2,
                important_questions = $3::jsonb,
                language = $4::public.ui_language,
                ai_generation_id = $5,
                approved_at = clock_timestamp()
          WHERE id = $1
            AND status = 'draft'::public.content_status
         RETURNING id`,
        [
          target.id,
          normalized.explanation_markdown,
          JSON.stringify(normalized.important_questions),
          normalized.language,
          aiGenerationId,
        ],
      );
      const updated = extractReturningRows<{ id: string }>(updatedRaw)[0];
      if (!updated?.id) {
        fail(500, 'DATABASE_ERROR', 'Failed to approve draft topic');
      }
      approvedTopicId = String(updated.id);
    } else {
      // Regeneration for hidden/retired topic: insert content_version + 1 (never mutate roadmap_items)
      const maxVersionRows = await tx.query<
        Array<{ next_version: number | string }>
      >(
        `SELECT (COALESCE(MAX(content_version), 0) + 1)::int AS next_version
           FROM public.topics
          WHERE skill_id = $1
            AND slug = $2
            AND career_level = $3::public.career_level`,
        [target.skill_id, target.slug, target.career_level],
      );
      const nextVersion = Array.isArray(maxVersionRows)
        ? Math.max(2, Number(maxVersionRows[0]?.next_version ?? 2))
        : Number(target.content_version) + 1;

      const insertedRaw = await tx.query<unknown>(
        `INSERT INTO public.topics (
           skill_id,
           slug,
           title,
           career_level,
           content_version,
           status,
           explanation_markdown,
           important_questions,
           language,
           ai_generation_id,
           approved_at
         )
         VALUES (
           $1,
           $2,
           $3,
           $4::public.career_level,
           $5,
           'approved'::public.content_status,
           $6,
           $7::jsonb,
           $8::public.ui_language,
           $9,
           clock_timestamp()
         )
         RETURNING id`,
        [
          target.skill_id,
          target.slug,
          target.title,
          target.career_level,
          nextVersion,
          normalized.explanation_markdown,
          JSON.stringify(normalized.important_questions),
          normalized.language,
          aiGenerationId,
        ],
      );
      const inserted = extractReturningRows<{ id: string }>(insertedRaw)[0];
      if (!inserted?.id) {
        fail(500, 'DATABASE_ERROR', 'Failed to insert regenerated topic row');
      }
      approvedTopicId = String(inserted.id);
    }

    for (const source of normalized.sources) {
      await tx.query(
        `INSERT INTO public.learning_resources (
           topic_id,
           title,
           publisher,
           url,
           resource_type,
           retrieved_at,
           status
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5::public.resource_type,
           clock_timestamp(),
           'approved'::public.content_status
         )`,
        [
          approvedTopicId,
          source.title,
          source.publisher,
          source.url,
          source.resource_type,
        ],
      );
    }

    return {
      resultType: 'topic',
      resultId: approvedTopicId,
    };
  }
}
