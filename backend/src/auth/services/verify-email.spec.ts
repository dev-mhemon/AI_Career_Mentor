import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import type { DatabaseService } from './database.service.js';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import type { SessionApprovalService } from './session-approval.service.js';
import type { OtpSecretStore } from './otp-secret-store.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const email = 'candidate@example.invalid';
const code = '123456';

function createJwt(claims: Record<string, unknown>): string {
  const encode = (val: object) =>
    Buffer.from(JSON.stringify(val)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.synthetic_signature`;
}

describe('M01-04 EP-A02 POST /api/v1/auth/verify-email', () => {
  let config: ConfigService;
  let database: {
    query: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let abuse: AuthAbuseControl;
  let approvals: { approve: ReturnType<typeof vi.fn> };
  let otpStore: {
    generateOtp: ReturnType<typeof vi.fn>;
    computeDigest: ReturnType<typeof vi.fn>;
    storeOtp: ReturnType<typeof vi.fn>;
    verifyAndConsumeOtp: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;

  const validToken = createJwt({
    sub: userId,
    session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    amr: [{ method: 'otp' }],
  });

  beforeEach(() => {
    config = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
        if (key === 'SERVICE_ROLE_KEY') return 'service-role-key';
        return undefined;
      }),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'http://supabase.invalid';
        if (key === 'SUPABASE_ANON_KEY') return 'anon-key';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
        throw new Error(`Missing ${key}`);
      }),
    } as unknown as ConfigService;

    database = {
      query: vi.fn(),
      transaction: vi.fn(
        async (_id: string, op: (db: EntityManager) => Promise<unknown>) => {
          const txDb = {
            query: vi.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('UPDATE public.users')) {
                return [[], 1];
              }
              if (sql.includes('UPDATE public.user_auth_providers')) {
                return [[], 1];
              }
              if (sql.includes('INSERT INTO public.user_profiles')) {
                return [];
              }
              if (sql.includes('INSERT INTO public.user_preferences')) {
                return [];
              }
              if (sql.includes('SELECT u.id,u.email')) {
                return [
                  {
                    id: userId,
                    email,
                    phone: null,
                    status: 'active',
                    verified_contact: true,
                    role: 'USER',
                    linked_providers: ['email'],
                  },
                ];
              }
              if (sql.includes('SELECT p.*,pr.learning_preference')) {
                return [];
              }
              if (sql.includes('effective_feature_access')) {
                return [{ enabled: true }];
              }
              return [];
            }),
          } as unknown as EntityManager;
          return op(txDb);
        },
      ),
    };

    abuse = {} as AuthAbuseControl;

    approvals = {
      approve: vi.fn().mockResolvedValue(undefined),
    };

    otpStore = {
      generateOtp: vi.fn().mockReturnValue('123456'),
      computeDigest: vi.fn().mockReturnValue('mock-digest'),
      storeOtp: vi.fn().mockResolvedValue(undefined),
      verifyAndConsumeOtp: vi.fn(
        async (
          _userId: string,
          _email: string,
          _code: string,
          onValid?: () => Promise<void>,
        ) => {
          await onValid?.();
        },
      ),
    };

    service = new AuthService(
      database as unknown as DatabaseService,
      config,
      abuse,
      approvals as unknown as SessionApprovalService,
      otpStore as unknown as OtpSecretStore,
    );

    // Default mock fetch for GoTrue Admin PUT + generate_link + verify
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/admin/users/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: userId, email }),
          };
        }
        if (url.includes('/auth/v1/admin/generate_link')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              hashed_token: 'valid_magiclink_token_hash',
            }),
          };
        }
        if (url.includes('/auth/v1/verify')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: validToken,
              refresh_token: 'refresh_token_synthetic',
              expires_in: 3600,
              token_type: 'bearer',
              user: { id: userId, email },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Happy path & Session Approval', () => {
    it('verifies OTP, confirms GoTrue, executes DB transaction, and approves session', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      const result = await service.verifyEmail({ email, code }, {} as Request);

      // 1. OTP verified and atomically consumed
      expect(otpStore.verifyAndConsumeOtp).toHaveBeenCalledWith(
        userId,
        email,
        code,
        expect.any(Function),
      );

      // 2. GoTrue admin PUT called with email_confirm: true
      expect(fetch).toHaveBeenCalledWith(
        `http://supabase.invalid/auth/v1/admin/users/${userId}`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ email_confirm: true }),
        }),
      );

      // 3. Database transaction executed
      expect(database.transaction).toHaveBeenCalledWith(
        userId,
        expect.any(Function),
        false,
      );

      // 4. Session approved via SessionApprovalService with email_verification
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        sessionId,
        'email_verification',
      );

      // 5. AuthSessionDTO returned with next_step: profile_setup
      expect(result).toMatchObject({
        access_token: validToken,
        refresh_token: 'refresh_token_synthetic',
        token_type: 'Bearer',
        next_step: 'profile_setup',
        user: {
          id: userId,
          email,
          verified_contact: true,
        },
      });
    });
  });

  describe('Step 1: Validation and Already Verified check', () => {
    it('throws 409 ALREADY_VERIFIED when user already has verified_contact: true in DB', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: true,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_VERIFIED' },
      });

      expect(otpStore.verifyAndConsumeOtp).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws 409 ALREADY_VERIFIED when provider already has verified_at set in DB', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: '2026-01-01T00:00:00Z',
        },
      ]);

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_VERIFIED' },
      });

      expect(otpStore.verifyAndConsumeOtp).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('throws 410 OTP_EXPIRED when user is not found in public.users', async () => {
      database.query.mockResolvedValueOnce([]); // public.users + provider check

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 410,
        response: { code: 'OTP_EXPIRED' },
      });

      expect(otpStore.verifyAndConsumeOtp).not.toHaveBeenCalled();
    });

    it('rejects invalid email or code format with 422 VALIDATION_FAILED', async () => {
      await expect(
        service.verifyEmail({ email: 'not-an-email', code }, {} as Request),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });

      await expect(
        service.verifyEmail({ email, code: '123' }, {} as Request),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('Step 3: Zero-Row 409 Guard & Serialized Transaction', () => {
    it('throws 409 ALREADY_VERIFIED and rolls back if public.users update returns 0 affected rows', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      database.transaction.mockImplementation(
        async (_id: string, op: (db: EntityManager) => Promise<unknown>) => {
          const txDb = {
            query: vi.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('UPDATE public.users')) {
                // 0 rows affected
                return [[], 0];
              }
              if (sql.includes('UPDATE public.user_auth_providers')) {
                return [[], 1];
              }
              return [];
            }),
          } as unknown as EntityManager;
          return op(txDb);
        },
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_VERIFIED' },
      });

      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('throws 409 ALREADY_VERIFIED and rolls back if public.user_auth_providers update returns 0 affected rows', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      database.transaction.mockImplementation(
        async (_id: string, op: (db: EntityManager) => Promise<unknown>) => {
          const txDb = {
            query: vi.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('UPDATE public.users')) {
                return [[], 1];
              }
              if (sql.includes('UPDATE public.user_auth_providers')) {
                // 0 rows affected
                return [[], 0];
              }
              return [];
            }),
          } as unknown as EntityManager;
          return op(txDb);
        },
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_VERIFIED' },
      });

      expect(approvals.approve).not.toHaveBeenCalled();
    });
  });

  describe('Failure Boundary 2 Recovery (AT-10)', () => {
    it('handles idempotent GoTrue confirm when email_confirm was previously set and completes recovery', async () => {
      // User was registered, GoTrue confirmed, but previous DB transaction failed before setting verified_contact
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      // GoTrue returns 422 with 'already confirmed'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/auth/v1/admin/users/')) {
            return {
              ok: false,
              status: 422,
              json: async () => ({ msg: 'Email is already confirmed' }),
            };
          }
          if (url.includes('/auth/v1/admin/generate_link')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                hashed_token: 'valid_magiclink_token_hash',
              }),
            };
          }
          if (url.includes('/auth/v1/verify')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                access_token: validToken,
                refresh_token: 'refresh_token_synthetic',
                expires_in: 3600,
                token_type: 'bearer',
                user: { id: userId, email },
              }),
            };
          }
          return { ok: false, status: 404, json: async () => ({}) };
        }),
      );

      const result = await service.verifyEmail({ email, code }, {} as Request);

      // Successfully completes DB transaction and session approval
      expect(result.user.verified_contact).toBe(true);
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        sessionId,
        'email_verification',
      );
    });
  });

  describe('Upstream Provider Failures', () => {
    it('maps GoTrue timeout to 504 PROVIDER_TIMEOUT', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/auth/v1/admin/users/')) {
            const err = new Error('The operation was aborted due to timeout');
            err.name = 'AbortError';
            throw err;
          }
          return { ok: true, json: async () => ({}) };
        }),
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 504,
        response: { code: 'PROVIDER_TIMEOUT' },
      });
    });

    it('maps GoTrue 500 error to 502 EMAIL_PROVIDER_ERROR', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/auth/v1/admin/users/')) {
            return {
              ok: false,
              status: 500,
              json: async () => ({ msg: 'Internal upstream error' }),
            };
          }
          return { ok: true, json: async () => ({}) };
        }),
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 502,
        response: { code: 'EMAIL_PROVIDER_ERROR' },
      });
    });
  });

  describe('Post-Commit vs Pre-Commit Boundaries & Step 4 Failures', () => {
    it('suppresses post-commit Redis valid-step cleanup failure and still completes session minting', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      otpStore.verifyAndConsumeOtp = vi.fn(
        async (
          _userId: string,
          _email: string,
          _code: string,
          onValid?: () => Promise<void>,
        ) => {
          await onValid?.();
          // Simulate Redis failure during post-commit valid step / cleanup
          throw new HttpException(
            { code: 'SERVICE_UNAVAILABLE', retryable: true },
            503,
          );
        },
      );

      const result = await service.verifyEmail({ email, code }, {} as Request);
      expect(result.user.verified_contact).toBe(true);
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        sessionId,
        'email_verification',
      );
    });

    it('propagates pre-commit DB failure and does not reach mintAndApproveSession', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      database.transaction.mockRejectedValueOnce(
        new Error('Database transaction lock acquisition failure'),
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toThrow();

      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('returns retryable: false directing user to login if generate_link times out at Step 4', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/auth/v1/admin/users/')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: userId, email }),
            };
          }
          if (url.includes('/auth/v1/admin/generate_link')) {
            const err = new Error('Operation timed out');
            err.name = 'AbortError';
            throw err;
          }
          return { ok: false, status: 404, json: async () => ({}) };
        }),
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 504,
        response: {
          code: 'PROVIDER_TIMEOUT',
          message: expect.stringMatching(
            /sign in with your email and password/i,
          ),
          retryable: false,
        },
      });
    });

    it('returns retryable: false directing user to login if generate_link fails with 500 at Step 4', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          verified_contact: false,
          provider_subject: userId,
          verified_at: null,
        },
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/auth/v1/admin/users/')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: userId, email }),
            };
          }
          if (url.includes('/auth/v1/admin/generate_link')) {
            return {
              ok: false,
              status: 500,
              json: async () => ({ msg: 'Internal provider error' }),
            };
          }
          return { ok: false, status: 404, json: async () => ({}) };
        }),
      );

      await expect(
        service.verifyEmail({ email, code }, {} as Request),
      ).rejects.toMatchObject({
        status: 502,
        response: {
          code: 'EMAIL_PROVIDER_ERROR',
          message: expect.stringMatching(
            /sign in with your email and password/i,
          ),
          retryable: false,
        },
      });
    });
  });
});
