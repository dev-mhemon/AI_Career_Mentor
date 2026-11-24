import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { PageMetaDTO } from '../../roadmap/dto/roadmap.dto.js';

export type { PageMetaDTO };

/** Canonical `public.release_status` enum values (`001_enums.sql`, `C05` §15.11). */
export type ReleaseStatus =
  'released' | 'announced' | 'planned' | 'experimental';

export const RELEASE_STATUS_VALUES: readonly ReleaseStatus[] = [
  'released',
  'announced',
  'planned',
  'experimental',
];

/** Canonical `public.relevance_level` enum values (`001_enums.sql`, `C05` §15.11). */
export type RelevanceLevel = 'high' | 'medium' | 'low';

export const RELEVANCE_LEVEL_VALUES: readonly RelevanceLevel[] = [
  'high',
  'medium',
  'low',
];

/** Canonical `public.action_timing` enum values (`001_enums.sql`, `C05` §15.11). */
export type ActionTiming = 'act_now' | 'learn_later' | 'awareness_only';

export const ACTION_TIMING_VALUES: readonly ActionTiming[] = [
  'act_now',
  'learn_later',
  'awareness_only',
];

/** Canonical `public.update_state` enum values (`001_enums.sql`, `C05` §14.11 / §15.11). */
export type UpdateState =
  'available' | 'no_important_changes' | 'temporarily_unavailable';

export const UPDATE_STATE_VALUES: readonly UpdateState[] = [
  'available',
  'no_important_changes',
  'temporarily_unavailable',
];

/** Canonical `public.technology_source_type` enum values (`001_enums.sql`). */
export type TechnologySourceType =
  | 'official_release_notes'
  | 'official_docs'
  | 'maintainer'
  | 'engineering_blog'
  | 'standards_body'
  | 'publication';

const normalizeOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * `C05` §14.11 `EP-T01` query parameters (`GET /api/v1/technology-updates`).
 * Keyset-paginated over `(local_date DESC, delivered_at DESC, id DESC)`.
 */
export class ListTechnologyUpdatesQueryDTO {
  @ValidateIf((_obj, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Transform(normalizeOptionalString)
  @ValidateIf((_obj, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  cursor?: string;
}

/** `C05` §15.11 `TechnologyUpdateDTO` (`EP-T01` item & `EP-T02` response). */
export interface TechnologyUpdateDTO {
  id: string;
  local_date: string;
  title: string;
  what_changed: string;
  why_it_matters: string;
  publisher: string;
  source_url: string;
  fetched_at: string;
  release_status: ReleaseStatus;
  relevance: RelevanceLevel;
  action_timing: ActionTiming;
  roadmap_relation: string | null;
  viewed: boolean;
}

/** `C05` §14.11 / §15.11 `TechnologyUpdateListDTO` (`EP-T01`). */
export interface TechnologyUpdateListDTO {
  today_state: UpdateState | null;
  generation_pending: boolean;
  message: string | null;
  items: TechnologyUpdateDTO[];
}

/** `C05` §14.11 `EP-T03` response (`POST /api/v1/technology-updates/{id}/view`). */
export interface TechnologyUpdateViewedDTO {
  id: string;
  viewed: true;
  viewed_at: string;
}
