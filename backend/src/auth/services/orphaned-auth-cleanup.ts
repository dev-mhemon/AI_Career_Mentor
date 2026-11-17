import type {
  AuthAbuseControl,
  Contact,
} from '../abuse-control/abuse-control.service.js';
import type { DatabaseService } from './database.service.js';

export const ORPHAN_ABANDONMENT_WINDOW_MS = 15 * 60 * 1000;

const ABANDONMENT_CUTOFF_SQL = `COALESCE(u.created_at, NOW()) < NOW() - INTERVAL '15 minutes'`;
export const OAUTH_PROVIDER_MATCH_SQL = `(
  lower(COALESCE(u.raw_app_meta_data->>'provider', '')) IN ('google', 'facebook')
  OR EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array'
            THEN u.raw_app_meta_data->'providers'
          ELSE '[]'::jsonb
        END
      ) p_el
     WHERE lower(p_el) IN ('google', 'facebook')
  )
  OR EXISTS (
    SELECT 1
      FROM auth.identities oi
     WHERE oi.user_id = u.id
       AND lower(oi.provider) IN ('google', 'facebook')
  )
)`;
const OAUTH_PROTECTED_USER_SQL = `(
  (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL)
  AND ${OAUTH_PROVIDER_MATCH_SQL}
)`;
const ORPHANED_LOOKUP_CONDITION = `(u.deleted_at IS NOT NULL OR (pu.id IS NULL AND u.email_confirmed_at IS NULL AND u.phone_confirmed_at IS NULL AND NOT ${OAUTH_PROTECTED_USER_SQL} AND ${ABANDONMENT_CUTOFF_SQL}))`;

export function hasOAuthProviderMetadata(
  row: Record<string, unknown>,
): boolean {
  if (row.is_oauth_user === true) {
    return true;
  }
  const meta =
    typeof row.raw_app_meta_data === 'object' && row.raw_app_meta_data !== null
      ? (row.raw_app_meta_data as { provider?: unknown; providers?: unknown })
      : undefined;
  const metaProvider =
    typeof meta?.provider === 'string'
      ? meta.provider.trim().toLowerCase()
      : '';
  if (metaProvider === 'google' || metaProvider === 'facebook') {
    return true;
  }
  if (
    Array.isArray(meta?.providers) &&
    meta.providers.some(
      (p) =>
        typeof p === 'string' &&
        ['google', 'facebook'].includes(p.trim().toLowerCase()),
    )
  ) {
    return true;
  }
  const identities = Array.isArray(row.identities) ? row.identities : [];
  return identities.some(
    (id) =>
      typeof id === 'object' &&
      id !== null &&
      typeof (id as { provider?: unknown }).provider === 'string' &&
      ['google', 'facebook'].includes(
        (id as { provider: string }).provider.trim().toLowerCase(),
      ),
  );
}

export interface PurgeOrphanedAuthOptions {
  channel: 'email' | 'phone';
  identifier: string;
  database?: DatabaseService;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  signal?: AbortSignal;
  abuseControl?: Partial<
    Pick<AuthAbuseControl, 'clearChallengeState' | 'clearContactsState'>
  >;
  preserveSendLimits?: boolean;
}

interface StaleAuthUserRow {
  id?: unknown;
  deleted_at?: unknown;
  created_at?: unknown;
  email_confirmed_at?: unknown;
  phone_confirmed_at?: unknown;
  has_app_user?: unknown;
  email?: unknown;
  phone?: unknown;
  provider_contact?: unknown;
}

interface ContactRow {
  email?: unknown;
  phone?: unknown;
}

function unwrapQueryRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

function addNormalizedContact(
  channel: 'email' | 'phone',
  raw: unknown,
  seen: Set<string>,
  target: Contact[],
): void {
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed) return;
  const identifier =
    channel === 'email'
      ? trimmed.toLowerCase()
      : trimmed.startsWith('+')
        ? trimmed
        : `+${trimmed}`;
  const key = `${channel}:${identifier}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({ channel, identifier });
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
                 u.email_confirmed_at,
                 u.phone_confirmed_at,
                 (pu.id IS NOT NULL) AS has_app_user,
                 u.email,
                 u.phone,
                 p.contact_value AS provider_contact
            FROM auth.users u
            LEFT JOIN public.users pu ON pu.id = u.id
            LEFT JOIN public.user_auth_providers p
              ON p.user_id = u.id AND p.provider = '${channel}'
            LEFT JOIN auth.identities i
              ON i.user_id = u.id
           WHERE ${contactPredicate}
             AND ${ORPHANED_LOOKUP_CONDITION}`;
}

