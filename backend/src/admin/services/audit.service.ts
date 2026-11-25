import { Inject, Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  type AdminAuditLogQueryDTO,
  type AuditLogDTO,
  type PageMetaDTO,
  UUID_PATTERN,
  hasNulOrUnpairedSurrogate,
} from '../dto/admin.dto.js';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

/**
 * Matches ISO-8601 / PostgreSQL `timestamptz` string with up to 6 fractional digits
 * and an explicit timezone (`Z` or `±HH[:MM]`).
 */
const PG_CURSOR_TIMESTAMPTZ_PATTERN =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?|[+-]15(?::?00)?)$/;

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/;

export interface AuditLogWriteEntry {
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetUserId: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  requestId: string | null;
  ipAddress: string | null;
}

interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  http_request_id: string | null;
  created_at: Date | string;
  created_at_cursor?: string | null;
}

export interface DecodedKeysetCursor {
  createdAt: string;
  id: string;
}

export function encodeKeysetCursor(createdAt: string, id: string): string {
  return Buffer.from(
    JSON.stringify({ created_at: createdAt, id }),
    'utf8',
  ).toString('base64url');
}

export function decodeKeysetCursor(cursor: string): DecodedKeysetCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed?.created_at === 'string' &&
      PG_CURSOR_TIMESTAMPTZ_PATTERN.test(parsed.created_at) &&
      !Number.isNaN(Date.parse(parsed.created_at)) &&
      typeof parsed?.id === 'string' &&
      UUID_PATTERN.test(parsed.id)
    ) {
      return {
        createdAt: parsed.created_at,
        id: parsed.id.toLowerCase(),
      };
    }
  } catch {
    // Fall through to contract 422 error.
  }
  fail(422, 'VALIDATION_FAILED', 'Invalid pagination cursor', [
    {
      field: 'cursor',
      code: 'VALIDATION_FAILED',
      message: 'cursor is malformed',
    },
  ]);
}

