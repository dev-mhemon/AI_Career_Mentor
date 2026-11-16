import type { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import type { DatabaseService } from './database.service.js';

export const ORPHAN_ABANDONMENT_WINDOW_MS = 15 * 60 * 1000;

const ABANDONMENT_CUTOFF_SQL = `u.created_at < NOW() - INTERVAL '15 minutes'`;
const ORPHANED_LOOKUP_CONDITION = `(u.deleted_at IS NOT NULL OR (pu.id IS NULL AND ${ABANDONMENT_CUTOFF_SQL}))`;

export interface PurgeOrphanedAuthOptions {
  channel: 'email' | 'phone';
  identifier: string;
  database?: DatabaseService;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  signal?: AbortSignal;
  abuseControl?: Pick<AuthAbuseControl, 'clearContactsState'>;
}

interface StaleAuthUserRow {
  id?: unknown;
  deleted_at?: unknown;
  created_at?: unknown;
  has_app_user?: unknown;
}

interface ContactRow {
  email?: unknown;
  phone?: unknown;
}

function buildLookupSql(channel: 'email' | 'phone'): string {
  const contactPredicate =
    channel === 'email'
      ? `(
           lower(u.email) = $1
           OR lower(p.contact_value) = $1
           OR lower(i.identity_data->>'email') = $1
         )`
      : `(
           u.phone IN ($1, ltrim($1, '+'))
           OR p.contact_value IN ($1, ltrim($1, '+'))
           OR i.identity_data->>'phone' IN ($1, ltrim($1, '+'))
         )`;

  return `SELECT DISTINCT u.id,
                 u.deleted_at,
                 u.created_at,
                 (pu.id IS NOT NULL) AS has_app_user
            FROM auth.users u
            LEFT JOIN public.users pu ON pu.id = u.id
            LEFT JOIN public.user_auth_providers p
              ON p.user_id = u.id AND p.provider = '${channel}'
            LEFT JOIN auth.identities i
              ON i.user_id = u.id
           WHERE ${contactPredicate}
             AND ${ORPHANED_LOOKUP_CONDITION}`;
}

function isAbandonedOrphanRow(
  row: StaleAuthUserRow,
  nowMs = Date.now(),
): boolean {
  if (typeof row?.id !== 'string' || !row.id.trim()) {
    return false;
  }
  if (row.deleted_at !== undefined && row.deleted_at !== null) {
    return true;
  }
  if (row.has_app_user === true) {
    return false;
  }
  if (row.created_at !== undefined && row.created_at !== null) {
    const createdMs =
      row.created_at instanceof Date
        ? row.created_at.getTime()
        : Date.parse(String(row.created_at));
    if (!Number.isFinite(createdMs)) {
      return false;
    }
    return nowMs - createdMs >= ORPHAN_ABANDONMENT_WINDOW_MS;
  }
  return true;
}

/**
 * Finds and hard-deletes deleted or abandoned GoTrue `auth.users` (and `auth.identities`) records
 * matching `identifier` when no active application user owns that contact (`deleted_at IS NOT NULL`,
 * or `public.users` row absent for >= 15 minutes). Returns `true` when at least one stale record was purged.
 */
export async function purgeOrphanedAuthByContact(
  options: PurgeOrphanedAuthOptions,
): Promise<boolean> {
  const {
    channel,
    identifier,
    database,
    supabaseUrl,
    serviceRoleKey,
    signal,
    abuseControl,
  } = options;
  if (typeof database?.query !== 'function') {
    return false;
  }

  const normalized =
    channel === 'email' ? identifier.toLowerCase().trim() : identifier.trim();
  if (!normalized) {
    return false;
  }

  const rows = (await database.query(buildLookupSql(channel), [
    normalized,
  ])) as StaleAuthUserRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const nowMs = Date.now();
  const staleIds = Array.from(
    new Set(
      rows
        .filter((r) => isAbandonedOrphanRow(r, nowMs))
        .map((r) => (typeof r.id === 'string' ? r.id.trim() : ''))
        .filter((id) => id.length > 0),
    ),
  );
  if (staleIds.length === 0) {
    return false;
  }

  const baseUrl = supabaseUrl?.replace(/\/$/, '');
  if (baseUrl && serviceRoleKey) {
    for (const staleId of staleIds) {
      try {
        await fetch(
          `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(staleId)}`,
          {
            method: 'DELETE',
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ should_soft_delete: false }),
            signal,
          },
        );
      } catch {
        // Proceed with SQL hard-delete below so local/dev orphan rows are always cleared.
      }
    }
  }

  const deletedContacts: Array<{
    channel: 'email' | 'phone';
    identifier: string;
  }> = [];
  const seenContacts = new Set<string>();
  const addContact = (
    contactChannel: 'email' | 'phone',
    contactIdentifier: string,
  ) => {
    const key = `${contactChannel}:${contactIdentifier}`;
    if (seenContacts.has(key)) return;
    seenContacts.add(key);
    deletedContacts.push({
      channel: contactChannel,
      identifier: contactIdentifier,
    });
  };
  addContact(
    channel,
    channel === 'phone' && !normalized.startsWith('+')
      ? `+${normalized}`
      : normalized,
  );

  const collectDeletedContacts = (deletedRows: unknown) => {
    if (!Array.isArray(deletedRows)) return;
    for (const row of deletedRows as ContactRow[]) {
      if (typeof row?.email === 'string' && row.email.trim()) {
        addContact('email', row.email.trim().toLowerCase());
      }
      if (typeof row?.phone === 'string' && row.phone.trim()) {
        const p = row.phone.trim();
        addContact('phone', p.startsWith('+') ? p : `+${p}`);
      }
    }
  };

  const runSqlCleanup = async (db: { query: DatabaseService['query'] }) => {
    const deletedPublicRows = await db.query<ContactRow[]>(
      `DELETE FROM public.users WHERE id = ANY($1::uuid[])
         AND EXISTS (
           SELECT 1
             FROM auth.users u
            WHERE u.id = public.users.id
              AND u.deleted_at IS NOT NULL
         )
       RETURNING email, phone`,
      [staleIds],
    );
    collectDeletedContacts(deletedPublicRows);

    const deletedAuthRows = await db.query<ContactRow[]>(
      `WITH target_ids AS (
         SELECT u.id
           FROM auth.users u
          WHERE u.id = ANY($1::uuid[])
            AND (
              u.deleted_at IS NOT NULL
              OR (
                NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = u.id)
                AND ${ABANDONMENT_CUTOFF_SQL}
              )
            )
       ),
       deleted_refresh AS (
         DELETE FROM auth.refresh_tokens
          WHERE user_id IN (SELECT id::text FROM target_ids)
       ),
       deleted_sessions AS (
         DELETE FROM auth.sessions
          WHERE user_id IN (SELECT id FROM target_ids)
       ),
       deleted_identities AS (
         DELETE FROM auth.identities
          WHERE user_id IN (SELECT id FROM target_ids)
       )
       DELETE FROM auth.users
        WHERE id IN (SELECT id FROM target_ids)
        RETURNING email, phone`,
      [staleIds],
    );
    collectDeletedContacts(deletedAuthRows);
  };

  if (typeof database.transaction === 'function') {
    await database.transaction(null, runSqlCleanup, false, false, false);
  } else {
    await runSqlCleanup(database);
  }

  await abuseControl
    ?.clearContactsState?.(deletedContacts, staleIds)
    .catch(() => undefined);

  return true;
}
