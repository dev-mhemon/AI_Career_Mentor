import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import {
  computeRetryBackoffSeconds,
  JobReaperService,
} from './services/job-reaper.service.js';

const JOB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('JobReaperService (R13 Two-Step Recovery & Terminal Deadlines)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let configMock: ConfigService;
  let service: JobReaperService;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        _userId: string | null,
        op: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => op({ query: queryMock }),
    );
    databaseMock = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;
    configMock = {
      get: vi.fn((key: string) => {
        if (key === 'JOB_WORKER_LEASE_SECONDS') return '120';
        if (key === 'JOB_WORKER_MAX_ATTEMPTS') return '5';
        if (key === 'JOB_WORKER_MAX_AGE_SECONDS') return '3600';
        if (key === 'JOB_REAPER_INTERVAL_SECONDS') return '30';
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new JobReaperService(databaseMock, configMock, () => 0);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('executes strict two-step preparing -> failed then separate failed -> queued without ever issuing preparing -> queued (23514)', async () => {
    const transitions: string[] = [];

    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        if (
          sql.includes("status = 'queued'") ||
          sql.includes('is_async = false')
        ) {
          return [];
        }
        expect(sql).toContain("status = 'preparing'");
        expect(params).toEqual([5, 3600, 120, 20]);
        return [
          {
            id: JOB_A,
            locked_by: 'dead-worker-1',
            attempt_count: 2,
            can_retry: true,
          },
        ];
      }

      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        expect(sql).toContain('WHERE id = $1');
        expect(sql).toContain("AND status = 'preparing'");
        expect(params).toEqual([JOB_A, 'dead-worker-1', 2]);
        transitions.push('preparing->failed');
        return [[{ id: JOB_A }], 1];
      }

      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'queued'")
      ) {
        // NEVER preparing -> queued
        expect(sql).toContain("AND status = 'failed'");
        expect(sql).not.toContain("status = 'preparing'");
        expect(params).toEqual([JOB_A, 4, 5, 3600]);
        transitions.push('failed->queued');
        return [[{ id: JOB_A }], 1];
      }

      return [];
    });

    const summary = await service.reapExpiredLeases(20);
    expect(summary).toEqual({
      inspected: 1,
      requeued: 1,
      failedTerminal: 0,
    });
    expect(transitions).toEqual(['preparing->failed', 'failed->queued']);

    for (const [sql] of queryMock.mock.calls) {
      const s = String(sql);
      if (s.includes("SET status = 'queued'")) {
        expect(s).not.toContain("status = 'preparing'");
      }
    }
  });

  it('marks expired jobs terminal with retryable = false and clears input_payload = NULL when attempts >= 5 or 1h age exceeded', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        if (
          sql.includes("status = 'queued'") ||
          sql.includes('is_async = false')
        ) {
          return [];
        }
        return [
          {
            id: JOB_A,
            locked_by: 'worker-old',
            attempt_count: 5,
            can_retry: false,
          },
          {
            id: JOB_B,
            locked_by: 'worker-aged',
            attempt_count: 2,
            can_retry: false,
          },
        ];
      }

      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        expect(sql).toContain('retryable = false');
        expect(sql).toContain('input_payload = NULL');
        return [[{ id: String(params?.[0]) }], 1];
      }

      return [];
    });

    const summary = await service.reapExpiredLeases(20);
    expect(summary).toEqual({
      inspected: 2,
      requeued: 0,
      failedTerminal: 2,
    });

    const queuedCalls = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes("SET status = 'queued'"),
    );
    expect(queuedCalls).toHaveLength(0);
  });

  it('computes bounded exponential backoff min(300, 2^attempt) + bounded jitter', () => {
    expect(computeRetryBackoffSeconds(1, () => 0)).toBe(2);
    expect(computeRetryBackoffSeconds(2, () => 0)).toBe(4);
    expect(computeRetryBackoffSeconds(3, () => 0)).toBe(8);
    expect(computeRetryBackoffSeconds(4, () => 0)).toBe(16);
    expect(computeRetryBackoffSeconds(9, () => 0)).toBe(300);

    // Maximum jitter for high attempts is capped at 30s
    const maxAtAttempt9 = computeRetryBackoffSeconds(9, () => 0.9999);
    expect(maxAtAttempt9).toBeGreaterThanOrEqual(300);
    expect(maxAtAttempt9).toBeLessThanOrEqual(330);

    // Invokes RNG exactly once per backoff calculation (no double-sample NaN drift)
    const singleUseRng = vi.fn().mockReturnValueOnce(0.5);
    expect(computeRetryBackoffSeconds(2, singleUseRng)).toBe(5);
    expect(singleUseRng).toHaveBeenCalledTimes(1);
  });

  it('runs bounded periodic sweep timer cleanly and stops on destroy', async () => {
    vi.useFakeTimers();
    queryMock.mockResolvedValue([]);

    service.start(10);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transactionMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(transactionMock).toHaveBeenCalledTimes(2);

    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transactionMock).toHaveBeenCalledTimes(2);
  });

  it('runs terminal cleanup when TypeORM step2 UPDATE returns [[], 0] and terminalizes expired queued jobs', async () => {
    let terminalCleanupCount = 0;
    let queuedTerminalCount = 0;

    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('is_async = true') &&
        sql.includes("status = 'preparing'") &&
        sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        return [
          {
            id: JOB_A,
            locked_by: 'worker-1',
            attempt_count: 2,
            can_retry: true,
          },
        ];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes("status = 'queued'") &&
        sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        return [{ id: JOB_B }];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('is_async = false') &&
        sql.includes("status = 'preparing'") &&
        sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        return [];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'") &&
        sql.includes("AND status = 'preparing'")
      ) {
        return [[{ id: JOB_A }], 1];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'queued'")
      ) {
        // Missed step2 UPDATE -> TypeORM Postgres tuple [[], 0]
        return [[], 0];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes('SET retryable = false') &&
        sql.includes('input_payload = NULL')
      ) {
        terminalCleanupCount += 1;
        return [[{ id: JOB_A }], 1];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'") &&
        sql.includes("AND status = 'queued'")
      ) {
        // Verify all 015_functions.sql & 010_ai_operations.sql preconditions for queued -> failed
        expect(sql).toContain("error_code = 'WORKER_LEASE_EXPIRED'");
        expect(sql).toContain('retryable = false');
        expect(sql).toContain('finished_at = clock_timestamp()');
        expect(sql).toContain('input_payload = NULL');
        queuedTerminalCount += 1;
        return [[{ id: JOB_B }], 1];
      }
      return [];
    });

    const summary = await service.reapExpiredLeases(20);
    expect(summary).toEqual({
      inspected: 2,
      requeued: 0,
      failedTerminal: 2,
    });
    expect(terminalCleanupCount).toBe(1);
    expect(queuedTerminalCount).toBe(1);
  });

  it('terminalizes abandoned synchronous (is_async = false) preparing quota reservations without ever requeuing them', async () => {
    const SYNC_RESERVATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    let syncTerminalized = false;

    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('is_async = false') &&
        sql.includes("status = 'preparing'") &&
        sql.includes('FOR UPDATE SKIP LOCKED')
      ) {
        expect(params).toEqual([120, 20]);
        return [{ id: SYNC_RESERVATION_ID }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'") &&
        sql.includes('AND is_async = false') &&
        sql.includes("AND status = 'preparing'")
      ) {
        expect(sql).toContain("error_code = 'WORKER_LEASE_EXPIRED'");
        expect(sql).toContain('retryable = false');
        expect(sql).toContain('finished_at = clock_timestamp()');
        expect(sql).toContain('input_payload = NULL');
        expect(params).toEqual([SYNC_RESERVATION_ID]);
        syncTerminalized = true;
        return [[{ id: SYNC_RESERVATION_ID }], 1];
      }
      return [];
    });

    const summary = await service.reapExpiredLeases(20);
    expect(summary).toEqual({
      inspected: 1,
      requeued: 0,
      failedTerminal: 1,
    });
    expect(syncTerminalized).toBe(true);
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes("SET status = 'queued'"),
      ),
    ).toBe(false);
  });
});
