import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { CareerLevel } from '../../profile/profile.dto.js';
import type { PageMetaDTO } from '../../roadmap/dto/roadmap.dto.js';
import type { LearningState } from '../../learning/dto/learning.dto.js';

export type EvidenceSource = 'quiz_attempt' | 'practice_review';
export type QuestionDifficulty = 'basic' | 'application' | 'analysis';
export type PerformanceLevel = 'good' | 'needs_work';
export type ProgressEventType = 'state_change' | 'evidence_added';

export const CAREER_LEVEL_VALUES: readonly CareerLevel[] = [
  'junior',
  'mid',
  'senior',
];

export const EVIDENCE_SOURCE_VALUES: readonly EvidenceSource[] = [
  'quiz_attempt',
  'practice_review',
];

export const QUESTION_DIFFICULTY_VALUES: readonly QuestionDifficulty[] = [
  'basic',
  'application',
  'analysis',
];

export const PERFORMANCE_LEVEL_VALUES: readonly PerformanceLevel[] = [
  'good',
  'needs_work',
];

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Internal-only contract for `EP-G04` (`EvidenceService.record`, `C05` §14.9 / §15.9).
 * Never exposed as an HTTP endpoint.
 */
export interface EvidenceDTO {
  user_id: string;
  skill_id: string;
  career_level: CareerLevel;
  roadmap_id?: string | null;
  topic_id: string;
  source_type: EvidenceSource;
  source_id: string;
  difficulty: QuestionDifficulty;
  score_summary: Record<string, unknown>;
  performance_level?: PerformanceLevel | null;
  attempt_no: number;
  occurred_at: string;
  evidence_eligible?: boolean;
}

export interface ProgressChangeSummaryDTO {
  skill_id: string;
  career_level: CareerLevel;
  from: LearningState;
  to: LearningState;
  reason: string;
}

export interface EvidenceRecordResult {
  evidence_id: string | null;
  inserted: boolean;
  skill_id: string;
  career_level: CareerLevel;
  previous_state: LearningState;
  current_state: LearningState;
  state_changed: boolean;
  state_reason: string;
  progress_change: ProgressChangeSummaryDTO | null;
}

/**
 * `C05` §14.9 `EP-G01` query parameters (`roadmap_id?`, `career_level?`, `learning_state?`, `limit`, `cursor`).
 */
export class GetProgressQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimLower)
  @IsUUID()
  roadmap_id?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trimLower)
  career_level?: string;

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

  @Transform(normalizeOptionalString)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  cursor?: string;
}

/**
 * `C05` §14.9 `EP-G02` query parameters (`career_level?`).
 */
export class GetSkillProgressDetailQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trimLower)
  career_level?: string;
}

/**
 * `C05` §14.9 `EP-G03` query parameters (`skill_id?`, `from?`, `to?`, `limit`, `cursor`).
 */
export class GetProgressHistoryQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimLower)
  @IsUUID()
  skill_id?: string;

  @Transform(normalizeOptionalString)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  from?: string;

  @Transform(normalizeOptionalString)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(64)
  to?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @Transform(normalizeOptionalString)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  cursor?: string;
}

export interface RoadmapProgressCountsDTO {
  items_total: number;
  items_completed: number;
}

export interface SkillProgressDTO {
  skill_id: string;
  name: string;
  career_level: CareerLevel;
  learning_state: LearningState;
  shared_with_roadmap_ids: string[];
  weak_area: boolean;
  last_evidence_at: string | null;
  state_reason: string | null;
}

export interface WeakAreaDTO {
  skill_id: string;
  name: string;
  reason: string;
}

/**
 * `C05` §15.9 `ProgressResponseDTO` (`EP-G01`).
 */
export interface ProgressResponseDTO {
  roadmap_id: string | null;
  career_level: CareerLevel;
  roadmap_progress: RoadmapProgressCountsDTO;
  skills: SkillProgressDTO[];
  weak_areas: WeakAreaDTO[];
}

export interface PaginatedProgressResult {
  progress: ProgressResponseDTO;
  meta: PageMetaDTO;
}

export interface SkillEvidenceSummaryDTO {
  count: number;
  quiz_attempts: number;
  practice_reviews: number;
  retry_improved: boolean | null;
}

export interface SkillRoadmapRequirementDTO {
  roadmap_id: string;
  required_depth: string | null;
}

export interface SkillLevelProgressDetailDTO {
  career_level: CareerLevel;
  learning_state: LearningState;
  state_reason: string | null;
  last_evidence_at: string | null;
  evidence_summary: SkillEvidenceSummaryDTO;
  roadmap_requirements: SkillRoadmapRequirementDTO[];
}

/**
 * `C05` §15.9 / `R29` `SkillProgressDetailDTO` (`EP-G02`).
 */
export interface SkillProgressDetailDTO {
  skill_id: string;
  name: string;
  levels: SkillLevelProgressDetailDTO[];
}

/**
 * `C05` §15.9 / `R29` `ProgressHistoryItemDTO` (`EP-G03`).
 */
export interface ProgressHistoryItemDTO {
  id: string;
  occurred_at: string;
  skill_id: string;
  career_level: CareerLevel;
  event: ProgressEventType;
  from_state: LearningState | null;
  to_state: LearningState | null;
  reason: string | null;
  source: EvidenceSource | null;
  source_id: string | null;
  source_attempt_id: string | null;
}

export interface PaginatedProgressHistoryResult {
  items: ProgressHistoryItemDTO[];
  meta: PageMetaDTO;
}
