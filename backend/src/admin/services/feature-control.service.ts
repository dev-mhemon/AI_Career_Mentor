import { Inject, Injectable } from '@nestjs/common';
import { type Feature } from '../../auth/policy.js';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  ADMIN_FEATURE_KEYS,
  type AdminMutationAuditContext,
  type AdminUserDetailDTO,
  type FeatureControlDTO,
  type FeatureToggleDTO,
  type UserFeatureToggleDTO,
  UUID_PATTERN,
  assertKnownFeatureKey,
} from '../dto/admin.dto.js';
import {
  assertActiveAdminInTx,
  loadAdminUserDetailInTx,
  lockUsersInDeterministicOrder,
} from './admin-user.service.js';
import { AuditService } from './audit.service.js';

interface FeatureControlRow {
  feature_key: Feature;
  enabled: boolean;
  updated_at: Date | string;
  updated_by: string | null;
}

interface UserOverrideRow {
  id: string;
  enabled: boolean;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Normalizes TypeORM PostgreSQL `query()` return shapes across `SELECT`/`INSERT RETURNING`
 * (`Row[]`) and `UPDATE`/`DELETE RETURNING` (`[Row[], affectedCount]`).
 */
function extractReturnedRow<T>(result: unknown): T | undefined {
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const first: unknown = result[0];
  if (Array.isArray(first)) {
    return first[0] as T | undefined;
  }
  return first as T | undefined;
}

function mapFeatureControlRow(row: FeatureControlRow): FeatureControlDTO {
  return {
    feature_key: row.feature_key,
    enabled: Boolean(row.enabled),
    updated_at: toIsoString(row.updated_at),
    updated_by: row.updated_by ?? null,
  };
}

/**
 * Handles `EP-AD04` (List Global Features), `EP-AD05` (Set Global Feature),
 * and `EP-AD06` (Set Per-User Feature Access).
 */
@Injectable()
export class FeatureControlService {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
    @Inject(AuditService)
    private readonly auditService: AuditService,
  ) {}

  /**
   * `EP-AD04` (`GET /api/v1/admin/features`, `200 OK`):
   * Lists all 7 global feature controls ordered deterministically by canonical feature key order.
   */
  async listGlobalFeatures(actorId: string): Promise<FeatureControlDTO[]> {
    return this.database.transaction(
      actorId,
      async (db) => {
        const rows = (await db.query(
          `SELECT feature_key, enabled, updated_at, updated_by
             FROM public.feature_controls`,
        )) as FeatureControlRow[];

        const orderIndex = new Map<string, number>(
          ADMIN_FEATURE_KEYS.map((key, idx) => [key, idx]),
        );

        return [...rows]
          .sort(
            (a, b) =>
              (orderIndex.get(a.feature_key) ?? Number.MAX_SAFE_INTEGER) -
              (orderIndex.get(b.feature_key) ?? Number.MAX_SAFE_INTEGER),
          )
          .map(mapFeatureControlRow);
      },
      true,
      false,
      true,
    );
  }

  /**
   * `EP-AD05` (`PATCH /api/v1/admin/features`, `200 OK`):
   * Updates global feature availability without deleting any existing user data (`PRD §7`).
   */
  async setGlobalFeature(
    actorId: string,
    dto: FeatureToggleDTO,
    auditContext: AdminMutationAuditContext,
  ): Promise<FeatureControlDTO> {
    const normalizedActorId = actorId.trim().toLowerCase();
    const featureKey = assertKnownFeatureKey(dto?.feature_key);
    if (typeof dto?.enabled !== 'boolean') {
      fail(422, 'VALIDATION_FAILED', 'enabled must be a boolean', [
        {
          field: 'enabled',
          code: 'VALIDATION_FAILED',
          message: 'enabled must be true or false',
        },
      ]);
    }

    return this.database.transaction(
      normalizedActorId,
      async (db) => {
        await assertActiveAdminInTx(db, normalizedActorId);

        const existingRows = (await db.query(
          `SELECT feature_key, enabled, updated_at, updated_by
             FROM public.feature_controls
            WHERE feature_key = $1::public.feature_key
              FOR UPDATE`,
          [featureKey],
        )) as FeatureControlRow[];

        const previous = existingRows[0];
        if (!previous) {
          fail(422, 'UNKNOWN_FEATURE', `Unknown feature_key: ${featureKey}`, [
            {
              field: 'feature_key',
              code: 'UNKNOWN_FEATURE',
              message: 'feature_key is not configured',
            },
          ]);
        }

        const updatedResult: unknown = await db.query(
          `UPDATE public.feature_controls
              SET enabled = $2,
                  updated_by = $3,
                  updated_at = now()
            WHERE feature_key = $1::public.feature_key
        RETURNING feature_key, enabled, updated_at, updated_by`,
          [featureKey, dto.enabled, normalizedActorId],
        );

        const updated = extractReturnedRow<FeatureControlRow>(updatedResult);
        if (!updated) {
          fail(
            500,
            'INTERNAL_ERROR',
            `Failed to update feature_key: ${featureKey}`,
          );
        }

        await this.auditService.recordInTx(db, {
          actorId: normalizedActorId,
          action: 'feature.global_update',
          targetType: 'feature_control',
          targetId: null,
          targetUserId: null,
          beforeState: {
            feature_key: featureKey,
            enabled: Boolean(previous.enabled),
          },
          afterState: {
            feature_key: featureKey,
            enabled: dto.enabled,
          },
          requestId: auditContext.requestId,
          ipAddress: auditContext.ipAddress,
        });

        return mapFeatureControlRow(updated);
      },
      true,
      false,
      true,
    );
  }

