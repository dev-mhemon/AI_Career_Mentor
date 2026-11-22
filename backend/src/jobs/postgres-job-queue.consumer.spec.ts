import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../auth/services/database.service.js';
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

  it('commits SKIP LOCKED claim using available_at BEFORE calling external handler.execute and locks users FOR SHARE before ai_requests FOR UPDATE', async () => {
    const claimed = makeClaimedJob();
    const lockOrder: string[] = [];
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FOR UPDATE SKIP LOCKED') &&
        sql.includes("status = 'queued'") &&
        sql.includes('available_at <= clock_timestamp()')
      ) {
        expect(params).toEqual([5, 3600, 1, WORKER_ID]);
        committedClaimTxCount += 1;
        return [[claimed], 1];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users') &&
        !sql.includes('lease_valid')
      ) {
        lockOrder.push('ai_requests_unlocked_lookup');
        return [{ user_id: USER_ID, feature_key: 'roadmap_generator' }];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        lockOrder.push('ai_requests_for_update');
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
        expect(sql).toContain('FOR SHARE OF u');
        lockOrder.push('users_for_share');
        return [{ user_status: 'active', feature_allowed: true }];
      }
      if (
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        return [
          {
            within_deadline: true,
            user_status: 'active',
            feature_allowed: true,
          },
        ];
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
        return [[{ id: JOB_ID }], 1];
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
      verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
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
    expect(lockOrder).toEqual([
      'ai_requests_unlocked_lookup',
      'users_for_share',
      'ai_requests_for_update',
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

  it('returns fence_lost without locking users or persisting artifacts when ai_requests row is missing on commit gate lookup', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE')
      ) {
        return [];
      }
      return [];
    });

    const persistArtifact = vi.fn();
    const outcome = await consumer.processClaimedJob(makeClaimedJob(), {
      execute: vi.fn().mockResolvedValue(makeExecResult()),
      verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
      persistArtifact,
    });
    expect(outcome).toEqual({ outcome: 'fence_lost', jobId: JOB_ID });
    expect(persistArtifact).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes('FROM public.users u'),
      ),
    ).toBe(false);
  });

  it('renews heartbeat under fence and immediately aborts without committing when fence is lost', async () => {
    vi.useFakeTimers();

    const heartbeatResponses = [
      [[{ id: JOB_ID }], 1],
      [[], 0],
    ];
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes('SET locked_at = clock_timestamp()')
      ) {
        expect(sql).toContain('created_at > clock_timestamp()');
        expect(params).toEqual([JOB_ID, WORKER_ID, 1, 3600]);
        return heartbeatResponses.shift() ?? [[], 0];
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
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'roadmap_generator' }];
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
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'roadmap_generator' }];
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

  it('unwraps TypeORM [rows, rowCount] tuples through real DatabaseService.transaction for claimBatch and sendHeartbeat', async () => {
    const claimed = makeClaimedJob();
    const responses: unknown[] = [
      [[claimed], 1],
      [[], 0],
      [[{ id: JOB_ID }], 1],
      [[], 0],
    ];
    const qrManagerQuery = vi.fn(async (sql: string) => {
      if (sql.includes('SET LOCAL ROLE')) {
        return [];
      }
      return responses.shift() ?? [[], 0];
    });
    const fakeQueryRunner = {
      connect: vi.fn().mockResolvedValue(undefined),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn().mockResolvedValue(undefined),
      rollbackTransaction: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      manager: { query: qrManagerQuery },
    };
    const realDatabase = new DatabaseService({
      createQueryRunner: vi.fn(() => fakeQueryRunner),
    } as unknown as DataSource);
    const realConsumer = new PostgresJobQueueConsumer(
      realDatabase,
      configMock,
      () => 0,
      WORKER_ID,
    );

    const firstClaim = await realConsumer.claimBatch(1);
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]?.id).toBe(JOB_ID);

    const emptyClaim = await realConsumer.claimBatch(1);
    expect(emptyClaim).toEqual([]);

    const renewed = await realConsumer.sendHeartbeat({
      requestId: JOB_ID,
      lockedBy: WORKER_ID,
      attemptCount: 1,
    });
    expect(renewed).toBe(true);

    const lost = await realConsumer.sendHeartbeat({
      requestId: JOB_ID,
      lockedBy: WORKER_ID,
      attemptCount: 1,
    });
    expect(lost).toBe(false);
  });

  it('requires verifyExpectedRefs for ref-bearing kinds, rechecks deadline before persistArtifact, handles [[], 0] requeue cleanup, and redacts commit-gate error logs', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');

    // 1. Missing verifyExpectedRefs on ref-bearing roadmap_generate fails closed before persistArtifact
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'roadmap_generator' }];
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
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        return [[{ id: JOB_ID }], 1];
      }
      return [];
    });

    const persistWithoutVerifier = vi.fn();
    const missingVerifierOutcome = await consumer.processClaimedJob(
      makeClaimedJob(),
      {
        execute: vi.fn().mockResolvedValue(makeExecResult()),
        persistArtifact: persistWithoutVerifier,
      },
    );
    expect(missingVerifierOutcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'STALE_JOB_INPUT',
    });
    expect(persistWithoutVerifier).not.toHaveBeenCalled();

    // 2. Deadline expires during verifyExpectedRefs -> terminal failure before persistArtifact
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'roadmap_generator' }];
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
      if (
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        return [
          {
            within_deadline: false,
            user_status: 'active',
            feature_allowed: true,
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
        return [[{ id: JOB_ID }], 1];
      }
      return [];
    });

    const persistAfterExpiry = vi.fn();
    const expiredDuringRefs = await consumer.processClaimedJob(
      makeClaimedJob(),
      {
        execute: vi.fn().mockResolvedValue(makeExecResult()),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact: persistAfterExpiry,
      },
    );
    expect(expiredDuringRefs).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'WORKER_LEASE_EXPIRED',
    });
    expect(persistAfterExpiry).not.toHaveBeenCalled();

    // 3. persistArtifact throws raw instruction + requeue UPDATE returns [[], 0] -> purges input_payload & never logs raw exception message
    let terminalPurgeRan = false;
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'roadmap_generator' }];
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
            attempt_count: 2,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        return [
          {
            within_deadline: true,
            user_status: 'active',
            feature_allowed: true,
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
        return [[{ id: JOB_ID }], 1];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'queued'")
      ) {
        return [[], 0];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes('SET retryable = false') &&
        sql.includes('input_payload = NULL')
      ) {
        terminalPurgeRan = true;
        return [[{ id: JOB_ID }], 1];
      }
      return [];
    });

    const commitErrOutcome = await consumer.processClaimedJob(
      makeClaimedJob({ attempt_count: 2 }),
      {
        execute: vi.fn().mockResolvedValue(makeExecResult()),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact: vi
          .fn()
          .mockRejectedValue(
            new Error('DB write error: SECRET_USER_REVISION_INSTRUCTION_999'),
          ),
      },
    );
    expect(commitErrOutcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'AI_GENERATION_FAILED',
    });
    expect(terminalPurgeRan).toBe(true);
    for (const call of warnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(
        'SECRET_USER_REVISION_INSTRUCTION_999',
      );
    }
  });

  it('unconditionally rechecks deadline before persistArtifact even when verifyExpectedRefs is omitted (quiz_generate with empty expected_refs)', async () => {
    const quizJob = makeClaimedJob({
      task: 'quiz_generate',
      feature_key: 'quiz_practice',
      job_kind: 'quiz_generate',
      input_payload: {
        v: 1,
        args: {
          daily_plan_item_id: RESULT_ID,
          topic_id: RESULT_ID,
          content_version: 1,
          variant_no: 1,
        },
        expected_refs: {},
      },
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'quiz_practice' }];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_ID,
            task: 'quiz_generate',
            feature_key: 'quiz_practice',
            status: 'preparing',
            locked_by: WORKER_ID,
            attempt_count: 1,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        return [
          {
            within_deadline: false,
            user_status: 'active',
            feature_allowed: true,
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
        return [[{ id: JOB_ID }], 1];
      }
      return [];
    });

    const persistArtifact = vi.fn();
    const outcome = await consumer.processClaimedJob(quizJob, {
      execute: vi.fn().mockResolvedValue(makeExecResult()),
      persistArtifact,
    });
    expect(outcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'WORKER_LEASE_EXPIRED',
    });
    expect(persistArtifact).not.toHaveBeenCalled();
  });

  it('waits for all started batch jobs via Promise.allSettled before clearing pollingInFlight when a sibling job rejects', async () => {
    vi.useFakeTimers();

    const jobA = makeClaimedJob({
      id: '11111111-1111-4111-8111-111111111111',
    });
    const jobB = makeClaimedJob({
      id: '22222222-2222-4222-8222-222222222222',
    });

    let resolveJobB!: () => void;
    const jobBPending = new Promise<void>((resolve) => {
      resolveJobB = resolve;
    });

    const claimSpy = vi
      .spyOn(consumer, 'claimBatch')
      .mockResolvedValueOnce([jobA, jobB])
      .mockResolvedValue([]);
    vi.spyOn(consumer, 'processClaimedJob').mockImplementation(async (job) => {
      if (job.id === jobA.id) {
        throw new Error('Job A crashed unexpectedly');
      }
      await jobBPending;
      return {
        outcome: 'succeeded',
        jobId: job.id,
        resultType: 'roadmap',
        resultId: RESULT_ID,
      };
    });

    const dummyHandler: JobHandler = {
      execute: vi.fn(),
      persistArtifact: vi.fn(),
    };

    consumer.start(dummyHandler, 2);

    // 1st poll tick claims [jobA, jobB]; jobA rejects immediately while jobB remains pending
    await vi.advanceTimersByTimeAsync(1_000);
    expect(claimSpy).toHaveBeenCalledTimes(1);

    // Next poll ticks MUST NOT overlap because pollingInFlight remains locked until jobB settles
    await vi.advanceTimersByTimeAsync(3_000);
    expect(claimSpy).toHaveBeenCalledTimes(1);

    // Resolve jobB -> pollOnce finishes settling -> pollingInFlight clears -> next tick runs
    resolveJobB();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(claimSpy).toHaveBeenCalledTimes(2);
    consumer.stop();
  });

  it('registers multiple handlers by job_kind, filters claimBatch via ANY($5::public.job_kind[]), dispatches per kind, and starts idempotently', async () => {
    const roadmapJob = makeClaimedJob({
      id: '11111111-1111-4111-8111-111111111111',
      job_kind: 'roadmap_generate',
      task: 'roadmap_generate',
    });
    const topicJob = makeClaimedJob({
      id: '22222222-2222-4222-8222-222222222222',
      job_kind: 'topic_content',
      task: 'topic_content',
      feature_key: 'daily_plan',
      input_payload: {
        v: 1,
        args: {
          topic_id: RESULT_ID,
          skill_id: RESULT_ID,
          career_level: 'junior',
          content_version: 1,
        },
        expected_refs: { content_version: 1 },
      },
    });

    const roadmapHandler: JobHandler = {
      execute: vi.fn().mockResolvedValue(makeExecResult()),
      verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
      persistArtifact: vi.fn().mockResolvedValue({
        resultType: 'roadmap',
        resultId: RESULT_ID,
      }),
    };
    const topicHandler: JobHandler = {
      execute: vi.fn().mockResolvedValue({
        ...makeExecResult(),
        resultType: 'topic',
        outputSchemaId: 'topic_content.v1',
      }),
      verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
      persistArtifact: vi.fn().mockResolvedValue({
        resultType: 'topic',
        resultId: RESULT_ID,
      }),
    };

    consumer.registerHandler('roadmap_generate', roadmapHandler);
    consumer.registerHandler('topic_content', topicHandler);
    expect(consumer.getRegisteredKinds()).toEqual([
      'roadmap_generate',
      'topic_content',
    ]);

    const accessFeatureKeys: string[] = [];
    const recheckFeatureKeys: Record<string, unknown> = {};
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        expect(sql).toContain('AND job_kind = ANY($5::public.job_kind[])');
        expect(params).toEqual([
          5,
          3600,
          2,
          WORKER_ID,
          ['roadmap_generate', 'topic_content'],
        ]);
        return [[roadmapJob, topicJob], 2];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users') &&
        !sql.includes('lease_valid')
      ) {
        const reqId = String(params?.[0]);
        return [
          {
            user_id: USER_ID,
            feature_key:
              reqId === topicJob.id ? 'daily_plan' : 'roadmap_generator',
          },
        ];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        const reqId = String(params?.[0]);
        return [
          {
            id: reqId,
            user_id: USER_ID,
            task: reqId === topicJob.id ? 'topic_content' : 'roadmap_generate',
            feature_key:
              reqId === topicJob.id ? 'daily_plan' : 'roadmap_generator',
            status: 'preparing',
            locked_by: WORKER_ID,
            attempt_count: 1,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (sql.includes('FROM public.users u')) {
        accessFeatureKeys.push(String(params?.[1]));
        return [{ user_status: 'active', feature_allowed: true }];
      }
      if (
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        recheckFeatureKeys[String(params?.[0])] = params?.[3];
        return [
          {
            within_deadline: true,
            user_status: 'active',
            feature_allowed: true,
          },
        ];
      }
      if (sql.includes('INSERT INTO public.ai_generations')) {
        return [[{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }], 1];
      }
      if (sql.includes('lease_valid') && !sql.includes('FOR UPDATE')) {
        return [{ lease_valid: true, within_deadline: true }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        return [[{ id: String(params?.[0]) }], 1];
      }
      return [];
    });

    const outcomes = await consumer.pollOnce(2);
    expect(outcomes).toEqual([
      {
        outcome: 'succeeded',
        jobId: roadmapJob.id,
        resultType: 'roadmap',
        resultId: RESULT_ID,
      },
      {
        outcome: 'succeeded',
        jobId: topicJob.id,
        resultType: 'topic',
        resultId: RESULT_ID,
      },
    ]);
    expect(accessFeatureKeys.sort()).toEqual([
      'daily_plan',
      'roadmap_generator',
    ]);
    expect(recheckFeatureKeys).toEqual({
      [roadmapJob.id]: 'roadmap_generator',
      [topicJob.id]: 'daily_plan',
    });
    expect(roadmapHandler.execute).toHaveBeenCalledTimes(1);
    expect(topicHandler.execute).toHaveBeenCalledTimes(1);

    // Idempotent start() starts only one interval timer across modules
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    consumer.start();
    consumer.start();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    consumer.stop();
  });

  it('inserts ai_generations BEFORE calling persistArtifact and passes aiGenerationId in commit context, and skips ai_generations on skipAiGeneration=true', async () => {
    const GEN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const order: string[] = [];

    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users')
      ) {
        return [{ user_id: USER_ID, feature_key: 'daily_plan' }];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_ID,
            task: 'topic_content',
            feature_key: 'daily_plan',
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
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        return [
          {
            within_deadline: true,
            user_status: 'active',
            feature_allowed: true,
          },
        ];
      }
      if (sql.includes('INSERT INTO public.ai_generations')) {
        order.push('insert_ai_generations');
        return [[{ id: GEN_ID }], 1];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        order.push('update_ai_requests_succeeded');
        return [[{ id: JOB_ID }], 1];
      }
      return [];
    });

    const persistSpy = vi.fn(async (_tx, _job, _res, ctx) => {
      order.push(`persist_artifact:${ctx?.aiGenerationId ?? 'null'}`);
      return { resultType: 'topic', resultId: RESULT_ID };
    });

    const normalOutcome = await consumer.processClaimedJob(
      makeClaimedJob({
        task: 'topic_content',
        job_kind: 'topic_content',
        feature_key: 'daily_plan',
      }),
      {
        execute: vi.fn().mockResolvedValue({
          ...makeExecResult(),
          resultType: 'topic',
          outputSchemaId: 'topic_content.v1',
        }),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact: persistSpy,
      },
    );

    expect(normalOutcome).toEqual({
      outcome: 'succeeded',
      jobId: JOB_ID,
      resultType: 'topic',
      resultId: RESULT_ID,
    });
    expect(order).toEqual([
      'insert_ai_generations',
      `persist_artifact:${GEN_ID}`,
      'update_ai_requests_succeeded',
    ]);

    // Short-circuit reuse (`skipAiGeneration: true`) omits ai_generations insert and passes null
    order.length = 0;
    const reuseOutcome = await consumer.processClaimedJob(
      makeClaimedJob({
        task: 'topic_content',
        job_kind: 'topic_content',
        feature_key: 'daily_plan',
      }),
      {
        execute: vi.fn().mockResolvedValue({
          ...makeExecResult(),
          resultType: 'topic',
          outputSchemaId: 'topic_content.v1',
          skipAiGeneration: true,
        }),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact: persistSpy,
      },
    );

    expect(reuseOutcome).toEqual({
      outcome: 'succeeded',
      jobId: JOB_ID,
      resultType: 'topic',
      resultId: RESULT_ID,
    });
    expect(order).toEqual([
      'persist_artifact:null',
      'update_ai_requests_succeeded',
    ]);
  });

  it('returns [] immediately for explicit empty jobKinds in claimBatch and preserves unfiltered claim when fallback handler is passed alongside registered handlers', async () => {
    // Explicit empty list must NOT drop the job_kind filter
    const emptyClaim = await consumer.claimBatch(5, []);
    expect(emptyClaim).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();

    const roadmapJob = makeClaimedJob({
      id: '11111111-1111-4111-8111-111111111111',
      job_kind: 'roadmap_generate',
      task: 'roadmap_generate',
    });
    const fallbackJob = makeClaimedJob({
      id: '22222222-2222-4222-8222-222222222222',
      job_kind: 'topic_content',
      task: 'topic_content',
      feature_key: 'daily_plan',
      input_payload: {
        v: 1,
        args: {
          topic_id: RESULT_ID,
          skill_id: RESULT_ID,
          career_level: 'mid',
          content_version: 1,
        },
        expected_refs: { content_version: 1 },
      },
    });

    const registeredHandler: JobHandler = {
      execute: vi.fn().mockResolvedValue(makeExecResult()),
      verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
      persistArtifact: vi.fn().mockResolvedValue({
        resultType: 'roadmap',
        resultId: RESULT_ID,
      }),
    };
    const fallbackHandler: JobHandler = {
      execute: vi.fn().mockResolvedValue({
        ...makeExecResult(),
        resultType: 'topic',
        outputSchemaId: 'topic_content.v1',
      }),
      verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
      persistArtifact: vi.fn().mockResolvedValue({
        resultType: 'topic',
        resultId: RESULT_ID,
      }),
    };

    consumer.registerHandler('roadmap_generate', registeredHandler);

    const fallbackAccessFeatureKeys: string[] = [];
    const fallbackRecheckFeatureKeys: Record<string, unknown> = {};
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        expect(sql).not.toContain('AND job_kind = ANY($5::public.job_kind[])');
        expect(params).toEqual([5, 3600, 2, WORKER_ID]);
        return [[roadmapJob, fallbackJob], 2];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('JOIN public.users') &&
        !sql.includes('lease_valid')
      ) {
        const reqId = String(params?.[0]);
        return [
          {
            user_id: USER_ID,
            feature_key:
              reqId === fallbackJob.id ? 'daily_plan' : 'roadmap_generator',
          },
        ];
      }
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('FOR UPDATE')
      ) {
        const reqId = String(params?.[0]);
        return [
          {
            id: reqId,
            user_id: USER_ID,
            task:
              reqId === fallbackJob.id ? 'topic_content' : 'roadmap_generate',
            feature_key:
              reqId === fallbackJob.id ? 'daily_plan' : 'roadmap_generator',
            status: 'preparing',
            locked_by: WORKER_ID,
            attempt_count: 1,
            lease_valid: true,
            within_deadline: true,
          },
        ];
      }
      if (sql.includes('FROM public.users u')) {
        fallbackAccessFeatureKeys.push(String(params?.[1]));
        return [{ user_status: 'active', feature_allowed: true }];
      }
      if (
        sql.includes('FROM public.ai_requests r') &&
        sql.includes('JOIN public.users u')
      ) {
        fallbackRecheckFeatureKeys[String(params?.[0])] = params?.[3];
        return [
          {
            within_deadline: true,
            user_status: 'active',
            feature_allowed: true,
          },
        ];
      }
      if (sql.includes('INSERT INTO public.ai_generations')) {
        return [[{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }], 1];
      }
      if (sql.includes('lease_valid') && !sql.includes('FOR UPDATE')) {
        return [{ lease_valid: true, within_deadline: true }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        return [[{ id: String(params?.[0]) }], 1];
      }
      return [];
    });

    const outcomes = await consumer.pollOnce(fallbackHandler, 2);
    expect(outcomes).toEqual([
      {
        outcome: 'succeeded',
        jobId: roadmapJob.id,
        resultType: 'roadmap',
        resultId: RESULT_ID,
      },
      {
        outcome: 'succeeded',
        jobId: fallbackJob.id,
        resultType: 'topic',
        resultId: RESULT_ID,
      },
    ]);
    expect(fallbackAccessFeatureKeys.sort()).toEqual([
      'daily_plan',
      'roadmap_generator',
    ]);
    expect(fallbackRecheckFeatureKeys).toEqual({
      [roadmapJob.id]: 'roadmap_generator',
      [fallbackJob.id]: 'daily_plan',
    });
    expect(registeredHandler.execute).toHaveBeenCalledTimes(1);
    expect(fallbackHandler.execute).toHaveBeenCalledTimes(1);
  });

  it('rolls back provisional ai_generations and distinguishes pre-persist deadline expiry (WORKER_LEASE_EXPIRED) from lease-only expiry (fence_lost)', async () => {
    const trace: string[] = [];
    let prePersistRow = { lease_valid: true, within_deadline: false };
    const fakeQueryRunner = {
      connect: vi.fn().mockResolvedValue(undefined),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn(async () => {
        trace.push('commit');
      }),
      rollbackTransaction: vi.fn(async () => {
        trace.push('rollback');
      }),
      release: vi.fn().mockResolvedValue(undefined),
      manager: {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('SET LOCAL ROLE')) {
            return [];
          }
          if (
            sql.includes('FROM public.ai_requests') &&
            !sql.includes('FOR UPDATE') &&
            !sql.includes('JOIN public.users') &&
            !sql.includes('lease_valid')
          ) {
            return [{ user_id: USER_ID, feature_key: 'daily_plan' }];
          }
          if (sql.includes('FROM public.users u')) {
            return [{ user_status: 'active', feature_allowed: true }];
          }
          if (
            sql.includes('FROM public.ai_requests') &&
            sql.includes('FOR UPDATE')
          ) {
            return [
              {
                id: JOB_ID,
                user_id: USER_ID,
                task: 'topic_content',
                feature_key: 'daily_plan',
                status: 'preparing',
                locked_by: WORKER_ID,
                attempt_count: 1,
                lease_valid: true,
                within_deadline: true,
              },
            ];
          }
          if (
            sql.includes('FROM public.ai_requests r') &&
            sql.includes('JOIN public.users u')
          ) {
            return [
              {
                within_deadline: true,
                user_status: 'active',
                feature_allowed: true,
              },
            ];
          }
          if (sql.includes('INSERT INTO public.ai_generations')) {
            trace.push('insert_ai_generations');
            return [[{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }], 1];
          }
          if (sql.includes('lease_valid') && !sql.includes('FOR UPDATE')) {
            trace.push('lease_recheck');
            return [prePersistRow];
          }
          if (
            sql.includes('UPDATE public.ai_requests') &&
            sql.includes("SET status = 'failed'")
          ) {
            trace.push('update_failed');
            return [[{ id: JOB_ID }], 1];
          }
          return [];
        }),
      },
    };

    const realDatabase = new DatabaseService({
      createQueryRunner: vi.fn(() => fakeQueryRunner),
    } as unknown as DataSource);
    const realConsumer = new PostgresJobQueueConsumer(
      realDatabase,
      configMock,
      () => 0,
      WORKER_ID,
    );

    const persistArtifact = vi.fn();
    // 1. Deadline expiry (`within_deadline: false`) -> rolls back and marks terminal WORKER_LEASE_EXPIRED
    const deadlineOutcome = await realConsumer.processClaimedJob(
      makeClaimedJob({
        task: 'topic_content',
        job_kind: 'topic_content',
        feature_key: 'daily_plan',
      }),
      {
        execute: vi.fn().mockResolvedValue({
          ...makeExecResult(),
          resultType: 'topic',
          outputSchemaId: 'topic_content.v1',
        }),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact,
      },
    );

    expect(deadlineOutcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'WORKER_LEASE_EXPIRED',
    });
    expect(persistArtifact).not.toHaveBeenCalled();
    expect(trace).toEqual([
      'insert_ai_generations',
      'lease_recheck',
      'rollback',
      'update_failed',
      'commit',
    ]);

    // 2. Reused artifact path (skipAiGeneration: true) with deadline expiry also marks WORKER_LEASE_EXPIRED
    trace.length = 0;
    const reusedOutcome = await realConsumer.processClaimedJob(
      makeClaimedJob({
        task: 'topic_content',
        job_kind: 'topic_content',
        feature_key: 'daily_plan',
      }),
      {
        execute: vi.fn().mockResolvedValue({
          ...makeExecResult(),
          resultType: 'topic',
          outputSchemaId: 'topic_content.v1',
          skipAiGeneration: true,
        }),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact,
      },
    );
    expect(reusedOutcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'WORKER_LEASE_EXPIRED',
    });
    expect(persistArtifact).not.toHaveBeenCalled();
    expect(trace).toEqual([
      'lease_recheck',
      'rollback',
      'update_failed',
      'commit',
    ]);

    // 3. Lease-only expiry (`lease_valid: false, within_deadline: true`) -> rolls back and returns fence_lost without terminal failure
    trace.length = 0;
    prePersistRow = { lease_valid: false, within_deadline: true };
    const leaseOnlyOutcome = await realConsumer.processClaimedJob(
      makeClaimedJob({
        task: 'topic_content',
        job_kind: 'topic_content',
        feature_key: 'daily_plan',
      }),
      {
        execute: vi.fn().mockResolvedValue({
          ...makeExecResult(),
          resultType: 'topic',
          outputSchemaId: 'topic_content.v1',
        }),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact,
      },
    );
    expect(leaseOnlyOutcome).toEqual({
      outcome: 'fence_lost',
      jobId: JOB_ID,
    });
    expect(persistArtifact).not.toHaveBeenCalled();
    expect(trace).toEqual([
      'insert_ai_generations',
      'lease_recheck',
      'rollback',
    ]);
  });

  it('enforces max-age deadline atomically in finalizing UPDATE and rolls back persisted artifact to WORKER_LEASE_EXPIRED on expiry', async () => {
    const trace: string[] = [];
    let finalizeSqlSeen = '';
    let finalizeParamsSeen: unknown[] = [];

    const fakeQueryRunner = {
      connect: vi.fn().mockResolvedValue(undefined),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn(async () => {
        trace.push('commit');
      }),
      rollbackTransaction: vi.fn(async () => {
        trace.push('rollback');
      }),
      release: vi.fn().mockResolvedValue(undefined),
      manager: {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('SET LOCAL ROLE')) {
            return [];
          }
          if (
            sql.includes('FROM public.ai_requests') &&
            !sql.includes('FOR UPDATE') &&
            !sql.includes('JOIN public.users') &&
            !sql.includes('lease_valid') &&
            !sql.includes('within_deadline')
          ) {
            return [{ user_id: USER_ID, feature_key: 'daily_plan' }];
          }
          if (sql.includes('FROM public.users u')) {
            return [{ user_status: 'active', feature_allowed: true }];
          }
          if (
            sql.includes('FROM public.ai_requests') &&
            sql.includes('FOR UPDATE')
          ) {
            return [
              {
                id: JOB_ID,
                user_id: USER_ID,
                task: 'topic_content',
                feature_key: 'daily_plan',
                status: 'preparing',
                locked_by: WORKER_ID,
                attempt_count: 1,
                lease_valid: true,
                within_deadline: true,
              },
            ];
          }
          if (
            sql.includes('FROM public.ai_requests r') &&
            sql.includes('JOIN public.users u')
          ) {
            return [
              {
                within_deadline: true,
                user_status: 'active',
                feature_allowed: true,
              },
            ];
          }
          if (sql.includes('INSERT INTO public.ai_generations')) {
            trace.push('insert_ai_generations');
            return [[{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }], 1];
          }
          if (sql.includes('lease_valid') && !sql.includes('FOR UPDATE')) {
            trace.push('lease_recheck');
            return [{ lease_valid: true, within_deadline: true }];
          }
          if (
            sql.includes('UPDATE public.ai_requests') &&
            sql.includes("SET status = 'succeeded'")
          ) {
            finalizeSqlSeen = sql;
            finalizeParamsSeen = params ?? [];
            trace.push('finalize_update_empty');
            return [[], 0];
          }
          if (
            sql.includes('AS within_deadline') &&
            !sql.includes('lease_valid') &&
            !sql.includes('JOIN public.users')
          ) {
            trace.push('deadline_recheck');
            return [{ within_deadline: false }];
          }
          if (
            sql.includes('UPDATE public.ai_requests') &&
            sql.includes("SET status = 'failed'")
          ) {
            trace.push('update_failed');
            return [[{ id: JOB_ID }], 1];
          }
          return [];
        }),
      },
    };

    const realDatabase = new DatabaseService({
      createQueryRunner: vi.fn(() => fakeQueryRunner),
    } as unknown as DataSource);
    const realConsumer = new PostgresJobQueueConsumer(
      realDatabase,
      configMock,
      () => 0,
      WORKER_ID,
    );

    const persistArtifact = vi.fn(async () => {
      trace.push('persist_artifact');
      return { resultType: 'topic' as const, resultId: RESULT_ID };
    });

    const outcome = await realConsumer.processClaimedJob(
      makeClaimedJob({
        task: 'topic_content',
        job_kind: 'topic_content',
        feature_key: 'daily_plan',
      }),
      {
        execute: vi.fn().mockResolvedValue({
          ...makeExecResult(),
          resultType: 'topic',
          outputSchemaId: 'topic_content.v1',
        }),
        verifyExpectedRefs: vi.fn().mockResolvedValue({ ok: true }),
        persistArtifact,
      },
    );

    expect(finalizeSqlSeen).toContain(
      "created_at > clock_timestamp() - ($13 * interval '1 second')",
    );
    expect(finalizeParamsSeen[12]).toBe(3600);
    expect(outcome).toEqual({
      outcome: 'failed_terminal',
      jobId: JOB_ID,
      errorCode: 'WORKER_LEASE_EXPIRED',
    });
    expect(trace).toEqual([
      'insert_ai_generations',
      'lease_recheck',
      'persist_artifact',
      'finalize_update_empty',
      'deadline_recheck',
      'rollback',
      'update_failed',
      'commit',
    ]);
  });
});
