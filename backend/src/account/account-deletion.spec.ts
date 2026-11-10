import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard.js';
import { DatabaseService } from '../auth/services/database.service.js';
import { fail } from '../common/http.js';
import { AccountModule } from './account.module.js';
import { AccountController } from './controllers/account.controller.js';
import {
  AccountDeletionRequestDto,
  validateAccountDeletionRequest,
} from './dto/account-deletion.dto.js';
import {
  ALLOW_DELETION_RECEIPT_KEY,
  AccountDeletionRequest,
  DeletionReceiptGuard,
} from './guards/deletion-receipt.guard.js';
import { AccountDeletionService } from './services/account-deletion.service.js';
import { DeletionReceiptService } from './services/deletion-receipt.service.js';

const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEST_REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const TEST_SECRET = 'integration-test-deletion-receipt-hmac-secret-32b';

/**
 * Builds a synthetic compact JWT string with `sub`, `session_id`, and `exp` claims for guard testing.
 */
function buildSyntheticBearerToken(
  sub = TEST_USER_ID,
  sessionId = TEST_SESSION_ID,
  exp = 4102444800,
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      session_id: sessionId,
      exp,
    }),
    'utf8',
  ).toString('base64url');
  return `${header}.${payload}.synthetic-sig`;
}

/**
 * Creates a mock NestJS `ExecutionContext` for testing `DeletionReceiptGuard`.
 */
