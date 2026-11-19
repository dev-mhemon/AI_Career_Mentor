import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { JobService } from './services/job.service.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROADMAP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function expectContractError(
  error: unknown,
  expectedStatus: number,
  expectedCode: string,
) {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(expectedStatus);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(expectedCode);
}

describe('JobService (EP-J01 GET /api/v1/jobs/:id)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let service: JobService;

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
    service = new JobService(databaseMock);
  });

  it('returns queued and preparing jobs with null result_ref, null error, and null finished_at', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1 AND user_id = $2') &&
        params?.[0] === JOB_ID &&
        params?.[1] === USER_A
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_A,
            job_kind: 'roadmap_generate',
            status: 'preparing',
            result_type: null,
            result_id: null,
            error_code: null,
            error_message: null,
            retryable: false,
            created_at: new Date('2026-11-18T10:00:00.000Z'),
            finished_at: null,
          },
        ];
      }
      return [];
    });

    const dto = await service.getJobStatus(USER_A, JOB_ID);
    expect(dto).toEqual({
      job_id: JOB_ID,
      kind: 'roadmap_generate',
      status: 'preparing',
      result_ref: null,
      error: null,
      retryable: false,
      created_at: '2026-11-18T10:00:00.000Z',
      finished_at: null,
    });
  });

  it('returns succeeded job with populated result_ref and ISO timestamps', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1 AND user_id = $2') &&
        params?.[0] === JOB_ID &&
        params?.[1] === USER_A
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_A,
            job_kind: 'roadmap_generate',
            status: 'succeeded',
            result_type: 'roadmap',
            result_id: ROADMAP_ID,
            error_code: null,
            error_message: null,
            retryable: false,
            created_at: new Date('2026-11-18T10:00:00.000Z'),
            finished_at: new Date('2026-11-18T10:00:04.000Z'),
          },
        ];
      }
      return [];
    });

    const dto = await service.getJobStatus(USER_A, JOB_ID);
    expect(dto).toEqual({
      job_id: JOB_ID,
      kind: 'roadmap_generate',
      status: 'succeeded',
      result_ref: {
        type: 'roadmap',
        id: ROADMAP_ID,
      },
      error: null,
      retryable: false,
      created_at: '2026-11-18T10:00:00.000Z',
      finished_at: '2026-11-18T10:00:04.000Z',
    });
  });

  it('returns failed job with sanitized error object and retryable flag', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1 AND user_id = $2') &&
        params?.[0] === JOB_ID &&
        params?.[1] === USER_A
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_A,
            job_kind: 'quiz_generate',
            status: 'failed',
            result_type: null,
            result_id: null,
            error_code: 'AI_VALIDATION_FAILED',
            error_message:
              'postgres stack trace: select * from secret provider_key=openai model_id=123 input_payload={}',
            retryable: true,
            created_at: '2026-11-18T10:00:00.000Z',
            finished_at: '2026-11-18T10:00:05.000Z',
          },
        ];
      }
      return [];
    });

    const dto = await service.getJobStatus(USER_A, JOB_ID);
    expect(dto).toEqual({
      job_id: JOB_ID,
      kind: 'quiz_generate',
      status: 'failed',
      result_ref: null,
      error: {
        code: 'AI_VALIDATION_FAILED',
        message:
          'AI output failed validation and was discarded. Please try again.',
        retryable: true,
      },
      retryable: true,
      created_at: '2026-11-18T10:00:00.000Z',
      finished_at: '2026-11-18T10:00:05.000Z',
    });
  });

  it('returns failed job with fixed canonical message and ignores raw row.error_message even without blacklist keywords', async () => {
    const rawErrorMessage = 'Gemini rejected prompt: confidential career goal';
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      expect(sql).not.toMatch(/\berror_message\b/i);
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1 AND user_id = $2') &&
        params?.[0] === JOB_ID &&
        params?.[1] === USER_A
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_A,
            job_kind: 'roadmap_generate',
            status: 'failed',
            result_type: null,
            result_id: null,
            error_code: 'AI_SERVICE_ERROR',
            error_message: rawErrorMessage,
            retryable: true,
            created_at: '2026-11-18T10:00:00.000Z',
            finished_at: '2026-11-18T10:00:05.000Z',
          },
        ];
      }
      return [];
    });

    const dto = await service.getJobStatus(USER_A, JOB_ID);
    expect(dto.error).toEqual({
      code: 'AI_SERVICE_ERROR',
      message: 'AI service encountered an error. Please try again later.',
      retryable: true,
    });
    for (const word of rawErrorMessage
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean)) {
      expect(dto.error!.message.toLowerCase()).not.toContain(word);
    }
  });

  it('uses fixed safe fallback message when failed DB row has an unrecognized error_code', async () => {
    const rawErrorMessage = 'Upstream vendor stack detail xyz123';
    queryMock.mockResolvedValueOnce([
      {
        id: JOB_ID,
        user_id: USER_A,
        job_kind: 'topic_content',
        status: 'failed',
        result_type: null,
        result_id: null,
        error_code: 'UNRECOGNIZED_INTERNAL_CODE',
        error_message: rawErrorMessage,
        retryable: false,
        created_at: '2026-11-18T10:00:00.000Z',
        finished_at: '2026-11-18T10:00:05.000Z',
      },
    ]);

    const dto = await service.getJobStatus(USER_A, JOB_ID);
    expect(dto.error).toEqual({
      code: 'UNRECOGNIZED_INTERNAL_CODE',
      message: 'The AI request could not be completed. Please try again.',
      retryable: false,
    });
    expect(dto.error!.message).not.toContain('Upstream');
    expect(dto.error!.message).not.toContain('xyz123');
  });

  it('strictly excludes input_payload, locked_by, attempt_count, and provider/model internals from JobStatusDTO (R12)', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      expect(sql).not.toMatch(/\binput_payload\b/i);
      expect(sql).not.toMatch(/\blocked_by\b/i);
      expect(sql).not.toMatch(/\bprovider_key\b/i);
      expect(sql).not.toMatch(/\bmodel_id\b/i);
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1 AND user_id = $2') &&
        params?.[0] === JOB_ID &&
        params?.[1] === USER_A
      ) {
        return [
          {
            id: JOB_ID,
            user_id: USER_A,
            job_kind: 'practice_review',
            status: 'queued',
            result_type: null,
            result_id: null,
            error_code: null,
            error_message: null,
            retryable: false,
            created_at: '2026-11-18T10:00:00.000Z',
            finished_at: null,
            // Even if a mock or driver returned extra properties on the row object:
            input_payload: { v: 1, args: { secret: 'raw user prompt' } },
            locked_by: 'worker-node-1',
            attempt_count: 3,
            provider_key: 'google-vertex',
            model_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            prompt_version_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          },
        ];
      }
      return [];
    });

    const dto = await service.getJobStatus(USER_A, JOB_ID);
    expect(Object.keys(dto).sort()).toEqual([
      'created_at',
      'error',
      'finished_at',
      'job_id',
      'kind',
      'result_ref',
      'retryable',
      'status',
    ]);
    expect('input_payload' in dto).toBe(false);
    expect('locked_by' in dto).toBe(false);
    expect('attempt_count' in dto).toBe(false);
    expect('provider_key' in dto).toBe(false);
    expect('model_id' in dto).toBe(false);
    expect('prompt_version_id' in dto).toBe(false);
  });

  it('rejects malformed non-UUID job ID with 400 INVALID_FORMAT without querying database', async () => {
    await expect(
      service.getJobStatus(USER_A, 'not-a-valid-uuid'),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 404 JOB_NOT_FOUND when job does not exist or belongs to another user (zero cross-user existence leakage)', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1 AND user_id = $2')
      ) {
        if (params?.[0] === JOB_ID && params?.[1] === USER_A) {
          return [
            {
              id: JOB_ID,
              user_id: USER_A,
              job_kind: 'roadmap_generate',
              status: 'queued',
              result_type: null,
              result_id: null,
              error_code: null,
              error_message: null,
              retryable: false,
              created_at: '2026-11-18T10:00:00.000Z',
              finished_at: null,
            },
          ];
        }
        return [];
      }
      return [];
    });

    // Foreign user B querying USER_A's job gets 404 JOB_NOT_FOUND (never 403)
    await expect(service.getJobStatus(USER_B, JOB_ID)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 404, 'JOB_NOT_FOUND');
        return true;
      },
    );
  });

  it('returns 404 JOB_NOT_FOUND for owned sync rows with job_kind: null and never leaks task as kind', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      expect(sql).toContain('is_async = true');
      expect(sql).toContain('job_kind IS NOT NULL');
      expect(sql).not.toContain('COALESCE');
      return [
        {
          id: JOB_ID,
          user_id: USER_A,
          is_async: true,
          job_kind: null,
          task: 'goal_interpretation',
          status: 'succeeded',
          result_type: null,
          result_id: null,
          error_code: null,
          error_message: null,
          retryable: false,
          created_at: new Date('2026-11-18T10:00:00.000Z'),
          finished_at: new Date('2026-11-18T10:01:00.000Z'),
        },
      ];
    });

    await expect(service.getJobStatus(USER_A, JOB_ID)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 404, 'JOB_NOT_FOUND');
        return true;
      },
    );
  });

  it('returns 404 JOB_NOT_FOUND when row has is_async: false even if job_kind is populated', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: JOB_ID,
        user_id: USER_A,
        is_async: false,
        job_kind: 'roadmap_generate',
        status: 'succeeded',
        result_type: 'roadmap',
        result_id: ROADMAP_ID,
        error_code: null,
        error_message: null,
        retryable: false,
        created_at: new Date('2026-11-18T10:00:00.000Z'),
        finished_at: new Date('2026-11-18T10:01:00.000Z'),
      },
    ]);

    await expect(service.getJobStatus(USER_A, JOB_ID)).rejects.toSatisfy(
      (err) => {
        expectContractError(err, 404, 'JOB_NOT_FOUND');
        return true;
      },
    );
  });
});
