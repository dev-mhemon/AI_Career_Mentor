import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import {
  JobProducerService,
  type JobQueryExecutor,
} from './services/job-producer.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const ROADMAP_ID = '33333333-3333-4333-8333-333333333333';
const TOPIC_ID = '44444444-4444-4444-8444-444444444444';
const SKILL_ID = '55555555-5555-4555-8555-555555555555';
const PLAN_ITEM_ID = '66666666-6666-4666-8666-666666666666';
const REVIEW_ID = '77777777-7777-4777-8777-777777777777';
const ATTEMPT_ID = '88888888-8888-4888-8888-888888888888';
const IDEM_KEY = '99999999-9999-4999-8999-999999999999';
const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function expectContractError(
  error: unknown,
  expectedStatus: number,
  expectedCode: string,
): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(expectedStatus);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(expectedCode);
}

describe('JobProducerService (R12 Durable Producer)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let configMock: ConfigService;
  let service: JobProducerService;

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
      get: vi.fn((key: string) =>
        key === 'JOB_RETRY_AFTER_SECONDS' ? '5' : undefined,
      ),
    } as unknown as ConfigService;
    service = new JobProducerService(databaseMock, configMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enqueues valid roadmap_generate envelope atomically and returns 202 JobAcceptedDTO', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: JOB_ID, status: 'queued' }];
      }
      return [];
    });

    const result = await service.enqueue({
      userId: USER_ID,
      kind: 'roadmap_generate',
      idempotencyKey: IDEM_KEY,
      subjectType: 'career_goal',
      subjectId: GOAL_ID,
      language: 'bn',
      envelope: {
        v: 1,
        args: { career_goal_id: GOAL_ID },
        expected_refs: {
          goal_updated_at: '2026-11-18T10:00:00.000Z',
          profile_updated_at: '2026-11-18T09:50:00.000Z',
        },
      },
    });

    expect(result).toEqual({
      job_id: JOB_ID,
      kind: 'roadmap_generate',
      status: 'queued',
      poll_url: `/api/v1/jobs/${JOB_ID}`,
      retry_after_seconds: 5,
    });
    expect(transactionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
      true,
      false,
      true,
    );

    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO public.ai_requests'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall?.[1] as unknown[];
    expect(params[0]).toBe(USER_ID);
    expect(params[1]).toBe('roadmap_generate');
    expect(params[2]).toBe('roadmap_generator');
    expect(params[3]).toBe('roadmap_generate');
    expect(params[4]).toBe(IDEM_KEY);
    expect(params[8]).toBe('bn');
    expect(JSON.parse(String(params[9]))).toEqual({
      v: 1,
      args: { career_goal_id: GOAL_ID },
      expected_refs: {
        goal_updated_at: '2026-11-18T10:00:00.000Z',
        profile_updated_at: '2026-11-18T09:50:00.000Z',
      },
    });
  });

  it('supports all remaining async R12 job kinds and executes directly on caller-supplied transaction without nesting', async () => {
    const callerQueryMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: JOB_ID, status: 'queued' }];
      }
      return [];
    });
    const callerTx: JobQueryExecutor = { query: callerQueryMock };

    const cases = [
      {
        kind: 'roadmap_revision' as const,
        envelope: {
          v: 1,
          args: {
            roadmap_id: ROADMAP_ID,
            base_version_no: 2,
            refresh_stale: true,
          },
          expected_refs: { roadmap_version: 2 },
        },
      },
      {
        kind: 'merge_proposal' as const,
        envelope: {
          v: 1,
          args: {
            roadmap_id: ROADMAP_ID,
            base_version_no: 2,
            origin: 'level_change',
            target_level: 'mid',
          },
          expected_refs: { base_version_no: 2 },
        },
      },
      {
        kind: 'topic_content' as const,
        envelope: {
          v: 1,
          args: {
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            career_level: 'junior',
            content_version: 1,
          },
          expected_refs: { content_version: 1 },
        },
      },
      {
        kind: 'quiz_generate' as const,
        envelope: {
          v: 1,
          args: {
            daily_plan_item_id: PLAN_ITEM_ID,
            topic_id: TOPIC_ID,
            content_version: 1,
            variant_no: 1,
          },
          expected_refs: {},
        },
      },
      {
        kind: 'practice_review' as const,
        envelope: {
          v: 1,
          args: {
            review_id: REVIEW_ID,
            attempt_id: ATTEMPT_ID,
          },
          expected_refs: {
            submitted_at: '2026-11-18T10:00:00.000Z',
            answer_saved_at: '2026-11-18T10:00:00.000Z',
          },
        },
      },
    ];

    for (const item of cases) {
      const dto = await service.enqueue(
        {
          userId: USER_ID,
          kind: item.kind,
          envelope: item.envelope,
        },
        callerTx,
      );
      expect(dto.kind).toBe(item.kind);
      expect(dto.status).toBe('queued');
    }

    expect(transactionMock).not.toHaveBeenCalled();
    expect(callerQueryMock).toHaveBeenCalledTimes(cases.length);
  });

  it('rejects synchronous career_goal kind without querying DB (R12)', async () => {
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'career_goal',
        envelope: { v: 1, args: {}, expected_refs: {} },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'INVALID_ENUM_VALUE');
      return true;
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects oversized (>32KB), missing/unknown expected_refs, NUL bytes, unsupported version, and secret refs before INSERT', async () => {
    // Missing required expected_refs for topic_content
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'topic_content',
        envelope: {
          v: 1,
          args: {
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            career_level: 'junior',
            content_version: 1,
          },
          expected_refs: {},
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // Unknown expected_refs field on roadmap_revision
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_revision',
        envelope: {
          v: 1,
          args: {
            roadmap_id: ROADMAP_ID,
            base_version_no: 1,
            instruction: 'a',
            refresh_stale: true,
          },
          expected_refs: {
            roadmap_version: 1,
            unknown_extra_ref: 'bad',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // Embedded NUL byte rejected (Postgres jsonb rejects \u0000)
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_revision',
        envelope: {
          v: 1,
          args: {
            roadmap_id: ROADMAP_ID,
            base_version_no: 1,
            instruction: 'bad\u0000instruction',
            refresh_stale: false,
          },
          expected_refs: {
            roadmap_version: 1,
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // Unknown top-level key
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        envelope: {
          v: 1,
          args: { career_goal_id: GOAL_ID },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
          extra_key: 'bad',
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // Unknown args key
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        envelope: {
          v: 1,
          args: { career_goal_id: GOAL_ID, injected_prompt: 'override' },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // Unsupported envelope version
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        envelope: {
          v: 2,
          args: { career_goal_id: GOAL_ID },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // Forbidden assembled_prompt key in expected_refs
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'quiz_generate',
        envelope: {
          v: 1,
          args: {
            daily_plan_item_id: PLAN_ITEM_ID,
            topic_id: TOPIC_ID,
            content_version: 1,
            variant_no: 1,
          },
          expected_refs: {
            assembled_prompt: 'secret system prompt',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps PostgreSQL 23505 on uq_ai_requests_idempotency to 409 and rethrows unidentified 23505; maps ck_ai_requests_input_payload 23514 to 422', async () => {
    queryMock.mockRejectedValueOnce({
      code: '23505',
      constraint: 'uq_ai_requests_idempotency',
    });

    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        idempotencyKey: IDEM_KEY,
        envelope: {
          v: 1,
          args: { career_goal_id: GOAL_ID },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // TypeORM QueryFailedError wrapping driverError with 23505 + uq_ai_requests_idempotency also maps to 409
    queryMock.mockRejectedValueOnce({
      driverError: {
        code: '23505',
        constraint: 'uq_ai_requests_idempotency',
      },
    });
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        idempotencyKey: IDEM_KEY,
        envelope: {
          v: 1,
          args: { career_goal_id: GOAL_ID },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'IDEMPOTENCY_KEY_REUSED');
      return true;
    });

    // Unidentified 23505 without uq_ai_requests_idempotency must NOT be misclassified as 409
    const unknownUnique = { code: '23505', message: 'duplicate key violation' };
    queryMock.mockRejectedValueOnce(unknownUnique);
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        envelope: {
          v: 1,
          args: { career_goal_id: GOAL_ID },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
        },
      }),
    ).rejects.toBe(unknownUnique);

    // ck_ai_requests_input_payload 23514 maps cleanly to 422 VALIDATION_FAILED
    queryMock.mockRejectedValueOnce({
      code: '23514',
      constraint: 'ck_ai_requests_input_payload',
    });
    await expect(
      service.enqueue({
        userId: USER_ID,
        kind: 'roadmap_generate',
        envelope: {
          v: 1,
          args: { career_goal_id: GOAL_ID },
          expected_refs: {
            goal_updated_at: '2026-11-18T10:00:00.000Z',
            profile_updated_at: '2026-11-18T10:00:00.000Z',
          },
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });
  });

  it('never logs input_payload contents during enqueue and permits literal backslash-u0000 text', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    const debugSpy = vi.spyOn(Logger.prototype, 'debug');
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    queryMock.mockResolvedValueOnce([{ id: JOB_ID, status: 'queued' }]);

    await service.enqueue({
      userId: USER_ID,
      kind: 'roadmap_revision',
      envelope: {
        v: 1,
        args: {
          roadmap_id: ROADMAP_ID,
          base_version_no: 1,
          instruction: 'SENTINEL_PRIVATE_REVISION_TEXT \\u0000',
          refresh_stale: false,
        },
        expected_refs: { roadmap_version: 1 },
      },
    });

    for (const spy of [logSpy, debugSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(
          'SENTINEL_PRIVATE_REVISION_TEXT',
        );
      }
    }
  });
});
