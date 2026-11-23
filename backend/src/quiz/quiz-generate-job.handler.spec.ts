import { describe, expect, it, vi } from 'vitest';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { ClaimedJobRow } from '../jobs/services/postgres-job-queue.consumer.js';
import {
  normalizeAndReindexGeneratedQuiz,
  QuizGenerateJobHandler,
} from './services/quiz-generate-job.handler.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const ROADMAP_ID = '44444444-4444-4444-8444-444444444444';
const TOPIC_ID = '55555555-5555-4555-8555-555555555555';
const SKILL_ID = '66666666-6666-4666-8666-666666666666';
const QUIZ_ID = '77777777-7777-4777-8777-777777777777';
const ATTEMPT_ID = '88888888-8888-4888-8888-888888888888';
const JOB_ID = '99999999-9999-4999-8999-999999999999';
const AI_GEN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeSyntheticQuizOutput() {
  return {
    is_reduced: false,
    mcq_questions: Array.from({ length: 20 }, (_, i) => ({
      sort_order: i + 1,
      difficulty: 'application' as const,
      prompt: `MCQ prompt #${i + 1}`,
      options: [
        { option_id: 'a', text: 'Option A' },
        { option_id: 'b', text: 'Option B' },
      ],
      correct_option_id: 'a',
      explanation: `Explanation #${i + 1}`,
      allow_i_dont_know: true,
    })),
    free_response_questions: Array.from({ length: 5 }, (_, i) => ({
      // Note: SyntheticProviderAdapter emits 1..5 here, colliding with MCQ sort_order 1..5 unless re-indexed!
      sort_order: i + 1,
      difficulty: 'analysis' as const,
      prompt: `FR prompt #${i + 1}`,
      response_hint: 'sql' as const,
      rubric: {
        correctness_criteria: ['Correct query'],
        understanding_criteria: ['Explains join'],
        reasoning_criteria: ['Handles nulls'],
      },
      max_length: 2000,
      allow_i_dont_know: true,
    })),
  };
}

