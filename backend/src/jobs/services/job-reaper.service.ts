import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../auth/services/database.service.js';
import { readJobWorkerConfiguration } from '../../config.js';
import type { JobQueryExecutor } from './job-producer.service.js';

/** Injection token allowing deterministic jitter RNG injection in tests. */
export const JOB_REAPER_RANDOM = Symbol('JOB_REAPER_RANDOM');

/** Summary returned by one bounded reaper sweep. */
export interface ReaperSweepResult {
  inspected: number;
  requeued: number;
  failedTerminal: number;
}

interface ExpiredLeaseRow {
  id: string;
  locked_by: string | null;
  attempt_count: number | string;
  can_retry: boolean;
}

interface ExpiredQueuedRow {
  id: string;
}

/**
 * Unwraps TypeORM PostgreSQL `UPDATE ... RETURNING` tuple `[rows, rowCount]` into a plain row array.
 */
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

/**
 * Computes bounded exponential retry backoff `min(300, 2^attemptCount) + boundedJitter` (`R13`).
 */
export function computeRetryBackoffSeconds(
  attemptCount: number,
  randomFn: () => number = Math.random,
): number {
  const safeAttempt = Math.max(1, Math.trunc(attemptCount));
  const base = Math.min(300, Math.pow(2, safeAttempt));
  const maxJitter = Math.min(30, Math.max(1, Math.floor(base * 0.25)));
  const sample = randomFn();
  const r = Number.isFinite(sample) ? sample : 0;
  const clampedRandom = Math.max(0, Math.min(0.999999, r));
  const jitter = Math.floor(clampedRandom * (maxJitter + 1));
  return base + jitter;
}

/**
 * Bounded lease-expiry reaper for stalled `public.ai_requests` jobs (`R13`).
 *
 * CRITICAL DB TRIGGER INVARIANT (`private.validate_ai_request_status()` / SQLSTATE `23514`):
 * NEVER transitions `preparing -> queued` directly. Always executes:
 * 1. `UPDATE ... SET status = 'failed', error_code = 'WORKER_LEASE_EXPIRED', retryable = true`
 * 2. Separate `UPDATE ... SET status = 'queued', available_at = ...` ONLY when `attempt_count < 5`
 *    and `created_at > clock_timestamp() - interval '1 hour'`.
 * Exhausted or expired jobs are marked terminal (`retryable = false`, `input_payload = NULL`).
 */
