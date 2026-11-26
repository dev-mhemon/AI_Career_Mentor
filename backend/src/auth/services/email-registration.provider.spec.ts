import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import nodemailer from 'nodemailer';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { readAbuseConfiguration } from '../abuse-control/config.js';
import {
  EmailRegistrationProvider,
  createEmailTransportFromConfig,
} from './email-registration.provider.js';
import { EmailRegistrationService } from './email-registration.service.js';
import type { DatabaseService } from './database.service.js';
import type { OtpSecretStore } from './otp-secret-store.service.js';

const mockSendMail = vi.fn();
const mockCloseTransport = vi.fn();
const mockCreateTransport = vi.fn(() => ({
  sendMail: mockSendMail,
  close: mockCloseTransport,
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: unknown[]) =>
      (mockCreateTransport as (...a: unknown[]) => unknown)(...args),
  },
}));

describe('EmailRegistrationProvider (Option 2B GoTrue Admin + S1 OTP)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'candidate@example.invalid';

  let config: ConfigService;
  let database: {
    query: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let otpStore: {
    generateOtp: ReturnType<typeof vi.fn>;
    storeOtp: ReturnType<typeof vi.fn>;
  };
  let provider: EmailRegistrationProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'synthetic-msg-id' });
    config = {
      get: vi.fn((key: string) => {
        if (key === 'AUTH_OTP_HMAC_SECRET')
          return 'secret-at-least-32-bytes-long-for-hmac!';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
        if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
        return undefined;
      }),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'http://supabase.invalid';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
        throw new Error(`Missing ${key}`);
      }),
    } as unknown as ConfigService;

    const queryFn = vi.fn();
    database = {
      query: queryFn,
      transaction: vi.fn(
        async (
          _userId: string | null,
          op: (db: { query: typeof queryFn }) => Promise<unknown>,
        ) => op({ query: queryFn }),
      ),
    };

    otpStore = {
      generateOtp: vi.fn().mockReturnValue('123456'),
      storeOtp: vi.fn().mockResolvedValue({ expiresInSeconds: 580 }),
    };

    provider = new EmailRegistrationProvider(
      config,
      database as unknown as DatabaseService,
      otpStore as unknown as OtpSecretStore,
    );
    provider.setTransport(vi.fn().mockResolvedValue(undefined));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('ready', () => {
    it('returns without error when all required configuration, otpStore, and transport are present', () => {
      expect(() => provider.ready()).not.toThrow();
    });

    it('throws 503 SERVICE_UNAVAILABLE when transport is not configured', () => {
      const noTransportProvider = new EmailRegistrationProvider(
        config,
        database as unknown as DatabaseService,
        otpStore as unknown as OtpSecretStore,
      );
      expect(() => noTransportProvider.ready()).toThrow(
        expect.objectContaining({ status: 503 }),
      );
    });

    it('throws 503 SERVICE_UNAVAILABLE when otpStore is missing', () => {
      const noOtpProvider = new EmailRegistrationProvider(
        config,
        database as unknown as DatabaseService,
        undefined,
      );
      noOtpProvider.setTransport(vi.fn().mockResolvedValue(undefined));
      expect(() => noOtpProvider.ready()).toThrow(
        expect.objectContaining({ status: 503 }),
      );
    });

    it('throws 503 SERVICE_UNAVAILABLE when AUTH_OTP_HMAC_SECRET is missing', () => {
      vi.mocked(config.get).mockImplementation((key: string) => {
        if (key === 'AUTH_OTP_HMAC_SECRET') return undefined;
        return 'configured';
      });

      expect(() => provider.ready()).toThrow(
        expect.objectContaining({ status: 503 }),
      );
    });

    it('logs only missing prerequisite names without exposing secrets when ready() fails closed', () => {
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const noTransportProvider = new EmailRegistrationProvider(
          config,
          database as unknown as DatabaseService,
          otpStore as unknown as OtpSecretStore,
        );
        expect(() => noTransportProvider.ready()).toThrow(
          expect.objectContaining({ status: 503 }),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          'Email registration prerequisites unavailable (missing=[emailTransport])',
        );
        const logged = warnSpy.mock.calls.map((c) => String(c[0])).join(' ');
        expect(logged).not.toContain('secret-at-least-32-bytes-long-for-hmac!');
        expect(logged).not.toContain('service-role-key');
        expect(logged).not.toContain('redis://localhost:6379');

        warnSpy.mockClear();
        vi.mocked(config.get).mockImplementation((key: string) => {
          if (key === 'AUTH_OTP_HMAC_SECRET') return undefined;
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return undefined;
          if (key === 'SERVICE_ROLE_KEY') return undefined;
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        });
        expect(() => provider.ready()).toThrow(
          expect.objectContaining({ status: 503 }),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          'Email registration prerequisites unavailable (missing=[AUTH_OTP_HMAC_SECRET,SUPABASE_SERVICE_ROLE_KEY])',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('findByEmail & Failure Boundary 2 recovery', () => {
    it('returns null when identity does not exist in database', async () => {
      database.query.mockResolvedValue([]);
      const result = await provider.findByEmail(email);
      expect(result).toBeNull();
    });

    it('returns verified = false when GoTrue email_confirmed_at is set but public.users.verified_contact is false (Failure Boundary 2)', async () => {
      database.query.mockResolvedValue([
        {
          id: userId,
          email,
          email_confirmed_at: '2026-01-01T00:00:00Z',
          verified_contact: false,
        },
      ]);

      const result = await provider.findByEmail(email);
      expect(result).toEqual({
        id: userId,
        subject: userId,
        email,
        verified: false,
      });
    });

    it('returns verified = true only when public.users.verified_contact is true', async () => {
      database.query.mockResolvedValue([
        {
          id: userId,
          email,
          email_confirmed_at: '2026-01-01T00:00:00Z',
          verified_contact: true,
        },
      ]);

      const result = await provider.findByEmail(email);
      expect(result).toEqual({
        id: userId,
        subject: userId,
        email,
        verified: true,
      });
    });

    it('returns verified = true when provider_verified_at is set even if public.users.verified_contact is false', async () => {
      database.query.mockResolvedValue([
        {
          id: userId,
          email,
          email_confirmed_at: null,
          verified_contact: false,
          provider_verified_at: '2026-01-01T00:00:00Z',
        },
      ]);

      const result = await provider.findByEmail(email);
      expect(result).toEqual({
        id: userId,
        subject: userId,
        email,
        verified: true,
      });
    });

    it('locates pending secondary email from public.user_auth_providers for an unverified OAuth user (EP-A12 -> EP-A04)', async () => {
      database.query.mockResolvedValue([
        {
          id: userId,
          email: 'Secondary@Example.invalid',
          email_confirmed_at: null,
          verified_contact: false,
        },
      ]);

      const result = await provider.findByEmail('Secondary@Example.invalid');
      expect(database.query).toHaveBeenCalledWith(expect.any(String), [
        'secondary@example.invalid',
      ]);
      const executedSql = database.query.mock.calls[0][0] as string;
      const normalizedSql = executedSql.replace(/\s+/g, ' ');
      expect(normalizedSql).toContain('LEFT JOIN public.user_auth_providers p');
      expect(normalizedSql).toContain(
        'WHERE u.deleted_at IS NULL AND (lower(u.email) = $1 OR lower(p.contact_value) = $1)',
      );
      expect(normalizedSql).toContain(
        "NOT (pu.id IS NULL AND COALESCE(u.created_at, NOW()) < NOW() - INTERVAL '15 minutes') OR ( u.email_confirmed_at IS NOT NULL AND (",
      );
      expect(normalizedSql).toContain("IN ('google', 'facebook')");
      expect(normalizedSql).toContain('ORDER BY');
      expect(normalizedSql).toContain(
        'COALESCE(lower(p.contact_value) = $1, false) DESC',
      );
      expect(normalizedSql).toContain(
        'COALESCE(COALESCE(lower(p.contact_value), lower(u.email)) = $1, false) DESC',
      );
      expect(normalizedSql).toContain(
        'COALESCE(pu.verified_contact = true OR p.verified_at IS NOT NULL, false) DESC',
      );
      expect(normalizedSql).toContain(
        'COALESCE(pu.id IS NOT NULL, false) DESC',
      );
      expect(normalizedSql).toContain('u.created_at DESC');
      expect(result).toEqual({
        id: userId,
        subject: userId,
        email: 'secondary@example.invalid',
        verified: false,
      });
    });

    it('ignores soft-deleted rows and confirmed orphaned auth users with no public.users row', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: '2026-10-01T00:00:00Z',
          verified_contact: false,
          has_app_user: false,
          is_deleted: false,
        },
      ]);

      await expect(provider.findByEmail(email)).resolves.toBeNull();
    });

    it('excludes unconfirmed 15m+ orphaned auth users with no public.users row while keeping recent (<15m) registrations blocked', async () => {
      const oldCreatedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: null,
          created_at: oldCreatedAt,
          verified_contact: false,
          has_app_user: false,
          is_deleted: false,
        },
      ]);
      await expect(provider.findByEmail(email)).resolves.toBeNull();

      const recentCreatedAt = new Date(
        Date.now() - 2 * 60 * 1000,
      ).toISOString();
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: null,
          created_at: recentCreatedAt,
          verified_contact: false,
          has_app_user: false,
          is_deleted: false,
        },
      ]);
      await expect(provider.findByEmail(email)).resolves.toEqual({
        id: userId,
        subject: userId,
        email,
        verified: false,
      });

      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: null,
          created_at: null,
          verified_contact: false,
          has_app_user: false,
          is_deleted: false,
        },
      ]);
      await expect(provider.findByEmail(email)).resolves.toEqual({
        id: userId,
        subject: userId,
        email,
        verified: false,
      });
    });

    it('returns the coalesced provider contact_value when u.email matched lookup but p.contact_value is different', async () => {
      database.query.mockResolvedValue([
        {
          id: userId,
          email: 'staged-different@example.invalid',
          email_confirmed_at: null,
          verified_contact: false,
          provider_verified_at: null,
        },
      ]);

      const result = await provider.findByEmail('old-original@example.invalid');
      expect(result).toEqual({
        id: userId,
        subject: userId,
        email: 'staged-different@example.invalid',
        verified: false,
      });
    });

    it('excludes old unconfirmed OAuth-metadata rows without public.users and never flips verified when has_app_user is true and verified_contact is false', async () => {
      const oldCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: null,
          created_at: oldCreatedAt,
          verified_contact: false,
          has_app_user: false,
          is_deleted: false,
          raw_app_meta_data: { provider: 'email' },
          identities: [{ provider: 'google' }],
        },
      ]);
      await expect(provider.findByEmail(email)).resolves.toBeNull();

      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: '2026-10-01T00:00:00Z',
          created_at: oldCreatedAt,
          verified_contact: false,
          has_app_user: false,
          is_deleted: false,
          raw_app_meta_data: {
            provider: 'email',
            providers: ['email', 'google'],
          },
        },
      ]);
      await expect(provider.findByEmail(email)).resolves.toEqual({
        id: userId,
        subject: userId,
        email,
        verified: true,
      });

      database.query.mockResolvedValueOnce([
        {
          id: userId,
          email,
          email_confirmed_at: '2026-10-01T00:00:00Z',
          created_at: oldCreatedAt,
          verified_contact: false,
          provider_verified_at: null,
          has_app_user: true,
          is_deleted: false,
          is_oauth_user: true,
        },
      ]);
      await expect(provider.findByEmail(email)).resolves.toEqual({
        id: userId,
        subject: userId,
        email,
        verified: false,
      });
    });
  });

  describe('createPending', () => {
    it('calls GoTrue Admin createUser with email_confirm: false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ id: userId, email }),
        }),
      );

      const identity = await provider.createPending(email, 'Password123!');
      expect(identity).toEqual({
        id: userId,
        subject: userId,
        email,
        verified: false,
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://supabase.invalid/auth/v1/admin/users',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            apikey: 'service-role-key',
            Authorization: 'Bearer service-role-key',
          }),
          body: JSON.stringify({
            email,
            password: 'Password123!',
            email_confirm: false,
          }),
        }),
      );
    });

    it('maps 422 email_exists to 409 CONTACT_ALREADY_REGISTERED', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({
            msg: 'A user with this email address has already been registered',
          }),
        }),
      );

      await expect(
        provider.createPending(email, 'Password123!'),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'CONTACT_ALREADY_REGISTERED' },
      });
    });

    it('self-heals orphaned/deleted email account on 422 email_exists and retries fresh creation cleanly', async () => {
      const staleId = '99999999-9999-4999-8999-999999999999';
      database.query.mockImplementation(async (sql: string) => {
        if (
          sql.includes('FROM auth.users u') &&
          (sql.includes('WHERE u.id = $1::uuid') ||
            sql.includes('SELECT DISTINCT u.id'))
        ) {
          return [{ id: staleId, email }];
        }
        return [];
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({
            error_code: 'email_exists',
            msg: 'A user with this email address has already been registered',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: userId, email }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const created = await provider.createPending(email, 'Password123!');

      expect(created).toEqual({
        id: userId,
        subject: userId,
        email,
        verified: false,
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `http://supabase.invalid/auth/v1/admin/users/${staleId}`,
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ should_soft_delete: false }),
        }),
      );
      expect(database.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [staleId],
      );
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM public.users WHERE id = $1::uuid'),
        [staleId],
      );
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM auth.users'),
        [staleId],
      );
    });

    it('maps upstream errors to 502 EMAIL_PROVIDER_ERROR', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          json: async () => ({ msg: 'Internal server error' }),
        }),
      );

      await expect(
        provider.createPending(email, 'Password123!'),
      ).rejects.toMatchObject({
        status: 502,
        response: { code: 'EMAIL_PROVIDER_ERROR' },
      });
    });

    it('maps upstream 429 to 429 OTP_LIMIT_EXCEEDED with Retry-After seconds', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '120' }),
          json: async () => ({ error_code: 'over_email_send_rate_limit' }),
        }),
      );

      await expect(
        provider.createPending(email, 'Password123!'),
      ).rejects.toMatchObject({
        status: 429,
        response: {
          code: 'OTP_LIMIT_EXCEEDED',
          retryAfterSeconds: 120,
        },
      });
    });

    it('clears Redis OTP/challenge keys while preserving send limits when purgeOrphanedByEmail purges a stale account', async () => {
      const clearChallengeState = vi.fn().mockResolvedValue(undefined);
      const clearContactsState = vi.fn().mockResolvedValue(undefined);
      const providerWithAbuse = new EmailRegistrationProvider(
        config,
        database as unknown as DatabaseService,
        otpStore as unknown as OtpSecretStore,
        { clearChallengeState, clearContactsState } as any,
      );
      providerWithAbuse.setTransport(vi.fn());
      const staleId = '00000000-0000-4000-8000-000000000099';
      database.query.mockImplementation(async (sql: string) => {
        if (
          sql.includes('SELECT DISTINCT u.id') ||
          sql.includes('WHERE u.id = $1::uuid')
        ) {
          return [{ id: staleId, email }];
        }
        if (sql.includes('DELETE FROM auth.users')) {
          return [{ email, phone: null }];
        }
        return [];
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      );

      const purged = await providerWithAbuse.purgeOrphanedByEmail(email);

      expect(purged).toBe(true);
      expect(clearChallengeState).toHaveBeenCalledWith(
        expect.arrayContaining([{ channel: 'email', identifier: email }]),
        [staleId],
      );
      expect(clearContactsState).not.toHaveBeenCalled();
    });

    it('preserves auth:v1:send:cooldown:* and auth:v1:send:contact:* in Redis during createPending orphan recovery', async () => {
      const abuseConfig = readAbuseConfiguration({
        AUTH_REDIS_URL: 'redis://127.0.0.1:6379',
        AUTH_HMAC_SECRET: 'synthetic-secret-with-at-least-32-bytes',
      });
      const abuse = new AuthAbuseControl(abuseConfig);
      const delMock = vi.fn().mockResolvedValue(1);
      vi.spyOn(
        abuse as unknown as { getConnectedClient: () => Promise<unknown> },
        'getConnectedClient',
      ).mockResolvedValue({
        withCommandOptions: vi.fn().mockReturnValue({ del: delMock }),
      });

      try {
        const providerWithAbuse = new EmailRegistrationProvider(
          config,
          database as unknown as DatabaseService,
          otpStore as unknown as OtpSecretStore,
          abuse,
        );
        providerWithAbuse.setTransport(vi.fn());
        const staleId = '00000000-0000-4000-8000-000000000099';
        database.query.mockImplementation(async (sql: string) => {
          if (
            sql.includes('SELECT DISTINCT u.id') ||
            sql.includes('WHERE u.id = $1::uuid')
          ) {
            return [{ id: staleId, email }];
          }
          if (sql.includes('DELETE FROM auth.users')) {
            return [{ email, phone: null }];
          }
          return [];
        });

        let postCount = 0;
        vi.stubGlobal(
          'fetch',
          vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.method === 'DELETE') {
              return { ok: true, status: 200 };
            }
            postCount += 1;
            if (postCount === 1) {
              return {
                ok: false,
                status: 422,
                json: async () => ({ error_code: 'email_exists' }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: userId, email }),
            };
          }),
        );

        const created = await providerWithAbuse.createPending(
          email,
          'Password123!',
        );
        expect(created).toEqual({
          id: userId,
          subject: userId,
          email,
          verified: false,
        });
        expect(delMock).toHaveBeenCalledTimes(1);
        const deletedKeys = delMock.mock.calls[0][0] as string[];
        expect(
          deletedKeys.some((k) => k.startsWith('auth:v1:send:cooldown:')),
        ).toBe(false);
        expect(
          deletedKeys.some((k) => k.startsWith('auth:v1:send:contact:')),
        ).toBe(false);
        expect(
          deletedKeys.some((k) => k.startsWith('auth:v1:challenge:')),
        ).toBe(true);
        expect(deletedKeys).toContain(`auth:v1:otp:secret:${staleId}`);
      } finally {
        abuse.onModuleDestroy();
      }
    });
  });

  describe('sendChallenge', () => {
    it('generates 6-digit OTP, saves in S1 Redis store, invokes transport, and returns effective expiration', async () => {
      const transport = vi.fn().mockResolvedValue(undefined);
      provider.setTransport(transport);

      const identity = {
        id: userId,
        subject: userId,
        email,
        verified: false,
      };

      const result = await provider.sendChallenge(identity);

      expect(result).toEqual({ expiresInSeconds: 580 });
      expect(otpStore.generateOtp).toHaveBeenCalled();
      expect(otpStore.storeOtp).toHaveBeenCalledWith(userId, email, '123456');
      expect(transport).toHaveBeenCalledWith(email, '123456', undefined);
    });

    it('fails closed with 503 if transport is missing and does not generate/store OTP', async () => {
      const noTransportProvider = new EmailRegistrationProvider(
        config,
        database as unknown as DatabaseService,
        otpStore as unknown as OtpSecretStore,
      );

      const identity = {
        id: userId,
        subject: userId,
        email,
        verified: false,
      };

      await expect(
        noTransportProvider.sendChallenge(identity),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });

      expect(otpStore.storeOtp).not.toHaveBeenCalled();
    });
  });

  describe('createEmailTransportFromConfig and runtime wiring', () => {
    it('returns undefined if config is undefined or has no transport keys', () => {
      expect(createEmailTransportFromConfig(undefined)).toBeUndefined();
      expect(createEmailTransportFromConfig(config)).toBeUndefined();
    });

    it('rejects non-loopback http webhook URLs', () => {
      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'AUTH_EMAIL_WEBHOOK_URL')
            return 'http://remote.mail.service/api/v1/send';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => createEmailTransportFromConfig(customConfig)).toThrow(
        'Invalid AUTH_EMAIL_WEBHOOK_URL: non-loopback transport requires https: protocol',
      );
    });

    it('rejects malformed MAILPIT_URL at configuration time', () => {
      const badMailpitConfig = {
        get: vi.fn((key: string) => {
          if (key === 'MAILPIT_URL') return 'not-a-valid-url';
          return undefined;
        }),
      } as unknown as ConfigService;
      expect(() => createEmailTransportFromConfig(badMailpitConfig)).toThrow(
        'Invalid MAILPIT_URL: malformed URL',
      );
    });

    it('creates native Mailpit transport from MAILPIT_URL and normalizes base URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'MAILPIT_URL') return 'http://127.0.0.1:8025';
          if (key === 'AUTH_EMAIL_FROM') return 'custom@mentor.local';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await transport!('test@example.com', '789012');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8025/api/v1/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            From: { Email: 'custom@mentor.local' },
            To: [{ Email: 'test@example.com' }],
            Subject: 'Your verification code',
            Text: 'Your verification code is: 789012',
          }),
          redirect: 'error',
        }),
      );
    });

    it('normalizes trailing slashes on MAILPIT_URL ending in /api/v1/send/', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'MAILPIT_URL')
            return 'http://127.0.0.1:8025/api/v1/send/';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await transport!('test@example.com', '123456');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8025/api/v1/send',
        expect.objectContaining({
          method: 'POST',
          redirect: 'error',
        }),
      );
    });

    it('creates native Mailpit transport with default sender and throws on non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'MAILPIT_URL') return 'http://127.0.0.1:8025/api/v1/send';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await expect(transport!('test@example.com', '789012')).rejects.toThrow(
        'Mailpit HTTP send failed with status 500',
      );
    });

    it('creates HTTP webhook transport from AUTH_EMAIL_TRANSPORT_URL on loopback', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'AUTH_EMAIL_TRANSPORT_URL')
            return 'http://127.0.0.1:8025/api/v1/send';
          if (key === 'AUTH_EMAIL_TRANSPORT_KEY') return 'secret-key-123';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await transport!('test@example.com', '654321');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8025/api/v1/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret-key-123',
          },
          body: JSON.stringify({
            to: 'test@example.com',
            otp: '654321',
            subject: 'Your verification code',
          }),
          redirect: 'error',
        }),
      );
    });

    it('creates HTTP webhook transport from AUTH_EMAIL_WEBHOOK_URL with https', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'AUTH_EMAIL_WEBHOOK_URL')
            return 'https://mail.example.com/api/v1/send';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await transport!('test@example.com', '123456');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://mail.example.com/api/v1/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: 'test@example.com',
            otp: '123456',
            subject: 'Your verification code',
          }),
          redirect: 'error',
        }),
      );
    });

    it('throws error when HTTP webhook transport returns non-ok status', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      );

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'EMAIL_TRANSPORT_URL')
            return 'http://127.0.0.1:8025/api/v1/send';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      await expect(transport!('test@example.com', '654321')).rejects.toThrow(
        'Email transport HTTP dispatch failed with status 500',
      );
    });

    describe('Google Apps Script webhook transport', () => {
      const gasUrl =
        'https://script.google.com/macros/s/AKfycbSyntheticDeploymentId/exec';
      const gasEchoUrl =
        'https://script.googleusercontent.com/macros/echo?user_content_key=synthetic';

      const buildGasConfig = (secret?: string) =>
        ({
          get: vi.fn((key: string) => {
            if (key === 'AUTH_OTP_HMAC_SECRET')
              return 'secret-at-least-32-bytes-long-for-hmac!';
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
            if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
            if (key === 'AUTH_EMAIL_WEBHOOK_URL') return gasUrl;
            if (key === 'AUTH_EMAIL_TRANSPORT_KEY') return secret;
            return undefined;
          }),
          getOrThrow: vi.fn((key: string) => {
            if (key === 'SUPABASE_URL') return 'http://supabase.invalid';
            throw new Error(`Missing ${key}`);
          }),
        }) as unknown as ConfigService;

      it('sends secret in JSON body without Authorization header, follows single 302 to script.googleusercontent.com with shared signal, and succeeds on 200 {"ok":true}', async () => {
        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 302,
            headers: new Headers({ location: gasEchoUrl }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          });
        vi.stubGlobal('fetch', mockFetch);

        const transport = createEmailTransportFromConfig(
          buildGasConfig('gas-shared-secret-123456'),
        );
        expect(transport).toBeDefined();

        const controller = new AbortController();
        await transport!(
          'learner@example.invalid',
          '654321',
          controller.signal,
        );

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenNthCalledWith(1, gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: 'learner@example.invalid',
            otp: '654321',
            subject: 'Your verification code',
            secret: 'gas-shared-secret-123456',
          }),
          redirect: 'manual',
          signal: controller.signal,
        });
        expect(mockFetch).toHaveBeenNthCalledWith(2, gasEchoUrl, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        });
        const secondInit = mockFetch.mock.calls[1][1] as {
          headers?: Record<string, string>;
        };
        expect(secondInit.headers).toBeUndefined();
      });

      it('rejects 302 redirect to a disallowed host without following it and maps to 502 EMAIL_PROVIDER_ERROR', async () => {
        const gasConfig = buildGasConfig('gas-shared-secret-123456');
        const gasProvider = new EmailRegistrationProvider(
          gasConfig,
          database as unknown as DatabaseService,
          otpStore as unknown as OtpSecretStore,
        );
        otpStore.storeOtp.mockResolvedValue({ expiresInSeconds: 600 });

        const abuseStub = {
          enforceIpQuota: vi.fn().mockResolvedValue(undefined),
          reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
        } as unknown as AuthAbuseControl;
        const registrationService = new EmailRegistrationService(
          gasProvider,
          abuseStub,
          database as unknown as DatabaseService,
          gasConfig,
        );
        const req = {
          ip: '192.0.2.10',
          ips: [],
          headers: {},
          socket: { remoteAddress: '192.0.2.10' },
          app: { get: () => undefined },
        } as unknown as Request;

        database.query.mockImplementation(async (sql: string) => {
          if (sql.includes('FROM auth.users u')) return [];
          if (sql.includes('SELECT id FROM public.users WHERE email=$1'))
            return [];
          if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
            return [];
          if (
            sql.includes(
              'SELECT verified_contact,email,phone FROM public.users',
            )
          )
            return [{ verified_contact: false, email: null, phone: null }];
          if (sql.includes('SELECT provider_subject,contact_value,verified_at'))
            return [
              {
                provider_subject: userId,
                contact_value: email,
                verified_at: null,
              },
            ];
          return [];
        });

        const mockFetch = vi.fn(async (input: string) => {
          if (input.includes('/auth/v1/admin/users')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: userId, email }),
            };
          }
          if (input === gasUrl) {
            return {
              ok: false,
              status: 302,
              headers: new Headers({
                location: 'https://evil.example.com/steal',
              }),
            };
          }
          throw new Error(`Unexpected redirect followed to ${input}`);
        });
        vi.stubGlobal('fetch', mockFetch);

        await expect(
          registrationService.register(
            {
              email,
              password: 'Password123!',
              confirm_password: 'Password123!',
              privacy_consent: true,
            },
            req,
          ),
        ).rejects.toMatchObject({
          status: 502,
          response: expect.objectContaining({ code: 'EMAIL_PROVIDER_ERROR' }),
        });

        expect(mockFetch).not.toHaveBeenCalledWith(
          'https://evil.example.com/steal',
          expect.anything(),
        );
      });

      it('fails closed (502) on GAS 200 {"ok":false,"error":"UNAUTHORIZED"} and non-JSON HTML responses', async () => {
        const gasConfig = buildGasConfig('gas-shared-secret-123456');
        const gasProvider = new EmailRegistrationProvider(
          gasConfig,
          database as unknown as DatabaseService,
          otpStore as unknown as OtpSecretStore,
        );
        otpStore.storeOtp.mockResolvedValue({ expiresInSeconds: 600 });

        const abuseStub = {
          enforceIpQuota: vi.fn().mockResolvedValue(undefined),
          reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
        } as unknown as AuthAbuseControl;
        const registrationService = new EmailRegistrationService(
          gasProvider,
          abuseStub,
          database as unknown as DatabaseService,
          gasConfig,
        );
        const req = {
          ip: '192.0.2.10',
          ips: [],
          headers: {},
          socket: { remoteAddress: '192.0.2.10' },
          app: { get: () => undefined },
        } as unknown as Request;

        database.query.mockImplementation(async (sql: string) => {
          if (sql.includes('FROM auth.users u')) return [];
          if (sql.includes('SELECT id FROM public.users WHERE email=$1'))
            return [];
          if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
            return [];
          if (
            sql.includes(
              'SELECT verified_contact,email,phone FROM public.users',
            )
          )
            return [{ verified_contact: false, email: null, phone: null }];
          if (sql.includes('SELECT provider_subject,contact_value,verified_at'))
            return [
              {
                provider_subject: userId,
                contact_value: email,
                verified_at: null,
              },
            ];
          return [];
        });

        // 1) GAS 200 {"ok":false,"error":"UNAUTHORIZED"}
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: string) => {
            if (input.includes('/auth/v1/admin/users')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ id: userId, email }),
              };
            }
            if (input === gasUrl) {
              return {
                ok: false,
                status: 302,
                headers: new Headers({ location: gasEchoUrl }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({ ok: false, error: 'UNAUTHORIZED' }),
            };
          }),
        );

        await expect(
          registrationService.register(
            {
              email,
              password: 'Password123!',
              confirm_password: 'Password123!',
              privacy_consent: true,
            },
            req,
          ),
        ).rejects.toMatchObject({
          status: 502,
          response: expect.objectContaining({ code: 'EMAIL_PROVIDER_ERROR' }),
        });

        // 2) GAS 200 non-JSON HTML response (e.g., Google auth page)
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: string) => {
            if (input.includes('/auth/v1/admin/users')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ id: userId, email }),
              };
            }
            if (input === gasUrl) {
              return {
                ok: false,
                status: 302,
                headers: new Headers({ location: gasEchoUrl }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: async () => {
                throw new SyntaxError('Unexpected token < in JSON');
              },
            };
          }),
        );

        await expect(
          registrationService.register(
            {
              email,
              password: 'Password123!',
              confirm_password: 'Password123!',
              privacy_consent: true,
            },
            req,
          ),
        ).rejects.toMatchObject({
          status: 502,
          response: expect.objectContaining({ code: 'EMAIL_PROVIDER_ERROR' }),
        });
      });

      it('maps abort/timeout during redirected GET to 504 PROVIDER_TIMEOUT', async () => {
        const gasConfig = buildGasConfig('gas-shared-secret-123456');
        const gasProvider = new EmailRegistrationProvider(
          gasConfig,
          database as unknown as DatabaseService,
          otpStore as unknown as OtpSecretStore,
        );
        otpStore.storeOtp.mockResolvedValue({ expiresInSeconds: 600 });

        const abuseStub = {
          enforceIpQuota: vi.fn().mockResolvedValue(undefined),
          reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
        } as unknown as AuthAbuseControl;
        const registrationService = new EmailRegistrationService(
          gasProvider,
          abuseStub,
          database as unknown as DatabaseService,
          gasConfig,
        );
        const req = {
          ip: '192.0.2.10',
          ips: [],
          headers: {},
          socket: { remoteAddress: '192.0.2.10' },
          app: { get: () => undefined },
        } as unknown as Request;

        database.query.mockImplementation(async (sql: string) => {
          if (sql.includes('FROM auth.users u')) return [];
          if (sql.includes('SELECT id FROM public.users WHERE email=$1'))
            return [];
          if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
            return [];
          if (
            sql.includes(
              'SELECT verified_contact,email,phone FROM public.users',
            )
          )
            return [{ verified_contact: false, email: null, phone: null }];
          if (sql.includes('SELECT provider_subject,contact_value,verified_at'))
            return [
              {
                provider_subject: userId,
                contact_value: email,
                verified_at: null,
              },
            ];
          return [];
        });

        let firstSignal: AbortSignal | undefined;
        let secondSignal: AbortSignal | undefined;
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: string, init?: { signal?: AbortSignal }) => {
            if (input.includes('/auth/v1/admin/users')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ id: userId, email }),
              };
            }
            if (input === gasUrl) {
              firstSignal = init?.signal;
              return {
                ok: false,
                status: 302,
                headers: new Headers({ location: gasEchoUrl }),
              };
            }
            secondSignal = init?.signal;
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
          }),
        );

        await expect(
          registrationService.register(
            {
              email,
              password: 'Password123!',
              confirm_password: 'Password123!',
              privacy_consent: true,
            },
            req,
          ),
        ).rejects.toMatchObject({
          status: 504,
          response: expect.objectContaining({ code: 'PROVIDER_TIMEOUT' }),
        });

        expect(firstSignal).toBeDefined();
        expect(secondSignal).toBe(firstSignal);
      });
    });

    it('throws error when RESEND_API_KEY is configured without AUTH_EMAIL_FROM', () => {
      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_key_123';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => createEmailTransportFromConfig(customConfig)).toThrow(
        'AUTH_EMAIL_FROM is required when RESEND_API_KEY is set',
      );
    });

    it('throws error when AUTH_EMAIL_FROM is malformed with RESEND_API_KEY', () => {
      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_key_123';
          if (key === 'AUTH_EMAIL_FROM') return 'not-a-valid-email';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => createEmailTransportFromConfig(customConfig)).toThrow(
        'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
      );
    });

    it('throws error when AUTH_EMAIL_FROM has consecutive dots in domain with RESEND_API_KEY', () => {
      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_key_123';
          if (key === 'AUTH_EMAIL_FROM') return 'mentor@example..com';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => createEmailTransportFromConfig(customConfig)).toThrow(
        'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
      );
    });

    it('creates Resend transport when AUTH_EMAIL_FROM uses named sender format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_key_123';
          if (key === 'AUTH_EMAIL_FROM')
            return 'Career Mentor <mentor@example.com>';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await transport!('test@example.com', '112233');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer re_test_key_123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Career Mentor <mentor@example.com>',
            to: ['test@example.com'],
            subject: 'Your verification code',
            text: 'Your verification code is: 112233',
          }),
        }),
      );
    });

    it('creates Resend transport from RESEND_API_KEY when AUTH_EMAIL_FROM is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_key_123';
          if (key === 'AUTH_EMAIL_FROM') return 'mentor@career.test';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeDefined();

      await transport!('test@example.com', '112233');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer re_test_key_123',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'mentor@career.test',
            to: ['test@example.com'],
            subject: 'Your verification code',
            text: 'Your verification code is: 112233',
          }),
          redirect: 'error',
        }),
      );
    });

    it('fails closed and does not recognize silent no-op transport', () => {
      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'AUTH_EMAIL_TRANSPORT') return 'local';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(customConfig);
      expect(transport).toBeUndefined();
    });

    it('automatically wires transport in constructor when transport config is present in ConfigService', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const customConfig = {
        get: vi.fn((key: string) => {
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return 'secret-at-least-32-bytes-long-for-hmac!';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          if (key === 'MAILPIT_URL') return 'http://127.0.0.1:8025/api/v1/send';
          return undefined;
        }),
      } as unknown as ConfigService;

      const autoWiredProvider = new EmailRegistrationProvider(
        customConfig,
        database as unknown as DatabaseService,
        otpStore as unknown as OtpSecretStore,
      );

      // ready() passes without needing setTransport!
      expect(() => autoWiredProvider.ready()).not.toThrow();

      const identity = {
        id: userId,
        subject: userId,
        email,
        verified: false,
      };
      const delivery = await autoWiredProvider.sendChallenge(identity);
      expect(delivery).toEqual({ expiresInSeconds: 580 });
      expect(otpStore.storeOtp).toHaveBeenCalledWith(userId, email, '123456');
    });

    it('creates SMTP transport with default port 465, secure=true, requireTLS=false, preserves untrimmed password, and dispatches OTP mail', async () => {
      const smtpConfig = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return '  synthetic-app-password  ';
          if (key === 'AUTH_EMAIL_FROM')
            return 'AI Career Mentor <sender@gmail.com>';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(smtpConfig);
      expect(transport).toBeDefined();
      expect(nodemailer.createTransport).toBeDefined();
      expect(mockCreateTransport).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        requireTLS: false,
        auth: {
          user: 'sender@gmail.com',
          pass: '  synthetic-app-password  ',
        },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      });

      const controller = new AbortController();
      await transport!('learner@example.invalid', '654321', controller.signal);
      expect(mockSendMail).toHaveBeenCalledWith({
        from: 'AI Career Mentor <sender@gmail.com>',
        to: 'learner@example.invalid',
        subject: 'Your verification code',
        text: 'Your verification code is: 654321',
        signal: controller.signal,
      });
    });

    it('defaults SMTP secure to false with requireTLS=true for port 587 and honors explicit SMTP_SECURE override', () => {
      const port587Config = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_PORT') return '587';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'synthetic-app-password';
          if (key === 'AUTH_EMAIL_FROM') return 'sender@gmail.com';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(createEmailTransportFromConfig(port587Config)).toBeDefined();
      expect(mockCreateTransport).toHaveBeenLastCalledWith(
        expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
      );

      const explicitSecureConfig = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_PORT') return '587';
          if (key === 'SMTP_SECURE') return 'true';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'synthetic-app-password';
          if (key === 'AUTH_EMAIL_FROM') return 'sender@gmail.com';
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(
        createEmailTransportFromConfig(explicitSecureConfig),
      ).toBeDefined();
      expect(mockCreateTransport).toHaveBeenLastCalledWith(
        expect.objectContaining({ port: 587, secure: true, requireTLS: false }),
      );
    });

    it('validates SMTP_PORT, SMTP_SECURE, AUTH_EMAIL_FROM and returns undefined on incomplete SMTP config', () => {
      const partialSmtp = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'AUTH_EMAIL_FROM') return 'sender@gmail.com';
          return undefined;
        }),
      } as unknown as ConfigService;
      expect(createEmailTransportFromConfig(partialSmtp)).toBeUndefined();

      const badPort = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_PORT') return '70000';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'synthetic-app-password';
          if (key === 'AUTH_EMAIL_FROM') return 'sender@gmail.com';
          return undefined;
        }),
      } as unknown as ConfigService;
      expect(() => createEmailTransportFromConfig(badPort)).toThrow(
        'Invalid SMTP_PORT',
      );

      const badSecure = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_SECURE') return 'maybe';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'synthetic-app-password';
          if (key === 'AUTH_EMAIL_FROM') return 'sender@gmail.com';
          return undefined;
        }),
      } as unknown as ConfigService;
      expect(() => createEmailTransportFromConfig(badSecure)).toThrow(
        'Invalid SMTP_SECURE',
      );

      const badFrom = {
        get: vi.fn((key: string) => {
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'synthetic-app-password';
          if (key === 'AUTH_EMAIL_FROM') return 'invalid-from';
          return undefined;
        }),
      } as unknown as ConfigService;
      expect(() => createEmailTransportFromConfig(badFrom)).toThrow(
        'AUTH_EMAIL_FROM must be an email address on a verified sender domain',
      );
    });

    it('keeps Resend precedence over SMTP when both are configured', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', mockFetch);

      const bothConfig = {
        get: vi.fn((key: string) => {
          if (key === 'RESEND_API_KEY') return 're_test_key_123';
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'synthetic-app-password';
          if (key === 'AUTH_EMAIL_FROM') return 'mentor@career.test';
          return undefined;
        }),
      } as unknown as ConfigService;

      const transport = createEmailTransportFromConfig(bothConfig);
      expect(transport).toBeDefined();
      await transport!('learner@example.invalid', '123456');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.any(Object),
      );
      expect(mockCreateTransport).not.toHaveBeenCalled();
    });

    it('sanitizes SMTP errors without leaking credentials/PII and maps failures to 502 and timeouts to 504', async () => {
      const smtpConfig = {
        get: vi.fn((key: string) => {
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return 'secret-at-least-32-bytes-long-for-hmac!';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          if (key === 'SMTP_HOST') return 'smtp.gmail.com';
          if (key === 'SMTP_USER') return 'sender@gmail.com';
          if (key === 'SMTP_PASS') return 'super-secret-smtp-password';
          if (key === 'AUTH_EMAIL_FROM') return 'sender@gmail.com';
          return undefined;
        }),
        getOrThrow: vi.fn((key: string) => {
          if (key === 'SUPABASE_URL') return 'http://supabase.invalid';
          throw new Error(`Missing ${key}`);
        }),
      } as unknown as ConfigService;

      const smtpProvider = new EmailRegistrationProvider(
        smtpConfig,
        database as unknown as DatabaseService,
        otpStore as unknown as OtpSecretStore,
      );
      expect(() => smtpProvider.ready()).not.toThrow();

      // 1) Credential-free sanitization on EAUTH error (even when message mentions "session timeout")
      const rawAuthErr = Object.assign(
        new Error(
          '535 session timeout: invalid login for sender@gmail.com with pass super-secret-smtp-password to learner@example.invalid',
        ),
        { code: 'EAUTH' },
      );
      mockSendMail.mockRejectedValueOnce(rawAuthErr);
      let caughtAuthErr: unknown;
      try {
        await smtpProvider.sendChallenge({
          id: userId,
          subject: userId,
          email: 'learner@example.invalid',
          verified: false,
        });
      } catch (err) {
        caughtAuthErr = err;
      }
      expect(caughtAuthErr).toBeInstanceOf(Error);
      expect((caughtAuthErr as Error).message).toBe(
        'SMTP email dispatch failed (EAUTH)',
      );
      expect(
        (caughtAuthErr as Error & { cause?: unknown }).cause,
      ).toBeUndefined();

      // 2) Sanitized AbortError on ETIMEDOUT and in-flight AbortSignal passed directly to sendMail
      const rawTimeoutErr = Object.assign(
        new Error(
          'Connection timeout to smtp.gmail.com for super-secret-smtp-password',
        ),
        { code: 'ETIMEDOUT' },
      );
      mockSendMail.mockRejectedValueOnce(rawTimeoutErr);
      await expect(
        smtpProvider.sendChallenge({
          id: userId,
          subject: userId,
          email: 'learner@example.invalid',
          verified: false,
        }),
      ).rejects.toMatchObject({
        name: 'AbortError',
        message: 'SMTP email dispatch timed out',
      });

      const controller = new AbortController();
      mockSendMail.mockImplementationOnce(
        ({ signal }: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                const abortErr = new Error('The operation was aborted');
                abortErr.name = 'AbortError';
                reject(abortErr);
              },
              { once: true },
            );
            queueMicrotask(() => controller.abort());
          }),
      );
      const pendingPromise = smtpProvider.sendChallenge(
        {
          id: userId,
          subject: userId,
          email: 'learner@example.invalid',
          verified: false,
        },
        controller.signal,
      );
      await expect(pendingPromise).rejects.toMatchObject({
        name: 'AbortError',
        message: 'SMTP email dispatch timed out',
      });
      expect(mockCloseTransport).not.toHaveBeenCalled();

      // 3) End-to-end mapping in EmailRegistrationService: use 600s OTP fixture so success passes
      otpStore.storeOtp.mockResolvedValue({ expiresInSeconds: 600 });
      const abuseStub = {
        enforceIpQuota: vi.fn().mockResolvedValue(undefined),
        reserveSend: vi.fn().mockResolvedValue({ retryAfterSeconds: 60 }),
      } as unknown as AuthAbuseControl;
      const registrationService = new EmailRegistrationService(
        smtpProvider,
        abuseStub,
        database as unknown as DatabaseService,
        smtpConfig,
      );
      const req = {
        ip: '192.0.2.10',
        ips: [],
        headers: {},
        socket: { remoteAddress: '192.0.2.10' },
        app: { get: () => undefined },
      } as unknown as Request;

      const stubRegistrationSuccessBeforeSend = () => {
        database.query.mockImplementation(async (sql: string) => {
          if (sql.includes('FROM auth.users u')) return [];
          if (sql.includes('SELECT id FROM public.users WHERE email=$1'))
            return [];
          if (sql.includes('SELECT user_id FROM public.user_auth_providers'))
            return [];
          if (
            sql.includes(
              'SELECT verified_contact,email,phone FROM public.users',
            )
          )
            return [{ verified_contact: false, email: null, phone: null }];
          if (sql.includes('SELECT provider_subject,contact_value,verified_at'))
            return [
              {
                provider_subject: userId,
                contact_value: email,
                verified_at: null,
              },
            ];
          return [];
        });
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ id: userId, email }),
          }),
        );
      };

      // Confirm SMTP success returns pending metadata (proves 502 below comes from SMTP rejection, not TTL mismatch)
      stubRegistrationSuccessBeforeSend();
      mockSendMail.mockResolvedValueOnce({ messageId: 'ok-msg-id' });
      await expect(
        registrationService.register(
          {
            email,
            password: 'Password123!',
            confirm_password: 'Password123!',
            privacy_consent: true,
          },
          req,
        ),
      ).resolves.toMatchObject({
        verification_channel: 'email',
        expires_in_seconds: 600,
      });

      // EAUTH (even mentioning "session timeout") -> 502 EMAIL_PROVIDER_ERROR
      stubRegistrationSuccessBeforeSend();
      mockSendMail.mockRejectedValueOnce(rawAuthErr);
      await expect(
        registrationService.register(
          {
            email,
            password: 'Password123!',
            confirm_password: 'Password123!',
            privacy_consent: true,
          },
          req,
        ),
      ).rejects.toMatchObject({
        status: 502,
        response: expect.objectContaining({ code: 'EMAIL_PROVIDER_ERROR' }),
      });

      // ETIMEDOUT -> 504 PROVIDER_TIMEOUT
      stubRegistrationSuccessBeforeSend();
      mockSendMail.mockRejectedValueOnce(rawTimeoutErr);
      await expect(
        registrationService.register(
          {
            email,
            password: 'Password123!',
            confirm_password: 'Password123!',
            privacy_consent: true,
          },
          req,
        ),
      ).rejects.toMatchObject({
        status: 504,
        response: expect.objectContaining({ code: 'PROVIDER_TIMEOUT' }),
      });
    });

    it('never treats Google or Facebook OAuth auth.users older than 15 minutes without public.users as abandoned orphans', async () => {
      const staleOAuthCreatedAt = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();

      for (const providerName of ['google', 'facebook'] as const) {
        database.query.mockResolvedValueOnce([
          {
            id: userId,
            email,
            email_confirmed_at: staleOAuthCreatedAt,
            created_at: staleOAuthCreatedAt,
            verified_contact: null,
            provider_verified_at: null,
            has_app_user: false,
            is_deleted: false,
            is_oauth_user: true,
            raw_app_meta_data: { provider: providerName },
          },
        ]);

        const identity = await provider.findByEmail(email);
        expect(identity).toEqual({
          id: userId,
          subject: userId,
          email,
          verified: true,
        });
      }
    });
  });
});
