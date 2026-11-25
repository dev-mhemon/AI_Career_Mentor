import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import type {
  RatingTarget,
  ReportReason,
  ReportTarget,
} from '../dto/feedback.dto.js';

export const REPORT_AUTO_HIDE_THRESHOLD_CONFIG_KEY =
  'quality.report_auto_hide_threshold';
export const DEFAULT_REPORT_AUTO_HIDE_THRESHOLD = 5;
export const MIN_REPORT_AUTO_HIDE_THRESHOLD = 2;
export const MAX_REPORT_AUTO_HIDE_THRESHOLD = 1_000;
export const DEFAULT_QUALITY_CONFIG_CACHE_TTL_MS = 5_000;
export const MAX_QUALITY_CONFIG_CACHE_TTL_MS = 5_000;

export const QUALITY_CONFIG_CACHE_TTL_TOKEN = Symbol(
  'QUALITY_CONFIG_CACHE_TTL_TOKEN',
);

export interface FeedbackQueryExecutor {
  query<T = unknown>(query: string, parameters?: unknown[]): Promise<T>;
}

interface CachedThresholdEntry {
  value: number;
  expiresAtMs: number;
}

/**
 * Shared-content quality & threshold service (`C05` §14.12, `C08` §16, `R11`, `R26`).
 *
 * - Reads `quality.report_auto_hide_threshold` from `public.system_configurations` with strict
 *   runtime validation (`integer 2..1000`, rejecting strings, `null`, booleans, floats, and
 *   out-of-range numbers), bounded short TTL caching (`<= 5_000ms`), and safe default `5`.
 * - Emits content-free operational events (`target_type`, `target_id`, `reason`/`score` only —
 *   strictly zero raw learner comments, zero private answers, and zero threshold leakage to clients).
 */
@Injectable()
export class SharedContentQualityService {
  private readonly logger = new Logger(SharedContentQualityService.name);
  private cachedThreshold: CachedThresholdEntry | null = null;
  private cacheGeneration = 0;
  private pendingRefresh: {
    generation: number;
    promise: Promise<number>;
  } | null = null;
  readonly cacheTtlMs: number;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(QUALITY_CONFIG_CACHE_TTL_TOKEN) cacheTtlMs?: number,
  ) {
    const candidateTtl =
      typeof cacheTtlMs === 'number' &&
      Number.isInteger(cacheTtlMs) &&
      cacheTtlMs >= 0
        ? Math.min(cacheTtlMs, MAX_QUALITY_CONFIG_CACHE_TTL_MS)
        : DEFAULT_QUALITY_CONFIG_CACHE_TTL_MS;
    this.cacheTtlMs = candidateTtl;
  }

  private async runServiceQuery<T>(
    operation: (db: FeedbackQueryExecutor) => Promise<T>,
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

  /** Clears the cached `quality.report_auto_hide_threshold` entry after approved updates (`R26`). */
  invalidateCache(): void {
    this.cacheGeneration += 1;
    this.cachedThreshold = null;
    this.pendingRefresh = null;
  }

  private async readThresholdFromDb(
    db?: FeedbackQueryExecutor,
  ): Promise<number> {
    const queryFn = (executor: FeedbackQueryExecutor) =>
      executor.query<Array<{ config_value: unknown }>>(
        `SELECT config_value
           FROM public.system_configurations
          WHERE config_key = $1
          LIMIT 1`,
        [REPORT_AUTO_HIDE_THRESHOLD_CONFIG_KEY],
      );
    const rows = db ? await queryFn(db) : await this.runServiceQuery(queryFn);
    const raw = Array.isArray(rows) ? rows[0]?.config_value : undefined;
    if (
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= MIN_REPORT_AUTO_HIDE_THRESHOLD &&
      raw <= MAX_REPORT_AUTO_HIDE_THRESHOLD
    ) {
      return raw;
    }
    return DEFAULT_REPORT_AUTO_HIDE_THRESHOLD;
  }

  private readMonotonicMs(): number {
    return performance.now();
  }

  /**
   * Reads `quality.report_auto_hide_threshold` (`R26`: integer `2..1000`, `<= 5s` TTL, fallback `5`).
   * Never exposed to client DTOs (`C05` §14.12).
   *
   * - Transactional reads (`db` supplied) bypass shared cache lookup/writes and propagate SQL errors
   *   so the caller can roll back an aborted PostgreSQL transaction cleanly.
   * - Standalone reads deduplicate concurrent refreshes per invalidation generation so an older
   *   in-flight read can never overwrite a newer threshold, and measure TTL via monotonic elapsed time.
   */
  async getReportAutoHideThreshold(
    db?: FeedbackQueryExecutor,
  ): Promise<number> {
    if (db) {
      return this.readThresholdFromDb(db);
    }

    const now = this.readMonotonicMs();
    if (this.cachedThreshold && now < this.cachedThreshold.expiresAtMs) {
      return this.cachedThreshold.value;
    }

    const generation = this.cacheGeneration;
    if (this.pendingRefresh && this.pendingRefresh.generation === generation) {
      return this.pendingRefresh.promise;
    }

    const refreshPromise = (async () => {
      let resolved: number;
      try {
        resolved = await this.readThresholdFromDb();
      } catch {
        resolved = DEFAULT_REPORT_AUTO_HIDE_THRESHOLD;
      }

      if (this.cacheGeneration === generation) {
        this.cachedThreshold = {
          value: resolved,
          expiresAtMs: this.readMonotonicMs() + this.cacheTtlMs,
        };
      }
      return resolved;
    })().finally(() => {
      if (this.pendingRefresh?.promise === refreshPromise) {
        this.pendingRefresh = null;
      }
    });

    this.pendingRefresh = { generation, promise: refreshPromise };
    return refreshPromise;
  }

  /**
   * Evaluates whether a distinct-user report count meets or exceeds the configured auto-hide threshold (`R26`/`R27`).
   */
  async hasReachedAutoHideThreshold(
    distinctUserReportCount: number,
    db?: FeedbackQueryExecutor,
  ): Promise<boolean> {
    if (
      typeof distinctUserReportCount !== 'number' ||
      !Number.isInteger(distinctUserReportCount) ||
      distinctUserReportCount < 1
    ) {
      return false;
    }
    const threshold = await this.getReportAutoHideThreshold(db);
    return distinctUserReportCount >= threshold;
  }

  /**
   * Emits content-free operational log for an accepted rating (`R11` — never logs comment text).
   */
  recordRatingSubmitted(event: {
    targetType: RatingTarget;
    targetId: string;
    score: number;
  }): void {
    this.logger.log(
      JSON.stringify({
        event: 'feedback.rating_submitted',
        target_type: event.targetType,
        target_id: event.targetId,
        score: event.score,
      }),
    );
  }

  /**
   * Emits content-free operational log for an accepted report (`R11` — never logs comment text or threshold).
   */
  recordReportSubmitted(event: {
    targetType: ReportTarget;
    targetId: string;
    reason: ReportReason;
  }): void {
    this.logger.log(
      JSON.stringify({
        event: 'feedback.report_submitted',
        target_type: event.targetType,
        target_id: event.targetId,
        reason: event.reason,
      }),
    );
  }
}
