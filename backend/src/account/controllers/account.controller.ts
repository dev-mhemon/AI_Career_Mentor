import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import type {
  AccountDeletionRequestInput,
  AccountDeletionStatusDto,
} from '../dto/account-deletion.dto.js';
import {
  AllowDeletionReceipt,
  DeletionReceiptGuard,
} from '../guards/deletion-receipt.guard.js';
import type { AccountDeletionRequest } from '../guards/deletion-receipt.guard.js';
import { AccountDeletionService } from '../services/account-deletion.service.js';

/** Strict UUID matcher for optional `Idempotency-Key` header validation (`H-IDEM`). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controller exposing C05 §14.2 Account Deletion endpoints (`EP-X01` and `EP-X02`).
 *
 * Uses `@Policy({ public: true, allowSuspended: true })` so the global `SupabaseAuthGuard` and
 * `AccessGuard` delegate authentication and `AZ-SUSP` / `DeletionReceipt` / `private.approved_auth_sessions`
 * enforcement to `DeletionReceiptGuard`.
 */
@Controller('account/deletion-requests')
@UseGuards(DeletionReceiptGuard)
@Policy({ public: true, allowSuspended: true })
export class AccountController {
  constructor(
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  /**
   * `EP-X01` (`POST /api/v1/account/deletion-requests`):
   * Schedules an account deletion request for an authenticated (`active` or `suspended`) user
   * after validating explicit `"DELETE"` confirmation, and returns a signed `DeletionReceipt` (`R06`).
   *
   * @param req - Authenticated request with `deletionAuth` / `user`.
   * @param dto - Request payload (`AccountDeletionRequestDTO`).
   * @returns `202 Accepted` with `AccountDeletionStatusDto`.
   */
  @Post()
  @HttpCode(202)
  async requestDeletion(
    @Req() req: AccountDeletionRequest,
    @Body() dto: AccountDeletionRequestInput,
  ): Promise<AccountDeletionStatusDto> {
    const rawIdempotencyKey = req?.headers?.['idempotency-key'];
    let idempotencyKey: string | undefined;
    if (rawIdempotencyKey !== undefined) {
      if (
        typeof rawIdempotencyKey !== 'string' ||
        !UUID_PATTERN.test(rawIdempotencyKey.trim())
      ) {
        fail(
          400,
          'INVALID_FORMAT',
          'Idempotency-Key header must be a valid UUID',
          [
            {
              field: 'Idempotency-Key',
              code: 'INVALID_FORMAT',
              message: 'Idempotency-Key must be a valid UUID',
            },
          ],
        );
      }
      idempotencyKey = rawIdempotencyKey.trim();
    }

    const userId =
      req?.deletionAuth?.mode === 'jwt'
        ? req.deletionAuth.userId
        : req?.user?.sub;
    if (!userId) {
      fail(401, 'AUTH_REQUIRED', 'Application account required');
    }
    return this.accountDeletionService.requestDeletion(
      userId,
      dto,
      idempotencyKey,
    );
  }

  /**
   * `EP-X02` (`GET /api/v1/account/deletion-requests/current`):
   * Returns the current deletion request status authenticated via either `Authorization: Bearer <jwt>`
   * (`AZ-SUSP`) or `Authorization: DeletionReceipt <token>` (`R06`, supporting completed `user_id = NULL`
   * tombstones).
   *
   * @param req - Request carrying `deletionAuth` resolved by `DeletionReceiptGuard` or `user`.
   * @returns `200 OK` with `AccountDeletionStatusDto`.
   */
  @Get('current')
  @HttpCode(200)
  @AllowDeletionReceipt()
  async getCurrentStatus(
    @Req() req: AccountDeletionRequest,
  ): Promise<AccountDeletionStatusDto> {
    if (req?.deletionAuth) {
      return this.accountDeletionService.getCurrentStatus(req.deletionAuth);
    }
    if (req?.user?.sub) {
      return this.accountDeletionService.getCurrentStatus({
        mode: 'jwt',
        userId: req.user.sub,
        sessionId: req.user.sessionId ?? '',
        status: req.user.status === 'suspended' ? 'suspended' : 'active',
      });
    }
    fail(401, 'AUTH_REQUIRED', 'Authentication is required');
  }
}
