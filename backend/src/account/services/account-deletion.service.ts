import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  AccountDeletionRequestInput,
  AccountDeletionStatusDto,
  DeletionRequestStatus,
  validateAccountDeletionRequest,
} from '../dto/account-deletion.dto.js';
import type { AccountDeletionAuthContext } from '../guards/deletion-receipt.guard.js';
import { DeletionReceiptService } from './deletion-receipt.service.js';
import {
  OutboxBatchResult,
  ProviderCleanupService,
} from './provider-cleanup.service.js';
import {
  PrivacyRetentionService,
  PurgeExecutionResult,
} from './privacy-retention.service.js';
import { ReauthVerificationService } from './reauth-verification.service.js';

/** Strict UUID matcher for user and request identifiers. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 24-hour TTL for idempotency key storage (`H-IDEM`, C05 §13.1 / R14). */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum in-memory idempotency entries to prevent unbounded growth. */
const MAX_IDEMPOTENCY_ENTRIES = 1000;

/**
 * Database row shape returned from `public.account_deletion_requests`.
 * Note: `provider_cleanup` is never selected or returned to API callers per `R35`.
 */
interface AccountDeletionRequestRow {
  id: string;
  user_id: string | null;
  status: DeletionRequestStatus;
  requested_at: Date | string;
  completed_at: Date | string | null;
  provider_deletion_requested: boolean;
}

/**
 * Cached idempotency record stored for `H-IDEM` replay / conflict detection.
 */
interface IdempotencyRecord {
  userId: string;
  payloadHash: string;
  response: AccountDeletionStatusDto;
  expiresAt: number;
}

/**
 * Checks whether a database error represents a PostgreSQL unique constraint violation (`23505`).
 */
function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  return err.code === '23505' || err.driverError?.code === '23505';
}

/**
 * Normalizes a Date or string database timestamp into an ISO-8601 string.
 */
function toIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/**
 * Service implementing `EP-X01` (`requestDeletion`) and `EP-X02` (`getCurrentStatus`)
 * for M03-02 Account Deletion: Re-Authentication, Atomic Cascade Execution & Tombstone Preservation (`R05`, `R06`).
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private readonly idempotencyStore = new Map<string, IdempotencyRecord>();
  private readonly inFlightRequests = new Set<string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly deletionReceiptService: DeletionReceiptService,
    private readonly reauthVerificationService: ReauthVerificationService,
    private readonly providerCleanupService?: ProviderCleanupService,
    private readonly privacyRetentionService?: PrivacyRetentionService,
  ) {}

  /**
   * Prunes expired entries from the in-memory idempotency cache and enforces
   * `MAX_IDEMPOTENCY_ENTRIES` capacity via FIFO eviction.
   *
   * When `reserveSlot = true` (write path), prunes down to `MAX_IDEMPOTENCY_ENTRIES - 1`
   * so the subsequent `set(...)` will not exceed the maximum capacity.
   * When `reserveSlot = false` (read path), prunes down to `MAX_IDEMPOTENCY_ENTRIES`
   * so reading when exactly at capacity never evicts live entries.
   */
  private pruneExpiredIdempotencyEntries(
    now: number = Date.now(),
    reserveSlot = false,
  ): void {
    for (const [key, record] of this.idempotencyStore.entries()) {
      if (record.expiresAt <= now) {
        this.idempotencyStore.delete(key);
      }
    }
    const limit = reserveSlot
      ? MAX_IDEMPOTENCY_ENTRIES - 1
      : MAX_IDEMPOTENCY_ENTRIES;
    for (const key of this.idempotencyStore.keys()) {
      if (this.idempotencyStore.size <= limit) {
        break;
      }
      this.idempotencyStore.delete(key);
    }
  }

  /**
   * Computes a deterministic SHA-256 hash of the canonical request payload for idempotency checking.
   */
  private computePayloadHash(dto: AccountDeletionRequestInput): string {
    const canonical = {
      confirmation: dto.confirmation ?? '',
      password: dto.password ?? '',
      reauth_token: dto.reauth_token ?? '',
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /**
   * Executes a database operation inside a `service_role` transaction with `active = false`
   * (preserving `AZ-SUSP` access for suspended accounts), or falls back to `database.query`
   * when `transaction` is omitted in lightweight unit test mocks.
   */
  private async runWithDatabase<T>(
    userId: string | null,
    foreground: boolean,
    fn: (runner: { query: DatabaseService['query'] }) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        userId,
        (db) => fn(db),
        false,
        foreground,
      );
    }
    return fn(this.database);
  }

  /**
   * Maps a database row from `public.account_deletion_requests` to `AccountDeletionStatusDto`.
   */
  private mapRowToStatusDto(
    row: AccountDeletionRequestRow,
    receipt?: { receipt: string; expiresAt: string },
  ): AccountDeletionStatusDto {
    const dto: AccountDeletionStatusDto = {
      id: row.id,
      status: row.status,
      requested_at: toIsoTimestamp(row.requested_at),
      completed_at:
        row.completed_at === null || row.completed_at === undefined
          ? null
          : toIsoTimestamp(row.completed_at),
      provider_deletion_requested: Boolean(row.provider_deletion_requested),
    };

    if (receipt) {
      dto.deletion_receipt = receipt.receipt;
      dto.receipt_expires_at = receipt.expiresAt;
    }

    return dto;
  }

  /**
   * `EP-X01` (`POST /api/v1/account/deletion-requests`):
   * 1. Validates explicit `"DELETE"` confirmation and mutually exclusive credentials.
   * 2. Enforces caller-scoped idempotency key reuse rules (`409 IDEMPOTENCY_KEY_REUSED` or cached response replay).
   * 3. Verifies live re-authentication via password or OAuth `reauth_token` (`401 REAUTH_REQUIRED`).
   * 4. Executes atomic cascade inside a single transaction:
   *    - Inserts `public.account_deletion_requests` row (`status = 'in_progress'`).
   *    - Revokes all approved sessions in `private.approved_auth_sessions`.
   *    - Revokes GoTrue auth refresh tokens & sessions (fail-closed atomic transaction).
   *    - Deletes user from `public.users`, triggering `trg_users_complete_deletion` which transitions
   *      the request to `status = 'completed'` and `user_id = NULL` (`R05`).
   *    - Strictly validates completed tombstone row from DB (never fabricating synthetic status).
   *    - Mints a 24-hour `DeletionReceipt` (`R06`).
   * 5. Returns `202 Accepted` with completed status and receipt.
   *
   * @param userId - Authenticated caller's `public.users.id` UUID.
   * @param dto - Request payload (`AccountDeletionRequestDTO`).
   * @param idempotencyKey - Optional `Idempotency-Key` header (`H-IDEM`).
   * @returns `AccountDeletionStatusDto` including `deletion_receipt` and `receipt_expires_at`.
   */
  async requestDeletion(
    userId: string,
    dto: AccountDeletionRequestInput,
    idempotencyKey?: string,
  ): Promise<AccountDeletionStatusDto> {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }

    const validatedDto = validateAccountDeletionRequest(dto);

    // Prune expired idempotency entries on read (reserveSlot = false)
    this.pruneExpiredIdempotencyEntries(Date.now(), false);

    // 1. Idempotency Key Check (strictly scoped by caller: ${userId}:${idempotencyKey})
    let payloadHash: string | undefined;
    const cacheKey = idempotencyKey ? `${userId}:${idempotencyKey}` : undefined;
    if (cacheKey) {
      payloadHash = this.computePayloadHash(validatedDto);
      const cached = this.idempotencyStore.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.payloadHash === payloadHash) {
          return cached.response;
        }
        fail(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key reused with different request payload',
        );
      }
    }

    // Guard concurrent in-flight requests for the same caller
    if (this.inFlightRequests.has(userId)) {
      fail(
        409,
        'DELETION_ALREADY_REQUESTED',
        'An active account deletion request is already in progress',
      );
    }
    this.inFlightRequests.add(userId);

    try {
      // 2. Live Re-Authentication Verification (GoTrue / identity provider)
      await this.reauthVerificationService.verifyReauthentication(
        userId,
        {
          password: validatedDto.password,
          reauth_token: validatedDto.reauth_token,
        },
        this.database,
      );

      // 3. Atomic Database Cascade Transaction (R05)
      let inserted:
        | {
            row: AccountDeletionRequestRow;
            receipt: { receipt: string; expiresAt: string };
          }
        | undefined;

      try {
        inserted = await this.runWithDatabase(userId, false, async (db) => {
          // 3a. Insert active account deletion request row
          const rows = await db.query<AccountDeletionRequestRow[]>(
            `INSERT INTO public.account_deletion_requests (
               user_id,
               status,
               provider_deletion_requested,
               requested_at,
               provider_cleanup,
               provider_cleanup_expires_at
             )
             VALUES (
               $1::uuid,
               'in_progress',
               false,
               now(),
               '[]'::jsonb,
               now() + interval '30 days'
             )
             RETURNING id,
                       user_id,
                       status,
                       requested_at,
                       completed_at,
                       provider_deletion_requested`,
            [userId],
          );
          const row = Array.isArray(rows) ? rows[0] : undefined;
          if (!row) {
            fail(
              500,
              'DATABASE_ERROR',
              'Failed to persist account deletion request',
            );
          }

          // 3b. Query user_auth_providers and populate bounded provider cleanup outbox (R35)
          if (this.providerCleanupService) {
            try {
              const providerRows = await db.query<
                Array<{ provider: string; provider_subject: string }>
              >(
                `SELECT provider, provider_subject
                   FROM public.user_auth_providers
                  WHERE user_id = $1::uuid`,
                [userId],
              );
              if (Array.isArray(providerRows) && providerRows.length > 0) {
                const outboxEntries =
                  this.providerCleanupService.buildOutboxEntries(
                    row.id,
                    userId,
                    providerRows.map((p) => ({
                      provider: p.provider,
                      providerSubject: p.provider_subject,
                    })),
                  );
                if (outboxEntries.length > 0) {
                  await db.query(
                    `UPDATE public.account_deletion_requests
                        SET provider_cleanup = $2::jsonb,
                            provider_cleanup_expires_at = now() + interval '30 days'
                      WHERE id = $1::uuid`,
                    [row.id, JSON.stringify(outboxEntries)],
                  );
                }
              }
            } catch (outboxError) {
              this.logger.error(
                `Failed to build or persist provider cleanup outbox for user ${userId}`,
                outboxError,
              );
              throw outboxError;
            }
          }

          // 3c. Revoke all approved sessions in DB
          await db.query(
            `UPDATE private.approved_auth_sessions
                SET revoked_at = clock_timestamp(),
                    updated_at = clock_timestamp()
              WHERE user_id = $1::uuid
                AND revoked_at IS NULL`,
            [userId],
          );

          // 3d. Revoke GoTrue auth refresh tokens & sessions (fail-closed atomic transaction)
          await db.query(
            `UPDATE auth.refresh_tokens
                SET revoked = true,
                    updated_at = clock_timestamp()
              WHERE user_id = $1::text
                AND COALESCE(revoked, false) = false`,
            [userId],
          );
          await db.query(`DELETE FROM auth.sessions WHERE user_id = $1::uuid`, [
            userId,
          ]);

          // 3d. Delete user from public.users (triggers trg_users_complete_deletion BEFORE DELETE)
          await db.query(`DELETE FROM public.users WHERE id = $1::uuid`, [
            userId,
          ]);

          // 3e. Select and strictly validate completed tombstone row (never fabricated in production)
          const tombstoneRows = await db.query<AccountDeletionRequestRow[]>(
            `SELECT id,
                    user_id,
                    status,
                    requested_at,
                    completed_at,
                    provider_deletion_requested
               FROM public.account_deletion_requests
              WHERE id = $1::uuid
              LIMIT 1`,
            [row.id],
          );
          const tombstoneRow = Array.isArray(tombstoneRows)
            ? tombstoneRows[0]
            : undefined;

          if (
            !tombstoneRow ||
            tombstoneRow.status !== 'completed' ||
            tombstoneRow.user_id !== null ||
            !tombstoneRow.completed_at
          ) {
            fail(
              500,
              'DATABASE_ERROR',
              'Account deletion cascade failed to achieve completed tombstone state',
            );
          }

          return {
            row: tombstoneRow,
            receipt: this.deletionReceiptService.mintReceipt(tombstoneRow.id),
          };
        });
      } catch (error) {
        if (isPostgresUniqueViolation(error)) {
          fail(
            409,
            'DELETION_ALREADY_REQUESTED',
            'An active account deletion request already exists',
          );
        }
        throw error;
      }

      if (!inserted) {
        fail(
          500,
          'DATABASE_ERROR',
          'Failed to persist account deletion request',
        );
      }

      const resultDto = this.mapRowToStatusDto(inserted.row, inserted.receipt);

      // 4. Cache response under caller-scoped Idempotency-Key if provided (reserveSlot = true on write)
      if (cacheKey && payloadHash) {
        this.pruneExpiredIdempotencyEntries(Date.now(), true);
        this.idempotencyStore.set(cacheKey, {
          userId,
          payloadHash,
          response: resultDto,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
      }

      return resultDto;
    } finally {
      this.inFlightRequests.delete(userId);
    }
  }

  /**
   * `EP-X02` (`GET /api/v1/account/deletion-requests/current`):
   * Queries the current deletion request status either by `id = request_id` when authenticated
   * via `DeletionReceipt` (returning the row even when `user_id IS NULL` for completed tombstones)
   * or by `user_id` (latest request) when authenticated via Bearer JWT.
   *
   * Throws `404 DELETION_REQUEST_NOT_FOUND` when no matching row exists.
   *
   * @param authContext - Resolved authentication context from `DeletionReceiptGuard`.
   * @returns `AccountDeletionStatusDto` without receipt fields.
   */
  async getCurrentStatus(
    authContext: AccountDeletionAuthContext,
  ): Promise<AccountDeletionStatusDto> {
    if (!authContext || typeof authContext !== 'object') {
      fail(401, 'AUTH_REQUIRED', 'Authentication context is required');
    }

    if (authContext.mode === 'receipt') {
      if (
        typeof authContext.requestId !== 'string' ||
        !UUID_PATTERN.test(authContext.requestId)
      ) {
        fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt request_id');
      }

      const row = await this.runWithDatabase(null, false, async (db) => {
        const rows = await db.query<AccountDeletionRequestRow[]>(
          `SELECT id,
                  user_id,
                  status,
                  requested_at,
                  completed_at,
                  provider_deletion_requested
             FROM public.account_deletion_requests
            WHERE id = $1::uuid
            LIMIT 1`,
          [authContext.requestId],
        );
        return Array.isArray(rows) ? rows[0] : undefined;
      });

      if (!row) {
        fail(
          404,
          'DELETION_REQUEST_NOT_FOUND',
          'Account deletion request not found',
        );
      }

      return this.mapRowToStatusDto(row);
    }

    if (
      typeof authContext.userId !== 'string' ||
      !UUID_PATTERN.test(authContext.userId)
    ) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }

    const row = await this.runWithDatabase(
      authContext.userId,
      false,
      async (db) => {
        const rows = await db.query<AccountDeletionRequestRow[]>(
          `SELECT id,
                  user_id,
                  status,
                  requested_at,
                  completed_at,
                  provider_deletion_requested
             FROM public.account_deletion_requests
            WHERE user_id = $1::uuid
            ORDER BY requested_at DESC, created_at DESC
            LIMIT 1`,
          [authContext.userId],
        );
        return Array.isArray(rows) ? rows[0] : undefined;
      },
    );

    if (!row) {
      fail(
        404,
        'DELETION_REQUEST_NOT_FOUND',
        'Account deletion request not found',
      );
    }

    return this.mapRowToStatusDto(row);
  }

  /**
   * Processes a bounded batch of pending provider cleanup outbox entries (`R35`).
   *
   * @param batchSize - Maximum number of deletion requests to process.
   * @returns Outbox batch processing metrics (`OutboxBatchResult`).
   */
  async processProviderCleanupOutbox(
    batchSize?: number,
  ): Promise<OutboxBatchResult> {
    if (!this.providerCleanupService) {
      return {
        processedRequests: 0,
        entriesAttempted: 0,
        entriesSucceeded: 0,
        entriesFailed: 0,
        entriesExpired: 0,
      };
    }
    return this.providerCleanupService.processOutboxBatch({ batchSize });
  }

  /**
   * Executes the privacy and data retention physical purge runner (`R08`, `R09`, PRD §52).
   *
   * @param options - Execution options including reference time and batch size.
   * @returns Structured `PurgeExecutionResult`.
   */
  async executePrivacyRetentionPurge(options?: {
    now?: Date;
    batchSize?: number;
  }): Promise<PurgeExecutionResult> {
    if (!this.privacyRetentionService) {
      return {
        rawAnswersPurged: 0,
        messagesDeleted: 0,
        aiRequestsDeleted: 0,
        aiContextRecordsDeleted: 0,
        outboxExpiredCount: 0,
        oldestRetainedTimestamp: null,
        purgeLagMs: 0,
        durationMs: 0,
      };
    }
    return this.privacyRetentionService.purgeExpiredData(options);
  }
}
