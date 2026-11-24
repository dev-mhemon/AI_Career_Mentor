import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Policy } from '../../auth/policy.js';
import { fail } from '../../common/http.js';
import {
  ConversationCreateDTO,
  ListConversationsQueryDTO,
  ListHistoryQueryDTO,
  MessageRequestDTO,
  type ConversationDTO,
  type MentorStreamEvent,
  type MessageDTO,
  type MessageResponseDTO,
  type PageMetaDTO,
} from '../dto/mentor.dto.js';
import { MentorService } from '../services/mentor.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});
const DEFAULT_SSE_CHUNK_CODE_POINTS = 48;

export interface AuthenticatedMentorRequest {
  user?: {
    sub?: string;
    sessionId?: string;
    status?: string;
  };
  headers?: Record<string, string | string[] | undefined>;
}

function assertAuthenticatedUserId(req: AuthenticatedMentorRequest): string {
  const userId = req?.user?.sub;
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId.trim())) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  return userId.trim().toLowerCase();
}

function readHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  headerName: string,
): string {
  if (!headers) {
    return '';
  }
  const direct = headers[headerName] ?? headers[headerName.toLowerCase()];
  if (typeof direct === 'string') {
    return direct;
  }
  if (Array.isArray(direct)) {
    return direct.join(', ');
  }
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === headerName.toLowerCase()) {
      return Array.isArray(val) ? val.join(', ') : (val ?? '');
    }
  }
  return '';
}

