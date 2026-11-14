import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TextBeeSmsProvider, maskPhone } from './textbee-sms.provider.js';
import type { DatabaseService } from './database.service.js';
import type { OtpSecretStore } from './otp-secret-store.service.js';

describe('TextBeeSmsProvider', () => {
  const TEST_PHONE = '+8801712345678';
  const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('maskPhone', () => {
    it('masks Bangladesh mobile phone number correctly', () => {
      expect(maskPhone('+8801712345678')).toBe('+8801****5678');
      expect(maskPhone('01712345678')).toBe('01712****5678');
    });

    it('masks short numbers safely', () => {
      expect(maskPhone('12345')).toBe('12****');
    });
  });

  describe('ready() and isConfigured() checks', () => {
    it('fails closed with 503 in production when TEXTBEE_API_KEY is missing', () => {
      const config = {
        get: vi.fn((key: string) => {
          if (key === 'NODE_ENV') return 'production';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          if (key === 'MAILPIT_URL') return 'http://127.0.0.1:56324';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        {
          generateOtp: vi.fn(),
          storeOtp: vi.fn(),
        } as unknown as OtpSecretStore,
      );

      expect(provider.isConfigured()).toBe(false);
      expect(() => provider.ready()).toThrow(HttpException);
      try {
        provider.ready();
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(503);
      }
    });

    it('fails closed with 503 in non-production when TEXTBEE_API_KEY is missing even if MAILPIT_URL is set', () => {
      const config = {
        get: vi.fn((key: string) => {
          if (key === 'NODE_ENV') return 'development';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          if (key === 'MAILPIT_URL') return 'http://127.0.0.1:56324';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        {
          generateOtp: vi.fn(),
          storeOtp: vi.fn(),
        } as unknown as OtpSecretStore,
      );

      expect(provider.isConfigured()).toBe(false);
      expect(() => provider.ready()).toThrow(HttpException);
    });

    it('allows live TextBee delivery when TEXTBEE_API_KEY is configured', () => {
      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'tb_test_api_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        {
          generateOtp: vi.fn(),
          storeOtp: vi.fn(),
        } as unknown as OtpSecretStore,
      );

      expect(provider.isConfigured()).toBe(true);
      expect(() => provider.ready()).not.toThrow();
    });
  });

  describe('Live TextBee SMS dispatch', () => {
    it('dispatches to default device endpoint (/gateway/send-sms) with x-api-key header and recipients array', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'tb_secret_key_123';
          if (key === 'TEXTBEE_BASE_URL')
            return 'https://api.textbee.dev/api/v1';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config);
      await provider.dispatchSms(TEST_PHONE, 'Your code is: 123456');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe(
        'tb_secret_key_123',
      );
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect(JSON.parse(init?.body as string)).toEqual({
        recipients: [TEST_PHONE],
        message: 'Your code is: 123456',
      });
    });

    it('dispatches to device-specific endpoint (/gateway/devices/:deviceId/send-sms) when TEXTBEE_DEVICE_ID is configured', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'tb_secret_key_123';
          if (key === 'TEXTBEE_DEVICE_ID') return 'device_xyz_789';
          if (key === 'TEXTBEE_BASE_URL')
            return 'https://api.textbee.dev/api/v1';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config);
      await provider.dispatchSms(TEST_PHONE, 'Your code is: 654321');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.textbee.dev/api/v1/gateway/devices/device_xyz_789/send-sms',
      );
      expect(init?.redirect).toBe('error');
    });

    it('maps non-2xx API error to 503 SERVICE_UNAVAILABLE without leaking key', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValue(
        new Response('Gateway error', { status: 500 }),
      );

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'tb_secret_key_123';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config);

      try {
        await provider.dispatchSms(TEST_PHONE, 'Your code is: 123456');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(503);
        const resp = (err as HttpException).getResponse() as any;
        expect(resp.code).toBe('SERVICE_UNAVAILABLE');
        expect(JSON.stringify(resp)).not.toContain('tb_secret_key_123');
      }
    });

    it('maps network timeout to 504 PROVIDER_TIMEOUT', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(timeoutError);

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'tb_secret_key_123';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config);
      try {
        await provider.dispatchSms(TEST_PHONE, 'Your code is: 123456');
        expect.fail('Should have failed');
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(504);
        const resp = (err as HttpException).getResponse() as any;
        expect(resp.code).toBe('PROVIDER_TIMEOUT');
      }
    });
    it('fails with 503 SERVICE_UNAVAILABLE when TEXTBEE_API_KEY is missing in non-production even if MAILPIT_URL and SMS_PROVIDER=mailpit are set', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'NODE_ENV') return 'development';
          if (key === 'SMS_PROVIDER') return 'mailpit';
          if (key === 'MAILPIT_URL') return 'http://127.0.0.1:56324';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config);

      try {
        await provider.dispatchSms(TEST_PHONE, 'Your code is: 123456');
        expect.fail('Should have thrown 503');
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(503);
        const resp = (err as HttpException).getResponse() as any;
        expect(resp.code).toBe('SERVICE_UNAVAILABLE');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Database and Identity Lifecycle Methods', () => {
    it('findByPhone queries users and user_auth_providers for phone identity', async () => {
      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: TEST_USER_ID,
            phone: TEST_PHONE,
            phone_confirmed_at: '2026-11-10T00:00:00.000Z',
            verified_contact: true,
            provider_verified_at: '2026-11-10T00:00:00.000Z',
          },
        ]),
      } as unknown as DatabaseService;

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config, database, {
        generateOtp: vi.fn(),
        storeOtp: vi.fn(),
      } as unknown as OtpSecretStore);

      const identity = await provider.findByPhone(TEST_PHONE);
      expect(identity).toEqual({
        id: TEST_USER_ID,
        subject: TEST_USER_ID,
        phone: TEST_PHONE,
        verified: true,
      });
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "WHERE u.phone IN ($1, ltrim($1, '+')) OR p.contact_value IN ($1, ltrim($1, '+'))",
        ),
        [TEST_PHONE],
      );
    });

    it('findByPhone normalizes digits-only phone identity from database to canonical E.164 with leading +', async () => {
      const database = {
        query: vi.fn().mockResolvedValueOnce([
          {
            id: TEST_USER_ID,
            phone: '8801712345678',
            verified_contact: true,
          },
        ]),
      } as unknown as DatabaseService;

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(config, database, {
        generateOtp: vi.fn(),
        storeOtp: vi.fn(),
      } as unknown as OtpSecretStore);

      const identity = await provider.findByPhone(TEST_PHONE);
      expect(identity).toEqual({
        id: TEST_USER_ID,
        subject: TEST_USER_ID,
        phone: '+8801712345678',
        verified: true,
      });
    });

    it('createPending creates unconfirmed GoTrue user with phone', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            phone: TEST_PHONE,
          }),
          { status: 200 },
        ),
      );

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
        getOrThrow: vi.fn((key: string) => {
          if (key === 'SUPABASE_URL') return 'http://127.0.0.1:56321';
          throw new Error('Missing ' + key);
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        {
          generateOtp: vi.fn(),
          storeOtp: vi.fn(),
        } as unknown as OtpSecretStore,
      );

      const pending = await provider.createPending(TEST_PHONE, 'Pass1234!');
      expect(pending).toEqual({
        id: TEST_USER_ID,
        subject: TEST_USER_ID,
        phone: TEST_PHONE,
        verified: false,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:56321/auth/v1/admin/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            phone: TEST_PHONE,
            password: 'Pass1234!',
            phone_confirm: false,
          }),
        }),
      );
    });

    it('createPending normalizes digits-only phone response from GoTrue Admin API to canonical E.164', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            phone: '8801712345678',
          }),
          { status: 200 },
        ),
      );

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
        getOrThrow: vi.fn((key: string) => {
          if (key === 'SUPABASE_URL') return 'http://127.0.0.1:56321';
          throw new Error('Missing ' + key);
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        {
          generateOtp: vi.fn(),
          storeOtp: vi.fn(),
        } as unknown as OtpSecretStore,
      );

      const pending = await provider.createPending(TEST_PHONE, 'Pass1234!');
      expect(pending).toEqual({
        id: TEST_USER_ID,
        subject: TEST_USER_ID,
        phone: '+8801712345678',
        verified: false,
      });
    });

    it('createPending maps 422 phone_exists to 409 CONTACT_ALREADY_REGISTERED', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error_code: 'phone_exists',
            msg: 'A user with this phone number already exists',
          }),
          { status: 422 },
        ),
      );

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
        getOrThrow: vi.fn(() => 'http://127.0.0.1:56321'),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        {
          generateOtp: vi.fn(),
          storeOtp: vi.fn(),
        } as unknown as OtpSecretStore,
      );

      try {
        await provider.createPending(TEST_PHONE, 'Pass1234!');
        expect.fail('Should have thrown 409');
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(409);
        const resp = (err as HttpException).getResponse() as any;
        expect(resp.code).toBe('CONTACT_ALREADY_REGISTERED');
      }
    });

    it('sendChallenge generates OTP, stores in Redis with verify_phone purpose, and dispatches SMS', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const otpStore = {
        generateOtp: vi.fn().mockReturnValue('123456'),
        storeOtp: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
      };

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        otpStore as unknown as OtpSecretStore,
      );

      const result = await provider.sendChallenge({
        id: TEST_USER_ID,
        phone: TEST_PHONE,
      });
      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(otpStore.generateOtp).toHaveBeenCalled();
      expect(otpStore.storeOtp).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_PHONE,
        '123456',
        600,
        'verify_phone',
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.textbee.dev/api/v1/gateway/send-sms',
        expect.objectContaining({
          redirect: 'error',
          body: JSON.stringify({
            recipients: [TEST_PHONE],
            message: 'Your verification code is: 123456',
          }),
        }),
      );
    });

    it('sendPasswordResetChallenge generates OTP, stores in Redis with reset_password purpose, and dispatches SMS', async () => {
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const otpStore = {
        generateOtp: vi.fn().mockReturnValue('654321'),
        storeOtp: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
      };

      const config = {
        get: vi.fn((key: string) => {
          if (key === 'TEXTBEE_API_KEY') return 'test_key';
          if (key === 'AUTH_OTP_HMAC_SECRET')
            return '01234567890123456789012345678901';
          if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'sb-service-key';
          if (key === 'AUTH_REDIS_URL') return 'redis://localhost:6379';
          return undefined;
        }),
      } as unknown as ConfigService;

      const provider = new TextBeeSmsProvider(
        config,
        {} as DatabaseService,
        otpStore as unknown as OtpSecretStore,
      );

      const result = await provider.sendPasswordResetChallenge(
        TEST_PHONE,
        TEST_USER_ID,
      );
      expect(result).toEqual({ expiresInSeconds: 600 });
      expect(otpStore.storeOtp).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_PHONE,
        '654321',
        600,
        'reset_password',
      );
    });
  });
});
