import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { IdempotencyService } from '../jobs/services/idempotency.service.js';
import { QuizController } from './controllers/quiz.controller.js';
import type { QuizService } from './services/quiz.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const IDEM_KEY = '44444444-4444-4444-8444-444444444444';

describe('QuizController (pre-idempotency validation & H-IDEM status propagation)', () => {
  it('validates daily_plan_item_id and confirm_unanswered BEFORE reserving an H-IDEM key', async () => {
    const idempotencyExecute = vi.fn();
    const controller = new QuizController(
      {} as unknown as QuizService,
      { execute: idempotencyExecute } as unknown as IdempotencyService,
    );

    await expect(
      controller.generateQuiz(
        {
          user: { sub: USER_ID },
          headers: { 'idempotency-key': IDEM_KEY },
        },
        { daily_plan_item_id: 'not-a-uuid' },
      ),
    ).rejects.toThrow(HttpException);
    expect(idempotencyExecute).not.toHaveBeenCalled();

    await expect(
      controller.submitQuizAttempt(
        {
          user: { sub: USER_ID },
          headers: { 'idempotency-key': IDEM_KEY },
        },
        ATTEMPT_ID,
        { confirm_unanswered: 'yes' },
      ),
    ).rejects.toThrow(HttpException);
    expect(idempotencyExecute).not.toHaveBeenCalled();
  });

  it('propagates 201/202 status codes from QuizService through IdempotencyService on EP-Q01', async () => {
    const quizServiceMock = {
      generateOrFetchQuizAttempt: vi.fn().mockResolvedValue({
        statusCode: 201,
        body: {
          attempt_id: ATTEMPT_ID,
          status: 'generated',
          attempt_no: 1,
          topic_id: ITEM_ID,
          career_level: 'mid',
          questions: [],
          saved_answers: [],
          submitted_at: null,
        },
      }),
    } as unknown as QuizService;
    const idempotencyMock = {
      execute: vi.fn(async (_ctx, handler) => {
        const res = await handler({
          idempotencyKey: IDEM_KEY,
          reservationToken: 'tok',
          expiresAtMs: Date.now() + 60_000,
          signal: new AbortController().signal,
        });
        return { ...res, replayed: false };
      }),
    } as unknown as IdempotencyService;

    const controller = new QuizController(quizServiceMock, idempotencyMock);
    const statusMock = vi.fn();
    const res = await controller.generateQuiz(
      {
        user: { sub: USER_ID },
        headers: { 'idempotency-key': IDEM_KEY },
      },
      { daily_plan_item_id: ITEM_ID },
      { status: statusMock } as unknown as import('express').Response,
    );

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(res).toHaveProperty('attempt_id', ATTEMPT_ID);
  });

  it('EP-Q06 getQuizResult delegates to QuizService.getQuizResult and registers both :id/result and :id/results paths', async () => {
    const mockResult = {
      attempt_id: ATTEMPT_ID,
      status: 'feedback_available' as const,
      attempt_no: 1,
      mcq_score: { correct: 1, total: 1 },
      performance_level: 'good' as const,
      questions: [],
      improvement_recommendations: [],
      progress_change: null,
      retry_available: true,
    };
    const quizServiceMock = {
      getQuizResult: vi.fn().mockResolvedValue(mockResult),
    } as unknown as QuizService;
    const controller = new QuizController(
      quizServiceMock,
      {} as unknown as IdempotencyService,
    );

    const res = await controller.getQuizResult(
      { user: { sub: USER_ID } },
      ATTEMPT_ID,
    );
    expect(res).toEqual(mockResult);
    expect(quizServiceMock.getQuizResult).toHaveBeenCalledWith(
      USER_ID,
      ATTEMPT_ID,
    );

    const routePaths = Reflect.getMetadata(
      'path',
      QuizController.prototype.getQuizResult,
    ) as string[];
    expect(routePaths).toEqual([':id/result', ':id/results']);
  });

  it('propagates 202 wire status via res.status().json(), lowercases :id routes, and forwards AbortSignal on EP-Q05/EP-Q07', async () => {
    const submitQuizAttemptMock = vi.fn().mockResolvedValue({
      statusCode: 202,
      body: {
        attempt_id: ATTEMPT_ID,
        status: 'submitted',
        mcq_score: { correct: 1, total: 1 },
        plan_day_unlocked: true,
        next_plan_day_no: 2,
        review_job_id: '55555555-5555-4555-8555-555555555555',
      },
    });
    const retryQuizAttemptMock = vi.fn().mockResolvedValue({
      statusCode: 202,
      body: {
        job_id: '66666666-6666-4666-8666-666666666666',
        kind: 'quiz_generate',
        status: 'queued',
        poll_url: '/api/v1/jobs/66666666-6666-4666-8666-666666666666',
        retry_after_seconds: 3,
      },
    });
    const signal = new AbortController().signal;
    const executedInputs: Array<{ route: string }> = [];
    const idempotencyMock = {
      execute: vi.fn(async (ctx: { route: string }, handler) => {
        executedInputs.push({ route: ctx.route });
        const out = await handler({
          idempotencyKey: IDEM_KEY,
          reservationToken: 'tok',
          expiresAtMs: Date.now() + 60_000,
          signal,
        });
        return { ...out, replayed: false };
      }),
    } as unknown as IdempotencyService;

    const controller = new QuizController(
      {
        submitQuizAttempt: submitQuizAttemptMock,
        retryQuizAttempt: retryQuizAttemptMock,
      } as unknown as QuizService,
      idempotencyMock,
    );

    const upperAttemptId = ATTEMPT_ID.toUpperCase();
    const jsonSubmitMock = vi.fn();
    const statusSubmitMock = vi.fn(() => ({ json: jsonSubmitMock }));
    await controller.submitQuizAttempt(
      { user: { sub: USER_ID }, headers: { 'idempotency-key': IDEM_KEY } },
      upperAttemptId,
      { confirm_unanswered: true },
      {
        status: statusSubmitMock,
        json: jsonSubmitMock,
      } as unknown as import('express').Response,
    );
    expect(statusSubmitMock).toHaveBeenCalledWith(202);
    expect(jsonSubmitMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(executedInputs[0]?.route).toBe(`/api/v1/quiz/${ATTEMPT_ID}/submit`);
    expect(submitQuizAttemptMock).toHaveBeenCalledWith(
      USER_ID,
      upperAttemptId,
      { confirm_unanswered: true },
      expect.objectContaining({ signal }),
    );

    const jsonRetryMock = vi.fn();
    const statusRetryMock = vi.fn(() => ({ json: jsonRetryMock }));
    await controller.retryQuizAttempt(
      { user: { sub: USER_ID }, headers: { 'idempotency-key': IDEM_KEY } },
      upperAttemptId,
      {
        status: statusRetryMock,
        json: jsonRetryMock,
      } as unknown as import('express').Response,
    );
    expect(statusRetryMock).toHaveBeenCalledWith(202);
    expect(executedInputs[1]?.route).toBe(`/api/v1/quiz/${ATTEMPT_ID}/retry`);
  });
});
