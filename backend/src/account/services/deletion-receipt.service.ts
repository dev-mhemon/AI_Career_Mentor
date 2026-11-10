import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from '../../common/http.js';

/** Default receipt lifetime in seconds (24 hours per C05 R06). */
export const DELETION_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

/** Canonical token type claim for `DeletionReceipt` (`R06`). */
export const DELETION_RECEIPT_TYP = 'deletion_receipt';

/** Canonical audience claim for `DeletionReceipt` (`R06`). */
export const DELETION_RECEIPT_AUD = 'account-deletion-status';

/** Safe fallback secret used only in non-production test/dev environments when unconfigured. */
const TEST_FALLBACK_RECEIPT_SECRET =
  'test-only-deletion-receipt-hmac-secret-minimum-32-bytes';

/** Strict UUID format matcher for `request_id`. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Base64url segment matcher. */
const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Verified claims embedded inside a signed `DeletionReceipt` (`C05 R06`).
 * Contains zero user/contact/name PII so it can safely outlive account deletion.
 */
export interface DeletionReceiptClaims {
  /** Fixed receipt type discriminator. */
  typ: typeof DELETION_RECEIPT_TYP;
  /** Bound `public.account_deletion_requests.id` UUID. */
  request_id: string;
  /** Fixed audience restricting token use to `EP-X02`. */
  aud: typeof DELETION_RECEIPT_AUD;
  /** Issued-at UNIX epoch timestamp in seconds. */
  iat: number;
  /** Expiration UNIX epoch timestamp in seconds (`iat + 86400`). */
  exp: number;
}

/**
 * Output of minting a `DeletionReceipt` token for `EP-X01`.
 */
export interface MintedDeletionReceipt {
  /** Compact signed token `<payloadBase64Url>.<signatureBase64Url>`. */
  receipt: string;
  /** ISO-8601 expiration timestamp (`receipt_expires_at`). */
  expiresAt: string;
  /** Underlying verified claim set. */
  claims: DeletionReceiptClaims;
}

/**
 * Authority responsible for minting and verifying HMAC-SHA256 `DeletionReceipt` tokens (`C05 R06`).
 */
@Injectable()
export class DeletionReceiptService {
  constructor(@Optional() private readonly config?: ConfigService) {}

