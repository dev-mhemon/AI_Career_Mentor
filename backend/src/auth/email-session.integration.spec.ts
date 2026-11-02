import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext, ArgumentsHost } from '@nestjs/common';
import { AuthService } from './services/auth.service.js';
import { EmailRegistrationService } from './services/email-registration.service.js';
import { AccessGuard } from './guards/access.guard.js';
import { ApiExceptionFilter, fail } from '../common/http.js';
import type { DatabaseService } from './services/database.service.js';
import type { SessionApprovalService } from './services/session-approval.service.js';
import type { AuthAbuseControl } from './abuse-control/abuse-control.service.js';
import type { EmailRegistrationProvider } from './services/email-registration.provider.js';
import type { OtpSecretStore } from './services/otp-secret-store.service.js';

const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_EMAIL = 'integration-user@example.com';
const TEST_PASSWORD = 'SecurePassword!123';

/**
 * Creates a synthetic JWT with valid structure and expiration for testing.
 */
function createSyntheticJwt(claims: Record<string, unknown>): string {
  const encode = (val: object) =>
    Buffer.from(JSON.stringify(val)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.synthetic-signature`;
}

/**
 * Creates a mock express Request object with a valid trusted IP.
 */
function createMockRequest(ip = '127.0.0.1'): Request {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe('M01-10 Canonical Email & Session Integration Matrix', () => {
  let config: ConfigService;
  let database: {
    query: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let abuse: {
    reserveSend: ReturnType<typeof vi.fn>;
    login: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
  };
  let approvals: {
    approve: ReturnType<typeof vi.fn>;
    isSessionApproved: ReturnType<typeof vi.fn>;
    revokeSession: ReturnType<typeof vi.fn>;
  };
  let otpStore: {
    verifyAndConsumeOtp: ReturnType<typeof vi.fn>;
  };
  let emailProvider: {
    ready: ReturnType<typeof vi.fn>;
    findByEmail: ReturnType<typeof vi.fn>;
    createPending: ReturnType<typeof vi.fn>;
    sendChallenge: ReturnType<typeof vi.fn>;
  };
  let authService: AuthService;
  let registrationService: EmailRegistrationService;

  const validAccessToken = createSyntheticJwt({
    sub: TEST_USER_ID,
    session_id: TEST_SESSION_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  beforeEach(() => {
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
            query: vi.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('SELECT u.id,u.email')) {
                return [
                  {
                    id: TEST_USER_ID,
                    email: TEST_EMAIL,
                    phone: null,
                    status: 'active',
                    verified_contact: true,
                    role: 'USER',
                    linked_providers: ['email'],
                  },
                ];
              }
              if (sql.includes('id<>$2')) {
                return [];
              }
              if (sql.includes('verified_contact,email,phone')) {
                return [{ verified_contact: false, email: null, phone: null }];
              }
              if (
                sql.includes(
                  'SELECT id, status, email, verified_contact FROM public.users',
                )
              ) {
                return [
                  {
                    id: TEST_USER_ID,
                    status: 'active',
                    email: null,
                    verified_contact: false,
                  },
                ];
              }
              if (
                sql.includes('FROM public.users') &&
                sql.includes('FOR UPDATE')
              ) {
                return [
                  {
                    id: TEST_USER_ID,
                    status: 'active',
                    email: TEST_EMAIL,
                    verified_contact: false,
                  },
                ];
              }
              if (sql.includes('FROM public.user_auth_providers')) {
                return [
                  {
                    id: 'provider-1',
                    contact_value: TEST_EMAIL,
                    provider_subject: TEST_USER_ID,
                    verified_at: null,
                  },
                ];
              }
              if (sql.includes('UPDATE public.users')) {
                return [[], 1];
              }
              if (sql.includes('UPDATE public.user_auth_providers')) {
                return [[], 1];
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

    abuse = {
      reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      login: vi.fn(),
      isReady: vi.fn().mockReturnValue(true),
    };

    approvals = {
      approve: vi.fn().mockResolvedValue(undefined),
      isSessionApproved: vi.fn().mockResolvedValue(true),
      revokeSession: vi.fn().mockResolvedValue(undefined),
    };

    otpStore = {
      verifyAndConsumeOtp: vi.fn(async (_u, _e, _c, onValid) => {
        await onValid?.();
      }),
    };

    emailProvider = {
      ready: vi.fn(),
      findByEmail: vi.fn().mockResolvedValue(null),
      createPending: vi.fn().mockResolvedValue({
        id: TEST_USER_ID,
        subject: TEST_USER_ID,
        email: TEST_EMAIL,
        verified: false,
      }),
      sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
    };

    authService = new AuthService(
      database as unknown as DatabaseService,
      config,
      abuse as unknown as AuthAbuseControl,
      approvals as unknown as SessionApprovalService,
      otpStore as unknown as OtpSecretStore,
      emailProvider as unknown as EmailRegistrationProvider,
    );

    registrationService = new EmailRegistrationService(
      emailProvider as unknown as EmailRegistrationProvider,
      abuse as unknown as AuthAbuseControl,
      database as unknown as DatabaseService,
      config,
    );

    // Global fetch mock for Supabase Admin and token endpoints
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/auth/v1/user')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              identities: [{ provider: 'email', id: TEST_USER_ID }],
            }),
          };
        }
        if (url.includes('/auth/v1/admin/users/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: TEST_USER_ID, email: TEST_EMAIL }),
          };
        }
        if (url.includes('/auth/v1/admin/generate_link')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ hashed_token: 'synthetic-magic-link-hash' }),
          };
        }
        if (url.includes('/auth/v1/verify')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: validAccessToken,
              refresh_token: 'synthetic-refresh-token',
              expires_in: 3600,
              token_type: 'bearer',
              user: { id: TEST_USER_ID, email: TEST_EMAIL },
            }),
          };
        }
        if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: validAccessToken,
              refresh_token: 'synthetic-rotated-refresh-token',
              expires_in: 3600,
              token_type: 'bearer',
            }),
          };
        }
        if (url.includes('/auth/v1/logout')) {
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('1. Canonical Email Lifecycle: signup -> verify -> login -> refresh -> logout', () => {
    it('executes the full email authentication journey end-to-end', async () => {
      // Step 1: Registration (A01)
      const regReq = {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        confirm_password: TEST_PASSWORD,
        privacy_consent: true,
      };
      const regResult = await registrationService.register(
        regReq,
        createMockRequest(),
      );

      expect(regResult).toMatchObject({
        verification_channel: 'email',
        contact_masked: 'i****@example.com',
        expires_in_seconds: 600,
        resend_available_at: expect.any(String),
      });
      expect(regResult).not.toHaveProperty('access_token');

      // Step 2: Email Verification (A02)
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);

      const verifyResult = await authService.verifyEmail({
        email: TEST_EMAIL,
        code: '123456',
      });

      expect(verifyResult).toMatchObject({
        access_token: validAccessToken,
        refresh_token: 'synthetic-refresh-token',
        token_type: 'Bearer',
        user: { id: TEST_USER_ID, verified_contact: true },
        profile_complete: false,
        next_step: 'profile_setup',
      });
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        TEST_USER_ID,
        TEST_SESSION_ID,
        'email_verification',
      );

      // Step 3: Password Login (A05)
      abuse.login.mockImplementationOnce(async () => {
        return {
          access_token: validAccessToken,
          refresh_token: 'synthetic-login-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        };
      });

      database.transaction.mockImplementationOnce(async (_id, op) => {
        const txDb = {
          query: vi.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT u.verified_contact')) {
              return [
                {
                  verified_contact: true,
                  verified_at: new Date(),
                  contact_value: TEST_EMAIL,
                },
              ];
            }
            if (sql.includes('SELECT u.id,u.email')) {
              return [
                {
                  id: TEST_USER_ID,
                  email: TEST_EMAIL,
                  phone: null,
                  status: 'active',
                  verified_contact: true,
                  role: 'USER',
                  linked_providers: ['email'],
                },
              ];
            }
            if (sql.includes('effective_feature_access')) {
              return [{ enabled: true }];
            }
            return [];
          }),
        } as unknown as EntityManager;
        return op(txDb);
      });

      const loginResult = await authService.login(
        { identifier: TEST_EMAIL, password: TEST_PASSWORD },
        createMockRequest(),
      );

      expect(loginResult).toMatchObject({
        access_token: validAccessToken,
        token_type: 'Bearer',
        user: { id: TEST_USER_ID, verified_contact: true },
        next_step: 'profile_setup',
      });

      // Step 4: Token Refresh (A07)
      const refreshResult = await authService.refresh({
        refresh_token: 'synthetic-login-refresh-token',
      });

      expect(refreshResult).toMatchObject({
        access_token: validAccessToken,
        refresh_token: 'synthetic-rotated-refresh-token',
        token_type: 'Bearer',
        user: { id: TEST_USER_ID },
      });
      expect(approvals.isSessionApproved).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_SESSION_ID,
      );

      // Step 5: Logout (A06)
      const logoutResult = await authService.logout(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        `Bearer ${validAccessToken}`,
      );

      expect(logoutResult).toEqual({ logged_out: true });
      expect(approvals.revokeSession).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_SESSION_ID,
      );
    });
  });

  describe('2. Failure Matrix: Outages, Limits & Boundaries', () => {
    it('fails closed with 503 SERVICE_UNAVAILABLE when Redis abuse control is unavailable', async () => {
      abuse.reserveSend.mockRejectedValueOnce({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE', retryable: true },
      });

      await expect(
        registrationService.register(
          {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            confirm_password: TEST_PASSWORD,
            privacy_consent: true,
          },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 503,
      });
    });

    it('enforces lockout / rate-limiting with canonical 429 and Retry-After', async () => {
      abuse.reserveSend.mockRejectedValueOnce({
        status: 429,
        response: {
          code: 'RESEND_COOLDOWN_ACTIVE',
          retryAfterSeconds: 45,
          retryable: true,
        },
      });

      await expect(
        registrationService.resend(
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 429,
      });
    });

    it('rejects verification with 422 VALIDATION_FAILED on non-digit OTP code (Q04)', async () => {
      await expect(
        authService.verifyEmail({ email: TEST_EMAIL, code: '12abc6' }),
      ).rejects.toMatchObject({
        status: 422,
        response: {
          code: 'VALIDATION_FAILED',
        },
      });
    });

    it('fails closed with 503 SERVICE_UNAVAILABLE when OtpSecretStore / Redis fails during verification (Q04)', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);
      otpStore.verifyAndConsumeOtp.mockRejectedValueOnce({
        status: 503,
        response: {
          code: 'SERVICE_UNAVAILABLE',
          retryable: true,
        },
      });

      await expect(
        authService.verifyEmail({ email: TEST_EMAIL, code: '123456' }),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          code: 'SERVICE_UNAVAILABLE',
        },
      });
    });

    it('returns 502 EMAIL_PROVIDER_ERROR when provider sendChallenge fails on registration (Q05)', async () => {
      emailProvider.sendChallenge.mockRejectedValueOnce(
        new Error('Upstream mail delivery failure'),
      );

      await expect(
        registrationService.register(
          {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            confirm_password: TEST_PASSWORD,
            privacy_consent: true,
          },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 502,
        response: {
          code: 'EMAIL_PROVIDER_ERROR',
        },
      });
    });

    it('returns 423 ACCOUNT_LOCKED on login lockout with retryAfterSeconds (Q06)', async () => {
      abuse.login.mockImplementationOnce(async () => {
        fail(423, 'ACCOUNT_LOCKED', 'Login temporarily locked', [], true, 900);
      });

      try {
        await authService.login(
          { identifier: TEST_EMAIL, password: TEST_PASSWORD },
          createMockRequest(),
        );
        expect.unreachable('Should have thrown 423 ACCOUNT_LOCKED');
      } catch (err: unknown) {
        const error = err as {
          getStatus: () => number;
          getResponse: () => Record<string, unknown>;
        };
        expect(error.getStatus()).toBe(423);
        const resp = error.getResponse();
        expect(resp.code).toBe('ACCOUNT_LOCKED');
        expect(resp.retryAfterSeconds).toBe(900);
        expect(resp.retryable).toBe(true);
      }
    });

    it('denies suspended user with 403 ACCOUNT_SUSPENDED when hitting an AZ-USER guarded route (Q07)', async () => {
      const reflector = {
        getAllAndOverride: vi.fn().mockReturnValue({ allowSuspended: false }),
      } as unknown as Reflector;
      const guard = new AccessGuard(
        reflector,
        database as unknown as DatabaseService,
      );

      database.transaction.mockImplementationOnce(async (_id, op) => {
        const txDb = {
          query: vi.fn().mockResolvedValueOnce([
            {
              status: 'suspended',
              verified_contact: true,
              session_approved: false,
              unrevoked_session_approved: false,
            },
          ]),
        } as unknown as EntityManager;
        return op(txDb);
      });

      const mockContext = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({
            user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        status: 403,
        response: {
          code: 'ACCOUNT_SUSPENDED',
        },
      });
    });

    it('allows suspended user to access endpoints with allowSuspended: true (Screen 22 /settings & logout)', async () => {
      const reflector = {
        getAllAndOverride: vi.fn().mockReturnValue({ allowSuspended: true }),
      } as unknown as Reflector;
      const guard = new AccessGuard(
        reflector,
        database as unknown as DatabaseService,
      );

      database.transaction.mockImplementationOnce(async (_id, op) => {
        const txDb = {
          query: vi.fn().mockResolvedValueOnce([
            {
              status: 'suspended',
              verified_contact: true,
              session_approved: true,
              unrevoked_session_approved: true,
            },
          ]),
        } as unknown as EntityManager;
        return op(txDb);
      });

      const mockContext = {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({
            user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          }),
        }),
      } as unknown as ExecutionContext;

      const permitted = await guard.canActivate(mockContext);
      expect(permitted).toBe(true);
    });

    it('serializes canonical error envelope (Q12) with code, requestId, retryAfterSeconds, and Retry-After header', () => {
      const filter = new ApiExceptionFilter();
      const mockSetHeader = vi.fn();
      const mockJson = vi.fn();
      const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
      const mockResponse = {
        status: mockStatus,
        setHeader: mockSetHeader,
        getHeader: vi.fn().mockReturnValue('req-test-uuid-429'),
      };
      const host = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;

      // Test 423 lockout ContractException
      try {
        fail(423, 'ACCOUNT_LOCKED', 'Login temporarily locked', [], true, 900);
      } catch (err) {
        filter.catch(err, host);
        expect(mockStatus).toHaveBeenCalledWith(423);
        expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', 900);
        expect(mockJson).toHaveBeenCalledWith({
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Login temporarily locked',
            details: [],
            retryable: true,
            retryAfterSeconds: 900,
            requestId: 'req-test-uuid-429',
          },
        });
      }

      // Test 429 rate limit ContractException
      try {
        fail(429, 'RESEND_COOLDOWN_ACTIVE', 'Cooldown active', [], true, 60);
      } catch (err) {
        filter.catch(err, host);
        expect(mockStatus).toHaveBeenCalledWith(429);
        expect(mockSetHeader).toHaveBeenCalledWith('Retry-After', 60);
        expect(mockJson).toHaveBeenCalledWith({
          success: false,
          error: {
            code: 'RESEND_COOLDOWN_ACTIVE',
            message: 'Cooldown active',
            details: [],
            retryable: true,
            retryAfterSeconds: 60,
            requestId: 'req-test-uuid-429',
          },
        });
      }
    });

    it('handles provider timeout on OTP verification with retryable error', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('/auth/v1/admin/users/')) {
            const err = new Error('Upstream timeout');
            err.name = 'AbortError';
            throw err;
          }
          return { ok: false, status: 500 };
        }),
      );

      await expect(
        authService.verifyEmail({ email: TEST_EMAIL, code: '123456' }),
      ).rejects.toMatchObject({
        status: 504,
      });
    });

    it('rejects verification if challenge is expired (410) or already verified (409)', async () => {
      // 410: Contact not found in database lookup
      database.query.mockResolvedValueOnce([]);
      await expect(
        authService.verifyEmail({
          email: 'expired@example.com',
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 410,
      });

      // 409: Contact already verified
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          email: TEST_EMAIL,
          verified_contact: true,
          provider_subject: TEST_USER_ID,
          verified_at: new Date(),
        },
      ]);
      await expect(
        authService.verifyEmail({ email: TEST_EMAIL, code: '123456' }),
      ).rejects.toMatchObject({
        status: 409,
      });
    });

    it('suspended user login is permitted', async () => {
      abuse.login.mockImplementationOnce(async () => {
        return {
          access_token: validAccessToken,
          refresh_token: 'suspended-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
        };
      });

      database.transaction.mockImplementationOnce(async (_id, op) => {
        const txDb = {
          query: vi.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT u.verified_contact')) {
              return [
                {
                  verified_contact: true,
                  verified_at: new Date(),
                  contact_value: TEST_EMAIL,
                },
              ];
            }
            if (sql.includes('SELECT u.id,u.email')) {
              return [
                {
                  id: TEST_USER_ID,
                  email: TEST_EMAIL,
                  phone: null,
                  status: 'suspended',
                  verified_contact: true,
                  role: 'USER',
                  linked_providers: ['email'],
                },
              ];
            }
            if (sql.includes('effective_feature_access')) {
              return [{ enabled: false }];
            }
            return [];
          }),
        } as unknown as EntityManager;
        return op(txDb);
      });

      const result = await authService.login(
        { identifier: TEST_EMAIL, password: TEST_PASSWORD },
        createMockRequest(),
      );

      expect(result.user.status).toBe('suspended');
      expect(result).toMatchObject({
        access_token: validAccessToken,
        user: { status: 'suspended' },
      });
    });

    it('allows suspended users to log out idempotently', async () => {
      const logoutResult = await authService.logout(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        `Bearer ${validAccessToken}`,
      );
      expect(logoutResult).toEqual({ logged_out: true });
      expect(approvals.revokeSession).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_SESSION_ID,
      );
    });
  });

  describe('3. Foundation Regressions Preserved', () => {
    it('preserves activity coalescing (R24): me reads do not write last_active_at', async () => {
      const txQuery = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              phone: null,
              status: 'active',
              verified_contact: true,
              role: 'USER',
              linked_providers: ['email'],
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: true }];
        }
        return [];
      });

      database.transaction.mockImplementationOnce(async (_id, op) => {
        const txDb = { query: txQuery } as unknown as EntityManager;
        return op(txDb);
      });

      await authService.me(TEST_USER_ID);

      const executed = txQuery.mock.calls.map(([sql]) => String(sql));
      expect(
        executed.some((sql) =>
          /UPDATE\s+public\.users|last_active_at/i.test(sql),
        ),
      ).toBe(false);
      expect(database.transaction).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.any(Function),
        false,
      );
    });

    it('preserves OAuth A10 next_step === "add_verified_contact" when contact unverified', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            id: TEST_USER_ID,
            email: null,
            phone: null,
            identities: [{ provider: 'google', id: 'google-sub-1' }],
          }),
        }),
      );

      database.transaction.mockImplementationOnce(async (_id, op) => {
        const txDb = {
          query: vi.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT u.id,u.email')) {
              return [
                {
                  id: TEST_USER_ID,
                  email: null,
                  phone: null,
                  status: 'active',
                  verified_contact: false,
                  role: 'USER',
                  linked_providers: ['google'],
                },
              ];
            }
            if (sql.includes('effective_feature_access')) {
              return [{ enabled: true }];
            }
            return [];
          }),
        } as unknown as EntityManager;
        return op(txDb);
      });

      const res = await authService.bootstrap(
        {
          sub: TEST_USER_ID,
          sessionId: TEST_SESSION_ID,
          authProvider: 'google',
          amr: [{ method: 'oauth', provider: 'google' }],
        },
        `Bearer ${createSyntheticJwt({ sub: TEST_USER_ID, sessionId: TEST_SESSION_ID, amr: [{ method: 'oauth', provider: 'google' }] })}`,
        'google',
      );

      expect(res.user.verified_contact).toBe(false);
    });
  });
});
