import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { ArgumentsHost } from '@nestjs/common';
import { AuthService } from './services/auth.service.js';
import { ApiExceptionFilter, fail } from '../common/http.js';
import { DatabaseService } from './services/database.service.js';
import type { DataSource } from 'typeorm';
import type { SessionApprovalService } from './services/session-approval.service.js';
import type { AuthAbuseControl } from './abuse-control/abuse-control.service.js';
import type { EmailRegistrationProvider } from './services/email-registration.provider.js';
import type { OtpSecretStore } from './services/otp-secret-store.service.js';

const TEST_USER_ID = '33333333-3333-4333-8333-333333333333';
const TEST_EMAIL = 'recovery-candidate@example.com';
const TEST_NEW_PASSWORD = 'NewPassw0rd!2026';

/**
 * Creates a mock express Request object with a valid client IP.
 */
function createMockRequest(ip = '127.0.0.1'): Request {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe('M02-01 Canonical Password Recovery Integration Matrix (EP-A08 & EP-A09)', () => {
  let config: ConfigService;
  let database: {
    query: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let abuse: {
    reserveSend: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
  };
  let approvals: {
    revokeAllUserSessions: ReturnType<typeof vi.fn>;
  };
  let otpStore: {
    verifyAndConsumeOtp: ReturnType<typeof vi.fn>;
  };
  let emailProvider: {
    ready: ReturnType<typeof vi.fn>;
    sendPasswordResetChallenge: ReturnType<typeof vi.fn>;
  };
  let authService: AuthService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    config = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        if (key === 'SERVICE_ROLE_KEY') return 'test-service-key';
        if (key === 'AUTH_PASSWORD_MIN_LENGTH') return 8;
        return undefined;
      }),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'http://supabase.test';
        if (key === 'SUPABASE_ANON_KEY') return 'test-anon-key';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        throw new Error(`Missing ${key}`);
      }),
    } as unknown as ConfigService;

    database = {
      query: vi.fn(),
      transaction: vi.fn(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          const txDb = {
            query: database.query,
          } as unknown as EntityManager;
          return op(txDb);
        },
      ),
    };

    abuse = {
      reserveSend: vi.fn(async () => ({ retryAfterSeconds: null })),
      isReady: vi.fn(() => true),
    };

    approvals = {
      revokeAllUserSessions: vi.fn(async () => 1),
    };

    otpStore = {
      verifyAndConsumeOtp: vi.fn(
        async (_userId, _id, _code, action: () => Promise<unknown>) => {
          return action();
        },
      ),
    };

    emailProvider = {
      ready: vi.fn(),
      sendPasswordResetChallenge: vi.fn(async () => ({ ok: true })),
    };

    authService = new AuthService(
      database as unknown as DatabaseService,
      config,
      abuse as unknown as AuthAbuseControl,
      approvals as unknown as SessionApprovalService,
      otpStore as unknown as OtpSecretStore,
      emailProvider as unknown as EmailRegistrationProvider,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('EP-A08 Forgot Password (POST /api/v1/auth/forgot-password)', () => {
    it('dispatches challenge and returns uniform 202 for active verified user', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          status: 'active',
          verified_contact: true,
          provider_subject: TEST_USER_ID,
          verified_at: new Date().toISOString(),
        },
      ]);

      const req = createMockRequest('10.0.0.1');
      const result = await authService.forgotPassword(
        { identifier: TEST_EMAIL },
        req,
      );

      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'email', identifier: TEST_EMAIL },
        '10.0.0.1',
        { purpose: 'reset_password' },
      );
      expect(emailProvider.ready).toHaveBeenCalled();
      expect(emailProvider.sendPasswordResetChallenge).toHaveBeenCalledWith(
        TEST_EMAIL,
        TEST_USER_ID,
      );
      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
      });
    });

    it('returns 404 AUTH_USER_NOT_FOUND for unknown account without sending code', async () => {
      database.query.mockResolvedValueOnce([]);

      await expect(
        authService.forgotPassword(
          { identifier: 'unknown@example.com' },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 404,
        response: {
          code: 'AUTH_USER_NOT_FOUND',
          message: 'No account found with this email address.',
        },
      });
      expect(emailProvider.sendPasswordResetChallenge).not.toHaveBeenCalled();
    });

    it('returns uniform 202 without sending code for unverified account', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          status: 'active',
          verified_contact: false,
          verified_at: null,
        },
      ]);

      const result = await authService.forgotPassword(
        { identifier: TEST_EMAIL },
        createMockRequest(),
      );

      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
      });
      expect(emailProvider.sendPasswordResetChallenge).not.toHaveBeenCalled();
    });

    it('returns uniform 202 without sending code for suspended account', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          status: 'suspended',
          verified_contact: true,
          verified_at: new Date().toISOString(),
        },
      ]);

      const result = await authService.forgotPassword(
        { identifier: TEST_EMAIL },
        createMockRequest(),
      );

      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
      });
      expect(emailProvider.sendPasswordResetChallenge).not.toHaveBeenCalled();
    });

    it('returns 503 SERVICE_UNAVAILABLE when phone identifier is submitted', async () => {
      await expect(
        authService.forgotPassword({ identifier: '+8801712345678' }),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });

    it('returns 429 when abuse control cooldown is active', async () => {
      abuse.reserveSend.mockImplementationOnce(async () => {
        fail(429, 'RESEND_COOLDOWN_ACTIVE', 'Please wait', [], true, 60);
      });

      await expect(
        authService.forgotPassword(
          { identifier: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          code: 'RESEND_COOLDOWN_ACTIVE',
        }),
      });
    });

    it('fails closed with 503 when abuse control is not ready', async () => {
      abuse.isReady.mockReturnValueOnce(false);

      await expect(
        authService.forgotPassword(
          { identifier: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });
  });

  describe('EP-A09 Reset Password (POST /api/v1/auth/reset-password)', () => {
    it('successfully resets password, revokes sessions in DB and GoTrue, and returns 200', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });

      const result = await authService.resetPassword({
        identifier: TEST_EMAIL,
        code: '123456',
        new_password: TEST_NEW_PASSWORD,
        confirm_new_password: TEST_NEW_PASSWORD,
      });

      expect(otpStore.verifyAndConsumeOtp).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_EMAIL,
        '123456',
        expect.any(Function),
        'reset_password',
      );
      expect(approvals.revokeAllUserSessions).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.anything(),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `http://supabase.test/auth/v1/admin/users/${TEST_USER_ID}`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ password: TEST_NEW_PASSWORD }),
        }),
      );
      expect(
        database.query.mock.calls.some(([sql]) =>
          String(sql).includes('auth.refresh_tokens'),
        ),
      ).toBe(true);
      expect(
        database.query.mock.calls.some(([sql]) =>
          String(sql).includes('auth.sessions'),
        ),
      ).toBe(true);
      expect(result).toEqual({
        password_reset: true,
      });
      expect(database.transaction).toHaveBeenNthCalledWith(
        1,
        TEST_USER_ID,
        expect.any(Function),
        true,
        false,
        false,
      );
    });

    it('runs the inner resetPassword transaction with useServiceRole=false so auth.users subqueries never fail with 42501 permission denied (swallowed as 503 SERVICE_UNAVAILABLE)', async () => {
      let roleSwitchedToServiceRole = false;
      const roleCheckingDb = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SET LOCAL ROLE service_role')) {
            roleSwitchedToServiceRole = true;
            return [];
          }
          if (sql.includes('FROM auth.users') && roleSwitchedToServiceRole) {
            throw Object.assign(
              new Error('permission denied for table users'),
              { code: '42501' },
            );
          }
          if (typeof sql === 'string' && sql.includes('FROM public.users')) {
            return [
              {
                id: TEST_USER_ID,
                email: TEST_EMAIL,
                status: 'active',
                verified_contact: true,
                provider_subject: TEST_USER_ID,
                verified_at: '2026-01-01T00:00:00Z',
              },
            ];
          }
          return [];
        }),
        transaction: vi.fn(
          async (
            _id: string | null,
            op: (db: EntityManager) => Promise<unknown>,
            active?: boolean,
            foreground?: boolean,
            useServiceRole = true,
          ) => {
            void active;
            void foreground;
            roleSwitchedToServiceRole = false;
            if (useServiceRole) {
              await roleCheckingDb.query('SET LOCAL ROLE service_role');
            }
            const txDb = {
              query: roleCheckingDb.query,
            } as unknown as EntityManager;
            return op(txDb);
          },
        ),
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });

      const realStoreAuthService = new AuthService(
        roleCheckingDb as unknown as DatabaseService,
        config,
        abuse as unknown as AuthAbuseControl,
        approvals as unknown as SessionApprovalService,
        otpStore as unknown as OtpSecretStore,
        emailProvider as unknown as EmailRegistrationProvider,
      );

      const res = await realStoreAuthService.resetPassword({
        identifier: TEST_EMAIL,
        code: '123456',
        new_password: TEST_NEW_PASSWORD,
        confirm_new_password: TEST_NEW_PASSWORD,
      });

      expect(res).toEqual({ password_reset: true });
    });

    it('exercises real DatabaseService.transaction to acquire advisory lock before public.users FOR UPDATE, avoids duplicate callback locks, and runs GoTrue PUT strictly after preflight commit', async () => {
      let openTransactions = 0;
      let goTrueSawOpenTx = false;
      const callOrder: string[] = [];
      let txSeq = 0;
      let preflightAdvisoryLockCount = 0;

      const queryHandler = vi.fn(async (sql: string) => {
        if (
          typeof sql === 'string' &&
          sql.includes('pg_advisory_xact_lock(hashtext($1::text))')
        ) {
          if (txSeq === 1) preflightAdvisoryLockCount += 1;
          callOrder.push('advisory_lock');
          return [];
        }
        if (
          typeof sql === 'string' &&
          sql.includes('pg_advisory_xact_lock(hashtextextended')
        ) {
          return [];
        }
        if (
          typeof sql === 'string' &&
          sql.includes('SELECT status FROM public.users WHERE id=$1 FOR UPDATE')
        ) {
          callOrder.push('wrapper_users_for_update');
          return [{ status: 'active' }];
        }
        if (
          typeof sql === 'string' &&
          sql.includes('FROM public.users') &&
          sql.includes('FOR UPDATE')
        ) {
          callOrder.push('callback_users_for_update');
          return [
            {
              status: 'active',
              suspended_at: null,
              auth_deleted_at: null,
            },
          ];
        }
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: 'google-sub-123',
              verified_at: '2026-01-01T00:00:00Z',
              is_oauth_provider: true,
              has_verified_channel_provider: false,
              has_verified_email_provider: false,
              needs_auth_confirm: false,
              needs_auth_contact_sync: false,
            },
          ];
        }
        return [];
      });

      const fakeDataSource = {
        query: queryHandler,
        createQueryRunner: vi.fn(() => {
          txSeq += 1;
          const label =
            txSeq === 1
              ? 'preflight'
              : txSeq === 2
                ? 'local_revoke'
                : 'cleanup';
          return {
            connect: vi.fn(async () => undefined),
            startTransaction: vi.fn(async () => {
              openTransactions += 1;
              callOrder.push(`tx_begin:${label}`);
            }),
            manager: { query: queryHandler },
            commitTransaction: vi.fn(async () => {
              callOrder.push(`tx_commit:${label}`);
              openTransactions -= 1;
            }),
            rollbackTransaction: vi.fn(async () => {
              callOrder.push(`tx_rollback:${label}`);
              openTransactions -= 1;
            }),
            release: vi.fn(async () => undefined),
          };
        }),
      } as unknown as DataSource;

      const realDatabaseService = new DatabaseService(fakeDataSource);

      const trackingApprovals = {
        revokeAllUserSessions: vi.fn(async () => {
          callOrder.push('revoke_approved_sessions');
          return 1;
        }),
      };

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
        async () => {
          callOrder.push('gotrue_put');
          if (openTransactions > 0) {
            goTrueSawOpenTx = true;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: TEST_USER_ID }),
          };
        },
      );

      const trackedService = new AuthService(
        realDatabaseService,
        config,
        abuse as unknown as AuthAbuseControl,
        trackingApprovals as unknown as SessionApprovalService,
        otpStore as unknown as OtpSecretStore,
        emailProvider as unknown as EmailRegistrationProvider,
      );

      const res = await trackedService.resetPassword({
        identifier: TEST_EMAIL,
        code: '123456',
        new_password: TEST_NEW_PASSWORD,
        confirm_new_password: TEST_NEW_PASSWORD,
      });

      expect(res).toEqual({ password_reset: true });
      expect(goTrueSawOpenTx).toBe(false);
      // Real DatabaseService.transaction acquired advisory lock once (no duplicate lock inside callback)
      expect(preflightAdvisoryLockCount).toBe(1);
      expect(callOrder.indexOf('advisory_lock')).toBeLessThan(
        callOrder.indexOf('wrapper_users_for_update'),
      );
      expect(callOrder.indexOf('tx_commit:preflight')).toBeLessThan(
        callOrder.indexOf('gotrue_put'),
      );
      expect(callOrder.indexOf('gotrue_put')).toBeLessThan(
        callOrder.indexOf('revoke_approved_sessions'),
      );
    });

    it('maps GoTrue 422 weak_password and same_password to application-owned 422 PASSWORD_POLICY_FAILED (never raw provider text or broad fallback on unrelated error_code) and does NOT revoke existing sessions', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          code: 422,
          error_code: 'weak_password',
          msg: 'RAW provider leak: pwned password internal reason',
        }),
      });

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PASSWORD_POLICY_FAILED',
          message:
            'Password does not meet security requirements. Choose a stronger password with a mix of letters, numbers, and symbols.',
          details: [
            expect.objectContaining({
              field: 'new_password',
              code: 'PASSWORD_POLICY_FAILED',
              message:
                'Password does not meet security requirements. Choose a stronger password with a mix of letters, numbers, and symbols.',
            }),
          ],
        }),
      });
      expect(approvals.revokeAllUserSessions).not.toHaveBeenCalled();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          code: 422,
          error_code: 'same_password',
          msg: 'New password should be different from the old password.',
        }),
      });

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PASSWORD_POLICY_FAILED',
          message: 'New password must be different from your current password.',
        }),
      });
      expect(approvals.revokeAllUserSessions).not.toHaveBeenCalled();

      // Unrelated GoTrue error_code mentioning "password" must NOT map to PASSWORD_POLICY_FAILED
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          code: 422,
          error_code: 'user_banned',
          msg: 'User cannot change password right now',
        }),
      });

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 502,
        response: expect.objectContaining({
          code: 'PROVIDER_ERROR',
        }),
      });
      expect(approvals.revokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('retries local sync even if GoTrue session cleanup throws, records unfinished cleanup metadata, and returns distinct partial-completion result when only local sync fails', async () => {
      const recordCleanup = vi.fn(async () => undefined);
      const abuseWithTracking = {
        ...abuse,
        recordUnfinishedPasswordResetCleanup: recordCleanup,
      };

      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      // Case 1: Both local sync attempts fail AND GoTrue session cleanup fails -> retry still runs, never claims local sessions were revoked
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });

      let txCount = 0;
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          txCount += 1;
          if (txCount === 1) {
            return op({ query: database.query } as unknown as EntityManager);
          }
          const err = new Error('statement timeout');
          (err as { code?: string }).code = '57014';
          throw err;
        },
      );

      const trackedService = new AuthService(
        database as unknown as DatabaseService,
        config,
        abuseWithTracking as unknown as AuthAbuseControl,
        approvals as unknown as SessionApprovalService,
        otpStore as unknown as OtpSecretStore,
        emailProvider as unknown as EmailRegistrationProvider,
      );

      await expect(
        trackedService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 504,
        response: expect.objectContaining({
          code: 'PROVIDER_TIMEOUT',
          retryable: false,
          message: expect.stringContaining(
            'local session sync and auth session revocation did not complete',
          ),
        }),
      });
      // 1 preflight + 1 initial local sync + 3 GoTrue cleanup attempts + 1 local sync retry = 6 transactions
      expect(txCount).toBe(6);
      expect(recordCleanup).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          localSyncPending: true,
          goTrueRevocationPending: true,
          channel: 'email',
        }),
      );

      // Case 2: GoTrue password update & GoTrue cleanup succeed, but both local sync attempts fail -> returns distinct partial-completion result (never retryable 503 asking to resubmit OTP)
      recordCleanup.mockClear();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });
      let txCount2 = 0;
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          txCount2 += 1;
          // tx 1 = preflight (ok), tx 2 = local sync #1 (fail), tx 3 = GoTrue cleanup (ok), tx 4 = local sync retry (fail)
          if (txCount2 === 2 || txCount2 === 4) {
            throw new Error('local sync db failure');
          }
          return op({ query: database.query } as unknown as EntityManager);
        },
      );

      const partialRes = await trackedService.resetPassword({
        identifier: TEST_EMAIL,
        code: '123456',
        new_password: TEST_NEW_PASSWORD,
        confirm_new_password: TEST_NEW_PASSWORD,
      });

      expect(partialRes).toEqual({
        password_reset: true,
        cleanup_status: 'partial',
        account_ready_for_signin: true,
        pending_cleanup: {
          local_session_revocation: true,
          local_session_sync: true,
          channel_mapping_sync: false,
          provider_session_revocation: false,
        },
        message:
          'Password was updated, but local session cleanup is still pending. Sign in with your new password.',
      });
      expect(recordCleanup).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          localSyncPending: true,
          localSessionRevocationPending: true,
          accountSyncPending: false,
          fallbackBootstrapPending: false,
          goTrueRevocationPending: false,
          channel: 'email',
        }),
      );

      // Case 3: Fallback account bootstrap fails while local session revocation commits independently -> returns pending_account_bootstrap and NEVER directs user to sign in
      recordCleanup.mockClear();
      approvals.revokeAllUserSessions.mockClear();
      const fallbackAuthRow = {
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        phone: null,
        email_confirmed_at: '2026-01-01T00:00:00Z',
        phone_confirmed_at: null,
        oauth_provider: null,
        oauth_subject: null,
        oauth_confirmed_at: null,
        app_status: null,
        app_verified_contact: null,
      };
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users u')) {
          return [];
        }
        if (typeof sql === 'string' && sql.includes('FROM auth.users u')) {
          return [fallbackAuthRow];
        }
        return [];
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });
      let fallbackTxCount = 0;
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          fallbackTxCount += 1;
          // tx 1 = preflight (ok), tx 2 = local session revocation (ok),
          // tx 3 = fallback bootstrap #1 (fail), tx 4 = GoTrue cleanup (ok), tx 5 = fallback bootstrap retry (fail)
          if (fallbackTxCount === 3 || fallbackTxCount === 5) {
            throw new Error('bootstrap write failed');
          }
          return op({ query: database.query } as unknown as EntityManager);
        },
      );

      const bootstrapPendingRes = await trackedService.resetPassword({
        identifier: TEST_EMAIL,
        code: '123456',
        new_password: TEST_NEW_PASSWORD,
        confirm_new_password: TEST_NEW_PASSWORD,
      });

      expect(approvals.revokeAllUserSessions).toHaveBeenCalledTimes(1);
      expect(bootstrapPendingRes).toEqual({
        password_reset: true,
        cleanup_status: 'pending_account_bootstrap',
        account_ready_for_signin: false,
        pending_cleanup: {
          local_session_revocation: false,
          account_bootstrap: true,
          channel_mapping_sync: false,
          provider_session_revocation: false,
        },
        message: expect.not.stringMatching(/sign in with your new password/i),
      });
      expect(recordCleanup).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          localSessionRevocationPending: false,
          accountSyncPending: true,
          fallbackBootstrapPending: true,
          goTrueRevocationPending: false,
        }),
      );

      // Case 4: Verified OAuth application account requires channel mapping sync (needsChannelSync=true)
      // and both post-password-update sync attempts fail -> returns pending_account_sync with account_ready_for_signin=false (never directs user to sign in)
      recordCleanup.mockClear();
      approvals.revokeAllUserSessions.mockClear();
      const oauthAccountRow = {
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        status: 'active',
        verified_contact: true,
        provider_subject: 'google-sub-123',
        verified_at: '2026-01-01T00:00:00Z',
        is_oauth_provider: true,
        has_verified_channel_provider: false,
        has_verified_email_provider: false,
        needs_auth_confirm: false,
        needs_auth_contact_sync: false,
      };
      database.query.mockImplementation(async (sql: string) => {
        if (
          typeof sql === 'string' &&
          sql.includes('FROM public.users') &&
          sql.includes('FOR UPDATE')
        ) {
          return [
            {
              status: 'active',
              suspended_at: null,
              auth_deleted_at: null,
              verified_contact: true,
              current_contact: TEST_EMAIL,
            },
          ];
        }
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [oauthAccountRow];
        }
        return [];
      });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });
      let oauthTxCount = 0;
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          oauthTxCount += 1;
          // tx 1 = preflight (ok), tx 2 = local session revocation (ok),
          // tx 3 = channel mapping sync #1 (fail), tx 4 = GoTrue cleanup (ok), tx 5 = channel mapping sync retry (fail)
          if (oauthTxCount === 3 || oauthTxCount === 5) {
            throw new Error('channel mapping sync failed');
          }
          return op({ query: database.query } as unknown as EntityManager);
        },
      );

      const oauthSyncPendingRes = await trackedService.resetPassword({
        identifier: TEST_EMAIL,
        code: '123456',
        new_password: TEST_NEW_PASSWORD,
        confirm_new_password: TEST_NEW_PASSWORD,
      });

      expect(approvals.revokeAllUserSessions).toHaveBeenCalledTimes(1);
      expect(oauthSyncPendingRes).toEqual({
        password_reset: true,
        cleanup_status: 'pending_account_sync',
        account_ready_for_signin: false,
        pending_cleanup: {
          local_session_revocation: false,
          account_bootstrap: false,
          channel_mapping_sync: true,
          provider_session_revocation: false,
        },
        message: expect.not.stringMatching(/sign in with your new password/i),
      });
      expect(recordCleanup).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          localSessionRevocationPending: false,
          accountSyncPending: true,
          fallbackBootstrapPending: false,
          channelMappingSyncPending: true,
          goTrueRevocationPending: false,
          contactHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );

      // Case 5: Consumable reconciliation retries pending channel mapping sync using authoritative auth.users contact verified against contactHash
      const recordedCleanupMeta = (
        recordCleanup.mock.calls[
          recordCleanup.mock.calls.length - 1
        ] as unknown[]
      )?.[1];
      const getCleanup = vi.fn(async () => recordedCleanupMeta);
      const clearCleanup = vi.fn(async () => undefined);
      const clearOp = vi.fn(async () => undefined);
      const reconcileService = new AuthService(
        database as unknown as DatabaseService,
        config,
        {
          ...abuseWithTracking,
          getUnfinishedPasswordResetCleanup: getCleanup,
          clearUnfinishedPasswordResetCleanup: clearCleanup,
          clearPasswordResetOperation: clearOp,
        } as unknown as AuthAbuseControl,
        approvals as unknown as SessionApprovalService,
        otpStore as unknown as OtpSecretStore,
        emailProvider as unknown as EmailRegistrationProvider,
      );
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM auth.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              phone: null,
              email_confirmed_at: '2026-01-01T00:00:00Z',
              phone_confirmed_at: null,
            },
          ];
        }
        return [];
      });
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => op({ query: database.query } as unknown as EntityManager),
      );
      const reconRes =
        await reconcileService.reconcilePendingPasswordResetCleanup(
          TEST_USER_ID,
        );
      expect(reconRes).toEqual({
        found: true,
        completed: true,
        remaining: {
          local_session_revocation: false,
          account_bootstrap: false,
          channel_mapping_sync: false,
          provider_session_revocation: false,
        },
      });
      expect(clearCleanup).toHaveBeenCalledWith(TEST_USER_ID);
    });

    it('records pre-GoTrue operation state, clears it on confirmed rejection, and marks provider_uncertain without revoking sessions on provider timeout', async () => {
      const recordOp = vi.fn(async () => undefined);
      const clearOp = vi.fn(async () => undefined);
      const recordCleanup = vi.fn(async () => undefined);
      const trackedService = new AuthService(
        database as unknown as DatabaseService,
        config,
        {
          ...abuse,
          recordPasswordResetOperation: recordOp,
          clearPasswordResetOperation: clearOp,
          recordUnfinishedPasswordResetCleanup: recordCleanup,
        } as unknown as AuthAbuseControl,
        approvals as unknown as SessionApprovalService,
        otpStore as unknown as OtpSecretStore,
        emailProvider as unknown as EmailRegistrationProvider,
      );

      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      // Confirmed 422 rejection -> clears operation record, does NOT revoke sessions or mark uncertain
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          code: 422,
          error_code: 'weak_password',
          msg: 'weak',
        }),
      });
      await expect(
        trackedService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(recordOp).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ status: 'pending_provider_update' }),
      );
      expect(clearOp).toHaveBeenCalledWith(TEST_USER_ID);
      expect(recordCleanup).not.toHaveBeenCalled();
      expect(approvals.revokeAllUserSessions).not.toHaveBeenCalled();

      // Uncertain 504 timeout -> marks provider_uncertain and records cleanup metadata without revoking sessions
      recordOp.mockClear();
      clearOp.mockClear();
      recordCleanup.mockClear();
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        abortErr,
      );
      await expect(
        trackedService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({ status: 504 });
      expect(recordOp).toHaveBeenLastCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ status: 'provider_uncertain' }),
      );
      expect(recordCleanup).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({ providerUpdateUncertain: true }),
      );
      expect(approvals.revokeAllUserSessions).not.toHaveBeenCalled();
    });

    it('returns 504 PROVIDER_TIMEOUT when GoTrue session revocation times out after password commit', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });

      let txCount = 0;
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          txCount++;
          if (txCount === 1) {
            const txDb = { query: database.query } as unknown as EntityManager;
            return op(txDb);
          }
          const timeoutErr = new Error('statement timeout');
          (timeoutErr as { code?: string }).code = '57014';
          throw timeoutErr;
        },
      );

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 504,
        response: expect.objectContaining({
          code: 'PROVIDER_TIMEOUT',
        }),
      });
    });

    it('returns 502 PROVIDER_ERROR when GoTrue session revocation fails with a database error', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: TEST_USER_ID }),
      });

      let txCount = 0;
      database.transaction.mockImplementation(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          txCount++;
          if (txCount === 1) {
            const txDb = { query: database.query } as unknown as EntityManager;
            return op(txDb);
          }
          throw new Error('Database connection failed');
        },
      );

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 502,
        response: expect.objectContaining({
          code: 'PROVIDER_ERROR',
        }),
      });
    });

    it('returns 422 VERIFICATION_CODE_INVALID when known account submits wrong OTP code per C05/Q04', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('FROM public.users')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              status: 'active',
              verified_contact: true,
              provider_subject: TEST_USER_ID,
            },
          ];
        }
        return [];
      });

      otpStore.verifyAndConsumeOtp.mockImplementationOnce(async () => {
        fail(422, 'VERIFICATION_CODE_INVALID', 'Verification code is invalid');
      });

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '654321',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'VERIFICATION_CODE_INVALID',
        }),
      });
    });

    it('returns 410 anti-enumeration when identifier does not exist', async () => {
      database.query.mockResolvedValueOnce([]);

      await expect(
        authService.resetPassword({
          identifier: 'unknown@example.com',
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({
          code: 'VERIFICATION_CODE_EXPIRED',
        }),
      });
    });

    it('returns 422 PASSWORD_MISMATCH when confirm_new_password does not match', async () => {
      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: 'MismatchPassword!999',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'VALIDATION_FAILED',
        }),
      });
    });

    it('returns 422 PASSWORD_POLICY_FAILED when password is shorter than 8 characters', async () => {
      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: 'Short1!',
          confirm_new_password: 'Short1!',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PASSWORD_POLICY_FAILED',
        }),
      });
    });

    it('returns 422 PASSWORD_POLICY_FAILED when password is all numeric', async () => {
      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: '1234567890',
          confirm_new_password: '1234567890',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PASSWORD_POLICY_FAILED',
        }),
      });
    });

    it('returns 422 when OTP code is not 6 digits', async () => {
      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'VALIDATION_FAILED',
        }),
      });
    });

    it('returns 403 ACCOUNT_SUSPENDED when valid OTP is submitted for suspended account', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          status: 'suspended',
          verified_contact: true,
          provider_subject: TEST_USER_ID,
        },
      ]);

      database.transaction.mockImplementationOnce(async () => {
        fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
      });

      await expect(
        authService.resetPassword({
          identifier: TEST_EMAIL,
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'ACCOUNT_SUSPENDED',
        }),
      });
    });

    it('returns 503 SERVICE_UNAVAILABLE when phone reset is attempted', async () => {
      await expect(
        authService.resetPassword({
          identifier: '+8801712345678',
          code: '123456',
          new_password: TEST_NEW_PASSWORD,
          confirm_new_password: TEST_NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });
  });

  describe('ApiExceptionFilter serialization on password recovery errors', () => {
    it('serializes 429 RESEND_COOLDOWN_ACTIVE into canonical single-envelope structure with Retry-After', () => {
      const filter = new ApiExceptionFilter();
      const setHeaderFn = vi.fn();
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });

      const mockResponse = {
        status: statusFn,
        setHeader: setHeaderFn,
        getHeader: vi.fn().mockReturnValue('req-recovery-123'),
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;

      try {
        fail(429, 'RESEND_COOLDOWN_ACTIVE', 'Cooldown active', [], true, 60);
      } catch (err: unknown) {
        filter.catch(err, mockHost);
      }

      expect(statusFn).toHaveBeenCalledWith(429);
      expect(setHeaderFn).toHaveBeenCalledWith('Retry-After', 60);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'RESEND_COOLDOWN_ACTIVE',
            message: 'Cooldown active',
            requestId: 'req-recovery-123',
            retryAfterSeconds: 60,
          }),
        }),
      );
    });
  });
});
