import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import {
  PostgresJobQueueConsumer,
  type ClaimedJobRow,
  type JobExecutionResult,
  type JobHandler,
} from './services/postgres-job-queue.consumer.js';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const RESULT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MODEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROMPT_VERSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WORKER_ID = 'worker-test-1';

function makeClaimedJob(overrides: Partial<ClaimedJobRow> = {}): ClaimedJobRow {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    task: 'roadmap_generate',
    feature_key: 'roadmap_generator',
    job_kind: 'roadmap_generate',
    status: 'preparing',
    attempt_count: 1,
    locked_by: WORKER_ID,
    locked_at: new Date('2026-11-18T10:00:00.000Z'),
    created_at: new Date('2026-11-18T09:59:00.000Z'),
    language: 'en',
    subject_type: 'career_goal',
    subject_id: RESULT_ID,
    idempotency_key: null,
    input_payload: {
      v: 1,
      args: { career_goal_id: RESULT_ID },
      expected_refs: {
        goal_updated_at: '2026-11-18T09:58:00.000Z',
        profile_updated_at: '2026-11-18T09:57:00.000Z',
      },
    },
    ...overrides,
  };
}

function makeExecResult(): JobExecutionResult {
  return {
    resultType: 'roadmap',
    resultId: RESULT_ID,
    providerKey: 'synthetic',
    modelId: MODEL_ID,
    promptVersionId: PROMPT_VERSION_ID,
    outputSchemaId: 'roadmap.v1',
    fallbackUsed: false,
    language: 'en',
    inputUnits: 120,
    outputUnits: 340,
    latencyMs: 42,
    output: { targetLevel: 'junior', phases: [] },
  };
}

