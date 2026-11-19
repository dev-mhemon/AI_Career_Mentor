import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../auth/services/database.service.js';
import { readJobWorkerConfiguration } from '../../config.js';
import type { JobQueryExecutor } from './job-producer.service.js';
import { computeRetryBackoffSeconds } from './job-reaper.service.js';

/** Injection token allowing deterministic jitter RNG injection in tests. */
export const JOB_QUEUE_RANDOM = Symbol('JOB_QUEUE_RANDOM');

/** Injection token allowing custom worker identity override in tests. */
export const JOB_WORKER_ID = Symbol('JOB_WORKER_ID');

/** Attempt fence `(request_id, locked_by, attempt_count)` per `R13`. */
export interface JobAttemptFence {
  requestId: string;
  lockedBy: string;
  attemptCount: number;
}

/** Claimed row returned by `FOR UPDATE SKIP LOCKED` on `public.ai_requests`. */
export interface ClaimedJobRow {
  id: string;
  user_id: string;
  task: string;
  feature_key: string | null;
  job_kind: string;
  status: string;
  attempt_count: number;
  locked_by: string;
  locked_at: Date | string;
  created_at: Date | string;
  language: string | null;
  subject_type: string | null;
  subject_id: string | null;
  idempotency_key: string | null;
  input_payload: Record<string, unknown> | null;
}

/** Execution payload produced outside DB transactions prior to the atomic commit gate. */
export interface JobExecutionResult {
  resultType: string;
  resultId: string;
  providerKey: string;
  modelId: string;
  promptVersionId: string;
  outputSchemaId: string;
  fallbackUsed: boolean;
  language: 'bn' | 'en' | 'mixed' | null;
  inputUnits: number;
  outputUnits: number;
  latencyMs: number;
  outputHash?: string;
  output: unknown;
}

/** Domain callback interface executed by `PostgresJobQueueConsumer`. */
export interface JobHandler {
  /** Runs external/AI generation outside DB transactions; must respect `signal`. */
  execute(job: ClaimedJobRow, signal: AbortSignal): Promise<JobExecutionResult>;

  /** Verifies `expected_refs` inside the commit-gate transaction (`STALE_JOB_INPUT` on drift). */
  verifyExpectedRefs?(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
  ): Promise<{ ok: boolean; reason?: string }>;

  /** Atomically persists domain artifacts inside the same commit-gate transaction. */
  persistArtifact(
    tx: JobQueryExecutor,
    job: ClaimedJobRow,
    result: JobExecutionResult,
  ): Promise<{ resultType?: string; resultId?: string } | void>;
}

export type JobProcessOutcome =
  | {
      outcome: 'succeeded';
      jobId: string;
      resultType: string;
      resultId: string;
    }
  | { outcome: 'fence_lost'; jobId: string }
  | {
      outcome: 'failed_requeued';
      jobId: string;
      errorCode: string;
      nextAttemptDelaySeconds: number;
    }
  | { outcome: 'failed_terminal'; jobId: string; errorCode: string };

interface LockedGateRow {
  id: string;
  user_id: string;
  task: string;
  feature_key: string | null;
  status: string;
  locked_by: string | null;
  attempt_count: number | string;
  lease_valid: boolean;
  within_deadline: boolean;
}

interface OwnerAccessRow {
  user_status: string;
  feature_allowed: boolean;
}

const SAFE_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
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
  ACCOUNT_SUSPENDED: 'Account is not active for job completion.',
  FEATURE_DISABLED: 'Feature is disabled for this account.',
};

function classifyExecutionError(error: unknown): {
  errorCode: string;
  safeMessage: string;
  retryable: boolean;
} {
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown;
      retryable?: unknown;
      getResponse?: () => unknown;
    };
    const responseBody =
      typeof candidate.getResponse === 'function'
        ? candidate.getResponse()
        : candidate;
    if (responseBody && typeof responseBody === 'object') {
      const rec = responseBody as { code?: unknown; retryable?: unknown };
      if (typeof rec.code === 'string' && rec.code in SAFE_FAILURE_MESSAGES) {
        const retryable =
          typeof rec.retryable === 'boolean'
            ? rec.retryable
            : !['UNSUPPORTED_LANGUAGE', 'STALE_JOB_INPUT'].includes(rec.code);
        return {
          errorCode: rec.code,
          safeMessage: SAFE_FAILURE_MESSAGES[rec.code],
          retryable,
        };
      }
    }
  }
  return {
    errorCode: 'AI_GENERATION_FAILED',
    safeMessage: SAFE_FAILURE_MESSAGES.AI_GENERATION_FAILED,
    retryable: true,
  };
}

