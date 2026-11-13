import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { type INestApplication, HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttp, fail } from '../../common/http.js';
import { AuthController } from '../controllers/auth.controller.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { DatabaseService } from './database.service.js';
import { SessionApprovalService } from './session-approval.service.js';
import { AuthService } from './auth.service.js';
import { EmailRegistrationProvider } from './email-registration.provider.js';
import { EmailRegistrationService } from './email-registration.service.js';
import { OtpSecretStore } from './otp-secret-store.service.js';
import { TextBeeSmsProvider } from './textbee-sms.provider.js';
import {
  buildBackendLaunchEnv,
  resolveOAuthProviders,
  injectOAuthIntoConfigToml,
  // @ts-expect-error - script utility import outside tsconfig rootDir
} from '../../../../scripts/foundation/local.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function accessToken(
  amr?: Array<{ method: string; provider?: string; timestamp?: number }>,
  claims: {
    email?: string;
    phone?: string;
    app_metadata?: { provider?: string; providers?: string[] };
  } = {},
): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
    sub: userId,
    session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    amr: amr ?? [{ method: 'oauth', provider: 'google' }],
    ...claims,
  })}.synthetic-signature`;
}

function configuration(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: vi.fn((name: string) => {
      if (name in overrides) return overrides[name];
      return name === 'AUTH_PASSWORD_MIN_LENGTH' ? 8 : undefined;
    }),
    getOrThrow: vi.fn((name: string) => {
      if (name in overrides) return overrides[name];
      return name === 'SUPABASE_URL'
        ? 'http://supabase.invalid'
        : 'public-anon-key';
    }),
  } as unknown as ConfigService;
}

describe('AuthService session approval boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses sync when an A01 email registration is pending verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'pending@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'email', id: userId }],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("provider='email' AND verified_at IS NULL"))
        return [{ id: '1' }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await expect(
      service.bootstrap({ sub: userId, sessionId }, `Bearer ${accessToken()}`),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'UNVERIFIED_ACCOUNT' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /INSERT INTO public\.users/.test(sql)),
    ).toBe(false);
  });

  it('refuses OAuth approval while an A01 email mapping is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'confirmed@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-proof-subject' }],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM auth.identities')) return [];
      if (sql.includes("provider='email' AND verified_at IS NULL")) {
        return [{ '?column?': 1 }];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId, authProvider: 'google' },
        `Bearer ${accessToken()}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'UNVERIFIED_ACCOUNT' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('approves OAuth session for a user with primary app_metadata.provider = email and linked google identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'email', id: userId },
            { provider: 'google', id: 'google-sub-123' },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT u.verified_contact, p.verified_at'))
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      if (sql.startsWith('SELECT verified_contact'))
        return [{ verified_contact: true }];
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email'))
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['email', 'google'],
          },
        ];
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = {
      approve: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const result = await service.bootstrap(
      { sub: userId, sessionId, authProvider: 'email' },
      `Bearer ${accessToken()}`,
      'google',
    );

    expect(result.user.verified_contact).toBe(true);
    expect(approvals.approve).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      sessionId,
      'oauth',
    );
    expect(
      query.mock.calls.some(([sql]) =>
        /UPDATE public\.users SET last_login_at=clock_timestamp\(\)/.test(sql),
      ),
    ).toBe(true);
  });

  it('rejects OAuth bootstrap with unsupported provider (e.g. github)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'github', id: 'gh-123' }],
        }),
      }),
    );
    const database = {
      transaction: vi.fn(),
    } as unknown as DatabaseService;
    const approvals = {
      approve: vi.fn(),
    } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${accessToken()}`,
        'github',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROVIDER_MISMATCH' },
    });
  });

  it('refuses OAuth bootstrap when session AMR is not OAuth for requested provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'email', id: userId },
            { provider: 'google', id: 'google-sub-123' },
          ],
        }),
      }),
    );
    const database = { transaction: vi.fn() } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const passwordToken = accessToken([{ method: 'password' }]);

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${passwordToken}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROVIDER_MISMATCH' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();

    const mismatchedProviderToken = accessToken([
      { method: 'oauth', provider: 'facebook' },
    ]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${mismatchedProviderToken}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROVIDER_MISMATCH' },
    });
  });

  it('lets a verified existing account sync without approving or recording activity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: userId, email: 'person@example.invalid' }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT u.verified_contact, p.verified_at'))
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      if (sql.startsWith('SELECT verified_contact'))
        return [{ verified_contact: true }];
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email'))
        return [
          {
            id: userId,
            email: 'person@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['email'],
          },
        ];
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await expect(
      service.bootstrap({ sub: userId, sessionId }, `Bearer ${accessToken()}`),
    ).resolves.toMatchObject({ user: { id: userId, verified_contact: true } });
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /UPDATE public\.users/.test(sql)),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) => /INSERT INTO public\.users/.test(sql)),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        /INSERT INTO public\.user_auth_providers/.test(sql),
      ),
    ).toBe(false);
    expect(database.transaction).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      false,
      false,
      false,
    );
  });

  it.each([
    {
      source: 'GoTrue unprefixed phone',
      userPhone: '8801700000000',
      tokenPhone: undefined,
    },
    {
      source: 'JWT fallback phone',
      userPhone: null,
      tokenPhone: '8801700000000',
    },
    {
      source: 'GoTrue prefixed phone',
      userPhone: '+8801700000000',
      tokenPhone: undefined,
    },
  ])(
    'syncs a verified phone account with $source',
    async ({ userPhone, tokenPhone }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            phone: userPhone,
            phone_confirmed_at: '2026-01-01T00:00:00Z',
            identities: [{ provider: 'phone', id: userId }],
          }),
        }),
      );
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
          expect(params).toEqual([userId, 'phone', '+8801700000000']);
          return [
            { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
          ];
        }
        if (sql.includes('SELECT u.id,u.email')) {
          return [
            {
              id: userId,
              email: null,
              phone: '+8801700000000',
              status: 'active',
              verified_contact: true,
              role: 'USER',
              linked_providers: ['phone'],
            },
          ];
        }
        if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;
      const approvals = {
        approve: vi.fn(),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        approvals,
      );

      await expect(
        service.bootstrap(
          { sub: userId, sessionId },
          `Bearer ${accessToken([{ method: 'sms' }], { phone: tokenPhone })}`,
        ),
      ).resolves.toMatchObject({
        user: { id: userId, verified_contact: true },
      });
      expect(approvals.approve).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(([sql]) => /^(INSERT|UPDATE) /i.test(sql)),
      ).toBe(false);
    },
  );

  it('maps a phone-only password session to the verified phone provider row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          phone: '8801700000000',
          phone_confirmed_at: '2026-01-01T00:00:00Z',
        }),
      }),
    );
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        expect(params).toEqual([userId, 'phone', '+8801700000000']);
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.includes('SELECT u.id,u.email'))
        return [
          {
            id: userId,
            email: null,
            phone: '+8801700000000',
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['phone'],
          },
        ];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${accessToken([{ method: 'password' }])}`,
      ),
    ).resolves.toMatchObject({ user: { id: userId, verified_contact: true } });
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /^(INSERT|UPDATE) /i.test(sql)),
    ).toBe(false);
  });

  it.each([
    {
      name: 'unsupported app_metadata provider',
      authUser: { id: userId, email: 'person@example.invalid' },
      claims: { app_metadata: { provider: 'github' } },
    },
    {
      name: 'no resolvable active contact',
      authUser: { id: userId },
      claims: {},
    },
  ])(
    'rejects provider-less sync with $name before the provider lookup',
    async ({ authUser, claims }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => authUser }),
      );
      const query = vi.fn(async () => [
        { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
      ]);
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;
      const approvals = {
        approve: vi.fn(),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        approvals,
      );

      await expect(
        service.bootstrap(
          { sub: userId, sessionId },
          `Bearer ${accessToken([], claims)}`,
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'UNVERIFIED_ACCOUNT' },
      });
      expect(query).toHaveBeenNthCalledWith(
        1,
        'SELECT id FROM public.users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      expect(query).toHaveBeenNthCalledWith(
        2,
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [userId],
      );
      expect(query).toHaveBeenNthCalledWith(
        3,
        'SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid) AS auth_user_exists',
        [userId],
      );
      expect(query).toHaveBeenNthCalledWith(4, 'SET LOCAL ROLE service_role');
      expect(approvals.approve).not.toHaveBeenCalled();
    },
  );

  it('locks public.users row before hashtext(userId) on bootstrap upsert to match user-ID transaction lock order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'lock-order@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-lock' }],
        }),
      }),
    );
    const executedSql: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executedSql.push(sql);
      if (sql.includes('auth_user_exists')) return [{ auth_user_exists: true }];
      if (
        sql.includes('AS max_activity_at') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          { provider: 'google', max_activity_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.includes('SELECT id, phone FROM public.users')) {
        return [{ id: userId, phone: null }];
      }
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'lock-order@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const txArgs: unknown[][] = [];
    const database = {
      transaction: vi.fn((...args: unknown[]) => {
        txArgs.push(args);
        const operation = args[1] as (db: EntityManager) => Promise<unknown>;
        return operation({ query } as unknown as EntityManager);
      }),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
      'google',
    );

    expect(txArgs[0]?.[0]).toBeNull();
    const rowLockIdx = executedSql.findIndex((sql) =>
      sql.includes('SELECT id FROM public.users WHERE id = $1 FOR UPDATE'),
    );
    const advisoryIdx = executedSql.findIndex((sql) =>
      sql.includes('pg_advisory_xact_lock(hashtext($1::text))'),
    );
    const upsertIdx = executedSql.findIndex((sql) =>
      sql.includes('INSERT INTO public.users'),
    );
    expect(rowLockIdx).toBeGreaterThanOrEqual(0);
    expect(advisoryIdx).toBeGreaterThan(rowLockIdx);
    expect(upsertIdx).toBeGreaterThan(advisoryIdx);
  });

  it('exercises full end-to-end bypass rejection: signup -> verify -> HTTP sync -> login while production A01 returns 503', async () => {
    const token = accessToken([{ method: 'password' }]);
    const directUser = {
      id: userId,
      email: 'direct@example.invalid',
      email_confirmed_at: null as string | null,
      identities: [{ provider: 'email', id: userId }],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const urlStr = url.toString();
        if (urlStr.endsWith('/auth/v1/signup')) {
          return {
            ok: true,
            status: 200,
            json: async () => directUser,
          };
        }
        if (urlStr.endsWith('/auth/v1/verify')) {
          directUser.email_confirmed_at = '2026-01-01T00:00:00Z';
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: token,
              token_type: 'bearer',
              expires_in: 3600,
              refresh_token: 'direct-refresh-token',
              user: directUser,
            }),
          };
        }
        if (urlStr.endsWith('/auth/v1/user')) {
          return {
            ok: true,
            status: 200,
            json: async () => directUser,
          };
        }
        if (urlStr.includes('/auth/v1/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: token,
              refresh_token: 'direct-refresh-token',
              expires_in: 3600,
              token_type: 'bearer',
              user: directUser,
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );

    const abuse = {
      reserveSend: vi.fn(),
      login: vi.fn(async (_contact, _ip, authenticate) => {
        const result = await authenticate();
        if (!result.success) throw new Error('unexpected invalid result');
        return result.value;
      }),
    } as unknown as AuthAbuseControl;

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) return [];
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (
        sql.includes('SELECT u.verified_contact,p.verified_at,p.contact_value')
      )
        return [];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;

    // Spin up full HTTP app with AuthController and real EmailRegistrationProvider
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        EmailRegistrationService,
        EmailRegistrationProvider,
        { provide: AuthAbuseControl, useValue: abuse },
        { provide: DatabaseService, useValue: database },
        { provide: SessionApprovalService, useValue: approvals },
        { provide: ConfigService, useValue: configuration() },
      ],
    }).compile();

    const app: INestApplication = module.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      if (req.headers.authorization?.startsWith('Bearer ')) {
        const parts = req.headers.authorization.slice(7).split('.');
        if (parts.length === 3) {
          try {
            const payload = JSON.parse(
              Buffer.from(parts[1], 'base64url').toString('utf8'),
            );
            req.user = {
              sub: payload.sub,
              sessionId: payload.session_id,
              ...(Array.isArray(payload.amr) ? { amr: payload.amr } : {}),
            };
          } catch {
            req.user = undefined;
          }
        }
      }
      next();
    });
    configureHttp(app);
    await app.init();

    try {
      // 1. Direct GoTrue signup step: attacker calls GoTrue /auth/v1/signup
      const signupRes = await fetch('http://supabase.invalid/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'direct@example.invalid',
          password: 'password123',
        }),
      });
      const signupData = await signupRes.json();
      expect(signupData).toMatchObject({
        id: userId,
        email: 'direct@example.invalid',
        email_confirmed_at: null,
      });

      // 2. Direct GoTrue verify step: attacker calls GoTrue /auth/v1/verify
      const verifyRes = await fetch('http://supabase.invalid/auth/v1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'signup',
          token: '123456',
          email: 'direct@example.invalid',
        }),
      });
      const verifyData = await verifyRes.json();
      expect(verifyData).toMatchObject({
        access_token: token,
        user: {
          id: userId,
          email: 'direct@example.invalid',
          email_confirmed_at: expect.any(String),
        },
      });

      // 3. Canonical production A01 endpoint rejects with 503 SERVICE_UNAVAILABLE
      // Uses the REAL EmailRegistrationProvider (no mock substitution!)
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'direct@example.invalid',
          password: 'password123',
          confirm_password: 'password123',
          privacy_consent: true,
        });
      expect(registerRes.status).toBe(503);
      expect(registerRes.body).toMatchObject({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE' },
      });

      // 4. Direct GoTrue signup attempting HTTP /auth/sync is rejected with 403 UNVERIFIED_ACCOUNT
      const syncRes = await request(app.getHttpServer())
        .post('/api/v1/auth/sync')
        .set('Authorization', `Bearer ${token}`);
      expect(syncRes.status).toBe(403);
      expect(syncRes.body).toMatchObject({
        success: false,
        error: { code: 'UNVERIFIED_ACCOUNT' },
      });
      expect(approvals.approve).not.toHaveBeenCalled();
      expect(
        query.mock.calls.some(([sql]) => /INSERT INTO public\.users/.test(sql)),
      ).toBe(false);

      // 5. Direct GoTrue signup attempting HTTP password login (EP-A05) is rejected with 403 UNVERIFIED_ACCOUNT
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          identifier: 'direct@example.invalid',
          password: 'password123',
        });
      expect(loginRes.status).toBe(403);
      expect(loginRes.body).toMatchObject({
        success: false,
        error: { code: 'UNVERIFIED_ACCOUNT' },
      });
      expect(approvals.approve).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('prevents user with verified phone from using /auth/sync to promote unverified GoTrue email', async () => {
    const token = accessToken([{ method: 'password' }]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'sneaky-email@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          phone: '+8801700000000',
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'phone', id: userId },
            { provider: 'email', id: userId },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      // User only has verified phone, no verified email provider row
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    // /auth/sync evaluates active provider = 'email', sees no verified email provider row, denies 403
    await expect(
      service.bootstrap({ sub: userId, sessionId }, `Bearer ${token}`),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'UNVERIFIED_ACCOUNT' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some(([sql]) => /INSERT INTO public\.users/.test(sql)),
    ).toBe(false);
    expect(
      query.mock.calls.some(([sql]) =>
        /INSERT INTO public\.user_auth_providers/.test(sql),
      ),
    ).toBe(false);
  });

  it('maps provider email-not-confirmed to C05 UNVERIFIED_ACCOUNT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 400,
        ok: false,
        json: async () => ({ code: 'email_not_confirmed' }),
      }),
    );
    const abuse = {
      login: vi.fn(async (_contact, _ip, authenticate) => {
        const result = await authenticate();
        if (!result.success) throw new Error('unexpected invalid result');
        return result.value;
      }),
    } as unknown as AuthAbuseControl;
    const database = {
      transaction: vi.fn(),
    } as unknown as DatabaseService;
    const service = new AuthService(
      database,
      configuration(),
      abuse,
      {} as SessionApprovalService,
    );
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
      ips: [],
      headers: {},
      app: { get: vi.fn() },
    } as unknown as Request;

    await expect(
      service.login(
        { identifier: 'person@example.invalid', password: 'valid-password' },
        request,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'UNVERIFIED_ACCOUNT' },
    });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('allows suspended EP-A05 and approves exactly its returned session', async () => {
    const token = accessToken();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: userId }),
      }),
    );
    const abuse = {
      login: vi.fn().mockResolvedValue({
        access_token: token,
        refresh_token: 'synthetic-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
      }),
    } as unknown as AuthAbuseControl;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT u.verified_contact,p.verified_at'))
        return [
          {
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
            contact_value: 'person@example.invalid',
          },
        ];
      if (sql.includes('SELECT u.id,u.email'))
        return [
          {
            id: userId,
            email: 'person@example.invalid',
            phone: null,
            status: 'suspended',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['email'],
          },
        ];
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: false }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = {
      approve: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      abuse,
      approvals,
    );
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      ip: '127.0.0.1',
      ips: [],
      headers: {},
      app: { get: vi.fn() },
    } as unknown as Request;

    await expect(
      service.login(
        { identifier: 'person@example.invalid', password: 'valid-password' },
        request,
      ),
    ).resolves.toMatchObject({
      access_token: token,
      refresh_token: 'synthetic-refresh-token',
      token_type: 'Bearer',
      next_step: 'profile_setup',
      user: { status: 'suspended' },
    });
    expect(approvals.approve).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      userId,
      sessionId,
      'password_login',
    );
    expect(database.transaction).toHaveBeenCalledWith(
      userId,
      expect.any(Function),
      false,
      true,
    );
  });

  it('invokes main bootstrap transaction with least-privilege service_role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'email', id: userId }],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['email'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'password' }])}`,
    );

    expect(database.transaction).toHaveBeenCalledWith(
      null,
      expect.any(Function),
      false,
      false,
      false,
    );
  });

  it('rejects with 409 ACCOUNT_EXISTS and executes narrow privileged cleanup when email collision occurs without existing app row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'collision@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-col' }],
        }),
      }),
    );
    const executedQueries: string[] = [];
    let authUserExists = true;
    const query = vi.fn(async (sql: string) => {
      executedQueries.push(sql);
      if (sql.includes('AS auth_user_exists')) {
        return [{ auth_user_exists: authUserExists }];
      }
      if (sql.includes('email_collisions')) {
        return [{ user_id: 'other-user-id' }];
      }
      if (sql.includes('DELETE FROM auth.users')) {
        authUserExists = false;
        return [{ id: userId }];
      }
      if (sql.includes('FROM public.users') && sql.includes('WHERE id = $1')) {
        return [];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'ACCOUNT_EXISTS',
        message: expect.stringContaining('already exists'),
      },
    });

    expect(approvals.approve).not.toHaveBeenCalled();
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.identities')),
    ).toBe(true);
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.sessions')),
    ).toBe(true);
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.users')),
    ).toBe(true);
    expect(database.transaction).toHaveBeenLastCalledWith(
      null,
      expect.any(Function),
      false,
      false,
      false,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_TOKEN' },
    });
    expect(
      executedQueries.some((sql) => sql.includes('INSERT INTO public.users(')),
    ).toBe(false);
    expect(
      executedQueries.some((sql) =>
        sql.includes('INSERT INTO public.user_auth_providers('),
      ),
    ).toBe(false);
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('allows a later valid bootstrap when collision cleanup retains an Auth user with another identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'collision@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub-retained' },
            { provider: 'facebook', id: 'facebook-sub-retained' },
          ],
        }),
      }),
    );
    let collisionPending = true;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('AS auth_user_exists')) {
        return [{ auth_user_exists: true }];
      }
      if (sql.includes('email_collisions')) {
        if (collisionPending) {
          collisionPending = false;
          return [{ user_id: 'other-user-id' }];
        }
        return [];
      }
      if (sql.includes('DELETE FROM auth.users')) return [];
      if (sql.includes('SELECT id, phone FROM public.users')) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'collision@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google', 'facebook'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const service = new AuthService(
      {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );
    const token = accessToken([{ method: 'oauth', provider: 'google' }]);

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ACCOUNT_EXISTS' },
    });
    await expect(
      service.bootstrap(
        { sub: userId, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        `Bearer ${token}`,
        'google',
      ),
    ).resolves.toMatchObject({ user: { id: userId } });
  });

  it('skips all deferred auth deletes when provisioning wins the race before cleanup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'collision@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-race' }],
        }),
      }),
    );
    const executedQueries: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      executedQueries.push(sql);
      if (sql.includes('email_collisions')) {
        expect(params).toEqual(['collision@example.invalid', userId]);
        return [{ user_id: 'other-user-id' }];
      }
      if (sql.includes('SELECT id, phone FROM public.users')) return [];
      if (sql.includes('SELECT 1 FROM public.users WHERE id = $1 LIMIT 1')) {
        expect(params).toEqual([userId]);
        return [{ '?column?': 1 }];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'ACCOUNT_EXISTS' },
    });

    expect(
      executedQueries.some((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toBe(true);
    const cleanupLockIndex = executedQueries.findLastIndex((sql) =>
      sql.includes('pg_advisory_xact_lock(hashtext($1::text))'),
    );
    const authUserLockIndex = executedQueries.findIndex((sql) =>
      sql.includes('SELECT id FROM auth.users WHERE id = $1 FOR UPDATE'),
    );
    const appCheckIndex = executedQueries.findIndex((sql) =>
      sql.includes('SELECT 1 FROM public.users WHERE id = $1 LIMIT 1'),
    );
    expect(cleanupLockIndex).toBeGreaterThan(-1);
    expect(authUserLockIndex).toBe(cleanupLockIndex + 1);
    expect(appCheckIndex).toBe(authUserLockIndex + 1);
    expect(
      executedQueries.some((sql) =>
        sql.includes('DELETE FROM auth.identities'),
      ),
    ).toBe(false);
    expect(
      executedQueries.some((sql) => sql.includes('DELETE FROM auth.sessions')),
    ).toBe(false);
    expect(
      executedQueries.some((sql) => sql.includes('DELETE FROM auth.users')),
    ).toBe(false);
  });

  it('rejects with 409 ACCOUNT_EXISTS and preserves existing account without auth.* cleanup when app row already exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'collision@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-col' }],
        }),
      }),
    );
    const executedQueries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executedQueries.push(sql);
      if (sql.includes('email_collisions')) {
        return [{ user_id: 'other-user-id' }];
      }
      if (sql.includes('FROM public.users') && sql.includes('WHERE id = $1')) {
        return [{ id: userId, phone: null }];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'ACCOUNT_EXISTS',
        message: expect.stringContaining('already exists'),
      },
    });

    expect(approvals.approve).not.toHaveBeenCalled();
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.identities')),
    ).toBe(false);
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.sessions')),
    ).toBe(false);
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.users')),
    ).toBe(false);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects with 409 IDENTITY_LINK_CONFLICT when pre-flight identity check detects existing provider_subject under different user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-conflict' }],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [{ user_id: 'different-user-id' }];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'IDENTITY_LINK_CONFLICT',
        message: 'Identity belongs to another application account',
      },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('rejects explicit Google callback when Facebook uniquely matches the session AMR timestamp', async () => {
    const amrTimestamp = 1700000000;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'multi-oauth@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            {
              provider: 'google',
              id: 'google-sub',
              last_sign_in_at: new Date(
                (amrTimestamp + 600) * 1000,
              ).toISOString(),
            },
            {
              provider: 'facebook',
              id: 'facebook-sub',
              last_sign_in_at: new Date(amrTimestamp * 1000).toISOString(),
            },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('AS max_activity_at') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            max_activity_at: new Date(
              (amrTimestamp + 600) * 1000,
            ).toISOString(),
          },
          {
            provider: 'facebook',
            max_activity_at: new Date(amrTimestamp * 1000).toISOString(),
          },
        ];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', timestamp: amrTimestamp }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        code: 'PROVIDER_MISMATCH',
        message:
          'Requested OAuth provider does not match session authentication evidence',
      },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('catches and logs privileged cleanup error on email collision and still rejects with 409 ACCOUNT_EXISTS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'collision@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-col' }],
        }),
      }),
    );
    const executedQueries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executedQueries.push(sql);
      if (sql.includes('email_collisions')) {
        return [{ user_id: 'other-user-id' }];
      }
      if (sql.includes('FROM public.users') && sql.includes('WHERE id = $1')) {
        return [];
      }
      return [];
    });
    query.mockImplementation(async (sql: string) => {
      executedQueries.push(sql);
      if (sql.includes('email_collisions')) {
        return [{ user_id: 'other-user-id' }];
      }
      if (sql.includes('FROM public.users') && sql.includes('WHERE id = $1')) {
        return [];
      }
      if (sql.includes('DELETE FROM auth.identities')) {
        throw new Error('Simulated cleanup database failure');
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'ACCOUNT_EXISTS',
        message: expect.stringContaining('already exists'),
      },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('does not query email collisions for unconfirmed OAuth email, avoids auth.users deletion, and succeeds with unverified contact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'unconfirmed@example.com',
          email_confirmed_at: null,
          identities: [{ provider: 'google', id: 'google-sub-unconfirmed' }],
        }),
      }),
    );
    const executedQueries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executedQueries.push(sql);
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('WHERE provider = $1')
      ) {
        return [];
      }
      if (sql.includes('FROM public.users') && sql.includes('WHERE id = $1')) {
        return [];
      }
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: null,
            phone: null,
            status: 'active',
            verified_contact: false,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    const result = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
      'google',
    );

    expect(result.user.verified_contact).toBe(false);
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(executedQueries.some((q) => q.includes('email_collisions'))).toBe(
      false,
    );
    expect(
      executedQueries.some((q) => q.includes('DELETE FROM auth.users')),
    ).toBe(false);

    const controller = new AuthController(
      service,
      {} as unknown as EmailRegistrationService,
    );
    const mockReq = {
      user: { sub: userId, sessionId },
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Parameters<AuthController['oauth']>[0];
    const oauthResponse = await controller.oauth(mockReq, {
      provider: 'google',
    });
    expect(oauthResponse.verified_contact_required).toBe(true);
    expect(oauthResponse.next_step).toBe('add_verified_contact');
    expect(oauthResponse.user.verified_contact).toBe(false);
  });

  it('clears unverified squatter rows from both public.users and public.user_auth_providers during bootstrap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'newuser@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-squatter' }],
        }),
      }),
    );
    const executedQueries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executedQueries.push(sql);
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (sql.includes('email_collisions')) {
        return [];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'newuser@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
      'google',
    );

    expect(
      executedQueries.some(
        (sql) =>
          sql.includes('UPDATE public.users') &&
          sql.includes('SET email = NULL') &&
          sql.includes('verified_contact = false'),
      ),
    ).toBe(true);
    expect(
      executedQueries.some(
        (sql) =>
          sql.includes('DELETE FROM public.user_auth_providers') &&
          sql.includes('verified_at IS NULL'),
      ),
    ).toBe(true);
  });

  it('allows email-registered user to bootstrap via Google OAuth when user.identities contains existing email identity without 409 IDENTITY_LINK_CONFLICT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'email', id: userId },
            { provider: 'google', id: 'google-sub-456' },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('WHERE user_id = $1 AND provider = $2')
      ) {
        if (params && params[1] === 'email') {
          return [
            {
              contact_value: 'user@example.invalid',
              provider_subject: 'legacy-email-sub-123',
              verified_at: '2026-01-01T00:00:00Z',
            },
          ];
        }
        return [];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['email', 'google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    const res = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
      'google',
    );

    expect(res).toBeDefined();
    expect(res.user.id).toBe(userId);
    expect(approvals.approve).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      sessionId,
      'oauth',
    );
  });

  it('strictly rejects cross-subject OAuth hijack with 409 IDENTITY_LINK_CONFLICT when an existing Google identity subject differs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'new-google-sub' }],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('WHERE user_id = $1')
      ) {
        return [
          {
            contact_value: 'user@example.invalid',
            provider_subject: 'original-google-sub',
            verified_at: '2026-01-01T00:00:00Z',
          },
        ];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', provider: 'google' }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'IDENTITY_LINK_CONFLICT' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('rejects Google-only bootstrap when confirmed email conflicts with stored verified email mapping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'bob@example.com',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-email-conflict' }],
        }),
      }),
    );
    let usersUpserted = false;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes("provider IN ('email', 'phone', 'google', 'facebook')") &&
        sql.includes('verified_at IS NOT NULL')
      ) {
        expect(params).toEqual([userId]);
        return [
          {
            provider: 'email',
            contact_value: 'alice@example.com',
          },
        ];
      }
      if (sql.includes('INSERT INTO public.users(')) usersUpserted = true;
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'IDENTITY_LINK_CONFLICT' },
    });
    expect(usersUpserted).toBe(false);
  });

  it('uses non-destructive upserts that preserve concurrently verified contacts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-upsert' }],
        }),
      }),
    );
    let usersUpsert = '';
    let providersUpsert = '';
    let verifiedMappingsQuery = '';
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO public.users(')) usersUpsert = sql;
      if (sql.includes('INSERT INTO public.user_auth_providers(')) {
        providersUpsert = sql;
      }
      if (
        sql.includes("provider IN ('email', 'phone', 'google', 'facebook')")
      ) {
        verifiedMappingsQuery = sql;
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: '+8801712345678',
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );

    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
      'google',
    );

    expect(usersUpsert).toContain('email=CASE');
    expect(usersUpsert).toContain(
      'WHEN public.users.verified_contact AND public.users.email IS NOT NULL THEN public.users.email',
    );
    expect(usersUpsert).toContain('phone=CASE');
    expect(usersUpsert).toContain(
      'WHEN public.users.verified_contact AND public.users.phone IS NOT NULL THEN public.users.phone',
    );
    expect(usersUpsert).toContain(
      'verified_contact=public.users.verified_contact OR EXCLUDED.verified_contact',
    );
    expect(verifiedMappingsQuery).toContain('FOR UPDATE');
    expect(providersUpsert).toContain(
      'WHEN public.user_auth_providers.verified_at IS NOT NULL',
    );
    expect(providersUpsert).toContain(
      'THEN public.user_auth_providers.contact_value',
    );
    expect(providersUpsert).toContain(
      'verified_at=COALESCE(public.user_auth_providers.verified_at, EXCLUDED.verified_at)',
    );
  });

  it('queries email collisions strictly requiring verified holders across public.users, user_auth_providers, and auth.identities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-incoming' }],
        }),
      }),
    );
    let capturedCollisionSql = '';
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('email_collisions') ||
        sql.includes('FROM auth.identities')
      ) {
        capturedCollisionSql += `\n${sql}`;
        return [];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
      'google',
    );

    expect(capturedCollisionSql).toContain("p.provider = 'email'");
    expect(capturedCollisionSql).toContain('EXISTS (');
    expect(capturedCollisionSql).toContain('verified_at IS NOT NULL');
    expect(capturedCollisionSql).toContain('email_confirmed_at IS NOT NULL');
  });

  it('queries phone collisions strictly requiring verified holders across public.users, user_auth_providers, and auth.identities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          phone: '+8801700000000',
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-incoming' }],
        }),
      }),
    );
    let capturedCollisionSql = '';
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('phone_collisions') ||
        sql.includes('FROM auth.identities')
      ) {
        capturedCollisionSql += `\n${sql}`;
        return [];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: '+8801700000000',
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
      'google',
    );

    expect(capturedCollisionSql).toContain("p.provider = 'phone'");
    expect(capturedCollisionSql).toContain('EXISTS (');
    expect(capturedCollisionSql).toContain('verified_at IS NOT NULL');
    expect(capturedCollisionSql).toContain('phone_confirmed_at IS NOT NULL');
  });

  it('provider-less sync selects Facebook AMR evidence over sticky Google app_metadata', async () => {
    const facebookTimestamp = 1700000300;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub-1' },
            { provider: 'facebook', id: 'fb-sub-1' },
          ],
        }),
      }),
    );
    let selectedProvider = '';
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('SELECT provider') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            max_activity_at: new Date(
              (facebookTimestamp - 600) * 1000,
            ).toISOString(),
          },
          {
            provider: 'facebook',
            max_activity_at: new Date(facebookTimestamp * 1000).toISOString(),
          },
        ];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('WHERE user_id = $1 AND verified_at IS NOT NULL')
      ) {
        return [
          { provider: 'facebook', contact_value: 'user@example.invalid' },
        ];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        selectedProvider = String(params?.[1] || '');
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google', 'facebook'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken(
      [{ method: 'oauth', timestamp: facebookTimestamp }],
      {
        app_metadata: {
          provider: 'google',
          providers: ['google', 'facebook'],
        },
      },
    );

    const res = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
    );

    expect(res).toBeDefined();
    expect(res.user.id).toBe(userId);
    expect(selectedProvider).toBe('facebook');
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('provider-less OAuth sync resolves by verified provider subject when Auth email changed after preserved contact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'changed@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            {
              provider: 'google',
              id: 'google-identity-id',
              identity_data: { sub: 'google-sub' },
            },
          ],
        }),
      }),
    );
    const lookupParams: unknown[][] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('SELECT provider') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            max_activity_at: new Date(1700000000 * 1000).toISOString(),
          },
        ];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        lookupParams.push(params || []);
        // stored mapping keeps the preserved original contact; only the subject can match
        return params?.[2] === 'google-sub'
          ? [{ verified_contact: true, verified_at: '2026-01-01T00:00:00Z' }]
          : [];
      }
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'original@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', timestamp: 1700000000 }]);
    const res = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
    );

    expect(res.user.id).toBe(userId);
    expect(lookupParams).toEqual([[userId, 'google', 'google-sub']]);
  });

  it('rejects explicit Google bootstrap on a Facebook session even when Google is the only verified mapping', async () => {
    const amrTimestamp = 1700000000;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'multi-oauth@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub' },
            { provider: 'facebook', id: 'facebook-sub' },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('AS max_activity_at') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            max_activity_at: new Date(
              (amrTimestamp - 3600) * 1000,
            ).toISOString(),
          },
          {
            provider: 'facebook',
            max_activity_at: new Date(amrTimestamp * 1000).toISOString(),
          },
        ];
      }
      if (sql.includes('FROM public.user_auth_providers')) {
        return [{ provider: 'google', contact_value: 'g@example.invalid' }];
      }
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', timestamp: amrTimestamp }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${token}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROVIDER_MISMATCH' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();
  });
  it('provider-less sync keeps verified Google session after Facebook T+30 and Google T+600 activity', async () => {
    const amrTimestamp = 1700000000;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub-1' },
            { provider: 'facebook', id: 'fb-sub-1' },
          ],
        }),
      }),
    );
    let selectedProvider = '';
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('SELECT provider') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            created_at: new Date(amrTimestamp * 1000).toISOString(),
            updated_at: new Date((amrTimestamp + 600) * 1000).toISOString(),
            max_activity_at: new Date(
              (amrTimestamp + 600) * 1000,
            ).toISOString(),
          },
          {
            provider: 'facebook',
            max_activity_at: new Date((amrTimestamp + 30) * 1000).toISOString(),
          },
        ];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('WHERE user_id = $1 AND verified_at IS NOT NULL')
      ) {
        return [{ provider: 'google', contact_value: 'user@example.invalid' }];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        selectedProvider = String(params?.[1] || '');
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google', 'facebook'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );

    const result = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', timestamp: amrTimestamp }], {
        app_metadata: {
          provider: 'facebook',
          providers: ['google', 'facebook'],
        },
      })}`,
    );

    expect(result.user.id).toBe(userId);
    expect(selectedProvider).toBe('google');
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${accessToken([{ method: 'oauth', timestamp: amrTimestamp }])}`,
        'facebook',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROVIDER_MISMATCH' },
    });
  });

  it('accepts delayed Google callback when Facebook occurs at T+30 and Google signs in again at T+600', async () => {
    const amrTimestamp = 1700000000;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub-1' },
            { provider: 'facebook', id: 'fb-sub-1' },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('email_collisions')) {
        return [];
      }
      if (
        sql.includes('SELECT provider') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            created_at: new Date(amrTimestamp * 1000).toISOString(),
            last_sign_in_at: new Date(
              (amrTimestamp + 600) * 1000,
            ).toISOString(),
            max_activity_at: new Date(
              (amrTimestamp + 600) * 1000,
            ).toISOString(),
          },
          {
            provider: 'facebook',
            last_sign_in_at: new Date((amrTimestamp + 30) * 1000).toISOString(),
            max_activity_at: new Date((amrTimestamp + 30) * 1000).toISOString(),
          },
        ];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (sql.includes('email_collisions')) {
        return [];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google', 'facebook'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth', timestamp: amrTimestamp }]);
    const res = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
      'google',
    );

    expect(res).toBeDefined();
    expect(res.user.id).toBe(userId);
    expect(approvals.approve).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      sessionId,
      'oauth',
    );
  });

  it('rejects an unbound explicit OAuth provider without affirmative AMR timestamp evidence', async () => {
    const amrTimestamp = 1700000000;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub-1' },
            { provider: 'facebook', id: 'facebook-sub-1' },
          ],
        }),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('AS max_activity_at') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            created_at: new Date((amrTimestamp - 600) * 1000).toISOString(),
            last_sign_in_at: new Date(
              (amrTimestamp + 600) * 1000,
            ).toISOString(),
            updated_at: new Date((amrTimestamp + 600) * 1000).toISOString(),
          },
          {
            provider: 'facebook',
            created_at: new Date((amrTimestamp - 900) * 1000).toISOString(),
            last_sign_in_at: new Date(
              (amrTimestamp + 700) * 1000,
            ).toISOString(),
            updated_at: new Date((amrTimestamp + 700) * 1000).toISOString(),
          },
        ];
      }
      return [];
    });
    const service = new AuthService(
      {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );

    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${accessToken([{ method: 'oauth', timestamp: amrTimestamp }])}`,
        'facebook',
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'PROVIDER_MISMATCH' },
    });
  });

  it('keeps a verified Google contact consistent when Auth returns a changed confirmed email', async () => {
    const storedEmail = 'stored@example.invalid';
    const incomingEmail = 'changed@example.invalid';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: incomingEmail,
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-consistency' }],
        }),
      }),
    );
    let providerUpsert = '';
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes("provider IN ('email', 'phone', 'google', 'facebook')")
      ) {
        return [{ provider: 'google', contact_value: storedEmail }];
      }
      if (sql.includes('SELECT id, phone FROM public.users')) {
        return [{ id: userId, phone: null }];
      }
      if (
        sql.includes('SELECT contact_value, provider_subject, verified_at') &&
        params?.[1] === 'google'
      ) {
        return [
          {
            contact_value: storedEmail,
            provider_subject: 'google-sub-consistency',
            verified_at: '2026-01-01T00:00:00Z',
          },
        ];
      }
      if (sql.includes('INSERT INTO public.user_auth_providers(')) {
        providerUpsert = sql;
      }
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: storedEmail,
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const service = new AuthService(
      {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService,
      configuration(),
      {} as AuthAbuseControl,
      { approve: vi.fn() } as unknown as SessionApprovalService,
    );

    const result = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
      'google',
    );

    expect(result.user.email).toBe(storedEmail);
    expect(providerUpsert).toContain(
      'THEN public.user_auth_providers.contact_value',
    );
  });

  it('repeated OAuth sign-in uses GREATEST activity timestamp when updated_at advances beyond initial last_sign_in_at', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [
            { provider: 'google', id: 'google-sub-1' },
            { provider: 'facebook', id: 'fb-sub-1' },
          ],
        }),
      }),
    );
    let capturedActiveProviderInLookup = '';
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('SELECT provider') &&
        sql.includes('FROM auth.identities')
      ) {
        return [
          {
            provider: 'google',
            last_sign_in_at: '2026-01-01T00:00:00Z', // older last_sign_in_at
            updated_at: '2026-01-05T00:00:00Z', // newer updated_at than Facebook
            created_at: '2026-01-01T00:00:00Z',
            max_activity_at: '2026-01-05T00:00:00Z',
          },
          {
            provider: 'facebook',
            last_sign_in_at: '2026-01-03T00:00:00Z',
            updated_at: '2026-01-03T00:00:00Z',
            created_at: '2026-01-03T00:00:00Z',
            max_activity_at: '2026-01-03T00:00:00Z',
          },
        ];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('WHERE user_id = $1 AND verified_at IS NOT NULL')
      ) {
        return [
          { provider: 'google', contact_value: 'user@example.invalid' },
          { provider: 'facebook', contact_value: 'user@example.invalid' },
        ];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        if (params && params[1]) {
          capturedActiveProviderInLookup = String(params[1]);
        }
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google', 'facebook'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    const token = accessToken([{ method: 'oauth' }], {
      app_metadata: { provider: 'email', providers: ['google', 'facebook'] },
    });

    const res = await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${token}`,
    );

    expect(res).toBeDefined();
    expect(res.user.id).toBe(userId);
    expect(capturedActiveProviderInLookup).toBe('google');
  });

  it('requires identity-level email verification in email_collisions so unverified secondary identity email on confirmed account is ignored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: userId,
          email: 'user@example.invalid',
          email_confirmed_at: '2026-01-01T00:00:00Z',
          identities: [{ provider: 'google', id: 'google-sub-incoming' }],
        }),
      }),
    );
    let capturedCollisionSql = '';
    const query = vi.fn(async (sql: string) => {
      if (
        sql.includes('email_collisions') ||
        sql.includes('FROM auth.identities')
      ) {
        capturedCollisionSql += `\n${sql}`;
        return [];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('provider_subject = $2')
      ) {
        return [];
      }
      if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
        return [
          { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
        ];
      }
      if (sql.startsWith('SELECT verified_contact')) {
        return [{ verified_contact: true }];
      }
      if (sql.includes("provider='email' AND verified_at IS NULL")) return [];
      if (sql.includes('SELECT u.id,u.email')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            phone: null,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['google'],
          },
        ];
      }
      if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      return [];
    });
    const database = {
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const approvals = { approve: vi.fn() } as unknown as SessionApprovalService;
    const service = new AuthService(
      database,
      configuration(),
      {} as AuthAbuseControl,
      approvals,
    );

    await service.bootstrap(
      { sub: userId, sessionId },
      `Bearer ${accessToken([{ method: 'oauth', provider: 'google' }])}`,
      'google',
    );

    expect(capturedCollisionSql).toContain("p.provider = 'email'");
    expect(capturedCollisionSql).toContain('EXISTS (');
    expect(capturedCollisionSql).toContain('verified_at IS NOT NULL');
    expect(capturedCollisionSql).toContain('email_confirmed_at IS NOT NULL');
    expect(capturedCollisionSql).toContain('LOWER(au.email) = $1');
    expect(capturedCollisionSql).toContain(
      "COALESCE(i.identity_data->>'email_verified', 'false')",
    );
  });

  it('maps PostgreSQL 23505 unique constraint violation to 409 CONTACT_ALREADY_REGISTERED during verifyEmail', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.users u')) {
        return [
          {
            id: userId,
            email: 'user@example.invalid',
            verified_contact: false,
            provider_subject: userId,
            verified_at: null,
          },
        ];
      }
      if (sql.includes('FROM public.users') && sql.includes('FOR UPDATE')) {
        return [{ id: userId, status: 'active', verified_contact: false }];
      }
      if (
        sql.includes('FROM public.user_auth_providers') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: 'mapping-1',
            contact_value: 'user@example.invalid',
            provider_subject: userId,
            verified_at: null,
          },
        ];
      }
      if (sql.includes('UPDATE public.users')) {
        const err = new Error(
          'duplicate key value violates unique constraint "uq_users_email"',
        ) as any;
        err.code = '23505';
        err.driverError = { code: '23505', constraint: 'uq_users_email' };
        throw err;
      }
      return [];
    });
    const database = {
      query,
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const config = configuration({
      AUTH_OTP_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
    });
    const realOtpAbuse = {
      getOtpSecret: vi.fn(),
      verifyChallenge: vi.fn(
        async (
          _subject: unknown,
          candidateCode: string,
          check: (candidate: string) => Promise<boolean>,
        ) => {
          const valid = await check(candidateCode);
          if (!valid) fail(422, 'VERIFICATION_CODE_INVALID', 'Invalid code');
        },
      ),
    } as unknown as AuthAbuseControl;
    const otpStore = new OtpSecretStore(realOtpAbuse, config);
    vi.mocked(realOtpAbuse.getOtpSecret).mockResolvedValue(
      otpStore.computeDigest(
        userId,
        'user@example.invalid',
        '123456',
        'verify_email',
      ),
    );
    const service = new AuthService(
      database,
      config,
      realOtpAbuse,
      {} as SessionApprovalService,
      otpStore,
    );

    await expect(
      service.verifyEmail({ email: 'user@example.invalid', code: '123456' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONTACT_ALREADY_REGISTERED' },
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [userId],
    );
  });

  it('maps PostgreSQL 23505 unique constraint violation to 409 CONTACT_ALREADY_REGISTERED during verifyPhone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.users u')) {
        return [
          {
            id: userId,
            phone: '+8801712345678',
            verified_contact: false,
            provider_subject: userId,
            verified_at: null,
            is_primary: true,
          },
        ];
      }
      if (
        sql.includes(
          'SELECT u.id, p.contact_value, p.provider_subject, p.verified_at',
        )
      ) {
        return [
          {
            id: userId,
            contact_value: '+8801712345678',
            provider_subject: userId,
            verified_at: null,
          },
        ];
      }
      if (sql.includes('UPDATE public.users')) {
        const err = new Error(
          'duplicate key value violates unique constraint "uq_users_phone"',
        ) as any;
        err.code = '23505';
        err.driverError = { code: '23505', constraint: 'uq_users_phone' };
        throw err;
      }
      return [];
    });
    const database = {
      query,
      transaction: vi.fn((_id, operation) =>
        operation({ query } as unknown as EntityManager),
      ),
    } as unknown as DatabaseService;
    const config = configuration({
      AUTH_OTP_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
    });
    const realOtpAbuse = {
      getOtpSecret: vi.fn(),
      verifyChallenge: vi.fn(
        async (
          _subject: unknown,
          candidateCode: string,
          check: (candidate: string) => Promise<boolean>,
        ) => {
          const valid = await check(candidateCode);
          if (!valid) fail(422, 'VERIFICATION_CODE_INVALID', 'Invalid code');
        },
      ),
    } as unknown as AuthAbuseControl;
    const otpStore = new OtpSecretStore(realOtpAbuse, config);
    vi.mocked(realOtpAbuse.getOtpSecret).mockResolvedValue(
      otpStore.computeDigest(
        userId,
        '+8801712345678',
        '123456',
        'verify_phone',
      ),
    );
    const service = new AuthService(
      database,
      config,
      realOtpAbuse,
      {} as SessionApprovalService,
      otpStore,
    );

    await expect(
      service.verifyPhone({ phone: '+8801712345678', code: '123456' }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CONTACT_ALREADY_REGISTERED' },
    });
  });

  describe('EP-A07 logout', () => {
    const mockAbuse = {} as unknown as AuthAbuseControl;

    it('revokes session in DB and invalidates GoTrue session locally', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      const approvals = {
        revokeSession: vi.fn().mockResolvedValue(true),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        approvals,
      );

      const result = await service.logout(
        { sub: userId, sessionId },
        'Bearer test-token',
      );

      expect(result).toEqual({ logged_out: true });
      expect(approvals.revokeSession).toHaveBeenCalledWith(userId, sessionId);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase.invalid/auth/v1/logout?scope=local',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('succeeds even if GoTrue session revocation throws or times out (best effort)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Network error')),
      );

      const approvals = {
        revokeSession: vi.fn().mockResolvedValue(true),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        approvals,
      );

      const result = await service.logout(
        { sub: userId, sessionId },
        'Bearer test-token',
      );

      expect(result).toEqual({ logged_out: true });
      expect(approvals.revokeSession).toHaveBeenCalledWith(userId, sessionId);
    });
  });

  describe('EP-A06 refresh', () => {
    const mockAbuse = {} as unknown as AuthAbuseControl;

    it('rejects empty or missing refresh_token', async () => {
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
      );

      await expect(service.refresh({})).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
      await expect(
        service.refresh({ refresh_token: '' }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VALIDATION_FAILED' },
      });
    });

    it('maps GoTrue timeout to 504 PROVIDER_TIMEOUT', async () => {
      const timeoutError = new Error(
        'The operation was aborted due to timeout',
      );
      timeoutError.name = 'AbortError';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutError));

      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
      );

      await expect(
        service.refresh({ refresh_token: 'some-token' }),
      ).rejects.toMatchObject({
        status: 504,
        response: { code: 'PROVIDER_TIMEOUT' },
      });
    });

    it('maps GoTrue 502/500 to 502 PROVIDER_ERROR', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
      );

      await expect(
        service.refresh({ refresh_token: 'some-token' }),
      ).rejects.toMatchObject({
        status: 502,
        response: { code: 'PROVIDER_ERROR' },
      });
    });

    it('maps GoTrue 400/401 to 401 REFRESH_TOKEN_INVALID', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          json: async () => ({ error: 'invalid_grant' }),
        }),
      );

      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
      );

      await expect(
        service.refresh({ refresh_token: 'invalid-token' }),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'REFRESH_TOKEN_INVALID' },
      });
    });

    it('fails closed with 401 REFRESH_TOKEN_INVALID when session is unapproved or revoked, never calling approveSession', async () => {
      const newJwt = accessToken();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: newJwt,
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
          }),
        }),
      );

      const approvals = {
        isSessionApproved: vi.fn().mockResolvedValue(false),
        approve: vi.fn(),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        approvals,
      );

      await expect(
        service.refresh({ refresh_token: 'valid-token' }),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'REFRESH_TOKEN_INVALID' },
      });
      expect(approvals.isSessionApproved).toHaveBeenCalledWith(
        userId,
        sessionId,
      );
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('succeeds for approved unrevoked session, updating activity and returning flat AuthSessionDTO', async () => {
      const newJwt = accessToken();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: newJwt,
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
          }),
        }),
      );

      const query = vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM public.users u WHERE u.id=$1'))
          return [
            {
              id: userId,
              email: 'active@example.com',
              status: 'active',
              verified_contact: true,
              role: 'USER',
              linked_providers: ['email'],
            },
          ];
        if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const approvals = {
        isSessionApproved: vi.fn().mockResolvedValue(true),
        approve: vi.fn(),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        mockAbuse,
        approvals,
      );

      const result = await service.refresh({ refresh_token: 'valid-token' });

      expect(result).toMatchObject({
        access_token: newJwt,
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: { id: userId, status: 'active', verified_contact: true },
        next_step: 'profile_setup',
      });
      expect(approvals.isSessionApproved).toHaveBeenCalledWith(
        userId,
        sessionId,
      );
      expect(approvals.approve).not.toHaveBeenCalled();
      expect(database.transaction).toHaveBeenCalledWith(
        userId,
        expect.any(Function),
        false,
        false,
      );
    });

    it('lifecycle sequence: EP-A07 logout revokes session, causing subsequent refresh to fail closed without auto-approval', async () => {
      let sessionApproved = true;
      const approvals = {
        revokeSession: vi.fn(async () => {
          sessionApproved = false;
          return true;
        }),
        isSessionApproved: vi.fn(async () => sessionApproved),
        approve: vi.fn(),
      } as unknown as SessionApprovalService;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: accessToken(),
            refresh_token: 'rot-refresh',
            expires_in: 3600,
            token_type: 'bearer',
          }),
        }),
      );

      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        approvals,
      );

      // Step 1: User logs out
      await service.logout({ sub: userId, sessionId }, 'Bearer token');
      expect(approvals.revokeSession).toHaveBeenCalledWith(userId, sessionId);
      expect(sessionApproved).toBe(false);

      // Step 2: Attempting to refresh the revoked session fails closed
      await expect(
        service.refresh({ refresh_token: 'rot-refresh' }),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'REFRESH_TOKEN_INVALID' },
      });
      expect(approvals.isSessionApproved).toHaveBeenCalledWith(
        userId,
        sessionId,
      );
      expect(approvals.approve).not.toHaveBeenCalled();
    });
  });

  describe('EP-A08 Forgot Password', () => {
    it('fails closed with 503 when abuse control, otpStore, or emailProvider is unconfigured', async () => {
      const mockAbuse = {
        isReady: vi.fn().mockReturnValue(false),
      } as unknown as AuthAbuseControl;
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
        undefined,
        undefined,
      );

      await expect(
        service.forgotPassword({ identifier: 'user@example.com' }),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });
    });

    it('rejects phone identifier with 503', async () => {
      const mockAbuse = {
        isReady: vi.fn().mockReturnValue(true),
      } as unknown as AuthAbuseControl;
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.forgotPassword({ identifier: '+8801712345678' }),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });
    });

    it('forwards rate limiting / abuse errors from reserveSend', async () => {
      const mockAbuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockRejectedValue({
          status: 429,
          getResponse: () => ({ code: 'RESEND_COOLDOWN_ACTIVE' }),
          getStatus: () => 429,
        }),
      } as unknown as AuthAbuseControl;
      const mockEmailProvider = {
        ready: vi.fn(),
      } as unknown as EmailRegistrationProvider;
      const mockOtpStore = {} as OtpSecretStore;
      const service = new AuthService(
        {} as never,
        configuration(),
        mockAbuse,
        {} as never,
        mockOtpStore,
        mockEmailProvider,
      );

      await expect(
        service.forgotPassword({ identifier: 'user@example.com' }, {
          ip: '127.0.0.1',
          socket: { remoteAddress: '127.0.0.1' },
        } as Request),
      ).rejects.toMatchObject({
        status: 429,
      });
    });

    it('preserves anti-enumeration: returns 202 when user does not exist without sending challenge', async () => {
      const mockAbuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;
      const mockEmailProvider = {
        ready: vi.fn(),
        sendPasswordResetChallenge: vi.fn(),
      } as unknown as EmailRegistrationProvider;
      const mockOtpStore = {} as OtpSecretStore;
      const database = {
        query: vi.fn().mockResolvedValue([]),
      } as unknown as DatabaseService;

      const service = new AuthService(
        database,
        configuration(),
        mockAbuse,
        {} as never,
        mockOtpStore,
        mockEmailProvider,
      );

      const response = await service.forgotPassword(
        { identifier: 'unknown@example.com' },
        { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as Request,
      );

      expect(response).toEqual({
        message: 'If the account exists, a code was sent.',
      });
      expect(
        mockEmailProvider.sendPasswordResetChallenge,
      ).not.toHaveBeenCalled();
    });

    it('dispatches challenge and returns uniform 202 for active, verified email user', async () => {
      const mockAbuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;
      const mockEmailProvider = {
        ready: vi.fn(),
        sendPasswordResetChallenge: vi
          .fn()
          .mockResolvedValue({ expiresInSeconds: 600 }),
      } as unknown as EmailRegistrationProvider;
      const mockOtpStore = {} as OtpSecretStore;
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
      } as unknown as DatabaseService;

      const service = new AuthService(
        database,
        configuration(),
        mockAbuse,
        {} as never,
        mockOtpStore,
        mockEmailProvider,
      );

      const response = await service.forgotPassword(
        { identifier: 'user@example.com' },
        { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as Request,
      );

      expect(response).toEqual({
        message: 'If the account exists, a code was sent.',
      });
      expect(mockEmailProvider.sendPasswordResetChallenge).toHaveBeenCalledWith(
        'user@example.com',
        userId,
      );
    });

    it('returns uniform 202 even when background challenge dispatch fails', async () => {
      const mockAbuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;
      const mockEmailProvider = {
        ready: vi.fn(),
        sendPasswordResetChallenge: vi
          .fn()
          .mockRejectedValue(new Error('SMTP down')),
      } as unknown as EmailRegistrationProvider;
      const mockOtpStore = {} as OtpSecretStore;
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
      } as unknown as DatabaseService;

      const service = new AuthService(
        database,
        configuration(),
        mockAbuse,
        {} as never,
        mockOtpStore,
        mockEmailProvider,
      );

      const response = await service.forgotPassword(
        { identifier: 'user@example.com' },
        { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as Request,
      );

      expect(response).toEqual({
        message: 'If the account exists, a code was sent.',
      });
      expect(mockEmailProvider.sendPasswordResetChallenge).toHaveBeenCalledWith(
        'user@example.com',
        userId,
      );
    });
  });

  describe('EP-A09 Reset Password', () => {
    const resetBody = {
      identifier: 'user@example.com',
      code: '123456',
      new_password: 'N3w!Passw0rd',
      confirm_new_password: 'N3w!Passw0rd',
    };

    it('fails closed with 503 if otpStore is unconfigured', async () => {
      const service = new AuthService(
        {} as never,
        configuration(),
        {} as never,
        {} as never,
        undefined,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });
    });

    it('returns 410 VERIFICATION_CODE_EXPIRED when user does not exist in DB', async () => {
      const database = {
        query: vi.fn().mockResolvedValue([]),
      } as unknown as DatabaseService;
      const mockOtpStore = {} as OtpSecretStore;
      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        {} as never,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 410,
        response: { code: 'VERIFICATION_CODE_EXPIRED' },
      });
    });

    it('enforces configured AUTH_PASSWORD_MIN_LENGTH', async () => {
      const customConfig = configuration({
        AUTH_PASSWORD_MIN_LENGTH: 12,
      });

      const service = new AuthService(
        { query: vi.fn() } as unknown as DatabaseService,
        customConfig,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.resetPassword({
          identifier: 'user@example.com',
          code: '123456',
          new_password: 'Passw0rd!10',
          confirm_new_password: 'Passw0rd!10',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'PASSWORD_POLICY_FAILED' },
      });
    });

    it('does not leak 403 ACCOUNT_SUSPENDED when OTP is invalid for suspended user', async () => {
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'suspended',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
      } as unknown as DatabaseService;
      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn().mockRejectedValue({
          status: 422,
          getResponse: () => ({ code: 'VERIFICATION_CODE_INVALID' }),
          getStatus: () => 422,
        }),
      } as unknown as OtpSecretStore;
      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        {} as never,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 422,
      });
    });

    it('throws 403 ACCOUNT_SUSPENDED within locked transaction on valid OTP if user is suspended', async () => {
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'suspended',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn().mockRejectedValue({
          status: 403,
          getResponse: () => ({ code: 'ACCOUNT_SUSPENDED' }),
          getStatus: () => 403,
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(async (_userId, _email, _code, onValid) => {
          if (onValid) await onValid();
        }),
      } as unknown as OtpSecretStore;

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        {} as never,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 403,
      });
      expect(database.transaction).toHaveBeenCalledWith(
        userId,
        expect.any(Function),
        true,
      );
    });

    it('updates password in GoTrue, revokes ALL sessions, and returns 200 on valid code', async () => {
      const mockDbRunner = { query: vi.fn().mockResolvedValue([]) };
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn(async (targetUserId, operation, active) => {
          if (targetUserId !== null) {
            expect(targetUserId).toBe(userId);
            expect(active).toBe(true);
          }
          return operation(mockDbRunner as never);
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(
          async (_userId, _email, _code, onValid, purpose) => {
            expect(purpose).toBe('reset_password');
            if (onValid) await onValid();
          },
        ),
      } as unknown as OtpSecretStore;

      const mockApprovals = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(2),
      } as unknown as SessionApprovalService;

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: userId }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        mockApprovals,
        mockOtpStore,
      );

      const response = await service.resetPassword(resetBody);

      expect(response).toEqual({
        password_reset: true,
      });

      // Verify transaction called with user lock
      expect(database.transaction).toHaveBeenCalledWith(
        userId,
        expect.any(Function),
        true,
      );

      // Verify GoTrue Admin API called with new password
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://supabase.invalid/auth/v1/admin/users/${userId}`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ password: 'N3w!Passw0rd' }),
        }),
      );

      // Verify GoTrue sessions and refresh tokens invalidated inside statement-timeout transaction
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 5000',
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL lock_timeout = 5000',
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE auth.refresh_tokens'),
        [userId],
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'DELETE FROM auth.sessions WHERE user_id = $1::uuid',
        [userId],
      );

      // Verify ALL user sessions revoked with transactional query runner
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledWith(
        userId,
        mockDbRunner,
      );
    });

    it('logs error and still completes GoTrue session revocation when post-commit OTP consumption fails', async () => {
      const mockDbRunner = { query: vi.fn().mockResolvedValue([]) };
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn(async (_targetUserId, operation) => {
          return operation(mockDbRunner as never);
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(async (_userId, _email, _code, onValid) => {
          if (onValid) await onValid();
          throw new Error('Redis post-commit valid step failed');
        }),
      } as unknown as OtpSecretStore;

      const mockApprovals = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(1),
      } as unknown as SessionApprovalService;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: userId }),
        }),
      );

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        mockApprovals,
        mockOtpStore,
      );
      const loggerErrorSpy = vi.spyOn((service as any).logger, 'error');

      const response = await service.resetPassword(resetBody);
      expect(response).toEqual({ password_reset: true });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `OTP consumption failed after password reset commit for user ${userId}`,
        expect.stringContaining('Redis post-commit valid step failed'),
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 5000',
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL lock_timeout = 5000',
      );
    });

    it('fails with non-retryable 502 PROVIDER_ERROR if GoTrue session revocation fails after transaction commits and OTP is consumed', async () => {
      let transactionCommitted = false;
      let otpConsumed = false;
      let orderingViolated = false;
      const mockDbRunner = {
        query: vi.fn(async (sql: string) => {
          if (
            sql.startsWith('SET LOCAL statement_timeout') ||
            sql.startsWith('SET LOCAL lock_timeout')
          ) {
            return [];
          }
          if (!transactionCommitted || !otpConsumed) {
            orderingViolated = true;
          }
          throw new Error('DB session delete failed');
        }),
      };
      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn(async (targetUserId, operation) => {
          const res = await operation(mockDbRunner as never);
          if (targetUserId !== null) {
            transactionCommitted = true;
          }
          return res;
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(async (_userId, _email, _code, onValid) => {
          if (onValid) await onValid();
          otpConsumed = true;
        }),
      } as unknown as OtpSecretStore;

      const mockApprovals = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(1),
      } as unknown as SessionApprovalService;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: userId }),
        }),
      );

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        mockApprovals,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 502,
        response: {
          code: 'PROVIDER_ERROR',
          retryable: false,
          message: expect.stringContaining(
            'Password was updated and local sessions were revoked',
          ),
        },
      });

      expect(orderingViolated).toBe(false);
      expect(transactionCommitted).toBe(true);
      expect(otpConsumed).toBe(true);
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledTimes(1);
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledWith(
        userId,
        mockDbRunner,
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 5000',
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL lock_timeout = 5000',
      );
    });

    it('retries compensating local session revocation if transaction fails on commit after GoTrue password update', async () => {
      const mockDbRunner = { query: vi.fn() };
      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn(async (_targetUserId, operation) => {
          await operation(mockDbRunner as never);
          throw new Error('Transaction commit failed');
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(async (_userId, _email, _code, onValid) => {
          if (onValid) await onValid();
        }),
      } as unknown as OtpSecretStore;

      const mockApprovals = {
        revokeAllUserSessions: vi
          .fn()
          .mockResolvedValueOnce(1)
          .mockRejectedValueOnce(new Error('Transient DB error'))
          .mockResolvedValueOnce(1),
      } as unknown as SessionApprovalService;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: userId }),
        }),
      );

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        mockApprovals,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toThrow(
        'Transaction commit failed',
      );

      // 1st call inside transaction with mockDbRunner; 2nd and 3rd calls are compensating retries outside transaction
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledTimes(3);
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenNthCalledWith(
        1,
        userId,
        mockDbRunner,
      );
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenNthCalledWith(
        2,
        userId,
      );
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenNthCalledWith(
        3,
        userId,
      );
    });

    it('cancels blocked cleanup query via transaction-scoped SET LOCAL statement_timeout (57014), awaits rollback/release, and fails with non-retryable 504 PROVIDER_TIMEOUT', async () => {
      let transactionCommitted = false;
      let otpConsumed = false;
      let orderingViolated = false;
      let rollbackAwaitedCount = 0;
      let releaseAwaitedCount = 0;
      const mockDbRunner = {
        query: vi.fn(async (sql: string) => {
          if (
            sql.startsWith('SET LOCAL statement_timeout') ||
            sql.startsWith('SET LOCAL lock_timeout')
          ) {
            return [];
          }
          if (!transactionCommitted || !otpConsumed) {
            orderingViolated = true;
          }
          const pgTimeoutError = Object.assign(
            new Error('canceling statement due to statement timeout'),
            { code: '57014' },
          );
          throw pgTimeoutError;
        }),
        rollbackTransaction: vi.fn(async () => {
          await Promise.resolve();
          rollbackAwaitedCount++;
        }),
        release: vi.fn(async () => {
          await Promise.resolve();
          releaseAwaitedCount++;
        }),
      };
      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn(async (targetUserId, operation) => {
          try {
            const res = await operation(mockDbRunner as never);
            if (targetUserId !== null) {
              transactionCommitted = true;
            }
            return res;
          } catch (error) {
            await mockDbRunner.rollbackTransaction();
            throw error;
          } finally {
            await mockDbRunner.release();
          }
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(async (_userId, _email, _code, onValid) => {
          if (onValid) await onValid();
          otpConsumed = true;
        }),
      } as unknown as OtpSecretStore;

      const mockApprovals = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(1),
      } as unknown as SessionApprovalService;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: userId }),
        }),
      );

      const service = new AuthService(
        database,
        configuration({ GOTRUE_TIMEOUT_MS: 25 }),
        {} as never,
        mockApprovals,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 504,
        response: {
          code: 'PROVIDER_TIMEOUT',
          retryable: false,
          message: expect.stringContaining(
            'Password was updated and local sessions were revoked',
          ),
        },
      });

      expect(orderingViolated).toBe(false);
      expect(transactionCommitted).toBe(true);
      expect(otpConsumed).toBe(true);
      expect(rollbackAwaitedCount).toBe(3);
      expect(releaseAwaitedCount).toBe(4);
      expect(mockDbRunner.rollbackTransaction).toHaveBeenCalledTimes(3);
      expect(mockDbRunner.release).toHaveBeenCalledTimes(4);
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 25',
      );
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL lock_timeout = 25',
      );
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledTimes(1);
    });

    it('rolls back database transaction and fails if GoTrue update fails', async () => {
      const mockDbRunner = { query: vi.fn() };
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
        transaction: vi.fn(async (_targetUserId, operation) => {
          return operation(mockDbRunner as never);
        }),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn(async (_userId, _email, _code, onValid) => {
          if (onValid) await onValid();
        }),
      } as unknown as OtpSecretStore;

      const mockApprovals = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(2),
      } as unknown as SessionApprovalService;

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal server error' }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        mockApprovals,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 502,
        response: { code: 'PROVIDER_ERROR' },
      });
    });

    it('rejects cross-domain OTP: verification challenge failures are forwarded', async () => {
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn().mockRejectedValue({
          status: 422,
          getResponse: () => ({ code: 'VERIFICATION_CODE_INVALID' }),
          getStatus: () => 422,
        }),
      } as unknown as OtpSecretStore;

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        {} as never,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 422,
      });
    });

    it('returns 410 VERIFICATION_CODE_EXPIRED when replaying an already-consumed reset code', async () => {
      const database = {
        query: vi.fn().mockResolvedValue([
          {
            id: userId,
            email: 'user@example.com',
            status: 'active',
            verified_contact: true,
            verified_at: '2026-01-01T00:00:00Z',
          },
        ]),
      } as unknown as DatabaseService;

      const mockOtpStore = {
        verifyAndConsumeOtp: vi.fn().mockImplementation(() => {
          fail(
            410,
            'VERIFICATION_CODE_EXPIRED',
            'Verification challenge expired',
          );
        }),
      } as unknown as OtpSecretStore;

      const service = new AuthService(
        database,
        configuration(),
        {} as never,
        {} as never,
        mockOtpStore,
      );

      await expect(service.resetPassword(resetBody)).rejects.toMatchObject({
        status: 410,
        response: { code: 'VERIFICATION_CODE_EXPIRED' },
      });
    });
  });

  describe('linkIdentity (EP-A11)', () => {
    const identity = { sub: userId, sessionId };
    const authHeader = `Bearer ${accessToken()}`;

    it('links Google OAuth identity to verified account and returns linked_providers', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            email: 'candidate@example.com',
            email_confirmed_at: '2026-01-01T00:00:00Z',
            identities: [
              {
                provider: 'google',
                id: 'google-row-id',
                identity_data: { sub: 'google-sub-123' },
              },
            ],
          }),
        }),
      );

      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('AND user_id <> $3')) {
          return [];
        }
        if (sql.includes('SELECT ARRAY(')) {
          return [{ linked_providers: ['email', 'google'] }];
        }
        return [];
      });

      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );

      const result = await service.linkIdentity(identity, authHeader, {
        provider: 'google',
      });

      expect(result).toEqual({
        linked_providers: ['email', 'google'],
      });
      expect(database.transaction).toHaveBeenCalledWith(
        userId,
        expect.any(Function),
        true,
        true,
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO public.user_auth_providers'),
        [
          userId,
          'google',
          'google-sub-123',
          'candidate@example.com',
          '2026-01-01T00:00:00Z',
        ],
      );
    });

    it('rejects with 403 VERIFIED_CONTACT_REQUIRED when account has no verified contact', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [
              {
                provider: 'facebook',
                id: 'fb-sub-123',
                identity_data: { sub: 'fb-sub-123' },
              },
            ],
          }),
        }),
      );

      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: false }];
        }
        return [];
      });

      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );

      await expect(
        service.linkIdentity(identity, authHeader, { provider: 'facebook' }),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'VERIFIED_CONTACT_REQUIRED' },
      });
    });

    it('rejects with 422 PROVIDER_MISMATCH when requested provider is not attached to Auth user', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'email', id: userId }],
          }),
        }),
      );

      const service = new AuthService(
        { transaction: vi.fn() } as unknown as DatabaseService,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );

      await expect(
        service.linkIdentity(identity, authHeader, { provider: 'google' }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'PROVIDER_MISMATCH' },
      });
    });

    it('rejects with 409 IDENTITY_LINK_CONFLICT when provider subject belongs to another user', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [
              {
                provider: 'google',
                id: 'google-sub-conflict',
                identity_data: { sub: 'google-sub-conflict' },
              },
            ],
          }),
        }),
      );

      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('AND user_id <> $3')) {
          return [{ user_id: '22222222-2222-4222-8222-222222222222' }];
        }
        return [];
      });

      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );

      await expect(
        service.linkIdentity(identity, authHeader, { provider: 'google' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'IDENTITY_LINK_CONFLICT' },
      });
    });
  });

  describe('addContact (EP-A12)', () => {
    const identity = { sub: userId, sessionId };
    const authHeader = `Bearer ${accessToken()}`;

    it('stages unverified email contact, dispatches OTP challenge, and returns 202 RegistrationPendingDTO', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const query = vi.fn().mockResolvedValue([]);
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const otpStore = {} as unknown as OtpSecretStore;
      const emailProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
      } as unknown as EmailRegistrationProvider;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        otpStore,
        emailProvider,
      );

      const result = await service.addContact(identity, authHeader, {
        channel: 'email',
        contact: 'Candidate@Example.com',
      });

      expect(result).toEqual({
        verification_channel: 'email',
        contact_masked: 'c****@example.com',
        expires_in_seconds: 600,
        resend_available_at: expect.any(String),
      });
      expect(query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [userId],
      );
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'email', identifier: 'candidate@example.com' },
        '127.0.0.1',
      );
      expect(emailProvider.sendChallenge).toHaveBeenCalledWith({
        id: userId,
        subject: userId,
        email: 'candidate@example.com',
        verified: false,
      });
    });

    it('rejects phone channel with 503 SERVICE_UNAVAILABLE while SMS gateway is disabled', async () => {
      const service = new AuthService(
        { transaction: vi.fn() } as unknown as DatabaseService,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );

      await expect(
        service.addContact(identity, authHeader, {
          channel: 'phone',
          contact: '01712345678',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });
    });

    it('rejects with 409 CONTACT_ALREADY_REGISTERED when email is already registered to another user', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const query = vi.fn(async (sql: string) => {
        if (
          sql.includes('SELECT id FROM public.users WHERE lower(email::text)')
        ) {
          return [{ id: '22222222-2222-4222-8222-222222222222' }];
        }
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        { ready: vi.fn() } as unknown as EmailRegistrationProvider,
      );

      await expect(
        service.addContact(identity, authHeader, {
          channel: 'email',
          contact: 'taken@example.com',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'CONTACT_ALREADY_REGISTERED' },
      });
    });

    it('rejects with 409 ALREADY_VERIFIED when user already has verified_contact: true', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        { ready: vi.fn() } as unknown as EmailRegistrationProvider,
      );

      await expect(
        service.addContact(identity, authHeader, {
          channel: 'email',
          contact: 'new@example.com',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_VERIFIED' },
      });
    });

    it('propagates custom effective expiresInSeconds from sendChallenge to client', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const emailProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 300 }),
      } as unknown as EmailRegistrationProvider;

      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact'))
          return [{ verified_contact: false }];
        if (sql.includes('SELECT id FROM public.users')) return [];
        if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
          return [];
        if (sql.includes('SELECT contact_value, verified_at')) return [];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        emailProvider,
      );

      const result = await service.addContact(identity, authHeader, {
        channel: 'email',
        contact: 'candidate@example.com',
      });

      expect(result.expires_in_seconds).toBe(300);
    });

    it('rejects with 502 EMAIL_PROVIDER_ERROR when sendChallenge returns non-positive expiresInSeconds', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const emailProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 0 }),
      } as unknown as EmailRegistrationProvider;

      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact'))
          return [{ verified_contact: false }];
        if (sql.includes('SELECT id FROM public.users')) return [];
        if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
          return [];
        if (sql.includes('SELECT contact_value, verified_at')) return [];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        emailProvider,
      );

      await expect(
        service.addContact(identity, authHeader, {
          channel: 'email',
          contact: 'candidate@example.com',
        }),
      ).rejects.toMatchObject({
        status: 502,
        response: { code: 'EMAIL_PROVIDER_ERROR' },
      });
    });

    it('rejects with 400 CHALLENGE_EXPIRED when challenge is already expired at delivery time', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const emailProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({
          expiresInSeconds: 600,
          expiresAt: new Date(Date.now() - 5000),
        }),
      } as unknown as EmailRegistrationProvider;

      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact'))
          return [{ verified_contact: false }];
        if (sql.includes('SELECT id FROM public.users')) return [];
        if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
          return [];
        if (sql.includes('SELECT contact_value, verified_at')) return [];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        emailProvider,
      );

      await expect(
        service.addContact(identity, authHeader, {
          channel: 'email',
          contact: 'candidate@example.com',
        }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'CHALLENGE_EXPIRED' },
      });
    });

    it('dynamically computes remainingSeconds when future expiresAt timestamp is provided', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const emailProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({
          expiresInSeconds: 600,
          expiresAt: new Date(Date.now() + 250000),
        }),
      } as unknown as EmailRegistrationProvider;

      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact'))
          return [{ verified_contact: false }];
        if (sql.includes('SELECT id FROM public.users')) return [];
        if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
          return [];
        if (sql.includes('SELECT contact_value, verified_at')) return [];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        emailProvider,
      );

      const result = await service.addContact(identity, authHeader, {
        channel: 'email',
        contact: 'candidate@example.com',
      });

      expect(result.expires_in_seconds).toBeGreaterThanOrEqual(248);
      expect(result.expires_in_seconds).toBeLessThanOrEqual(250);
    });

    it('rounds sub-second remaining lifetime up to 1 second using Math.ceil', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            identities: [{ provider: 'facebook', id: 'fb-123' }],
          }),
        }),
      );

      const emailProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({
          expiresInSeconds: 600,
          expiresAt: new Date(Date.now() + 400),
        }),
      } as unknown as EmailRegistrationProvider;

      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact'))
          return [{ verified_contact: false }];
        if (sql.includes('SELECT id FROM public.users')) return [];
        if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
          return [];
        if (sql.includes('SELECT contact_value, verified_at')) return [];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        emailProvider,
      );

      const result = await service.addContact(identity, authHeader, {
        channel: 'email',
        contact: 'candidate@example.com',
      });

      expect(result.expires_in_seconds).toBe(1);
    });
  });

  describe('Phone Auth Lifecycle & verifyOtp (EP-A02, EP-A03, EP-A12, EP-A08)', () => {
    it('verifyOtp delegates to verifyPhone when channel is phone', async () => {
      const service = new AuthService(
        {} as DatabaseService,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );
      const spy = vi.spyOn(service, 'verifyPhone').mockResolvedValueOnce({
        access_token: 'phone_token',
      } as any);

      const result = await service.verifyOtp({
        channel: 'phone',
        phone: '+8801712345678',
        code: '123456',
      });

      expect(spy).toHaveBeenCalledWith(
        { phone: '+8801712345678', code: '123456' },
        undefined,
      );
      expect(result).toEqual({ access_token: 'phone_token' });
    });

    it('verifyOtp delegates to verifyEmail when channel is email', async () => {
      const service = new AuthService(
        {} as DatabaseService,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );
      const spy = vi.spyOn(service, 'verifyEmail').mockResolvedValueOnce({
        access_token: 'email_token',
      } as any);

      const result = await service.verifyOtp({
        channel: 'email',
        email: 'person@example.com',
        code: '654321',
      });

      expect(spy).toHaveBeenCalledWith(
        { email: 'person@example.com', code: '654321' },
        undefined,
      );
      expect(result).toEqual({ access_token: 'email_token' });
    });

    it('addContact dispatches SMS challenge via smsProvider for phone channel', async () => {
      const testIdentity = {
        sub: '11111111-1111-4111-8111-111111111111',
        sessionId: '11111111-1111-4111-8111-111111111112',
      };
      const smsProvider = {
        ready: vi.fn(),
        sendChallenge: vi.fn().mockResolvedValue({
          expiresInSeconds: 600,
        }),
      } as unknown as TextBeeSmsProvider;

      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact'))
          return [{ verified_contact: false }];
        if (sql.includes('SELECT id FROM public.users')) return [];
        if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
          return [];
        if (sql.includes('SELECT contact_value, verified_at')) return [];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        undefined,
        smsProvider,
      );

      vi.spyOn(service as any, 'authUser').mockResolvedValueOnce({
        id: testIdentity.sub,
      });

      const result = await service.addContact(testIdentity, 'Bearer token', {
        channel: 'phone',
        contact: '+8801712345678',
      });

      expect(smsProvider.ready).toHaveBeenCalled();
      expect(smsProvider.sendChallenge).toHaveBeenCalledWith({
        id: testIdentity.sub,
        phone: '+8801712345678',
      });
      expect(result.verification_channel).toBe('phone');
      expect(result.contact_masked).toBe('+8801****5678');
      expect(result.expires_in_seconds).toBe(600);
    });

    it('forgotPassword dispatches password reset challenge via smsProvider for phone channel', async () => {
      const smsProvider = {
        ready: vi.fn(),
        sendPasswordResetChallenge: vi.fn().mockResolvedValue({
          expiresInSeconds: 600,
        }),
      } as unknown as TextBeeSmsProvider;

      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: '11111111-1111-4111-8111-111111111111',
            phone: '+8801712345678',
            status: 'active',
            verified_contact: true,
            provider_subject: '11111111-1111-4111-8111-111111111111',
            verified_at: new Date().toISOString(),
          },
        ]),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        undefined,
        smsProvider,
      );

      const result = await service.forgotPassword({
        identifier: '+8801712345678',
      });

      expect(smsProvider.ready).toHaveBeenCalled();
      expect(smsProvider.sendPasswordResetChallenge).toHaveBeenCalledWith(
        '+8801712345678',
        '11111111-1111-4111-8111-111111111111',
      );
      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
      });
    });

    it('forgotPassword returns uniform message for unknown phone contact without dispatching challenge', async () => {
      const smsProvider = {
        ready: vi.fn(),
        sendPasswordResetChallenge: vi.fn(),
      } as unknown as TextBeeSmsProvider;

      const database = {
        query: vi.fn().mockResolvedValueOnce([]),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        undefined,
        smsProvider,
      );

      const result = await service.forgotPassword({
        identifier: '+8801712345678',
      });

      expect(smsProvider.ready).toHaveBeenCalled();
      expect(smsProvider.sendPasswordResetChallenge).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
      });
    });

    it('forgotPassword returns uniform message even if phone challenge background dispatch rejects', async () => {
      const smsProvider = {
        ready: vi.fn(),
        sendPasswordResetChallenge: vi
          .fn()
          .mockRejectedValueOnce(new Error('SMS Gateway failure')),
      } as unknown as TextBeeSmsProvider;

      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: '11111111-1111-4111-8111-111111111111',
            phone: '+8801712345678',
            status: 'active',
            verified_contact: true,
            provider_subject: '11111111-1111-4111-8111-111111111111',
            verified_at: new Date().toISOString(),
          },
        ]),
      } as unknown as DatabaseService;

      const abuse = {
        isReady: vi.fn().mockReturnValue(true),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;

      const service = new AuthService(
        database,
        configuration(),
        abuse,
        {} as SessionApprovalService,
        {} as OtpSecretStore,
        undefined,
        smsProvider,
      );

      const result = await service.forgotPassword({
        identifier: '+8801712345678',
      });

      expect(smsProvider.ready).toHaveBeenCalled();
      expect(smsProvider.sendPasswordResetChallenge).toHaveBeenCalledWith(
        '+8801712345678',
        '11111111-1111-4111-8111-111111111111',
      );
      expect(result).toEqual({
        message: 'If the account exists, a code was sent.',
      });
    });

    it('confirmGoTruePhoneUser passes normalized phone and phone_confirm: true to GoTrue Admin API', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }),
        );

      const service = new AuthService(
        {} as DatabaseService,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
      );

      await (service as any).confirmGoTruePhoneUser('user-1', '+8801712345678');

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://supabase.invalid/auth/v1/admin/users/user-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            phone: '+8801712345678',
            phone_confirm: true,
          }),
        }),
      );
      fetchSpy.mockRestore();
    });

    it('verifyPhone prevents race condition and aborts with 409 when pending provider mapping is replaced concurrently', async () => {
      const transactionQuery = vi
        .fn()
        .mockImplementation(async (sql: string) => {
          if (sql.includes('p.contact_value')) {
            return [];
          }
          return [];
        });
      const database = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT u.id, u.phone, u.verified_contact')) {
            return [
              {
                id: 'user-race-1',
                phone: '+8801712345678',
                verified_contact: false,
                provider_subject: '+8801712345678',
                verified_at: null,
                is_primary: true,
              },
            ];
          }
          return [];
        }),
        transaction: vi.fn(async (_id, cb) =>
          cb({
            query: transactionQuery,
          }),
        ),
      } as unknown as DatabaseService;

      const otpStore = {
        verifyAndConsumeOtp: vi.fn(async (_id, _contact, _code, cb) => {
          await cb();
        }),
      } as unknown as OtpSecretStore;

      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
        otpStore,
      );

      await expect(
        service.verifyPhone({ phone: '+8801712345678', code: '123456' }),
      ).rejects.toThrow(HttpException);
      expect(transactionQuery).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        ['user-race-1'],
      );
    });

    it('verifyPhone for EP-A12 secondary phone returns verified: true without minting session or touching GoTrue email', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'user-sec-1' }), { status: 200 }),
        );

      const database = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT u.id, u.phone, u.verified_contact')) {
            return [
              {
                id: 'user-sec-1',
                phone: '+8801712345678',
                verified_contact: false,
                provider_subject: '+8801712345678',
                verified_at: null,
                is_primary: false, // secondary contact
              },
            ];
          }
          return [];
        }),
        transaction: vi.fn(async (_id, cb) =>
          cb({
            query: vi.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('p.contact_value')) {
                return [{ id: 'prov-1', verified_at: null }];
              }
              if (sql.includes('UPDATE public.users')) {
                return [[], 1];
              }
              if (sql.includes('UPDATE public.user_auth_providers')) {
                return [[], 1];
              }
              return [];
            }),
          }),
        ),
      } as unknown as DatabaseService;

      const otpStore = {
        verifyAndConsumeOtp: vi.fn(async (_id, _contact, _code, cb) => {
          await cb();
        }),
      } as unknown as OtpSecretStore;

      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        {} as SessionApprovalService,
        otpStore,
      );

      const result = await service.verifyPhone({
        phone: '+8801712345678',
        code: '123456',
      });

      expect(result).toEqual({ verified: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://supabase.invalid/auth/v1/admin/users/user-sec-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            phone: '+8801712345678',
            phone_confirm: true,
          }),
        }),
      );
      fetchSpy.mockRestore();
    });

    it('mintAndApproveSession preserves existing GoTrue email for phone user without synthetic email overwrite', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (url: any) => {
          const urlStr = String(url);
          if (urlStr.includes('/admin/generate_link')) {
            return new Response(
              JSON.stringify({ hashed_token: 'valid-hash' }),
              { status: 200 },
            );
          }
          if (urlStr.includes('/auth/v1/verify')) {
            return new Response(
              JSON.stringify({
                access_token: accessToken(),
                refresh_token: 'refresh-1',
                expires_in: 3600,
                token_type: 'bearer',
              }),
              { status: 200 },
            );
          }
          return new Response('{}', { status: 200 });
        });

      const database = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM auth.users WHERE id = $1')) {
            return [
              {
                email: 'real-user@example.com',
                email_confirmed_at: '2026-01-01T00:00:00Z',
              },
            ];
          }
          return [];
        }),
        transaction: vi.fn(async (_id, cb) =>
          cb({
            query: vi.fn().mockResolvedValue([]),
          }),
        ),
      } as unknown as DatabaseService;

      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;

      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        approvals,
      );

      vi.spyOn(service as any, 'meInTransaction').mockResolvedValueOnce({
        user: { id: userId },
        profile_complete: true,
      });

      const session = await (service as any).mintAndApproveSession(
        userId,
        '+8801712345678',
        'phone',
      );

      expect(session.access_token).toBeDefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://supabase.invalid/auth/v1/admin/generate_link',
        expect.objectContaining({
          body: JSON.stringify({
            type: 'magiclink',
            email: 'real-user@example.com',
          }),
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalledWith(
        'http://supabase.invalid/auth/v1/admin/users/' + userId,
        expect.anything(),
      );

      fetchSpy.mockRestore();
    });

    it('validates local.mjs buildBackendLaunchEnv dotenv parsing and TextBee credentials overlay logic', () => {
      const sampleEnv = `
        TEXTBEE_API_KEY="secret-api-key"
        TEXTBEE_DEVICE_ID='device-123'
        TEXTBEE_BASE_URL=https://custom.api.textbee.dev # inline comment
        UNQUOTED_VAL=regular-value
      `;
      const baseConfig = {
        DB_HOST: '127.0.0.1',
        DB_PORT: '5432',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        AUTH_REDIS_URL: 'redis://127.0.0.1:56379',
        MAILPIT_URL: 'http://127.0.0.1:56324',
        TEXTBEE_API_KEY: '',
        TEXTBEE_DEVICE_ID: '',
        TEXTBEE_BASE_URL: 'https://api.textbee.dev/api/v1',
        TEXTBEE_TIMEOUT_MS: '10000',
      };
      const procEnv = {
        TEXTBEE_DEVICE_ID: 'proc-device-override',
      };

      const launchEnv = buildBackendLaunchEnv(
        baseConfig,
        sampleEnv,
        procEnv,
        '/test/local',
      );

      // Verify dotenv parsing stripped quotes and comments
      expect(launchEnv.UNQUOTED_VAL).toBe('regular-value');
      // Verify process.env overrides dotenv and base config for TextBee keys
      expect(launchEnv.TEXTBEE_DEVICE_ID).toBe('proc-device-override');
      expect(launchEnv.TEXTBEE_API_KEY).toBe('secret-api-key');
      expect(launchEnv.TEXTBEE_BASE_URL).toBe('https://custom.api.textbee.dev');
      expect(launchEnv.TEXTBEE_TIMEOUT_MS).toBe('10000');
      // Verify local connection settings are preserved from baseConfig
      expect(launchEnv.DB_HOST).toBe('127.0.0.1');
      expect(launchEnv.AUTH_REDIS_URL).toBe('redis://127.0.0.1:56379');
      expect(launchEnv.MAILPIT_URL).toBe('http://127.0.0.1:56324');
      expect(launchEnv.MENTOR_LOCAL_DIR).toBe('/test/local');
    });

    it('validates local.mjs resolveOAuthProviders and injectOAuthIntoConfigToml for Google and Facebook', () => {
      const rawToml = [
        '[auth.external.google]',
        'enabled = false',
        'client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"',
        'secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"',
        'redirect_uri = "http://127.0.0.1:56321/auth/v1/callback"',
        '',
        '[auth.external.facebook]',
        'enabled = false',
        'client_id = "env(SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID)"',
        'secret = "env(SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET)"',
        'redirect_uri = "http://127.0.0.1:56321/auth/v1/callback"',
      ].join('\n');

      const emptyOAuth = resolveOAuthProviders('', {});
      expect(emptyOAuth.google.enabled).toBe(false);
      expect(emptyOAuth.facebook.enabled).toBe(false);
      expect(injectOAuthIntoConfigToml(rawToml, emptyOAuth)).toContain(
        '[auth.external.google]\nenabled = false',
      );

      const configuredOAuth = resolveOAuthProviders(
        'GOOGLE_CLIENT_ID=g-id\nGOOGLE_CLIENT_SECRET=g-secret\nFACEBOOK_CLIENT_ID=fb-id\nFACEBOOK_CLIENT_SECRET=fb-secret',
        {},
      );
      expect(configuredOAuth.google.enabled).toBe(true);
      expect(configuredOAuth.facebook.enabled).toBe(true);
      expect(configuredOAuth.envVars).toEqual({
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'g-id',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: 'g-secret',
        SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID: 'fb-id',
        SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET: 'fb-secret',
      });

      const enabledToml = injectOAuthIntoConfigToml(rawToml, configuredOAuth);
      expect(enabledToml).toContain('[auth.external.google]\nenabled = true');
      expect(enabledToml).toContain('[auth.external.facebook]\nenabled = true');
    });

    it('ensures procEnv short aliases override backendEnv Supabase-prefixed keys without mixing partial pairs', () => {
      const dotEnvWithPrefixedKeys = [
        'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=dotenv-google-id',
        'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=dotenv-google-secret',
        'SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID=dotenv-fb-id',
        'SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET=dotenv-fb-secret',
      ].join('\n');

      const procEnvWithShortAliases = {
        GOOGLE_CLIENT_ID: 'proc-google-id',
        GOOGLE_CLIENT_SECRET: 'proc-google-secret',
        FACEBOOK_CLIENT_ID: 'proc-fb-id',
        FACEBOOK_CLIENT_SECRET: 'proc-fb-secret',
      };

      const resolved = resolveOAuthProviders(
        dotEnvWithPrefixedKeys,
        procEnvWithShortAliases,
      );

      expect(resolved.google).toEqual({
        enabled: true,
        clientId: 'proc-google-id',
        secret: 'proc-google-secret',
      });
      expect(resolved.facebook).toEqual({
        enabled: true,
        clientId: 'proc-fb-id',
        secret: 'proc-fb-secret',
      });
      expect(resolved.envVars).toEqual({
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: 'proc-google-id',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: 'proc-google-secret',
        SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID: 'proc-fb-id',
        SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET: 'proc-fb-secret',
      });

      const launchEnv = buildBackendLaunchEnv(
        {},
        dotEnvWithPrefixedKeys,
        procEnvWithShortAliases,
        '/test/local',
      );
      expect(launchEnv.GOOGLE_CLIENT_ID).toBe('proc-google-id');
      expect(launchEnv.GOOGLE_CLIENT_SECRET).toBe('proc-google-secret');
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID).toBe(
        'proc-google-id',
      );
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET).toBe(
        'proc-google-secret',
      );
      expect(launchEnv.FACEBOOK_CLIENT_ID).toBe('proc-fb-id');
      expect(launchEnv.FACEBOOK_CLIENT_SECRET).toBe('proc-fb-secret');
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID).toBe(
        'proc-fb-id',
      );
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET).toBe(
        'proc-fb-secret',
      );
    });

    it('rejects partial process-level OAuth override (only ID or only secret) and preserves complete pair from backendEnv', () => {
      const dotEnvWithCompletePairs = [
        'GOOGLE_CLIENT_ID=dotenv-google-id',
        'GOOGLE_CLIENT_SECRET=dotenv-google-secret',
        'FACEBOOK_CLIENT_ID=dotenv-fb-id',
        'FACEBOOK_CLIENT_SECRET=dotenv-fb-secret',
      ].join('\n');

      const procEnvWithPartialOverrides = {
        GOOGLE_CLIENT_ID: 'rogue-partial-google-id',
        FACEBOOK_CLIENT_SECRET: 'rogue-partial-fb-secret',
      };

      const resolved = resolveOAuthProviders(
        dotEnvWithCompletePairs,
        procEnvWithPartialOverrides,
      );

      expect(resolved.google).toEqual({
        enabled: true,
        clientId: 'dotenv-google-id',
        secret: 'dotenv-google-secret',
      });
      expect(resolved.facebook).toEqual({
        enabled: true,
        clientId: 'dotenv-fb-id',
        secret: 'dotenv-fb-secret',
      });

      const launchEnv = buildBackendLaunchEnv(
        {},
        dotEnvWithCompletePairs,
        procEnvWithPartialOverrides,
        '/test/local',
      );
      expect(launchEnv.GOOGLE_CLIENT_ID).toBe('dotenv-google-id');
      expect(launchEnv.GOOGLE_CLIENT_SECRET).toBe('dotenv-google-secret');
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID).toBe(
        'dotenv-google-id',
      );
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET).toBe(
        'dotenv-google-secret',
      );
      expect(launchEnv.FACEBOOK_CLIENT_ID).toBe('dotenv-fb-id');
      expect(launchEnv.FACEBOOK_CLIENT_SECRET).toBe('dotenv-fb-secret');
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID).toBe(
        'dotenv-fb-id',
      );
      expect(launchEnv.SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET).toBe(
        'dotenv-fb-secret',
      );

      // Also verify that if neither backendEnv nor procEnv has a complete pair, partial procEnv keys are stripped
      const launchEnvOnlyPartial = buildBackendLaunchEnv(
        {},
        '',
        procEnvWithPartialOverrides,
        '/test/local',
      );
      expect(launchEnvOnlyPartial.GOOGLE_CLIENT_ID).toBeUndefined();
      expect(launchEnvOnlyPartial.FACEBOOK_CLIENT_SECRET).toBeUndefined();
    });

    it('prevents same-source cross-family alias mixing when a stale Supabase-prefixed key coexists with a complete conventional pair (or vice versa)', () => {
      const dotEnvWithStalePrefixAndCompleteShort = [
        'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=stale-prefixed-google-id',
        'GOOGLE_CLIENT_ID=fresh-short-google-id',
        'GOOGLE_CLIENT_SECRET=fresh-short-google-secret',
        'SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID=complete-prefixed-fb-id',
        'SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET=complete-prefixed-fb-secret',
        'FACEBOOK_CLIENT_ID=stale-short-fb-id',
      ].join('\n');

      const resolved = resolveOAuthProviders(
        dotEnvWithStalePrefixAndCompleteShort,
        {},
      );

      expect(resolved.google).toEqual({
        enabled: true,
        clientId: 'fresh-short-google-id',
        secret: 'fresh-short-google-secret',
      });
      expect(resolved.facebook).toEqual({
        enabled: true,
        clientId: 'complete-prefixed-fb-id',
        secret: 'complete-prefixed-fb-secret',
      });

      // Also verify that mismatched cross-family halves alone (prefixed ID + short secret) do not form a valid pair
      const mismatchedCrossFamilyOnly = resolveOAuthProviders(
        [
          'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=only-prefixed-id',
          'GOOGLE_CLIENT_SECRET=only-short-secret',
        ].join('\n'),
        {},
      );
      expect(mismatchedCrossFamilyOnly.google).toEqual({
        enabled: false,
        clientId: '',
        secret: '',
      });
    });

    it('gracefully disables providers and outputs valid empty strings when credentials are null, undefined, or literal undefined/null strings', () => {
      const corruptEnv = {
        GOOGLE_CLIENT_ID: 'undefined',
        GOOGLE_CLIENT_SECRET: 'null',
        FACEBOOK_CLIENT_ID: null as unknown as string,
        FACEBOOK_CLIENT_SECRET: undefined as unknown as string,
      };

      const resolved = resolveOAuthProviders('', corruptEnv);
      expect(resolved.google).toEqual({
        enabled: false,
        clientId: '',
        secret: '',
      });
      expect(resolved.facebook).toEqual({
        enabled: false,
        clientId: '',
        secret: '',
      });
      expect(resolved.envVars).toEqual({
        SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: '',
        SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: '',
        SUPABASE_AUTH_EXTERNAL_FACEBOOK_CLIENT_ID: '',
        SUPABASE_AUTH_EXTERNAL_FACEBOOK_SECRET: '',
      });

      // injectOAuthIntoConfigToml handles corrupt or empty input safely
      expect(injectOAuthIntoConfigToml('', resolved)).toBe('');
      const rawToml = [
        '[auth.external.google]',
        'enabled = true',
        '[auth.external.facebook]',
        'enabled = true',
      ].join('\n');
      const disabledToml = injectOAuthIntoConfigToml(rawToml, resolved);
      expect(disabledToml).toContain('[auth.external.google]\nenabled = false');
      expect(disabledToml).toContain(
        '[auth.external.facebook]\nenabled = false',
      );
    });
  });

  describe('Phone password login when GoTrue phone provider is disabled', () => {
    const phone = '+8801712345678';
    const synthEmail = `phone-${userId}@synthetic.mentor`;
    const mkReq = () =>
      ({
        socket: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1',
        ips: [],
        headers: {},
        app: { get: vi.fn() },
      }) as unknown as Request;

    const mkAbuse = () =>
      ({
        login: vi.fn(async (_contact, _ip, authenticate) => {
          const outcome = await authenticate();
          if (!outcome.success) {
            fail(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
          }
          return outcome.value;
        }),
      }) as unknown as AuthAbuseControl;

    const stubPhoneDisabledAndMintFetch = (
      expectedEmail: string,
      token: string,
    ) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({
            code: 422,
            error_code: 'phone_provider_disabled',
            msg: 'Phone logins are disabled',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            hashed_token: 'phone-login-hash',
            verification_type: 'magiclink',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: token,
            refresh_token: 'phone-login-refresh',
            expires_in: 3600,
            token_type: 'bearer',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: userId }),
        });
      vi.stubGlobal('fetch', fetchMock);
      return {
        fetchMock,
        assertMintedForEmail: () => {
          expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/auth/v1/admin/generate_link'),
            expect.objectContaining({
              body: JSON.stringify({ type: 'magiclink', email: expectedEmail }),
            }),
          );
        },
      };
    };

    const mkDbForPhoneLogin = (opts: {
      authRow: Record<string, unknown>;
      updateRowCount?: number;
      recheckPasswordHash?: string | null;
    }) => {
      const initialHash = String(
        opts.authRow.encrypted_password ?? '$2a$10$initialhash',
      );
      const executedSql: Array<{ sql: string; params?: unknown[] }> = [];
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        executedSql.push({ sql, params });
        if (sql.includes('FROM auth.users u') && sql.includes('LIMIT 1')) {
          return [{ id: userId }];
        }
        if (
          sql.includes('FROM auth.users u') &&
          sql.includes('FOR UPDATE') &&
          sql.includes('u.email,')
        ) {
          return [{ encrypted_password: initialHash, ...opts.authRow }];
        }
        if (
          sql.includes('SELECT encrypted_password') &&
          sql.includes('FROM auth.users') &&
          sql.includes('FOR UPDATE')
        ) {
          const hash =
            opts.recheckPasswordHash === undefined
              ? initialHash
              : opts.recheckPasswordHash;
          return hash ? [{ encrypted_password: hash }] : [];
        }
        if (sql.includes('UPDATE auth.users')) {
          const count = opts.updateRowCount ?? 1;
          return [count === 1 ? [{ email: synthEmail }] : [], count];
        }
        if (sql.includes('SELECT u.verified_contact,p.verified_at')) {
          return [
            {
              verified_contact: true,
              verified_at: '2026-01-01T00:00:00Z',
              contact_value: phone,
            },
          ];
        }
        if (sql.includes('SELECT u.id,u.email')) {
          return [
            {
              id: userId,
              email: null,
              phone,
              status: 'active',
              verified_contact: true,
              role: 'USER',
              linked_providers: ['phone'],
            },
          ];
        }
        if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
        if (sql.includes('effective_feature_access'))
          return [{ enabled: false }];
        return [];
      });
      const database = {
        query,
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;
      return { database, query, executedSql };
    };

    it('returns 401 INVALID_CREDENTIALS when phone user does not exist', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({
            code: 422,
            error_code: 'phone_provider_disabled',
            msg: 'Phone logins are disabled',
          }),
        }),
      );
      const database = {
        query: vi.fn().mockResolvedValue([]),
        transaction: vi.fn(),
      } as unknown as DatabaseService;
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        {} as SessionApprovalService,
      );

      await expect(
        service.login(
          { identifier: '01712345678', password: 'WrongPassword1!' },
          mkReq(),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS' },
      });
      expect(database.transaction).not.toHaveBeenCalled();
    });

    it('returns 401 INVALID_CREDENTIALS when password does not match or hash is non-bcrypt', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({
            code: 422,
            error_code: 'phone_provider_disabled',
            msg: 'Phone logins are disabled',
          }),
        }),
      );
      const { database, executedSql } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          email: null,
          email_confirmed_at: null,
          password_matches: false,
        },
      });
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        {} as SessionApprovalService,
      );

      await expect(
        service.login(
          { identifier: phone, password: 'WrongPassword1!' },
          mkReq(),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS' },
      });
      expect(
        executedSql.some((q) =>
          q.sql.includes("u.encrypted_password LIKE '$2%'"),
        ),
      ).toBe(true);
      expect(executedSql.some((q) => q.sql.includes('pg_advisory_lock('))).toBe(
        false,
      );
    });

    it('returns 403 UNVERIFIED_ACCOUNT when phone is not confirmed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({
            code: 422,
            error_code: 'phone_provider_disabled',
            msg: 'Phone logins are disabled',
          }),
        }),
      );
      const { database } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: null,
          email: null,
          email_confirmed_at: null,
          password_matches: true,
        },
      });
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        {} as SessionApprovalService,
      );

      await expect(
        service.login(
          { identifier: '01712345678', password: 'ValidPassword1!' },
          mkReq(),
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'UNVERIFIED_ACCOUNT' },
      });
    });

    it('sets idempotent internal auth email without finally deletion for verified phone-only user', async () => {
      const token = accessToken();
      const { assertMintedForEmail } = stubPhoneDisabledAndMintFetch(
        synthEmail,
        token,
      );
      const { database, executedSql } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          email: null,
          email_confirmed_at: null,
          password_matches: true,
        },
      });
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        approvals,
      );

      const res = await service.login(
        { identifier: '01712345678', password: 'ValidPassword1!' },
        mkReq(),
      );

      expect(res).toMatchObject({
        access_token: token,
        token_type: 'Bearer',
        next_step: 'profile_setup',
        user: { id: userId, email: null, phone },
      });
      assertMintedForEmail();
      expect(
        executedSql.some(
          (q) =>
            q.sql.includes('UPDATE auth.users') &&
            q.sql.includes('COALESCE(email_confirmed_at, NOW())') &&
            q.sql.includes("NULLIF(BTRIM(email), '') IS NULL") &&
            q.sql.includes("LOWER(BTRIM(email)) LIKE '%@synthetic.mentor'"),
        ),
      ).toBe(true);
      expect(executedSql.some((q) => q.sql.includes('SET email = NULL'))).toBe(
        false,
      );
      expect(executedSql.some((q) => q.sql.includes('pg_advisory_lock('))).toBe(
        false,
      );
      expect(
        executedSql.some((q) => q.sql.includes('SET LOCAL ROLE service_role')),
      ).toBe(false);
      expect(database.transaction).toHaveBeenLastCalledWith(
        userId,
        expect.any(Function),
        false,
        true,
        false,
      );
      expect(
        executedSql.some(
          (q) =>
            q.sql.includes('SELECT encrypted_password') &&
            q.sql.includes('FOR UPDATE'),
        ),
      ).toBe(true);
      expect(approvals.approve).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        userId,
        sessionId,
        'password_login',
      );
    });

    it('mints directly with confirmed real email without mutating auth.users', async () => {
      const token = accessToken();
      const confirmedEmail = 'verified.user@example.com';
      const { assertMintedForEmail } = stubPhoneDisabledAndMintFetch(
        confirmedEmail,
        token,
      );
      const { database, executedSql } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          email: confirmedEmail,
          email_confirmed_at: '2026-01-02T00:00:00Z',
          password_matches: true,
        },
      });
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        approvals,
      );

      const res = await service.login(
        { identifier: phone, password: 'ValidPassword1!' },
        mkReq(),
      );

      expect(res.access_token).toBe(token);
      assertMintedForEmail();
      expect(executedSql.some((q) => q.sql.includes('UPDATE auth.users'))).toBe(
        false,
      );
    });

    it('moves unconfirmed real email to email_change without temporary swap or restore', async () => {
      const token = accessToken();
      const { assertMintedForEmail } = stubPhoneDisabledAndMintFetch(
        synthEmail,
        token,
      );
      const { database, executedSql } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          email: 'pending@example.com',
          email_confirmed_at: null,
          password_matches: true,
        },
      });
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        approvals,
      );

      const res = await service.login(
        { identifier: phone, password: 'ValidPassword1!' },
        mkReq(),
      );

      expect(res.access_token).toBe(token);
      assertMintedForEmail();
      expect(
        executedSql.some(
          (q) =>
            q.sql.includes('SET email_change = COALESCE(NULLIF(email_change') &&
            q.sql.includes('email = $2'),
        ),
      ).toBe(true);
      expect(executedSql.some((q) => q.sql.includes('SET email = NULL'))).toBe(
        false,
      );
    });

    it('fails closed with 503 when synthetic email UPDATE affects zero rows', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({
            code: 422,
            error_code: 'phone_provider_disabled',
            msg: 'Phone logins are disabled',
          }),
        }),
      );
      const { database, executedSql } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          email: null,
          email_confirmed_at: null,
          password_matches: true,
        },
        updateRowCount: 0,
      });
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        approvals,
      );

      await expect(
        service.login(
          { identifier: phone, password: 'ValidPassword1!' },
          mkReq(),
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });
      expect(
        executedSql.some(
          (q) =>
            q.sql.includes("NULLIF(BTRIM(email), '') IS NULL") &&
            q.sql.includes("LOWER(BTRIM(email)) LIKE '%@synthetic.mentor'"),
        ),
      ).toBe(true);
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('revokes newly minted GoTrue session and fails with 401 when encrypted_password changes before approval', async () => {
      const token = accessToken();
      stubPhoneDisabledAndMintFetch(synthEmail, token);
      const { database, executedSql } = mkDbForPhoneLogin({
        authRow: {
          id: userId,
          phone_confirmed_at: '2026-01-01T00:00:00Z',
          email: synthEmail,
          email_confirmed_at: '2026-01-01T00:00:00Z',
          encrypted_password: '$2a$10$oldhash',
          password_matches: true,
        },
        recheckPasswordHash: '$2a$10$resetnewhash',
      });
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        mkAbuse(),
        approvals,
      );

      await expect(
        service.login(
          { identifier: phone, password: 'ValidPassword1!' },
          mkReq(),
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_CREDENTIALS' },
      });
      expect(
        executedSql.some(
          (q) =>
            q.sql.includes('DELETE FROM auth.sessions WHERE id = $1') &&
            q.params?.[0] === sessionId,
        ),
      ).toBe(true);
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('mintAndApproveSession preserves deterministic synthetic email for phone-only user after verifyPhone', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (url: unknown) => {
          const urlStr = String(url);
          if (urlStr.includes('/admin/generate_link')) {
            return new Response(
              JSON.stringify({
                user: { id: userId },
                hashed_token: 'valid-hash',
              }),
              { status: 200 },
            );
          }
          if (urlStr.includes('/auth/v1/verify')) {
            return new Response(
              JSON.stringify({
                access_token: accessToken(),
                refresh_token: 'refresh-1',
                expires_in: 3600,
                token_type: 'bearer',
              }),
              { status: 200 },
            );
          }
          return new Response('{}', { status: 200 });
        });
      const executedSql: Array<{ sql: string; params?: unknown[] }> = [];
      const database = {
        query: vi
          .fn()
          .mockImplementation(async (sql: string, params?: unknown[]) => {
            executedSql.push({ sql, params });
            if (sql.includes('FROM auth.users WHERE id = $1')) {
              return [{ email: synthEmail }];
            }
            return [];
          }),
        transaction: vi.fn(async (_id, cb) =>
          cb({
            query: vi
              .fn()
              .mockImplementation(async (sql: string, params?: unknown[]) => {
                executedSql.push({ sql, params });
                return [];
              }),
          }),
        ),
      } as unknown as DatabaseService;
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        approvals,
      );
      vi.spyOn(service as any, 'meInTransaction').mockResolvedValueOnce({
        user: { id: userId, email: null, phone },
        profile_complete: true,
      });

      const session = await (service as any).mintAndApproveSession(
        userId,
        phone,
        'phone',
      );

      expect(session.access_token).toBeDefined();
      expect(executedSql.some((q) => q.sql.includes('SET email = NULL'))).toBe(
        false,
      );
      expect(
        executedSql.some((q) => q.sql.includes('DELETE FROM auth.identities')),
      ).toBe(false);
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        sessionId,
        'email_verification',
      );
      fetchSpy.mockRestore();
    });

    it('treats @synthetic.mentor email as absent during password bootstrap and selects phone provider', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            email: synthEmail,
            email_confirmed_at: '2026-01-01T00:00:00Z',
            phone,
            phone_confirmed_at: '2026-01-01T00:00:00Z',
            identities: [{ provider: 'phone', id: userId }],
          }),
        }),
      );
      const executed: Array<{ sql: string; params?: unknown[] }> = [];
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        executed.push({ sql, params });
        if (sql.includes('SELECT u.verified_contact, p.verified_at')) {
          expect(params?.[1]).toBe('phone');
          expect(params?.[2]).toBe(phone);
          return [
            { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
          ];
        }
        if (sql.includes('SELECT u.id,u.email'))
          return [
            {
              id: userId,
              email: null,
              phone,
              status: 'active',
              verified_contact: true,
              role: 'USER',
              linked_providers: ['phone'],
            },
          ];
        if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        approvals,
      );

      const token = accessToken([{ method: 'password' }], {
        email: synthEmail,
        phone,
        app_metadata: { provider: 'email' },
      });
      const result = await service.bootstrap(
        { sub: userId, sessionId, authProvider: 'phone' },
        `Bearer ${token}`,
      );

      expect(result.user.phone).toBe(phone);
      expect(result.user.email).toBeNull();
      expect(
        executed.some((q) =>
          (q.params ?? []).some(
            (p) => typeof p === 'string' && p.includes('@synthetic.mentor'),
          ),
        ),
      ).toBe(false);
      expect(
        executed.some(
          (q) =>
            q.sql.includes('SELECT u.verified_contact, p.verified_at') &&
            q.params?.[1] === 'phone' &&
            q.params?.[2] === phone,
        ),
      ).toBe(true);
      expect(approvals.approve).not.toHaveBeenCalled();
    });

    it('allows provider-omitted and explicit OAuth bootstrap with @synthetic.mentor via provider_subject', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            id: userId,
            email: synthEmail,
            email_confirmed_at: '2026-01-01T00:00:00Z',
            phone,
            phone_confirmed_at: '2026-01-01T00:00:00Z',
            identities: [
              { provider: 'phone', id: userId },
              {
                provider: 'google',
                id: 'google-identity-1',
                identity_data: { sub: 'google-sub-123' },
              },
            ],
          }),
        }),
      );
      const executed: Array<{ sql: string; params?: unknown[] }> = [];
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        executed.push({ sql, params });
        if (sql.includes('SELECT u.verified_contact, p.verified_at'))
          return [
            { verified_contact: true, verified_at: '2026-01-01T00:00:00Z' },
          ];
        if (sql.startsWith('SELECT verified_contact'))
          return [{ verified_contact: true }];
        if (sql.includes('SELECT u.id,u.email'))
          return [
            {
              id: userId,
              email: null,
              phone,
              status: 'active',
              verified_contact: true,
              role: 'USER',
              linked_providers: ['phone', 'google'],
            },
          ];
        if (sql.includes('SELECT p.*,pr.learning_preference')) return [];
        if (sql.includes('effective_feature_access'))
          return [{ enabled: true }];
        return [];
      });
      const database = {
        transaction: vi.fn((_id, operation) =>
          operation({ query } as unknown as EntityManager),
        ),
      } as unknown as DatabaseService;
      const approvals = {
        approve: vi.fn().mockResolvedValue(undefined),
      } as unknown as SessionApprovalService;
      const service = new AuthService(
        database,
        configuration(),
        {} as AuthAbuseControl,
        approvals,
      );

      const oauthToken = accessToken(
        [{ method: 'oauth', provider: 'google' }],
        {
          email: synthEmail,
          app_metadata: { provider: 'google', providers: ['phone', 'google'] },
        },
      );
      const syncResult = await service.bootstrap(
        { sub: userId, sessionId, authProvider: 'google' },
        `Bearer ${oauthToken}`,
      );
      expect(syncResult.user.email).toBeNull();
      expect(
        executed.some(
          (q) =>
            q.sql.includes('p.provider_subject = $3') &&
            q.params?.[1] === 'google' &&
            q.params?.[2] === 'google-sub-123',
        ),
      ).toBe(true);

      const explicitResult = await service.bootstrap(
        { sub: userId, sessionId, authProvider: 'google' },
        `Bearer ${oauthToken}`,
        'google',
      );
      expect(explicitResult.user.email).toBeNull();
      expect(
        executed.some((q) =>
          (q.params ?? []).some(
            (p) => typeof p === 'string' && p.includes('@synthetic.mentor'),
          ),
        ),
      ).toBe(false);
    });
  });
});
