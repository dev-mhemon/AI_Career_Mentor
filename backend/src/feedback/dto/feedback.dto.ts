import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { fail } from '../../common/http.js';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical `public.rating_target` enum values (`020_gaps_and_alignment.sql`, `C05` §14.12 / §15.11 / `R34`). */
export type RatingTarget =
  'roadmap_draft' | 'roadmap_merge' | 'topic_content' | 'technology_update';

export const RATING_TARGET_VALUES: readonly RatingTarget[] = [
  'roadmap_draft',
  'roadmap_merge',
  'topic_content',
  'technology_update',
];

/**
 * Known non-ratable domain target identifiers (`C05` §14.12 / §16.3 / §17, `PRD` §24, `R34`).
 * Submitting any of these to `EP-F01` (`POST /api/v1/ratings`) MUST fail with `422 TARGET_NOT_RATABLE`
 * rather than generic `VALIDATION_FAILED`.
 */
export const NON_RATABLE_DOMAIN_TARGETS = [
  'quiz_question',
  'practice_review',
  'roadmap_content',
  'mentor',
  'mentor_reply',
  'mentor_message',
  'conversation',
] as const;

/** Canonical `public.report_target` enum values (`020_gaps_and_alignment.sql`, `C05` §14.12 / §15.11 / `R34`). */
export type ReportTarget =
  'quiz_question' | 'practice_review' | 'topic_content' | 'roadmap_content';

export const REPORT_TARGET_VALUES: readonly ReportTarget[] = [
  'quiz_question',
  'practice_review',
  'topic_content',
  'roadmap_content',
];

/** Canonical `public.report_reason` enum values (`020_gaps_and_alignment.sql`, `C05` §14.12 / §15.11). */
export type ReportReason =
  | 'incorrect'
  | 'unclear'
  | 'unfair_scoring'
  | 'inappropriate'
  | 'outdated'
  | 'other';

export const REPORT_REASON_VALUES: readonly ReportReason[] = [
  'incorrect',
  'unclear',
  'unfair_scoring',
  'inappropriate',
  'outdated',
  'other',
];

export const MAX_RATING_COMMENT_CODEPOINTS = 500;
export const MAX_REPORT_COMMENT_CODEPOINTS = 1_000;

const trimLowerIfString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trimIfString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Checks whether a string contains NUL bytes (`\u0000`) or unpaired UTF-16 surrogate code units.
 */
export function hasNulOrUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) {
        return true;
      }
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Validates and normalizes an optional feedback `comment` (`<= 500` Unicode code points for ratings,
 * `<= 1000` for reports). Rejects explicit `null`/non-strings, NUL bytes, and unpaired surrogates;
 * normalizes omitted or whitespace-only strings to `null` for DB persistence.
 */
