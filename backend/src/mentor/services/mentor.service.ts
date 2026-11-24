import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrivacyRetentionService } from '../../account/services/privacy-retention.service.js';
import type { MentorChatOutput, UiLanguage } from '../../ai/ai.types.js';
import { AiGatewayService } from '../../ai/services/ai-gateway.service.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { detectUiLanguage } from '../../career/services/career-goal.service.js';
import { fail } from '../../common/http.js';
import {
  CONVERSATION_CONTEXT_VALUES,
  isValidMentorUserMessageContent,
  type ConversationContextType,
  type ConversationCreateDTO,
  type ConversationDTO,
  type ListConversationsQueryDTO,
  type ListHistoryQueryDTO,
  type MessageDTO,
  type MessageRequestDTO,
  type MessageResponseDTO,
  type MessageRole,
  type PageMetaDTO,
} from '../dto/mentor.dto.js';
import { EpisodicSummaryService } from './episodic-summary.service.js';
import { MentorContextAssemblerService } from './mentor-context-assembler.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PG_CURSOR_TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?|[+-]15(?::?00)?)$/;

function assertValidCursorTimestamptz(raw: string): string {
  const trimmed = raw.trim();
  const match = PG_CURSOR_TIMESTAMPTZ_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error('Malformed cursor timestamp format');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    fail(422, 'INVALID_FORMAT', 'Invalid pagination cursor calendar date', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor timestamp contains an impossible calendar date',
      },
    ]);
  }
  if (Number.isNaN(Date.parse(trimmed))) {
    throw new Error('Unparseable cursor timestamp');
  }
  return trimmed;
}

const MENTOR_CHAT_SCHEMA_ID = 'mentor_chat.v1';
const MENTOR_CHAT_TIMEOUT_MS = 10_000;
const MENTOR_CHAT_MAX_INPUT_UNITS = 8_000;
const MENTOR_CHAT_MAX_OUTPUT_UNITS = 2_000;

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MAX_CONVERSATION_TITLE_CHARS = 200;

interface QueryExecutor {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;
}

interface FocusRoadmapRow {
  id: string;
  target_level: string;
  role_name: string;
}

interface OwnedTopicRoadmapRow {
  roadmap_id: string;
  topic_id: string;
  topic_title: string;
}

interface ConversationRow {
  id: string;
  context_type: ConversationContextType;
  roadmap_id: string | null;
  topic_id: string | null;
  title: string | null;
  last_message_at?: Date | string | null;
  last_message_at_cursor?: string | null;
  created_at: Date | string;
  created_at_cursor?: string | null;
}

interface UserMessageRow {
  id: string;
  content: string | null;
  language: UiLanguage;
  created_at: Date | string;
  within_retention?: boolean;
}

interface AssistantMessageRow {
  id: string;
  role: MessageRole;
  content: string;
  language: UiLanguage;
  safety_mode: boolean;
  learning_claim_recorded: boolean;
  created_at: Date | string;
}

interface HistoryMessageRow {
  id: string;
  role: MessageRole;
  content: string;
  language: UiLanguage;
  created_at: Date | string;
  created_at_cursor?: string | null;
}

interface DecodedConversationCursor {
  lastMessageAt: string | null;
  createdAt: string;
  id: string;
}

interface DecodedHistoryCursor {
  createdAt: string;
  id: string;
}

type PreflightTurnResult =
  | {
      kind: 'replayed';
      response: MessageResponseDTO;
    }
  | {
      kind: 'proceed';
      conversation: ConversationRow;
      userMessageId: string;
      userLanguage: UiLanguage;
      preflightNow: Date;
    };

function toIsoTimestamp(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return new Date(0).toISOString();
}

function truncateTitle(raw: string): string {
  const trimmed = raw.trim();
  const points = Array.from(trimmed);
  if (points.length <= MAX_CONVERSATION_TITLE_CHARS) {
    return trimmed;
  }
  return `${points.slice(0, MAX_CONVERSATION_TITLE_CHARS - 1).join('')}…`;
}

function capitalizeLevel(level: string): string {
  const clean = level.trim().toLowerCase();
  return clean ? `${clean[0].toUpperCase()}${clean.slice(1)}` : clean;
}

function normalizePageLimit(rawLimit?: number): number {
  if (rawLimit === undefined || rawLimit === null) {
    return DEFAULT_PAGE_LIMIT;
  }
  if (
    typeof rawLimit !== 'number' ||
    !Number.isInteger(rawLimit) ||
    rawLimit < 1 ||
    rawLimit > MAX_PAGE_LIMIT
  ) {
    fail(
      422,
      'VALIDATION_FAILED',
      'limit must be an integer between 1 and 100',
      [
        {
          field: 'limit',
          code: 'VALIDATION_FAILED',
          message: 'limit must be between 1 and 100',
        },
      ],
    );
  }
  return rawLimit;
}

