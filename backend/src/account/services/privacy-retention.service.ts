import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../auth/services/database.service.js';

/**
 * Result returned by `PrivacyRetentionService.purgeExpiredData`.
 */
export interface PurgeExecutionResult {
  /** Number of raw quiz answer texts redacted (`answer_text = NULL`). */
  rawAnswersPurged: number;
  /** Number of expired mentor messages deleted. */
  messagesDeleted: number;
  /** Number of expired AI operational request rows deleted. */
  aiRequestsDeleted: number;
  /** Number of expired AI context memory records deleted. */
  aiContextRecordsDeleted: number;
  /** Number of expired account deletion outbox records scrubbed. */
  outboxExpiredCount: number;
  /** ISO-8601 timestamp of the oldest retained raw record before purge, or `null`. */
  oldestRetainedTimestamp: string | null;
  /** Measured physical purge lag in milliseconds beyond declared cutoff. */
  purgeLagMs: number;
  /** Total wall-clock execution time for the purge run in milliseconds. */
  durationMs: number;
}

/** Default and clamped retention ceilings per PRD §52 and DDD R08/R09. */
export const DEFAULT_RAW_RESPONSE_DAYS = 90;
export const MAX_RAW_RESPONSE_DAYS = 90;
export const MIN_RAW_RESPONSE_DAYS = 1;

export const DEFAULT_MENTOR_MESSAGE_DAYS = 90;
export const MAX_MENTOR_MESSAGE_DAYS = 90;
export const MIN_MENTOR_MESSAGE_DAYS = 1;

export const DEFAULT_AI_OPERATIONAL_DAYS = 30;
export const MAX_AI_OPERATIONAL_DAYS = 30;
export const MIN_AI_OPERATIONAL_DAYS = 1;

/** Alert threshold for purge lag: 24 hours in milliseconds (`R32`). */
export const PURGE_LAG_ALERT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Service enforcing privacy retention cutoffs and executing physical purge operations (`R08`, `R09`, PRD §52).
 *
 * Enforces dual-predicate read cutoffs (earlier of `expires_at` and `created_at + 90d`), clamps retention
 * windows to canonical ceilings (90d raw text / 90d messages / 30d AI operational requests / 30d outbox),
 * executes idempotent physical purge batches, measures purge lag, and emits alerts when physical purge
 * lags beyond acceptable bounds.
 */
