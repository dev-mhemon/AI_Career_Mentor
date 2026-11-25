import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { type Feature } from '../../auth/policy.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { maskPhone } from '../../auth/services/textbee-sms.provider.js';
import { fail } from '../../common/http.js';
import {
  ADMIN_FEATURE_KEYS,
  type AdminListUsersQueryDTO,
  type AdminMutationAuditContext,
  type AdminUserDetailDTO,
  type AdminUserFeatureAccessDTO,
  type AdminUserStatusDTO,
  type AdminUserSummaryDTO,
  type PageMetaDTO,
  USER_STATUS_VALUES,
  type UserStatus,
  UUID_PATTERN,
  assertValidAdminReason,
  hasNulOrUnpairedSurrogate,
} from '../dto/admin.dto.js';
import {
  AuditService,
  decodeKeysetCursor,
  encodeKeysetCursor,
} from './audit.service.js';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

interface AdminUserSummaryRow {
  id: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  created_at: Date | string;
  created_at_cursor?: string | null;
  last_active_at: Date | string | null;
  roadmap_count: number | string;
  technology_update_enabled: boolean;
}

interface AdminUserCoreRow {
  id: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  status_reason?: string | null;
  suspended_at?: Date | string | null;
  created_at: Date | string;
  last_active_at: Date | string | null;
}

interface FeatureMatrixRow {
  feature_key: Feature;
  global_enabled: boolean;
  default_user_enabled: boolean;
  user_override: boolean | null;
}

interface UserCountsRow {
  roadmaps: number | string;
  quizzes_submitted: number | string;
  mentor_messages: number | string;
  ai_requests: number | string;
}

/**
 * Masks an email address preserving the first character of the local part and full domain.
 * e.g. `mehedi@example.com` -> `m***@example.com`.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Formats a masked contact identifier for admin views without exposing raw email or phone PII.
 */
export function formatMaskedContact(
  email: string | null | undefined,
  phone: string | null | undefined,
): string {
  const maskedEmail =
    typeof email === 'string' && email.trim().length > 0
      ? maskEmail(email)
      : null;
  const maskedPhone =
    typeof phone === 'string' && phone.trim().length > 0
      ? maskPhone(phone)
      : null;
  if (maskedEmail && maskedPhone) {
    return `${maskedEmail} / ${maskedPhone}`;
  }
  return maskedEmail ?? maskedPhone ?? 'unverified';
}

/**
 * Escapes PostgreSQL LIKE/ILIKE wildcard characters (`\`, `%`, `_`) using `ESCAPE '\'`.
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toNullableIsoString(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return toIsoString(value);
}

/**
 * Acquires the exact same per-user advisory lock pair used by `DatabaseService.transaction`
 * across all user IDs in deterministic ascending UUID order to prevent AB-BA lock inversion.
 */
export async function lockUsersInDeterministicOrder(
  db: Pick<EntityManager, 'query'>,
  userIds: string[],
): Promise<string[]> {
  const sortedUnique = Array.from(
    new Set(userIds.map((id) => id.trim().toLowerCase())),
  ).sort();
  for (const uid of sortedUnique) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      uid,
    ]);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [uid]);
  }
  return sortedUnique;
}

/**
 * Verifies inside an open transaction that the acting admin remains active and listed
 * in `public.admin_users` (`role = 'platform_admin'`).
 */
export async function assertActiveAdminInTx(
  db: Pick<EntityManager, 'query'>,
  actorId: string,
): Promise<void> {
  const rows = (await db.query(
    `SELECT u.status,
            EXISTS (
              SELECT 1
                FROM public.admin_users au
               WHERE au.user_id = u.id
                 AND au.role = 'platform_admin'
            ) AS is_admin
       FROM public.users u
      WHERE u.id = $1`,
    [actorId],
  )) as Array<{ status: UserStatus; is_admin: boolean }>;

  const actor = rows[0];
  if (!actor) {
    fail(401, 'AUTH_REQUIRED', 'Application account required');
  }
  if (actor.status !== 'active') {
    fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
  }
  if (!actor.is_admin) {
    fail(403, 'ADMIN_REQUIRED', 'Administrator access required');
  }
}

