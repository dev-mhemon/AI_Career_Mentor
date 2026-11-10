import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { ReauthVerificationService } from './services/reauth-verification.service.js';

const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TEST_REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const TEST_IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';
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

describe('M03-02 Account Deletion: Re-Authentication, Atomic Cascade Execution & Tombstone Preservation (EP-X01 / EP-X02)', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mockTransaction: ReturnType<typeof vi.fn>;
  let database: DatabaseService;
  let configService: ConfigService;
  let receiptService: DeletionReceiptService;
  let reauthService: ReauthVerificationService;
  let deletionService: AccountDeletionService;
  let controller: AccountController;
  let reflector: Reflector;
  let mockSupabaseAuthGuard: { canActivate: ReturnType<typeof vi.fn> };
  let guard: DeletionReceiptGuard;
  let fetchMock: ReturnType<typeof vi.fn>;

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
        if (key === 'SUPABASE_URL') return 'http://supabase.test';
        if (key === 'SUPABASE_ANON_KEY') return 'test-anon-key';
        return undefined;
      }),
    } as unknown as ConfigService;

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'reauth-mock-token',
        user: { id: TEST_USER_ID },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    receiptService = new DeletionReceiptService(configService);
    reauthService = new ReauthVerificationService(configService, database);
    deletionService = new AccountDeletionService(
      database,
      receiptService,
      reauthService,
    );
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('AccountDeletionRequestDto & validateAccountDeletionRequest', () => {
    it('accepts confirmation === "DELETE" with valid password', async () => {
      const dtoWithPassword = plainToInstance(AccountDeletionRequestDto, {
        confirmation: 'DELETE',
        password: 'S3cure!Password',
      });

      expect(await validate(dtoWithPassword)).toHaveLength(0);
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

    it('accepts confirmation === "DELETE" with valid reauth_token', async () => {
      const dtoWithReauth = plainToInstance(AccountDeletionRequestDto, {
        confirmation: 'DELETE',
        reauth_token: 'reauth-jwt-token',
      });

      expect(await validate(dtoWithReauth)).toHaveLength(0);
      expect(
        validateAccountDeletionRequest({
          confirmation: 'DELETE',
          reauth_token: 'reauth-jwt-token',
        }),
      ).toEqual({
        confirmation: 'DELETE',
        reauth_token: 'reauth-jwt-token',
      });
    });

    it('rejects confirmation values other than "DELETE" with 422 CONFIRMATION_MISMATCH', () => {
      expect(() =>
        validateAccountDeletionRequest({
          confirmation: 'delete',
          password: 'S3cure!Password',
        }),
      ).toThrowError(
        expect.objectContaining({
          status: 422,
          response: expect.objectContaining({ code: 'CONFIRMATION_MISMATCH' }),
        }),
      );
    });

    it('rejects requests omitting both password and reauth_token with 401 REAUTH_REQUIRED', () => {
      expect(() =>
        validateAccountDeletionRequest({
          confirmation: 'DELETE',
        }),
      ).toThrowError(
        expect.objectContaining({
          status: 401,
          response: expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
        }),
      );
    });

    it('rejects requests supplying both password and reauth_token simultaneously with 400 INVALID_FORMAT', () => {
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

    it('rejects non-string or oversized password with 400 INVALID_FORMAT', () => {
      expect(() =>
        validateAccountDeletionRequest({
          confirmation: 'DELETE',
          password: 'x'.repeat(129),
        }),
      ).toThrowError(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({ code: 'INVALID_FORMAT' }),
        }),
      );
    });

    it('rejects non-string or oversized reauth_token with 400 INVALID_FORMAT', () => {
      expect(() =>
        validateAccountDeletionRequest({
          confirmation: 'DELETE',
          reauth_token: 'x'.repeat(2049),
        }),
      ).toThrowError(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({ code: 'INVALID_FORMAT' }),
        }),
      );
    });
  });

  describe('ReauthVerificationService & credential verification', () => {
    it('verifies password against GoTrue successfully using user email from public.users', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: 'user@example.com', phone: null },
      ]);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          password: 'ValidPassword!123',
        }),
      ).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT email, phone'),
        [TEST_USER_ID],
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase.test/auth/v1/token?grant_type=password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'ValidPassword!123',
          }),
        }),
      );
    });

    it('verifies password using user phone when email is absent', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: null, phone: '+8801700000000' },
      ]);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          password: 'ValidPassword!123',
        }),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase.test/auth/v1/token?grant_type=password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            phone: '+8801700000000',
            password: 'ValidPassword!123',
          }),
        }),
      );
    });

    it('rejects invalid password with 401 REAUTH_REQUIRED when GoTrue returns 400/401', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: 'user@example.com', phone: null },
      ]);
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          password: 'WrongPassword!',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
      });
    });

    it('rejects password verification with 401 REAUTH_REQUIRED when GoTrue returns a different user id', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: 'user@example.com', phone: null },
      ]);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'different-uuid-9999' } }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          password: 'ValidPassword!123',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
      });
    });

    it('rejects password verification with 401 REAUTH_REQUIRED when user has no password-backed contact', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: null, phone: null }])
        .mockResolvedValueOnce([]);

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          password: 'ValidPassword!123',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
      });
    });

    it('verifies reauth_token against GoTrue successfully using /auth/v1/user', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          reauth_token: 'valid-oauth-jwt',
        }),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase.test/auth/v1/user',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-oauth-jwt',
          }),
        }),
      );
    });

    it('rejects invalid or expired reauth_token with 401 REAUTH_REQUIRED when GoTrue returns 401/403', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ msg: 'Invalid token' }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          reauth_token: 'expired-token',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
      });
    });

    it('rejects reauth_token with 401 REAUTH_REQUIRED when returned user id does not match caller', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'attacker-sub-id' }),
      });

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          reauth_token: 'mismatched-user-token',
        }),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
      });
    });

    it('maps GoTrue network timeout or provider outage to 503 SERVICE_UNAVAILABLE', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: 'user@example.com', phone: null },
      ]);
      fetchMock.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(
        reauthService.verifyReauthentication(TEST_USER_ID, {
          password: 'Password123!',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
      });
    });
  });

  describe('H-IDEM Idempotency enforcement', () => {
    it('rejects non-UUID Idempotency-Key header with 400 INVALID_FORMAT', async () => {
      const req: Partial<AccountDeletionRequest> = {
        headers: {
          authorization: `Bearer ${buildSyntheticBearerToken()}`,
          'idempotency-key': 'not-a-valid-uuid',
        },
        deletionAuth: {
          mode: 'jwt',
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          status: 'active',
        },
      };

      await expect(
        controller.requestDeletion(req as AccountDeletionRequest, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'INVALID_FORMAT' }),
      });
    });

    it('returns cached 202 response when same Idempotency-Key is reused with same request body', async () => {
      // 1st request setup: Reauth queries email, inserts request, revokes sessions, deletes user, returns tombstone
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }]) // reauth check
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ]) // insert request
        .mockResolvedValueOnce([]) // revoke approved sessions
        .mockResolvedValueOnce([]) // revoke gotrue refresh tokens
        .mockResolvedValueOnce([]) // delete gotrue sessions
        .mockResolvedValueOnce([]) // delete public.users
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:01:00.000Z'),
            provider_deletion_requested: false,
          },
        ]); // select completed tombstone

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      const req: Partial<AccountDeletionRequest> = {
        headers: {
          authorization: `Bearer ${buildSyntheticBearerToken()}`,
          'idempotency-key': TEST_IDEMPOTENCY_KEY,
        },
        deletionAuth: {
          mode: 'jwt',
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          status: 'active',
        },
      };

      const firstResponse = await controller.requestDeletion(
        req as AccountDeletionRequest,
        { confirmation: 'DELETE', password: 'S3cure!Password' },
      );

      expect(firstResponse.status).toBe('completed');
      expect(firstResponse.completed_at).toBe('2026-11-10T08:01:00.000Z');
      expect(firstResponse.deletion_receipt).toBeDefined();

      const queryCountAfterFirst = mockQuery.mock.calls.length;

      // 2nd request with EXACT same Idempotency-Key and body:
      const secondResponse = await controller.requestDeletion(
        req as AccountDeletionRequest,
        { confirmation: 'DELETE', password: 'S3cure!Password' },
      );

      // Returns exact cached response without executing DB queries or re-auth
      expect(secondResponse).toEqual(firstResponse);
      expect(mockQuery.mock.calls.length).toBe(queryCountAfterFirst);
    });

    it('rejects with 409 IDEMPOTENCY_KEY_REUSED when same Idempotency-Key is reused with different request body', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:01:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      const uniqueKey = '77777777-7777-4777-8777-777777777777';
      const req: Partial<AccountDeletionRequest> = {
        headers: {
          authorization: `Bearer ${buildSyntheticBearerToken()}`,
          'idempotency-key': uniqueKey,
        },
        deletionAuth: {
          mode: 'jwt',
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          status: 'active',
        },
      };

      await controller.requestDeletion(req as AccountDeletionRequest, {
        confirmation: 'DELETE',
        password: 'OriginalPassword1!',
      });

      // Repeat with same key but different body:
      await expect(
        controller.requestDeletion(req as AccountDeletionRequest, {
          confirmation: 'DELETE',
          password: 'DifferentPassword2!',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'IDEMPOTENCY_KEY_REUSED',
        }),
      });
    });

    it('scopes idempotency cache strictly by caller: different userId sending same Idempotency-Key and payload does not receive cached response', async () => {
      const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';
      const OTHER_REQUEST_ID = '88888888-8888-4888-8888-888888888888';
      const sharedKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

      // 1) First caller (TEST_USER_ID) executes deletion with sharedKey
      mockQuery
        .mockResolvedValueOnce([{ email: 'user1@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:01:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      const firstResponse = await deletionService.requestDeletion(
        TEST_USER_ID,
        { confirmation: 'DELETE', password: 'SharedPassword123!' },
        sharedKey,
      );

      expect(firstResponse.id).toBe(TEST_REQUEST_ID);

      // 2) Second caller (OTHER_USER_ID) sends SAME sharedKey and identical payload:
      mockQuery
        .mockResolvedValueOnce([{ email: 'user2@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: OTHER_REQUEST_ID,
            user_id: OTHER_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:02:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: OTHER_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:02:00.000Z'),
            completed_at: new Date('2026-11-10T08:03:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: OTHER_USER_ID } }),
      });

      const secondResponse = await deletionService.requestDeletion(
        OTHER_USER_ID,
        { confirmation: 'DELETE', password: 'SharedPassword123!' },
        sharedKey,
      );

      // Must be User B's own request ID, NEVER User A's cached response/receipt
      expect(secondResponse.id).toBe(OTHER_REQUEST_ID);
      expect(secondResponse.id).not.toBe(firstResponse.id);
      expect(secondResponse.deletion_receipt).not.toBe(
        firstResponse.deletion_receipt,
      );
    });

    it('evicts expired idempotency entries and bounds store size to MAX_IDEMPOTENCY_ENTRIES with reserveSlot on write', async () => {
      const store = (deletionService as any).idempotencyStore as Map<
        string,
        any
      >;
      store.clear();

      store.set('expired-key', {
        userId: TEST_USER_ID,
        payloadHash: 'hash',
        response: {} as any,
        expiresAt: Date.now() - 1000,
      });

      (deletionService as any).pruneExpiredIdempotencyEntries();
      expect(store.has('expired-key')).toBe(false);

      // Seed exactly 1000 entries (capacity)
      for (let i = 0; i < 1000; i++) {
        store.set(`key-${i}`, {
          userId: TEST_USER_ID,
          payloadHash: `hash-${i}`,
          response: {} as any,
          expiresAt: Date.now() + 100000,
        });
      }
      expect(store.size).toBe(1000);

      // Read path (reserveSlot = false): does NOT evict key-0 when at exact capacity
      (deletionService as any).pruneExpiredIdempotencyEntries(
        Date.now(),
        false,
      );
      expect(store.size).toBe(1000);
      expect(store.has('key-0')).toBe(true);

      // Write path (reserveSlot = true): evicts key-0 to reserve a slot (size becomes 999)
      (deletionService as any).pruneExpiredIdempotencyEntries(Date.now(), true);
      expect(store.size).toBe(999);
      expect(store.has('key-0')).toBe(false);
      expect(store.has('key-1')).toBe(true);

      // New entry written keeps store at exactly 1000
      store.set('key-new', {
        userId: TEST_USER_ID,
        payloadHash: 'hash-new',
        response: {} as any,
        expiresAt: Date.now() + 100000,
      });
      expect(store.size).toBe(1000);
      expect(store.has('key-new')).toBe(true);
    });

    it('guards concurrent in-flight deletion requests for the same userId with 409 DELETION_ALREADY_REQUESTED', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: 'user@example.com', phone: null },
      ]);

      let finishFirstRequest: (() => void) | undefined;
      const slowPromise = new Promise<void>((resolve) => {
        finishFirstRequest = resolve;
      });

      mockTransaction.mockImplementationOnce(async () => {
        await slowPromise;
        return {
          row: {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date(),
            completed_at: new Date(),
            provider_deletion_requested: false,
          },
          receipt: { receipt: 'receipt', expiresAt: new Date().toISOString() },
        };
      });

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      const firstCall = deletionService.requestDeletion(TEST_USER_ID, {
        confirmation: 'DELETE',
        password: 'S3cure!Password',
      });

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'DELETION_ALREADY_REQUESTED',
        }),
      });

      finishFirstRequest?.();
      await firstCall;
    });
  });

  describe('EP-X01 Atomic cascade execution, session revocation & tombstone completion', () => {
    it('executes atomic cascade in a single transaction: deletes public.users, revokes sessions, transitions tombstone to completed, and returns 202', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }]) // reauth check
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ]) // 1. insert request
        .mockResolvedValueOnce([]) // 2. revoke approved_auth_sessions
        .mockResolvedValueOnce([]) // 3. revoke gotrue refresh tokens
        .mockResolvedValueOnce([]) // 4. delete gotrue sessions
        .mockResolvedValueOnce([]) // 5. delete public.users
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:05:00.000Z'),
            provider_deletion_requested: false,
          },
        ]); // 6. select completed tombstone

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: TEST_USER_ID } }),
      });

      const result = await deletionService.requestDeletion(TEST_USER_ID, {
        confirmation: 'DELETE',
        password: 'S3cure!Password',
      });

      expect(result).toEqual({
        id: TEST_REQUEST_ID,
        status: 'completed',
        requested_at: '2026-11-10T08:00:00.000Z',
        completed_at: '2026-11-10T08:05:00.000Z',
        provider_deletion_requested: false,
        deletion_receipt: expect.any(String),
        receipt_expires_at: expect.any(String),
      });

      // Parameter-based SQL inspections (ZERO-PARSER):
      const sqlCalls = mockQuery.mock.calls.map(([sql, params]) => ({
        sql: String(sql),
        params,
      }));

      // Verifies public.users deletion
      const userDeleteCall = sqlCalls.find((c) =>
        c.sql.includes('DELETE FROM public.users'),
      );
      expect(userDeleteCall).toBeDefined();
      expect(userDeleteCall?.params).toEqual([TEST_USER_ID]);

      // Verifies approved_auth_sessions revocation
      const sessionRevokeCall = sqlCalls.find((c) =>
        c.sql.includes('UPDATE private.approved_auth_sessions'),
      );
      expect(sessionRevokeCall).toBeDefined();
      expect(sessionRevokeCall?.params).toEqual([TEST_USER_ID]);

      // Verifies GoTrue session revocation
      const gotrueTokenCall = sqlCalls.find((c) =>
        c.sql.includes('UPDATE auth.refresh_tokens'),
      );
      expect(gotrueTokenCall).toBeDefined();
      expect(gotrueTokenCall?.params).toEqual([TEST_USER_ID]);

      const gotrueSessionCall = sqlCalls.find((c) =>
        c.sql.includes('DELETE FROM auth.sessions'),
      );
      expect(gotrueSessionCall).toBeDefined();
      expect(gotrueSessionCall?.params).toEqual([TEST_USER_ID]);

      // Verifies tombstone selection by request ID
      const tombstoneCall = sqlCalls.find(
        (c) =>
          c.sql.includes('SELECT') &&
          c.sql.includes('FROM public.account_deletion_requests'),
      );
      expect(tombstoneCall).toBeDefined();
      expect(tombstoneCall?.params).toEqual([TEST_REQUEST_ID]);
    });

    it('rolls back transaction completely when public.users cascade deletion fails (R05)', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }]) // reauth check
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ]) // insert request
        .mockResolvedValueOnce([]) // revoke approved sessions
        .mockResolvedValueOnce([]) // revoke refresh tokens
        .mockResolvedValueOnce([]) // delete auth sessions
        .mockRejectedValueOnce(new Error('Foreign key cascade deadlock')); // delete public.users fails!

      let rolledBack = false;
      mockTransaction.mockImplementationOnce(
        async (
          _userId: string | null,
          op: (db: { query: typeof mockQuery }) => Promise<unknown>,
        ) => {
          try {
            return await op({ query: mockQuery });
          } catch (err) {
            rolledBack = true;
            throw err;
          }
        },
      );

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toThrow('Foreign key cascade deadlock');

      expect(rolledBack).toBe(true);
    });

    it('maps PostgreSQL unique constraint violation 23505 (uq_account_deletion_one_active) to 409 DELETION_ALREADY_REQUESTED', async () => {
      mockQuery.mockResolvedValueOnce([
        { email: 'user@example.com', phone: null },
      ]);
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
          password: 'S3cure!Password',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'DELETION_ALREADY_REQUESTED',
        }),
      });
    });

    it('allows suspended users (AZ-SUSP) with verified contact to complete re-authenticated deletion', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:05:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

      const req: Partial<AccountDeletionRequest> = {
        deletionAuth: {
          mode: 'jwt',
          userId: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          status: 'suspended',
        },
      };

      const result = await controller.requestDeletion(
        req as AccountDeletionRequest,
        {
          confirmation: 'DELETE',
          password: 'SuspendedUserPassword!',
        },
      );

      expect(result.status).toBe('completed');
      expect(result.completed_at).toBe('2026-11-10T08:05:00.000Z');
      expect(result.deletion_receipt).toBeDefined();
    });

    it('mints DeletionReceipt inside transaction callback so a receipt failure aborts the transaction', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:05:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

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
          password: 'S3cure!Password',
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

    it('throws 500 DATABASE_ERROR and rolls back transaction when post-cascade tombstone row is missing, non-completed, or retains user_id', async () => {
      // 1. Missing tombstone row
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // empty tombstone!

      let rolledBack = false;
      mockTransaction.mockImplementationOnce(async (_uid, op) => {
        try {
          return await op({ query: mockQuery });
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      });

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toMatchObject({
        status: 500,
        response: expect.objectContaining({
          code: 'DATABASE_ERROR',
        }),
      });
      expect(rolledBack).toBe(true);

      // 2. Non-completed tombstone status (e.g. still in_progress)
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: null,
            status: 'in_progress', // not completed!
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:01:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

      rolledBack = false;
      mockTransaction.mockImplementationOnce(async (_uid, op) => {
        try {
          return await op({ query: mockQuery });
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      });

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toMatchObject({
        status: 500,
        response: expect.objectContaining({
          code: 'DATABASE_ERROR',
        }),
      });
      expect(rolledBack).toBe(true);

      // 3. user_id retained (not null)
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID, // foreign key SET NULL failed!
            status: 'completed',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: new Date('2026-11-10T08:01:00.000Z'),
            provider_deletion_requested: false,
          },
        ]);

      rolledBack = false;
      mockTransaction.mockImplementationOnce(async (_uid, op) => {
        try {
          return await op({ query: mockQuery });
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      });

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toMatchObject({
        status: 500,
        response: expect.objectContaining({
          code: 'DATABASE_ERROR',
        }),
      });
      expect(rolledBack).toBe(true);
    });

    it('rolls back transaction completely when GoTrue session or token revocation query fails (fail-closed atomic transaction)', async () => {
      mockQuery
        .mockResolvedValueOnce([{ email: 'user@example.com', phone: null }])
        .mockResolvedValueOnce([
          {
            id: TEST_REQUEST_ID,
            user_id: TEST_USER_ID,
            status: 'in_progress',
            requested_at: new Date('2026-11-10T08:00:00.000Z'),
            completed_at: null,
            provider_deletion_requested: false,
          },
        ])
        .mockResolvedValueOnce([]) // revoke approved sessions succeeds
        .mockRejectedValueOnce(
          new Error('GoTrue auth.refresh_tokens connection error'),
        ); // GoTrue token query fails!

      let rolledBack = false;
      mockTransaction.mockImplementationOnce(async (_uid, op) => {
        try {
          return await op({ query: mockQuery });
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      });

      await expect(
        deletionService.requestDeletion(TEST_USER_ID, {
          confirmation: 'DELETE',
          password: 'S3cure!Password',
        }),
      ).rejects.toThrow('GoTrue auth.refresh_tokens connection error');

      expect(rolledBack).toBe(true);
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

    it('resolves AccountModule, DeletionReceiptGuard, AccountController, AccountDeletionService, ReauthVerificationService, and real SupabaseAuthGuard via NestJS DI', async () => {
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
                SUPABASE_URL: 'http://supabase.test',
                SUPABASE_ANON_KEY: 'test-anon-key',
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
        const resolvedReauthService = moduleRef.get(ReauthVerificationService);
        const resolvedSupabaseGuard = moduleRef.get(SupabaseAuthGuard);

        expect(resolvedGuard).toBeInstanceOf(DeletionReceiptGuard);
        expect(resolvedController).toBeInstanceOf(AccountController);
        expect(resolvedDeletionService).toBeInstanceOf(AccountDeletionService);
        expect(resolvedReauthService).toBeInstanceOf(ReauthVerificationService);
        expect(resolvedSupabaseGuard).toBeInstanceOf(SupabaseAuthGuard);
        expect(
          (resolvedGuard as unknown as { supabaseAuthGuard: SupabaseAuthGuard })
            .supabaseAuthGuard,
        ).toBe(resolvedSupabaseGuard);
      } finally {
        await moduleRef.close();
      }
    });

    it('rejects post-deletion JWT replays on EP-X01 with 401 AUTH_REQUIRED after cascade revokes session and deletes user, while EP-X02 with DeletionReceipt succeeds', async () => {
      const { receipt } = receiptService.mintReceipt(TEST_REQUEST_ID);

      // Pre-deletion: user and approved session active in DB
      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          status: 'active',
          verified_contact: true,
          session_approved: true,
        },
      ]);

      const reqPre: Partial<AccountDeletionRequest> = {
        headers: { authorization: `Bearer ${buildSyntheticBearerToken()}` },
      };

      const preAllowed = await guard.canActivate(
        createGuardContext(reqPre, AccountController.prototype.requestDeletion),
      );
      expect(preAllowed).toBe(true);

      // Post-deletion: user deleted or session revoked -> DB returns empty rows for session lookup
      mockQuery.mockClear();
      mockQuery.mockResolvedValueOnce([]); // no approved session row found

      const reqPost: Partial<AccountDeletionRequest> = {
        headers: { authorization: `Bearer ${buildSyntheticBearerToken()}` },
      };

      await expect(
        guard.canActivate(
          createGuardContext(
            reqPost,
            AccountController.prototype.requestDeletion,
          ),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      });

      // Status recovery path: EP-X02 with DeletionReceipt succeeds without requiring active user/session
      mockQuery.mockClear();
      mockQuery.mockResolvedValueOnce([
        {
          id: TEST_REQUEST_ID,
          user_id: null,
          status: 'completed',
          requested_at: '2026-11-10T08:00:00.000Z',
          completed_at: '2026-11-10T08:05:00.000Z',
          provider_deletion_requested: false,
        },
      ]);

      const reqReceipt: Partial<AccountDeletionRequest> = {
        headers: { authorization: `DeletionReceipt ${receipt}` },
      };

      const receiptAllowed = await guard.canActivate(
        createGuardContext(
          reqReceipt,
          AccountController.prototype.getCurrentStatus,
        ),
      );
      expect(receiptAllowed).toBe(true);
      expect(reqReceipt.deletionAuth).toEqual({
        mode: 'receipt',
        requestId: TEST_REQUEST_ID,
      });

      const tombstoneStatus = await controller.getCurrentStatus(
        reqReceipt as AccountDeletionRequest,
      );
      expect(tombstoneStatus.status).toBe('completed');
      expect(tombstoneStatus.id).toBe(TEST_REQUEST_ID);
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
