import { HttpException } from '@nestjs/common';
import type { DatabaseService } from '../auth/services/database.service.js';
import {
  encodeTechnologyUpdateCursor,
  NO_IMPORTANT_CHANGES_MESSAGE,
  TechnologyUpdateService,
  TEMPORARILY_UNAVAILABLE_MESSAGE,
} from './services/technology-update.service.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const UPDATE_1 = '22222222-2222-4222-8222-222222222222';
const UPDATE_2 = '33333333-3333-4333-8333-333333333333';
const DELIVERY_1 = '44444444-4444-4444-8444-444444444444';

function expectErrorCode(fn: () => unknown, status: number, code: string) {
  return expect(async () => {
    await fn();
  }).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(HttpException);
    const httpErr = err as HttpException;
    expect(httpErr.getStatus()).toBe(status);
    const body = httpErr.getResponse() as { code?: string };
    expect(body.code).toBe(code);
    return true;
  });
}

describe('TechnologyUpdateService (EP-T01..EP-T03, R24, R25)', () => {
  it('EP-T01 returns today_state: null, generation_pending: true when no delivery row exists for today, with foreground = false (R24/R25)', async () => {
    const txCalls: Array<{
      userId: string | null;
      active: boolean;
      foreground: boolean;
    }> = [];

    const dbMock = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('AS today_state')) {
          return [{ current_local_date: '2026-11-24', today_state: null }];
        }
        if (sql.includes('FROM public.update_delivery_history d')) {
          return [];
        }
        return [];
      }),
    };

    const database = {
      transaction: vi.fn(
        async (
          userId: string | null,
          op: (db: typeof dbMock) => Promise<unknown>,
          active = true,
          foreground = false,
        ) => {
          txCalls.push({ userId, active, foreground });
          return op(dbMock);
        },
      ),
    } as unknown as DatabaseService;

    const service = new TechnologyUpdateService(database);
    const res = await service.listUpdates(USER_A, { limit: 20 });

    expect(txCalls).toEqual([
      { userId: USER_A, active: true, foreground: false },
    ]);
    expect(res).toEqual({
      data: {
        today_state: null,
        generation_pending: true,
        message: null,
        items: [],
      },
      meta: {
        limit: 20,
        next_cursor: null,
      },
    });
  });

  it('EP-T01 resolves available, no_important_changes, and temporarily_unavailable today_state values with exact C05 messages and keyset cursor pagination', async () => {
    let simulatedTodayState:
      'available' | 'no_important_changes' | 'temporarily_unavailable' =
      'available';

    const dbMock = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('AS today_state')) {
          return [
            {
              current_local_date: '2026-11-24',
              today_state: simulatedTodayState,
            },
          ];
        }
        if (sql.includes('FROM public.update_delivery_history d')) {
          return [
            {
              id: UPDATE_1,
              local_date: '2026-11-24',
              title: 'PostgreSQL 17.2 Released',
              what_changed: 'Planner and vacuum fixes.',
              why_it_matters: 'Directly affects your SQL indexing module.',
              publisher: 'PostgreSQL Global Development Group',
              source_url: 'https://www.postgresql.org/docs/release/17.2/',
              fetched_at: '2026-11-24T06:15:00.000Z',
              release_status: 'released',
              relevance: 'high',
              action_timing: 'learn_later',
              roadmap_relation: 'Relates to SQL Performance topic',
              viewed: false,
              delivered_at: '2026-11-24T06:15:05.123456Z',
              delivered_at_cursor: '2026-11-24T06:15:05.123456Z',
              delivery_id: DELIVERY_1,
            },
            {
              id: UPDATE_2,
              local_date: '2026-11-23',
              title: 'Node.js 24 LTS Security Update',
              what_changed: 'TLS and HTTP/2 fixes.',
              why_it_matters: 'Important for Backend runtime security.',
              publisher: 'Node.js Foundation',
              source_url: 'https://nodejs.org/en/blog/release/',
              fetched_at: '2026-11-23T06:15:00.000Z',
              release_status: 'released',
              relevance: 'medium',
              action_timing: 'act_now',
              roadmap_relation: null,
              viewed: true,
              delivered_at: '2026-11-23T06:15:05.000000Z',
              delivered_at_cursor: '2026-11-23T06:15:05.000000Z',
              delivery_id: UPDATE_2,
            },
          ];
        }
        return [];
      }),
    };

    const database = {
      transaction: vi.fn(
        async (
          _userId: string | null,
          op: (db: typeof dbMock) => Promise<unknown>,
        ) => op(dbMock),
      ),
    } as unknown as DatabaseService;

    const service = new TechnologyUpdateService(database);

    const availableRes = await service.listUpdates(USER_A, { limit: 1 });
    expect(availableRes.data.today_state).toBe('available');
    expect(availableRes.data.generation_pending).toBe(false);
    expect(availableRes.data.message).toBeNull();
    expect(availableRes.data.items).toHaveLength(1);
    expect(availableRes.data.items[0]?.id).toBe(UPDATE_1);
    expect(availableRes.meta.next_cursor).toBeTruthy();

    // Pass the returned cursor back into listUpdates (verifying microsecond preservation)
    await service.listUpdates(USER_A, {
      limit: 1,
      cursor: availableRes.meta.next_cursor!,
    });
    expect(dbMock.query).toHaveBeenLastCalledWith(
      expect.stringContaining('ORDER BY d.local_date DESC'),
      [USER_A, '2026-11-24', '2026-11-24T06:15:05.123456Z', DELIVERY_1, 2],
    );

    simulatedTodayState = 'no_important_changes';
    const noChangeRes = await service.listUpdates(USER_A, { limit: 5 });
    expect(noChangeRes.data.today_state).toBe('no_important_changes');
    expect(noChangeRes.data.generation_pending).toBe(false);
    expect(noChangeRes.data.message).toBe(NO_IMPORTANT_CHANGES_MESSAGE);

    simulatedTodayState = 'temporarily_unavailable';
    const outageRes = await service.listUpdates(USER_A, { limit: 5 });
    expect(outageRes.data.today_state).toBe('temporarily_unavailable');
    expect(outageRes.data.generation_pending).toBe(false);
    expect(outageRes.data.message).toBe(TEMPORARILY_UNAVAILABLE_MESSAGE);
  });

  it('EP-T01 rejects malformed cursors and impossible calendar dates (e.g. 2026-02-31) with 422 INVALID_FORMAT', async () => {
    const database = {
      transaction: vi.fn(),
    } as unknown as DatabaseService;
    const service = new TechnologyUpdateService(database);

    const impossibleLocalDateCursor = encodeTechnologyUpdateCursor({
      localDate: '2026-02-31',
      deliveredAt: '2026-02-28T06:15:00.000000Z',
      id: DELIVERY_1,
    });
    await expectErrorCode(
      () => service.listUpdates(USER_A, { cursor: impossibleLocalDateCursor }),
      422,
      'INVALID_FORMAT',
    );

    const impossibleDeliveredAtCursor = encodeTechnologyUpdateCursor({
      localDate: '2026-02-28',
      deliveredAt: '2026-02-31T06:15:00.000000Z',
      id: DELIVERY_1,
    });
    await expectErrorCode(
      () =>
        service.listUpdates(USER_A, { cursor: impossibleDeliveredAtCursor }),
      422,
      'INVALID_FORMAT',
    );

    await expectErrorCode(
      () => service.listUpdates(USER_A, { cursor: 'not-valid-base64-json!!!' }),
      422,
      'INVALID_FORMAT',
    );
  });

  it('EP-T02 returns delivered update with foreground = true (R24) and rejects undelivered/foreign IDs with 404 RESOURCE_NOT_FOUND', async () => {
    const txCalls: Array<{ foreground: boolean }> = [];
    let foundRow: Record<string, unknown> | undefined = {
      id: UPDATE_1,
      local_date: '2026-11-24',
      title: 'PostgreSQL 17.2 Released',
      what_changed: 'Planner and vacuum fixes.',
      why_it_matters: 'Directly affects your SQL indexing module.',
      publisher: 'PostgreSQL Global Development Group',
      source_url: 'https://www.postgresql.org/docs/release/17.2/',
      fetched_at: '2026-11-24T06:15:00.000Z',
      release_status: 'released',
      relevance: 'high',
      action_timing: 'learn_later',
      roadmap_relation: 'Relates to SQL Performance topic',
      viewed: true,
    };

    const dbMock = {
      query: vi.fn(async () => (foundRow ? [foundRow] : [])),
    };
    const database = {
      transaction: vi.fn(
        async (
          _userId: string | null,
          op: (db: typeof dbMock) => Promise<unknown>,
          _active?: boolean,
          foreground = false,
        ) => {
          txCalls.push({ foreground });
          return op(dbMock);
        },
      ),
    } as unknown as DatabaseService;

    const service = new TechnologyUpdateService(database);
    const dto = await service.getUpdate(USER_A, UPDATE_1);
    expect(txCalls).toEqual([{ foreground: true }]);
    expect(dto.id).toBe(UPDATE_1);
    expect(dto.viewed).toBe(true);

    // Undelivered or foreign update ID -> 404 RESOURCE_NOT_FOUND
    foundRow = undefined;
    await expectErrorCode(
      () => service.getUpdate(USER_A, UPDATE_2),
      404,
      'RESOURCE_NOT_FOUND',
    );

    // Malformed UUID -> 422 INVALID_FORMAT
    await expectErrorCode(
      () => service.getUpdate(USER_A, 'not-a-uuid'),
      422,
      'INVALID_FORMAT',
    );
  });

  it('EP-T03 idempotently marks a delivered update viewed with COALESCE(viewed_at, clock_timestamp()) and foreground = true (R24), returning 404 for undelivered IDs', async () => {
    const txCalls: Array<{ foreground: boolean }> = [];
    const fixedViewedAt = '2026-11-24T08:30:00.000Z';
    let returningResult: unknown = [
      [{ id: UPDATE_1, viewed_at: fixedViewedAt }],
      1,
    ];

    const dbMock = {
      query: vi.fn(async () => returningResult),
    };
    const database = {
      transaction: vi.fn(
        async (
          _userId: string | null,
          op: (db: typeof dbMock) => Promise<unknown>,
          _active?: boolean,
          foreground = false,
        ) => {
          txCalls.push({ foreground });
          return op(dbMock);
        },
      ),
    } as unknown as DatabaseService;

    const service = new TechnologyUpdateService(database);

    const firstView = await service.markUpdateViewed(USER_A, UPDATE_1);
    expect(firstView).toEqual({
      id: UPDATE_1,
      viewed: true,
      viewed_at: fixedViewedAt,
    });
    expect(txCalls[0]).toEqual({ foreground: true });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE(viewed_at, clock_timestamp())'),
      [USER_A, UPDATE_1],
    );

    // Repeat call preserves original viewed_at
    const secondView = await service.markUpdateViewed(USER_A, UPDATE_1);
    expect(secondView.viewed_at).toBe(fixedViewedAt);

    // Undelivered / foreign update -> 0 rows matched -> 404 RESOURCE_NOT_FOUND
    returningResult = [[], 0];
    await expectErrorCode(
      () => service.markUpdateViewed(USER_A, UPDATE_2),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });
});