function buildCandidateRecheckSql(): string {
  return `SELECT u.id,
                 u.deleted_at,
                 u.created_at,
                 u.email_confirmed_at,
                 u.phone_confirmed_at,
                 (pu.id IS NOT NULL) AS has_app_user,
                 u.email,
                 u.phone
            FROM auth.users u
            LEFT JOIN public.users pu ON pu.id = u.id
           WHERE u.id = $1::uuid
             AND ${ORPHANED_LOOKUP_CONDITION}
           LIMIT 1`;
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
  if (
    (row.email_confirmed_at !== undefined && row.email_confirmed_at !== null) ||
    (row.phone_confirmed_at !== undefined && row.phone_confirmed_at !== null)
  ) {
    return false;
  }
  if (row.created_at === null) {
    return false;
  }
  if (row.created_at !== undefined) {
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
 * or `public.users` row absent for >= 15 minutes). Coordinates per-candidate cleanup with bootstrap
 * via PostgreSQL advisory locks (`pg_advisory_xact_lock`) and re-check before deleting.
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
    preserveSendLimits = true,
  } = options;
  if (
    typeof database?.query !== 'function' ||
    typeof database?.transaction !== 'function'
  ) {
    return false;
  }

  const normalized =
    channel === 'email' ? identifier.toLowerCase().trim() : identifier.trim();
  if (!normalized) {
    return false;
  }

  const rawRows = await database.query(buildLookupSql(channel), [normalized]);
  const rows = unwrapQueryRows<StaleAuthUserRow>(rawRows);
  if (rows.length === 0) {
    return false;
  }

  const nowMs = Date.now();
  const candidatesById = new Map<
    string,
    { id: string; contacts: Contact[]; seenKeys: Set<string> }
  >();
  for (const row of rows) {
    if (!isAbandonedOrphanRow(row, nowMs)) continue;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) continue;
    let entry = candidatesById.get(id);
    if (!entry) {
      entry = { id, contacts: [], seenKeys: new Set<string>() };
      candidatesById.set(id, entry);
    }
    addNormalizedContact('email', row.email, entry.seenKeys, entry.contacts);
    addNormalizedContact('phone', row.phone, entry.seenKeys, entry.contacts);
    if (typeof row.provider_contact === 'string') {
      addNormalizedContact(
        channel,
        row.provider_contact,
        entry.seenKeys,
        entry.contacts,
      );
    }
  }
  const candidates = [...candidatesById.values()];
  if (candidates.length === 0) {
    return false;
  }

  const baseUrl = supabaseUrl?.replace(/\/$/, '');
  let purgedAny = false;

  for (const candidate of candidates) {
    const candidateContacts: Contact[] = [];
    const candidateContactKeys = new Set<string>();
    const addCandidateContact = (
      contactChannel: 'email' | 'phone',
      rawVal: unknown,
    ) => {
      addNormalizedContact(
        contactChannel,
        rawVal,
        candidateContactKeys,
        candidateContacts,
      );
    };
    for (const c of candidate.contacts) {
      addCandidateContact(c.channel, c.identifier);
    }

    const purged = await database.transaction(
      null,
      async (manager): Promise<boolean> => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtext($1::text))',
          [candidate.id],
        );

        const recheckRaw = await manager.query(buildCandidateRecheckSql(), [
          candidate.id,
        ]);
        const recheckRows = unwrapQueryRows<StaleAuthUserRow>(recheckRaw);
        const recheckRow = recheckRows[0];
        if (!recheckRow || !isAbandonedOrphanRow(recheckRow, Date.now())) {
          return false;
        }

        addCandidateContact('email', recheckRow.email);
        addCandidateContact('phone', recheckRow.phone);

        if (baseUrl && serviceRoleKey) {
          const timeoutSignal = AbortSignal.timeout(4000);
          const adminSignal = signal
            ? AbortSignal.any([signal, timeoutSignal])
            : timeoutSignal;
          try {
            await fetch(
              `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(candidate.id)}`,
              {
                method: 'DELETE',
                headers: {
                  apikey: serviceRoleKey,
                  Authorization: `Bearer ${serviceRoleKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ should_soft_delete: false }),
                signal: adminSignal,
              },
            );
          } catch {
            // Proceed with SQL hard-delete below so local/dev orphan rows are always cleared.
          }
        }

        const deletedPublicRaw = await manager.query<ContactRow[]>(
          `DELETE FROM public.users WHERE id = $1::uuid
           RETURNING email, phone`,
          [candidate.id],
        );
        const deletedPublicRows = unwrapQueryRows<ContactRow>(deletedPublicRaw);

        const deletedAuthRaw = await manager.query<ContactRow[]>(
          `WITH target_ids AS (
             SELECT u.id
               FROM auth.users u
              WHERE u.id = $1::uuid
                AND (
                  u.deleted_at IS NOT NULL
                  OR (
                    NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = u.id)
                    AND u.email_confirmed_at IS NULL
                    AND u.phone_confirmed_at IS NULL
                    AND NOT ${OAUTH_PROTECTED_USER_SQL}
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
          [candidate.id],
        );
        const deletedAuthRows = unwrapQueryRows<ContactRow>(deletedAuthRaw);

        for (const row of [...deletedPublicRows, ...deletedAuthRows]) {
          addCandidateContact('email', row?.email);
          addCandidateContact('phone', row?.phone);
        }
        return true;
      },
      false,
      false,
      false,
    );

    if (purged) {
      purgedAny = true;
      addCandidateContact(channel, normalized);
      if (preserveSendLimits) {
        if (typeof abuseControl?.clearChallengeState === 'function') {
          await abuseControl
            .clearChallengeState(candidateContacts, [candidate.id])
            .catch(() => undefined);
        } else {
          await abuseControl
            ?.clearContactsState?.(candidateContacts, [candidate.id], {
              preserveSendLimits: true,
            })
            .catch(() => undefined);
        }
      } else {
        await abuseControl
          ?.clearContactsState?.(candidateContacts, [candidate.id], {
            preserveSendLimits: false,
          })
          .catch(() => undefined);
      }
    }
  }

  return purgedAny;
}
