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
export class SkillInput {
  @IsString() @Transform(trim) @IsNotEmpty() @MaxLength(80) name: string;
}
export class ProfilePatch {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(120)
  current_role?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @MaxLength(200)
  education?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['beginner', 'junior', 'mid', 'senior'])
  experience_level?: string;
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
  @IsIn(['reading', 'hands_on', 'visual', 'mixed']) learning_preference: string;
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
  @IsString() @Transform(trim) @IsNotEmpty() @MaxLength(80) input: string;
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
  @IsIn(['junior', 'mid', 'senior']) target_level: string;
}
export class OAuthSession {
  @IsIn(['google', 'facebook']) provider: string;
}
