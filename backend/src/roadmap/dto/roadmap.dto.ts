import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import type { CareerLevel } from '../../profile/profile.dto.js';

export type RoadmapStatus = 'draft' | 'locked' | 'archived';

export const ROADMAP_STATUS_VALUES: readonly RoadmapStatus[] = [
  'draft',
  'locked',
  'archived',
];

export type RoadmapVersionState =
  'draft' | 'locked' | 'superseded' | 'restored';

export type RoadmapVersionOrigin = 'user_request' | 'ai' | 'merge' | 'undo';

export type ItemPriority = 'core' | 'supporting' | 'optional';

export type SkillGapType =
  'existing' | 'transferable' | 'refresh' | 'strengthen' | 'missing';

export const ITEM_PRIORITY_VALUES: readonly ItemPriority[] = [
  'core',
  'supporting',
  'optional',
];

export const SKILL_GAP_TYPE_VALUES: readonly SkillGapType[] = [
  'existing',
  'transferable',
  'refresh',
  'strengthen',
  'missing',
];

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
 * `C05` §15.5 `GenerateRoadmapRequestDTO` (`EP-R01`).
 */
export class GenerateRoadmapRequestDTO {
  @Transform(trimLower)
  @IsUUID()
  career_goal_id!: string;

  @Transform(trimLower)
  @IsString()
  @IsIn(['junior', 'mid', 'senior'])
  target_level!: CareerLevel;

  @IsBoolean()
  @Equals(true, { message: 'level_confirmed must be true' })
  level_confirmed!: boolean;
}

/**
 * `C05` §14.5 `EP-R02` query parameters (`status`, `limit`, `cursor`).
 * `status` enum membership is validated in `RoadmapService.listRoadmaps` so `INVALID_ENUM_VALUE` is emitted cleanly.
 */
export class ListRoadmapsQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  status?: RoadmapStatus;

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
 * `C05` §14.5 `EP-R03` query parameters (`version`: `current` | `draft` | `<int>`).
 */
export class GetRoadmapQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @MaxLength(32)
  version?: string;
}

/**
 * `C05` §15.5 `RevisionRequestDTO` (`EP-R04`).
 * Validates `instruction` (`1..2000` Unicode code points, no NUL/unpaired surrogates) and/or `refresh_stale`.
 */
export class RevisionRequestDTO {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Transform(trim)
  @ValidateBy({
    name: 'wellFormedRevisionInstruction',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string' || hasNulOrUnpairedSurrogate(value)) {
          return false;
        }
        const len = Array.from(value).length;
        return len >= 1 && len <= 2_000;
      },
    },
  })
  instruction?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsBoolean()
  refresh_stale?: boolean;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version_no?: number;
}

/**
 * `C05` §15.5 `LockRoadmapDTO` (`EP-R05`).
 */
export class LockRoadmapDTO {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  expected_version_no?: number;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  version_no?: number;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsBoolean()
  confirm_large_roadmap?: boolean;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsBoolean()
  acknowledge_stale?: boolean;
}

/**
 * `C05` §14.5 `EP-R06` query parameters (`limit`, `cursor`).
 */
export class ListRoadmapVersionsQueryDTO {
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
 * Optional payload for `EP-R15` (`POST /api/v1/roadmaps/:id/archive`).
 */
export class ArchiveRoadmapDTO {
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @Transform(trim)
  @ValidateBy({
    name: 'wellFormedArchiveReason',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        !hasNulOrUnpairedSurrogate(value) &&
        Array.from(value).length <= 500,
    },
  })
  reason?: string;
}

/**
 * `C05` §15.1 `PageMetaDTO`.
 */
export interface PageMetaDTO {
  limit: number;
  next_cursor: string | null;
}

export interface RoadmapSourceRefDTO {
  publisher: string;
  url: string;
  retrieved_at?: string;
}

export interface RoadmapMilestoneDTO {
  id: string;
  title: string;
}

