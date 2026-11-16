import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from './database.service.js';
import {
  ORPHAN_ABANDONMENT_WINDOW_MS,
  purgeOrphanedAuthByContact,
} from './orphaned-auth-cleanup.js';

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

  it('enforces the 15-minute abandonment window in both SQL lookup and cleanup CTE', async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    const database = { query } as unknown as DatabaseService;

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
    const database = { query } as unknown as DatabaseService;

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
    const database = { query } as unknown as DatabaseService;

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
    const database = { query } as unknown as DatabaseService;

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

  it('purges an older (> 15 minutes old) abandoned auth user with no public.users row and calls Admin DELETE + SQL cleanup', async () => {
    const oldCreatedAt = new Date(
      Date.now() - (ORPHAN_ABANDONMENT_WINDOW_MS + 60_000),
    ).toISOString();
    const txQuery = vi.fn().mockResolvedValue([]);
    const query = vi.fn().mockResolvedValueOnce([
      {
        id: staleId,
        deleted_at: null,
        has_app_user: false,
        created_at: oldCreatedAt,
      },
    ]);
    const database = {
      query,
      transaction: vi.fn(
        async (
          _uid: string | null,
          op: (db: { query: typeof txQuery }) => Promise<void>,
        ) => op({ query: txQuery }),
      ),
    } as unknown as DatabaseService;

    const purged = await purgeOrphanedAuthByContact({
      channel: 'phone',
      identifier: '+8801629795421',
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
    });

    expect(purged).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://supabase.invalid/auth/v1/admin/users/${staleId}`,
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ should_soft_delete: false }),
      }),
    );

    expect(txQuery).toHaveBeenCalledTimes(2);
    expect(txQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'DELETE FROM public.users WHERE id = ANY($1::uuid[])',
      ),
      [[staleId]],
    );
    expect(txQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "COALESCE(u.created_at, NOW()) < NOW() - INTERVAL '15 minutes'",
      ),
      [[staleId]],
    );
    expect(txQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM auth.users'),
      [[staleId]],
    );
  });

  it('explicitly deletes lingering public.users rows before auth.users for soft-deleted accounts and unwraps [rows, affected] tuples', async () => {
    const txQuery = vi
      .fn()
      .mockResolvedValueOnce([
        [{ email: 'Secondary@Example.INVALID', phone: '8801712345678' }],
        1,
      ])
      .mockResolvedValueOnce([
        [{ email: 'orphan@example.invalid', phone: null }],
        1,
      ]);
    const clearContactsState = vi.fn().mockResolvedValue(undefined);
    const database = {
      query: vi.fn().mockResolvedValueOnce([
        {
          id: staleId,
          deleted_at: '2026-11-16T08:00:00Z',
          has_app_user: true,
          created_at: new Date().toISOString(),
        },
      ]),
      transaction: vi.fn(
        async (
          _uid: string | null,
          op: (db: { query: typeof txQuery }) => Promise<void>,
        ) => op({ query: txQuery }),
      ),
    } as unknown as DatabaseService;

    const purged = await purgeOrphanedAuthByContact({
      channel: 'email',
      identifier: email,
      database,
      supabaseUrl: 'http://supabase.invalid',
      serviceRoleKey: 'service-role-key',
      abuseControl: { clearContactsState },
    });

    expect(purged).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://supabase.invalid/auth/v1/admin/users/${staleId}`,
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ should_soft_delete: false }),
      }),
    );
    expect(txQuery.mock.calls[0]?.[0]).toContain(
      'DELETE FROM public.users WHERE id = ANY($1::uuid[])',
    );
    expect(txQuery.mock.calls[1]?.[0]).toContain('DELETE FROM auth.users');
    expect(clearContactsState).toHaveBeenCalledWith(
      [
        { channel: 'email', identifier: email },
        { channel: 'email', identifier: 'secondary@example.invalid' },
        { channel: 'phone', identifier: '+8801712345678' },
      ],
      [staleId],
    );
  });
});