function parseStrictIsoTimestamp(raw: string, field: 'from' | 'to'): Date {
  const match = ISO_TIMESTAMP_PATTERN.exec(raw);
  if (!match) {
    fail(422, 'VALIDATION_FAILED', `Invalid ${field} ISO-8601 timestamp`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must be a valid ISO-8601 timestamp with timezone`,
      },
    ]);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    fail(422, 'VALIDATION_FAILED', `Invalid ${field} calendar timestamp`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must represent a valid calendar date and time`,
      },
    ]);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    fail(422, 'VALIDATION_FAILED', `Invalid ${field} timestamp`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must be a valid ISO-8601 timestamp`,
      },
    ]);
  }
  return parsed;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeOptionalUuid(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeOptionalIp(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('%')) return null;
  return isIP(trimmed) !== 0 ? trimmed : null;
}

/**
 * Manages immutable, append-only admin audit records (`public.admin_audit_logs`, `EP-AD07`).
 * All admin write endpoints record entries atomically inside their own database transaction
 * via `recordInTx`.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  /**
   * Inserts a content-free audit row inside the caller's open transaction.
   * Respects `ck_admin_audit_logs_action` (`length(btrim(action)) BETWEEN 1 AND 120`)
   * and `trg_admin_audit_logs_append_only`.
   */
  async recordInTx(
    db: Pick<EntityManager, 'query'>,
    entry: AuditLogWriteEntry,
  ): Promise<void> {
    const action = entry.action.trim();
    if (
      action.length < 1 ||
      action.length > 120 ||
      hasNulOrUnpairedSurrogate(action)
    ) {
      fail(500, 'INTERNAL_ERROR', 'Invalid audit action');
    }

    const requestId = normalizeOptionalUuid(entry.requestId);
    const ipAddress = normalizeOptionalIp(entry.ipAddress);

    await db.query(
      `INSERT INTO public.admin_audit_logs (
         actor_id,
         action,
         target_type,
         target_id,
         target_user_id,
         before_state,
         after_state,
         http_request_id,
         ip_address
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::uuid, $9::inet)`,
      [
        entry.actorId,
        action,
        entry.targetType,
        normalizeOptionalUuid(entry.targetId),
        normalizeOptionalUuid(entry.targetUserId),
        entry.beforeState ? JSON.stringify(entry.beforeState) : null,
        entry.afterState ? JSON.stringify(entry.afterState) : null,
        requestId,
        ipAddress,
      ],
    );
  }

  /**
   * `EP-AD07` (`GET /api/v1/admin/audit-logs`, `200 OK`):
   * Returns filtered, keyset-paginated, read-only audit records ordered by `created_at DESC, id DESC`.
   */
  async listAuditLogs(
    actorId: string,
    query?: AdminAuditLogQueryDTO,
  ): Promise<{ items: AuditLogDTO[]; meta: PageMetaDTO }> {
    const rawLimit = query?.limit ?? DEFAULT_PAGE_LIMIT;
    if (
      !Number.isInteger(rawLimit) ||
      rawLimit < 1 ||
      rawLimit > MAX_PAGE_LIMIT
    ) {
      fail(422, 'VALIDATION_FAILED', 'limit must be between 1 and 100', [
        {
          field: 'limit',
          code: 'VALIDATION_FAILED',
          message: 'limit must be an integer between 1 and 100',
        },
      ]);
    }
    const limit = rawLimit;

    const actorFilter = query?.actor_id?.trim();
    if (actorFilter !== undefined && !UUID_PATTERN.test(actorFilter)) {
      fail(422, 'VALIDATION_FAILED', 'Invalid actor_id filter', [
        {
          field: 'actor_id',
          code: 'VALIDATION_FAILED',
          message: 'actor_id must be a valid UUID',
        },
      ]);
    }

    const targetUserFilter = query?.target_user_id?.trim();
    if (
      targetUserFilter !== undefined &&
      !UUID_PATTERN.test(targetUserFilter)
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid target_user_id filter', [
        {
          field: 'target_user_id',
          code: 'VALIDATION_FAILED',
          message: 'target_user_id must be a valid UUID',
        },
      ]);
    }

    const actionFilter = query?.action?.trim();
    if (
      actionFilter !== undefined &&
      (actionFilter.length === 0 ||
        actionFilter.length > 120 ||
        hasNulOrUnpairedSurrogate(actionFilter))
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid action filter', [
        {
          field: 'action',
          code: 'VALIDATION_FAILED',
          message: 'action must be a valid string between 1 and 120 characters',
        },
      ]);
    }

    const fromDate =
      query?.from !== undefined
        ? parseStrictIsoTimestamp(query.from.trim(), 'from')
        : null;
    const toDate =
      query?.to !== undefined
        ? parseStrictIsoTimestamp(query.to.trim(), 'to')
        : null;
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      fail(422, 'VALIDATION_FAILED', 'from must be on or before to', [
        {
          field: 'from',
          code: 'VALIDATION_FAILED',
          message: 'from must not be after to',
        },
      ]);
    }

    const decodedCursor = query?.cursor
      ? decodeKeysetCursor(query.cursor.trim())
      : null;

    return this.database.transaction(
      actorId,
      async (db) => {
        const where: string[] = [];
        const params: unknown[] = [];

        if (actorFilter) {
          params.push(actorFilter.toLowerCase());
          where.push(`a.actor_id = $${params.length}::uuid`);
        }
        if (targetUserFilter) {
          params.push(targetUserFilter.toLowerCase());
          where.push(`a.target_user_id = $${params.length}::uuid`);
        }
        if (actionFilter) {
          params.push(actionFilter);
          where.push(`a.action = $${params.length}`);
        }
        if (fromDate) {
          params.push(fromDate.toISOString());
          where.push(`a.created_at >= $${params.length}::timestamptz`);
        }
        if (toDate) {
          params.push(toDate.toISOString());
          where.push(`a.created_at <= $${params.length}::timestamptz`);
        }
        if (decodedCursor) {
          params.push(decodedCursor.createdAt);
          const tsIdx = params.length;
          params.push(decodedCursor.id);
          const idIdx = params.length;
          where.push(
            `(a.created_at < $${tsIdx}::timestamptz OR (a.created_at = $${tsIdx}::timestamptz AND a.id < $${idIdx}::uuid))`,
          );
        }

        params.push(limit + 1);
        const limitIdx = params.length;
        const whereClause =
          where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const rows = (await db.query(
          `SELECT a.id,
                  a.actor_id,
                  a.action,
                  a.target_type,
                  a.target_id,
                  a.before_state,
                  a.after_state,
                  a.http_request_id,
                  a.created_at,
                  to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
             FROM public.admin_audit_logs a
             ${whereClause}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT $${limitIdx}`,
          params,
        )) as AuditLogRow[];

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const items: AuditLogDTO[] = pageRows.map((row) => ({
          id: row.id,
          actor_id: row.actor_id ?? null,
          action: row.action,
          target_type: row.target_type ?? null,
          target_id: row.target_id ?? null,
          before: row.before_state ?? null,
          after: row.after_state ?? null,
          request_id: row.http_request_id ?? null,
          created_at: toIsoString(row.created_at),
        }));

        const lastRow = pageRows[pageRows.length - 1];
        const nextCursor =
          hasMore && lastRow
            ? encodeKeysetCursor(
                lastRow.created_at_cursor || toIsoString(lastRow.created_at),
                lastRow.id,
              )
            : null;

        return {
          items,
          meta: {
            limit,
            next_cursor: nextCursor,
          },
        };
      },
      true,
      false,
      true,
    );
  }
}
