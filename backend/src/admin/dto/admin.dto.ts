import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { features, type Feature } from '../../auth/policy.js';
import { fail } from '../../common/http.js';

export type UserStatus = 'active' | 'suspended';
export type UsageGroupBy = 'day' | 'feature' | 'provider';

export const USER_STATUS_VALUES: readonly UserStatus[] = [
  'active',
  'suspended',
] as const;

export const USAGE_GROUP_BY_VALUES: readonly UsageGroupBy[] = [
  'day',
  'feature',
  'provider',
] as const;

export const ADMIN_FEATURE_KEYS: readonly Feature[] = [...features];

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ISO_UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ADMIN_REASON_MIN_CODE_POINTS = 3;
export const ADMIN_REASON_MAX_CODE_POINTS = 300;

/**
 * Returns true if the input contains a NUL byte (`\u0000`) or an unpaired UTF-16 surrogate.
 */
export function hasNulOrUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Counts Unicode scalar values (code points) rather than UTF-16 code units. */
export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Validates and trims a mandatory admin status-change reason (`3..300` Unicode code points,
 * rejecting NUL bytes and unpaired UTF-16 surrogates per C05 §14.14 / §15.11).
 */
export function assertValidAdminReason(reason: unknown): string {
  if (typeof reason !== 'string' || hasNulOrUnpairedSurrogate(reason)) {
    fail(422, 'VALIDATION_FAILED', 'Invalid suspension/reactivation reason', [
      {
        field: 'reason',
        code: 'VALIDATION_FAILED',
        message: 'reason must be a valid string between 3 and 300 characters',
      },
    ]);
  }
  const trimmed = reason.trim();
  const len = unicodeCodePointLength(trimmed);
  if (
    len < ADMIN_REASON_MIN_CODE_POINTS ||
    len > ADMIN_REASON_MAX_CODE_POINTS
  ) {
    fail(422, 'VALIDATION_FAILED', 'Invalid suspension/reactivation reason', [
      {
        field: 'reason',
        code: 'VALIDATION_FAILED',
        message: 'reason must be between 3 and 300 characters',
      },
    ]);
  }
  return trimmed;
}

/**
 * Validates that `featureKey` belongs to the canonical 7-item `public.feature_key` enum.
 * Explicitly fails with `422 UNKNOWN_FEATURE` per C05 §14.14 (`EP-AD05`, `EP-AD06`).
 */
export function assertKnownFeatureKey(featureKey: unknown): Feature {
  if (typeof featureKey !== 'string' || hasNulOrUnpairedSurrogate(featureKey)) {
    fail(422, 'UNKNOWN_FEATURE', 'Unknown feature_key', [
      {
        field: 'feature_key',
        code: 'UNKNOWN_FEATURE',
        message: 'feature_key must be a supported feature key',
      },
    ]);
  }
  const normalized = featureKey.trim();
  if (!(ADMIN_FEATURE_KEYS as readonly string[]).includes(normalized)) {
    fail(422, 'UNKNOWN_FEATURE', `Unknown feature_key: ${normalized}`, [
      {
        field: 'feature_key',
        code: 'UNKNOWN_FEATURE',
        message: 'feature_key must be one of the 7 supported feature keys',
      },
    ]);
  }
  return normalized as Feature;
}

/**
 * Parses a positive base-10 integer query param without coercing decimals or non-numeric garbage.
 */
function parseStrictQueryInt({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return value;
}

function trimOptionalString({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

@ValidatorConstraint({ name: 'adminReason', async: false })
class AdminReasonConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || hasNulOrUnpairedSurrogate(value)) {
      return false;
    }
    const len = unicodeCodePointLength(value.trim());
    return (
      len >= ADMIN_REASON_MIN_CODE_POINTS && len <= ADMIN_REASON_MAX_CODE_POINTS
    );
  }

  defaultMessage(): string {
    return 'reason must be between 3 and 300 valid Unicode characters';
  }
}

@ValidatorConstraint({ name: 'safeString', async: false })
class SafeStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return !hasNulOrUnpairedSurrogate(value) && value.length <= 255;
  }

  defaultMessage(): string {
    return 'Field must be a valid string of at most 255 characters';
  }
}

/**
 * `EP-AD01` query parameters (`GET /api/v1/admin/users`).
 */
export class AdminListUsersQueryDTO {
  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  @Validate(SafeStringConstraint)
  q?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsIn(USER_STATUS_VALUES)
  status?: UserStatus;

