import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivacyRetentionService } from '../account/services/privacy-retention.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { JobProducerService } from '../jobs/services/job-producer.service.js';
import { DailyPlanService } from '../learning/services/daily-plan.service.js';
import { TopicContentService } from '../learning/services/topic-content.service.js';
import { EvidenceService } from '../progress/services/evidence.service.js';
import { QuizGradingService } from './services/quiz-grading.service.js';
import { QuizService } from './services/quiz.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const ROADMAP_ID = '44444444-4444-4444-8444-444444444444';
const TOPIC_ID = '55555555-5555-4555-8555-555555555555';
const SKILL_ID = '66666666-6666-4666-8666-666666666666';
const QUIZ_ID = '77777777-7777-4777-8777-777777777777';
const ATTEMPT_1_ID = '88888888-8888-4888-8888-888888888881';
const ATTEMPT_2_ID = '88888888-8888-4888-8888-888888888882';
const Q_MCQ_ID = '99999999-9999-4999-8999-999999999991';
const Q_FR_ID = '99999999-9999-4999-8999-999999999992';
const ANS_FR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const JOB_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

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

describe('QuizService (EP-Q01–EP-Q07, answer-key protection, atomic day unlock & retry cap)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let privacyMock: PrivacyRetentionService;
  let jobProducerMock: { enqueue: ReturnType<typeof vi.fn> };
  let topicContentMock: {
    findCanonicalApprovedTopicRowInTx: ReturnType<typeof vi.fn>;
    findApprovedCanonicalTopicInTx: ReturnType<typeof vi.fn>;
  };
  let dailyPlanMock: { markPlanItemCompletedInTx: ReturnType<typeof vi.fn> };
  let evidenceMock: { record: ReturnType<typeof vi.fn> };
  let service: QuizService;

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
    privacyMock = {
      getRawResponseRetentionDays: vi.fn().mockReturnValue(90),
    } as unknown as PrivacyRetentionService;
    jobProducerMock = {
      enqueue: vi.fn().mockResolvedValue({
        job_id: JOB_ID,
        kind: 'quiz_generate',
        status: 'queued',
        poll_url: `/api/v1/jobs/${JOB_ID}`,
        retry_after_seconds: 3,
      }),
    };
    const approvedTopicRow = {
      id: TOPIC_ID,
      skill_id: SKILL_ID,
      slug: 'sql-joins',
      title: 'SQL Joins',
      career_level: 'mid',
      content_version: 1,
      status: 'approved',
    };
    topicContentMock = {
      findCanonicalApprovedTopicRowInTx: vi
        .fn()
        .mockResolvedValue(approvedTopicRow),
      findApprovedCanonicalTopicInTx: vi
        .fn()
        .mockResolvedValue(approvedTopicRow),
    };
    dailyPlanMock = {
      markPlanItemCompletedInTx: vi.fn().mockResolvedValue({
        planDayUnlocked: true,
        nextPlanDayNo: 2,
        planCompleted: false,
      }),
    };
    evidenceMock = {
      record: vi.fn().mockResolvedValue({
        evidence_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        inserted: true,
      }),
    };

    service = new QuizService(
      databaseMock,
      topicContentMock as unknown as TopicContentService,
      dailyPlanMock as unknown as DailyPlanService,
      new QuizGradingService(),
      evidenceMock as unknown as EvidenceService,
      jobProducerMock as unknown as JobProducerService,
      privacyMock,
    );
  });

  it('EP-Q01 & EP-Q02 never leak correct_option_id, explanation, rubric, or ai_generation_id before submission', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'generated',
            question_ids: [Q_MCQ_ID, Q_FR_ID],
            started_at: null,
            submitted_at: null,
            reviewed_at: null,
            mcq_correct: null,
            mcq_total: null,
            performance_level: null,
            improvement_recommendations: [],
            topic_id: TOPIC_ID,
            career_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.quiz_questions')) {
        expect(sql).not.toContain('correct_option_id');
        expect(sql).not.toContain('explanation');
        expect(sql).not.toContain('rubric');
        return [
          {
            id: Q_MCQ_ID,
            sort_order: 1,
            question_type: 'mcq',
            difficulty: 'application',
            prompt: 'Which join preserves unmatched left rows?',
            options: [
              { option_id: 'a', text: 'LEFT JOIN' },
              { option_id: 'b', text: 'INNER JOIN' },
            ],
            response_hint: null,
            max_length: null,
            allow_i_dont_know: true,
          },
          {
            id: Q_FR_ID,
            sort_order: 21,
            question_type: 'free_response',
            difficulty: 'analysis',
            prompt: 'Write a query using LEFT JOIN.',
            options: null,
            response_hint: 'sql',
            max_length: 2000,
            allow_i_dont_know: true,
          },
        ];
      }
      if (sql.includes('FROM public.quiz_answers')) {
        return [];
      }
      return [];
    });

    const dto = await service.getQuizAttempt(USER_ID, ATTEMPT_1_ID);
    expect(transactionMock).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
      true,
      false,
    );
    expect(dto.attempt_id).toBe(ATTEMPT_1_ID);
    expect(dto.questions).toHaveLength(2);
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('correct_option_id');
    expect(serialized).not.toContain('correct_answer');
    expect(serialized).not.toContain('explanation');
    expect(serialized).not.toContain('rubric');
    expect(serialized).not.toContain('ai_generation_id');
  });

  it('EP-Q05 requires confirm_unanswered when incomplete, grades MCQs, unlocks next plan day regardless of score, and degrades cleanly when ai_practice_review is OFF', async () => {
    let aiPracticeReviewAllowed = true;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("'quiz_practice'::public.feature_key")) {
        return [{ allowed: true }];
      }
      if (sql.includes("'ai_practice_review'::public.feature_key")) {
        return [{ allowed: aiPracticeReviewAllowed }];
      }
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            daily_plan_item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'started',
            question_ids: [Q_MCQ_ID, Q_FR_ID],
            started_at: '2026-11-22T10:00:00.000Z',
            submitted_at: null,
            reviewed_at: null,
            mcq_correct: null,
            mcq_total: null,
            performance_level: null,
            improvement_recommendations: [],
          },
        ];
      }
      if (sql.includes('FROM public.quiz_questions')) {
        return [
          {
            id: Q_MCQ_ID,
            sort_order: 1,
            question_type: 'mcq',
            difficulty: 'application',
            prompt: 'Which join?',
            options: [
              { option_id: 'a', text: 'LEFT' },
              { option_id: 'b', text: 'INNER' },
            ],
            correct_option_id: 'a',
            explanation: 'LEFT preserves left rows.',
            response_hint: null,
            max_length: null,
            allow_i_dont_know: true,
          },
          {
            id: Q_FR_ID,
            sort_order: 21,
            question_type: 'free_response',
            difficulty: 'analysis',
            prompt: 'Explain LEFT JOIN.',
            options: null,
            correct_option_id: null,
            explanation: null,
            response_hint: 'sql',
            max_length: 2000,
            allow_i_dont_know: true,
          },
        ];
      }
      if (sql.includes('FROM public.quiz_answers')) {
        return [
          {
            id: 'ans-mcq-1',
            question_id: Q_MCQ_ID,
            selected_option_id: 'b',
            answer_text: null,
            i_dont_know: false,
            is_correct: null,
            saved_at: '2026-11-22T10:01:00.000Z',
          },
        ];
      }
      if (sql.includes('INSERT INTO public.quiz_answers')) {
        return [
          [
            {
              id: ANS_FR_ID,
              question_id: Q_FR_ID,
              selected_option_id: null,
              answer_text: 'SELECT * FROM a LEFT JOIN b ON a.id = b.a_id;',
              i_dont_know: false,
              is_correct: null,
              saved_at: '2026-11-22T10:02:00.000Z',
            },
          ],
          1,
        ];
      }
      if (sql.includes('INSERT INTO public.practice_reviews')) {
        return [[{ id: REVIEW_ID }], 1];
      }
      return [];
    });

    // 1. Unanswered FR without confirm_unanswered -> 422 UNANSWERED_CONFIRMATION_REQUIRED
    await expect(
      service.submitQuizAttempt(USER_ID, ATTEMPT_1_ID, {}),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'UNANSWERED_CONFIRMATION_REQUIRED');
      return true;
    });

    // 2. With valid FR answer but ai_practice_review OFF -> submits cleanly (200), marks FR failed(FEATURE_DISABLED), unlocks next plan day even with 0/1 MCQ score!
    aiPracticeReviewAllowed = false;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("'quiz_practice'::public.feature_key")) {
        return [{ allowed: true }];
      }
      if (sql.includes("'ai_practice_review'::public.feature_key")) {
        return [{ allowed: false }];
      }
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            daily_plan_item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'started',
            question_ids: [Q_MCQ_ID, Q_FR_ID],
            started_at: '2026-11-22T10:00:00.000Z',
            submitted_at: null,
            reviewed_at: null,
            mcq_correct: null,
            mcq_total: null,
            performance_level: null,
            improvement_recommendations: [],
          },
        ];
      }
      if (sql.includes('FROM public.quiz_questions')) {
        return [
          {
            id: Q_MCQ_ID,
            sort_order: 1,
            question_type: 'mcq',
            difficulty: 'application',
            prompt: 'Which join?',
            options: [
              { option_id: 'a', text: 'LEFT' },
              { option_id: 'b', text: 'INNER' },
            ],
            correct_option_id: 'a',
            explanation: 'LEFT preserves left rows.',
            response_hint: null,
            max_length: null,
            allow_i_dont_know: true,
          },
          {
            id: Q_FR_ID,
            sort_order: 21,
            question_type: 'free_response',
            difficulty: 'analysis',
            prompt: 'Explain LEFT JOIN.',
            options: null,
            correct_option_id: null,
            explanation: null,
            response_hint: 'sql',
            max_length: 2000,
            allow_i_dont_know: true,
          },
        ];
      }
      if (sql.includes('FROM public.quiz_answers')) {
        return [
          {
            id: 'ans-mcq-1',
            question_id: Q_MCQ_ID,
            selected_option_id: 'b',
            answer_text: null,
            i_dont_know: false,
            is_correct: null,
            saved_at: '2026-11-22T10:01:00.000Z',
          },
          {
            id: ANS_FR_ID,
            question_id: Q_FR_ID,
            selected_option_id: null,
            answer_text: 'SELECT * FROM a LEFT JOIN b ON a.id = b.a_id;',
            i_dont_know: false,
            is_correct: null,
            saved_at: '2026-11-22T10:02:00.000Z',
          },
        ];
      }
      return [];
    });

    const submitted = await service.submitQuizAttempt(
      USER_ID,
      ATTEMPT_1_ID,
      {},
    );
    expect(submitted.statusCode).toBe(200);
    expect(submitted.body.mcq_score).toEqual({ correct: 0, total: 1 });
    expect(submitted.body.plan_day_unlocked).toBe(true);
    expect(submitted.body.next_plan_day_no).toBe(2);
    expect(submitted.body.review_job_id).toBeNull();
    expect(dailyPlanMock.markPlanItemCompletedInTx).toHaveBeenCalledTimes(1);
    expect(evidenceMock.record).toHaveBeenCalledTimes(1);
  });

  it('EP-Q07 enforces 1 retry per plan item (409 RETRY_LIMIT_REACHED on attempt_no >= 2)', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("'quiz_practice'::public.feature_key")) {
        return [{ allowed: true }];
      }
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_2_ID,
            daily_plan_item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            roadmap_status: 'locked',
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            career_level: 'mid',
          },
        ];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ATTEMPT_2_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 2,
            retry_of_attempt_id: ATTEMPT_1_ID,
            status: 'feedback_available',
            question_ids: [Q_MCQ_ID],
            started_at: '2026-11-22T10:10:00.000Z',
            submitted_at: '2026-11-22T10:15:00.000Z',
            reviewed_at: '2026-11-22T10:15:00.000Z',
            mcq_correct: 1,
            mcq_total: 1,
            performance_level: 'good',
            improvement_recommendations: [],
          },
        ];
      }
      return [];
    });

    await expect(
      service.retryQuizAttempt(USER_ID, ATTEMPT_2_ID),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'RETRY_LIMIT_REACHED');
      return true;
    });
  });

  it('EP-Q06 getQuizResult returns FR user_answer (redacted when expired/purged) and synthesized reference explanation without leaking rubric', async () => {
    let rawExpired = false;
    (
      service as unknown as {
        privacyRetentionService: { isRawTextExpired: () => boolean };
      }
    ).privacyRetentionService = {
      isRawTextExpired: () => rawExpired,
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'feedback_available',
            question_ids: [Q_MCQ_ID, Q_FR_ID],
            started_at: '2026-11-22T10:00:00.000Z',
            submitted_at: '2026-11-22T10:05:00.000Z',
            reviewed_at: '2026-11-22T10:06:00.000Z',
            mcq_correct: 0,
            mcq_total: 1,
            performance_level: 'needs_work',
            improvement_recommendations: ['Review ON clause filtering.'],
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.quiz_questions')) {
        return [
          {
            id: Q_MCQ_ID,
            sort_order: 1,
            question_type: 'mcq',
            difficulty: 'application',
            prompt: 'Which join?',
            options: [
              { option_id: 'a', text: 'LEFT' },
              { option_id: 'b', text: 'INNER' },
            ],
            correct_option_id: 'a',
            explanation: 'LEFT preserves left rows.',
            rubric: null,
            response_hint: null,
            max_length: null,
            allow_i_dont_know: true,
          },
          {
            id: Q_FR_ID,
            sort_order: 21,
            question_type: 'free_response',
            difficulty: 'analysis',
            prompt: 'Explain LEFT JOIN.',
            options: null,
            correct_option_id: null,
            explanation: null,
            rubric: {
              correctness_criteria: [
                'Uses LEFT JOIN with an explicit ON predicate.',
              ],
              understanding_criteria: [
                'Explains that unmatched right-table columns are NULL.',
              ],
              reasoning_criteria: [],
            },
            response_hint: 'sql',
            max_length: 2000,
            allow_i_dont_know: true,
          },
        ];
      }
      if (sql.includes('FROM public.quiz_answers')) {
        return [
          {
            id: 'ans-mcq-1',
            question_id: Q_MCQ_ID,
            selected_option_id: 'b',
            answer_text: null,
            i_dont_know: false,
            is_correct: false,
            saved_at: '2026-11-22T10:01:00.000Z',
            raw_text_expires_at: null,
            raw_text_purged_at: null,
            created_at: '2026-11-22T10:01:00.000Z',
          },
          {
            id: ANS_FR_ID,
            question_id: Q_FR_ID,
            selected_option_id: null,
            answer_text:
              'SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id;',
            i_dont_know: false,
            is_correct: null,
            saved_at: '2026-11-22T10:02:00.000Z',
            raw_text_expires_at: '2027-02-20T10:02:00.000Z',
            raw_text_purged_at: null,
            created_at: '2026-11-22T10:02:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM public.practice_reviews')) {
        return [
          {
            id: REVIEW_ID,
            question_id: Q_FR_ID,
            review_status: 'reviewed',
            performance_level: 'good',
          },
        ];
      }
      if (sql.includes('FROM public.content_reports')) {
        expect(sql).toContain('target_id = ANY($2::uuid[])');
        expect(sql).toContain('target_id = ANY($3::uuid[])');
        return [];
      }
      return [];
    });

    const result = await service.getQuizResult(USER_ID, ATTEMPT_1_ID);
    expect(result.topic_title).toBe('SQL Joins');
    const frQuestion = result.questions.find((q) => q.type === 'free_response');
    expect(frQuestion).toBeDefined();
    expect(frQuestion).toMatchObject({
      question_id: Q_FR_ID,
      type: 'free_response',
      user_answer:
        'SELECT * FROM users u LEFT JOIN orders o ON u.id = o.user_id;',
      practice_review_id: REVIEW_ID,
      review_status: 'reviewed',
    });
    expect(frQuestion?.explanation).toContain(
      'Uses LEFT JOIN with an explicit ON predicate.',
    );
    expect(frQuestion).not.toHaveProperty('rubric');

    // When 90d retention expires, user_answer is redacted to null while reference explanation remains
    rawExpired = true;
    const expiredResult = await service.getQuizResult(USER_ID, ATTEMPT_1_ID);
    const expiredFr = expiredResult.questions.find(
      (q) => q.type === 'free_response',
    );
    expect(expiredFr?.user_answer).toBeNull();
    expect(expiredFr?.explanation).toContain(
      'Explains that unmatched right-table columns are NULL.',
    );
  });

  it('EP-Q02 redacts expired saved answer_text, EP-Q07 rejects unavailable canonical topic with 409 and filters active job reuse by variant_no=2', async () => {
    (
      service as unknown as {
        privacyRetentionService: { isRawTextExpired: () => boolean };
      }
    ).privacyRetentionService = {
      isRawTextExpired: () => true,
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'submitted',
            question_ids: [Q_FR_ID],
            started_at: '2026-11-22T10:00:00.000Z',
            submitted_at: '2026-11-22T10:05:00.000Z',
            reviewed_at: null,
            mcq_correct: 0,
            mcq_total: 0,
            performance_level: null,
            improvement_recommendations: [],
            topic_id: TOPIC_ID,
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.quiz_questions')) {
        return [
          {
            id: Q_FR_ID,
            sort_order: 1,
            question_type: 'free_response',
            difficulty: 'analysis',
            prompt: 'Explain LEFT JOIN.',
            options: null,
            response_hint: 'sql',
            max_length: 2000,
            allow_i_dont_know: true,
          },
        ];
      }
      if (sql.includes('FROM public.quiz_answers')) {
        return [
          {
            id: ANS_FR_ID,
            question_id: Q_FR_ID,
            selected_option_id: null,
            answer_text: 'SELECT * FROM users;',
            i_dont_know: false,
            is_correct: null,
            saved_at: '2026-01-01T00:00:00.000Z',
            raw_text_expires_at: '2026-04-01T00:00:00.000Z',
            raw_text_purged_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const attempt = await service.getQuizAttempt(USER_ID, ATTEMPT_1_ID);
    expect(attempt.saved_answers[0]?.text).toBeNull();

    // EP-Q07 rejects unavailable canonical topic with 409 PLAN_ITEM_NOT_AVAILABLE
    const topicContentMock = (
      service as unknown as {
        topicContentService: {
          findApprovedCanonicalTopicInTx: ReturnType<typeof vi.fn>;
        };
      }
    ).topicContentService;
    topicContentMock.findApprovedCanonicalTopicInTx.mockResolvedValueOnce(null);

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("'quiz_practice'::public.feature_key")) {
        return [{ allowed: true }];
      }
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            daily_plan_item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            roadmap_status: 'locked',
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'feedback_available',
            question_ids: [Q_MCQ_ID],
            started_at: '2026-11-22T10:00:00.000Z',
            submitted_at: '2026-11-22T10:05:00.000Z',
            reviewed_at: '2026-11-22T10:05:00.000Z',
            mcq_correct: 1,
            mcq_total: 1,
            performance_level: 'good',
            improvement_recommendations: [],
          },
        ];
      }
      return [];
    });

    await expect(
      service.retryQuizAttempt(USER_ID, ATTEMPT_1_ID),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'PLAN_ITEM_NOT_AVAILABLE');
      return true;
    });

    // When approved topic exists, retry active-job reuse query filters strictly by variant_no = 2
    topicContentMock.findApprovedCanonicalTopicInTx.mockResolvedValueOnce({
      id: TOPIC_ID,
      content_version: 2,
      title: 'SQL Joins',
    });
    const aiRequestQueries: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("'quiz_practice'::public.feature_key")) {
        return [{ allowed: true }];
      }
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            daily_plan_item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            roadmap_status: 'locked',
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'feedback_available',
            question_ids: [Q_MCQ_ID],
            started_at: '2026-11-22T10:00:00.000Z',
            submitted_at: '2026-11-22T10:05:00.000Z',
            reviewed_at: '2026-11-22T10:05:00.000Z',
            mcq_correct: 1,
            mcq_total: 1,
            performance_level: 'good',
            improvement_recommendations: [],
          },
        ];
      }
      if (sql.includes('FROM public.ai_requests')) {
        aiRequestQueries.push(sql);
        return [
          { id: '99999999-9999-4999-8999-999999999999', status: 'queued' },
        ];
      }
      return [];
    });

    const retryRes = await service.retryQuizAttempt(USER_ID, ATTEMPT_1_ID);
    expect(retryRes.statusCode).toBe(202);
    expect(aiRequestQueries[0]).toContain("variant_no')::int, 1) = 2");
  });

  it('EP-Q04/EP-Q05 supports clear=true deletion, checks locked FOR SHARE status on EP-Q01, and aborts EP-Q05 when AbortSignal is aborted after locking', async () => {
    // 1. EP-Q04 saveAnswers with clear: true deletes existing quiz_answers row
    const deletedSql: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('effective_feature_access')) {
        return [{ allowed: true }];
      }
      if (sql.includes('FROM public.users')) {
        return [{ status: 'active' }];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'started',
            question_ids: [Q_MCQ_ID, Q_FR_ID],
            started_at: '2026-11-22T09:58:00.000Z',
            submitted_at: null,
            reviewed_at: null,
            mcq_correct: null,
            mcq_total: null,
            performance_level: null,
            improvement_recommendations: [],
          },
        ];
      }
      if (sql.includes('FROM public.quiz_questions')) {
        return [
          {
            id: Q_FR_ID,
            sort_order: 2,
            question_type: 'free_response',
            difficulty: 'analysis',
            prompt: 'Explain LEFT JOIN.',
            options: null,
            response_hint: 'sql',
            max_length: 2000,
            allow_i_dont_know: true,
          },
        ];
      }
      if (sql.includes('DELETE FROM public.quiz_answers')) {
        deletedSql.push(sql);
        return [];
      }
      return [];
    });

    const savedClear = await service.saveAnswers(USER_ID, ATTEMPT_1_ID, {
      answers: [{ question_id: Q_FR_ID, clear: true }],
    });
    expect(savedClear.saved).toBe(1);
    expect(deletedSql).toHaveLength(1);

    await expect(
      service.saveAnswers(USER_ID, ATTEMPT_1_ID, {
        answers: [{ question_id: Q_FR_ID, clear: true, text: 'conflict' }],
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });

    // 2. EP-Q01 checks post-lock status from roadmaps FOR SHARE
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('effective_feature_access')) {
        return [{ allowed: true }];
      }
      if (sql.includes('FROM public.users')) {
        return [{ status: 'active' }];
      }
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        return [
          {
            id: ITEM_ID,
            plan_id: PLAN_ID,
            day_no: 1,
            sort_order: 1,
            status: 'pending',
            topic_id: TOPIC_ID,
            roadmap_id: ROADMAP_ID,
            roadmap_status: 'locked',
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.roadmaps') && sql.includes('FOR SHARE')) {
        return [{ status: 'archived' }];
      }
      return [];
    });
    await expect(
      service.generateOrFetchQuizAttempt(USER_ID, {
        daily_plan_item_id: ITEM_ID,
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 409, 'PLAN_ITEM_NOT_AVAILABLE');
      return true;
    });

    // 3. EP-Q05 aborts transaction with 503 if AbortSignal aborted after acquiring locks
    const abortController = new AbortController();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('effective_feature_access')) {
        return [{ allowed: true }];
      }
      if (sql.includes('FROM public.users')) {
        return [{ status: 'active' }];
      }
      if (sql.includes('FROM public.quiz_attempts qa')) {
        return [
          {
            id: ATTEMPT_1_ID,
            daily_plan_item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            title: 'SQL Joins',
            career_level: 'mid',
          },
        ];
      }
      if (
        sql.includes('FROM public.quiz_attempts') &&
        sql.includes('FOR UPDATE')
      ) {
        abortController.abort();
        return [
          {
            id: ATTEMPT_1_ID,
            user_id: USER_ID,
            daily_plan_item_id: ITEM_ID,
            quiz_id: QUIZ_ID,
            attempt_no: 1,
            retry_of_attempt_id: null,
            status: 'started',
            question_ids: [Q_MCQ_ID],
            started_at: '2026-11-22T09:58:00.000Z',
            submitted_at: null,
            reviewed_at: null,
            mcq_correct: null,
            mcq_total: null,
            performance_level: null,
            improvement_recommendations: [],
          },
        ];
      }
      return [];
    });
    await expect(
      service.submitQuizAttempt(
        USER_ID,
        ATTEMPT_1_ID,
        { confirm_unanswered: true },
        { signal: abortController.signal },
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'SERVICE_UNAVAILABLE');
      return true;
    });
  });
});