describe('QuizGenerateJobHandler (quiz_generate worker & uq_quiz_questions_order contiguous re-index)', () => {
  it('re-indexes mcq_questions (1..20) and free_response_questions (21..25) contiguously with zero duplicate sort_order', () => {
    const raw = makeSyntheticQuizOutput();
    const normalized = normalizeAndReindexGeneratedQuiz(raw, 1);

    expect(normalized.mcq_count).toBe(20);
    expect(normalized.free_response_count).toBe(5);
    expect(normalized.questions).toHaveLength(25);

    const sortOrders = normalized.questions.map((q) => q.sort_order);
    expect(sortOrders).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(sortOrders).size).toBe(25);
    expect(normalized.questions[0]?.question_type).toBe('mcq');
    expect(normalized.questions[19]?.question_type).toBe('mcq');
    expect(normalized.questions[20]?.question_type).toBe('free_response');
    expect(normalized.questions[24]?.question_type).toBe('free_response');

    const badRubric = makeSyntheticQuizOutput();
    badRubric.free_response_questions[0]!.rubric.correctness_criteria = [
      null as unknown as string,
      '   ',
    ];
    expect(() => normalizeAndReindexGeneratedQuiz(badRubric, 1)).toThrow(
      /Invalid free-response question/i,
    );

    const emptyCriteriaRubric = makeSyntheticQuizOutput();
    emptyCriteriaRubric.free_response_questions[0]!.rubric.correctness_criteria =
      [];
    expect(() =>
      normalizeAndReindexGeneratedQuiz(emptyCriteriaRubric, 1),
    ).toThrow(/Invalid free-response question/i);
  });

  it('persists shared quiz + 25 contiguously ordered questions + user quiz_attempt in persistArtifact', async () => {
    const insertedSortOrders: number[] = [];
    const txQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        return [
          {
            item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            roadmap_status: 'locked',
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            skill_name: 'SQL',
          },
        ];
      }
      if (
        sql.includes('FROM public.daily_plan_items') &&
        sql.includes('FOR UPDATE')
      ) {
        return [{ id: ITEM_ID, topic_id: TOPIC_ID }];
      }
      if (sql.includes('FROM public.roadmaps')) {
        return [{ status: 'locked' }];
      }
      if (sql.includes('FROM public.topics')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            explanation_markdown: '# SQL Joins',
            language: 'en',
          },
        ];
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        return [];
      }
      if (sql.includes('FROM public.quizzes')) {
        return [];
      }
      if (sql.includes('INSERT INTO public.quizzes')) {
        expect(params?.[6]).toBe(AI_GEN_ID);
        return [[{ id: QUIZ_ID }], 1];
      }
      if (sql.includes('INSERT INTO public.quiz_questions')) {
        insertedSortOrders.push(Number(params?.[1]));
        return [
          [
            {
              id: `00000000-0000-4000-8000-${String(params?.[1]).padStart(12, '0')}`,
            },
          ],
          1,
        ];
      }
      if (sql.includes('AS referenced')) {
        return [{ referenced: true }];
      }
      if (sql.includes('FROM public.quiz_attempts')) {
        return [];
      }
      if (sql.includes('INSERT INTO public.quiz_attempts')) {
        return [[{ id: ATTEMPT_ID }], 1];
      }
      return [];
    });

    const databaseMock = {
      query: txQuery,
      transaction: vi.fn(async (_u, op) => op({ query: txQuery })),
    } as unknown as DatabaseService;
    const aiGatewayMock = {
      execute: vi.fn(),
    } as unknown as AiGatewayService;

    const handler = new QuizGenerateJobHandler(databaseMock, aiGatewayMock);
    const job: ClaimedJobRow = {
      id: JOB_ID,
      user_id: USER_ID,
      task: 'quiz_generate',
      feature_key: 'quiz_practice',
      job_kind: 'quiz_generate',
      status: 'preparing',
      attempt_count: 1,
      locked_by: 'worker-1',
      locked_at: new Date(),
      created_at: new Date(),
      language: 'en',
      subject_type: 'daily_plan_item',
      subject_id: ITEM_ID,
      idempotency_key: null,
      input_payload: {
        v: 1,
        args: {
          daily_plan_item_id: ITEM_ID,
          topic_id: TOPIC_ID,
          content_version: 1,
          variant_no: 1,
        },
        expected_refs: {
          content_version: 1,
        },
      },
    };

    const txExecutor = {
      query: txQuery,
    } as unknown as import('../jobs/services/job-producer.service.js').JobQueryExecutor;
    const verifyRes = await handler.verifyExpectedRefs(txExecutor, job);
    expect(verifyRes).toEqual({ ok: true });

    const persisted = await handler.persistArtifact(
      txExecutor,
      job,
      {
        resultType: 'quiz_attempt',
        resultId: ITEM_ID,
        providerKey: 'synthetic',
        modelId: 'model-1',
        promptVersionId: 'pv-1',
        outputSchemaId: 'quiz_generate.v1',
        fallbackUsed: false,
        language: 'en',
        inputUnits: 100,
        outputUnits: 200,
        latencyMs: 25,
        output: makeSyntheticQuizOutput(),
      },
      { aiGenerationId: AI_GEN_ID },
    );

    expect(persisted).toEqual({
      resultType: 'quiz_attempt',
      resultId: ATTEMPT_ID,
    });
    expect(insertedSortOrders).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it('passes rich 2-3 sentence explanation_guidance in AI context when executing quiz_generate', async () => {
    const readQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        return [
          {
            item_id: ITEM_ID,
            plan_id: PLAN_ID,
            roadmap_id: ROADMAP_ID,
            roadmap_status: 'locked',
            topic_id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            skill_name: 'SQL',
          },
        ];
      }
      if (sql.includes('AS referenced')) {
        return [{ referenced: true }];
      }
      if (sql.includes('FROM public.quiz_attempts')) {
        return [];
      }
      if (sql.includes('FROM public.topics')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            explanation_markdown: '# SQL Joins',
            language: 'en',
          },
        ];
      }
      if (sql.includes('FROM public.quizzes')) {
        return [];
      }
      return [];
    });

    const databaseMock = {
      query: readQuery,
      transaction: vi.fn(async (_u, op) => op({ query: readQuery })),
    } as unknown as DatabaseService;
    const executeMock = vi.fn().mockResolvedValue({
      status: 'ok',
      provider_id: 'synthetic',
      model_id: 'model-1',
      prompt_version_id: 'pv-1',
      fallback_used: false,
      usage_units: { input: 100, output: 200 },
      latency_ms: 20,
      output: makeSyntheticQuizOutput(),
    });
    const aiGatewayMock = {
      execute: executeMock,
    } as unknown as AiGatewayService;

    const handler = new QuizGenerateJobHandler(databaseMock, aiGatewayMock);
    const job: ClaimedJobRow = {
      id: JOB_ID,
      user_id: USER_ID,
      task: 'quiz_generate',
      feature_key: 'quiz_practice',
      job_kind: 'quiz_generate',
      status: 'preparing',
      attempt_count: 1,
      locked_by: 'worker-1',
      locked_at: new Date(),
      created_at: new Date(),
      language: 'en',
      subject_type: 'daily_plan_item',
      subject_id: ITEM_ID,
      idempotency_key: null,
      input_payload: {
        v: 1,
        args: {
          daily_plan_item_id: ITEM_ID,
          topic_id: TOPIC_ID,
          content_version: 1,
          variant_no: 1,
        },
        expected_refs: {
          content_version: 1,
        },
      },
    };

    await handler.execute(job, new AbortController().signal);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const passedRequest = executeMock.mock.calls[0]?.[0] as {
      context?: Record<string, unknown>;
    };
    expect(passedRequest.context?.explanation_guidance).toContain(
      '2-3 sentence conceptual explanation',
    );
  });

  it('rejects persistArtifact as STALE_JOB_INPUT when topicRevision drifted or existing quiz row is already referenced by attempts', async () => {
    const handler = new QuizGenerateJobHandler(
      {} as unknown as DatabaseService,
      {} as unknown as AiGatewayService,
    );
    const job: ClaimedJobRow = {
      id: JOB_ID,
      user_id: USER_ID,
      task: 'quiz_generate',
      feature_key: 'quiz_practice',
      job_kind: 'quiz_generate',
      status: 'preparing',
      attempt_count: 1,
      locked_by: 'worker-1',
      locked_at: new Date(),
      created_at: new Date(),
      language: 'en',
      subject_type: 'daily_plan_item',
      subject_id: ITEM_ID,
      idempotency_key: null,
      input_payload: {
        v: 1,
        args: {
          daily_plan_item_id: ITEM_ID,
          topic_id: TOPIC_ID,
          content_version: 1,
          variant_no: 1,
        },
        expected_refs: { content_version: 1 },
      },
    };

    const driftQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        return [{ plan_id: PLAN_ID, roadmap_id: ROADMAP_ID }];
      }
      if (sql.includes('FROM public.roadmaps')) {
        return [{ status: 'locked' }];
      }
      if (sql.includes('FROM public.daily_plan_items')) {
        return [{ id: ITEM_ID, topic_id: TOPIC_ID }];
      }
      if (sql.includes('AS referenced')) {
        return [{ referenced: true }];
      }
      if (sql.includes('FROM public.quiz_attempts')) {
        return [];
      }
      if (sql.includes('WHERE id = $1')) {
        return [{ skill_id: SKILL_ID, slug: 'sql-joins', career_level: 'mid' }];
      }
      if (sql.includes('FROM public.topics')) {
        return [
          {
            id: TOPIC_ID,
            content_version: 1,
            updated_at: '2026-11-23T12:00:00.000Z',
          },
        ];
      }
      return [];
    });

    await expect(
      handler.persistArtifact(
        {
          query: driftQuery,
        } as unknown as import('../jobs/services/job-producer.service.js').JobQueryExecutor,
        job,
        {
          resultType: 'quiz_attempt',
          resultId: ITEM_ID,
          providerKey: 'synthetic',
          modelId: 'm1',
          promptVersionId: 'p1',
          outputSchemaId: 'quiz_generate.v1',
          fallbackUsed: false,
          language: 'en',
          inputUnits: 10,
          outputUnits: 20,
          latencyMs: 5,
          output: makeSyntheticQuizOutput(),
          topicRevision: `${TOPIC_ID}:1:2026-11-23T10:00:00.000Z`,
        },
      ),
    ).rejects.toThrow(/Topic content changed during quiz generation/i);

    const referencedQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.daily_plan_items dpi')) {
        return [{ plan_id: PLAN_ID, roadmap_id: ROADMAP_ID }];
      }
      if (sql.includes('FROM public.roadmaps')) {
        return [{ status: 'locked' }];
      }
      if (sql.includes('FROM public.daily_plan_items')) {
        return [{ id: ITEM_ID, topic_id: TOPIC_ID }];
      }
      if (sql.includes('AS referenced')) {
        return [{ referenced: true }];
      }
      if (sql.includes('FROM public.quiz_attempts')) {
        return [];
      }
      if (sql.includes('WHERE id = $1')) {
        return [{ skill_id: SKILL_ID, slug: 'sql-joins', career_level: 'mid' }];
      }
      if (sql.includes('FROM public.topics')) {
        return [
          {
            id: TOPIC_ID,
            content_version: 1,
            updated_at: '2026-11-23T10:00:00.000Z',
          },
        ];
      }
      if (
        sql.includes('FROM public.quizzes') &&
        sql.includes("status = 'approved'")
      ) {
        return [];
      }
      if (sql.includes('FROM public.quizzes')) {
        return [{ id: QUIZ_ID }];
      }
      return [];
    });

    await expect(
      handler.persistArtifact(
        {
          query: referencedQuery,
        } as unknown as import('../jobs/services/job-producer.service.js').JobQueryExecutor,
        job,
        {
          resultType: 'quiz_attempt',
          resultId: ITEM_ID,
          providerKey: 'synthetic',
          modelId: 'm1',
          promptVersionId: 'p1',
          outputSchemaId: 'quiz_generate.v1',
          fallbackUsed: false,
          language: 'en',
          inputUnits: 10,
          outputUnits: 20,
          latencyMs: 5,
          output: makeSyntheticQuizOutput(),
          topicRevision: `${TOPIC_ID}:1:2026-11-23T10:00:00.000Z`,
        },
      ),
    ).rejects.toThrow(/already referenced by quiz attempts/i);
  });
});