  /**
   * `EP-AD06` (`PATCH /api/v1/admin/users/{id}/features`, `200 OK`):
   * Sets or removes (`enabled: null`) a per-user override in `public.user_access_overrides`.
   * User overrides never beat a global OFF or account suspension (`PRD §7`).
   */
  async setUserFeature(
    actorId: string,
    targetUserId: string,
    dto: UserFeatureToggleDTO,
    auditContext: AdminMutationAuditContext,
  ): Promise<AdminUserDetailDTO> {
    const normalizedActorId = actorId.trim().toLowerCase();
    if (
      typeof targetUserId !== 'string' ||
      !UUID_PATTERN.test(targetUserId.trim())
    ) {
      fail(400, 'INVALID_FORMAT', 'User id must be a valid UUID', [
        {
          field: 'id',
          code: 'INVALID_FORMAT',
          message: 'id must be a valid UUID',
        },
      ]);
    }
    const normalizedTargetId = targetUserId.trim().toLowerCase();
    const featureKey = assertKnownFeatureKey(dto?.feature_key);

    if (dto?.enabled !== null && typeof dto?.enabled !== 'boolean') {
      fail(422, 'VALIDATION_FAILED', 'enabled must be a boolean or null', [
        {
          field: 'enabled',
          code: 'VALIDATION_FAILED',
          message: 'enabled must be true, false, or null',
        },
      ]);
    }

    return this.database.transaction(
      null,
      async (db) => {
        const sortedLockIds = await lockUsersInDeterministicOrder(db, [
          normalizedActorId,
          normalizedTargetId,
        ]);

        const lockedUsers = (await db.query(
          `SELECT id
             FROM public.users
            WHERE id = ANY($1::uuid[])
            ORDER BY id ASC
              FOR UPDATE`,
          [sortedLockIds],
        )) as Array<{ id: string }>;

        await assertActiveAdminInTx(db, normalizedActorId);

        const targetExists = lockedUsers.some(
          (row) => row.id.toLowerCase() === normalizedTargetId,
        );
        if (!targetExists) {
          fail(404, 'RESOURCE_NOT_FOUND', 'User not found');
        }

        const priorRows = (await db.query(
          `SELECT id, enabled
             FROM public.user_access_overrides
            WHERE user_id = $1
              AND feature_key = $2::public.feature_key
              FOR UPDATE`,
          [normalizedTargetId, featureKey],
        )) as UserOverrideRow[];

        const prior = priorRows[0];
        const previousOverride: boolean | null = prior
          ? Boolean(prior.enabled)
          : null;

        let auditTargetId: string = prior?.id ?? normalizedTargetId;

        if (dto.enabled === null) {
          await db.query(
            `DELETE FROM public.user_access_overrides
              WHERE user_id = $1
                AND feature_key = $2::public.feature_key`,
            [normalizedTargetId, featureKey],
          );
        } else {
          const upsertedResult: unknown = await db.query(
            `INSERT INTO public.user_access_overrides (
               user_id,
               feature_key,
               enabled,
               updated_by
             ) VALUES ($1, $2::public.feature_key, $3, $4)
             ON CONFLICT (user_id, feature_key) DO UPDATE
               SET enabled = EXCLUDED.enabled,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()
         RETURNING id`,
            [normalizedTargetId, featureKey, dto.enabled, normalizedActorId],
          );
          const upserted = extractReturnedRow<{ id: string }>(upsertedResult);
          if (upserted?.id) {
            auditTargetId = upserted.id;
          }
        }

        await this.auditService.recordInTx(db, {
          actorId: normalizedActorId,
          action:
            dto.enabled === null
              ? 'feature.user_override_clear'
              : 'feature.user_override_set',
          targetType: 'user_access_override',
          targetId: auditTargetId,
          targetUserId: normalizedTargetId,
          beforeState: {
            feature_key: featureKey,
            user_override: previousOverride,
          },
          afterState: {
            feature_key: featureKey,
            user_override: dto.enabled,
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
}
