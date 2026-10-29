import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import type { DatabaseService } from './database.service.js';
import type { SessionApprovalService } from './session-approval.service.js';
import { AuthService } from './auth.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function accessToken(
  amr?: Array<{ method: string; provider?: string }>,
): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
    sub: userId,
    session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    amr: amr ?? [{ method: 'oauth', provider: 'google' }],
  })}.synthetic-signature`;
}

function configuration(): ConfigService {
  return {
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
    expect(database.transaction).toHaveBeenCalledWith(
      userId,
      expect.any(Function),
      false,
      false,
    );
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
