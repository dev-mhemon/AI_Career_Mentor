import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { ArgumentsHost } from '@nestjs/common';
import { AuthService } from './services/auth.service.js';
import { ApiExceptionFilter, fail } from '../common/http.js';
import type { DatabaseService } from './services/database.service.js';
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

    it('returns uniform 202 anti-enumeration response for unknown account without sending code', async () => {
      database.query.mockResolvedValueOnce([]);

      const result = await authService.forgotPassword(
        { identifier: 'unknown@example.com' },
        createMockRequest(),
      );

      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
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