function sha256Hex(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null), 'utf8')
    .digest('hex');
}

/**
 * Durable PostgreSQL `FOR UPDATE SKIP LOCKED` job consumer (`ADR-017`, `R12`, `R13`).
 *
 * Guarantees:
 * - Commits the `SKIP LOCKED` claim (`queued -> preparing`) BEFORE any external AI call.
 * - Maintains a 30s fenced heartbeat (`(request_id, locked_by, attempt_count)`).
 * - Re-locks the request row before domain writes, verifies fence, lease freshness (`120s`),
 *   1h total deadline, owner active/feature access, and `expected_refs` (`STALE_JOB_INPUT`),
 *   then writes domain artifact + `ai_generations` + `status='succeeded'` + `input_payload = NULL`
 *   in ONE atomic transaction.
 * - Clears `input_payload = NULL` on terminal failures and uses two-step `preparing -> failed`
 *   then separate `failed -> queued` for bounded retries (`< 5` attempts, `< 1h` age).
 */
@Injectable()
export class PostgresJobQueueConsumer implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresJobQueueConsumer.name);
  readonly workerId: string;
  readonly leaseSeconds: number;
  readonly heartbeatSeconds: number;
  readonly maxAttempts: number;
  readonly maxAgeSeconds: number;
  readonly pollIntervalMs: number;
  private readonly randomFn: () => number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollingInFlight = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(ConfigService) configService?: ConfigService,
    @Optional() @Inject(JOB_QUEUE_RANDOM) randomFn?: () => number,
    @Optional() @Inject(JOB_WORKER_ID) workerId?: string,
  ) {
    const cfg = readJobWorkerConfiguration(configService ?? process.env);
    this.leaseSeconds = cfg.leaseSeconds;
    this.heartbeatSeconds = cfg.heartbeatSeconds;
    this.maxAttempts = cfg.maxAttempts;
    this.maxAgeSeconds = cfg.maxAgeSeconds;
    this.pollIntervalMs = cfg.pollIntervalMs;
    this.randomFn = randomFn ?? Math.random;
    this.workerId =
      typeof workerId === 'string' && workerId.trim()
        ? workerId.trim()
        : `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  private async runTx<T>(
    operation: (tx: JobQueryExecutor) => Promise<T>,
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

  /**
   * Claims up to `batchSize` queued async jobs via `FOR UPDATE SKIP LOCKED`
   * on `idx_ai_requests_queue` and commits `queued -> preparing` before returning.
   */
  async claimBatch(batchSize = 1): Promise<ClaimedJobRow[]> {
    const boundedLimit = Math.max(1, Math.min(50, Math.floor(batchSize)));
    return this.runTx((tx) =>
      tx.query<ClaimedJobRow[]>(
        `WITH candidates AS (
           SELECT id
             FROM public.ai_requests
            WHERE is_async = true
              AND status = 'queued'
              AND available_at <= clock_timestamp()
              AND attempt_count < $1
              AND created_at > clock_timestamp() - ($2 * interval '1 second')
            ORDER BY available_at ASC, id ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED
         )
         UPDATE public.ai_requests r
            SET status = 'preparing',
                locked_by = $4,
                locked_at = clock_timestamp()
           FROM candidates c
          WHERE r.id = c.id
         RETURNING r.id,
                   r.user_id,
                   r.task::text AS task,
                   r.feature_key::text AS feature_key,
                   r.job_kind::text AS job_kind,
                   r.status::text AS status,
                   r.attempt_count,
                   r.locked_by,
                   r.locked_at,
                   r.created_at,
                   r.language::text AS language,
                   r.subject_type,
                   r.subject_id,
                   r.idempotency_key,
                   r.input_payload`,
        [this.maxAttempts, this.maxAgeSeconds, boundedLimit, this.workerId],
      ),
    );
  }

  /**
   * Renews lease timestamp strictly while the attempt fence `(id, locked_by, attempt_count)`
   * still owns `'preparing'`. Zero updated rows indicates fence loss.
   */
  async sendHeartbeat(fence: JobAttemptFence): Promise<boolean> {
    const rows = await this.runTx((tx) =>
      tx.query<Array<{ id: string }>>(
        `UPDATE public.ai_requests
            SET locked_at = clock_timestamp()
          WHERE id = $1
            AND status = 'preparing'
            AND locked_by = $2
            AND attempt_count = $3
         RETURNING id`,
        [fence.requestId, fence.lockedBy, fence.attemptCount],
      ),
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  /**
   * Executes a single claimed job with fenced heartbeats outside DB transactions,
   * followed by an atomic commit gate (`R13`).
   */
  async processClaimedJob(
    job: ClaimedJobRow,
    handler: JobHandler,
  ): Promise<JobProcessOutcome> {
    const fence: JobAttemptFence = {
      requestId: job.id,
      lockedBy: job.locked_by,
      attemptCount: Number(job.attempt_count),
    };
    const abortController = new AbortController();
    let fenceLost = false;
    let heartbeatInFlight = false;

    const stopHeartbeat = () => {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const pulseHeartbeat = async () => {
      if (fenceLost || abortController.signal.aborted || heartbeatInFlight) {
        return;
      }
      heartbeatInFlight = true;
      try {
        const renewed = await this.sendHeartbeat(fence);
        if (!renewed) {
          fenceLost = true;
          abortController.abort(new Error('Attempt fence lost'));
          stopHeartbeat();
        }
      } catch (err) {
        this.logger.warn(
          `Heartbeat failed for job ${job.id}: ${err instanceof Error ? err.message : 'unknown'}`,
        );
        fenceLost = true;
        abortController.abort(new Error('Heartbeat error'));
        stopHeartbeat();
      } finally {
        heartbeatInFlight = false;
      }
    };

    let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(
      () => {
        void pulseHeartbeat();
      },
      this.heartbeatSeconds * 1_000,
    );
    heartbeatTimer.unref?.();

    let execResult: JobExecutionResult;
    try {
      execResult = await handler.execute(job, abortController.signal);
    } catch (error) {
      stopHeartbeat();
      if (fenceLost || abortController.signal.aborted) {
        return { outcome: 'fence_lost', jobId: job.id };
      }
      return this.recordExecutionFailure(fence, classifyExecutionError(error));
    } finally {
      stopHeartbeat();
    }

    if (fenceLost || abortController.signal.aborted) {
      return { outcome: 'fence_lost', jobId: job.id };
    }

    try {
      return await this.commitSucceededJob(job, fence, handler, execResult);
    } catch (commitError) {
      this.logger.warn(
        `Commit gate aborted for job ${job.id}: ${commitError instanceof Error ? commitError.message : 'unknown'}`,
      );
      return this.recordExecutionFailure(
        fence,
        classifyExecutionError(commitError),
      );
    }
  }

  private async commitSucceededJob(
    job: ClaimedJobRow,
    fence: JobAttemptFence,
    handler: JobHandler,
    execResult: JobExecutionResult,
  ): Promise<JobProcessOutcome> {
    return this.runTx(async (tx) => {
      const lockedRows = await tx.query<LockedGateRow[]>(
        `SELECT id,
                user_id,
                task::text AS task,
                feature_key::text AS feature_key,
                status::text AS status,
                locked_by,
                attempt_count,
                (locked_at IS NOT NULL AND locked_at > clock_timestamp() - ($2 * interval '1 second')) AS lease_valid,
                (created_at > clock_timestamp() - ($3 * interval '1 second')) AS within_deadline
           FROM public.ai_requests
          WHERE id = $1
          FOR UPDATE`,
        [fence.requestId, this.leaseSeconds, this.maxAgeSeconds],
      );
      const locked = Array.isArray(lockedRows) ? lockedRows[0] : undefined;
      if (
        !locked ||
        locked.status !== 'preparing' ||
        locked.locked_by !== fence.lockedBy ||
        Number(locked.attempt_count) !== fence.attemptCount ||
        locked.lease_valid === false
      ) {
        return { outcome: 'fence_lost', jobId: fence.requestId };
      }

      if (locked.within_deadline === false) {
        await this.markTerminalFailureInTx(
          tx,
          fence,
          'WORKER_LEASE_EXPIRED',
          SAFE_FAILURE_MESSAGES.WORKER_LEASE_EXPIRED,
        );
        return {
          outcome: 'failed_terminal',
          jobId: fence.requestId,
          errorCode: 'WORKER_LEASE_EXPIRED',
        };
      }

      const accessRows = await tx.query<OwnerAccessRow[]>(
        `SELECT u.status::text AS user_status,
                CASE
                  WHEN $2::public.feature_key IS NULL THEN true
                  ELSE private.effective_feature_access($1, $2::public.feature_key)
                END AS feature_allowed
           FROM public.users u
          WHERE u.id = $1`,
        [locked.user_id, locked.feature_key],
      );
      const access = Array.isArray(accessRows) ? accessRows[0] : undefined;
      if (!access || access.user_status !== 'active') {
        await this.markTerminalFailureInTx(
          tx,
          fence,
          'ACCOUNT_SUSPENDED',
          SAFE_FAILURE_MESSAGES.ACCOUNT_SUSPENDED,
        );
        return {
          outcome: 'failed_terminal',
          jobId: fence.requestId,
          errorCode: 'ACCOUNT_SUSPENDED',
        };
      }
      if (access.feature_allowed === false) {
        await this.markTerminalFailureInTx(
          tx,
          fence,
          'FEATURE_DISABLED',
          SAFE_FAILURE_MESSAGES.FEATURE_DISABLED,
        );
        return {
          outcome: 'failed_terminal',
          jobId: fence.requestId,
          errorCode: 'FEATURE_DISABLED',
        };
      }

      if (typeof handler.verifyExpectedRefs === 'function') {
        const refCheck = await handler.verifyExpectedRefs(tx, job);
        if (!refCheck.ok) {
          await this.markTerminalFailureInTx(
            tx,
            fence,
            'STALE_JOB_INPUT',
            SAFE_FAILURE_MESSAGES.STALE_JOB_INPUT,
          );
          return {
            outcome: 'failed_terminal',
            jobId: fence.requestId,
            errorCode: 'STALE_JOB_INPUT',
          };
        }
      }

      const persisted = await handler.persistArtifact(tx, job, execResult);
      const resultType = persisted?.resultType ?? execResult.resultType;
      const resultId = persisted?.resultId ?? execResult.resultId;
      const outputHash = execResult.outputHash ?? sha256Hex(execResult.output);

      await tx.query(
        `INSERT INTO public.ai_generations (
           request_id,
           task,
           provider_key,
           model_id,
           prompt_version_id,
           output_schema_id,
           validation_status,
           fallback_used,
           language,
           input_units,
           output_units,
           latency_ms,
           output_hash
         )
         VALUES (
           $1,
           $2::public.ai_task,
           $3,
           $4,
           $5,
           $6,
           $7::public.ai_validation_status,
           $8,
           $9::public.ui_language,
           $10,
           $11,
           $12,
           $13
         )
         RETURNING id`,
        [
          fence.requestId,
          locked.task,
          execResult.providerKey,
          execResult.modelId,
          execResult.promptVersionId,
          execResult.outputSchemaId,
          'passed',
          execResult.fallbackUsed,
          execResult.language,
          Math.max(0, Math.trunc(execResult.inputUnits)),
          Math.max(0, Math.trunc(execResult.outputUnits)),
          Math.max(0, Math.trunc(execResult.latencyMs)),
          outputHash,
        ],
      );

      const finalized = await tx.query<Array<{ id: string }>>(
        `UPDATE public.ai_requests
            SET status = 'succeeded',
                result_type = $4,
                result_id = $5,
                provider_key = $6,
                model_id = $7,
                fallback_used = $8,
                prompt_version_id = $9,
                input_units = $10,
                output_units = $11,
                latency_ms = $12,
                validation_status = 'passed'::public.ai_validation_status,
                retryable = false,
                error_code = NULL,
                error_message = NULL,
                finished_at = clock_timestamp(),
                input_payload = NULL
          WHERE id = $1
            AND status = 'preparing'
            AND locked_by = $2
            AND attempt_count = $3
         RETURNING id`,
        [
          fence.requestId,
          fence.lockedBy,
          fence.attemptCount,
          resultType,
          resultId,
          execResult.providerKey,
          execResult.modelId,
          execResult.fallbackUsed,
          execResult.promptVersionId,
          Math.max(0, Math.trunc(execResult.inputUnits)),
          Math.max(0, Math.trunc(execResult.outputUnits)),
          Math.max(0, Math.trunc(execResult.latencyMs)),
        ],
      );

      if (!Array.isArray(finalized) || finalized.length === 0) {
        throw new Error('Attempt fence lost during final status update');
      }

      return {
        outcome: 'succeeded',
        jobId: fence.requestId,
        resultType,
        resultId,
      };
    });
  }

  private async markTerminalFailureInTx(
    tx: JobQueryExecutor,
    fence: JobAttemptFence,
    errorCode: string,
    safeMessage: string,
  ): Promise<boolean> {
    const rows = await tx.query<Array<{ id: string }>>(
      `UPDATE public.ai_requests
          SET status = 'failed',
              error_code = $4,
              error_message = $5,
              retryable = false,
              finished_at = clock_timestamp(),
              input_payload = NULL
        WHERE id = $1
          AND status = 'preparing'
          AND locked_by = $2
          AND attempt_count = $3
       RETURNING id`,
      [
        fence.requestId,
        fence.lockedBy,
        fence.attemptCount,
        errorCode,
        safeMessage,
      ],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async recordExecutionFailure(
    fence: JobAttemptFence,
    failure: { errorCode: string; safeMessage: string; retryable: boolean },
  ): Promise<JobProcessOutcome> {
    return this.runTx(async (tx) => {
      const canRetry =
        failure.retryable && fence.attemptCount < this.maxAttempts;
      if (!canRetry) {
        const updated = await this.markTerminalFailureInTx(
          tx,
          fence,
          failure.errorCode,
          failure.safeMessage,
        );
        if (!updated) {
          return { outcome: 'fence_lost', jobId: fence.requestId };
        }
        return {
          outcome: 'failed_terminal',
          jobId: fence.requestId,
          errorCode: failure.errorCode,
        };
      }

      // Step 1: preparing -> failed (retryable = true, preserving input_payload within deadline)
      const failedRows = await tx.query<Array<{ id: string }>>(
        `UPDATE public.ai_requests
            SET status = 'failed',
                error_code = $4,
                error_message = $5,
                retryable = true,
                finished_at = clock_timestamp()
          WHERE id = $1
            AND status = 'preparing'
            AND locked_by = $2
            AND attempt_count = $3
         RETURNING id`,
        [
          fence.requestId,
          fence.lockedBy,
          fence.attemptCount,
          failure.errorCode,
          failure.safeMessage,
        ],
      );
      if (!Array.isArray(failedRows) || failedRows.length === 0) {
        return { outcome: 'fence_lost', jobId: fence.requestId };
      }

      // Step 2: separate UPDATE failed -> queued (never preparing -> queued)
      const delaySeconds = computeRetryBackoffSeconds(
        fence.attemptCount,
        this.randomFn,
      );
      const requeuedRows = await tx.query<Array<{ id: string }>>(
        `UPDATE public.ai_requests
            SET status = 'queued',
                available_at = clock_timestamp() + ($2 * interval '1 second')
          WHERE id = $1
            AND status = 'failed'
            AND retryable = true
            AND attempt_count < $3
            AND created_at > clock_timestamp() - ($4 * interval '1 second')
         RETURNING id`,
        [fence.requestId, delaySeconds, this.maxAttempts, this.maxAgeSeconds],
      );
      if (!Array.isArray(requeuedRows) || requeuedRows.length === 0) {
        await tx.query(
          `UPDATE public.ai_requests
              SET retryable = false,
                  input_payload = NULL
            WHERE id = $1
              AND status = 'failed'
           RETURNING id`,
          [fence.requestId],
        );
        return {
          outcome: 'failed_terminal',
          jobId: fence.requestId,
          errorCode: failure.errorCode,
        };
      }

      return {
        outcome: 'failed_requeued',
        jobId: fence.requestId,
        errorCode: failure.errorCode,
        nextAttemptDelaySeconds: delaySeconds,
      };
    });
  }

  /**
   * Claims and processes one batch of queued jobs using the supplied handler.
   */
  async pollOnce(
    handler: JobHandler,
    batchSize = 1,
  ): Promise<JobProcessOutcome[]> {
    const claimed = await this.claimBatch(batchSize);
    const outcomes: JobProcessOutcome[] = [];
    for (const job of claimed) {
      outcomes.push(await this.processClaimedJob(job, handler));
    }
    return outcomes;
  }

  /** Starts a non-overlapping polling loop (`pollIntervalMs`). */
  start(handler: JobHandler, batchSize = 1): void {
    if (this.pollTimer !== null) {
      return;
    }
    this.pollTimer = setInterval(() => {
      if (this.pollingInFlight) {
        return;
      }
      this.pollingInFlight = true;
      void this.pollOnce(handler, batchSize)
        .catch((err) => {
          this.logger.warn(
            `Queue poll failed: ${err instanceof Error ? err.message : 'unknown'}`,
          );
        })
        .finally(() => {
          this.pollingInFlight = false;
        });
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  /** Stops the background polling loop. */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }
}