function splitHeaderOutsideQuotes(
  value: string,
  delimiter: ',' | ';',
): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (inQuotes && ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

const RFC9110_QVALUE_PATTERN = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/;

/**
 * Checks whether the incoming request explicitly opts into `ADR-018` / `R15` SSE streaming
 * via `Accept: text/event-stream` with valid RFC 9110 `qvalue` (`q > 0`), safely ignoring
 * commas/semicolons inside quoted media-type parameter values.
 */
export function wantsEventStream(req?: AuthenticatedMentorRequest): boolean {
  const accept = readHeaderValue(req?.headers, 'accept').toLowerCase();
  if (!accept) {
    return false;
  }
  for (const rawEntry of splitHeaderOutsideQuotes(accept, ',')) {
    const parts = splitHeaderOutsideQuotes(rawEntry, ';')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts[0] !== 'text/event-stream') {
      continue;
    }
    let quality = 1;
    let validQuality = true;
    for (const param of parts.slice(1)) {
      const eqIdx = param.indexOf('=');
      if (eqIdx === -1) {
        continue;
      }
      const key = param.slice(0, eqIdx).trim();
      if (key !== 'q') {
        continue;
      }
      const rawVal = param.slice(eqIdx + 1).trim();
      if (!RFC9110_QVALUE_PATTERN.test(rawVal)) {
        validQuality = false;
        break;
      }
      quality = Number(rawVal);
    }
    if (validQuality && quality > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Splits an already-validated, DB-committed reply into grapheme-safe Unicode display chunks (`R15`)
 * using `Intl.Segmenter` so Bangla conjuncts (`ক্ষ` = `ক + ্ + ষ`), combining marks, and emoji ZWJ
 * clusters are never split mid-grapheme. Concatenating all chunks reproduces `content` byte-for-byte.
 */
export function chunkCommittedReplyText(
  content: string,
  targetCodePoints = DEFAULT_SSE_CHUNK_CODE_POINTS,
): string[] {
  if (!content) {
    return [];
  }
  const graphemes = Array.from(
    GRAPHEME_SEGMENTER.segment(content),
    (segment) => segment.segment,
  );
  if (Array.from(content).length <= targetCodePoints) {
    return [content];
  }

  const chunks: string[] = [];
  let buffer = '';
  let count = 0;

  for (const grapheme of graphemes) {
    buffer += grapheme;
    count += Array.from(grapheme).length;

    const isWhitespaceBoundary = /^\s+$/.test(grapheme);
    if (
      (count >= targetCodePoints && isWhitespaceBoundary) ||
      count >= targetCodePoints + 16
    ) {
      chunks.push(buffer);
      buffer = '';
      count = 0;
    }
  }

  if (buffer.length > 0) {
    chunks.push(buffer);
  }
  return chunks;
}

/** Formats a single `MentorStreamEvent` frame per `R15` (`event:<name>\ndata:<JSON>\n\n`). */
export function formatMentorSseFrame(streamEvent: MentorStreamEvent): string {
  return `event: ${streamEvent.event}\ndata: ${JSON.stringify(streamEvent.data)}\n\n`;
}

function attachPaginationMeta<T>(
  payload: T,
  meta: PageMetaDTO,
  res?: Response,
): T | { data: T; meta: PageMetaDTO } {
  if (res && typeof res.json === 'function') {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (
        body &&
        typeof body === 'object' &&
        'success' in body &&
        (body as { success?: unknown }).success === true &&
        'data' in body &&
        !('meta' in body)
      ) {
        return originalJson({
          ...(body as Record<string, unknown>),
          meta,
        });
      }
      return originalJson(body);
    }) as Response['json'];
    return payload;
  }
  return { data: payload, meta };
}

/**
 * Controller exposing `C05` §14.10 AI Mentor API (`EP-M01`–`EP-M04` under `/api/v1/mentor`).
 *
 * - Relies on `AuthModule`'s global `APP_GUARD` pipeline (`SupabaseAuthGuard` -> `AccessGuard`):
 *   - `EP-M01` & `EP-M03` enforce `@Policy({ feature: 'ai_mentor' })` (`Gate: write`).
 *   - `EP-M02` & `EP-M04` declare `@Policy({})` (`Gate: none`) so existing conversations and
 *     90-day history remain readable when `ai_mentor` is disabled (`PRD` §7 / §52).
 * - `EP-M03` returns `201 Created` JSON (`MessageResponseDTO`) by default and supports opt-in
 *   `200 text/event-stream` (`Cache-Control: no-store`) per `ADR-018` / `R15`, streaming only
 *   already-validated, DB-committed reply chunks (`message.delta` `seq: 0..N` -> `message.completed`).
 */
@Controller('mentor')
@Policy({})
export class MentorController {
  constructor(
    @Inject(MentorService) private readonly mentorService: MentorService,
  ) {}

  /**
   * `EP-M01` (`POST /api/v1/mentor/conversations`, `201 Created`, `Gate: write (ai_mentor)`).
   */
  @Post('conversations')
  @HttpCode(201)
  @Policy({ feature: 'ai_mentor' })
  async createConversation(
    @Req() req: AuthenticatedMentorRequest,
    @Body() dto: ConversationCreateDTO,
  ): Promise<ConversationDTO> {
    const userId = assertAuthenticatedUserId(req);
    return this.mentorService.createConversation(userId, dto);
  }

  /**
   * `EP-M02` (`GET /api/v1/mentor/conversations`, `200 OK`, `Gate: none`).
   */
  @Get('conversations')
  @HttpCode(200)
  @Policy({})
  async listConversations(
    @Req() req: AuthenticatedMentorRequest,
    @Query() query?: ListConversationsQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<
    ConversationDTO[] | { data: ConversationDTO[]; meta: PageMetaDTO }
  > {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.mentorService.listConversations(userId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }

  /**
   * `EP-M03` (`POST /api/v1/mentor/messages`, `201 Created` default JSON / `200` opt-in SSE, `Gate: write (ai_mentor)`).
   */
  @Post('messages')
  @HttpCode(201)
  @Policy({ feature: 'ai_mentor' })
  async sendMessage(
    @Req() req: AuthenticatedMentorRequest,
    @Body() dto: MessageRequestDTO,
    @Res() res?: Response,
  ): Promise<MessageResponseDTO | void> {
    const userId = assertAuthenticatedUserId(req);
    const sseRequested = wantsEventStream(req);

    // R15: Generate, validate, and DB-commit BEFORE emitting SSE headers so pre-commit
    // errors return normal JSON HTTP error envelopes via ApiExceptionFilter.
    const result = await this.mentorService.sendMessage(userId, dto);

    if (!res) {
      return result;
    }

    if (!sseRequested) {
      res.status(201).json({ success: true, data: result });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    try {
      const chunks = chunkCommittedReplyText(result.assistant_message.content);
      for (let seq = 0; seq < chunks.length; seq += 1) {
        res.write(
          formatMentorSseFrame({
            event: 'message.delta',
            data: {
              message_id: result.assistant_message.id,
              seq,
              text: chunks[seq],
            },
          }),
        );
      }
      res.write(
        formatMentorSseFrame({
          event: 'message.completed',
          data: result,
        }),
      );
    } catch {
      const requestIdHeader =
        typeof res.getHeader === 'function'
          ? res.getHeader('X-Request-Id')
          : '';
      const requestId =
        typeof requestIdHeader === 'string'
          ? requestIdHeader
          : Array.isArray(requestIdHeader)
            ? (requestIdHeader[0] ?? '')
            : '';
      try {
        res.write(
          formatMentorSseFrame({
            event: 'message.error',
            data: {
              code: 'INTERNAL_ERROR',
              retryable: true,
              request_id: requestId,
            },
          }),
        );
      } catch {
        // Ignore secondary write failure on closed client socket.
      }
    } finally {
      res.end();
    }
  }

  /**
   * `EP-M04` (`GET /api/v1/mentor/history`, `200 OK`, `Gate: none`).
   */
  @Get('history')
  @HttpCode(200)
  @Policy({})
  async getHistory(
    @Req() req: AuthenticatedMentorRequest,
    @Query() query: ListHistoryQueryDTO,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<MessageDTO[] | { data: MessageDTO[]; meta: PageMetaDTO }> {
    const userId = assertAuthenticatedUserId(req);
    const result = await this.mentorService.getHistory(userId, query);
    return attachPaginationMeta(result.items, result.meta, res);
  }
}
