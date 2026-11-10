import {
  Equals,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { fail } from '../../common/http.js';

/**
 * Allowed lifecycle states for an account deletion request (`public.deletion_request_status`).
 */
export type DeletionRequestStatus = 'scheduled' | 'in_progress' | 'completed';

/**
 * Request payload DTO for `POST /api/v1/account/deletion-requests` (`EP-X01`).
 *
 * Requires explicit literal `"DELETE"` confirmation. Optional `password` or `reauth_token`
 * fields are accepted per C05 `AccountDeletionRequestDTO` (live credential re-authentication
 * verification is enforced in M03-02).
 */
export class AccountDeletionRequestDto {
  /** Literal confirmation string; must equal `"DELETE"`. */
  @IsString()
  @Equals('DELETE', { message: 'Confirmation must equal DELETE' })
  confirmation!: string;

  /** Optional account password for password-authenticated accounts. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password?: string;

  /** Optional short-lived re-authentication token for OAuth-only accounts. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  reauth_token?: string;
}

/**
 * Type alias for `AccountDeletionRequestDto` used on controller signatures so service-layer
 * contract status codes (`400 CONFIRMATION_MISMATCH`) are preserved consistently.
 */
export type AccountDeletionRequestInput = Pick<
  AccountDeletionRequestDto,
  'confirmation' | 'password' | 'reauth_token'
>;

/**
 * Canonical C05 response DTO for `EP-X01` (`202 Accepted`) and `EP-X02` (`200 OK`).
 *
 * `deletion_receipt` and `receipt_expires_at` are populated when a deletion request is
 * created (`EP-X01`) and omitted on status queries (`EP-X02`).
 */
export class AccountDeletionStatusDto {
  /** Unique identifier of the `public.account_deletion_requests` row. */
  id!: string;

  /** Current workflow state (`scheduled`, `in_progress`, or `completed`). */
  status!: DeletionRequestStatus;

  /** ISO-8601 timestamp when deletion was requested. */
  requested_at!: string;

  /** ISO-8601 timestamp when local cascade deletion completed, or `null` while pending. */
  completed_at!: string | null;

  /** True only after all applicable external provider deletion requests have been accepted (`R35`). */
  provider_deletion_requested!: boolean;

  /** Signed HMAC-SHA256 `DeletionReceipt` token (`R06`), present on `EP-X01` responses. */
  deletion_receipt?: string;

  /** ISO-8601 expiration timestamp for `deletion_receipt` (`R06`), present on `EP-X01` responses. */
  receipt_expires_at?: string;
}

/**
 * Validates raw input for `EP-X01` (`AccountDeletionRequestDTO`) and returns a normalized DTO.
 * Throws `400 CONFIRMATION_MISMATCH` if `confirmation !== 'DELETE'` or `400 INVALID_FORMAT`
 * if optional fields are malformed or mutually exclusive fields are both supplied.
 *
 * @param input - Raw request body provided by the caller.
 * @returns Validated `AccountDeletionRequestDto` object.
 */
export function validateAccountDeletionRequest(
  input: unknown,
): AccountDeletionRequestDto {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(400, 'INVALID_FORMAT', 'Request body must be a JSON object');
  }
  const record = input as Record<string, unknown>;
  const allowedKeys = new Set(['confirmation', 'password', 'reauth_token']);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      fail(400, 'INVALID_FORMAT', `Unexpected field: ${key}`, [
        {
          field: key,
          code: 'INVALID_FORMAT',
          message: 'Field is not allowed',
        },
      ]);
    }
  }

  if (record.confirmation !== 'DELETE') {
    fail(
      400,
      'CONFIRMATION_MISMATCH',
      'Confirmation must equal literal DELETE',
      [
        {
          field: 'confirmation',
          code: 'CONFIRMATION_MISMATCH',
          message: 'Confirmation must equal DELETE',
        },
      ],
    );
  }

  if (record.password !== undefined && record.reauth_token !== undefined) {
    fail(
      400,
      'INVALID_FORMAT',
      'Provide either password or reauth_token, not both',
    );
  }

  const normalized: AccountDeletionRequestDto = {
    confirmation: 'DELETE',
  };

  if (record.password !== undefined) {
    if (
      typeof record.password !== 'string' ||
      record.password.length === 0 ||
      record.password.length > 128
    ) {
      fail(
        400,
        'INVALID_FORMAT',
        'Password must be a non-empty string up to 128 characters',
        [
          {
            field: 'password',
            code: 'INVALID_FORMAT',
            message: 'Password must be a non-empty string up to 128 characters',
          },
        ],
      );
    }
    normalized.password = record.password;
  }

  if (record.reauth_token !== undefined) {
    if (
      typeof record.reauth_token !== 'string' ||
      record.reauth_token.trim().length === 0 ||
      record.reauth_token.length > 2048
    ) {
      fail(400, 'INVALID_FORMAT', 'reauth_token must be a non-empty string', [
        {
          field: 'reauth_token',
          code: 'INVALID_FORMAT',
          message: 'reauth_token must be a non-empty string',
        },
      ]);
    }
    normalized.reauth_token = record.reauth_token.trim();
  }

  return normalized;
}
