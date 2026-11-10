import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';

/**
 * Valid workflow state for a bounded provider cleanup outbox entry (`R35`).
 */
export type ProviderCleanupState = 'pending' | 'failed';

/**
 * Shape of a single bounded provider cleanup outbox entry stored in
 * `public.account_deletion_requests.provider_cleanup` JSONB array (`R35`).
 */
export interface ProviderCleanupEntry {
  /** Identifier of the external provider (e.g. `'google'`, `'facebook'`, `'supabase'`). */
  provider_key: string;
  /** Provider identifier alias for backward compatibility. */
  provider?: string;
  /** AEAD-encrypted provider object reference using managed server key and request_id AAD. Omitted/empty for 'failed' tombstones. */
  encrypted_object_ref?: string;
  /** Alias for encrypted_object_ref. */
  encrypted_ref?: string;
  /** Number of retry attempts executed so far (0..5). */
  attempts: number;
  /** ISO-8601 timestamp for the next scheduled retry attempt. */
  next_retry_at?: string;
  /** Workflow status; `'pending' | 'failed'`. */
  state: ProviderCleanupState;
}

/**
 * Result metrics returned by `ProviderCleanupService.processOutboxBatch`.
 */
export interface OutboxBatchResult {
  /** Number of account deletion requests processed in this batch. */
  processedRequests: number;
  /** Number of individual provider cleanup entries attempted. */
  entriesAttempted: number;
  /** Number of provider cleanup entries successfully accepted by the provider. */
  entriesSucceeded: number;
  /** Number of provider cleanup entries that failed and were retried or exhausted. */
  entriesFailed: number;
  /** Number of provider cleanup entries scrubbed due to the 30-day deadline. */
  entriesExpired: number;
}

/**
 * Fallback 32-byte key used only in development and test environments when
 * `PROVIDER_CLEANUP_ENCRYPTION_KEY` is not provided.
 */
const TEST_FALLBACK_ENCRYPTION_KEY = Buffer.from(
  '01234567890123456789012345678901',
  'utf8',
);

/** Pattern matching AEAD ciphertext output `v1:<ivHex>:<tagHex>:<cipherHex>`. */
const AEAD_CIPHERTEXT_PATTERN = /^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

/** Maximum allowed attempts before an outbox entry is considered exhausted (`R35`). */
export const MAX_OUTBOX_ATTEMPTS = 5;

/** Maximum call timeout for external provider requests in milliseconds (`R35`). */
export const PROVIDER_CALL_TIMEOUT_MS = 10_000;

/** Maximum duration in milliseconds for provider cleanup outbox expiry (30 days per `R35`). */
export const OUTBOX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Service managing bounded provider cleanup outbox encryption, persistence, and retry execution (`R35`).
 *
 * Implements AEAD managed key encryption with `request_id + provider_key` as authenticated additional data (AAD),
 * enforces the 30-day expiry deadline, dispatches provider deletion calls outside database transactions,
 * and tracks completion so `provider_deletion_requested` transitions strictly when all applicable entries succeed.
 */
@Injectable()
export class ProviderCleanupService {
  private readonly logger = new Logger(ProviderCleanupService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Resolves the 32-byte AEAD encryption key for provider cleanup object references.
   * Fails closed outside explicit `test` and `development` environments.
   *
   * @returns 32-byte Buffer containing the encryption key.
   */
  private getEncryptionKey(): Buffer {
    const rawKey =
      this.config?.get<string>('PROVIDER_CLEANUP_ENCRYPTION_KEY') ??
      process.env.PROVIDER_CLEANUP_ENCRYPTION_KEY;

    const nodeEnv = (
      this.config?.get<string>('NODE_ENV') ?? process.env.NODE_ENV
    )?.trim();

    if (
      rawKey !== undefined &&
      rawKey !== null &&
      String(rawKey).trim().length > 0
    ) {
      const keyStr = String(rawKey).trim();
      // Handle hex-encoded 64-character strings or raw 32-byte UTF-8 strings
      if (keyStr.length === 64 && /^[0-9a-f]+$/i.test(keyStr)) {
        return Buffer.from(keyStr, 'hex');
      }
      const keyBuffer = Buffer.from(keyStr, 'utf8');
      if (keyBuffer.byteLength >= 32) {
        return keyBuffer.subarray(0, 32);
      }
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Provider cleanup encryption key must be at least 32 bytes',
      );
    }

    if (nodeEnv !== 'test' && nodeEnv !== 'development') {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Provider cleanup encryption key is not configured',
      );
    }

