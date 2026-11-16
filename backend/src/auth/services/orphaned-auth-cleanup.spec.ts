import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from './database.service.js';
import {
  ORPHAN_ABANDONMENT_WINDOW_MS,
  purgeOrphanedAuthByContact,
} from './orphaned-auth-cleanup.js';

function withTxMock(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    transaction: vi.fn(),
  } as unknown as DatabaseService;
}

describe('purgeOrphanedAuthByContact', () => {
  const email = 'orphan@example.invalid';
  const staleId = '99999999-9999-4999-8999-999999999999';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses to run non-transactional advisory lock when database.transaction is unavailable', async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: staleId }]);
    const database = { query } as unknown as DatabaseService;

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
    });

    expect(purged).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('enforces the 15-minute COALESCE abandonment window in SQL lookup', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const database = withTxMock(query);

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
    });

    expect(purged).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    const lookupSql = query.mock.calls[0]?.[0] as string;
    expect(lookupSql).toContain(
      "COALESCE(u.created_at, NOW()) < NOW() - INTERVAL '15 minutes'",
    );
    expect(lookupSql).toMatch(/u\.deleted_at IS NOT NULL\s+OR\s*\(/);
  });

  it('does not purge a row with NULL created_at (treated defensively as 0 minutes old)', async () => {
    const query = vi.fn().mockResolvedValueOnce([
      {
        id: staleId,
        deleted_at: null,
        has_app_user: false,
        created_at: null,
      },
    ]);
    const database = withTxMock(query);

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
    });

    expect(purged).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not purge a recently created (< 15 minutes old) auth user with no public.users row', async () => {
    const recentCreatedAt = new Date(
      Date.now() - (ORPHAN_ABANDONMENT_WINDOW_MS - 60_000),
    ).toISOString();
    const query = vi.fn().mockResolvedValueOnce([
      {
        id: staleId,
        deleted_at: null,
        has_app_user: false,
        created_at: recentCreatedAt,
      },
    ]);
    const database = withTxMock(query);

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
    });

    expect(purged).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not purge an active non-deleted auth user even if created more than 15 minutes ago', async () => {
    const oldCreatedAt = new Date(
      Date.now() - (ORPHAN_ABANDONMENT_WINDOW_MS + 60_000),
    ).toISOString();
    const query = vi.fn().mockResolvedValueOnce([
      {
        id: staleId,
        deleted_at: null,
        has_app_user: true,
        created_at: oldCreatedAt,
      },
    ]);
    const database = withTxMock(query);

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
    });

    expect(purged).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('acquires pg_advisory_xact_lock strictly on manager client inside transaction, re-checks, and skips when concurrent bootstrap activates user', async () => {
    const oldCreatedAt = new Date(
      Date.now() - (ORPHAN_ABANDONMENT_WINDOW_MS + 60_000),
    ).toISOString();
    const outerQuery = vi.fn().mockResolvedValueOnce([
      {
        id: staleId,
        deleted_at: null,
        has_app_user: false,
        created_at: oldCreatedAt,
        email: null,
        phone: '8801629795421',
      },
    ]);
    const managerQuery = vi
      .fn()
      .mockResolvedValueOnce([]) // pg_advisory_xact_lock
      .mockResolvedValueOnce([]); // re-check returns empty because public.users now exists
    const clearContactsState = vi.fn().mockResolvedValue(undefined);
    const database = {
      query: outerQuery,
      transaction: vi.fn(
        async (
          _uid: string | null,
          op: (db: { query: typeof managerQuery }) => Promise<unknown>,
        ) => op({ query: managerQuery }),
      ),
    } as unknown as DatabaseService;

    const purged = await purgeOrphanedAuthByContact({
      channel: 'phone',
      identifier: '+8801629795421',
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
      abuseControl: { clearContactsState },
    });

    expect(purged).toBe(false);
    expect(outerQuery).toHaveBeenCalledTimes(1); // NEVER used for lock or delete
    expect(managerQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [staleId],
    );
    expect(managerQuery).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(clearContactsState).not.toHaveBeenCalled();
  });

  it('locks candidate via manager, bounds Admin DELETE with 4s AbortSignal, deletes public.users directly, deduplicates contacts, and preserves send limits', async () => {
    const oldCreatedAt = new Date(
      Date.now() - (ORPHAN_ABANDONMENT_WINDOW_MS + 60_000),
    ).toISOString();
    const managerQuery = vi
      .fn()
      .mockResolvedValueOnce([]) // pg_advisory_xact_lock
      .mockResolvedValueOnce([
        {
          id: staleId,
          deleted_at: null,
          has_app_user: false,
          created_at: oldCreatedAt,
          email: 'Orphan@Example.INVALID',
          phone: null,
        },
      ]) // re-check under lock
      .mockResolvedValueOnce([
        [{ email: 'Secondary@Example.INVALID', phone: '8801712345678' }],
        1,
      ]) // DELETE FROM public.users tuple (unconditional for locked candidate)
      .mockResolvedValueOnce([
        [{ email: 'orphan@example.invalid', phone: '8801629795421' }],
        1,
      ]); // DELETE FROM auth.users tuple

    const clearChallengeState = vi.fn().mockResolvedValue(undefined);
    const clearContactsState = vi.fn().mockResolvedValue(undefined);
    const database = {
      query: vi.fn().mockResolvedValueOnce([
        {
          id: staleId,
          deleted_at: null,
          has_app_user: false,
          created_at: oldCreatedAt,
          email: 'ORPHAN@Example.INVALID',
          phone: '8801629795421',
          provider_contact: 'Orphan@example.invalid',
        },
        {
          id: staleId,
          deleted_at: null,
          has_app_user: false,
          created_at: oldCreatedAt,
          email: 'orphan@example.invalid',
          phone: '+8801629795421',
          provider_contact: 'extra@example.invalid',
        },
      ]),
      transaction: vi.fn(
        async (
          _uid: string | null,
          op: (db: { query: typeof managerQuery }) => Promise<unknown>,
        ) => op({ query: managerQuery }),
      ),
    } as unknown as DatabaseService;

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
      abuseControl: { clearChallengeState, clearContactsState },
      preserveSendLimits: true,
    });

    expect(purged).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchInit] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(fetchUrl).toBe(
      `http://supabase.invalid/auth/v1/admin/users/${staleId}`,
    );
    expect(fetchInit?.method).toBe('DELETE');
    expect(fetchInit?.body).toBe(JSON.stringify({ should_soft_delete: false }));
    expect(fetchInit?.signal).toBeInstanceOf(AbortSignal);

    expect(managerQuery).toHaveBeenCalledTimes(4);
    expect(managerQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [staleId],
    );
    expect(managerQuery.mock.calls[1]?.[0]).toContain('WHERE u.id = $1::uuid');

    const publicDeleteSql = String(managerQuery.mock.calls[2]?.[0]).replace(
      /\s+/g,
      ' ',
    );
    expect(publicDeleteSql).toContain(
      'DELETE FROM public.users WHERE id = $1::uuid',
    );
    expect(publicDeleteSql).not.toContain('EXISTS');

    expect(managerQuery.mock.calls[3]?.[0]).toContain(
      "COALESCE(u.created_at, NOW()) < NOW() - INTERVAL '15 minutes'",
    );
    expect(managerQuery.mock.calls[3]?.[0]).toContain('DELETE FROM auth.users');

    expect(clearChallengeState).toHaveBeenCalledTimes(1);
    expect(clearChallengeState).toHaveBeenCalledWith(
      [
        { channel: 'email', identifier: 'orphan@example.invalid' },
        { channel: 'phone', identifier: '+8801629795421' },
        { channel: 'email', identifier: 'extra@example.invalid' },
        { channel: 'email', identifier: 'secondary@example.invalid' },
        { channel: 'phone', identifier: '+8801712345678' },
      ],
      [staleId],
    );
    expect(clearContactsState).not.toHaveBeenCalled();
  });

  it('clears contact state immediately after Candidate A commits even if Candidate B throws', async () => {
    const oldCreatedAt = new Date(
      Date.now() - (ORPHAN_ABANDONMENT_WINDOW_MS + 60_000),
    ).toISOString();
    const candidateA = '11111111-1111-4111-8111-111111111111';
    const candidateB = '22222222-2222-4222-8222-222222222222';
    const clearContactsState = vi.fn().mockResolvedValue(undefined);

    const txAQuery = vi
      .fn()
      .mockResolvedValueOnce([]) // lock
      .mockResolvedValueOnce([
        {
          id: candidateA,
          deleted_at: null,
          has_app_user: false,
          created_at: oldCreatedAt,
          email: 'a@example.invalid',
          phone: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ email: 'a@example.invalid', phone: null }]);

    const txBQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Simulated DB error on candidate B'));

    const database = {
      query: vi.fn().mockResolvedValueOnce([
        {
          id: candidateA,
          deleted_at: null,
          has_app_user: false,
          created_at: oldCreatedAt,
          email: 'a@example.invalid',
          phone: null,
        },
        {
          id: candidateB,
          deleted_at: null,
          has_app_user: false,
          created_at: oldCreatedAt,
          email: 'b@example.invalid',
          phone: null,
        },
      ]),
      transaction: vi
        .fn()
        .mockImplementationOnce(
          async (
            _uid: string | null,
            op: (db: { query: typeof txAQuery }) => Promise<unknown>,
          ) => op({ query: txAQuery }),
        )
        .mockImplementationOnce(
          async (
            _uid: string | null,
            op: (db: { query: typeof txBQuery }) => Promise<unknown>,
          ) => op({ query: txBQuery }),
        ),
    } as unknown as DatabaseService;

    await expect(
      purgeOrphanedAuthByContact({
        channel: 'email',
        identifier: 'a@example.invalid',
        database,
        abuseControl: { clearContactsState },
      }),
    ).rejects.toThrow('Simulated DB error on candidate B');

    expect(clearContactsState).toHaveBeenCalledTimes(1);
    expect(clearContactsState).toHaveBeenCalledWith(
      [{ channel: 'email', identifier: 'a@example.invalid' }],
      [candidateA],
      { preserveSendLimits: true },
    );
  });
});