  /**
   * Resolves the dedicated HMAC-SHA256 signing secret.
   * Fails closed (`503 SERVICE_UNAVAILABLE`) whenever the secret is missing or shorter than 32 bytes
   * outside explicit `test` / `development` environments, while providing a deterministic fallback
   * in `test` and `development` environments.
   */
  private getSigningSecret(): string {
    const configuredSecret =
      this.config?.get<string>('DELETION_RECEIPT_SECRET') ??
      this.config?.get<string>('ACCOUNT_DELETION_RECEIPT_SECRET') ??
      process.env.DELETION_RECEIPT_SECRET ??
      process.env.ACCOUNT_DELETION_RECEIPT_SECRET;

    const nodeEnv = (
      this.config?.get<string>('NODE_ENV') ?? process.env.NODE_ENV
    )?.trim();

    if (
      configuredSecret !== undefined &&
      configuredSecret !== null &&
      String(configuredSecret).trim().length > 0
    ) {
      const secretStr = String(configuredSecret).trim();
      if (Buffer.byteLength(secretStr, 'utf8') < 32) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Deletion receipt signing secret must be at least 32 bytes',
        );
      }
      return secretStr;
    }

    if (nodeEnv !== 'test' && nodeEnv !== 'development') {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Deletion receipt signing secret is not configured',
      );
    }

    return TEST_FALLBACK_RECEIPT_SECRET;
  }

  /**
   * Computes a raw 32-byte HMAC-SHA256 digest over the base64url-encoded payload segment.
   *
   * @param payloadSegment - Base64url-encoded JSON claims segment.
   * @param secret - Server HMAC signing secret.
   * @returns 32-byte Buffer containing the HMAC-SHA256 digest.
   */
  private computeSignature(payloadSegment: string, secret: string): Buffer {
    return createHmac('sha256', secret).update(payloadSegment, 'utf8').digest();
  }

  /**
   * Mints a signed `DeletionReceipt` bound strictly to `requestId` with a 24-hour validity window (`R06`).
   *
   * @param requestId - UUID of the `public.account_deletion_requests` row.
   * @param issuedAt - Optional reference timestamp (defaults to current time).
   * @returns Signed receipt token, ISO-8601 expiry timestamp, and claim object.
   */
  mintReceipt(
    requestId: string,
    issuedAt: Date = new Date(),
  ): MintedDeletionReceipt {
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
      fail(400, 'INVALID_FORMAT', 'Deletion request_id must be a valid UUID');
    }

    const secret = this.getSigningSecret();
    const iat = Math.floor(issuedAt.getTime() / 1000);
    const exp = iat + DELETION_RECEIPT_TTL_SECONDS;

    const claims: DeletionReceiptClaims = {
      typ: DELETION_RECEIPT_TYP,
      request_id: requestId,
      aud: DELETION_RECEIPT_AUD,
      iat,
      exp,
    };

    const payloadSegment = Buffer.from(JSON.stringify(claims), 'utf8').toString(
      'base64url',
    );
    const signatureSegment = this.computeSignature(
      payloadSegment,
      secret,
    ).toString('base64url');

    return {
      receipt: `${payloadSegment}.${signatureSegment}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      claims,
    };
  }

  /**
   * Verifies a `DeletionReceipt` token's HMAC-SHA256 signature (in constant time),
   * structure, `typ`, `aud`, `request_id` UUID format, and `exp` timestamp.
   *
   * Throws `401 INVALID_TOKEN` on malformed tokens, signature mismatch, or invalid claims,
   * and `401 TOKEN_EXPIRED` when `exp <= now`.
   *
   * @param token - Raw `DeletionReceipt` token string.
   * @param now - Optional reference time for expiration check (defaults to current time).
   * @returns Verified `DeletionReceiptClaims`.
   */
  verifyReceipt(token: string, now: Date = new Date()): DeletionReceiptClaims {
    if (typeof token !== 'string' || token.trim().length === 0) {
      fail(401, 'INVALID_TOKEN', 'Deletion receipt token is required');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      fail(401, 'INVALID_TOKEN', 'Malformed deletion receipt token');
    }

    const [payloadSegment, signatureSegment] = parts;
    if (
      !payloadSegment ||
      !signatureSegment ||
      !BASE64URL_SEGMENT_PATTERN.test(payloadSegment) ||
      !BASE64URL_SEGMENT_PATTERN.test(signatureSegment)
    ) {
      fail(401, 'INVALID_TOKEN', 'Malformed deletion receipt encoding');
    }

    const secret = this.getSigningSecret();
    const expectedSignature = this.computeSignature(payloadSegment, secret);
    const actualSignature = Buffer.from(signatureSegment, 'base64url');

    if (
      actualSignature.toString('base64url') !== signatureSegment ||
      actualSignature.byteLength !== expectedSignature.byteLength ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt signature');
    }

    let parsed: unknown;
    try {
      const jsonText = Buffer.from(payloadSegment, 'base64url').toString(
        'utf8',
      );
      parsed = JSON.parse(jsonText);
    } catch {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt payload');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt claims');
    }

    const record = parsed as Record<string, unknown>;
    if (record.typ !== DELETION_RECEIPT_TYP) {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt token type');
    }
    if (record.aud !== DELETION_RECEIPT_AUD) {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt audience');
    }
    if (
      typeof record.request_id !== 'string' ||
      !UUID_PATTERN.test(record.request_id)
    ) {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt request_id');
    }
    if (
      typeof record.iat !== 'number' ||
      !Number.isInteger(record.iat) ||
      record.iat <= 0 ||
      typeof record.exp !== 'number' ||
      !Number.isInteger(record.exp) ||
      record.exp <= record.iat
    ) {
      fail(401, 'INVALID_TOKEN', 'Invalid deletion receipt timestamps');
    }

    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (record.exp <= nowSeconds) {
      fail(401, 'TOKEN_EXPIRED', 'Deletion receipt has expired');
    }

    return {
      typ: DELETION_RECEIPT_TYP,
      request_id: record.request_id,
      aud: DELETION_RECEIPT_AUD,
      iat: record.iat,
      exp: record.exp,
    };
  }
}
