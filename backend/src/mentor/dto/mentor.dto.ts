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
import type { UiLanguage } from '../../ai/ai.types.js';
import { hasNulOrUnpairedSurrogate } from '../../career/dto/career-goal.dto.js';
import type { PageMetaDTO } from '../../roadmap/dto/roadmap.dto.js';

export type { PageMetaDTO };

/** Canonical `public.conversation_context` enum values (`001_enums.sql`, `C05` §15.10). */
export type ConversationContextType = 'focus_roadmap' | 'topic' | 'general';

export const CONVERSATION_CONTEXT_VALUES: readonly ConversationContextType[] = [
  'focus_roadmap',
  'topic',
  'general',
];

/** Canonical `public.message_role` enum values (`001_enums.sql`, `C05` §15.10). */
export type MessageRole = 'user' | 'assistant';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

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
 * Validates that a mentor user message is a well-formed Unicode string
 * within `1..4000` characters (`C05` §14.10 / `009_ai_mentor.sql` `ck_messages_length`).
 */
export function isValidMentorUserMessageContent(
  value: unknown,
): value is string {
  if (typeof value !== 'string' || hasNulOrUnpairedSurrogate(value)) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return false;
  }
  const codePointLen = Array.from(trimmed).length;
  return codePointLen >= 1 && codePointLen <= 4_000;
}

/**
 * `C05` §14.10 / §15.10 `ConversationCreateDTO` (`EP-M01` `POST /api/v1/mentor/conversations`).
 *
 * Note: `context_type` enum membership (`focus_roadmap` | `topic` | `general`) is checked in
 * `MentorService.createConversation` so invalid enum inputs surface top-level `422 INVALID_ENUM_VALUE` (`C05` §16.3).
 */
export class ConversationCreateDTO {
  @IsString()
  @Transform(trimLower)
  @IsNotEmpty()
  context_type!: ConversationContextType;

  @ValidateIf((_obj, value) => value !== undefined && value !== null)
  @Transform(trimLower)
  @IsUUID()
  topic_id?: string;
}

/**
 * `C05` §14.10 `EP-M02` query parameters (`GET /api/v1/mentor/conversations`).
 * Keyset-paginated over `(last_message_at DESC NULLS LAST, created_at DESC, id DESC)`.
 */
export class ListConversationsQueryDTO {
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

/**
 * `C05` §14.10 / §15.10 `MessageRequestDTO` (`EP-M03` `POST /api/v1/mentor/messages`).
 */
export class MessageRequestDTO {
  @Transform(trimLower)
  @IsUUID()
  conversation_id!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty()
  @ValidateBy({
    name: 'mentorMessageUnicodeAndLengthBounds',
    validator: {
      validate: (value: unknown) => isValidMentorUserMessageContent(value),
    },
  })
  content!: string;

  @Transform(trimLower)
  @IsUUID()
  client_message_id!: string;
}

/**
 * `C05` §14.10 `EP-M04` query parameters (`GET /api/v1/mentor/history`).
 * Keyset-paginated over `(created_at DESC, id DESC)` within the 90-day `R08` retention window.
 */
export class ListHistoryQueryDTO {
  @Transform(trimLower)
  @IsNotEmpty()
  @IsUUID()
  conversation_id!: string;

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

/** `C05` §15.10 `ConversationDTO`. */
export interface ConversationDTO {
  id: string;
  context_type: ConversationContextType;
  roadmap_id: string | null;
  topic_id: string | null;
  title: string | null;
  created_at: string;
}

/** `C05` §15.10 `MessageDTO`. */
export interface MessageDTO {
  id: string;
  role: MessageRole;
  content: string;
  language: UiLanguage;
  created_at: string;
}

/** `C05` §15.10 `MessageResponseDTO` (`EP-M03`). */
export interface MessageResponseDTO {
  user_message_id: string;
  assistant_message: MessageDTO;
  safety_mode: boolean;
  learning_claim_recorded: boolean;
}

/**
 * `C05` Accepted `R15` implementation contract SSE event union (`ADR-018`).
 */
export type MentorStreamEvent =
  | {
      event: 'message.delta';
      data: {
        message_id: string;
        seq: number;
        text: string;
      };
    }
  | {
      event: 'message.completed';
      data: MessageResponseDTO;
    }
  | {
      event: 'message.error';
      data: {
        code: string;
        retryable: boolean;
        request_id: string;
      };
    };