export function normalizeFeedbackComment(
  raw: unknown,
  maxCodePoints: number,
  field = 'comment',
): string | null {
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string') {
    fail(422, 'VALIDATION_FAILED', `${field} must be a string`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must be a string`,
      },
    ]);
  }
  if (hasNulOrUnpairedSurrogate(raw)) {
    fail(
      422,
      'VALIDATION_FAILED',
      `${field} contains invalid Unicode characters`,
      [
        {
          field,
          code: 'VALIDATION_FAILED',
          message: `${field} contains invalid Unicode characters`,
        },
      ],
    );
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (Array.from(trimmed).length > maxCodePoints) {
    fail(
      422,
      'VALIDATION_FAILED',
      `${field} must be at most ${maxCodePoints} characters`,
      [
        {
          field,
          code: 'VALIDATION_FAILED',
          message: `${field} must be at most ${maxCodePoints} characters`,
        },
      ],
    );
  }
  return trimmed;
}

/**
 * Validates `EP-F01` `target_type` (`C05` §14.12 / §16.3 / §17):
 * - Known non-ratable domain targets -> `422 TARGET_NOT_RATABLE`
 * - Unknown strings -> `422 VALIDATION_FAILED` (`INVALID_ENUM_VALUE` detail)
 */
export function validateRatingTargetType(raw: unknown): RatingTarget {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    fail(422, 'VALIDATION_FAILED', 'Invalid request', [
      {
        field: 'target_type',
        code: 'VALIDATION_FAILED',
        message: 'Field has an invalid value',
      },
    ]);
  }
  const normalized = raw.trim().toLowerCase();
  if ((NON_RATABLE_DOMAIN_TARGETS as readonly string[]).includes(normalized)) {
    fail(
      422,
      'TARGET_NOT_RATABLE',
      'Target type is not ratable; use Report instead where applicable',
      [
        {
          field: 'target_type',
          code: 'TARGET_NOT_RATABLE',
          message: 'Target type not ratable',
        },
      ],
    );
  }
  if ((RATING_TARGET_VALUES as readonly string[]).includes(normalized)) {
    return normalized as RatingTarget;
  }
  fail(422, 'VALIDATION_FAILED', 'Invalid request', [
    {
      field: 'target_type',
      code: 'INVALID_ENUM_VALUE',
      message: 'Field has an invalid value',
    },
  ]);
}

/**
 * Validates `EP-F02` `target_type` (`C05` §14.12 / §15.11).
 */
export function validateReportTargetType(raw: unknown): ReportTarget {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    fail(422, 'VALIDATION_FAILED', 'Invalid request', [
      {
        field: 'target_type',
        code: 'VALIDATION_FAILED',
        message: 'Field has an invalid value',
      },
    ]);
  }
  const normalized = raw.trim().toLowerCase();
  if ((REPORT_TARGET_VALUES as readonly string[]).includes(normalized)) {
    return normalized as ReportTarget;
  }
  fail(422, 'VALIDATION_FAILED', 'Invalid request', [
    {
      field: 'target_type',
      code: 'INVALID_ENUM_VALUE',
      message: 'Field has an invalid value',
    },
  ]);
}

/**
 * Validates `EP-F02` `reason` (`C05` §14.12 / §15.11).
 */
export function validateReportReason(raw: unknown): ReportReason {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    fail(422, 'VALIDATION_FAILED', 'Invalid request', [
      {
        field: 'reason',
        code: 'VALIDATION_FAILED',
        message: 'Field has an invalid value',
      },
    ]);
  }
  const normalized = raw.trim().toLowerCase();
  if ((REPORT_REASON_VALUES as readonly string[]).includes(normalized)) {
    return normalized as ReportReason;
  }
  fail(422, 'VALIDATION_FAILED', 'Invalid request', [
    {
      field: 'reason',
      code: 'INVALID_ENUM_VALUE',
      message: 'Field has an invalid value',
    },
  ]);
}

/**
 * `C05` §14.12 / §15.11 `RatingRequestDTO` (`EP-F01` `POST /api/v1/ratings`).
 *
 * Note: `target_type` enum membership is evaluated in `validateRatingTargetType` so known
 * non-ratable domain targets emit `422 TARGET_NOT_RATABLE` (`C05` §14.12 / §17).
 */
export class RatingRequestDTO {
  @Transform(trimLowerIfString)
  @IsString()
  @IsNotEmpty()
  target_type!: string;

  @Transform(trimLowerIfString)
  @IsString()
  @Matches(UUID_PATTERN)
  target_id!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(trimIfString)
  @IsString()
  @ValidateBy({
    name: 'validRatingComment',
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' &&
        !hasNulOrUnpairedSurrogate(value) &&
        Array.from(value).length <= MAX_RATING_COMMENT_CODEPOINTS,
    },
  })
  comment?: string;
}

/**
 * `C05` §14.12 / §15.11 `ReportRequestDTO` (`EP-F02` `POST /api/v1/reports`).
 */
export class ReportRequestDTO {
  @Transform(trimLowerIfString)
  @IsString()
  @IsIn(REPORT_TARGET_VALUES)
  target_type!: ReportTarget;

  @Transform(trimLowerIfString)
  @IsString()
  @Matches(UUID_PATTERN)
  target_id!: string;

  @Transform(trimLowerIfString)
  @IsString()
  @IsIn(REPORT_REASON_VALUES)
  reason!: ReportReason;

  @ValidateIf((_obj, value) => value !== undefined)
  @Transform(trimIfString)
  @IsString()
  @ValidateBy({
    name: 'validReportComment',
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' &&
        !hasNulOrUnpairedSurrogate(value) &&
        Array.from(value).length <= MAX_REPORT_COMMENT_CODEPOINTS,
    },
  })
  comment?: string;
}

/** `C05` §14.12 `EP-F01` response payload (`200 OK`). */
export interface RatingResponseDTO {
  target_type: RatingTarget;
  target_id: string;
  score: number;
}

/** `C05` §14.12 `EP-F02` response payload (`201 Created`). */
export interface ReportResponseDTO {
  report_id: string;
  status: 'received';
}
