import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { readJobWorkerConfiguration } from '../../config.js';
import type { JobAcceptedDto, JobKind } from '../dto/job-status.dto.js';
import { isIdempotencyUniqueViolation } from './idempotency.service.js';

/** Strict UUID matcher (`EP-J01` / `R12`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maximum byte length permitted by `ck_ai_requests_input_payload` (`010_ai_operations.sql`). */
export const MAX_JOB_INPUT_PAYLOAD_BYTES = 32_768;

/** Supported UI language codes (`public.ui_language`). */
export type JobLanguage = 'bn' | 'en' | 'mixed';

/** Career levels supported by async roadmap/content jobs (`public.career_level`). */
export type JobCareerLevel = 'junior' | 'mid' | 'senior';

/** Merge origins (`public.merge_origin`). */
export type JobMergeOrigin = 'user_request' | 'level_change' | 'ai_proposal';

/** Async-capable `public.job_kind` values (`career_goal` is sync-only per `R12`). */
export const ASYNC_JOB_KINDS = [
  'roadmap_generate',
  'roadmap_revision',
  'merge_proposal',
  'topic_content',
  'quiz_generate',
  'practice_review',
] as const;

export type AsyncJobKind = (typeof ASYNC_JOB_KINDS)[number];

/** `public.ai_task` values mapped by `AsyncJobKind`. */
export type AsyncAiTask = AsyncJobKind;

/** `public.feature_key` values mapped by `AsyncJobKind`. */
export type AsyncFeatureKey =
  'roadmap_generator' | 'daily_plan' | 'quiz_practice' | 'ai_practice_review';

const JOB_KIND_ROUTING: Readonly<
  Record<AsyncJobKind, { task: AsyncAiTask; featureKey: AsyncFeatureKey }>
> = {
  roadmap_generate: {
    task: 'roadmap_generate',
    featureKey: 'roadmap_generator',
  },
  roadmap_revision: {
    task: 'roadmap_revision',
    featureKey: 'roadmap_generator',
  },
  merge_proposal: {
    task: 'merge_proposal',
    featureKey: 'roadmap_generator',
  },
  topic_content: {
    task: 'topic_content',
    featureKey: 'daily_plan',
  },
  quiz_generate: {
    task: 'quiz_generate',
    featureKey: 'quiz_practice',
  },
  practice_review: {
    task: 'practice_review',
    featureKey: 'ai_practice_review',
  },
};

const VALID_CAREER_LEVELS: ReadonlySet<string> = new Set([
  'junior',
  'mid',
  'senior',
]);

const VALID_MERGE_ORIGINS: ReadonlySet<string> = new Set([
  'user_request',
  'level_change',
  'ai_proposal',
]);

const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);

const FORBIDDEN_REF_KEYS: ReadonlySet<string> = new Set([
  'prompt',
  'system_prompt',
  'assembled_prompt',
  'raw_completion',
  'completion',
  'api_key',
  'apikey',
  'authorization',
  'password',
  'token',
  'secret',
  'fetched_html',
  'raw_webpage',
]);

/** Version-1 durable job envelope (`R12`). */
export interface ProducerEnvelopeV1<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TRefs extends Record<string, unknown> = Record<string, unknown>,
> {
  v: 1;
  args: TArgs;
  expected_refs: TRefs;
}

/** Input contract for enqueuing an async job into `public.ai_requests`. */
export interface EnqueueJobRequest {
  userId: string;
  kind: JobKind | string;
  envelope: unknown;
  idempotencyKey?: string;
  subjectType?: string;
  subjectId?: string;
  httpRequestId?: string;
  language?: JobLanguage;
}

/** Canonical `202 Accepted` DTO returned after queuing an async job (`C05` §13.6 / §15.1). */
export interface EnqueuedJobAcceptedDto extends JobAcceptedDto {
  kind: AsyncJobKind;
  status: 'queued';
}

/**
 * Minimal query executor allowing participation in an existing caller DB transaction.
 *
 * SECURITY CONTRACT: Callers supplying `tx` to `JobProducerService.enqueue(request, tx)`
 * MUST have opened `tx` via `DatabaseService.transaction(request.userId, ..., active = true)`
 * so the owner's `public.users` row is already locked (`FOR UPDATE`) and verified `status = 'active'`
 * in the same transaction prior to inserting into `public.ai_requests`.
 */
export interface JobQueryExecutor {
  query<T = unknown>(query: string, parameters?: unknown[]): Promise<T>;
}

