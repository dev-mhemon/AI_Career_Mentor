import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttp } from '../../common/http.js';
import { AuthController } from '../controllers/auth.controller.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { DatabaseService } from './database.service.js';
import { SessionApprovalService } from './session-approval.service.js';
import { AuthService } from './auth.service.js';
import { EmailRegistrationProvider } from './email-registration.provider.js';
import { EmailRegistrationService } from './email-registration.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function accessToken(
  amr?: Array<{ method: string; provider?: string }>,
  claims: { phone?: string } = {},
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

function configuration(): ConfigService {
  return {
    get: vi.fn((name: string) =>
      name === 'AUTH_PASSWORD_MIN_LENGTH' ? 8 : undefined,
    ),
    getOrThrow: vi.fn((name: string) =>
      name === 'SUPABASE_URL' ? 'http://supabase.invalid' : 'public-anon-key',
    ),
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
        json: async () => ({ id: userId }),
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
});
