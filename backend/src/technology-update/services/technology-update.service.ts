import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import type {
  ActionTiming,
  ListTechnologyUpdatesQueryDTO,
  PageMetaDTO,
  ReleaseStatus,
  RelevanceLevel,
  TechnologyUpdateDTO,
  TechnologyUpdateListDTO,
  TechnologyUpdateViewedDTO,
  UpdateState,
} from '../dto/technology-update.dto.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const PG_CURSOR_TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4])(?::?[0-5]\d)?|[+-]15(?::?00)?)$/;

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

export const NO_IMPORTANT_CHANGES_MESSAGE =
  'No important changes for your current learning path today.';
export const TEMPORARILY_UNAVAILABLE_MESSAGE =
  'Technology updates are temporarily unavailable.';

function failInvalidCursor(message = 'Invalid pagination cursor'): never {
  fail(422, 'INVALID_FORMAT', message, [
    {
      field: 'cursor',
      code: 'INVALID_FORMAT',
      message,
    },
  ]);
}

function assertRealCalendarDate(
  year: number,
  month: number,
  day: number,
): void {
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    failInvalidCursor('cursor contains an impossible calendar date');
  }
}

/**
 * Validates a `YYYY-MM-DD` date string and ensures it represents a real calendar date
 * (rejecting impossible dates like `2026-02-31` with `422 INVALID_FORMAT`).
 */
export function assertValidCursorDate(raw: unknown): string {
  if (typeof raw !== 'string') {
    failInvalidCursor();
  }
  const trimmed = raw.trim();
  const match = CALENDAR_DATE_PATTERN.exec(trimmed);
  if (!match) {
    failInvalidCursor();
  }
  assertRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return trimmed;
}

/**
 * Validates a microsecond-preserving PostgreSQL UTC timestamp string inside an opaque cursor
 * and verifies its calendar date is real (`422 INVALID_FORMAT` on impossible dates).
 */
export function assertValidCursorTimestamptz(raw: unknown): string {
  if (typeof raw !== 'string') {
    failInvalidCursor();
  }
  const trimmed = raw.trim();
  const match = PG_CURSOR_TIMESTAMPTZ_PATTERN.exec(trimmed);
  if (!match) {
    failInvalidCursor();
  }
  assertRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (Number.isNaN(Date.parse(trimmed))) {
    failInvalidCursor();
  }
  return trimmed;
}

export interface DecodedTechnologyUpdateCursor {
  localDate: string;
  deliveredAt: string;
  id: string;
}

