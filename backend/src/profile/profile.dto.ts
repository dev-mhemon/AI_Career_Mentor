import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  ValidateIf,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsTimeZone,
  ValidateBy,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export type ExperienceLevel = 'beginner' | 'junior' | 'mid' | 'senior';
export type CareerLevel = 'junior' | 'mid' | 'senior';
export type LearningPreference = 'reading' | 'hands_on' | 'visual' | 'mixed';
export type LearningState =
  'not_started' | 'learning' | 'practicing' | 'proficient';
export type ProgressInitializationStatus =
  'deferred_until_level_confirmation' | 'initialized' | 'unchanged';

/**
 * `R29` complete required-property consuming schema for canonical role options.
 * Explicit `null` is required when `rationale` is absent.
 */
export interface RoleOptionDTO {
  canonical_role_id: string;
  name: string;
  rationale: string | null;
}

/**
 * `R29` complete required-property consuming schema for unresolved skill alias candidates.
 */
export interface UnresolvedSkillCandidateDTO {
  skill_id: string;
  name: string;
}

export interface UnresolvedSkillDTO {
  input: string;
  candidates: UnresolvedSkillCandidateDTO[];
}

export interface ProfileSkillDTO {
  skill_id: string;
  name: string;
  alias_resolved: boolean;
  learning_state: LearningState;
  source: 'self_reported' | 'evidence';
}

export interface ProfileResponseDTO {
  current_role: string | null;
  education: string | null;
  education_level: string | null;
  experience_level: ExperienceLevel | null;
  existing_skills: ProfileSkillDTO[];
  existing_skills_none: boolean;
  learning_preference: LearningPreference | null;
  preferred_daily_hours: number | null;
  timezone: string | null;
  timezone_detected: boolean;
  active_career_goal_ids: string[];
  profile_complete: boolean;
  missing_fields: string[];
  unresolved_skills: UnresolvedSkillDTO[];
  progress_initialization: ProgressInitializationStatus;
  updated_at: string | Date;
}

export interface SkillAliasInterpretationResponseDTO {
  input: string;
  skill_id: string;
  scope: 'user';
  added_to_profile: boolean;
  progress_initialization: ProgressInitializationStatus;
}

export class SkillInput {
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @ValidateBy({
    name: 'codePointMaxLength80',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && Array.from(value).length <= 80,
    },
  })
  name: string;
}
export class ProfilePatch {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(120)
  current_role?: string;
  /**
   * Optional education background. Accepts empty string to clear existing value.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  education?: string;

  /**
   * Optional education level alias. Accepts empty string to clear existing value.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @MaxLength(200)
  education_level?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['beginner', 'junior', 'mid', 'senior'])
  experience_level?: ExperienceLevel;
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SkillInput)
  existing_skills?: SkillInput[];
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  existing_skills_none?: boolean;
}
export class PreferencesPatch {
  @IsIn(['reading', 'hands_on', 'visual', 'mixed'])
  learning_preference: LearningPreference;
}
export class LearningPatch {
  @ValidateIf((_object, value) => value !== undefined)
  @IsTimeZone()
  timezone?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0.5)
  @Max(12)
  @ValidateBy({
    name: 'halfHour',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value * 2),
    },
  })
  preferred_daily_hours?: number;
}
export class AliasInput {
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @ValidateBy({
    name: 'codePointMaxLength80',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && Array.from(value).length <= 80,
    },
  })
  input: string;
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsUUID()
  skill_id: string;
}
export class ConfirmGoal {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsUUID()
  canonical_role_id: string;
  @IsIn(['junior', 'mid', 'senior']) target_level: CareerLevel;
}
export class OAuthSession {
  @IsIn(['google', 'facebook']) provider: string;
}
