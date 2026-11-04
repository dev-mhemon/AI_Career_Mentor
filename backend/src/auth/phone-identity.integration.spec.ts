import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { ArgumentsHost } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './services/auth.service.js';
import { ApiExceptionFilter, fail } from '../common/http.js';
import type { DatabaseService } from './services/database.service.js';
import type { SessionApprovalService } from './services/session-approval.service.js';
import type { AuthAbuseControl } from './abuse-control/abuse-control.service.js';
import type { EmailRegistrationProvider } from './services/email-registration.provider.js';
import type { OtpSecretStore } from './services/otp-secret-store.service.js';

const TEST_USER_ID = '44444444-4444-4444-8444-444444444444';
const TEST_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const TEST_PHONE = '+8801712345678';
const TEST_RAW_PHONE = '01712345678';
const TEST_EMAIL = 'phone-user@example.com';

/**
 * Creates a synthetic ES256-signed JWT token payload for testing.
 */
function createSyntheticJwt(
  sub: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      session_id: sessionId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...extra,
    }),
  ).toString('base64url');
  return `${header}.${payload}.synthetic-sig`;
}

/**
 * Creates a mock Express Request object with trusted client IP.
 */
function createMockRequest(ip = '127.0.0.1'): Request {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

describe('M02-02 Phone Auth, Social Identity Linking & Contact Matrix (EP-A03, EP-A10, EP-A11, EP-A12)', () => {
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
    approve: ReturnType<typeof vi.fn>;
  };
  let otpStore: {
    verifyAndConsumeOtp: ReturnType<typeof vi.fn>;
  };
  let emailProvider: {
    ready: ReturnType<typeof vi.fn>;
    sendChallenge: ReturnType<typeof vi.fn>;
  };
  let authService: AuthService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    config = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        if (key === 'SERVICE_ROLE_KEY') return 'test-service-key';
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
      approve: vi.fn().mockResolvedValue(undefined),
    };

    otpStore = {
      verifyAndConsumeOtp: vi.fn(
        async (
          _userId: string,
          _contact: string,
          _code: string,
          action: () => Promise<unknown>,
        ) => {
          return action();
        },
      ),
    };

    emailProvider = {
      ready: vi.fn(),
      sendChallenge: vi.fn(async () => ({
        expiresInSeconds: 600,
        expiresAt: new Date(Date.now() + 600000),
      })),
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
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe('1. EP-A03 Phone Verification (POST /auth/verify-phone)', () => {
    it('executes successful phone verification with valid 6-digit OTP, promoting user to verified_contact = true', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('JOIN public.user_auth_providers p')) {
          return [
            {
              id: TEST_USER_ID,
              phone: TEST_PHONE,
              verified_contact: false,
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
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: null,
              phone: TEST_PHONE,
              status: 'active',
              role: 'USER',
              verified_contact: true,
              profile_complete: false,
              linked_providers: ['phone'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: null,
              experience_level: 'beginner',
              skills: [],
              learning_preference: 'visual',
              has_confirmed_goal: false,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const validJwt = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ properties: { hashed_token: 'hash-token-123' } }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: validJwt,
              refresh_token: 'ref-token-xyz',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
        );

      const res = await authService.verifyPhone({
        phone: TEST_RAW_PHONE,
        code: '123456',
      });

      expect(res).toMatchObject({
        access_token: validJwt,
        refresh_token: 'ref-token-xyz',
        expires_in: 3600,
        token_type: 'Bearer',
        user: expect.objectContaining({
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: true,
          status: 'active',
          linked_providers: ['phone'],
        }),
        profile_complete: false,
        next_step: 'profile_setup',
      });
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        TEST_USER_ID,
        TEST_SESSION_ID,
        'email_verification',
      );
      expect(otpStore.verifyAndConsumeOtp).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_PHONE,
        '123456',
        expect.any(Function),
        'verify_phone',
      );
    });

    it('rejects non-6-digit OTP code with 422 VALIDATION_FAILED', async () => {
      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '12345',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'VALIDATION_FAILED',
        }),
      });
    });

    it('rejects invalid or non-Bangladesh phone number with 422 INVALID_PHONE_NUMBER', async () => {
      await expect(
        authService.verifyPhone({
          phone: '+14155552671',
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'INVALID_PHONE_NUMBER',
        }),
      });
    });

    it('returns 410 VERIFICATION_CODE_EXPIRED when phone provider row is absent', async () => {
      database.query.mockResolvedValueOnce([]);

      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({
          code: 'VERIFICATION_CODE_EXPIRED',
        }),
      });
    });

    it('returns 409 ALREADY_VERIFIED when user contact is already verified', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: true,
          provider_subject: TEST_USER_ID,
          verified_at: new Date().toISOString(),
        },
      ]);

      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'ALREADY_VERIFIED',
        }),
      });
    });

    it('returns 503 SERVICE_UNAVAILABLE when OtpSecretStore is missing or unconfigured', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);

      const authWithoutOtp = new AuthService(
        database as unknown as DatabaseService,
        config,
        abuse as unknown as AuthAbuseControl,
        approvals as unknown as SessionApprovalService,
        undefined,
        emailProvider as unknown as EmailRegistrationProvider,
      );

      await expect(
        authWithoutOtp.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });

    it('cleans up synthetic ephemeral email on GoTrue admin confirmation failure', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce(new Response('GoTrue down', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
        );

      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 502,
        response: expect.objectContaining({
          code: 'PROVIDER_ERROR',
        }),
      });
    });
  });

  describe('2. EP-A10 OAuth Session Bootstrap (POST /auth/oauth/session)', () => {
    it('bootstraps Google OAuth session for user with confirmed email returning next_step = profile_setup', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'oauth', provider: 'google' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: TEST_EMAIL,
            email_confirmed_at: new Date().toISOString(),
            identities: [
              {
                provider: 'google',
                id: 'google-sub-1',
                identity_data: { sub: 'google-sub-1' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              phone: null,
              status: 'active',
              role: 'USER',
              verified_contact: true,
              profile_complete: false,
              linked_providers: ['google'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: null,
              experience_level: 'beginner',
              skills: [],
              learning_preference: 'visual',
              has_confirmed_goal: false,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const res = await authService.bootstrap(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        'google',
      );

      expect(res).toMatchObject({
        user: expect.objectContaining({
          id: TEST_USER_ID,
          verified_contact: true,
          status: 'active',
          linked_providers: ['google'],
        }),
        profile_complete: false,
      });
    });

    it('bootstraps Facebook OAuth session without verified email returning verified_contact = false and add_verified_contact next_step', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'oauth', provider: 'facebook' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: null,
            email_confirmed_at: null,
            identities: [
              {
                provider: 'facebook',
                id: 'fb-sub-1',
                identity_data: { sub: 'fb-sub-1' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: null,
              phone: null,
              status: 'active',
              role: 'USER',
              verified_contact: false,
              profile_complete: false,
              linked_providers: ['facebook'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: null,
              experience_level: 'beginner',
              skills: [],
              learning_preference: 'visual',
              has_confirmed_goal: false,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const me = await authService.bootstrap(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        'facebook',
      );

      const responsePayload = {
        user: me.user,
        profile_complete: me.profile_complete,
        verified_contact_required: !me.user.verified_contact,
        next_step: !me.user.verified_contact
          ? 'add_verified_contact'
          : me.profile_complete
            ? 'app_home'
            : 'profile_setup',
      };

      expect(responsePayload).toMatchObject({
        verified_contact_required: true,
        next_step: 'add_verified_contact',
        user: expect.objectContaining({
          verified_contact: false,
        }),
      });
    });

    it('rejects unsupported provider with 422 PROVIDER_MISMATCH', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID)}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [{ provider: 'google', id: 'google-sub-1' }],
          }),
          { status: 200 },
        ),
      );

      await expect(
        authService.bootstrap(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          'github' as unknown as 'google',
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PROVIDER_MISMATCH',
        }),
      });
    });

    it('rejects token AMR mismatch when token was not authenticated via claimed provider', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'password' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [{ provider: 'google', id: 'google-sub-1' }],
          }),
          { status: 200 },
        ),
      );

      await expect(
        authService.bootstrap(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          'google',
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'PROVIDER_MISMATCH',
        }),
      });
    });
  });

  describe('3. EP-A11 Link Social Identity (POST /auth/identities/link)', () => {
    it('links Google social identity for authenticated user with verified contact and returns updated linked_providers', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: 'google-sync@example.com',
            email_confirmed_at: new Date().toISOString(),
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('provider_subject = $2')) {
          return [];
        }
        if (sql.includes('SELECT ARRAY(')) {
          return [{ linked_providers: ['phone', 'google'] }];
        }
        return [];
      });

      const res = await authService.linkIdentity(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        { provider: 'google' },
      );

      expect(res).toEqual({
        linked_providers: ['phone', 'google'],
      });
    });

    it('rejects linking with 403 VERIFIED_CONTACT_REQUIRED when user verified_contact is false', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockResolvedValueOnce([{ verified_contact: false }]);

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'VERIFIED_CONTACT_REQUIRED',
        }),
      });
    });

    it('rejects linking with 422 PROVIDER_MISMATCH when provider identity is missing from GoTrue user identities', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [],
          }),
          { status: 200 },
        ),
      );

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PROVIDER_MISMATCH',
        }),
      });
    });

    it('rejects linking with 409 IDENTITY_LINK_CONFLICT when social identity belongs to another account', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('provider_subject = $2')) {
          return [{ user_id: '99999999-9999-9999-9999-999999999999' }];
        }
        return [];
      });

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'IDENTITY_LINK_CONFLICT',
        }),
      });
    });

    it('translates database unique constraint race (23505) into 409 IDENTITY_LINK_CONFLICT', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const driverError = new Error(
        'duplicate key value violates unique constraint',
      );
      (driverError as unknown as Record<string, unknown>).code = '23505';
      const constraintError = new QueryFailedError(
        'INSERT ...',
        [],
        driverError,
      );

      database.transaction.mockRejectedValueOnce(constraintError);

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'IDENTITY_LINK_CONFLICT',
        }),
      });
    });

    it('rejects unauthenticated request with 401 AUTH_REQUIRED', async () => {
      await expect(
        authService.linkIdentity(
          null as unknown as { sub: string; sessionId: string },
          undefined,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({
          code: 'AUTH_REQUIRED',
        }),
      });
    });
  });

  describe('4. EP-A12 Add Contact (POST /auth/contact)', () => {
    it('successfully adds unverified email contact, reserves quota, and dispatches OTP challenge returning 202 Accepted', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) {
          return [];
        }
        if (
          sql.includes(
            'SELECT verified_contact FROM public.users WHERE id = $1',
          )
        ) {
          return [{ verified_contact: false }];
        }
        if (
          sql.includes(
            'SELECT id FROM public.users WHERE lower(email::text) = $1',
          )
        ) {
          return [];
        }
        if (
          sql.includes(
            "SELECT user_id FROM public.user_auth_providers WHERE provider = 'email'",
          )
        ) {
          return [];
        }
        if (
          sql.includes(
            'SELECT contact_value, verified_at FROM public.user_auth_providers',
          )
        ) {
          return [];
        }
        return [];
      });

      const res = await authService.addContact(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        { channel: 'email', contact: TEST_EMAIL },
        createMockRequest(),
      );

      expect(res).toMatchObject({
        verification_channel: 'email',
        contact_masked: 'p****@example.com',
      });
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'email', identifier: TEST_EMAIL },
        '127.0.0.1',
      );
      expect(emailProvider.sendChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_USER_ID,
          email: TEST_EMAIL,
        }),
      );
    });

    it('fails closed with 503 SERVICE_UNAVAILABLE when phone contact is requested while SMS is disabled', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'phone', contact: TEST_PHONE },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });

    it('rejects with 409 ALREADY_VERIFIED when user account already has a verified contact', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) {
          return [];
        }
        if (
          sql.includes(
            'SELECT verified_contact FROM public.users WHERE id = $1',
          )
        ) {
          return [{ verified_contact: true }];
        }
        return [];
      });

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'ALREADY_VERIFIED',
        }),
      });
    });

    it('rejects with 409 CONTACT_ALREADY_REGISTERED when email contact belongs to another user', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) {
          return [];
        }
        if (
          sql.includes(
            'SELECT verified_contact FROM public.users WHERE id = $1',
          )
        ) {
          return [{ verified_contact: false }];
        }
        if (
          sql.includes(
            'SELECT id FROM public.users WHERE lower(email::text) = $1',
          )
        ) {
          return [{ id: '99999999-9999-9999-9999-999999999999' }];
        }
        return [];
      });

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'CONTACT_ALREADY_REGISTERED',
        }),
      });
    });

    it('enforces R31 abuse control rate limit (429 RESEND_COOLDOWN_ACTIVE) on add contact', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      abuse.reserveSend.mockImplementationOnce(async () => {
        fail(429, 'RESEND_COOLDOWN_ACTIVE', 'Cooldown active', [], true, 60);
      });

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          code: 'RESEND_COOLDOWN_ACTIVE',
        }),
      });
    });
  });

  describe('5. ApiExceptionFilter Single Envelope Serialization', () => {
    it('serializes 403 VERIFIED_CONTACT_REQUIRED into canonical single envelope', () => {
      const filter = new ApiExceptionFilter();
      const setHeaderFn = vi.fn();
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });

      const mockResponse = {
        status: statusFn,
        setHeader: setHeaderFn,
        getHeader: vi.fn().mockReturnValue('req-phone-identity-1'),
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;

      try {
        fail(403, 'VERIFIED_CONTACT_REQUIRED', 'Verified contact required');
      } catch (err: unknown) {
        filter.catch(err, mockHost);
      }

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VERIFIED_CONTACT_REQUIRED',
            message: 'Verified contact required',
            requestId: 'req-phone-identity-1',
          }),
        }),
      );
    });

    it('serializes 409 IDENTITY_LINK_CONFLICT into canonical single envelope', () => {
      const filter = new ApiExceptionFilter();
      const setHeaderFn = vi.fn();
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });

      const mockResponse = {
        status: statusFn,
        setHeader: setHeaderFn,
        getHeader: vi.fn().mockReturnValue('req-phone-identity-2'),
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;

      try {
        fail(
          409,
          'IDENTITY_LINK_CONFLICT',
          'Identity belongs to another account',
        );
      } catch (err: unknown) {
        filter.catch(err, mockHost);
      }

      expect(statusFn).toHaveBeenCalledWith(409);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'IDENTITY_LINK_CONFLICT',
            message: 'Identity belongs to another account',
            requestId: 'req-phone-identity-2',
          }),
        }),
      );
    });
  });
});
