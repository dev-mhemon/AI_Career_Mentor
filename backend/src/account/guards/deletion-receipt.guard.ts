import {
  CanActivate,
  ExecutionContext,
  Injectable,
  OnModuleInit,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SupabaseAuthGuard } from '../../auth/guards/supabase-auth.guard.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  DeletionReceiptClaims,
  DeletionReceiptService,
} from '../services/deletion-receipt.service.js';

/** Metadata key indicating that a route accepts `Authorization: DeletionReceipt <token>` (`EP-X02`). */
export const ALLOW_DELETION_RECEIPT_KEY = 'allow-deletion-receipt';

/**
 * Route decorator enabling `Authorization: DeletionReceipt <token>` authentication on `EP-X02` (`C05 R06`).
 */
export const AllowDeletionReceipt = () =>
  SetMetadata(ALLOW_DELETION_RECEIPT_KEY, true);

/** UUID validation regex for JWT `sub` and `session_id` claims. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolved authentication context attached to the request by `DeletionReceiptGuard`.
 */
export type AccountDeletionAuthContext =
  | {
      mode: 'receipt';
      requestId: string;
    }
  | {
      mode: 'jwt';
      userId: string;
      sessionId: string;
      status: 'active' | 'suspended';
    };

/**
 * Extended Express Request carrying resolved account deletion authentication metadata.
 */
export interface AccountDeletionRequest extends Request {
  user?: {
    id?: string;
    sub?: string;
    sessionId?: string;
    session_id?: string;
    status?: string;
    role?: string;
  };
  deletionAuth?: AccountDeletionAuthContext;
  deletionReceipt?: DeletionReceiptClaims;
}

/**
 * Guard enforcing `AZ-SUSP` and `C05 R06` authentication rules for `EP-X01` and `EP-X02`:
 * - Delegates all `Authorization: Bearer <jwt>` cryptographic verification to `SupabaseAuthGuard`
 *   (fail-closed at bootstrap if `SupabaseAuthGuard` is absent; never decodes unverified JWT payloads).
 * - Permits both `active` and `suspended` accounts (`AZ-SUSP`) while requiring `verified_contact === true`
 *   and an active approved session in `private.approved_auth_sessions` for Bearer JWT callers.
 * - On routes decorated with `@AllowDeletionReceipt()` (`EP-X02`), accepts EITHER
 *   `Authorization: DeletionReceipt <token>` (bypassing user/session lookup so completed
 *   `user_id = NULL` tombstones remain queryable per `R06`) OR `Authorization: Bearer <jwt>`.
 * - Rejects missing, malformed, or unsupported authorization schemes with `401`.
 */
