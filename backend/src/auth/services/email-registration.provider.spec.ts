import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  EmailRegistrationProvider,
  createEmailTransportFromConfig,
} from './email-registration.provider.js';
import type { DatabaseService } from './database.service.js';
import type { OtpSecretStore } from './otp-secret-store.service.js';

describe('EmailRegistrationProvider (Option 2B GoTrue Admin + S1 OTP)', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'candidate@example.invalid';

  let config: ConfigService;
  let database: { query: ReturnType<typeof vi.fn> };
  let otpStore: {
    generateOtp: ReturnType<typeof vi.fn>;
    storeOtp: ReturnType<typeof vi.fn>;
  };
  let provider: EmailRegistrationProvider;

  beforeEach(() => {
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

    database = {
      query: vi.fn(),
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
  });

  describe('findByEmail & Failure Boundary 2 recovery', () => {
    it('returns null when identity does not exist in database', async () => {
      database.query.mockResolvedValue([]);
      const result = await provider.findByEmail(email);
      expect(result).toBeNull();
    });

    it('protects a GoTrue-confirmed email even when public.users.verified_contact is false', async () => {
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
        verified: true,
      });
    });

    it('returns verified = true when public.users.verified_contact is true', async () => {
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
        'WHERE lower(u.email) = $1 OR lower(p.contact_value) = $1',
      );
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
  });
});
