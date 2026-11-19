import { Transform, Type } from 'class-transformer';
import {
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
import type { CareerLevel, RoleOptionDTO } from '../../profile/profile.dto.js';

export type GoalStatus =
  'clarifying' | 'awaiting_confirmation' | 'confirmed' | 'discontinued';

export const GOAL_STATUS_VALUES: readonly GoalStatus[] = [
  'clarifying',
  'awaiting_confirmation',
  'confirmed',
  'discontinued',
];

export const CAREER_LEVEL_VALUES: readonly CareerLevel[] = [
  'junior',
  'mid',
  'senior',
];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

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
 * `C05` §15.4 `CareerGoalCreateDTO` (`EP-C01` POST & `EP-C06` PATCH).
 * Validates `goal_text` (3..300 trimmed chars, no NUL or unpaired UTF-16 surrogates).
 */
export class CareerGoalCreateDTO {
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @ValidateBy({
    name: 'wellFormedUnicodeAndCodePointBounds',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string' || hasNulOrUnpairedSurrogate(value)) {
          return false;
        }
        const len = Array.from(value).length;
        return len >= 3 && len <= 300;
      },
    },
  })
  goal_text!: string;
}

/**
 * `C05` §15.4 `GoalClarificationDTO` (`EP-C04` POST).
 * Validates `answer` (1..300 trimmed chars, no NUL or unpaired UTF-16 surrogates).
 */
export class GoalClarificationDTO {
  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @ValidateBy({
    name: 'wellFormedUnicodeAndCodePointBounds',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string' || hasNulOrUnpairedSurrogate(value)) {
          return false;
        }
        const len = Array.from(value).length;
        return len >= 1 && len <= 300;
      },
    },
  })
  answer!: string;
}

/**
 * `C05` §15.4 `GoalConfirmDTO` (`EP-C05` POST).
 * Note: `target_level` enum membership (`junior` | `mid` | `senior`) is validated by
 * `CareerGoalService.validateConfirmDto` so top-level `error.code` is `422 INVALID_ENUM_VALUE` (`C05` §16.3).
 */
export class GoalConfirmDTO {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsUUID()
  canonical_role_id!: string;

  @IsString()
  @Transform(trim)
  target_level!: CareerLevel;
}

/**
 * `C05` §14.4 `EP-C02` query parameters (`status`, `limit`, `cursor`).
 * Note: `status` enum membership (`clarifying` | `awaiting_confirmation` | `confirmed` | `discontinued`)
 * is validated by `CareerGoalService.listGoals` so top-level `error.code` is `422 INVALID_ENUM_VALUE` (`C05` §16.3).
 */
export class CareerGoalListQueryDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  status?: GoalStatus;

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

export interface ProposedRoleDTO {
  canonical_role_id: string;
  name: string;
}

/**
 * `C05` §15.4 `CareerGoalResponseDTO` (`R29` complete consuming schema).
 */
export interface CareerGoalResponseDTO {
  id: string;
  goal_text: string;
  status: GoalStatus;
  clarification_round: number;
  clarification_question: string | null;
  proposed_role: ProposedRoleDTO | null;
  alternative_roles: RoleOptionDTO[];
  suggested_level: CareerLevel | null;
  target_level: CareerLevel | null;
  roadmap_id: string | null;
  created_at: string;
}

/**
 * `C05` §15.1 `PageMetaDTO`.
 */
export interface PageMetaDTO {
  limit: number;
  next_cursor: string | null;
}

/**
 * Paginated list result for `EP-C02`.
 */
export interface CareerGoalListResponseDTO {
  items: CareerGoalResponseDTO[];
  meta: PageMetaDTO;
}

/**
 * `C05` §14.4 `EP-C07` response payload.
 */
export interface DiscontinueCareerGoalResponseDTO {
  id: string;
  status: 'discontinued';
  archived_roadmap_id: string | null;
  new_focus_roadmap_id: string | null;
}
