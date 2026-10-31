import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { fail } from '../../common/http.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';

@Injectable()
export class OtpSecretStore {
  constructor(
    private readonly abuse: AuthAbuseControl,
    private readonly config: ConfigService,
  ) {}

  private getHmacSecret(): string {
    const secret = this.config.get<string>('AUTH_OTP_HMAC_SECRET');
    if (
      !secret ||
      typeof secret !== 'string' ||
      Buffer.byteLength(secret) < 32
    ) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'OTP secret store is unavailable',
        [],
        true,
        5,
      );
    }
    return secret;
  }

  generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  computeDigest(
    userId: string,
    email: string,
    code: string,
    purpose: 'verify_email' | 'reset_password' = 'verify_email',
  ): string {
    const secret = this.getHmacSecret();
    const normalizedEmail = email.toLowerCase().trim();
    const domainPrefix =
      purpose === 'reset_password'
        ? 'auth:v1:otp:reset_password'
        : 'auth:v1:otp';
    return createHmac('sha256', secret)
      .update(`${domainPrefix}:${userId}:${normalizedEmail}:${code}`)
      .digest('hex');
  }

  async storeOtp(
    userId: string,
    email: string,
    otp: string,
    ttlSeconds = 600,
    purpose: 'verify_email' | 'reset_password' = 'verify_email',
  ): Promise<{ expiresInSeconds: number }> {
    const normalizedEmail = email.toLowerCase().trim();
    const challenge =
      purpose === 'reset_password'
        ? await this.abuse.issueChallenge(
            { channel: 'email', identifier: normalizedEmail },
            ttlSeconds,
            'reset_password',
          )
        : await this.abuse.issueChallenge(
            { channel: 'email', identifier: normalizedEmail },
            ttlSeconds,
          );
    const digestHex = this.computeDigest(userId, normalizedEmail, otp, purpose);
    if (purpose === 'reset_password') {
      await this.abuse.setOtpSecret(
        userId,
        digestHex,
        challenge.expiresInSeconds,
        'reset_password',
      );
    } else {
      await this.abuse.setOtpSecret(
        userId,
        digestHex,
        challenge.expiresInSeconds,
      );
    }
    return { expiresInSeconds: challenge.expiresInSeconds };
  }

  async verifyAndConsumeOtp(
    userId: string,
    email: string,
    code: string,
    onValid?: () => Promise<void>,
    purpose: 'verify_email' | 'reset_password' = 'verify_email',
  ): Promise<void> {
    if (!/^\d{6}$/.test(code)) {
      fail(
        422,
        'VERIFICATION_CODE_INVALID',
        'Verification code must contain six digits',
        [
          {
            field: 'code',
            code: 'VALIDATION_FAILED',
            message: 'Enter a six-digit verification code',
          },
        ],
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const secretKey =
      purpose === 'reset_password'
        ? `auth:v1:otp:secret:reset_password:${userId}`
        : `auth:v1:otp:secret:${userId}`;

    try {
      const candidateCallback = async (candidateCode: string) => {
        const storedHex =
          purpose === 'reset_password'
            ? await this.abuse.getOtpSecret(userId, 'reset_password')
            : await this.abuse.getOtpSecret(userId);
        if (!storedHex) {
          fail(
            410,
            'VERIFICATION_CODE_EXPIRED',
            'Verification challenge expired',
          );
        }
        const expectedHex = this.computeDigest(
          userId,
          normalizedEmail,
          candidateCode,
          purpose,
        );
        const expectedBuf = Buffer.from(expectedHex, 'hex');
        const storedBuf = Buffer.from(storedHex, 'hex');
        const matches =
          expectedBuf.length === storedBuf.length &&
          timingSafeEqual(expectedBuf, storedBuf);
        if (matches && onValid) {
          try {
            await onValid();
          } catch (err) {
            if (err instanceof HttpException) throw err;
            fail(
              503,
              'SERVICE_UNAVAILABLE',
              'Verification processing failed',
              [],
              true,
              5,
            );
          }
        }
        return matches;
      };

      if (purpose === 'reset_password') {
        await this.abuse.verifyChallenge(
          { channel: 'email', identifier: normalizedEmail },
          code,
          candidateCallback,
          secretKey,
          'reset_password',
        );
      } else {
        await this.abuse.verifyChallenge(
          { channel: 'email', identifier: normalizedEmail },
          code,
          candidateCallback,
          secretKey,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        const resp = error.getResponse() as any;
        const respCode = resp?.code;
        if (purpose === 'reset_password') {
          if (
            respCode === 'VERIFICATION_CODE_EXPIRED' ||
            respCode === 'OTP_EXPIRED' ||
            respCode === 'ALREADY_VERIFIED'
          ) {
            fail(
              410,
              'VERIFICATION_CODE_EXPIRED',
              'Verification challenge expired',
            );
          }
          if (
            respCode === 'VERIFICATION_CODE_INVALID' ||
            respCode === 'INVALID_OTP'
          ) {
            fail(
              422,
              'VERIFICATION_CODE_INVALID',
              'Verification code is invalid',
            );
          }
          if (
            respCode === 'VERIFICATION_ATTEMPTS_EXCEEDED' ||
            respCode === 'RATE_LIMITED'
          ) {
            fail(
              429,
              'VERIFICATION_ATTEMPTS_EXCEEDED',
              'Verification attempt limit reached',
              [],
              true,
              resp?.retryAfterSeconds ?? 60,
            );
          }
        } else {
          if (
            respCode === 'VERIFICATION_CODE_EXPIRED' ||
            respCode === 'OTP_EXPIRED'
          ) {
            fail(
              410,
              'VERIFICATION_CODE_EXPIRED',
              'Verification challenge expired',
            );
          }
          if (
            respCode === 'VERIFICATION_CODE_INVALID' ||
            respCode === 'INVALID_OTP'
          ) {
            fail(
              422,
              'VERIFICATION_CODE_INVALID',
              'Verification code is invalid',
            );
          }
          if (
            respCode === 'VERIFICATION_ATTEMPTS_EXCEEDED' ||
            respCode === 'RATE_LIMITED'
          ) {
            fail(
              429,
              'VERIFICATION_ATTEMPTS_EXCEEDED',
              'Verification attempt limit reached',
              [],
              true,
              resp?.retryAfterSeconds ?? 60,
            );
          }
          if (respCode === 'ALREADY_VERIFIED') {
            fail(
              409,
              'ALREADY_VERIFIED',
              'Verification challenge already consumed',
            );
          }
        }
      }
      throw error;
    }
  }
}