function encodeConversationCursor(row: ConversationRow): string {
  const lastIso =
    row.last_message_at_cursor !== undefined
      ? row.last_message_at_cursor
      : row.last_message_at
        ? toIsoTimestamp(row.last_message_at)
        : null;
  const createdIso =
    row.created_at_cursor && row.created_at_cursor.trim().length > 0
      ? row.created_at_cursor
      : toIsoTimestamp(row.created_at);

  return Buffer.from(
    JSON.stringify({
      last_message_at: lastIso,
      created_at: createdIso,
      id: row.id.toLowerCase(),
    }),
    'utf8',
  ).toString('base64url');
}

function decodeConversationCursor(
  rawCursor: string,
): DecodedConversationCursor {
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as {
      last_message_at?: unknown;
      created_at?: unknown;
      id?: unknown;
    };

    let lastMessageAt: string | null = null;
    if (
      parsed.last_message_at !== null &&
      parsed.last_message_at !== undefined
    ) {
      if (typeof parsed.last_message_at !== 'string') {
        throw new Error('Invalid last_message_at cursor timestamp');
      }
      lastMessageAt = assertValidCursorTimestamptz(parsed.last_message_at);
    }

    if (
      typeof parsed?.created_at !== 'string' ||
      typeof parsed?.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id.trim())
    ) {
      throw new Error('Malformed conversation cursor');
    }
    const createdAt = assertValidCursorTimestamptz(parsed.created_at);

    return {
      lastMessageAt,
      createdAt,
      id: parsed.id.trim().toLowerCase(),
    };
  } catch (error) {
    if (error instanceof HttpException) {
      throw error;
    }
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor must be a valid opaque pagination token',
      },
    ]);
  }
}

function encodeHistoryCursor(row: HistoryMessageRow): string {
  const createdIso =
    row.created_at_cursor && row.created_at_cursor.trim().length > 0
      ? row.created_at_cursor
      : toIsoTimestamp(row.created_at);
  return Buffer.from(
    JSON.stringify({
      created_at: createdIso,
      id: row.id.toLowerCase(),
    }),
    'utf8',
  ).toString('base64url');
}

function decodeHistoryCursor(rawCursor: string): DecodedHistoryCursor {
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed?.created_at !== 'string' ||
      typeof parsed?.id !== 'string' ||
      !UUID_PATTERN.test(parsed.id.trim())
    ) {
      throw new Error('Malformed history cursor');
    }
    const createdAt = assertValidCursorTimestamptz(parsed.created_at);
    return {
      createdAt,
      id: parsed.id.trim().toLowerCase(),
    };
  } catch (error) {
    if (error instanceof HttpException) {
      throw error;
    }
    fail(400, 'INVALID_FORMAT', 'Invalid pagination cursor', [
      {
        field: 'cursor',
        code: 'INVALID_FORMAT',
        message: 'cursor must be a valid opaque pagination token',
      },
    ]);
  }
}

function mapConversationRow(row: ConversationRow): ConversationDTO {
  return {
    id: row.id,
    context_type: row.context_type,
    roadmap_id: row.roadmap_id ?? null,
    topic_id: row.topic_id ?? null,
    title: row.title ?? null,
    created_at: toIsoTimestamp(row.created_at),
  };
}

function mapAssistantResponse(
  userMessageId: string,
  assistantRow: AssistantMessageRow,
): MessageResponseDTO {
  return {
    user_message_id: userMessageId,
    assistant_message: {
      id: assistantRow.id,
      role: 'assistant',
      content: assistantRow.content,
      language: assistantRow.language,
      created_at: toIsoTimestamp(assistantRow.created_at),
    },
    safety_mode: Boolean(assistantRow.safety_mode),
    learning_claim_recorded: Boolean(assistantRow.learning_claim_recorded),
  };
}

/**
 * Core AI Mentor domain service implementing `EP-M01`–`EP-M04` (`C05` §14.10, `C08` §7.1 / §10).
 *
 * Security & Architecture Invariants:
 * - Zero DB transactions or row locks held while awaiting `AiGatewayService.execute(...)`.
 * - Strict tenant isolation (`user_id = callerId` on every query; `404 CONVERSATION_NOT_FOUND` for unknown or foreign IDs).
 * - `client_message_id` idempotent deduplication (`uq_messages_client_message`) replays committed replies with zero LLM/quota cost,
 *   and cleanly recovers same-ID retries against saved user messages when a prior LLM call timed out or failed.
 * - `"I studied this"` claims set `learning_claim_recorded: true` in conversation records only — **zero writes** to
 *   `learning_evidence`, `skill_progress`, `roadmap_items`, or `daily_plan_items` (`PRD` §37).
 * - Enforces dual-predicate 90-day `R08` retention cutoffs on all message reads and writes.
 * - Never logs raw user or assistant message `content` (`R11`).
 */