function createGuardContext(
  req: Partial<AccountDeletionRequest>,
  handler: (...args: any[]) => any = AccountController.prototype
    .requestDeletion,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => AccountController,
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('M03-01 Account Deletion Contract, Receipt Authority & Guard (EP-X01 / EP-X02)', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockTransaction: ReturnType<typeof vi.fn>;
  let database: DatabaseService;
  let configService: ConfigService;
  let receiptService: DeletionReceiptService;
  let deletionService: AccountDeletionService;
  let controller: AccountController;
  let reflector: Reflector;
  let mockSupabaseAuthGuard: { canActivate: ReturnType<typeof vi.fn> };
  let guard: DeletionReceiptGuard;

  beforeEach(() => {
    vi.clearAllMocks();

    mockQuery = vi.fn();
    mockTransaction = vi.fn(
      async (
        _userId: string | null,
        op: (db: { query: typeof mockQuery }) => Promise<unknown>,
      ) => op({ query: mockQuery }),
    );

    database = {
      query: mockQuery,
      transaction: mockTransaction,
    } as unknown as DatabaseService;

    configService = {
      get: vi.fn((key: string) => {
        if (key === 'DELETION_RECEIPT_SECRET') return TEST_SECRET;
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    } as unknown as ConfigService;

    receiptService = new DeletionReceiptService(configService);
    deletionService = new AccountDeletionService(database, receiptService);
    controller = new AccountController(deletionService);
    reflector = new Reflector();
    mockSupabaseAuthGuard = {
      canActivate: vi.fn(async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest<AccountDeletionRequest>();
        const authHeader = req?.headers?.authorization ?? '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token !== buildSyntheticBearerToken()) {
          fail(401, 'INVALID_TOKEN', 'A valid Auth session is required');
        }
        req.user = {
          id: TEST_USER_ID,
          sub: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          session_id: TEST_SESSION_ID,
        };
        return true;
      }),
    };
    guard = new DeletionReceiptGuard(
      reflector,
      database,
      receiptService,
      mockSupabaseAuthGuard as unknown as SupabaseAuthGuard,
    );
  });

  describe('AccountDeletionRequestDto validation', () => {
    it('accepts confirmation === "DELETE" with optional password or reauth_token', async () => {
      const dtoWithPassword = plainToInstance(AccountDeletionRequestDto, {
        confirmation: 'DELETE',
        password: 'S3cure!Password',
      });
      const dtoWithReauth = plainToInstance(AccountDeletionRequestDto, {
        confirmation: 'DELETE',
        reauth_token: 'reauth-jwt-token',
      });

      expect(await validate(dtoWithPassword)).toHaveLength(0);
      expect(await validate(dtoWithReauth)).toHaveLength(0);
      expect(
        validateAccountDeletionRequest({
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).toEqual({
        confirmation: 'DELETE',
        password: 'S3cure!Password',
      });
    });

    it('rejects confirmation values other than "DELETE"', async () => {
      const invalidDto = plainToInstance(AccountDeletionRequestDto, {
        confirmation: 'delete',
      });
      expect(await validate(invalidDto)).not.toHaveLength(0);
    });

    it('rejects requests supplying both password and reauth_token simultaneously', () => {
      expect(() =>
        validateAccountDeletionRequest({
          confirmation: 'DELETE',
          password: 'S3cure!Password',
          reauth_token: 'reauth-jwt-token',
        }),
      ).toThrowError(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({ code: 'INVALID_FORMAT' }),
        }),
      );
    });
  });

  describe('EP-X01 (POST /api/v1/account/deletion-requests)', () => {
    it('creates a scheduled deletion request row and returns 202 payload with deletion_receipt and receipt_expires_at', async () => {
      const requestedAt = new Date('2026-11-10T08:00:00.000Z');
      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_REQUEST_ID,
          user_id: TEST_USER_ID,
          status: 'scheduled',
          requested_at: requestedAt,
          completed_at: null,
          provider_deletion_requested: false,
        },
      ]);

      const req: Partial<AccountDeletionRequest> = {
        deletionAuth: {
          mode: 'jwt',
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          status: 'active',
        },
      };

      const result = await controller.requestDeletion(
        req as AccountDeletionRequest,
        { confirmation: 'DELETE', password: 'S3cure!Password' },
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        TEST_USER_ID,
      ]);
      const executedSql = String(mockQuery.mock.calls[0][0]);
      expect(executedSql).toContain(
        'INSERT INTO public.account_deletion_requests',
      );
      expect(executedSql).toContain("'scheduled'");
      expect(executedSql).toContain("'[]'::jsonb");
      expect(executedSql).toContain("interval '30 days'");

      expect(result).toEqual({
        id: TEST_REQUEST_ID,
        status: 'scheduled',
        requested_at: '2026-11-10T08:00:00.000Z',
        completed_at: null,
        provider_deletion_requested: false,
        deletion_receipt: expect.any(String),
        receipt_expires_at: expect.any(String),
      });

      const verifiedClaims = receiptService.verifyReceipt(
        result.deletion_receipt!,
      );
      expect(verifiedClaims.request_id).toBe(TEST_REQUEST_ID);
      expect(verifiedClaims.typ).toBe('deletion_receipt');
      expect(verifiedClaims.aud).toBe('account-deletion-status');
    });

    it('returns 400 CONFIRMATION_MISMATCH when confirmation is not literal "DELETE"', async () => {
      const req: Partial<AccountDeletionRequest> = {
        user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
      };

      await expect(
        controller.requestDeletion(req as AccountDeletionRequest, {
          confirmation: 'WRONG',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          code: 'CONFIRMATION_MISMATCH',
        }),
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('maps PostgreSQL unique constraint violation 23505 (uq_account_deletion_one_active) to 409 DELETION_ALREADY_REQUESTED', async () => {
      const pgUniqueError = Object.assign(
        new Error(
          'duplicate key value violates unique constraint "uq_account_deletion_one_active"',
        ),
        { code: '23505' },
      );
      mockQuery.mockRejectedValueOnce(pgUniqueError);

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'DELETION_ALREADY_REQUESTED',
        }),
      });

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        TEST_USER_ID,
      ]);
    });

    it('mints DeletionReceipt inside the database transaction callback so a 503 receipt failure aborts the transaction', async () => {
      let insideTx = false;
      let committed = false;

      mockTransaction.mockImplementationOnce(
        async (
          _userId: string | null,
          op: (db: { query: typeof mockQuery }) => Promise<unknown>,
        ) => {
          insideTx = true;
          try {
            const res = await op({ query: mockQuery });
            committed = true;
            return res;
          } finally {
            insideTx = false;
          }
        },
      );

      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_REQUEST_ID,
          user_id: TEST_USER_ID,
          status: 'scheduled',
          requested_at: new Date('2026-11-10T08:00:00.000Z'),
          completed_at: null,
          provider_deletion_requested: false,
        },
      ]);

      const mintSpy = vi
        .spyOn(receiptService, 'mintReceipt')
        .mockImplementationOnce(() => {
          expect(insideTx).toBe(true);
          throw Object.assign(new Error('Service unavailable'), {
            status: 503,
            response: { code: 'SERVICE_UNAVAILABLE' },
          });
        });

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });

      expect(mintSpy).toHaveBeenCalledWith(TEST_REQUEST_ID);
      expect(committed).toBe(false);
    });
  });

  describe('DeletionReceiptGuard & AZ-SUSP access control on EP-X01 and EP-X02', () => {
    it('allows suspended users (AZ-SUSP) with verified contact and approved session on EP-X01 and EP-X02', async () => {
      mockQuery.mockResolvedValue([
        {
          id: TEST_USER_ID,
          status: 'suspended',
          verified_contact: true,
          session_approved: true,
        },
      ]);

      const bearerHeader = `Bearer ${buildSyntheticBearerToken()}`;
      const reqX01: Partial<AccountDeletionRequest> = {
        headers: { authorization: bearerHeader },
      };
      const reqX02: Partial<AccountDeletionRequest> = {
        headers: { authorization: bearerHeader },
      };

      const canActivateX01 = await guard.canActivate(
        createGuardContext(reqX01, AccountController.prototype.requestDeletion),
      );
      const canActivateX02 = await guard.canActivate(
        createGuardContext(
          reqX02,
          AccountController.prototype.getCurrentStatus,
        ),
      );

      expect(canActivateX01).toBe(true);
      expect(canActivateX02).toBe(true);
      expect(reqX01.deletionAuth).toEqual({
        mode: 'jwt',
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        status: 'suspended',
      });
      expect(reqX02.deletionAuth).toEqual({
        mode: 'jwt',
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        status: 'suspended',
      });
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        TEST_USER_ID,
        TEST_SESSION_ID,
      ]);
    });

    it('rejects unapproved or revoked JWT sessions with 401 AUTH_REQUIRED on EP-X01 and EP-X02', async () => {
      mockQuery.mockResolvedValue([
        {
          id: TEST_USER_ID,
          status: 'active',
          verified_contact: true,
          session_approved: false,
        },
      ]);

      const req: Partial<AccountDeletionRequest> = {
        headers: { authorization: `Bearer ${buildSyntheticBearerToken()}` },
      };

      await expect(
        guard.canActivate(
          createGuardContext(req, AccountController.prototype.requestDeletion),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      });

      await expect(
        guard.canActivate(
          createGuardContext(req, AccountController.prototype.getCurrentStatus),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      });
    });

    it('rejects JWT callers when verified_contact is false, null, or undefined with 403 VERIFIED_CONTACT_REQUIRED', async () => {
      for (const nonVerifiedValue of [false, null, undefined]) {
        mockQuery.mockResolvedValueOnce([
          {
            id: TEST_USER_ID,
            status: 'active',
            verified_contact: nonVerifiedValue,
            session_approved: true,
          },
        ]);

        const req: Partial<AccountDeletionRequest> = {
          headers: { authorization: `Bearer ${buildSyntheticBearerToken()}` },
        };

        await expect(
          guard.canActivate(
            createGuardContext(
              req,
              AccountController.prototype.requestDeletion,
            ),
          ),
        ).rejects.toMatchObject({
          status: 403,
          response: expect.objectContaining({
            code: 'VERIFIED_CONTACT_REQUIRED',
          }),
        });
      }
    });

    it('rejects DeletionReceipt scheme on EP-X01 (only allowed on EP-X02)', async () => {
      const { receipt } = receiptService.mintReceipt(TEST_REQUEST_ID);
      const req: Partial<AccountDeletionRequest> = {
        headers: { authorization: `DeletionReceipt ${receipt}` },
      };

      await expect(
        guard.canActivate(
          createGuardContext(req, AccountController.prototype.requestDeletion),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('delegates Bearer JWT signature verification to SupabaseAuthGuard and rejects tokens when SupabaseAuthGuard rejects', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          status: 'active',
          verified_contact: true,
          session_approved: true,
        },
      ]);

      const req: Partial<AccountDeletionRequest> = {
        headers: { authorization: `Bearer ${buildSyntheticBearerToken()}` },
      };

      const allowed = await guard.canActivate(
        createGuardContext(req, AccountController.prototype.requestDeletion),
      );
      expect(allowed).toBe(true);
      expect(mockSupabaseAuthGuard.canActivate).toHaveBeenCalledTimes(1);

      const reqInvalidJwt: Partial<AccountDeletionRequest> = {
        headers: { authorization: 'Bearer forged.unverified.token' },
      };

      await expect(
        guard.canActivate(
          createGuardContext(
            reqInvalidJwt,
            AccountController.prototype.requestDeletion,
          ),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      });
    });

    it('throws at bootstrap when constructed without SupabaseAuthGuard and never falls back to unverified token decoding', () => {
      expect(
        () =>
          new DeletionReceiptGuard(
            reflector,
            database,
            receiptService,
            undefined as unknown as SupabaseAuthGuard,
          ),
      ).toThrowError(/SupabaseAuthGuard is required by DeletionReceiptGuard/);
    });

    it('resolves AccountModule, DeletionReceiptGuard, AccountController, AccountDeletionService, and real SupabaseAuthGuard via NestJS DI', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            ignoreEnvVars: true,
            load: [
              () => ({
                DELETION_RECEIPT_SECRET: TEST_SECRET,
                NODE_ENV: 'test',
              }),
            ],
          }),
          AccountModule,
        ],
      })
        .overrideProvider(DatabaseService)
        .useValue(database)
        .compile();

      try {
        const resolvedGuard = moduleRef.get(DeletionReceiptGuard);
        const resolvedController = moduleRef.get(AccountController);
        const resolvedDeletionService = moduleRef.get(AccountDeletionService);
        const resolvedSupabaseGuard = moduleRef.get(SupabaseAuthGuard);

        expect(resolvedGuard).toBeInstanceOf(DeletionReceiptGuard);
        expect(resolvedController).toBeInstanceOf(AccountController);
        expect(resolvedDeletionService).toBeInstanceOf(AccountDeletionService);
        expect(resolvedSupabaseGuard).toBeInstanceOf(SupabaseAuthGuard);
        expect(
          (resolvedGuard as unknown as { supabaseAuthGuard: SupabaseAuthGuard })
            .supabaseAuthGuard,
        ).toBe(resolvedSupabaseGuard);
      } finally {
        await moduleRef.close();
      }
    });
  });

  describe('EP-X02 (GET /api/v1/account/deletion-requests/current)', () => {
    it('returns 200 current deletion status when authenticated via Bearer JWT', async () => {
      mockQuery
        .mockResolvedValueOnce([
          {
            id: TEST_USER_ID,
            status: 'active',
            verified_contact: true,
            session_approved: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'scheduled',
            requested_at: '2026-11-10T08:00:00.000Z',
            completed_at: null,
            provider_deletion_requested: false,
          },
        ]);

      const req: Partial<AccountDeletionRequest> = {
        headers: { authorization: `Bearer ${buildSyntheticBearerToken()}` },
      };

      const activated = await guard.canActivate(
        createGuardContext(req, AccountController.prototype.getCurrentStatus),
      );
      expect(activated).toBe(true);

      const status = await controller.getCurrentStatus(
        req as AccountDeletionRequest,
      );

      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.any(String), [
        TEST_USER_ID,
      ]);
      expect(status).toEqual({
        id: TEST_REQUEST_ID,
        status: 'scheduled',
        requested_at: '2026-11-10T08:00:00.000Z',
        completed_at: null,
        provider_deletion_requested: false,
      });
      expect(status.deletion_receipt).toBeUndefined();
    });

    it('returns 200 via DeletionReceipt for both active (user_id present) and completed tombstone (user_id: null) rows without querying users/sessions', async () => {
      const { receipt } = receiptService.mintReceipt(TEST_REQUEST_ID);

      // 1) Active / in_progress row with user_id present
      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_REQUEST_ID,
          user_id: TEST_USER_ID,
          status: 'in_progress',
          requested_at: '2026-11-10T08:00:00.000Z',
          completed_at: null,
          provider_deletion_requested: false,
        },
      ]);

      const reqActive: Partial<AccountDeletionRequest> = {
        headers: { authorization: `DeletionReceipt ${receipt}` },
      };

      expect(
        Reflect.getMetadata(
          ALLOW_DELETION_RECEIPT_KEY,
          AccountController.prototype.getCurrentStatus,
        ),
      ).toBe(true);

      await guard.canActivate(
        createGuardContext(
          reqActive,
          AccountController.prototype.getCurrentStatus,
        ),
      );
      expect(mockQuery).not.toHaveBeenCalled();

      const activeStatus = await controller.getCurrentStatus(
        reqActive as AccountDeletionRequest,
      );
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        TEST_REQUEST_ID,
      ]);
      expect(activeStatus).toEqual({
        id: TEST_REQUEST_ID,
        status: 'in_progress',
        requested_at: '2026-11-10T08:00:00.000Z',
        completed_at: null,
        provider_deletion_requested: false,
      });

      // 2) Completed tombstone row with user_id: null
      mockQuery.mockClear();
      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_REQUEST_ID,
          user_id: null,
          status: 'completed',
          requested_at: '2026-11-10T08:00:00.000Z',
          completed_at: '2026-11-10T08:05:00.000Z',
          provider_deletion_requested: true,
        },
      ]);

      const reqTombstone: Partial<AccountDeletionRequest> = {
        headers: { authorization: `DeletionReceipt ${receipt}` },
      };

      await guard.canActivate(
        createGuardContext(
          reqTombstone,
          AccountController.prototype.getCurrentStatus,
        ),
      );
      const tombstoneStatus = await controller.getCurrentStatus(
        reqTombstone as AccountDeletionRequest,
      );

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        TEST_REQUEST_ID,
      ]);
      expect(tombstoneStatus).toEqual({
        id: TEST_REQUEST_ID,
        status: 'completed',
        requested_at: '2026-11-10T08:00:00.000Z',
        completed_at: '2026-11-10T08:05:00.000Z',
        provider_deletion_requested: true,
      });
    });

    it('rejects invalid/expired DeletionReceipt or unsupported Authorization scheme with 401', async () => {
      const issuedAt = new Date('2026-11-01T00:00:00.000Z');
      const { receipt: expiredReceipt } = receiptService.mintReceipt(
        TEST_REQUEST_ID,
        issuedAt,
      );

      const reqExpired: Partial<AccountDeletionRequest> = {
        headers: { authorization: `DeletionReceipt ${expiredReceipt}` },
      };
      await expect(
        guard.canActivate(
          createGuardContext(
            reqExpired,
            AccountController.prototype.getCurrentStatus,
          ),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      });

      const reqUnsupported: Partial<AccountDeletionRequest> = {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      };
      await expect(
        guard.canActivate(
          createGuardContext(
            reqUnsupported,
            AccountController.prototype.getCurrentStatus,
          ),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      });

      const reqMissing: Partial<AccountDeletionRequest> = {
        headers: {},
      };
      await expect(
        guard.canActivate(
          createGuardContext(
            reqMissing,
            AccountController.prototype.getCurrentStatus,
          ),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      });
    });

    it('returns 404 DELETION_REQUEST_NOT_FOUND when no deletion request row exists', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(
        deletionService.getCurrentStatus({
          mode: 'receipt',
          requestId: TEST_REQUEST_ID,
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({
          code: 'DELETION_REQUEST_NOT_FOUND',
        }),
      });

      mockQuery.mockResolvedValueOnce([]);

      await expect(
        deletionService.getCurrentStatus({
          mode: 'jwt',
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          status: 'active',
        }),
      ).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({
          code: 'DELETION_REQUEST_NOT_FOUND',
        }),
      });
    });
  });
});
