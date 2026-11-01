import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { fail } from '../../common/http.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';

export type OtpPurpose = 'verify_email' | 'verify_phone' | 'reset_password';

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
    contact: string,
    code: string,
    purpose: OtpPurpose = 'verify_email',
  ): string {
    const secret = this.getHmacSecret();
    const normalizedContact = contact.toLowerCase().trim();
    const domainPrefix =
      purpose === 'verify_email' ? 'auth:v1:otp' : `auth:v1:otp:${purpose}`;
    return createHmac('sha256', secret)
      .update(`${domainPrefix}:${userId}:${normalizedContact}:${code}`)
      .digest('hex');
  }

  async storeOtp(
    userId: string,
    contact: string,
    otp: string,
    ttlSeconds = 600,
    purpose: OtpPurpose = 'verify_email',
  ): Promise<{ expiresInSeconds: number }> {
    const normalizedContact = contact.toLowerCase().trim();
    const channel = purpose === 'verify_phone' ? 'phone' : 'email';
    const challenge =
      purpose === 'verify_email'
        ? await this.abuse.issueChallenge(
            { channel, identifier: normalizedContact },
            ttlSeconds,
          )
        : await this.abuse.issueChallenge(
            { channel, identifier: normalizedContact },
            ttlSeconds,
            purpose,
          );
    const digestHex = this.computeDigest(
      userId,
      normalizedContact,
      otp,
      purpose,
    );
    if (purpose === 'verify_email') {
      await this.abuse.setOtpSecret(
        userId,
        digestHex,
        challenge.expiresInSeconds,
      );
    } else {
      await this.abuse.setOtpSecret(
        userId,
        digestHex,
        challenge.expiresInSeconds,
        purpose,
      );
    }
    return { expiresInSeconds: challenge.expiresInSeconds };
  }

  async verifyAndConsumeOtp(
    userId: string,
    contact: string,
    code: string,
    onValid?: () => Promise<void>,
    purpose: OtpPurpose = 'verify_email',
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

    const normalizedContact = contact.toLowerCase().trim();
    const channel = purpose === 'verify_phone' ? 'phone' : 'email';
    const secretKey =
      purpose === 'verify_email'
        ? `auth:v1:otp:secret:${userId}`
        : `auth:v1:otp:secret:${purpose}:${userId}`;

    try {
      const candidateCallback = async (candidateCode: string) => {
        const storedHex =
          purpose === 'verify_email'
            ? await this.abuse.getOtpSecret(userId)
            : await this.abuse.getOtpSecret(userId, purpose);
        if (!storedHex) {
          fail(
            410,
            'VERIFICATION_CODE_EXPIRED',
            'Verification challenge expired',
          );
        }
        const expectedHex = this.computeDigest(
          userId,
          normalizedContact,
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

      if (purpose === 'verify_email') {
        await this.abuse.verifyChallenge(
          { channel, identifier: normalizedContact },
          code,
          candidateCallback,
          secretKey,
        );
      } else {
        await this.abuse.verifyChallenge(
          { channel, identifier: normalizedContact },
          code,
          candidateCallback,
          secretKey,
          purpose,
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