describe('PostgresJobQueueConsumer (R12/R13 SKIP LOCKED, Fence, Heartbeat & Commit Gate)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let activeTransactionDepth: number;
  let committedClaimTxCount: number;
  let databaseMock: DatabaseService;
  let configMock: ConfigService;
  let consumer: PostgresJobQueueConsumer;

  beforeEach(() => {
    vi.clearAllMocks();
    activeTransactionDepth = 0;
    committedClaimTxCount = 0;
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        _userId: string | null,
        op: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => {
        activeTransactionDepth += 1;
        try {
          return await op({ query: queryMock });
        } finally {
          activeTransactionDepth -= 1;
        }
      },
    );
    databaseMock = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;
    configMock = {
      get: vi.fn((key: string) => {
        if (key === 'JOB_WORKER_LEASE_SECONDS') return '120';
        if (key === 'JOB_WORKER_HEARTBEAT_SECONDS') return '30';
        if (key === 'JOB_WORKER_MAX_ATTEMPTS') return '5';
        if (key === 'JOB_WORKER_MAX_AGE_SECONDS') return '3600';
        return undefined;
      }),
    } as unknown as ConfigService;

    consumer = new PostgresJobQueueConsumer(
      databaseMock,
      configMock,
      () => 0,
      WORKER_ID,
    );
  });

  afterEach(() => {
    consumer.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('commits SKIP LOCKED claim using available_at BEFORE calling external handler.execute', async () => {
    const claimed = makeClaimedJob();
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FOR UPDATE SKIP LOCKED') &&
        sql.includes("status = 'queued'") &&
        sql.includes('available_at <= clock_timestamp()')
      ) {
        expect(params).toEqual([5, 3600, 1, WORKER_ID]);
        committedClaimTxCount += 1;
        return [claimed];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_ID,
            task: 'roadmap_generate',
            feature_key: 'roadmap_generator',
            status: 'preparing',
            locked_by: WORKER_ID,
            attempt_count: 1,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (sql.includes('FROM public.users u')) {
        return [{ user_status: 'active', feature_allowed: true }];
      }
      if (sql.includes('INSERT INTO public.ai_generations')) {
        return [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        expect(sql).toContain('input_payload = NULL');
        expect(params?.[0]).toBe(JOB_ID);
        expect(params?.[1]).toBe(WORKER_ID);
        expect(params?.[2]).toBe(1);
        return [{ id: JOB_ID }];
      }
      return [];
    });

    const persistArtifact = vi.fn().mockResolvedValue(undefined);
    const handler: JobHandler = {
      execute: vi.fn(async () => {
        // Claim transaction MUST already be committed (depth === 0) before external AI call runs
        expect(committedClaimTxCount).toBe(1);
        expect(activeTransactionDepth).toBe(0);
        return makeExecResult();
      }),
      persistArtifact,
    };

    const outcomes = await consumer.pollOnce(handler, 1);
    expect(outcomes).toEqual([
      {
        outcome: 'succeeded',
        jobId: JOB_ID,
        resultType: 'roadmap',
        resultId: RESULT_ID,
      },
    ]);
    expect(persistArtifact).toHaveBeenCalledTimes(1);

    const succeededUpdate = queryMock.mock.calls.find(
      ([sql]) =>
        String(sql).includes('UPDATE public.ai_requests') &&
        String(sql).includes("status = 'succeeded'"),
    );
    expect(succeededUpdate).toBeDefined();
    expect(String(succeededUpdate?.[0])).toContain('input_payload = NULL');
  });

  it('renews heartbeat under fence and immediately aborts without committing when fence is lost', async () => {
    vi.useFakeTimers();

    const heartbeatResponses = [[{ id: JOB_ID }], []];
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes('SET locked_at = clock_timestamp()')
      ) {
        expect(params).toEqual([JOB_ID, WORKER_ID, 1]);
        return heartbeatResponses.shift() ?? [];
      }
      return [];
    });

    const persistArtifact = vi.fn();
    let abortedObserved = false;

    const handler: JobHandler = {
      execute: vi.fn(
        (_job, signal) =>
          new Promise<JobExecutionResult>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                abortedObserved = true;
                resolve(makeExecResult());
              },
              { once: true },
            );
          }),
      ),
      persistArtifact,
    };

    const promise = consumer.processClaimedJob(makeClaimedJob(), handler);

    // 1st heartbeat at 30s succeeds
    await vi.advanceTimersByTimeAsync(30_000);
    expect(abortedObserved).toBe(false);

    // 2nd heartbeat at 60s returns 0 rows -> fence lost -> abort signal fires immediately
    await vi.advanceTimersByTimeAsync(30_000);
    expect(abortedObserved).toBe(true);

    const outcome = await promise;
    expect(outcome).toEqual({ outcome: 'fence_lost', jobId: JOB_ID });
    expect(persistArtifact).not.toHaveBeenCalled();

    const succeededUpdate = queryMock.mock.calls.find(
      ([sql]) =>
        String(sql).includes('UPDATE public.ai_requests') &&
        String(sql).includes("status = 'succeeded'"),
    );
    expect(succeededUpdate).toBeUndefined();
  });

  it('aborts commit gate with STALE_JOB_INPUT and clears input_payload when expected_refs drifted', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_ID,
            task: 'roadmap_generate',
            feature_key: 'roadmap_generator',
            status: 'preparing',
            locked_by: WORKER_ID,
            attempt_count: 1,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (sql.includes('FROM public.users u')) {
        return [{ user_status: 'active', feature_allowed: true }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        expect(sql).toContain('input_payload = NULL');
        expect(params?.[3]).toBe('STALE_JOB_INPUT');
        return [{ id: JOB_ID }];
      }
      return [];
    });

    const persistArtifact = vi.fn();
    const handler: JobHandler = {
      execute: vi.fn().mockResolvedValue(makeExecResult()),
      verifyExpectedRefs: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'profile_updated_at drifted',
      }),
      persistArtifact,
    };

    const outcome = await consumer.processClaimedJob(makeClaimedJob(), handler);
    expect(outcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'STALE_JOB_INPUT',
    });
    expect(persistArtifact).not.toHaveBeenCalled();
  });

  it('aborts commit gate when owner is suspended or feature disabled and clears input_payload', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_ID,
            task: 'roadmap_generate',
            feature_key: 'roadmap_generator',
            status: 'preparing',
            locked_by: WORKER_ID,
            attempt_count: 1,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (sql.includes('FROM public.users u')) {
        return [{ user_status: 'suspended', feature_allowed: false }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        expect(sql).toContain('input_payload = NULL');
        expect(params?.[3]).toBe('ACCOUNT_SUSPENDED');
        return [{ id: JOB_ID }];
      }
      return [];
    });

    const persistArtifact = vi.fn();
    const handler: JobHandler = {
      execute: vi.fn().mockResolvedValue(makeExecResult()),
      persistArtifact,
    };

    const outcome = await consumer.processClaimedJob(makeClaimedJob(), handler);
    expect(outcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'ACCOUNT_SUSPENDED',
    });
    expect(persistArtifact).not.toHaveBeenCalled();
  });

  it('clears input_payload = NULL on terminal failure when maxAttempts is reached', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        expect(sql).toContain('retryable = false');
        expect(sql).toContain('input_payload = NULL');
        expect(params?.[0]).toBe(JOB_ID);
        expect(params?.[1]).toBe(WORKER_ID);
        expect(params?.[2]).toBe(5);
        return [{ id: JOB_ID }];
      }
      return [];
    });

    const handler: JobHandler = {
      execute: vi.fn().mockRejectedValue(new Error('Final attempt failure')),
      persistArtifact: vi.fn(),
    };

    const outcome = await consumer.processClaimedJob(
      makeClaimedJob({ attempt_count: 5 }),
      handler,
    );
    expect(outcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'AI_GENERATION_FAILED',
    });
  });

  it('uses two-step preparing -> failed then failed -> queued when retryable error occurs before maxAttempts', async () => {
    const updateOrder: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        expect(sql).toContain('retryable = true');
        expect(sql).not.toContain('input_payload = NULL');
        updateOrder.push('preparing->failed');
        return [{ id: JOB_ID }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'queued'")
      ) {
        expect(sql).toContain("AND status = 'failed'");
        expect(sql).not.toContain("status = 'preparing'");
        updateOrder.push('failed->queued');
        return [{ id: JOB_ID }];
      }
      return [];
    });

    const handler: JobHandler = {
      execute: vi.fn().mockRejectedValue(new Error('Transient failure')),
      persistArtifact: vi.fn(),
    };

    const outcome = await consumer.processClaimedJob(
      makeClaimedJob({ attempt_count: 2 }),
      handler,
    );
    expect(updateOrder).toEqual(['preparing->failed', 'failed->queued']);
    expect(outcome).toEqual({
      outcome: 'failed_requeued',
      jobId: JOB_ID,
      errorCode: 'AI_GENERATION_FAILED',
      nextAttemptDelaySeconds: 4,
    });
  });
});