/**
 * Loads `AdminUserDetailDTO` inside an existing transaction using aggregate counts only
 * (zero mentor text, summaries, AI context, or raw quiz answers per `PRD §51` / `R11`).
 */
export async function loadAdminUserDetailInTx(
  db: Pick<EntityManager, 'query'>,
  targetUserId: string,
): Promise<AdminUserDetailDTO> {
  const userRows = (await db.query(
    `SELECT u.id,
            u.email,
            u.phone,
            u.status,
            u.created_at,
            u.last_active_at
       FROM public.users u
      WHERE u.id = $1`,
    [targetUserId],
  )) as AdminUserCoreRow[];

  const user = userRows[0];
  if (!user) {
    fail(404, 'RESOURCE_NOT_FOUND', 'User not found');
  }

  const featureRows = (await db.query(
    `SELECT fc.feature_key,
            fc.enabled AS global_enabled,
            fc.default_user_enabled,
            uao.enabled AS user_override
       FROM public.feature_controls fc
       LEFT JOIN public.user_access_overrides uao
         ON uao.feature_key = fc.feature_key
        AND uao.user_id = $1`,
    [targetUserId],
  )) as FeatureMatrixRow[];

  const featureByKey = new Map<Feature, FeatureMatrixRow>();
  for (const row of featureRows) {
    featureByKey.set(row.feature_key, row);
  }

  const isActive = user.status === 'active';
  const featureAccess: AdminUserFeatureAccessDTO[] = ADMIN_FEATURE_KEYS.map(
    (featureKey) => {
      const row = featureByKey.get(featureKey);
      const globalEnabled = Boolean(row?.global_enabled);
      const defaultUserEnabled =
        row?.default_user_enabled ?? featureKey !== 'technology_update';
      const userOverride =
        row?.user_override === null || row?.user_override === undefined
          ? null
          : Boolean(row.user_override);
      const effective =
        isActive && globalEnabled && (userOverride ?? defaultUserEnabled);
      return {
        feature_key: featureKey,
        global_enabled: globalEnabled,
        user_override: userOverride,
        effective,
      };
    },
  );

  const countsRows = (await db.query(
    `SELECT (SELECT COUNT(*)::int FROM public.roadmaps WHERE user_id = $1) AS roadmaps,
            (SELECT COUNT(*)::int FROM public.quiz_attempts WHERE user_id = $1 AND submitted_at IS NOT NULL) AS quizzes_submitted,
            (SELECT COUNT(*)::int FROM public.messages WHERE user_id = $1) AS mentor_messages,
            (SELECT COUNT(*)::int FROM public.ai_requests WHERE user_id = $1) AS ai_requests`,
    [targetUserId],
  )) as UserCountsRow[];

  const rawCounts = countsRows[0];
  const counts = {
    roadmaps: Number(rawCounts?.roadmaps ?? 0),
    quizzes_submitted: Number(rawCounts?.quizzes_submitted ?? 0),
    mentor_messages: Number(rawCounts?.mentor_messages ?? 0),
    ai_requests: Number(rawCounts?.ai_requests ?? 0),
  };

  const techEntry = featureAccess.find(
    (entry) => entry.feature_key === 'technology_update',
  );

  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
    contact_masked: formatMaskedContact(user.email, user.phone),
    status: user.status,
    created_at: toIsoString(user.created_at),
    last_active_at: toNullableIsoString(user.last_active_at),
    roadmap_count: counts.roadmaps,
    technology_update_enabled: Boolean(techEntry?.effective),
    feature_access: featureAccess,
    counts,
  };
}

/**
 * Handles `EP-AD01` (List Users), `EP-AD02` (Get User Detail), and `EP-AD03` (Suspend / Reactivate User).
 */
