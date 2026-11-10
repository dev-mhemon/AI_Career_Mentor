import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DELETION_RECEIPT_AUD,
  DELETION_RECEIPT_TTL_SECONDS,
  DELETION_RECEIPT_TYP,
  DeletionReceiptService,
} from './deletion-receipt.service.js';

const TEST_REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SECRET = 'unit-test-deletion-receipt-hmac-secret-32-bytes!!';

/**
 * Helper to sign an arbitrary JSON payload object with `secret` using the compact
 * `<payloadBase64Url>.<signatureBase64Url>` wire format.
 */
function signRawPayload(payload: unknown, secret = TEST_SECRET): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  const sigSegment = createHmac('sha256', secret)
    .update(payloadSegment, 'utf8')
    .digest('base64url');
  return `${payloadSegment}.${sigSegment}`;
}

describe('DeletionReceiptService (C05 R06)', () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let configService: ConfigService;
  let service: DeletionReceiptService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn((key: string) => {
      if (key === 'DELETION_RECEIPT_SECRET') return TEST_SECRET;
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    });
    configService = {
      get: mockGet,
    } as unknown as ConfigService;
    service = new DeletionReceiptService(configService);
  });

  it('mints and verifies a valid DeletionReceipt with 24h expiry and zero PII claims', () => {
    const issuedAt = new Date('2026-11-10T06:00:00.000Z');
    const minted = service.mintReceipt(TEST_REQUEST_ID, issuedAt);

    expect(minted.expiresAt).toBe('2026-11-11T06:00:00.000Z');
    expect(minted.claims).toEqual({
      typ: DELETION_RECEIPT_TYP,
      request_id: TEST_REQUEST_ID,
      aud: DELETION_RECEIPT_AUD,
      iat: Math.floor(issuedAt.getTime() / 1000),
      exp: Math.floor(issuedAt.getTime() / 1000) + DELETION_RECEIPT_TTL_SECONDS,
    });

    const verified = service.verifyReceipt(
      minted.receipt,
      new Date('2026-11-10T12:00:00.000Z'),
    );
    expect(verified).toEqual(minted.claims);
  });

  it('rejects a receipt when the signature is tampered with same byte length', () => {
    const issuedAt = new Date('2026-11-10T06:00:00.000Z');
    const { receipt } = service.mintReceipt(TEST_REQUEST_ID, issuedAt);
    const [payloadPart, sigPart] = receipt.split('.');
    const sigBytes = Buffer.from(sigPart, 'base64url');
    sigBytes[0] ^= 0xff;
    const tamperedReceipt = `${payloadPart}.${sigBytes.toString('base64url')}`;

    expect(() => service.verifyReceipt(tamperedReceipt, issuedAt)).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      }),
    );
  });

  it('rejects a receipt when the signature has a wrong byte length without throwing RangeError', () => {
    const issuedAt = new Date('2026-11-10T06:00:00.000Z');
    const { receipt } = service.mintReceipt(TEST_REQUEST_ID, issuedAt);
    const [payloadPart] = receipt.split('.');
    const shortSig = Buffer.from('short-sig', 'utf8').toString('base64url');
    const wrongLengthReceipt = `${payloadPart}.${shortSig}`;

    expect(() =>
      service.verifyReceipt(wrongLengthReceipt, issuedAt),
    ).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      }),
    );
  });

  it('rejects an expired receipt with 401 TOKEN_EXPIRED', () => {
    const issuedAt = new Date('2026-11-10T06:00:00.000Z');
    const { receipt } = service.mintReceipt(TEST_REQUEST_ID, issuedAt);
    const afterExpiry = new Date('2026-11-11T06:00:01.000Z');

    expect(() => service.verifyReceipt(receipt, afterExpiry)).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'TOKEN_EXPIRED' }),
      }),
    );
  });

  it('rejects a signed token with wrong typ claim', () => {
    const nowSec = 1794290400;
    const badTypToken = signRawPayload({
      typ: 'access_token',
      request_id: TEST_REQUEST_ID,
      aud: DELETION_RECEIPT_AUD,
      iat: nowSec,
      exp: nowSec + 3600,
    });

    expect(() =>
      service.verifyReceipt(badTypToken, new Date(nowSec * 1000)),
    ).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      }),
    );
  });

  it('rejects a signed token with wrong aud claim', () => {
    const nowSec = 1794290400;
    const badAudToken = signRawPayload({
      typ: DELETION_RECEIPT_TYP,
      request_id: TEST_REQUEST_ID,
      aud: 'wrong-audience',
      iat: nowSec,
      exp: nowSec + 3600,
    });

    expect(() =>
      service.verifyReceipt(badAudToken, new Date(nowSec * 1000)),
    ).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      }),
    );
  });

  it('rejects a signed token with missing or non-UUID request_id', () => {
    const nowSec = 1794290400;
    const missingReqIdToken = signRawPayload({
      typ: DELETION_RECEIPT_TYP,
      aud: DELETION_RECEIPT_AUD,
      iat: nowSec,
      exp: nowSec + 3600,
    });
    const invalidUuidToken = signRawPayload({
      typ: DELETION_RECEIPT_TYP,
      request_id: 'not-a-uuid',
      aud: DELETION_RECEIPT_AUD,
      iat: nowSec,
      exp: nowSec + 3600,
    });

    expect(() =>
      service.verifyReceipt(missingReqIdToken, new Date(nowSec * 1000)),
    ).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      }),
    );
    expect(() =>
      service.verifyReceipt(invalidUuidToken, new Date(nowSec * 1000)),
    ).toThrowError(
      expect.objectContaining({
        status: 401,
        response: expect.objectContaining({ code: 'INVALID_TOKEN' }),
      }),
    );
  });

  it('rejects minting when requestId is not a valid UUID', () => {
    expect(() => service.mintReceipt('invalid-uuid')).toThrowError(
      expect.objectContaining({
        status: 400,
        response: expect.objectContaining({ code: 'INVALID_FORMAT' }),
      }),
    );
  });

  it('fails closed when DELETION_RECEIPT_SECRET is missing or too short and NODE_ENV is undefined, staging, or production', () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedSecret = process.env.DELETION_RECEIPT_SECRET;
    const savedAltSecret = process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
    const issuedAt = new Date('2026-11-10T06:00:00.000Z');
    const validToken = service.mintReceipt(TEST_REQUEST_ID, issuedAt).receipt;

    try {
      delete process.env.DELETION_RECEIPT_SECRET;
      delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;

      for (const envValue of [undefined, 'staging', 'production']) {
        if (envValue === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = envValue;
        }
        mockGet.mockImplementation((key: string) => {
          if (key === 'NODE_ENV') return envValue;
          return undefined;
        });

        expect(() =>
          service.mintReceipt(TEST_REQUEST_ID, issuedAt),
        ).toThrowError(
          expect.objectContaining({
            status: 503,
            response: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
          }),
        );

        expect(() => service.verifyReceipt(validToken, issuedAt)).toThrowError(
          expect.objectContaining({
            status: 503,
            response: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
          }),
        );
      }

      mockGet.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'DELETION_RECEIPT_SECRET') return 'short-secret';
        return undefined;
      });

      expect(() => service.mintReceipt(TEST_REQUEST_ID, issuedAt)).toThrowError(
        expect.objectContaining({
          status: 503,
          response: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
        }),
      );
    } finally {
      if (savedNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = savedNodeEnv;
      }
      if (savedSecret === undefined) {
        delete process.env.DELETION_RECEIPT_SECRET;
      } else {
        process.env.DELETION_RECEIPT_SECRET = savedSecret;
      }
      if (savedAltSecret === undefined) {
        delete process.env.ACCOUNT_DELETION_RECEIPT_SECRET;
      } else {
        process.env.ACCOUNT_DELETION_RECEIPT_SECRET = savedAltSecret;
      }
    }
  });

  it('uses safe test fallback secret when unconfigured in test or development environments', () => {
    const fallbackService = new DeletionReceiptService();
    const issuedAt = new Date('2026-11-10T06:00:00.000Z');
    const minted = fallbackService.mintReceipt(TEST_REQUEST_ID, issuedAt);
    const verified = fallbackService.verifyReceipt(minted.receipt, issuedAt);
    expect(verified.request_id).toBe(TEST_REQUEST_ID);
  });
});