    return TEST_FALLBACK_ENCRYPTION_KEY;
  }

  /**
   * Encrypts a provider object reference using AES-256-GCM with `requestId:providerKey` as AAD.
   *
   * @param requestId - UUID of the `public.account_deletion_requests` row.
   * @param providerKey - Identifier of the external provider (e.g. `'google'`).
   * @param plainObjectRef - Raw provider object reference (e.g. provider subject UUID).
   * @returns Formatted ciphertext string `v1:<ivHex>:<tagHex>:<cipherHex>`.
   */
  encryptObjectRef(
    requestId: string,
    providerKey: string,
    plainObjectRef: string,
  ): string {
    if (!plainObjectRef || typeof plainObjectRef !== 'string') {
      fail(
        400,
        'INVALID_FORMAT',
        'Provider object reference must be a non-empty string',
      );
    }

    const key = this.getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const aad = Buffer.from(`${requestId}:${providerKey}`, 'utf8');
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([
      cipher.update(plainObjectRef, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /**
   * Decrypts an AEAD-encrypted provider object reference using AES-256-GCM and verifies AAD.
   *
   * @param requestId - UUID of the `public.account_deletion_requests` row.
   * @param providerKey - Identifier of the external provider.
   * @param formattedCiphertext - Formatted ciphertext `v1:<ivHex>:<tagHex>:<cipherHex>`.
   * @returns Decrypted plain reference string.
   */
  decryptObjectRef(
    requestId: string,
    providerKey: string,
    formattedCiphertext: string,
  ): string {
    if (!AEAD_CIPHERTEXT_PATTERN.test(formattedCiphertext)) {
      fail(
        400,
        'INVALID_FORMAT',
        'Malformed AEAD ciphertext for provider cleanup reference',
      );
    }

    const parts = formattedCiphertext.split(':');
    const ivHex = parts[1];
    const tagHex = parts[2];
    const cipherHex = parts[3];

    const key = this.getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(cipherHex, 'hex');

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      const aad = Buffer.from(`${requestId}:${providerKey}`, 'utf8');
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      fail(
        400,
        'INVALID_FORMAT',
        'Failed to authenticate provider cleanup reference',
      );
    }
  }

  /**
   * Validates that an outbox entry matches canonical schema, contains zero unknown fields,
   * zero plaintext references, and zero credentials (`R35`).
   * Supports 'pending' retry entries and content-free 'failed' tombstones.
   *
   * @param entry - Raw entry candidate.
   * @returns Validated `ProviderCleanupEntry`.
   */
  validateCleanupEntry(entry: unknown): ProviderCleanupEntry {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(400, 'INVALID_FORMAT', 'Outbox entry must be an object');
    }

    const record = entry as Record<string, unknown>;
    const allowedKeys = new Set([
      'provider_key',
      'provider',
      'encrypted_object_ref',
      'encrypted_ref',
      'attempts',
      'next_retry_at',
      'state',
    ]);

    for (const key of Object.keys(record)) {
      if (!allowedKeys.has(key)) {
        fail(
          400,
          'INVALID_FORMAT',
          `Unknown field in provider cleanup outbox entry: ${key}`,
        );
      }
    }

    const rawProvider = record.provider_key ?? record.provider;
    if (typeof rawProvider !== 'string' || rawProvider.trim().length === 0) {
      fail(400, 'INVALID_FORMAT', 'provider_key must be a non-empty string');
    }
    const providerKey = rawProvider.trim();

    if (
      typeof record.attempts !== 'number' ||
      !Number.isInteger(record.attempts) ||
      record.attempts < 0
    ) {
      fail(400, 'INVALID_FORMAT', 'attempts must be an integer >= 0');
    }

    if (record.state === 'failed') {
      return {
        provider_key: providerKey,
        provider: providerKey,
        attempts: record.attempts,
        state: 'failed',
      };
    }

    if (record.state !== 'pending') {
      fail(400, 'INVALID_FORMAT', 'state must be "pending" or "failed"');
    }

    const rawEncrypted = record.encrypted_object_ref ?? record.encrypted_ref;
    if (
      typeof rawEncrypted !== 'string' ||
      !AEAD_CIPHERTEXT_PATTERN.test(rawEncrypted)
    ) {
      fail(
        400,
        'INVALID_FORMAT',
        'encrypted_object_ref must be valid AEAD ciphertext',
      );
    }

    if (record.attempts > MAX_OUTBOX_ATTEMPTS) {
      fail(
        400,
        'INVALID_FORMAT',
        'attempts must be an integer between 0 and 5 for pending entries',
      );
    }

    if (
      typeof record.next_retry_at !== 'string' ||
      Number.isNaN(Date.parse(record.next_retry_at))
    ) {
      fail(
        400,
        'INVALID_FORMAT',
        'next_retry_at must be a valid ISO-8601 date string',
      );
    }

    return {
      provider_key: providerKey,
      provider: providerKey,
      encrypted_object_ref: rawEncrypted,
      attempts: record.attempts,
      next_retry_at: record.next_retry_at,
      state: 'pending',
    };
  }

  /**
   * Builds bounded outbox entries for user authentication providers before local cascade deletion (`R35`).
   * Deduplicates by provider, excludes email/phone rows, enqueues primary Supabase GoTrue admin user
   * deletion entry using userId, and enforces the 16KB JSONB table constraint (`ck_provider_cleanup`).
   *
   * @param requestId - UUID of the `public.account_deletion_requests` row.
   * @param userIdOrProviders - UUID of auth user or list of provider subjects.
   * @param providersOrNow - Optional list of provider subjects or reference timestamp.
   * @param nowArg - Optional reference execution timestamp.
   * @returns Array of validated `ProviderCleanupEntry` objects.
   */
  buildOutboxEntries(
    requestId: string,
    userIdOrProviders:
      string | Array<{ provider: string; providerSubject: string }>,
    providersOrNow?:
      Array<{ provider: string; providerSubject: string }> | Date,
    nowArg?: Date,
  ): ProviderCleanupEntry[] {
    let userId: string | undefined;
    let rawProviders: Array<{ provider: string; providerSubject: string }> = [];
    let now: Date = new Date();

    if (typeof userIdOrProviders === 'string') {
      userId = userIdOrProviders.trim();
      if (Array.isArray(providersOrNow)) {
        rawProviders = providersOrNow;
      }
      if (nowArg instanceof Date) {
        now = nowArg;
      } else if (providersOrNow instanceof Date) {
        now = providersOrNow;
      }
    } else if (Array.isArray(userIdOrProviders)) {
      rawProviders = userIdOrProviders;
      if (providersOrNow instanceof Date) {
        now = providersOrNow;
      }
    }

    const seenProviders = new Set<string>();
    const entries: ProviderCleanupEntry[] = [];

    // Always enqueue primary Supabase GoTrue admin user deletion entry when userId is provided
    if (userId && userId.length > 0) {
      seenProviders.add('supabase');
      const encryptedSupabaseRef = this.encryptObjectRef(
        requestId,
        'supabase',
        userId,
      );
      entries.push(
        this.validateCleanupEntry({
          provider_key: 'supabase',
          provider: 'supabase',
          encrypted_object_ref: encryptedSupabaseRef,
          attempts: 0,
          next_retry_at: now.toISOString(),
          state: 'pending',
        }),
      );
    }

    for (const item of rawProviders) {
      if (!item.provider || !item.providerSubject) {
        continue;
      }
      const providerKey = item.provider.trim().toLowerCase();
      // Exclude email and phone as they are internal credentials covered by primary supabase entry
      if (providerKey === 'email' || providerKey === 'phone') {
        continue;
      }
      if (seenProviders.has(providerKey)) {
        continue;
      }
      seenProviders.add(providerKey);

      const encryptedRef = this.encryptObjectRef(
        requestId,
        providerKey,
        item.providerSubject,
      );

      const entry: ProviderCleanupEntry = {
        provider_key: providerKey,
        provider: providerKey,
        encrypted_object_ref: encryptedRef,
        attempts: 0,
        next_retry_at: now.toISOString(),
        state: 'pending',
      };

      entries.push(this.validateCleanupEntry(entry));
    }

    const serialized = JSON.stringify(entries);
    if (Buffer.byteLength(serialized, 'utf8') > 16384) {
      fail(
        400,
        'INVALID_FORMAT',
        'Provider cleanup outbox exceeds maximum size of 16384 bytes',
      );
    }

    return entries;
  }

  /**
   * Dispatches a single external provider deletion request with a 10-second timeout (`R35`).
   *
   * @param providerKey - Provider identifier (e.g. `'google'`, `'facebook'`, `'supabase'`).
   * @param decryptedRef - Decrypted provider object reference.
   * @param signal - Optional AbortSignal for cancellation.
   * @returns Promise resolving to `true` if accepted by provider, or `false` on failure.
   */
  async dispatchProviderDeletion(
    providerKey: string,
    decryptedRef: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const timeoutSignal = AbortSignal.timeout(PROVIDER_CALL_TIMEOUT_MS);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    try {
      // For GoTrue / Supabase identity provider deletions:
      if (providerKey === 'supabase' || providerKey === 'gotrue') {
        const rawSupabaseUrl =
          this.config.get<string>('SUPABASE_URL') ?? 'http://127.0.0.1:56321';
        const supabaseUrl = rawSupabaseUrl.replace(/\/$/, '');
        const serviceKey =
          this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ??
          process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!serviceKey || !decryptedRef || !supabaseUrl) {
          this.logger.warn(
            `Supabase admin deletion skipped: missing configuration or reference (serviceKey=${Boolean(
              serviceKey,
            )}, ref=${Boolean(decryptedRef)})`,
          );
          return false;
        }

        const res = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(decryptedRef)}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
            },
            signal: combinedSignal,
          },
        );
        // 200 OK or 404 Not Found (already deleted) are both acceptable completions
        return res.ok || res.status === 404;
      }

      // External providers (Google / Facebook / OAuth):
      // No live external revocation adapter is configured yet. Keep entry pending/retried
      // rather than falsely marking it cleaned up.
      this.logger.warn(
        `External provider cleanup adapter not yet configured for provider: ${providerKey}`,
      );
      return false;
    } catch (error) {
      this.logger.warn(
        `External provider cleanup dispatch failed for provider ${providerKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Processes a bounded batch of pending provider cleanup outbox entries from `public.account_deletion_requests` (`R35`).
   *
   * Serializes worker ownership via optimistic concurrency comparison on write-back (`AND provider_cleanup = $expected::jsonb`),
   * verifies the 30-day deadline, calls external providers outside database transactions, updates retry counters and exponential backoff,
   * and sets `provider_deletion_requested = true` when all applicable entries succeed.
   *
   * @param options - Batch size and current reference time options.
   * @returns Batch processing metrics (`OutboxBatchResult`).
   */
  async processOutboxBatch(
    options: { batchSize?: number; now?: Date } = {},
  ): Promise<OutboxBatchResult> {
    this.getEncryptionKey();

    const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 100));
    const now = options.now ?? new Date();

    const result: OutboxBatchResult = {
      processedRequests: 0,
      entriesAttempted: 0,
      entriesSucceeded: 0,
      entriesFailed: 0,
      entriesExpired: 0,
    };

    // 1. Query candidate rows with pending outbox entries
    const candidateRows = await this.database.query<
      Array<{
        id: string;
        requested_at: Date | string;
        provider_cleanup: unknown;
        provider_cleanup_expires_at: Date | string | null;
        provider_deletion_requested: boolean;
      }>
    >(
      `SELECT id,
              requested_at,
              provider_cleanup,
              provider_cleanup_expires_at,
              provider_deletion_requested
         FROM public.account_deletion_requests
        WHERE provider_cleanup != '[]'::jsonb
          AND (
            EXISTS (
              SELECT 1
                FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(provider_cleanup) = 'array' THEN provider_cleanup ELSE '[]'::jsonb END
                ) AS elem
               WHERE elem->>'state' = 'pending'
                 AND (elem->>'next_retry_at' IS NULL OR (elem->>'next_retry_at')::timestamptz <= $2)
            )
            OR (provider_cleanup_expires_at IS NOT NULL AND provider_cleanup_expires_at <= $2)
            OR requested_at <= $2 - interval '30 days'
          )
          AND status IN ('in_progress', 'completed')
        ORDER BY requested_at ASC
        LIMIT $1`,
      [batchSize, now],
    );

    if (!Array.isArray(candidateRows) || candidateRows.length === 0) {
      return result;
    }

    for (const row of candidateRows) {
      result.processedRequests += 1;
      const previousCleanupJson = JSON.stringify(row.provider_cleanup);
      const requestedAt = new Date(row.requested_at);
      const deadline = new Date(requestedAt.getTime() + OUTBOX_EXPIRY_MS);
      const isPastDeadline = now.getTime() >= deadline.getTime();
      const isPastExpiresAt =
        row.provider_cleanup_expires_at !== null &&
        now.getTime() >= new Date(row.provider_cleanup_expires_at).getTime();

      // Parse and validate existing entries
      const entries: ProviderCleanupEntry[] = [];
      let anyEntryLost = false;
      let normalizedMalformed = false;

      if (Array.isArray(row.provider_cleanup)) {
        for (const rawEntry of row.provider_cleanup) {
          try {
            const validated = this.validateCleanupEntry(rawEntry);
            entries.push(validated);
            if (validated.state === 'failed') {
              anyEntryLost = true;
            }
          } catch {
            // Malformed/dropped entry: persist content-free failed tombstone per Fix 2
            normalizedMalformed = true;
            const rawRec =
              rawEntry && typeof rawEntry === 'object'
                ? (rawEntry as Record<string, unknown>)
                : {};
            const p =
              String(
                rawRec.provider_key ?? rawRec.provider ?? 'unknown',
              ).trim() || 'unknown';
            const att =
              typeof rawRec.attempts === 'number' &&
              Number.isInteger(rawRec.attempts) &&
              rawRec.attempts >= 0
                ? rawRec.attempts
                : MAX_OUTBOX_ATTEMPTS;
            entries.push({
              provider_key: p,
              provider: p,
              state: 'failed',
              attempts: att,
            });
            anyEntryLost = true;
          }
        }
      }

      // If past 30-day deadline, scrub all entries immediately per R35
      if (isPastDeadline || isPastExpiresAt) {
        result.entriesExpired += entries.length;
        await this.database.query(
          `UPDATE public.account_deletion_requests
              SET provider_cleanup = '[]'::jsonb,
                  provider_cleanup_expires_at = NULL,
                  updated_at = clock_timestamp()
            WHERE id = $1::uuid
              AND provider_cleanup != '[]'::jsonb
              AND provider_cleanup = $2::jsonb`,
          [row.id, previousCleanupJson],
        );
        continue;
      }

      // If row has zero pending entries and is not past deadline, skip to prevent tight spin loops
      const hasPendingEntries = entries.some((e) => e.state === 'pending');
      if (!hasPendingEntries) {
        if (normalizedMalformed) {
          await this.database.query(
            `UPDATE public.account_deletion_requests
                SET provider_cleanup = $2::jsonb,
                    updated_at = clock_timestamp()
              WHERE id = $1::uuid
                AND provider_cleanup != '[]'::jsonb
                AND provider_cleanup = $3::jsonb`,
            [row.id, JSON.stringify(entries), previousCleanupJson],
          );
        }
        continue;
      }

      const hadApplicableEntries = entries.length > 0;
      const remainingEntries: ProviderCleanupEntry[] = [];
      let anyEntrySucceeded = false;

      for (const entry of entries) {
        // Skip dispatching entries where entry.state === 'failed'
        if (entry.state === 'failed') {
          anyEntryLost = true;
          remainingEntries.push(entry);
          continue;
        }

        const nextRetry = new Date(entry.next_retry_at!);
        if (nextRetry.getTime() > now.getTime()) {
          // Not yet due for retry; preserve in outbox
          remainingEntries.push(entry);
          continue;
        }

        if (entry.attempts >= MAX_OUTBOX_ATTEMPTS) {
          // Exhausted max 5 attempts; persist content-free failed tombstone per Fix 2
          result.entriesFailed += 1;
          anyEntryLost = true;
          remainingEntries.push({
            provider_key: entry.provider_key,
            provider: entry.provider_key,
            state: 'failed',
            attempts: entry.attempts,
          });
          continue;
        }

        result.entriesAttempted += 1;
        entry.attempts += 1;

        let decryptedRef: string | undefined;
        try {
          decryptedRef = this.decryptObjectRef(
            row.id,
            entry.provider_key,
            entry.encrypted_object_ref ?? entry.encrypted_ref ?? '',
          );
        } catch (decryptErr) {
          if (
            decryptErr instanceof HttpException &&
            decryptErr.getStatus() === 503
          ) {
            throw decryptErr;
          }
          // Corrupted reference; persist content-free failed tombstone per Fix 2
          result.entriesFailed += 1;
          anyEntryLost = true;
          remainingEntries.push({
            provider_key: entry.provider_key,
            provider: entry.provider_key,
            state: 'failed',
            attempts: entry.attempts,
          });
          continue;
        }

        // Call provider outside transaction
        const success = await this.dispatchProviderDeletion(
          entry.provider_key,
          decryptedRef,
        );

        if (success) {
          result.entriesSucceeded += 1;
          anyEntrySucceeded = true;
          // Entry removed upon acceptance
        } else {
          result.entriesFailed += 1;
          if (entry.attempts < MAX_OUTBOX_ATTEMPTS) {
            // Calculate exponential backoff: 2^attempts * 60s (2m, 4m, 8m, 16m, 32m; capped at 24h)
            const backoffMs = Math.min(
              Math.pow(2, entry.attempts) * 60 * 1000,
              24 * 60 * 60 * 1000,
            );
            const calculatedNext = new Date(now.getTime() + backoffMs);
            const cappedNext =
              calculatedNext.getTime() > deadline.getTime()
                ? deadline
                : calculatedNext;
            entry.next_retry_at = cappedNext.toISOString();
            remainingEntries.push(entry);
          } else {
            // Reached MAX_OUTBOX_ATTEMPTS on this attempt: transition to failed tombstone
            anyEntryLost = true;
            remainingEntries.push({
              provider_key: entry.provider_key,
              provider: entry.provider_key,
              state: 'failed',
              attempts: entry.attempts,
            });
          }
        }
      }

      // Determine updated status: true ONLY when all original entries succeeded
      const allEntriesAccepted =
        hadApplicableEntries &&
        remainingEntries.length === 0 &&
        anyEntrySucceeded &&
        !anyEntryLost;

      if (remainingEntries.length === 0) {
        // Outbox is now empty
        await this.database.query(
          `UPDATE public.account_deletion_requests
              SET provider_cleanup = '[]'::jsonb,
                  provider_cleanup_expires_at = NULL,
                  provider_deletion_requested = CASE
                    WHEN $2::boolean = true THEN true
                    ELSE provider_deletion_requested
                  END,
                  updated_at = clock_timestamp()
            WHERE id = $1::uuid
              AND provider_cleanup != '[]'::jsonb
              AND provider_cleanup = $3::jsonb`,
          [row.id, allEntriesAccepted, previousCleanupJson],
        );
      } else {
        // Entries still pending retry
        await this.database.query(
          `UPDATE public.account_deletion_requests
              SET provider_cleanup = $2::jsonb,
                  updated_at = clock_timestamp()
            WHERE id = $1::uuid
              AND provider_cleanup != '[]'::jsonb
              AND provider_cleanup = $3::jsonb`,
          [row.id, JSON.stringify(remainingEntries), previousCleanupJson],
        );
      }
    }

    return result;
  }
}
