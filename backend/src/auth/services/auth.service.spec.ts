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
// @ts-expect-error - script utility import outside tsconfig rootDir
import { buildBackendLaunchEnv } from '../../../../scripts/foundation/local.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function accessToken(
  amr?: Array<{ method: string; provider?: string }>,
  claims: { phone?: string; app_metadata?: { provider?: string } } = {},
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
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ verified_contact: true }])
      .mockResolvedValueOnce([{ '?column?': 1 }]);
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
      status: 403,
      response: { code: 'PROVIDER_MISMATCH' },
    });
    expect(approvals.approve).not.toHaveBeenCalled();

    const missingProviderToken = accessToken([{ method: 'oauth' }]);
    await expect(
      service.bootstrap(
        { sub: userId, sessionId },
        `Bearer ${missingProviderToken}`,
        'google',
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'PROVIDER_MISMATCH' },
    });

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
      status: 403,
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
      userId,
      expect.any(Function),
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
      expect(query).not.toHaveBeenCalled();
      expect(approvals.approve).not.toHaveBeenCalled();
    },
  );

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
            query: vi.fn().mockImplementation(async (sql: string) => {
              if (sql.includes('p.contact_value')) {
                // Pending mapping was replaced concurrently by another phone B
                return [];
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

      await expect(
        service.verifyPhone({ phone: '+8801712345678', code: '123456' }),
      ).rejects.toThrow(HttpException);
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
  });
});