@Injectable()
export class AdminUserService {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
  ) {}

  /**
   * `EP-AD01` (`GET /api/v1/admin/users`, `200 OK`).
   */
  async listUsers(
    actorId: string,
    query?: AdminListUsersQueryDTO,
  ): Promise<{ items: AdminUserSummaryDTO[]; meta: PageMetaDTO }> {
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

    const status = query?.status;
    if (status !== undefined && !USER_STATUS_VALUES.includes(status)) {
      fail(422, 'VALIDATION_FAILED', 'Invalid status filter', [
        {
          field: 'status',
          code: 'INVALID_ENUM_VALUE',
          message: 'status must be active or suspended',
        },
      ]);
    }

    const rawQ = query?.q?.trim();
    if (
      rawQ !== undefined &&
      (rawQ.length > 255 || hasNulOrUnpairedSurrogate(rawQ))
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid search query', [
        {
          field: 'q',
          code: 'VALIDATION_FAILED',
          message: 'q must be a valid string of at most 255 characters',
        },
      ]);
    }

    const decodedCursor = query?.cursor
      ? decodeKeysetCursor(query.cursor.trim())
      : null;

    return this.database.transaction(
      actorId,
      async (db) => {
        const where: string[] = [
          'NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = u.id)',
        ];
        const params: unknown[] = [];

        if (rawQ && rawQ.length > 0) {
          if (UUID_PATTERN.test(rawQ)) {
            params.push(rawQ.toLowerCase());
            where.push(`u.id = $${params.length}::uuid`);
          } else {
            params.push(`%${escapeLikePattern(rawQ)}%`);
            const idx = params.length;
            where.push(
              `(COALESCE(u.email::text, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(u.phone, '') ILIKE $${idx} ESCAPE '\\')`,
            );
          }
        }

        if (status) {
          params.push(status);
          where.push(`u.status = $${params.length}::public.user_status`);
        }

        if (decodedCursor) {
          params.push(decodedCursor.createdAt);
          const tsIdx = params.length;
          params.push(decodedCursor.id);
          const idIdx = params.length;
          where.push(
            `(u.created_at < $${tsIdx}::timestamptz OR (u.created_at = $${tsIdx}::timestamptz AND u.id < $${idIdx}::uuid))`,
          );
        }

        params.push(limit + 1);
        const limitIdx = params.length;
        const whereClause =
          where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const rows = (await db.query(
          `SELECT u.id,
                  u.email,
                  u.phone,
                  u.status,
                  u.created_at,
                  to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
                  u.last_active_at,
                  COALESCE(rc.roadmap_count, 0)::int AS roadmap_count,
                  (
                    u.status = 'active'
                    AND COALESCE(fc.enabled, false)
                    AND COALESCE(uao.enabled, fc.default_user_enabled, false)
                  ) AS technology_update_enabled
             FROM public.users u
             LEFT JOIN LATERAL (
               SELECT COUNT(*)::int AS roadmap_count
                 FROM public.roadmaps r
                WHERE r.user_id = u.id
             ) rc ON true
             LEFT JOIN public.feature_controls fc
               ON fc.feature_key = 'technology_update'::public.feature_key
             LEFT JOIN public.user_access_overrides uao
               ON uao.user_id = u.id
              AND uao.feature_key = 'technology_update'::public.feature_key
             ${whereClause}
            ORDER BY u.created_at DESC, u.id DESC
            LIMIT $${limitIdx}`,
          params,
        )) as AdminUserSummaryRow[];

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const items: AdminUserSummaryDTO[] = pageRows.map((row) => ({
          id: row.id,
          email: row.email ?? null,
          phone: row.phone ?? null,
          contact_masked: formatMaskedContact(row.email, row.phone),
          status: row.status,
          created_at: toIsoString(row.created_at),
          last_active_at: toNullableIsoString(row.last_active_at),
          roadmap_count: Number(row.roadmap_count ?? 0),
          technology_update_enabled: Boolean(row.technology_update_enabled),
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

  /**
   * `EP-AD02` (`GET /api/v1/admin/users/{id}`, `200 OK`).
   */
  async getUserDetail(
    actorId: string,
    targetUserId: string,
  ): Promise<AdminUserDetailDTO> {
    const normalizedTargetId = this.assertValidUserId(targetUserId);
    return this.database.transaction(
      actorId,
      async (db) => loadAdminUserDetailInTx(db, normalizedTargetId),
      true,
      false,
      true,
    );
  }

  /**
   * `EP-AD03` (`PATCH /api/v1/admin/users/{id}`, `200 OK`):
   * Atomically suspends or reactivates a non-admin user while preserving all learner data
   * and recording an immutable audit entry.
   */
  async updateUserStatus(
    actorId: string,
    targetUserId: string,
    dto: AdminUserStatusDTO,
    auditContext: AdminMutationAuditContext,
  ): Promise<AdminUserDetailDTO> {
    const normalizedActorId = actorId.trim().toLowerCase();
    const normalizedTargetId = this.assertValidUserId(targetUserId);

    if (!USER_STATUS_VALUES.includes(dto?.status)) {
      fail(422, 'VALIDATION_FAILED', 'Invalid user status', [
        {
          field: 'status',
          code: 'INVALID_ENUM_VALUE',
          message: 'status must be active or suspended',
        },
      ]);
    }
    const trimmedReason = assertValidAdminReason(dto?.reason);

    return this.database.transaction(
      null,
      async (db) => {
        const sortedLockIds = await lockUsersInDeterministicOrder(db, [
          normalizedActorId,
          normalizedTargetId,
        ]);

        // Lock public.users rows in ascending UUID order to avoid AB-BA row lock cycles.
        const lockedRows = (await db.query(
          `SELECT id, status, status_reason, suspended_at, suspended_by
             FROM public.users
            WHERE id = ANY($1::uuid[])
            ORDER BY id ASC
              FOR UPDATE`,
          [sortedLockIds],
        )) as Array<{
          id: string;
          status: UserStatus;
          status_reason: string | null;
          suspended_at: Date | string | null;
          suspended_by: string | null;
        }>;

        await assertActiveAdminInTx(db, normalizedActorId);

        const target = lockedRows.find(
          (row) => row.id.toLowerCase() === normalizedTargetId,
        );
        if (!target) {
          fail(404, 'RESOURCE_NOT_FOUND', 'User not found');
        }

        const adminTargetRows = (await db.query(
          'SELECT 1 FROM public.admin_users WHERE user_id = $1 LIMIT 1',
          [normalizedTargetId],
        )) as Array<Record<string, unknown>>;

        if (adminTargetRows.length > 0) {
          fail(
            403,
            'CANNOT_MODIFY_ADMIN',
            'Administrator accounts cannot be modified via this endpoint',
          );
        }

        if (target.status === dto.status) {
          fail(
            409,
            'STATUS_UNCHANGED',
            `User is already in status ${dto.status}`,
          );
        }

        if (dto.status === 'suspended') {
          await db.query(
            `UPDATE public.users
                SET status = 'suspended'::public.user_status,
                    status_reason = $2,
                    suspended_at = now(),
                    suspended_by = $3,
                    updated_at = now()
              WHERE id = $1`,
            [normalizedTargetId, trimmedReason, normalizedActorId],
          );
        } else {
          await db.query(
            `UPDATE public.users
                SET status = 'active'::public.user_status,
                    status_reason = NULL,
                    suspended_at = NULL,
                    suspended_by = NULL,
                    updated_at = now()
              WHERE id = $1`,
            [normalizedTargetId],
          );
        }

        await this.auditService.recordInTx(db, {
          actorId: normalizedActorId,
          action:
            dto.status === 'suspended' ? 'user.suspend' : 'user.reactivate',
          targetType: 'user',
          targetId: normalizedTargetId,
          targetUserId: normalizedTargetId,
          beforeState: {
            status: target.status,
            suspended_at: toNullableIsoString(target.suspended_at),
          },
          afterState: {
            status: dto.status,
            reason: trimmedReason,
          },
          requestId: auditContext.requestId,
          ipAddress: auditContext.ipAddress,
        });

        return loadAdminUserDetailInTx(db, normalizedTargetId);
      },
      false,
      false,
      true,
    );
  }

  private assertValidUserId(id: string): string {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id.trim())) {
      fail(400, 'INVALID_FORMAT', 'User id must be a valid UUID', [
        {
          field: 'id',
          code: 'INVALID_FORMAT',
          message: 'id must be a valid UUID',
        },
      ]);
    }
    return id.trim().toLowerCase();
  }
}
