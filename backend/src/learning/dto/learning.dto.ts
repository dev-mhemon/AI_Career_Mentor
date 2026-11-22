import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { fail } from '../../common/http.js';
import type { JobAcceptedDto } from '../../jobs/dto/job-status.dto.js';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type {
  ItemPriority,
  PageMetaDTO,
} from '../../roadmap/dto/roadmap.dto.js';

export const PG_INT4_MAX = 2_147_483_647;
export const MIN_DAILY_HOURS = 0.5;
export const MAX_DAILY_HOURS = 12;

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';
export type PlanDayStatus = PlanItemStatus;
export type TodayStatus =
  | 'ready'
  | 'preparing'
  | 'no_focus_roadmap'
  | 'no_daily_plan'
  | 'plan_completed';
export type LearningState =
  'not_started' | 'learning' | 'practicing' | 'proficient';
export type ResourceType =
  | 'official_docs'
  | 'release_notes'
  | 'article'
  | 'standard'
  | 'video'
  | 'other';
export type AttemptStatus =
  'generated' | 'started' | 'submitted' | 'ai_reviewed' | 'feedback_available';

export const LEARNING_STATE_VALUES: readonly LearningState[] = [
  'not_started',
  'learning',
  'practicing',
  'proficient',
];

export const RESOURCE_TYPE_VALUES: readonly ResourceType[] = [
  'official_docs',
  'release_notes',
  'article',
  'standard',
  'video',
  'other',
];

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
 * Strictly validates `hours_per_day` against `ck_daily_plans_hours` (`0.5..12` in `0.5` steps).
 * Rejects booleans, strings, `null`, `undefined`, non-finite numbers, and non-half-hour increments
 * with `422 LEARNING_HOURS_REQUIRED` (`C05` §14.6 / §16.3).
 */
export function assertValidLearningHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(
      422,
      'LEARNING_HOURS_REQUIRED',
      'hours_per_day is required and must be a number between 0.5 and 12 in 0.5-hour increments',
      [
        {
          field: 'hours_per_day',
          code: 'LEARNING_HOURS_REQUIRED',
          message:
            'hours_per_day must be between 0.5 and 12 in 0.5-hour increments',
        },
      ],
    );
  }
  const doubled = value * 2;
  const isHalfStep = Math.abs(doubled - Math.round(doubled)) < 1e-9;
  if (value < MIN_DAILY_HOURS || value > MAX_DAILY_HOURS || !isHalfStep) {
    fail(
      422,
      'LEARNING_HOURS_REQUIRED',
      'hours_per_day must be between 0.5 and 12 in 0.5-hour increments',
      [
        {
          field: 'hours_per_day',
          code: 'LEARNING_HOURS_REQUIRED',
          message:
            'hours_per_day must be between 0.5 and 12 in 0.5-hour increments',
        },
      ],
    );
  }
  return Math.round(doubled) / 2;
}

/**
 * `C05` §14.6 `EP-L01` query parameters (`roadmap_id?`, `limit`, `cursor`).
 */
export class GetDailyPlanQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimLower)
  @IsUUID()
  roadmap_id?: string;

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
 * `C05` §15.6 `CreateDailyPlanDTO` (`EP-L02`).
 *
 * Intentionally avoids `@Type(() => Number)` on `hours_per_day` so JSON booleans/strings are
 * never coerced to numbers; `@Allow()` preserves whitelist enforcement while delegating strict
 * half-hour range validation to `assertValidLearningHours` (`422 LEARNING_HOURS_REQUIRED`).
 */
export class CreateDailyPlanDTO {
  @Transform(trimLower)
  @IsUUID()
  roadmap_id!: string;

  @Allow()
  hours_per_day?: unknown;
}

/**
 * `C05` §15.6 `RebuildDailyPlanDTO` (`EP-L03`).
 *
 * Intentionally avoids `@Type(() => Number)` on `hours_per_day` so JSON booleans/strings are
 * never coerced; strict validation emits `422 LEARNING_HOURS_REQUIRED`.
 */