export interface RoadmapItemDTO {
  id: string;
  item_id: string;
  lineage_id: string;
  topic_id: string;
  skill_id: string;
  phase_no: number;
  phase_title: string | null;
  title: string;
  priority: ItemPriority;
  gap_type: SkillGapType;
  required_depth: string | null;
  estimated_effort_hours: number | null;
  sequence_no: number;
  depends_on: string[];
  depends_on_lineage_ids: string[];
  reason: string | null;
  retired: boolean;
  sources: RoadmapSourceRefDTO[];
}

export interface RoadmapPhaseDTO {
  phase_no: number;
  title: string;
  milestones: RoadmapMilestoneDTO[];
  items: RoadmapItemDTO[];
}

export interface RoadmapSummaryBlockDTO {
  current_situation: string;
  target_interpretation: string;
  expected_career_impact: string;
  next_steps: string[];
}

export interface LevelOutlineDTO {
  career_level: CareerLevel;
  outline: string[];
}

export interface RoadmapSizeGuardrailDTO {
  active_topic_count: number;
  soft_max_topics: number;
  materially_large: boolean;
  warning: string | null;
}

/**
 * `C05` §15.5 `RoadmapSummaryDTO` returned by `EP-R02`.
 */
export interface RoadmapSummaryDTO {
  id: string;
  career_goal_id: string;
  canonical_role_id: string;
  role_name: string;
  target_level: CareerLevel;
  status: RoadmapStatus;
  is_focus: boolean;
  current_version_id: string | null;
  current_version_no: number | null;
  draft_version_no: number | null;
  has_open_draft: boolean;
  has_open_merge: boolean;
  has_daily_plan: boolean;
  stale: boolean;
  stale_draft: boolean;
  locked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadmapListResponseDTO {
  items: RoadmapSummaryDTO[];
  meta: PageMetaDTO;
}

/**
 * `C05` §15.5 `RoadmapResponseDTO` / `RoadmapDetailDTO` returned by `EP-R03` and `EP-R07`.
 */
export interface RoadmapDetailDTO {
  id: string;
  career_goal_id: string;
  canonical_role_id: string;
  role_name: string;
  target_level: CareerLevel;
  status: RoadmapStatus;
  is_focus: boolean;
  version_id: string;
  version_no: number;
  version_state: RoadmapVersionState;
  summary: RoadmapSummaryBlockDTO;
  phases: RoadmapPhaseDTO[];
  items: RoadmapItemDTO[];
  level_outline: LevelOutlineDTO[];
  size_guardrail: RoadmapSizeGuardrailDTO;
  warnings: string[];
  stale: boolean;
  stale_reason: string | null;
  locked_at: string | null;
  created_at: string;
}

export type RoadmapResponseDTO = RoadmapDetailDTO;

/**
 * `C05` §14.5 `EP-R05` response payload.
 */
export interface LockRoadmapResponseDTO {
  roadmap_id: string;
  status: 'locked';
  version_no: number;
  current_version_id: string;
  is_focus: boolean;
  locked_at: string;
  next_step: 'confirm_learning_hours';
  preferred_daily_hours: number | null;
  size_guardrail: RoadmapSizeGuardrailDTO;
}

/**
 * `C05` §15.5 `RoadmapVersionDTO` returned by `EP-R06`.
 */
export interface RoadmapVersionDTO {
  id: string;
  version_no: number;
  state: RoadmapVersionState;
  created_by: RoadmapVersionOrigin;
  target_level: CareerLevel;
  base_version_id: string | null;
  merge_id: string | null;
  stale: boolean;
  locked_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

export interface RoadmapVersionListResponseDTO {
  items: RoadmapVersionDTO[];
  meta: PageMetaDTO;
}

/**
 * `C05` §15.5 `FocusSwitchResponseDTO` returned by `EP-R14`.
 */
export interface FocusSwitchResponseDTO {
  focus_roadmap_id: string;
  daily_plan: {
    state: 'existing' | 'missing';
    plan_id: string | null;
    requires_learning_hours: boolean;
  };
}

/**
 * `C05` §14.5 `EP-R15` response payload.
 */
export interface ArchiveRoadmapResponseDTO {
  archived_roadmap_id: string;
  status: 'archived';
  new_focus_roadmap_id: string | null;
}