@Injectable()
export class MentorService {
  private readonly logger = new Logger(MentorService.name);
  private readonly inFlightTurns = new Map<
    string,
    { content: string; promise: Promise<MessageResponseDTO> }
  >();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AiGatewayService) private readonly aiGateway: AiGatewayService,
    @Inject(PrivacyRetentionService)
    private readonly privacyRetention: PrivacyRetentionService,
    @Inject(MentorContextAssemblerService)
    private readonly contextAssembler: MentorContextAssemblerService,
    @Inject(EpisodicSummaryService)
    private readonly episodicSummary: EpisodicSummaryService,
  ) {}

  private assertValidUserId(userId: string): string {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
      fail(401, 'AUTH_REQUIRED', 'Application account required');
    }
    return userId.trim().toLowerCase();
  }

  private async runWriteTx<T>(
    userId: string,
    foreground: boolean,
    operation: (tx: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        userId,
        (tx) => operation(tx),
        true,
        foreground,
        true,
      );
    }
    return operation(this.database);
  }

  private async runRead<T>(
    operation: (db: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        null,
        (db) => operation(db),
        false,
        false,
        true,
      );
    }
    return operation(this.database);
  }

  /**
   * `EP-M01` (`POST /api/v1/mentor/conversations`, `201 Created`, `Gate: write (ai_mentor)`):
   * Creates a new owned mentor conversation scoped to `focus_roadmap`, `topic`, or `general`.
   */
  async createConversation(
    rawUserId: string,
    dto: ConversationCreateDTO,
  ): Promise<ConversationDTO> {
    const userId = this.assertValidUserId(rawUserId);
    const rawType =
      typeof dto?.context_type === 'string'
        ? dto.context_type.trim().toLowerCase()
        : '';

    if (!rawType) {
      fail(422, 'VALIDATION_FAILED', 'context_type is required', [
        {
          field: 'context_type',
          code: 'VALIDATION_FAILED',
          message: 'context_type is required',
        },
      ]);
    }
    if (
      !CONVERSATION_CONTEXT_VALUES.includes(rawType as ConversationContextType)
    ) {
      fail(
        422,
        'INVALID_ENUM_VALUE',
        'context_type must be focus_roadmap, topic, or general',
        [
          {
            field: 'context_type',
            code: 'INVALID_ENUM_VALUE',
            message: 'context_type must be focus_roadmap, topic, or general',
          },
        ],
      );
    }
    const contextType = rawType as ConversationContextType;

    const hasExplicitTopicId =
      dto !== undefined && dto !== null && dto.topic_id !== undefined;
    const rawTopicId =
      typeof dto?.topic_id === 'string'
        ? dto.topic_id.trim().toLowerCase()
        : undefined;

    if (contextType === 'topic') {
      if (!rawTopicId || !UUID_PATTERN.test(rawTopicId)) {
        fail(
          422,
          'VALIDATION_FAILED',
          'topic_id is required when context_type is topic',
          [
            {
              field: 'topic_id',
              code: 'VALIDATION_FAILED',
              message:
                'Valid topic_id UUID is required for topic conversations',
            },
          ],
        );
      }
    } else if (hasExplicitTopicId) {
      fail(
        422,
        'VALIDATION_FAILED',
        'topic_id is only allowed when context_type is topic',
        [
          {
            field: 'topic_id',
            code: 'VALIDATION_FAILED',
            message: 'Omit topic_id unless context_type is topic',
          },
        ],
      );
    }

    return this.runWriteTx(userId, true, async (tx) => {
      let roadmapId: string | null = null;
      let topicId: string | null = null;
      let title = 'General Career Guidance';

      if (contextType === 'focus_roadmap') {
        const focusRows = await tx.query<FocusRoadmapRow[]>(
          `SELECT r.id,
                  r.target_level::text AS target_level,
                  cr.name AS role_name
             FROM public.roadmaps r
             JOIN public.career_roles cr ON cr.id = r.canonical_role_id
            WHERE r.user_id = $1
              AND r.status = 'locked'
              AND r.is_focus = true
            LIMIT 1`,
          [userId],
        );
        const focus = Array.isArray(focusRows) ? focusRows[0] : undefined;
        if (!focus) {
          fail(
            409,
            'NO_FOCUS_ROADMAP',
            'Lock and focus a roadmap before creating a focus_roadmap conversation',
          );
        }
        roadmapId = focus.id;
        title = truncateTitle(
          `${focus.role_name} (${capitalizeLevel(focus.target_level)})`,
        );
      } else if (contextType === 'topic' && rawTopicId) {
        const topicRows = await tx.query<OwnedTopicRoadmapRow[]>(
          `SELECT r.id AS roadmap_id,
                  t.id AS topic_id,
                  COALESCE(NULLIF(btrim(ri.title), ''), t.title) AS topic_title
             FROM public.roadmaps r
             JOIN public.roadmap_items ri
               ON ri.version_id = r.current_version_id
              AND ri.user_id = r.user_id
             JOIN public.topics t
               ON t.id = ri.topic_id
            WHERE r.user_id = $1
              AND r.status <> 'archived'
              AND ri.topic_id = $2::uuid
              AND ri.retired = false
              AND t.deleted_at IS NULL
            ORDER BY r.is_focus DESC,
                     (r.status = 'locked') DESC,
                     r.created_at DESC
            LIMIT 1`,
          [userId, rawTopicId],
        );
        const ownedTopic = Array.isArray(topicRows) ? topicRows[0] : undefined;
        if (!ownedTopic) {
          fail(
            404,
            'RESOURCE_NOT_FOUND',
            'Topic not found in your active roadmaps',
          );
        }
        roadmapId = ownedTopic.roadmap_id;
        topicId = ownedTopic.topic_id;
        title = truncateTitle(ownedTopic.topic_title);
      }

      const insertedRows = await tx.query<ConversationRow[]>(
        `INSERT INTO public.conversations (
           user_id,
           context_type,
           roadmap_id,
           topic_id,
           title
         )
         VALUES (
           $1,
           $2::public.conversation_context,
           $3,
           $4,
           $5
         )
         RETURNING id,
                   context_type::text AS context_type,
                   roadmap_id,
                   topic_id,
                   title,
                   created_at`,
        [userId, contextType, roadmapId, topicId, title],
      );
      const created = Array.isArray(insertedRows) ? insertedRows[0] : undefined;
      if (!created) {
        fail(500, 'DATABASE_ERROR', 'Failed to create conversation');
      }

      if (contextType !== 'general') {
        await tx.query(
          `INSERT INTO public.ai_context_records (
             user_id,
             context_type,
             scope_key,
             summary_text,
             source_ref,
             version,
             valid_until
           )
           VALUES (
             $1,
             'conversation'::public.ai_context_type,
             $2,
             $3,
             jsonb_build_object(
               'conversation_id', $2::text,
               'context_type', $4::text,
               'roadmap_id', $5::uuid,
               'topic_id', $6::uuid
             ),
             1,
             clock_timestamp() + interval '30 days'
           )
           ON CONFLICT (user_id, context_type, scope_key) DO UPDATE SET
             summary_text = EXCLUDED.summary_text,
             source_ref = EXCLUDED.source_ref,
             valid_until = EXCLUDED.valid_until,
             updated_at = clock_timestamp()`,
          [
            userId,
            created.id,
            `Conversation initialized with ${contextType} scope: ${title}`,
            contextType,
            roadmapId,
            topicId,
          ],
        );
      }

      return mapConversationRow(created);
    });
  }

  /**
   * `EP-M02` (`GET /api/v1/mentor/conversations`, `200 OK`, `Gate: none`):
   * Lists the caller's own conversations ordered by `(last_message_at DESC NULLS LAST, created_at DESC, id DESC)`.
   */
  async listConversations(
    rawUserId: string,
    query?: ListConversationsQueryDTO,
  ): Promise<{ items: ConversationDTO[]; meta: PageMetaDTO }> {
    const userId = this.assertValidUserId(rawUserId);
    const limit = normalizePageLimit(query?.limit);
    const decodedCursor =
      typeof query?.cursor === 'string' && query.cursor.trim().length > 0
        ? decodeConversationCursor(query.cursor)
        : null;

    const rows = await this.runRead((db) => {
      if (!decodedCursor) {
        return db.query<ConversationRow[]>(
          `SELECT id,
                  context_type::text AS context_type,
                  roadmap_id,
                  topic_id,
                  title,
                  last_message_at,
                  to_char(last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_message_at_cursor,
                  created_at,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
             FROM public.conversations
            WHERE user_id = $1
            ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
            LIMIT $2`,
          [userId, limit + 1],
        );
      }

      if (decodedCursor.lastMessageAt !== null) {
        return db.query<ConversationRow[]>(
          `SELECT id,
                  context_type::text AS context_type,
                  roadmap_id,
                  topic_id,
                  title,
                  last_message_at,
                  to_char(last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_message_at_cursor,
                  created_at,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
             FROM public.conversations
            WHERE user_id = $1
              AND (
                last_message_at IS NULL
                OR last_message_at < $2::timestamptz
                OR (
                  last_message_at = $2::timestamptz
                  AND (
                    created_at < $3::timestamptz
                    OR (created_at = $3::timestamptz AND id < $4::uuid)
                  )
                )
              )
            ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
            LIMIT $5`,
          [
            userId,
            decodedCursor.lastMessageAt,
            decodedCursor.createdAt,
            decodedCursor.id,
            limit + 1,
          ],
        );
      }

      return db.query<ConversationRow[]>(
        `SELECT id,
                context_type::text AS context_type,
                roadmap_id,
                topic_id,
                title,
                last_message_at,
                to_char(last_message_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_message_at_cursor,
                created_at,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
           FROM public.conversations
          WHERE user_id = $1
            AND last_message_at IS NULL
            AND (
              created_at < $2::timestamptz
              OR (created_at = $2::timestamptz AND id < $3::uuid)
            )
          ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
          LIMIT $4`,
        [userId, decodedCursor.createdAt, decodedCursor.id, limit + 1],
      );
    });

    const list = Array.isArray(rows) ? rows : [];
    const hasMore = list.length > limit;
    const pageRows = hasMore ? list.slice(0, limit) : list;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeConversationCursor(pageRows[pageRows.length - 1])
        : null;

    return {
      items: pageRows.map(mapConversationRow),
      meta: {
        limit,
        next_cursor: nextCursor,
      },
    };
  }

  /**
   * `EP-M03` (`POST /api/v1/mentor/messages`, `201 Created` default JSON / `200` opt-in SSE, `Gate: write (ai_mentor)`):
   * Persists/deduplicates the user turn in Tx 1, executes `AiGatewayService` outside any DB transaction,
   * commits the validated assistant reply in Tx 2, and runs non-blocking 20-turn episodic summarization.
   */
  async sendMessage(
    rawUserId: string,
    dto: MessageRequestDTO,
    options: { signal?: AbortSignal; now?: Date } = {},
  ): Promise<MessageResponseDTO> {
    const userId = this.assertValidUserId(rawUserId);

    const conversationId =
      typeof dto?.conversation_id === 'string'
        ? dto.conversation_id.trim().toLowerCase()
        : '';
    if (!UUID_PATTERN.test(conversationId)) {
      fail(422, 'VALIDATION_FAILED', 'Valid conversation_id UUID is required', [
        {
          field: 'conversation_id',
          code: 'VALIDATION_FAILED',
          message: 'conversation_id must be a valid UUID',
        },
      ]);
    }

    const clientMessageId =
      typeof dto?.client_message_id === 'string'
        ? dto.client_message_id.trim().toLowerCase()
        : '';
    if (!UUID_PATTERN.test(clientMessageId)) {
      fail(
        422,
        'VALIDATION_FAILED',
        'Valid client_message_id UUID is required',
        [
          {
            field: 'client_message_id',
            code: 'VALIDATION_FAILED',
            message: 'client_message_id must be a valid UUID',
          },
        ],
      );
    }

    if (!isValidMentorUserMessageContent(dto?.content)) {
      fail(
        422,
        'VALIDATION_FAILED',
        'Message content must be 1..4000 well-formed Unicode characters',
        [
          {
            field: 'content',
            code: 'VALIDATION_FAILED',
            message: 'content must be between 1 and 4000 characters',
          },
        ],
      );
    }
    const trimmedContent = dto.content.trim();
    const flightKey = `${userId}:${conversationId}:${clientMessageId}`;
    const existingFlight = this.inFlightTurns.get(flightKey);
    if (existingFlight) {
      if (existingFlight.content !== trimmedContent) {
        fail(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'client_message_id was already used for a different message in this conversation',
        );
      }
      return existingFlight.promise;
    }

    const turnPromise = this.executeSendMessageTurn(
      userId,
      conversationId,
      clientMessageId,
      trimmedContent,
      options,
    );
    this.inFlightTurns.set(flightKey, {
      content: trimmedContent,
      promise: turnPromise,
    });
    try {
      return await turnPromise;
    } finally {
      if (this.inFlightTurns.get(flightKey)?.promise === turnPromise) {
        this.inFlightTurns.delete(flightKey);
      }
    }
  }

  private async executeSendMessageTurn(
    userId: string,
    conversationId: string,
    clientMessageId: string,
    trimmedContent: string,
    options: { signal?: AbortSignal; now?: Date },
  ): Promise<MessageResponseDTO> {
    const detectedLanguage = detectUiLanguage(trimmedContent);

    const retentionDays = this.privacyRetention.getMentorMessageRetentionDays();

    // Step A: Tx 1 — quick ownership check, client_message_id dedup, user message persist, R24 last_active_at.
    // ZERO external/LLM calls inside this transaction.
    const preflight = await this.runWriteTx<PreflightTurnResult>(
      userId,
      true,
      async (tx) => {
        const convRows = await tx.query<ConversationRow[]>(
          `SELECT id,
                  context_type::text AS context_type,
                  roadmap_id,
                  topic_id,
                  title,
                  created_at
             FROM public.conversations
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [conversationId, userId],
        );
        const conversation = Array.isArray(convRows) ? convRows[0] : undefined;
        if (!conversation) {
          fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
        }

        // Sample post-lock timestamp so waiting on FOR UPDATE never replays or reuses an expired row.
        const tx1Now = options.now ?? new Date();
        const tx1Cutoff =
          this.privacyRetention.getMentorMessageCutoffDate(tx1Now);

        // R08: Apply both retention predicates BEFORE projecting content so expired unpurged rows
        // never expose content during dedup; if expired, reject cleanly so the client generates a new ID.
        const existingUserRows = await tx.query<UserMessageRow[]>(
          `SELECT id,
                  CASE
                    WHEN expires_at > $4 AND created_at > $5 THEN content
                    ELSE NULL
                  END AS content,
                  language::text AS language,
                  created_at,
                  (expires_at > $4 AND created_at > $5) AS within_retention
             FROM public.messages
            WHERE conversation_id = $1
              AND user_id = $2
              AND client_message_id = $3
            LIMIT 1`,
          [conversationId, userId, clientMessageId, tx1Now, tx1Cutoff],
        );
        const existingUserMsg = Array.isArray(existingUserRows)
          ? existingUserRows[0]
          : undefined;

        if (existingUserMsg) {
          if (
            existingUserMsg.within_retention === false ||
            existingUserMsg.content === null
          ) {
            fail(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'client_message_id belongs to an expired message; generate a new client_message_id',
            );
          }
          if (existingUserMsg.content !== trimmedContent) {
            fail(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'client_message_id was already used for a different message in this conversation',
            );
          }

          const existingReplyRows = await tx.query<AssistantMessageRow[]>(
            `SELECT id,
                    role::text AS role,
                    content,
                    language::text AS language,
                    safety_mode,
                    learning_claim_recorded,
                    created_at
               FROM public.messages
              WHERE conversation_id = $1
                AND user_id = $2
                AND role = 'assistant'::public.message_role
                AND reply_to_message_id = $3
                AND expires_at > $4
                AND created_at > $5
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [conversationId, userId, existingUserMsg.id, tx1Now, tx1Cutoff],
          );
          const existingReply = Array.isArray(existingReplyRows)
            ? existingReplyRows[0]
            : undefined;

          if (existingReply) {
            return {
              kind: 'replayed',
              response: mapAssistantResponse(existingUserMsg.id, existingReply),
            };
          }

          return {
            kind: 'proceed',
            conversation,
            userMessageId: existingUserMsg.id,
            userLanguage: existingUserMsg.language,
            preflightNow: tx1Now,
          };
        }

        const insertedUserRows = await tx.query<UserMessageRow[]>(
          `INSERT INTO public.messages (
             conversation_id,
             user_id,
             role,
             content,
             language,
             client_message_id,
             expires_at
           )
           VALUES (
             $1,
             $2,
             'user'::public.message_role,
             $3,
             $4::public.ui_language,
             $5,
             clock_timestamp() + make_interval(days => $6::int)
           )
           RETURNING id,
                     content,
                     language::text AS language,
                     created_at`,
          [
            conversationId,
            userId,
            trimmedContent,
            detectedLanguage,
            clientMessageId,
            retentionDays,
          ],
        );
        const insertedUser = Array.isArray(insertedUserRows)
          ? insertedUserRows[0]
          : undefined;
        if (!insertedUser) {
          fail(500, 'DATABASE_ERROR', 'Failed to persist mentor message');
        }

        return {
          kind: 'proceed',
          conversation,
          userMessageId: insertedUser.id,
          userLanguage: detectedLanguage,
          preflightNow: tx1Now,
        };
      },
    );

    if (preflight.kind === 'replayed') {
      return preflight.response;
    }

    // Step B: Outside Tx — assemble bounded owner-only context (sampling fresh retention clock) & execute AI Gateway.
    const assembled = await this.contextAssembler.assembleContext({
      userId,
      conversation: {
        id: preflight.conversation.id,
        context_type: preflight.conversation.context_type,
        roadmap_id: preflight.conversation.roadmap_id,
        topic_id: preflight.conversation.topic_id,
        title: preflight.conversation.title,
      },
      currentUserMessageId: preflight.userMessageId,
      ...(options.now ? { now: options.now } : {}),
    });

    const aiResponse = await this.aiGateway.execute<MentorChatOutput>(
      {
        task: 'mentor_chat',
        user_id: userId,
        feature_key: 'ai_mentor',
        context: assembled.context,
        untrusted_inputs: [trimmedContent],
        output_schema: MENTOR_CHAT_SCHEMA_ID,
        language: preflight.userLanguage,
        idempotency_key: `${conversationId}:${clientMessageId}`,
        budget: {
          max_input_units: MENTOR_CHAT_MAX_INPUT_UNITS,
          max_output_units: MENTOR_CHAT_MAX_OUTPUT_UNITS,
          timeout_ms: MENTOR_CHAT_TIMEOUT_MS,
        },
      },
      { signal: options.signal },
    );

    const validatedOutput = aiResponse.output;
    if (!validatedOutput) {
      fail(
        502,
        'AI_SERVICE_ERROR',
        'AI service encountered an error. Please try again later.',
        undefined,
        true,
      );
    }

    // Step C: Tx 2 — race-safe commit of validated assistant reply.
    // CRITICAL (PRD §37): NEVER write to learning_evidence, skill_progress, roadmap_items, or daily_plan_items.
    const committedResponse = await this.runWriteTx<MessageResponseDTO>(
      userId,
      false,
      async (tx) => {
        const lockedConvRows = await tx.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.conversations
            WHERE id = $1
              AND user_id = $2
            FOR UPDATE`,
          [conversationId, userId],
        );
        if (!Array.isArray(lockedConvRows) || lockedConvRows.length === 0) {
          fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
        }

        // Sample post-lock timestamp so waiting on FOR UPDATE never commits against an expired source.
        const tx2Now = options.now ?? new Date();
        const tx2Cutoff =
          this.privacyRetention.getMentorMessageCutoffDate(tx2Now);

        // R08: Recheck source user message retention at write time inside Tx 2 before committing a fresh reply.
        const activeSourceRows = await tx.query<Array<{ id: string }>>(
          `SELECT id
             FROM public.messages
            WHERE id = $1
              AND conversation_id = $2
              AND user_id = $3
              AND role = 'user'::public.message_role
              AND expires_at > $4
              AND created_at > $5
            LIMIT 1`,
          [preflight.userMessageId, conversationId, userId, tx2Now, tx2Cutoff],
        );
        if (!Array.isArray(activeSourceRows) || activeSourceRows.length === 0) {
          fail(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'Source message expired past retention window; resend with a new client_message_id',
          );
        }

        const concurrentReplyRows = await tx.query<AssistantMessageRow[]>(
          `SELECT id,
                  role::text AS role,
                  content,
                  language::text AS language,
                  safety_mode,
                  learning_claim_recorded,
                  created_at
             FROM public.messages
            WHERE conversation_id = $1
              AND user_id = $2
              AND role = 'assistant'::public.message_role
              AND reply_to_message_id = $3
              AND expires_at > $4
              AND created_at > $5
            ORDER BY created_at DESC, id DESC
            LIMIT 1`,
          [conversationId, userId, preflight.userMessageId, tx2Now, tx2Cutoff],
        );
        const concurrentReply = Array.isArray(concurrentReplyRows)
          ? concurrentReplyRows[0]
          : undefined;
        if (concurrentReply) {
          return mapAssistantResponse(preflight.userMessageId, concurrentReply);
        }

        // Atomically revalidate source retention on the exact DB clock_timestamp() that sets expires_at.
        const insertedAssistantRows = await tx.query<AssistantMessageRow[]>(
          `INSERT INTO public.messages (
             conversation_id,
             user_id,
             role,
             content,
             language,
             reply_to_message_id,
             safety_mode,
             learning_claim_recorded,
             ai_generation_id,
             expires_at
           )
           SELECT $1::uuid,
                  $2::uuid,
                  'assistant'::public.message_role,
                  $3::text,
                  $4::public.ui_language,
                  $5::uuid,
                  $6::boolean,
                  $7::boolean,
                  $8::uuid,
                  clock_timestamp() + make_interval(days => $9::int)
             FROM public.messages src
            WHERE src.id = $5::uuid
              AND src.conversation_id = $1::uuid
              AND src.user_id = $2::uuid
              AND src.role = 'user'::public.message_role
              AND src.expires_at > clock_timestamp()
              AND src.created_at > clock_timestamp() - make_interval(days => $9::int)
           RETURNING id,
                     role::text AS role,
                     content,
                     language::text AS language,
                     safety_mode,
                     learning_claim_recorded,
                     created_at`,
          [
            conversationId,
            userId,
            validatedOutput.content.trim(),
            validatedOutput.language,
            preflight.userMessageId,
            Boolean(validatedOutput.safety_mode),
            Boolean(validatedOutput.learning_claim_recorded),
            aiResponse.generation_id ?? null,
            retentionDays,
          ],
        );
        const assistantRow = Array.isArray(insertedAssistantRows)
          ? insertedAssistantRows[0]
          : undefined;
        if (!assistantRow) {
          fail(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'Source message expired past retention window; resend with a new client_message_id',
          );
        }

        return mapAssistantResponse(preflight.userMessageId, assistantRow);
      },
    );

    // Step D: Non-blocking post-commit episodic compaction (samples fresh retention clock; never blocks or fails EP-M03).
    try {
      const compactPromise = this.episodicSummary.maybeCompact(
        userId,
        conversationId,
        options.now,
      );
      if (compactPromise && typeof compactPromise.catch === 'function') {
        void compactPromise.catch((error: unknown) => {
          const errorType =
            error instanceof Error ? error.name : 'UnknownError';
          this.logger.warn(
            `Post-commit episodic summary check skipped for conversation=${conversationId} errorType=${errorType}`,
          );
        });
      }
    } catch (error: unknown) {
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Post-commit episodic summary check skipped for conversation=${conversationId} errorType=${errorType}`,
      );
    }

    return committedResponse;
  }

  /**
   * `EP-M04` (`GET /api/v1/mentor/history`, `200 OK`, `Gate: none`):
   * Returns paginated conversation messages within the dual-predicate 90-day `R08` retention window
   * (`expires_at > now AND created_at > cutoff`), ordered `(created_at DESC, id DESC)`.
   */
  async getHistory(
    rawUserId: string,
    query: ListHistoryQueryDTO,
    explicitNow?: Date,
  ): Promise<{ items: MessageDTO[]; meta: PageMetaDTO }> {
    const userId = this.assertValidUserId(rawUserId);
    const conversationId =
      typeof query?.conversation_id === 'string'
        ? query.conversation_id.trim().toLowerCase()
        : '';
    if (!conversationId || !UUID_PATTERN.test(conversationId)) {
      fail(422, 'VALIDATION_FAILED', 'Valid conversation_id UUID is required', [
        {
          field: 'conversation_id',
          code: 'VALIDATION_FAILED',
          message: 'conversation_id must be a valid UUID',
        },
      ]);
    }

    const limit = normalizePageLimit(query?.limit);
    const decodedCursor =
      typeof query?.cursor === 'string' && query.cursor.trim().length > 0
        ? decodeHistoryCursor(query.cursor)
        : null;

    return this.runRead(async (db) => {
      const convRows = await db.query<Array<{ id: string }>>(
        `SELECT id
           FROM public.conversations
          WHERE id = $1
            AND user_id = $2
          LIMIT 1`,
        [conversationId, userId],
      );
      if (!Array.isArray(convRows) || convRows.length === 0) {
        fail(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
      }

      // Sample fresh retention timestamp right before querying messages.
      const now = explicitNow ?? new Date();
      const messageCutoff =
        this.privacyRetention.getMentorMessageCutoffDate(now);

      const messageRows = decodedCursor
        ? await db.query<HistoryMessageRow[]>(
            `SELECT id,
                    role::text AS role,
                    content,
                    language::text AS language,
                    created_at,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
               FROM public.messages
              WHERE conversation_id = $1
                AND user_id = $2
                AND expires_at > $3
                AND created_at > $4
                AND (
                  created_at < $5::timestamptz
                  OR (created_at = $5::timestamptz AND id < $6::uuid)
                )
              ORDER BY created_at DESC, id DESC
              LIMIT $7`,
            [
              conversationId,
              userId,
              now,
              messageCutoff,
              decodedCursor.createdAt,
              decodedCursor.id,
              limit + 1,
            ],
          )
        : await db.query<HistoryMessageRow[]>(
            `SELECT id,
                    role::text AS role,
                    content,
                    language::text AS language,
                    created_at,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
               FROM public.messages
              WHERE conversation_id = $1
                AND user_id = $2
                AND expires_at > $3
                AND created_at > $4
              ORDER BY created_at DESC, id DESC
              LIMIT $5`,
            [conversationId, userId, now, messageCutoff, limit + 1],
          );

      const list = Array.isArray(messageRows) ? messageRows : [];
      const hasMore = list.length > limit;
      const pageRows = hasMore ? list.slice(0, limit) : list;
      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeHistoryCursor(pageRows[pageRows.length - 1])
          : null;

      return {
        items: pageRows.map((row) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          language: row.language,
          created_at: toIsoTimestamp(row.created_at),
        })),
        meta: {
          limit,
          next_cursor: nextCursor,
        },
      };
    });
  }
}