export class RebuildDailyPlanDTO {
  @Allow()
  hours_per_day?: unknown;
}

/**
 * `C05` §14.6 `EP-L05` query parameters (`roadmap_id?`, `priority?`, `learning_state?`, `limit`, `cursor`).
 * `priority` and `learning_state` enum membership are validated in `TopicContentService` so
 * `422 INVALID_ENUM_VALUE` is emitted cleanly.
 */
export class ListTopicsQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimLower)
  @IsUUID()
  roadmap_id?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trimLower)
  priority?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trimLower)
  learning_state?: string;

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
 * `C05` §14.6 `EP-L07` query parameters (`topic_id`, `limit`, `cursor`).
 */
export class ListLearningResourcesQueryDTO {
  @Transform(trimLower)
  @IsUUID()
  topic_id!: string;

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

export interface PlanDayTopicDTO {
  plan_item_id: string;
  topic_id: string;
  title: string;
}

export interface PlanDayDTO {
  day_no: number;
  status: PlanDayStatus;
  topics: PlanDayTopicDTO[];
  completed_at: string | null;
}

/**
 * `C05` §15.6 `DailyPlanResponseDTO` (`EP-L01`, `EP-L02`, `EP-L03`).
 */
export interface DailyPlanResponseDTO {
  plan_id: string;
  roadmap_id: string;
  is_focus: boolean;
  hours_per_day: number;
  roadmap_version_no: number;
  next_incomplete_day_no: number | null;
  total_days: number;
  completed_days: number;
  days: PlanDayDTO[];
}

export interface PaginatedDailyPlanResult {
  plan: DailyPlanResponseDTO;
  meta: PageMetaDTO;
}

export interface TopicImportantQuestionDTO {
  question: string;
  answer_markdown: string;
}

export interface TopicSourceRefDTO {
  publisher: string;
  url: string;
  retrieved_at?: string;
}

/**
 * `C05` §15.6 `TopicDetailDTO` (`EP-L04`, `EP-L06`).
 */
export interface TopicDetailDTO {
  topic_id: string;
  title: string;
  career_level: CareerLevel;
  content_version: number;
  explanation_markdown: string | null;
  important_questions: TopicImportantQuestionDTO[];
  sources: TopicSourceRefDTO[];
  learning_state: LearningState;
  required_depth: string;
  rating_allowed: boolean;
  report_allowed: boolean;
}

export interface TodayPlanDayDTO {
  day_no: number;
  total_days: number;
}

export interface TodayQuizSummaryDTO {
  attempt_id: string | null;
  status: AttemptStatus | null;
  can_retry: boolean;
}

/**
 * `C05` §15.6 `TodayResponseDTO` (`EP-L04`).
 */
export interface TodayResponseDTO {
  status: TodayStatus;
  roadmap_id: string | null;
  plan_id: string | null;
  plan_day: TodayPlanDayDTO | null;
  topic: TopicDetailDTO | null;
  quiz: TodayQuizSummaryDTO;
  job: JobAcceptedDto | null;
  requires_learning_hours: boolean;
  preferred_daily_hours?: number | null;
}

/**
 * `C05` §14.6 `TopicSummaryDTO` (`EP-L05`).
 */
export interface TopicSummaryDTO {
  topic_id: string;
  title: string;
  skill_id: string;
  priority: ItemPriority;
  career_level: CareerLevel;
  learning_state: LearningState;
  plan_day_no: number | null;
}

export interface TopicListResponseDTO {
  items: TopicSummaryDTO[];
  meta: PageMetaDTO;
}

/**
 * `C05` §14.6 `LearningResourceDTO` (`EP-L07`).
 */
export interface LearningResourceDTO {
  id: string;
  title: string;
  publisher: string;
  url: string;
  resource_type: ResourceType;
  retrieved_at: string | null;
}

export interface LearningResourceListResponseDTO {
  items: LearningResourceDTO[];
  meta: PageMetaDTO;
}
