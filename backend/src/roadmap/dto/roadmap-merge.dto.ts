import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import type { CareerLevel } from '../../profile/profile.dto.js';
import {
  hasNulOrUnpairedSurrogate,
  type ItemPriority,
  type PageMetaDTO,
} from './roadmap.dto.js';

export type MergeOrigin = 'user_request' | 'level_change' | 'ai_proposal';
export type UserMergeOrigin = 'user_request' | 'level_change';
export type MergeStatus =
  'proposed' | 'accepted' | 'rejected' | 'undone' | 'superseded';
export type MergeOp =
  'add_topic' | 'update_topic' | 'reprioritize' | 'reclassify' | 'retire_topic';

export const MERGE_ORIGIN_VALUES: readonly MergeOrigin[] = [
  'user_request',
  'level_change',
  'ai_proposal',
];

export const USER_MERGE_ORIGIN_VALUES: readonly UserMergeOrigin[] = [
  'user_request',
  'level_change',
];

export const MERGE_STATUS_VALUES: readonly MergeStatus[] = [
  'proposed',
  'accepted',
  'rejected',
  'undone',
  'superseded',
];

export const MERGE_OP_VALUES: readonly MergeOp[] = [
  'add_topic',
  'update_topic',
  'reprioritize',
  'reclassify',
  'retire_topic',
];

const PG_INT4_MAX = 2_147_483_647;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeOptionalCursor = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * `C05` §14.5 / §15.5 `MergeRequestDTO` (`EP-R08`, `POST /api/v1/roadmaps/:id/merges`).
 *
 * - `origin`: `'user_request' | 'level_change'` (`'ai_proposal'` is system-only and rejected).
 * - `instruction`: 3–1000 Unicode code points (required for `user_request`, optional for `level_change`).
 * - `target_level`: `'junior' | 'mid' | 'senior'` (required for `level_change`).
 * - `base_version_no`: optional optimistic version precondition (checked alongside optional `If-Match`).
 */
export class CreateMergeProposalDTO {
  @Transform(trimLower)
  @IsString()
  @IsIn(['user_request', 'level_change'], {
    message: 'origin must be user_request or level_change',
  })
  origin!: UserMergeOrigin;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimLower)
  @IsString()
  @IsIn(['junior', 'mid', 'senior'])
  target_level?: CareerLevel;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Transform(trim)
  @ValidateBy({
    name: 'wellFormedMergeInstruction',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string' || hasNulOrUnpairedSurrogate(value)) {
          return false;
        }
        const len = Array.from(value).length;
        return len >= 3 && len <= 1_000;
      },
      defaultMessage: () =>
        'instruction must be between 3 and 1000 well-formed Unicode characters',
    },
  })
  instruction?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PG_INT4_MAX)
  base_version_no?: number;
}

/**
 * `C05` §14.5 `EP-R09` query parameters (`status`, `limit`, `cursor`).
 * `status` enum membership is validated in `RoadmapMergeService.listProposals`
 * so invalid filters return `422 INVALID_ENUM_VALUE`.
 */
export class ListMergeProposalsQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trimLower)
  status?: MergeStatus;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Transform(normalizeOptionalCursor)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  cursor?: string;
}

/**
 * `C05` §15.5 `MergeOperationDTO` (`roadmap_merge_items`).
 */
export interface MergeOperationDTO {
  id: string;
  sort_order: number;
  op: MergeOp;
  item_id: string | null;
  lineage_id: string | null;
  topic_id: string | null;
  skill_id: string | null;
  title: string | null;
  priority: ItemPriority | null;
  reason: string | null;
  payload: Record<string, unknown>;
}

/**
 * Soft size guardrail impact (`PRD` §20, `C05` §15.5).
 * Exposes canonical C05 fields (`active_topics_before`, `active_topics_after`, `materially_large`, `warning`)
 * alongside explicit delta/limit fields (`before`, `after`, `delta`, `soft_limit`).
 */
export interface MergeSizeImpactDTO {
  active_topics_before: number;
  active_topics_after: number;
  before: number;
  after: number;
  delta: number;
  soft_limit: number;
  materially_large: boolean;
  warning: string | null;
}

/**
 * Daily Plan reconciliation impact summary (`PRD` §21, `C05` §15.5).
 */
export interface MergeDailyPlanImpactDTO {
  has_active_plan: boolean;
  completed_days_unchanged: number;
  future_days_affected: number;
}

/**
 * `C05` §14.5 `MergeProposalSummaryDTO` returned by `EP-R09`.
 */
export interface MergeSummaryDTO {
  id: string;
  roadmap_id: string;
  origin: MergeOrigin;
  status: MergeStatus;
  base_version_no: number;
  target_level: CareerLevel | null;
  reason: string | null;
  materially_large: boolean;
  undo_available: boolean;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  undone_at: string | null;
}

export interface PaginatedMergeListDTO {
  items: MergeSummaryDTO[];
  meta: PageMetaDTO;
}

/**
 * `C05` §15.5 `MergeProposalDTO` returned by `EP-R10`.
 */
export interface MergeProposalDTO {
  id: string;
  roadmap_id: string;
  origin: MergeOrigin;
  status: MergeStatus;
  base_version_id: string;
  base_version_no: number;
  result_version_id: string | null;
  target_level: CareerLevel | null;
  instruction: string | null;
  reason: string | null;
  operations: MergeOperationDTO[];
  size_impact: MergeSizeImpactDTO;
  daily_plan_impact: MergeDailyPlanImpactDTO;
  undo_available: boolean;
  created_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  undone_at: string | null;
  undo_window_closed_at: string | null;
}

/**
 * `C05` §15.5 `MergeAcceptDTO` (`EP-R11`). A version precondition is required here
 * (`base_version_no` and/or `If-Match`).
 */
export class AcceptMergeProposalDTO {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PG_INT4_MAX)
  base_version_no?: number;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsBoolean()
  acknowledge_large_expansion?: boolean;
}

/**
 * `C05` §14.5 `EP-R11` response payload.
 */
export interface MergeAcceptResponseDTO {
  roadmap_id: string;
  merge_id: string;
  new_version_no: number;
  undo_available: true;
  daily_plan_reconciled: boolean;
}

/**
 * `C05` §14.5 `EP-R13` response payload.
 */
export interface MergeUndoResponseDTO {
  restored_version_no: number;
  merge_id: string;
  status: 'undone';
}

/**
 * `C05` §14.5 `EP-R12` response payload.
 */
export interface MergeRejectResponseDTO {
  merge_id: string;
  status: 'rejected';
  rejected_at: string;
}

/**
 * `C05` §13.6 / §14.5 `EP-R08` `202 Accepted` job handle (new or reused active job).
 */
export interface MergeJobAcceptedDTO {
  job_id: string;
  kind: 'merge_proposal';
  status: 'queued' | 'preparing';
  poll_url: string;
  retry_after_seconds: number;
}
