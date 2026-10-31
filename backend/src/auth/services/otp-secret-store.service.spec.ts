import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpSecretStore } from './otp-secret-store.service.js';
import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';

describe('OtpSecretStore (Candidate S1 Redis OTP Secret Store)', () => {
  const hmacSecret = 'test-hmac-secret-at-least-32-bytes-long!';
  const userId = '11111111-1111-4111-8111-111111111111';
  const email = 'candidate@example.invalid';

  let config: ConfigService;
  let abuseControl: {
    isReady: ReturnType<typeof vi.fn>;
    setOtpSecret: ReturnType<typeof vi.fn>;
    getOtpSecret: ReturnType<typeof vi.fn>;
    deleteOtpSecret: ReturnType<typeof vi.fn>;
    issueChallenge: ReturnType<typeof vi.fn>;
    verifyChallenge: ReturnType<typeof vi.fn>;
  };
  let store: OtpSecretStore;

  beforeEach(() => {
    config = {
      get: vi.fn((key: string) => {
        if (key === 'AUTH_OTP_HMAC_SECRET') return hmacSecret;
        return undefined;
      }),
    } as unknown as ConfigService;

    abuseControl = {
      isReady: vi.fn().mockReturnValue(true),
      setOtpSecret: vi.fn().mockResolvedValue(undefined),
      getOtpSecret: vi.fn(),
      deleteOtpSecret: vi.fn().mockResolvedValue(undefined),
      issueChallenge: vi.fn().mockResolvedValue({ expiresInSeconds: 600 }),
      verifyChallenge: vi.fn(),
    };

    store = new OtpSecretStore(
      abuseControl as unknown as AuthAbuseControl,
      config,
    );
  });

  describe('OTP Generation & HMAC digest', () => {
    it('generates a 6-digit numeric OTP', () => {
      const otp = store.generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(Number(otp)).toBeGreaterThanOrEqual(100000);
      expect(Number(otp)).toBeLessThan(1000000);
    });

    it('computes domain-separated HMAC digest using userId, normalized email, and code', () => {
      const digest1 = store.computeDigest(userId, email, '123456');
      const digest2 = store.computeDigest(
        userId,
        '  CANDIDATE@EXAMPLE.INVALID  ',
        '123456',
      );
      expect(digest1).toBe(digest2);

      const digestDiffCode = store.computeDigest(userId, email, '654321');
      expect(digest1).not.toBe(digestDiffCode);

      const digestDiffUser = store.computeDigest(
        '22222222-2222-4222-8222-222222222222',
        email,
        '123456',
      );
      expect(digest1).not.toBe(digestDiffUser);
    });

    it('fails with 503 if HMAC secret is shorter than 32 bytes or missing', () => {
      const shortConfig = {
        get: vi.fn().mockReturnValue('too-short'),
      } as unknown as ConfigService;
      const brokenStore = new OtpSecretStore(
        abuseControl as unknown as AuthAbuseControl,
        shortConfig,
      );
      expect(() => brokenStore.computeDigest(userId, email, '123456')).toThrow(
        expect.objectContaining({ status: 503 }),
      );
    });
  });

  describe('storeOtp', () => {
    it('issues challenge first, stores secret with effective expiresInSeconds, and returns expiration', async () => {
      abuseControl.issueChallenge.mockResolvedValueOnce({
        expiresInSeconds: 540,
      });

      const result = await store.storeOtp(userId, email, '123456', 600);

      expect(abuseControl.issueChallenge).toHaveBeenCalledWith(
        { channel: 'email', identifier: email },
        600,
      );

      expect(abuseControl.setOtpSecret).toHaveBeenCalledTimes(1);
      const [calledUserId, digest, ttl] =
        abuseControl.setOtpSecret.mock.calls[0];
      expect(calledUserId).toBe(userId);
      expect(digest).toBe(store.computeDigest(userId, email, '123456'));
      expect(ttl).toBe(540);

      expect(result).toEqual({ expiresInSeconds: 540 });
    });
  });

  describe('verifyAndConsumeOtp', () => {
    it('rejects invalid OTP format before touching abuse control', async () => {
      await expect(
        store.verifyAndConsumeOtp(userId, email, '12345'),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VERIFICATION_CODE_INVALID' },
      });
      await expect(
        store.verifyAndConsumeOtp(userId, email, 'abcdef'),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VERIFICATION_CODE_INVALID' },
      });
      expect(abuseControl.verifyChallenge).not.toHaveBeenCalled();
    });

    it('succeeds and consumes OTP when code matches stored digest', async () => {
      const digest = store.computeDigest(userId, email, '123456');
      abuseControl.getOtpSecret.mockResolvedValue(digest);
      const onValid = vi.fn().mockResolvedValue(undefined);

      abuseControl.verifyChallenge.mockImplementation(
        async (_contact, code, verifyFn, secretKey) => {
          expect(secretKey).toBe(`auth:v1:otp:secret:${userId}`);
          const isValid = await verifyFn(code);
          expect(isValid).toBe(true);
        },
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456', onValid),
      ).resolves.toBeUndefined();

      expect(onValid).toHaveBeenCalledOnce();
      expect(abuseControl.deleteOtpSecret).not.toHaveBeenCalled();
    });

    it('preserves the OTP when valid-code follow-up work fails', async () => {
      const digest = store.computeDigest(userId, email, '123456');
      abuseControl.getOtpSecret.mockResolvedValue(digest);
      const providerError = new HttpException(
        { code: 'EMAIL_PROVIDER_ERROR' },
        502,
      );
      abuseControl.verifyChallenge.mockImplementation(
        async (_contact, code, verifyFn) => {
          await verifyFn(code);
        },
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456', async () => {
          throw providerError;
        }),
      ).rejects.toThrow(providerError);

      expect(abuseControl.deleteOtpSecret).not.toHaveBeenCalled();
    });

    it('converts non-HttpException follow-up errors to 503 HttpException before verifyChallenge', async () => {
      const digest = store.computeDigest(userId, email, '123456');
      abuseControl.getOtpSecret.mockResolvedValue(digest);
      abuseControl.verifyChallenge.mockImplementation(
        async (_contact, code, verifyFn) => {
          await verifyFn(code);
        },
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456', async () => {
          throw new Error('Database connection reset');
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: { code: 'SERVICE_UNAVAILABLE' },
      });

      expect(abuseControl.deleteOtpSecret).not.toHaveBeenCalled();
    });

    it('returns false in verifyFn when code does not match stored digest', async () => {
      const storedDigest = store.computeDigest(userId, email, '123456');
      abuseControl.getOtpSecret.mockResolvedValue(storedDigest);

      abuseControl.verifyChallenge.mockImplementation(
        async (_contact, code, verifyFn) => {
          const isValid = await verifyFn(code);
          expect(isValid).toBe(false);
          throw new HttpException({ code: 'VERIFICATION_CODE_INVALID' }, 422);
        },
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '654321'),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'VERIFICATION_CODE_INVALID' },
      });
    });

    it('throws 410 VERIFICATION_CODE_EXPIRED inside verifyFn when secret is absent or expired in Redis', async () => {
      abuseControl.getOtpSecret.mockResolvedValue(null);

      abuseControl.verifyChallenge.mockImplementation(
        async (_contact, code, verifyFn) => {
          await verifyFn(code);
        },
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456'),
      ).rejects.toMatchObject({
        status: 410,
        response: { code: 'VERIFICATION_CODE_EXPIRED' },
      });
    });

    it('throws 410 VERIFICATION_CODE_EXPIRED when challenge is expired in abuse-control', async () => {
      abuseControl.verifyChallenge.mockRejectedValue(
        new HttpException({ code: 'VERIFICATION_CODE_EXPIRED' }, 410),
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456'),
      ).rejects.toMatchObject({
        status: 410,
        response: { code: 'VERIFICATION_CODE_EXPIRED' },
      });
    });

    it('throws 429 VERIFICATION_ATTEMPTS_EXCEEDED without deleting a possibly newer secret', async () => {
      abuseControl.verifyChallenge.mockRejectedValue(
        new HttpException(
          { code: 'VERIFICATION_ATTEMPTS_EXCEEDED', retryAfterSeconds: 45 },
          429,
        ),
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456'),
      ).rejects.toMatchObject({
        status: 429,
        response: { code: 'VERIFICATION_ATTEMPTS_EXCEEDED' },
      });

      expect(abuseControl.deleteOtpSecret).not.toHaveBeenCalled();
    });

    it('throws 409 ALREADY_VERIFIED when challenge is already consumed', async () => {
      abuseControl.verifyChallenge.mockRejectedValue(
        new HttpException({ code: 'ALREADY_VERIFIED' }, 409),
      );

      await expect(
        store.verifyAndConsumeOtp(userId, email, '123456'),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ALREADY_VERIFIED' },
      });
    });
  });
});