  @IsOptional()
  @Transform(parseStrictQueryInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  cursor?: string;
}

/**
 * `EP-AD03` request body (`PATCH /api/v1/admin/users/{id}`).
 */
export class AdminUserStatusDTO {
  @IsIn(USER_STATUS_VALUES)
  status!: UserStatus;

  @IsString()
  @Validate(AdminReasonConstraint)
  reason!: string;
}

/**
 * `EP-AD05` request body (`PATCH /api/v1/admin/features`).
 * `feature_key` is validated as a string here so unknown keys reach `FeatureControlService`
 * and explicitly return `422 UNKNOWN_FEATURE` instead of generic `VALIDATION_FAILED`.
 */
export class FeatureToggleDTO {
  @IsString()
  feature_key!: string;

  @IsBoolean()
  enabled!: boolean;
}

/**
 * `EP-AD06` request body (`PATCH /api/v1/admin/users/{id}/features`).
 * `enabled` is required and accepts `true`, `false`, or `null` (clear override / inherit).
 */
export class UserFeatureToggleDTO {
  @IsString()
  feature_key!: string;

  @ValidateIf((_obj: UserFeatureToggleDTO, value: unknown) => value !== null)
  @IsBoolean()
  enabled!: boolean | null;
}

/**
 * `EP-AD07` query parameters (`GET /api/v1/admin/audit-logs`).
 */
export class AdminAuditLogQueryDTO {
  @IsOptional()
  @Transform(trimOptionalString)
  @IsUUID()
  actor_id?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsUUID()
  target_user_id?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  @Validate(SafeStringConstraint)
  action?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  from?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  to?: string;

  @IsOptional()
  @Transform(parseStrictQueryInt)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  cursor?: string;
}

/**
 * `EP-AD08` query parameters (`GET /api/v1/admin/usage`).
 */
export class AdminUsageQueryDTO {
  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  from?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsString()
  to?: string;

  @IsOptional()
  @Transform(trimOptionalString)
  @IsIn(USAGE_GROUP_BY_VALUES)
  group_by?: UsageGroupBy;
}

export interface PageMetaDTO {
  limit: number;
  next_cursor: string | null;
}

export interface AdminUserSummaryDTO {
  id: string;
  email: string | null;
  phone: string | null;
  contact_masked: string;
  status: UserStatus;
  created_at: string;
  last_active_at: string | null;
  roadmap_count: number;
  technology_update_enabled: boolean;
}

export interface AdminUserFeatureAccessDTO {
  feature_key: Feature;
  global_enabled: boolean;
  user_override: boolean | null;
  effective: boolean;
}

export interface AdminUserAggregateCountsDTO {
  roadmaps: number;
  quizzes_submitted: number;
  mentor_messages: number;
  ai_requests: number;
}

export interface AdminUserDetailDTO extends AdminUserSummaryDTO {
  feature_access: AdminUserFeatureAccessDTO[];
  counts: AdminUserAggregateCountsDTO;
}

export interface FeatureControlDTO {
  feature_key: Feature;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface AuditLogDTO {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

export interface UsageBucketDTO {
  key: string;
  requests: number;
  estimated_cost_usd: number;
  failures: number | null;
  fallbacks_used: number | null;
  input_units: number | null;
  output_units: number | null;
}

export interface UsageByDayDTO {
  day: string;
  requests: number;
  failures: number;
  fallbacks_used: number;
  input_units: number;
  output_units: number;
  estimated_cost_usd: number;
}

export interface UsageByFeatureDTO {
  feature_key: string;
  requests: number;
  estimated_cost_usd: number;
}

export interface UsageByProviderDTO {
  provider_id: string;
  requests: number;
  estimated_cost_usd: number;
}

export interface UsageSummaryDTO {
  range: {
    from: string;
    to: string;
  };
  series: {
    group_by: UsageGroupBy;
    buckets: UsageBucketDTO[];
  };
  users: {
    total: number;
    active_last_7_days: number;
  };
  counts: {
    roadmaps_locked: number;
    quizzes_submitted: number;
    mentor_messages: number;
    technology_updates_generated: number;
  };
  ai: {
    requests: number;
    failures: number;
    fallbacks_used: number;
    usage_units: {
      input: number;
      output: number;
    };
    estimated_cost_usd: number;
    by_day: UsageByDayDTO[];
    by_feature: UsageByFeatureDTO[];
    by_provider: UsageByProviderDTO[];
  };
}

export interface AdminMutationAuditContext {
  requestId: string | null;
  ipAddress: string | null;
}