@Injectable()
export class DeletionReceiptGuard implements CanActivate, OnModuleInit {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
    private readonly deletionReceiptService: DeletionReceiptService,
    private readonly supabaseAuthGuard: SupabaseAuthGuard,
  ) {
    if (!this.supabaseAuthGuard) {
      throw new Error(
        'SupabaseAuthGuard is required by DeletionReceiptGuard to verify Bearer JWT tokens',
      );
    }
  }

  /**
   * Verifies at module initialization that `SupabaseAuthGuard` is wired.
   */
  onModuleInit(): void {
    if (!this.supabaseAuthGuard) {
      throw new Error(
        'SupabaseAuthGuard is required by DeletionReceiptGuard to verify Bearer JWT tokens',
      );
    }
  }

  /**
   * Executes a read-only database query inside a non-suspending `service_role` transaction
   * when `DatabaseService.transaction` is available, falling back to `database.query` in unit test mocks.
   */
  private async runReadQuery<T>(
    userId: string,
    fn: (runner: { query: DatabaseService['query'] }) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(userId, (db) => fn(db), false, false);
    }
    return fn(this.database);
  }

  /**
   * Validates the route caller via `DeletionReceipt` (on `EP-X02`) or `Bearer` JWT (`AZ-SUSP`).
   *
   * @param context - NestJS execution context.
   * @returns `true` if authorized; throws `ContractException` (`401` or `403`) otherwise.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowReceipt = Boolean(
      this.reflector.getAllAndOverride<boolean>(ALLOW_DELETION_RECEIPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );

    const req = context.switchToHttp().getRequest<AccountDeletionRequest>();
    const rawHeader = req?.headers?.authorization;

    if (rawHeader === undefined) {
      fail(401, 'AUTH_REQUIRED', 'Authentication is required');
    }

    if (typeof rawHeader !== 'string' || rawHeader.trim().length === 0) {
      fail(401, 'INVALID_TOKEN', 'Malformed Authorization header');
    }

    const trimmed = rawHeader.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      fail(401, 'INVALID_TOKEN', 'Malformed Authorization header');
    }

    const [scheme, token] = parts;
    const normalizedScheme = scheme.toLowerCase();

    if (normalizedScheme === 'deletionreceipt') {
      if (!allowReceipt) {
        fail(
          401,
          'INVALID_TOKEN',
          'DeletionReceipt authorization is only valid on the deletion status endpoint',
        );
      }
      const claims = this.deletionReceiptService.verifyReceipt(token);
      req.deletionReceipt = claims;
      req.deletionAuth = {
        mode: 'receipt',
        requestId: claims.request_id,
      };
      return true;
    }

    if (normalizedScheme !== 'bearer') {
      fail(401, 'INVALID_TOKEN', 'Unsupported authorization scheme');
    }

    const bearerContext = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => context.switchToHttp(),
      getArgs: () => context.getArgs?.() ?? [],
      getArgByIndex: (index: number) => context.getArgByIndex?.(index),
      switchToRpc: () => context.switchToRpc?.(),
      switchToWs: () => context.switchToWs?.(),
      getType: () => context.getType?.() ?? 'http',
    } as unknown as ExecutionContext;

    const activated = await this.supabaseAuthGuard.canActivate(bearerContext);
    if (!activated) {
      fail(401, 'INVALID_TOKEN', 'A valid Auth session is required');
    }

    const sub = req.user?.sub ?? req.user?.id;
    const sessionId = req.user?.sessionId ?? req.user?.session_id;
    if (
      typeof sub !== 'string' ||
      !UUID_PATTERN.test(sub) ||
      typeof sessionId !== 'string' ||
      !UUID_PATTERN.test(sessionId)
    ) {
      fail(401, 'INVALID_TOKEN', 'Invalid session identity');
    }

    return this.runReadQuery(sub, async (db) => {
      const rows = await db.query(
        `SELECT u.id,
                u.status,
                u.verified_contact,
                EXISTS (
                  SELECT 1
                    FROM private.approved_auth_sessions a
                   WHERE a.user_id = u.id
                     AND a.session_id = $2::uuid
                     AND a.revoked_at IS NULL
                     AND a.expires_at > now()
                ) AS session_approved
           FROM public.users u
          WHERE u.id = $1::uuid`,
        [sub, sessionId],
      );

      const userRow = Array.isArray(rows) ? rows[0] : undefined;
      if (!userRow) {
        fail(401, 'AUTH_REQUIRED', 'Application account required');
      }

      if (userRow.status !== 'active' && userRow.status !== 'suspended') {
        fail(403, 'ACCOUNT_SUSPENDED', 'Account status is not permitted');
      }

      const isSessionApproved = Boolean(
        userRow.session_approved ??
        userRow.unrevoked_session_approved ??
        userRow.approved,
      );
      if (!isSessionApproved) {
        fail(
          401,
          'AUTH_REQUIRED',
          'Approved authentication session is required',
        );
      }

      if (userRow.verified_contact !== true) {
        fail(
          403,
          'VERIFIED_CONTACT_REQUIRED',
          'Verified contact is required for account deletion operations',
        );
      }

      req.user = {
        ...req.user,
        sub,
        sessionId,
        status: userRow.status,
      };
      req.deletionAuth = {
        mode: 'jwt',
        userId: sub,
        sessionId,
        status: userRow.status,
      };

      return true;
    });
  }
}
