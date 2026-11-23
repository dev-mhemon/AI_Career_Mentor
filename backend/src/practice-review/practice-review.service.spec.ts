import { HttpException, ValidationPipe } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivacyRetentionService } from '../account/services/privacy-retention.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { JobProducerService } from '../jobs/services/job-producer.service.js';
import { PracticeReviewController } from './controllers/practice-review.controller.js';
import { ListPracticeReviewsQueryDTO } from './dto/practice-review.dto.js';
import { PracticeReviewService } from './services/practice-review.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';

function expectContractError(
  error: unknown,
  status: number,
  code: string,
): void {
  expect(error).toBeInstanceOf(HttpException);
  const httpErr = error as HttpException;
  expect(httpErr.getStatus()).toBe(status);
  const body = httpErr.getResponse() as { code?: string };
  expect(body.code).toBe(code);
}

describe('PracticeReviewService (EP-PR01, EP-PR02, EP-PR03 — idempotent 200, 409 not_evidence, 410 expired & 202 enqueue)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let isExpiredMock: ReturnType<typeof vi.fn>;
  let privacyMock: PrivacyRetentionService;
  let jobProducerMock: { enqueue: ReturnType<typeof vi.fn> };
  let service: PracticeReviewService;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock = vi.fn();
    transactionMock = vi.fn(
      async (
        _userId: string,
        op: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => op({ query: queryMock }),
    );
    databaseMock = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DatabaseService;
    isExpiredMock = vi.fn().mockReturnValue(false);
    privacyMock = {
      isRawTextExpired: isExpiredMock,
    } as unknown as PrivacyRetentionService;
    jobProducerMock = {
      enqueue: vi.fn().mockResolvedValue({
        job_id: JOB_ID,
        kind: 'practice_review',
        status: 'queued',
        poll_url: `/api/v1/jobs/${JOB_ID}`,
        retry_after_seconds: 3,
      }),
    };
    service = new PracticeReviewService(
      databaseMock,
      privacyMock,
      jobProducerMock as unknown as JobProducerService,
    );
  });

  it('EP-PR01 lists review summaries ordered by question sort_order with foreground=false', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.quiz_attempts')) {
        return [{ id: ATTEMPT_ID }];
      }
      if (sql.includes('FROM public.practice_reviews pr')) {
        return [
          {
            id: REVIEW_ID,
            question_id: QUESTION_ID,
            review_status: 'reviewed',
            performance_level: 'good',
          },
        ];
      }
      return [];
    });

    const list = await service.listReviewsForAttempt(USER_ID, {
      quiz_attempt_id: ATTEMPT_ID,
    });
    expect(transactionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
      true,
      false,
    );
    expect(list).toEqual([
      {
        id: REVIEW_ID,
        question_id: QUESTION_ID,
        review_status: 'reviewed',
        performance_level: 'good',
      },
    ]);
  });

  it('EP-PR03 returns 200 without re-running AI when already reviewed, 409 on not_evidence, 410 on expired raw text, and 202 when retrying failed review', async () => {
    let currentReviewStatus = 'reviewed';
    let rawTextPurgedAt: string | null = null;

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('effective_feature_access')) {
        return [{ allowed: true }];
      }
      if (
        sql.includes('FROM public.practice_reviews') &&
        !sql.includes('FOR UPDATE') &&
        !sql.includes('has_report')
      ) {
        return [{ id: REVIEW_ID, attempt_id: ATTEMPT_ID }];
      }
      if (sql.includes('FROM public.quiz_attempts')) {
        return [
          {
            id: ATTEMPT_ID,
            status: 'submitted',
            submitted_at: '2026-11-22T10:00:00.000Z',
          },
        ];
      }
      if (
        sql.includes('FROM public.practice_reviews pr') &&
        sql.includes('FOR UPDATE OF pr')
      ) {
        return [
          {
            id: REVIEW_ID,
            attempt_id: ATTEMPT_ID,
            question_id: QUESTION_ID,
            review_status: currentReviewStatus,
            answer_text: 'SELECT * FROM users;',
            raw_text_expires_at: '2027-02-20T10:00:00.000Z',
            raw_text_purged_at: rawTextPurgedAt,
            answer_saved_at: '2026-11-22T09:59:00.000Z',
            answer_created_at: '2026-11-22T09:59:00.000Z',
          },
        ];
      }
      if (sql.includes('AS has_report')) {
        return [
          {
            id: REVIEW_ID,
            question_id: QUESTION_ID,
            review_status: 'reviewed',
            performance_level: 'good',
            dimensions: {
              correctness: 'good',
              understanding: 'good',
              reasoning: 'good',
            },
            strengths: ['Clear query'],
            mistakes: [],
            weaknesses: [],
            improvement_recommendations: ['Try complex joins'],
            evidence_eligible: true,
            has_report: false,
          },
        ];
      }
      if (sql.includes('FROM public.ai_requests')) {
        return [];
      }
      return [];
    });

    // 1. Already reviewed -> 200 OK without enqueuing job
    const alreadyReviewed = await service.triggerOrRetryReview(
      USER_ID,
      REVIEW_ID,
    );
    expect(alreadyReviewed.statusCode).toBe(200);
    expect(jobProducerMock.enqueue).not.toHaveBeenCalled();

    // 2. not_evidence -> 409 REVIEW_NOT_RETRYABLE
    currentReviewStatus = 'not_evidence';
    await expect(
      service.triggerOrRetryReview(USER_ID, REVIEW_ID),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'REVIEW_NOT_RETRYABLE');
      return true;
    });

    // 3. Expired raw text -> 410 RAW_RESPONSE_EXPIRED
    currentReviewStatus = 'failed';
    isExpiredMock.mockReturnValueOnce(true);
    await expect(
      service.triggerOrRetryReview(USER_ID, REVIEW_ID),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 410, 'RAW_RESPONSE_EXPIRED');
      return true;
    });

    // 4. Purged raw text -> 410 RAW_RESPONSE_EXPIRED
    rawTextPurgedAt = '2026-11-22T11:00:00.000Z';
    await expect(
      service.triggerOrRetryReview(USER_ID, REVIEW_ID),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 410, 'RAW_RESPONSE_EXPIRED');
      return true;
    });

    // 5. Retryable failed review with valid unexpired raw text -> 202 Accepted
    rawTextPurgedAt = null;
    const retried = await service.triggerOrRetryReview(USER_ID, REVIEW_ID);
    expect(retried.statusCode).toBe(202);
    expect(jobProducerMock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('EP-PR03 preserves 202 wire status via res.status().json() and EP-PR01 returns 400 INVALID_FORMAT for malformed quiz_attempt_id', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const transformed = (await pipe.transform(
      { quiz_attempt_id: 'not-a-uuid' },
      { type: 'query', metatype: ListPracticeReviewsQueryDTO },
    )) as ListPracticeReviewsQueryDTO;

    const controller = new PracticeReviewController({
      listReviewsForAttempt: vi.fn(),
      triggerOrRetryReview: vi.fn().mockResolvedValue({
        statusCode: 202,
        body: {
          job_id: JOB_ID,
          kind: 'practice_review',
          status: 'queued',
          poll_url: `/api/v1/jobs/${JOB_ID}`,
          retry_after_seconds: 3,
        },
      }),
    } as unknown as PracticeReviewService);

    await expect(
      controller.listReviewsForAttempt({ user: { sub: USER_ID } }, transformed),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 400, 'INVALID_FORMAT');
      return true;
    });

    const jsonMock = vi.fn();
    const statusMock = vi.fn(() => ({ json: jsonMock }));
    await controller.triggerOrRetryReview(
      { user: { sub: USER_ID } },
      REVIEW_ID,
      {
        status: statusMock,
        json: jsonMock,
      } as unknown as import('express').Response,
    );
    expect(statusMock).toHaveBeenCalledWith(202);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});
