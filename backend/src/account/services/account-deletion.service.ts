import { Injectable } from '@nestjs/common';
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

/** Strict UUID matcher for user and request identifiers. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * for the M03-01 Account Deletion Wire Contract, Deletion Receipt Authority & Status Query.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly deletionReceiptService: DeletionReceiptService,
  ) {}

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
   * Validates explicit `"DELETE"` confirmation, inserts a `scheduled` row into
   * `public.account_deletion_requests` (`provider_deletion_requested = false`,
   * `provider_cleanup = '[]'::jsonb`, `provider_cleanup_expires_at = requested_at + interval '30 days'`),
   * translates PostgreSQL `23505` (`uq_account_deletion_one_active`) into `409 DELETION_ALREADY_REQUESTED`,
   * mints a request-scoped `DeletionReceipt` (`R06`), and returns the `202` payload.
   *
   * @param userId - Authenticated caller's `public.users.id` UUID.
   * @param dto - Request payload (`AccountDeletionRequestDTO`).
   * @returns `AccountDeletionStatusDto` including `deletion_receipt` and `receipt_expires_at`.
   */
  async requestDeletion(
    userId: string,
    dto: AccountDeletionRequestInput,
  ): Promise<AccountDeletionStatusDto> {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
      fail(401, 'AUTH_REQUIRED', 'Valid authenticated user ID is required');
    }

    validateAccountDeletionRequest(dto);

    let inserted:
      | {
          row: AccountDeletionRequestRow;
          receipt: { receipt: string; expiresAt: string };
        }
      | undefined;
    try {
      inserted = await this.runWithDatabase(userId, true, async (db) => {
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
             'scheduled',
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
        return {
          row,
          receipt: this.deletionReceiptService.mintReceipt(row.id),
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
      fail(500, 'DATABASE_ERROR', 'Failed to persist account deletion request');
    }

    return this.mapRowToStatusDto(inserted.row, inserted.receipt);
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
}
