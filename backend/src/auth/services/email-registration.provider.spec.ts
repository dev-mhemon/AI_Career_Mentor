import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EmailRegistrationProvider } from './email-registration.provider.js';
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
});