interface InsertedAiRequestRow {
  id: string;
  status: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertAllowedKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  scope: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(422, 'VALIDATION_FAILED', `Unknown field in ${scope}: ${key}`, [
        {
          field: `${scope}.${key}`,
          code: 'VALIDATION_FAILED',
          message: `Unknown property ${key}`,
        },
      ]);
    }
  }
}

function assertUuidField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    fail(422, 'VALIDATION_FAILED', `${field} must be a valid UUID`, [
      {
        field,
        code: 'INVALID_FORMAT',
        message: `${field} must be a valid UUID`,
      },
    ]);
  }
  return value.trim();
}

function assertPositiveIntegerField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(422, 'VALIDATION_FAILED', `${field} must be a positive integer`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must be a positive integer`,
      },
    ]);
  }
  return value;
}

function assertNoNulByte(value: string, field: string): void {
  if (value.includes('\u0000')) {
    fail(
      422,
      'VALIDATION_FAILED',
      `${field} contains an unsupported NUL byte`,
      [
        {
          field,
          code: 'VALIDATION_FAILED',
          message: `${field} cannot contain NUL characters`,
        },
      ],
    );
  }
}

function assertNonEmptyStringField(
  value: unknown,
  field: string,
  maxLength = 2_000,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    fail(
      422,
      'VALIDATION_FAILED',
      `${field} must be a non-empty string (1..${maxLength} chars)`,
      [
        {
          field,
          code: 'VALIDATION_FAILED',
          message: `${field} must be a non-empty string`,
        },
      ],
    );
  }
  assertNoNulByte(value, field);
  return value.trim();
}

function validateArgsForKind(
  kind: AsyncJobKind,
  rawArgs: Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case 'roadmap_generate': {
      assertAllowedKeys(rawArgs, ['career_goal_id'], 'args');
      return {
        career_goal_id: assertUuidField(
          rawArgs.career_goal_id,
          'args.career_goal_id',
        ),
      };
    }
    case 'roadmap_revision': {
      assertAllowedKeys(
        rawArgs,
        ['roadmap_id', 'base_version_no', 'instruction', 'refresh_stale'],
        'args',
      );
      const roadmapId = assertUuidField(rawArgs.roadmap_id, 'args.roadmap_id');
      const baseVersionNo = assertPositiveIntegerField(
        rawArgs.base_version_no,
        'args.base_version_no',
      );
      if (typeof rawArgs.refresh_stale !== 'boolean') {
        fail(422, 'VALIDATION_FAILED', 'args.refresh_stale must be a boolean', [
          {
            field: 'args.refresh_stale',
            code: 'VALIDATION_FAILED',
            message: 'refresh_stale must be a boolean',
          },
        ]);
      }
      let instruction: string | undefined;
      if (rawArgs.instruction !== undefined && rawArgs.instruction !== null) {
        instruction = assertNonEmptyStringField(
          rawArgs.instruction,
          'args.instruction',
        );
      }
      if (!instruction && rawArgs.refresh_stale !== true) {
        fail(
          422,
          'VALIDATION_FAILED',
          'roadmap_revision requires instruction or refresh_stale=true',
          [
            {
              field: 'args.instruction',
              code: 'VALIDATION_FAILED',
              message:
                'Provide a revision instruction or set refresh_stale=true',
            },
          ],
        );
      }
      return {
        roadmap_id: roadmapId,
        base_version_no: baseVersionNo,
        ...(instruction !== undefined ? { instruction } : {}),
        refresh_stale: rawArgs.refresh_stale,
      };
    }
    case 'merge_proposal': {
      assertAllowedKeys(
        rawArgs,
        [
          'roadmap_id',
          'base_version_no',
          'origin',
          'instruction',
          'target_level',
          'source_ref',
        ],
        'args',
      );
      const roadmapId = assertUuidField(rawArgs.roadmap_id, 'args.roadmap_id');
      const baseVersionNo = assertPositiveIntegerField(
        rawArgs.base_version_no,
        'args.base_version_no',
      );
      if (
        typeof rawArgs.origin !== 'string' ||
        !VALID_MERGE_ORIGINS.has(rawArgs.origin)
      ) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid merge_proposal origin', [
          {
            field: 'args.origin',
            code: 'INVALID_ENUM_VALUE',
            message:
              'origin must be user_request, level_change, or ai_proposal',
          },
        ]);
      }
      const origin = rawArgs.origin as JobMergeOrigin;
      let instruction: string | undefined;
      if (rawArgs.instruction !== undefined && rawArgs.instruction !== null) {
        instruction = assertNonEmptyStringField(
          rawArgs.instruction,
          'args.instruction',
        );
      }
      let targetLevel: JobCareerLevel | undefined;
      if (rawArgs.target_level !== undefined && rawArgs.target_level !== null) {
        if (
          typeof rawArgs.target_level !== 'string' ||
          !VALID_CAREER_LEVELS.has(rawArgs.target_level)
        ) {
          fail(422, 'INVALID_ENUM_VALUE', 'Invalid args.target_level', [
            {
              field: 'args.target_level',
              code: 'INVALID_ENUM_VALUE',
              message: 'target_level must be junior, mid, or senior',
            },
          ]);
        }
        targetLevel = rawArgs.target_level as JobCareerLevel;
      }
      let sourceRef: string | undefined;
      if (rawArgs.source_ref !== undefined && rawArgs.source_ref !== null) {
        sourceRef = assertNonEmptyStringField(
          rawArgs.source_ref,
          'args.source_ref',
          512,
        );
      }

      if (origin === 'user_request' && !instruction) {
        fail(
          422,
          'VALIDATION_FAILED',
          'user_request merge requires instruction',
          [
            {
              field: 'args.instruction',
              code: 'VALIDATION_FAILED',
              message: 'instruction is required for user_request',
            },
          ],
        );
      }
      if (origin === 'level_change' && !targetLevel) {
        fail(
          422,
          'VALIDATION_FAILED',
          'level_change merge requires target_level',
          [
            {
              field: 'args.target_level',
              code: 'VALIDATION_FAILED',
              message: 'target_level is required for level_change',
            },
          ],
        );
      }
      if (origin === 'ai_proposal' && !sourceRef) {
        fail(
          422,
          'VALIDATION_FAILED',
          'ai_proposal merge requires immutable source_ref',
          [
            {
              field: 'args.source_ref',
              code: 'VALIDATION_FAILED',
              message: 'source_ref is required for ai_proposal',
            },
          ],
        );
      }

      return {
        roadmap_id: roadmapId,
        base_version_no: baseVersionNo,
        origin,
        ...(instruction !== undefined ? { instruction } : {}),
        ...(targetLevel !== undefined ? { target_level: targetLevel } : {}),
        ...(sourceRef !== undefined ? { source_ref: sourceRef } : {}),
      };
    }
    case 'topic_content': {
      assertAllowedKeys(
        rawArgs,
        ['topic_id', 'skill_id', 'career_level', 'content_version'],
        'args',
      );
      if (
        typeof rawArgs.career_level !== 'string' ||
        !VALID_CAREER_LEVELS.has(rawArgs.career_level)
      ) {
        fail(422, 'INVALID_ENUM_VALUE', 'Invalid args.career_level', [
          {
            field: 'args.career_level',
            code: 'INVALID_ENUM_VALUE',
            message: 'career_level must be junior, mid, or senior',
          },
        ]);
      }
      return {
        topic_id: assertUuidField(rawArgs.topic_id, 'args.topic_id'),
        skill_id: assertUuidField(rawArgs.skill_id, 'args.skill_id'),
        career_level: rawArgs.career_level,
        content_version: assertPositiveIntegerField(
          rawArgs.content_version,
          'args.content_version',
        ),
      };
    }
    case 'quiz_generate': {
      assertAllowedKeys(
        rawArgs,
        ['daily_plan_item_id', 'topic_id', 'content_version', 'variant_no'],
        'args',
      );
      return {
        daily_plan_item_id: assertUuidField(
          rawArgs.daily_plan_item_id,
          'args.daily_plan_item_id',
        ),
        topic_id: assertUuidField(rawArgs.topic_id, 'args.topic_id'),
        content_version: assertPositiveIntegerField(
          rawArgs.content_version,
          'args.content_version',
        ),
        variant_no: assertPositiveIntegerField(
          rawArgs.variant_no,
          'args.variant_no',
        ),
      };
    }
    case 'practice_review': {
      assertAllowedKeys(rawArgs, ['review_id', 'attempt_id'], 'args');
      return {
        review_id: assertUuidField(rawArgs.review_id, 'args.review_id'),
        attempt_id: assertUuidField(rawArgs.attempt_id, 'args.attempt_id'),
      };
    }
  }
}

function validateExpectedRefs(
  kind: AsyncJobKind,
  rawRefs: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(rawRefs)) {
    if (FORBIDDEN_REF_KEYS.has(key.toLowerCase())) {
      fail(
        422,
        'VALIDATION_FAILED',
        `Forbidden secret or prompt field in expected_refs: ${key}`,
        [
          {
            field: `expected_refs.${key}`,
            code: 'VALIDATION_FAILED',
            message: 'Prompt or credential fields cannot enter job payloads',
          },
        ],
      );
    }
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      fail(
        422,
        'VALIDATION_FAILED',
        `expected_refs.${key} must be a scalar value`,
        [
          {
            field: `expected_refs.${key}`,
            code: 'VALIDATION_FAILED',
            message: 'Expected ref values must be scalar',
          },
        ],
      );
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail(
        422,
        'VALIDATION_FAILED',
        `expected_refs.${key} must be a finite number`,
      );
    }
    if (typeof value === 'string') {
      assertNoNulByte(value, `expected_refs.${key}`);
    }
    normalized[key] = typeof value === 'string' ? value.trim() : value;
  }

  switch (kind) {
    case 'roadmap_generate': {
      assertAllowedKeys(
        rawRefs,
        ['goal_updated_at', 'profile_updated_at'],
        'expected_refs',
      );
      normalized.goal_updated_at = assertNonEmptyStringField(
        rawRefs.goal_updated_at,
        'expected_refs.goal_updated_at',
        128,
      );
      normalized.profile_updated_at = assertNonEmptyStringField(
        rawRefs.profile_updated_at,
        'expected_refs.profile_updated_at',
        128,
      );
      break;
    }
    case 'roadmap_revision': {
      assertAllowedKeys(rawRefs, ['roadmap_version'], 'expected_refs');
      normalized.roadmap_version = assertPositiveIntegerField(
        rawRefs.roadmap_version,
        'expected_refs.roadmap_version',
      );
      break;
    }
    case 'merge_proposal': {
      assertAllowedKeys(rawRefs, ['base_version_no'], 'expected_refs');
      normalized.base_version_no = assertPositiveIntegerField(
        rawRefs.base_version_no,
        'expected_refs.base_version_no',
      );
      break;
    }
    case 'topic_content': {
      assertAllowedKeys(
        rawRefs,
        ['content_version', 'roadmap_version'],
        'expected_refs',
      );
      normalized.content_version = assertPositiveIntegerField(
        rawRefs.content_version,
        'expected_refs.content_version',
      );
      if (
        rawRefs.roadmap_version !== undefined &&
        rawRefs.roadmap_version !== null
      ) {
        normalized.roadmap_version = assertPositiveIntegerField(
          rawRefs.roadmap_version,
          'expected_refs.roadmap_version',
        );
      }
      break;
    }
    case 'quiz_generate': {
      assertAllowedKeys(
        rawRefs,
        ['content_version', 'roadmap_version'],
        'expected_refs',
      );
      if (
        rawRefs.content_version !== undefined &&
        rawRefs.content_version !== null
      ) {
        normalized.content_version = assertPositiveIntegerField(
          rawRefs.content_version,
          'expected_refs.content_version',
        );
      }
      if (
        rawRefs.roadmap_version !== undefined &&
        rawRefs.roadmap_version !== null
      ) {
        normalized.roadmap_version = assertPositiveIntegerField(
          rawRefs.roadmap_version,
          'expected_refs.roadmap_version',
        );
      }
      break;
    }
    case 'practice_review': {
      assertAllowedKeys(
        rawRefs,
        ['submitted_at', 'answer_saved_at'],
        'expected_refs',
      );
      normalized.submitted_at = assertNonEmptyStringField(
        rawRefs.submitted_at,
        'expected_refs.submitted_at',
        128,
      );
      normalized.answer_saved_at = assertNonEmptyStringField(
        rawRefs.answer_saved_at,
        'expected_refs.answer_saved_at',
        128,
      );
      break;
    }
  }

  return normalized;
}

/**
 * Validates that `kind` is an async `public.job_kind` (`career_goal` is sync-only per `R12`).
 */
export function assertAsyncJobKind(kind: unknown): AsyncJobKind {
  if (kind === 'career_goal') {
    fail(
      422,
      'INVALID_ENUM_VALUE',
      'career_goal is synchronous and cannot be enqueued asynchronously',
      [
        {
          field: 'kind',
          code: 'INVALID_ENUM_VALUE',
          message: 'career_goal does not support async execution',
        },
      ],
    );
  }
  if (
    typeof kind !== 'string' ||
    !(ASYNC_JOB_KINDS as readonly string[]).includes(kind)
  ) {
    fail(422, 'INVALID_ENUM_VALUE', 'Unsupported async job kind', [
      {
        field: 'kind',
        code: 'INVALID_ENUM_VALUE',
        message: 'Unsupported job kind',
      },
    ]);
  }
  return kind as AsyncJobKind;
}

/** Formats a JSON value matching PostgreSQL `jsonb::text` spacing (`": "` and `", "`) to mirror `ck_ai_requests_input_payload`. */
function serializePostgresJsonbText(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializePostgresJsonbText(item)).join(', ')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${serializePostgresJsonbText(v)}`).join(', ')}}`;
}

/**
 * Validates and normalizes a `v: 1` producer payload envelope (`R12`) and enforces `<= 32768` UTF-8 bytes
 * in PostgreSQL's `jsonb::text` representation (`ck_ai_requests_input_payload`).
 */
export function validateProducerEnvelope(
  kind: AsyncJobKind,
  envelope: unknown,
): { validated: ProducerEnvelopeV1; serializedJson: string } {
  if (!isPlainObject(envelope)) {
    fail(422, 'VALIDATION_FAILED', 'Job envelope must be a JSON object');
  }
  assertAllowedKeys(envelope, ['v', 'args', 'expected_refs'], 'envelope');
  if (envelope.v !== 1) {
    fail(422, 'VALIDATION_FAILED', 'Unsupported job envelope version', [
      {
        field: 'v',
        code: 'VALIDATION_FAILED',
        message: 'Only envelope version v=1 is supported',
      },
    ]);
  }
  if (!isPlainObject(envelope.args)) {
    fail(422, 'VALIDATION_FAILED', 'envelope.args must be an object');
  }
  if (!isPlainObject(envelope.expected_refs)) {
    fail(422, 'VALIDATION_FAILED', 'envelope.expected_refs must be an object');
  }

  const normalizedArgs = validateArgsForKind(kind, envelope.args);
  const normalizedRefs = validateExpectedRefs(kind, envelope.expected_refs);
  const validated: ProducerEnvelopeV1 = {
    v: 1,
    args: normalizedArgs,
    expected_refs: normalizedRefs,
  };
  const serializedJson = JSON.stringify(validated);
  const pgJsonbText = serializePostgresJsonbText(validated);
  if (
    Buffer.byteLength(serializedJson, 'utf8') > MAX_JOB_INPUT_PAYLOAD_BYTES ||
    Buffer.byteLength(pgJsonbText, 'utf8') > MAX_JOB_INPUT_PAYLOAD_BYTES
  ) {
    fail(
      422,
      'VALIDATION_FAILED',
      `Job input_payload exceeds ${MAX_JOB_INPUT_PAYLOAD_BYTES} bytes`,
      [
        {
          field: 'input_payload',
          code: 'VALIDATION_FAILED',
          message: `Payload size must not exceed ${MAX_JOB_INPUT_PAYLOAD_BYTES} bytes`,
        },
      ],
    );
  }

  return { validated, serializedJson };
}

function isInputPayloadCheckViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgErr = error as {
    code?: unknown;
    constraint?: unknown;
    detail?: unknown;
    message?: unknown;
    driverError?: {
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      message?: unknown;
    };
  };
  const code = pgErr.code ?? pgErr.driverError?.code;
  if (code !== '23514') {
    return false;
  }
  const constraint =
    typeof pgErr.constraint === 'string' && pgErr.constraint.trim().length > 0
      ? pgErr.constraint
      : pgErr.driverError?.constraint;
  if (typeof constraint === 'string' && constraint.trim().length > 0) {
    return constraint.trim() === 'ck_ai_requests_input_payload';
  }
  const detail = String(pgErr.detail ?? pgErr.driverError?.detail ?? '');
  const message = String(pgErr.message ?? pgErr.driverError?.message ?? '');
  return (
    detail.includes('ck_ai_requests_input_payload') ||
    message.includes('ck_ai_requests_input_payload')
  );
}

/**
 * Durable producer enqueuing validated `R12` job envelopes into `public.ai_requests`.
 * Participates in a caller-supplied DB transaction or opens a bounded `DatabaseService` transaction.
 */
@Injectable()
export class JobProducerService {
  private readonly retryAfterSeconds: number;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(ConfigService) configService?: ConfigService,
  ) {
    this.retryAfterSeconds = readJobWorkerConfiguration(
      configService ?? process.env,
    ).retryAfterSeconds;
  }

  /**
   * Validates inputs/envelope and atomically inserts a queued `public.ai_requests` row (`is_async = true`, `status = 'queued'`).
   * Maps Postgres `23505` on `uq_ai_requests_idempotency` to `409 IDEMPOTENCY_KEY_REUSED`.
   */
  async enqueue(
    request: EnqueueJobRequest,
    tx?: JobQueryExecutor,
  ): Promise<EnqueuedJobAcceptedDto> {
    if (
      typeof request.userId !== 'string' ||
      !UUID_PATTERN.test(request.userId.trim())
    ) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }
    const userId = request.userId.trim();
    const kind = assertAsyncJobKind(request.kind);
    const { task, featureKey } = JOB_KIND_ROUTING[kind];

    let idempotencyKey: string | null = null;
    if (request.idempotencyKey !== undefined) {
      if (
        typeof request.idempotencyKey !== 'string' ||
        !UUID_PATTERN.test(request.idempotencyKey.trim())
      ) {
        fail(400, 'INVALID_FORMAT', 'Idempotency-Key must be a valid UUID');
      }
      idempotencyKey = request.idempotencyKey.trim().toLowerCase();
    }

    let subjectId: string | null = null;
    if (request.subjectId !== undefined) {
      subjectId = assertUuidField(request.subjectId, 'subjectId');
    }

    let httpRequestId: string | null = null;
    if (request.httpRequestId !== undefined) {
      httpRequestId = assertUuidField(request.httpRequestId, 'httpRequestId');
    }

    let language: JobLanguage | null = null;
    if (request.language !== undefined) {
      if (
        typeof request.language !== 'string' ||
        !VALID_LANGUAGES.has(request.language)
      ) {
        fail(422, 'UNSUPPORTED_LANGUAGE', 'Unsupported language code');
      }
      language = request.language;
    }

    const { serializedJson } = validateProducerEnvelope(kind, request.envelope);
    const subjectType =
      typeof request.subjectType === 'string' && request.subjectType.trim()
        ? request.subjectType.trim().slice(0, 64)
        : null;

    const executeInsert = async (
      executor: JobQueryExecutor,
    ): Promise<EnqueuedJobAcceptedDto> => {
      try {
        const rows = await executor.query<InsertedAiRequestRow[]>(
          `INSERT INTO public.ai_requests (
             user_id,
             task,
             feature_key,
             job_kind,
             is_async,
             status,
             idempotency_key,
             subject_type,
             subject_id,
             http_request_id,
             language,
             input_payload
           )
           VALUES (
             $1,
             $2::public.ai_task,
             $3::public.feature_key,
             $4::public.job_kind,
             true,
             'queued'::public.job_status,
             $5,
             $6,
             $7,
             $8,
             $9::public.ui_language,
             $10::jsonb
           )
           RETURNING id, status::text AS status`,
          [
            userId,
            task,
            featureKey,
            kind,
            idempotencyKey,
            subjectType,
            subjectId,
            httpRequestId,
            language,
            serializedJson,
          ],
        );

        const inserted = Array.isArray(rows) ? rows[0] : undefined;
        if (!inserted?.id) {
          fail(500, 'DATABASE_ERROR', 'Failed to enqueue async job');
        }
        return {
          job_id: inserted.id,
          kind,
          status: 'queued',
          poll_url: `/api/v1/jobs/${inserted.id}`,
          retry_after_seconds: this.retryAfterSeconds,
        };
      } catch (error) {
        if (isIdempotencyUniqueViolation(error)) {
          fail(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'Idempotency key has already been used for another job',
          );
        }
        if (isInputPayloadCheckViolation(error)) {
          fail(
            422,
            'VALIDATION_FAILED',
            `Job input_payload exceeds ${MAX_JOB_INPUT_PAYLOAD_BYTES} bytes`,
            [
              {
                field: 'input_payload',
                code: 'VALIDATION_FAILED',
                message: `Payload size must not exceed ${MAX_JOB_INPUT_PAYLOAD_BYTES} bytes`,
              },
            ],
          );
        }
        throw error;
      }
    };

    if (tx) {
      return executeInsert(tx);
    }

    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        userId,
        (db) => executeInsert(db),
        true,
        false,
        true,
      );
    }

    return executeInsert(this.database);
  }
}