@Injectable()
export class JobReaperService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(JobReaperService.name);
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly maxAgeSeconds: number;
  readonly reaperIntervalSeconds: number;
  private readonly autoStart: boolean;
  private readonly randomFn: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(ConfigService) configService?: ConfigService,
    @Optional() @Inject(JOB_REAPER_RANDOM) randomFn?: () => number,
  ) {
    const cfg = readJobWorkerConfiguration(configService ?? process.env);
    this.leaseSeconds = cfg.leaseSeconds;
    this.maxAttempts = cfg.maxAttempts;
    this.maxAgeSeconds = cfg.maxAgeSeconds;
    this.reaperIntervalSeconds = cfg.reaperIntervalSeconds;
    const nodeEnv =
      configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    const rawAutoStart =
      configService?.get<string>('JOB_REAPER_AUTO_START') ??
      process.env.JOB_REAPER_AUTO_START;
    this.autoStart = nodeEnv !== 'test' && rawAutoStart !== 'false';
    this.randomFn = randomFn ?? Math.random;
  }

  onApplicationBootstrap(): void {
    if (this.autoStart) {
      this.start();
    }
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
   * Sweeps up to `batchSize` stalled or over-age `'preparing'` jobs and up to `batchSize`
   * over-age `'queued'` jobs (`R13`).
   */
  async reapExpiredLeases(batchSize = 20): Promise<ReaperSweepResult> {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(batchSize)));
    return this.runTx(async (tx) => {
      const expired = await tx.query<ExpiredLeaseRow[]>(
        `SELECT id,
                locked_by,
                attempt_count,
                (attempt_count < $1 AND created_at > clock_timestamp() - ($2 * interval '1 second')) AS can_retry
           FROM public.ai_requests
          WHERE is_async = true
            AND status = 'preparing'
            AND (
              locked_at <= clock_timestamp() - ($3 * interval '1 second')
              OR created_at <= clock_timestamp() - ($2 * interval '1 second')
            )
          ORDER BY locked_at ASC, id ASC
          LIMIT $4
          FOR UPDATE SKIP LOCKED`,
        [this.maxAttempts, this.maxAgeSeconds, this.leaseSeconds, boundedLimit],
      );

      let inspected = 0;
      let requeued = 0;
      let failedTerminal = 0;

      for (const row of expired ?? []) {
        inspected += 1;
        const attemptCount = Number(row.attempt_count);

        if (row.can_retry) {
          // Step 1: preparing -> failed (required by private.validate_ai_request_status trigger)
          const step1Raw = await tx.query<unknown>(
            `UPDATE public.ai_requests
                SET status = 'failed',
                    error_code = 'WORKER_LEASE_EXPIRED',
                    error_message = 'Worker lease expired before completion',
                    retryable = true,
                    finished_at = clock_timestamp()
              WHERE id = $1
                AND status = 'preparing'
                AND locked_by IS NOT DISTINCT FROM $2
                AND attempt_count = $3
             RETURNING id`,
            [row.id, row.locked_by, attemptCount],
          );
          const step1 = extractReturningRows<{ id: string }>(step1Raw);

          if (step1.length === 0) {
            continue;
          }

          // Step 2: separate UPDATE failed -> queued with bounded exponential backoff
          const delaySeconds = computeRetryBackoffSeconds(
            attemptCount,
            this.randomFn,
          );
          const step2Raw = await tx.query<unknown>(
            `UPDATE public.ai_requests
                SET status = 'queued',
                    available_at = clock_timestamp() + ($2 * interval '1 second')
              WHERE id = $1
                AND status = 'failed'
                AND retryable = true
                AND attempt_count < $3
                AND created_at > clock_timestamp() - ($4 * interval '1 second')
             RETURNING id`,
            [row.id, delaySeconds, this.maxAttempts, this.maxAgeSeconds],
          );
          const step2 = extractReturningRows<{ id: string }>(step2Raw);

          if (step2.length > 0) {
            requeued += 1;
          } else {
            await tx.query(
              `UPDATE public.ai_requests
                  SET retryable = false,
                      input_payload = NULL
                WHERE id = $1
                  AND status = 'failed'
               RETURNING id`,
              [row.id],
            );
            failedTerminal += 1;
          }
        } else {
          // Terminal failure: max attempts reached or 1h total age deadline exceeded; purge input_payload
          const terminalRaw = await tx.query<unknown>(
            `UPDATE public.ai_requests
                SET status = 'failed',
                    error_code = 'WORKER_LEASE_EXPIRED',
                    error_message = 'Job exceeded retry or total age limits',
                    retryable = false,
                    finished_at = clock_timestamp(),
                    input_payload = NULL
              WHERE id = $1
                AND status = 'preparing'
                AND locked_by IS NOT DISTINCT FROM $2
                AND attempt_count = $3
             RETURNING id`,
            [row.id, row.locked_by, attemptCount],
          );
          const terminalRows = extractReturningRows<{ id: string }>(
            terminalRaw,
          );
          if (terminalRows.length > 0) {
            failedTerminal += 1;
          }
        }
      }

      // Bounded sweep for queued jobs that exceeded maxAgeSeconds while never claimed (queued -> failed, permitted by 015_functions.sql)
      const expiredQueued = await tx.query<ExpiredQueuedRow[]>(
        `SELECT id
           FROM public.ai_requests
          WHERE is_async = true
            AND status = 'queued'
            AND created_at <= clock_timestamp() - ($1 * interval '1 second')
          ORDER BY created_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [this.maxAgeSeconds, boundedLimit],
      );

      for (const row of expiredQueued ?? []) {
        inspected += 1;
        const terminalRaw = await tx.query<unknown>(
          `UPDATE public.ai_requests
              SET status = 'failed',
                  error_code = 'WORKER_LEASE_EXPIRED',
                  error_message = 'Job exceeded total age limit before execution',
                  retryable = false,
                  finished_at = clock_timestamp(),
                  input_payload = NULL
            WHERE id = $1
              AND status = 'queued'
           RETURNING id`,
          [row.id],
        );
        const terminalRows = extractReturningRows<{ id: string }>(terminalRaw);
        if (terminalRows.length > 0) {
          failedTerminal += 1;
        }
      }

      // Bounded sweep for abandoned synchronous quota reservations (is_async = false, status = 'preparing'):
      // terminalize directly (preparing -> failed, retryable = false, NEVER requeued) so they stop consuming daily quota.
      const abandonedSync = await tx.query<ExpiredQueuedRow[]>(
        `SELECT id
           FROM public.ai_requests
          WHERE is_async = false
            AND status = 'preparing'
            AND COALESCE(locked_at, started_at, created_at) <= clock_timestamp() - ($1 * interval '1 second')
          ORDER BY created_at ASC, id ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [this.leaseSeconds, boundedLimit],
      );

      for (const row of abandonedSync ?? []) {
        inspected += 1;
        const terminalRaw = await tx.query<unknown>(
          `UPDATE public.ai_requests
              SET status = 'failed',
                  error_code = 'WORKER_LEASE_EXPIRED',
                  error_message = 'Synchronous AI reservation expired before completion',
                  retryable = false,
                  finished_at = clock_timestamp(),
                  input_payload = NULL
            WHERE id = $1
              AND is_async = false
              AND status = 'preparing'
           RETURNING id`,
          [row.id],
        );
        const terminalRows = extractReturningRows<{ id: string }>(terminalRaw);
        if (terminalRows.length > 0) {
          failedTerminal += 1;
        }
      }

      return { inspected, requeued, failedTerminal };
    });
  }

  /** Starts the bounded periodic reaper loop (`<= 30s`). */
  start(batchSize = 20): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.inFlight) {
        return;
      }
      this.inFlight = true;
      void this.reapExpiredLeases(batchSize)
        .catch(() => {
          this.logger.warn('Job reaper sweep failed (JOB_REAPER_SWEEP_ERROR)');
        })
        .finally(() => {
          this.inFlight = false;
        });
    }, this.reaperIntervalSeconds * 1_000);
    this.timer.unref?.();
  }

  /** Stops the periodic reaper loop. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }
}
