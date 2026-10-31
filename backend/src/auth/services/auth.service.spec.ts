import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { type INestApplication } from '@nestjs/common';
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
        true,
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
    });

    it('fails with non-retryable 502 PROVIDER_ERROR if GoTrue session revocation fails after transaction commits and OTP is consumed', async () => {
      const mockDbRunner = {
        query: vi.fn(async (sql: string) => {
          if (sql.startsWith('SET LOCAL statement_timeout')) {
            return [];
          }
          expect(transactionCommitted).toBe(true);
          expect(otpConsumed).toBe(true);
          throw new Error('DB session delete failed');
        }),
      };
      let transactionCommitted = false;
      let otpConsumed = false;
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

    it('cancels blocked cleanup query via transaction-scoped SET LOCAL statement_timeout (57014) and fails with non-retryable 504 PROVIDER_TIMEOUT', async () => {
      let transactionCommitted = false;
      let otpConsumed = false;
      const mockDbRunner = {
        query: vi.fn(async (sql: string) => {
          if (sql.startsWith('SET LOCAL statement_timeout')) {
            return [];
          }
          expect(transactionCommitted).toBe(true);
          expect(otpConsumed).toBe(true);
          const pgTimeoutError = Object.assign(
            new Error('canceling statement due to statement timeout'),
            { code: '57014' },
          );
          throw pgTimeoutError;
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

      expect(transactionCommitted).toBe(true);
      expect(otpConsumed).toBe(true);
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 25',
      );
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledTimes(1);
    });

    it('bounds hanging cleanup query in revokeGoTrueUserSessions with per-operation timeout and fails with non-retryable 504 PROVIDER_TIMEOUT', async () => {
      let transactionCommitted = false;
      let otpConsumed = false;
      const mockDbRunner = {
        query: vi.fn((sql: string) => {
          if (sql.startsWith('SET LOCAL statement_timeout')) {
            return Promise.resolve([]);
          }
          expect(transactionCommitted).toBe(true);
          expect(otpConsumed).toBe(true);
          return new Promise(() => {
            // Hanging query that never settles
          });
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
        configuration({ GOTRUE_TIMEOUT_MS: 15 }),
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

      expect(transactionCommitted).toBe(true);
      expect(otpConsumed).toBe(true);
      expect(mockDbRunner.query).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 15',
      );
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledTimes(1);
      expect(mockApprovals.revokeAllUserSessions).toHaveBeenCalledWith(
        userId,
        mockDbRunner,
      );
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
});