export function encodeTechnologyUpdateCursor(
  cursor: DecodedTechnologyUpdateCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      local_date: cursor.localDate,
      delivered_at: cursor.deliveredAt,
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeTechnologyUpdateCursor(
  rawCursor: string,
): DecodedTechnologyUpdateCursor {
  const trimmed = rawCursor.trim();
  if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    failInvalidCursor();
  }
  let parsed: unknown;
  try {
    const json = Buffer.from(trimmed, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    failInvalidCursor();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failInvalidCursor();
  }
  const rec = parsed as Record<string, unknown>;
  const localDate = assertValidCursorDate(rec.local_date);
  const deliveredAt = assertValidCursorTimestamptz(rec.delivered_at);
  if (typeof rec.id !== 'string' || !UUID_PATTERN.test(rec.id.trim())) {
    failInvalidCursor();
  }
  return {
    localDate,
    deliveredAt,
    id: rec.id.trim().toLowerCase(),
  };
}

function assertValidUuidParam(rawId: unknown, field = 'id'): string {
  if (typeof rawId !== 'string' || !UUID_PATTERN.test(rawId.trim())) {
    fail(422, 'INVALID_FORMAT', `Invalid ${field} UUID`, [
      {
        field,
        code: 'INVALID_FORMAT',
        message: `${field} must be a valid UUID`,
      },
    ]);
  }
  return rawId.trim().toLowerCase();
}

function normalizePageLimit(limit?: number): number {
  if (limit === undefined || limit === null) {
    return DEFAULT_PAGE_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
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
  return limit;
}

function toIsoString(val: Date | string): string {
  if (val instanceof Date) {
    return val.toISOString();
  }
  const trimmed = String(val).trim();
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

function toDateOnlyString(val: Date | string): string {
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  const trimmed = String(val).trim();
  return trimmed.slice(0, 10);
}

/**
 * Unwraps TypeORM PostgreSQL `UPDATE ... RETURNING` tuple `[rows, rowCount]` into a plain row array.
 */
function extractReturningRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  if (
    raw.length === 2 &&
    Array.isArray(raw[0]) &&
    (typeof raw[1] === 'number' || raw[1] === null || raw[1] === undefined)
  ) {
    return raw[0] as T[];
  }
  return raw as T[];
}

interface TodayDeliveryStateRow {
  current_local_date: string;
  today_state: UpdateState | null;
}

interface DeliveredTechnologyUpdateRow {
  id: string;
  local_date: Date | string;
  title: string;
  what_changed: string;
  why_it_matters: string;
  publisher: string;
  source_url: string;
  fetched_at: Date | string;
  release_status: ReleaseStatus;
  relevance: RelevanceLevel;
  action_timing: ActionTiming;
  roadmap_relation: string | null;
  viewed: boolean;
  delivered_at?: Date | string;
  delivered_at_cursor?: string | null;
  delivery_id?: string;
}

interface ViewedUpdateReturningRow {
  id: string;
  viewed_at: Date | string;
}

function mapRowToTechnologyUpdateDto(
  row: DeliveredTechnologyUpdateRow,
): TechnologyUpdateDTO {
  return {
    id: row.id,
    local_date: toDateOnlyString(row.local_date),
    title: row.title,
    what_changed: row.what_changed,
    why_it_matters: row.why_it_matters,
    publisher: row.publisher,
    source_url: row.source_url,
    fetched_at: toIsoString(row.fetched_at),
    release_status: row.release_status,
    relevance: row.relevance,
    action_timing: row.action_timing,
    roadmap_relation: row.roadmap_relation ?? null,
    viewed: Boolean(row.viewed),
  };
}

function resolveTodayStatus(todayState: UpdateState | null | undefined): {
  today_state: UpdateState | null;
  generation_pending: boolean;
  message: string | null;
} {
  if (!todayState) {
    return {
      today_state: null,
      generation_pending: true,
      message: null,
    };
  }
  switch (todayState) {
    case 'available':
      return {
        today_state: 'available',
        generation_pending: false,
        message: null,
      };
    case 'no_important_changes':
      return {
        today_state: 'no_important_changes',
        generation_pending: false,
        message: NO_IMPORTANT_CHANGES_MESSAGE,
      };
    case 'temporarily_unavailable':
      return {
        today_state: 'temporarily_unavailable',
        generation_pending: false,
        message: TEMPORARILY_UNAVAILABLE_MESSAGE,
      };
  }
}

/**
 * Service implementing `C05` §14.11 Technology Update API (`EP-T01`–`EP-T03`)
 * and `R24` / `R25` read-only delivery state invariants.
 */
@Injectable()
export class TechnologyUpdateService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  /**
   * `EP-T01` (`GET /api/v1/technology-updates`):
   * Lists delivered technology updates for `userId` and resolves today's delivery state
   * in the user's saved timezone (`COALESCE(up.timezone, 'Asia/Dhaka')`).
   *
   * Note (`R24` / `N01`): Executes with `foreground = false` so passive dashboard preview
   * fetches never advance `users.last_active_at`.
   */
  async listUpdates(
    userId: string,
    query?: ListTechnologyUpdatesQueryDTO,
  ): Promise<{ data: TechnologyUpdateListDTO; meta: PageMetaDTO }> {
    const normalizedUserId = assertValidUuidParam(userId, 'user_id');
    const limit = normalizePageLimit(query?.limit);
    const decodedCursor =
      query?.cursor !== undefined
        ? decodeTechnologyUpdateCursor(query.cursor)
        : null;

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const [todayRow] = await db.query<TodayDeliveryStateRow[]>(
          `SELECT
             to_char((clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date, 'YYYY-MM-DD') AS current_local_date,
             d.state AS today_state
           FROM public.users u
           LEFT JOIN public.user_profiles up ON up.user_id = u.id
           LEFT JOIN public.update_delivery_history d
             ON d.user_id = u.id
            AND d.local_date = (clock_timestamp() AT TIME ZONE COALESCE(up.timezone, 'Asia/Dhaka'))::date
          WHERE u.id = $1`,
          [normalizedUserId],
        );

        const statusSummary = resolveTodayStatus(todayRow?.today_state ?? null);

        const rows = await db.query<DeliveredTechnologyUpdateRow[]>(
          `SELECT
             tu.id,
             to_char(d.local_date, 'YYYY-MM-DD') AS local_date,
             tu.title,
             tu.what_changed,
             uur.why_it_matters,
             tu.publisher,
             tu.source_url,
             tu.fetched_at,
             tu.release_status,
             uur.relevance,
             uur.action_timing,
             uur.roadmap_relation,
             (d.viewed_at IS NOT NULL) AS viewed,
             d.delivered_at,
             to_char(d.delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS delivered_at_cursor,
             d.id AS delivery_id
           FROM public.update_delivery_history d
           INNER JOIN public.technology_updates tu ON tu.id = d.update_id
           INNER JOIN public.user_update_relevance uur
             ON uur.user_id = d.user_id
            AND uur.update_id = tu.id
          WHERE d.user_id = $1
            AND d.state = 'available'::public.update_state
            AND (
              $2::date IS NULL
              OR (d.local_date, d.delivered_at, d.id) < ($2::date, $3::timestamptz, $4::uuid)
            )
          ORDER BY d.local_date DESC, d.delivered_at DESC, d.id DESC
          LIMIT $5`,
          [
            normalizedUserId,
            decodedCursor?.localDate ?? null,
            decodedCursor?.deliveredAt ?? null,
            decodedCursor?.id ?? null,
            limit + 1,
          ],
        );

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows[pageRows.length - 1];
        const nextCursor =
          hasMore && lastRow
            ? encodeTechnologyUpdateCursor({
                localDate: toDateOnlyString(lastRow.local_date),
                deliveredAt:
                  typeof lastRow.delivered_at_cursor === 'string' &&
                  lastRow.delivered_at_cursor.trim()
                    ? lastRow.delivered_at_cursor.trim()
                    : toIsoString(lastRow.delivered_at ?? lastRow.fetched_at),
                id: (lastRow.delivery_id ?? lastRow.id).toLowerCase(),
              })
            : null;

        return {
          data: {
            today_state: statusSummary.today_state,
            generation_pending: statusSummary.generation_pending,
            message: statusSummary.message,
            items: pageRows.map(mapRowToTechnologyUpdateDto),
          },
          meta: {
            limit,
            next_cursor: nextCursor,
          },
        };
      },
      true,
      false,
    );
  }

  /**
   * `EP-T02` (`GET /api/v1/technology-updates/{id}`):
   * Returns a single technology update ONLY if delivered to `userId` (`state = 'available'`).
   * Executes with `foreground = true` (`R24` 5-min coalesced `users.last_active_at`).
   */
  async getUpdate(
    userId: string,
    updateId: string,
  ): Promise<TechnologyUpdateDTO> {
    const normalizedUserId = assertValidUuidParam(userId, 'user_id');
    const normalizedUpdateId = assertValidUuidParam(updateId, 'id');

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const [row] = await db.query<DeliveredTechnologyUpdateRow[]>(
          `SELECT
             tu.id,
             to_char(d.local_date, 'YYYY-MM-DD') AS local_date,
             tu.title,
             tu.what_changed,
             uur.why_it_matters,
             tu.publisher,
             tu.source_url,
             tu.fetched_at,
             tu.release_status,
             uur.relevance,
             uur.action_timing,
             uur.roadmap_relation,
             (d.viewed_at IS NOT NULL) AS viewed
           FROM public.update_delivery_history d
           INNER JOIN public.technology_updates tu ON tu.id = d.update_id
           INNER JOIN public.user_update_relevance uur
             ON uur.user_id = d.user_id
            AND uur.update_id = tu.id
          WHERE d.user_id = $1
            AND d.update_id = $2::uuid
            AND d.state = 'available'::public.update_state
          LIMIT 1`,
          [normalizedUserId, normalizedUpdateId],
        );

        if (!row) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Technology update not found');
        }

        return mapRowToTechnologyUpdateDto(row);
      },
      true,
      true,
    );
  }

  /**
   * `EP-T03` (`POST /api/v1/technology-updates/{id}/view`):
   * Idempotently marks a delivered technology update as viewed (`COALESCE(viewed_at, clock_timestamp())`).
   * Executes with `foreground = true` (`R24` 5-min coalesced `users.last_active_at`).
   */
  async markUpdateViewed(
    userId: string,
    updateId: string,
  ): Promise<TechnologyUpdateViewedDTO> {
    const normalizedUserId = assertValidUuidParam(userId, 'user_id');
    const normalizedUpdateId = assertValidUuidParam(updateId, 'id');

    return this.database.transaction(
      normalizedUserId,
      async (db) => {
        const rawResult = await db.query(
          `UPDATE public.update_delivery_history
              SET viewed_at = COALESCE(viewed_at, clock_timestamp())
            WHERE user_id = $1
              AND update_id = $2::uuid
              AND state = 'available'::public.update_state
            RETURNING update_id AS id, viewed_at`,
          [normalizedUserId, normalizedUpdateId],
        );

        const rows = extractReturningRows<ViewedUpdateReturningRow>(rawResult);
        const updated = rows[0];
        if (!updated) {
          fail(404, 'RESOURCE_NOT_FOUND', 'Technology update not found');
        }

        return {
          id: updated.id,
          viewed: true,
          viewed_at: toIsoString(updated.viewed_at),
        };
      },
      true,
      true,
    );
  }
}
