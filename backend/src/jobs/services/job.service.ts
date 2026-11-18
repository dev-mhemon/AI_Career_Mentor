import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type {
  JobErrorDto,
  JobKind,
  JobStatus,
  JobStatusDto,
} from '../dto/job-status.dto.js';

/** Strict UUID matcher for user and job identifiers. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical `public.job_kind` enum values (`001_enums.sql`, `C05` §14.13). */
const VALID_JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  'career_goal',
  'roadmap_generate',
  'roadmap_revision',
  'merge_proposal',
  'topic_content',
  'quiz_generate',
  'practice_review',
]);

/**
 * Fixed fallback message used whenever a failed job carries an unrecognized `error_code`.
 */
export const DEFAULT_SAFE_JOB_ERROR_MESSAGE =
  'The AI request could not be completed. Please try again.';

/**
 * Closed dictionary of allowed job error codes and their canonical safe user-facing messages (`C05` §16.5 / `R12`).
 * Never reflects raw or filtered `public.ai_requests.error_message` values to clients.
 */
const SAFE_JOB_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AI_TIMEOUT: 'AI generation timed out. Please try again.',
  AI_SERVICE_ERROR: 'AI service encountered an error. Please try again later.',
  AI_GENERATION_FAILED: 'AI generation failed. No partial data was saved.',
  AI_VALIDATION_FAILED:
    'AI output failed validation and was discarded. Please try again.',
  AI_BUDGET_EXHAUSTED:
    'AI capacity is temporarily unavailable. Existing data remains accessible.',
  UNSUPPORTED_LANGUAGE: 'Input must be in Bangla, English, or mixed language.',
  STALE_JOB_INPUT:
    'Source data changed before the job ran. Please refresh and try again.',
  WORKER_LEASE_EXPIRED:
    'Job processing interrupted and exceeded recovery limits.',
};

/**
 * Projected row shape from `public.ai_requests` (`010_ai_operations.sql`).
 * Strictly excludes `input_payload`, `locked_by`, `attempt_count`, `provider_key`, `model_id`, and `prompt_version_id`.
 */
export interface AiRequestStatusRow {
  id: string;
  user_id?: string | null;
  is_async?: boolean | null;
  job_kind?: JobKind | string | null;
  task?: string | null;
  status: JobStatus;
  result_type?: string | null;
  result_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  retryable?: boolean | null;
  created_at: Date | string;
  finished_at?: Date | string | null;
  completed_at?: Date | string | null;
}

/**
 * Converts a database `Date` or string timestamp into an ISO-8601 string, or `null` if absent.
 */
function toNullableIsoTimestamp(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/**
 * Resolves a fixed canonical user-facing error message strictly from `error_code`
 * without ever exposing `public.ai_requests.error_message`.
 */
function resolveSafeErrorMessage(errorCode: string): string {
  if (Object.hasOwn(SAFE_JOB_ERROR_MESSAGES, errorCode)) {
    return SAFE_JOB_ERROR_MESSAGES[errorCode];
  }
  return DEFAULT_SAFE_JOB_ERROR_MESSAGE;
}

/**
 * Service implementing `EP-J01` (`GET /api/v1/jobs/:id`, C05 §14.13) over `public.ai_requests`.
 */
@Injectable()
export class JobService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /**
   * Executes a read operation against `DatabaseService`, using `database.transaction` when available
   * or falling back to `database.query` in lightweight unit test mocks.
   */
  private async runWithDatabase<T>(
    userId: string,
    fn: (runner: { query: DatabaseService['query'] }) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        userId,
        (db) => fn(db),
        true,
        false,
        true,
      );
    }
    return fn(this.database);
  }

  /**
   * `EP-J01` (`GET /api/v1/jobs/:id`):
   * Looks up a job in `public.ai_requests` enforcing explicit caller ownership (`WHERE id = $1 AND user_id = $2`).
   *
   * - Validates `:id` as a canonical UUID (`400 INVALID_FORMAT` if malformed).
   * - Returns `404 JOB_NOT_FOUND` if the row does not exist OR belongs to another user.
   * - Maps the row to `JobStatusDTO` while strictly excluding `input_payload`, `locked_by`, `attempt_count`,
   *   and provider/model internals (`R12`).
   *
   * @param userId - Authenticated caller's `public.users.id` UUID.
   * @param jobId - Path parameter `:id` UUID.
   * @returns Canonical `JobStatusDto`.
   */
  async getJobStatus(userId: string, jobId: string): Promise<JobStatusDto> {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }
    if (typeof jobId !== 'string' || !UUID_PATTERN.test(jobId.trim())) {
      fail(400, 'INVALID_FORMAT', 'Job id must be a valid UUID', [
        {
          field: 'id',
          code: 'INVALID_FORMAT',
          message: 'id must be a valid UUID',
        },
      ]);
    }

    const normalizedUserId = userId.trim();
    const normalizedJobId = jobId.trim();

    const rows = await this.runWithDatabase(normalizedUserId, (db) =>
      db.query<AiRequestStatusRow[]>(
        `SELECT id,
                user_id,
                is_async,
                job_kind::text AS job_kind,
                status,
                result_type,
                result_id,
                error_code,
                retryable,
                created_at,
                finished_at
           FROM public.ai_requests
          WHERE id = $1 AND user_id = $2 AND is_async = true AND job_kind IS NOT NULL`,
        [normalizedJobId, normalizedUserId],
      ),
    );

    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (
      !row ||
      row.is_async === false ||
      typeof row.job_kind !== 'string' ||
      !VALID_JOB_KINDS.has(row.job_kind.trim() as JobKind) ||
      (row.user_id !== undefined &&
        row.user_id !== null &&
        row.user_id.toLowerCase() !== normalizedUserId.toLowerCase())
    ) {
      fail(404, 'JOB_NOT_FOUND', 'Job not found');
    }

    return this.mapRowToJobStatusDto(row);
  }

  /**
   * Maps a projected `public.ai_requests` row to `JobStatusDTO` (`C05` §14.13 / §15.1).
   * Explicitly constructs a new object with only the 8 permitted contract properties.
   */
  mapRowToJobStatusDto(row: AiRequestStatusRow): JobStatusDto {
    const rawKind = typeof row.job_kind === 'string' ? row.job_kind.trim() : '';
    if (!VALID_JOB_KINDS.has(rawKind as JobKind)) {
      fail(404, 'JOB_NOT_FOUND', 'Job not found');
    }
    const status = row.status;
    const retryable = Boolean(row.retryable);
    const hasResultRef =
      typeof row.result_type === 'string' &&
      row.result_type.trim().length > 0 &&
      typeof row.result_id === 'string' &&
      row.result_id.trim().length > 0;

    let errorDto: JobErrorDto | null = null;
    if (status === 'failed') {
      const code =
        typeof row.error_code === 'string' && row.error_code.trim().length > 0
          ? row.error_code.trim()
          : 'AI_GENERATION_FAILED';
      errorDto = {
        code,
        message: resolveSafeErrorMessage(code),
        retryable,
      };
    }

    const completedAt = row.finished_at ?? row.completed_at ?? null;
    const createdAtIso =
      toNullableIsoTimestamp(row.created_at) ?? new Date(0).toISOString();

    return {
      job_id: row.id,
      kind: rawKind as JobKind,
      status,
      result_ref: hasResultRef
        ? {
            type: row.result_type!.trim(),
            id: row.result_id!.trim(),
          }
        : null,
      error: errorDto,
      retryable,
      created_at: createdAtIso,
      finished_at: toNullableIsoTimestamp(completedAt),
    };
  }
}