@Injectable()
export class PrivacyRetentionService {
  private readonly logger = new Logger(PrivacyRetentionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Retrieves the configured retention window for raw quiz answer text in days (clamped 1..90).
   *
   * @returns Configured retention in days.
   */
  getRawResponseRetentionDays(): number {
    const rawVal =
      this.config.get<string | number>('RETENTION_RAW_RESPONSE_DAYS') ??
      process.env.RETENTION_RAW_RESPONSE_DAYS;
    const parsed =
      typeof rawVal === 'number' ? rawVal : parseInt(String(rawVal), 10);
    if (Number.isNaN(parsed)) {
      return DEFAULT_RAW_RESPONSE_DAYS;
    }
    return Math.min(
      MAX_RAW_RESPONSE_DAYS,
      Math.max(MIN_RAW_RESPONSE_DAYS, parsed),
    );
  }

  /**
   * Retrieves the configured retention window for mentor messages in days (clamped 1..90).
   *
   * @returns Configured retention in days.
   */
  getMentorMessageRetentionDays(): number {
    const rawVal =
      this.config.get<string | number>('RETENTION_MENTOR_MESSAGE_DAYS') ??
      process.env.RETENTION_MENTOR_MESSAGE_DAYS;
    const parsed =
      typeof rawVal === 'number' ? rawVal : parseInt(String(rawVal), 10);
    if (Number.isNaN(parsed)) {
      return DEFAULT_MENTOR_MESSAGE_DAYS;
    }
    return Math.min(
      MAX_MENTOR_MESSAGE_DAYS,
      Math.max(MIN_MENTOR_MESSAGE_DAYS, parsed),
    );
  }

  /**
   * Retrieves the configured retention window for AI operational request logs in days (clamped 1..30).
   *
   * @returns Configured retention in days.
   */
  getAiOperationalRetentionDays(): number {
    const rawVal =
      this.config.get<string | number>('RETENTION_AI_OPERATIONAL_DAYS') ??
      process.env.RETENTION_AI_OPERATIONAL_DAYS;
    const parsed =
      typeof rawVal === 'number' ? rawVal : parseInt(String(rawVal), 10);
    if (Number.isNaN(parsed)) {
      return DEFAULT_AI_OPERATIONAL_DAYS;
    }
    return Math.min(
      MAX_AI_OPERATIONAL_DAYS,
      Math.max(MIN_AI_OPERATIONAL_DAYS, parsed),
    );
  }

  /**
   * Calculates the strict cutoff Date for mentor message queries (`R08`).
   * Messages created before this timestamp or having `expires_at <= now` must not be returned to callers.
   *
   * @param now - Reference execution time.
   * @returns Cutoff Date.
   */
  getMentorMessageCutoffDate(now: Date = new Date()): Date {
    const days = this.getMentorMessageRetentionDays();
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  /**
   * Calculates the strict cutoff Date for raw quiz answer text queries (`PRD §52`).
   *
   * @param now - Reference execution time.
   * @returns Cutoff Date.
   */
  getRawAnswerCutoffDate(now: Date = new Date()): Date {
    const days = this.getRawResponseRetentionDays();
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  /**
   * Calculates the strict cutoff Date for AI operational request logs (`R09`).
   *
   * @param now - Reference execution time.
   * @returns Cutoff Date.
   */
  getAiRequestCutoffDate(now: Date = new Date()): Date {
    const days = this.getAiOperationalRetentionDays();
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  /**
   * Evaluates the canonical dual-predicate raw text expiry condition:
   * Returns `true` if either the explicit expiry timestamp has passed OR the record is older
   * than the declared 90-day retention ceiling (`R08`, PRD §52).
   *
   * @param record - Object with `created_at` and optional `expires_at` or `raw_text_expires_at`.
   * @param now - Reference timestamp.
   * @returns Boolean indicating whether raw text has expired.
   */
  isRawTextExpired(
    record: {
      created_at: Date | string;
      expires_at?: Date | string | null;
      raw_text_expires_at?: Date | string | null;
    },
    now: Date = new Date(),
  ): boolean {
    const nowTime = now.getTime();
    if (record.expires_at) {
      const expTime = new Date(record.expires_at).getTime();
      if (!Number.isNaN(expTime) && expTime <= nowTime) {
        return true;
      }
    }
    if (record.raw_text_expires_at) {
      const rawExpTime = new Date(record.raw_text_expires_at).getTime();
      if (!Number.isNaN(rawExpTime) && rawExpTime <= nowTime) {
        return true;
      }
    }
    const createdAtTime = new Date(record.created_at).getTime();
    const rawCeilingDate = this.getRawAnswerCutoffDate(now);
    return (
      !Number.isNaN(createdAtTime) && createdAtTime <= rawCeilingDate.getTime()
    );
  }

  /**
   * Executes the physical privacy and data retention purge runner (`R08`, `R09`, PRD §52).
   *
   * Redacts raw answer text to NULL, deletes expired mentor messages, deletes AI operational
   * request records older than 30 days, purges TTL-expired AI context memory, scrubs expired
   * deletion outbox references, and computes physical purge lag metrics.
   *
   * @param options - Execution options including reference time and batch size.
   * @returns Structured `PurgeExecutionResult`.
   */
  async purgeExpiredData(
    options: { now?: Date; batchSize?: number } = {},
  ): Promise<PurgeExecutionResult> {
    const startTime = Date.now();
    const now = options.now ?? new Date();
    const batchSize = Math.max(1, options.batchSize ?? 1000);
    const rawDays = this.getRawResponseRetentionDays();
    const messageDays = this.getMentorMessageRetentionDays();
    const aiDays = this.getAiOperationalRetentionDays();

    const rawCutoff = new Date(now.getTime() - rawDays * 24 * 60 * 60 * 1000);
    const messageCutoff = new Date(
      now.getTime() - messageDays * 24 * 60 * 60 * 1000,
    );
    const aiCutoff = new Date(now.getTime() - aiDays * 24 * 60 * 60 * 1000);

    // 1. Measure oldest retained timestamp and pre-purge lag
    let oldestTimestamp: string | null = null;
    let purgeLagMs = 0;

    try {
      const oldestRows = await this.database.query<
        Array<{ oldest: Date | string | null }>
      >(
        `SELECT LEAST(
                  (SELECT min(created_at) FROM public.quiz_answers WHERE answer_text IS NOT NULL),
                  (SELECT min(created_at) FROM public.messages)
                ) AS oldest`,
      );
      if (Array.isArray(oldestRows) && oldestRows[0]?.oldest) {
        const oldestDate = new Date(oldestRows[0].oldest);
        oldestTimestamp = oldestDate.toISOString();
        const expectedRetentionMs =
          Math.max(rawDays, messageDays) * 24 * 60 * 60 * 1000;
        const recordAgeMs = now.getTime() - oldestDate.getTime();
        if (recordAgeMs > expectedRetentionMs) {
          purgeLagMs = recordAgeMs - expectedRetentionMs;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to inspect oldest retained timestamp: ${String(err)}`,
      );
    }

    if (purgeLagMs > PURGE_LAG_ALERT_THRESHOLD_MS) {
      this.logger.warn(
        `PURGE_LAG_ALERT: Physical retention purge lag (${Math.round(
          purgeLagMs / 3600000,
        )}h) exceeded alert threshold of 24h`,
      );
    }

    // 2. Physical Purge Step 1: Redact raw quiz answer text in batches
    let rawAnswersPurged = 0;
    try {
      while (true) {
        const quizRes = await this.database.query<
          Array<{ count: string | number }>
        >(
          `WITH batch AS (
             SELECT id
               FROM public.quiz_answers
              WHERE answer_text IS NOT NULL
                AND (raw_text_expires_at <= $1 OR created_at <= $2)
              LIMIT $3
           ),
           purged AS (
             UPDATE public.quiz_answers
                SET answer_text = NULL,
                    raw_text_purged_at = $1
              WHERE id IN (SELECT id FROM batch)
             RETURNING 1
           )
           SELECT count(*) AS count FROM purged`,
          [now, rawCutoff, batchSize],
        );
        const count =
          Array.isArray(quizRes) && quizRes[0]?.count !== undefined
            ? Number(quizRes[0].count)
            : 0;
        rawAnswersPurged += count;
        if (count < batchSize) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(`Error purging raw quiz answers: ${String(err)}`);
      throw err;
    }

    // 3. Physical Purge Step 2: Delete expired mentor messages in batches
    let messagesDeleted = 0;
    try {
      while (true) {
        const msgRes = await this.database.query<
          Array<{ count: string | number }>
        >(
          `WITH batch AS (
             SELECT id
               FROM public.messages
              WHERE expires_at <= $1 OR created_at <= $2
              LIMIT $3
           ),
           deleted AS (
             DELETE FROM public.messages
              WHERE id IN (SELECT id FROM batch)
             RETURNING 1
           )
           SELECT count(*) AS count FROM deleted`,
          [now, messageCutoff, batchSize],
        );
        const count =
          Array.isArray(msgRes) && msgRes[0]?.count !== undefined
            ? Number(msgRes[0].count)
            : 0;
        messagesDeleted += count;
        if (count < batchSize) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(`Error purging expired messages: ${String(err)}`);
      throw err;
    }

    // 4. Physical Purge Step 3: Delete expired AI operational requests (30d ceiling) in batches
    let aiRequestsDeleted = 0;
    try {
      while (true) {
        const aiRes = await this.database.query<
          Array<{ count: string | number }>
        >(
          `WITH batch AS (
             SELECT id
               FROM public.ai_requests
              WHERE created_at <= $1
              LIMIT $2
           ),
           deleted AS (
             DELETE FROM public.ai_requests
              WHERE id IN (SELECT id FROM batch)
             RETURNING 1
           )
           SELECT count(*) AS count FROM deleted`,
          [aiCutoff, batchSize],
        );
        const count =
          Array.isArray(aiRes) && aiRes[0]?.count !== undefined
            ? Number(aiRes[0].count)
            : 0;
        aiRequestsDeleted += count;
        if (count < batchSize) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(`Error purging expired AI requests: ${String(err)}`);
      throw err;
    }

    // 5. Physical Purge Step 4: Delete TTL-expired AI context memory in batches
    let aiContextRecordsDeleted = 0;
    try {
      while (true) {
        const ctxRes = await this.database.query<
          Array<{ count: string | number }>
        >(
          `WITH batch AS (
             SELECT id
               FROM public.ai_context_records
              WHERE valid_until < $1
              LIMIT $2
           ),
           deleted AS (
             DELETE FROM public.ai_context_records
              WHERE id IN (SELECT id FROM batch)
             RETURNING 1
           )
           SELECT count(*) AS count FROM deleted`,
          [now, batchSize],
        );
        const count =
          Array.isArray(ctxRes) && ctxRes[0]?.count !== undefined
            ? Number(ctxRes[0].count)
            : 0;
        aiContextRecordsDeleted += count;
        if (count < batchSize) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        `Error purging expired AI context records: ${String(err)}`,
      );
      throw err;
    }

    // 6. Physical Purge Step 5: Scrub expired deletion request provider outbox entries in batches
    let outboxExpiredCount = 0;
    try {
      while (true) {
        const outboxRes = await this.database.query<
          Array<{ count: string | number }>
        >(
          `WITH batch AS (
             SELECT id
               FROM public.account_deletion_requests
              WHERE provider_cleanup_expires_at IS NOT NULL
                AND provider_cleanup_expires_at <= $1
                AND provider_cleanup != '[]'::jsonb
              LIMIT $2
           ),
           updated AS (
             UPDATE public.account_deletion_requests
                SET provider_cleanup = '[]'::jsonb,
                    provider_cleanup_expires_at = NULL,
                    updated_at = clock_timestamp()
              WHERE id IN (SELECT id FROM batch)
             RETURNING 1
           )
           SELECT count(*) AS count FROM updated`,
          [now, batchSize],
        );
        const count =
          Array.isArray(outboxRes) && outboxRes[0]?.count !== undefined
            ? Number(outboxRes[0].count)
            : 0;
        outboxExpiredCount += count;
        if (count < batchSize) {
          break;
        }
      }
    } catch (err) {
      this.logger.error(
        `Error scrubbing expired provider outbox entries: ${String(err)}`,
      );
      throw err;
    }

    const durationMs = Date.now() - startTime;

    return {
      rawAnswersPurged,
      messagesDeleted,
      aiRequestsDeleted,
      aiContextRecordsDeleted,
      outboxExpiredCount,
      oldestRetainedTimestamp: oldestTimestamp,
      purgeLagMs,
      durationMs,
    };
  }
}
