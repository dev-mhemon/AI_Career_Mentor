import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { JobQueryExecutor } from '../jobs/services/job-producer.service.js';
import type {
  ClaimedJobRow,
  JobExecutionResult,
} from '../jobs/services/postgres-job-queue.consumer.js';
import { TopicContentJobHandler } from './services/topic-content-job.handler.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const TOPIC_ID = '33333333-3333-4333-8333-333333333333';
const APPROVED_TOPIC_ID = '33333333-3333-4333-8333-333333333334';
const REGEN_TOPIC_ID = '33333333-3333-4333-8333-333333333335';
const SKILL_ID = '44444444-4444-4444-8444-444444444444';
const AI_GEN_ID = '55555555-5555-4555-8555-555555555555';
const MODEL_ID = '66666666-6666-4666-8666-666666666666';
const PROMPT_ID = '77777777-7777-4777-8777-777777777777';

function makeTopicJob(overrides: Partial<ClaimedJobRow> = {}): ClaimedJobRow {
  return {
    id: JOB_ID,
    user_id: USER_ID,
    task: 'topic_content',
    feature_key: 'daily_plan',
    job_kind: 'topic_content',
    status: 'preparing',
    attempt_count: 1,
    locked_by: 'worker-1',
    locked_at: new Date(),
    created_at: new Date(),
    language: 'mixed',
    subject_type: 'topic',
    subject_id: TOPIC_ID,
    idempotency_key: null,
    input_payload: {
      v: 1,
      args: {
        topic_id: TOPIC_ID,
        skill_id: SKILL_ID,
        career_level: 'mid',
        content_version: 1,
      },
      expected_refs: {
        content_version: 1,
      },
    },
    ...overrides,
  };
}

function makeAiExecResult(): JobExecutionResult {
  return {
    resultType: 'topic',
    resultId: TOPIC_ID,
    providerKey: 'synthetic',
    modelId: MODEL_ID,
    promptVersionId: PROMPT_ID,
    outputSchemaId: 'topic_content.v1',
    fallbackUsed: false,
    language: 'mixed',
    inputUnits: 100,
    outputUnits: 250,
    latencyMs: 30,
    output: {
      explanation_markdown: '# SQL Joins\n\nDetailed study guide.',
      important_questions: [
        {
          question: 'Difference between INNER and LEFT JOIN?',
          answer_markdown: 'LEFT JOIN retains unmatched left rows.',
        },
      ],
      language: 'mixed',
      sources: [
        {
          title: 'PostgreSQL Joins',
          publisher: 'PostgreSQL Docs',
          url: 'https://www.postgresql.org/docs/current/tutorial-join.html',
          resource_type: 'official_docs',
        },
      ],
    },
  };
}

describe('TopicContentJobHandler (topic_content async worker)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let aiGatewayMock: { execute: ReturnType<typeof vi.fn> };
  let handler: TopicContentJobHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock = vi.fn();
    databaseMock = {
      query: queryMock,
      transaction: vi.fn(
        async (
          _userId: string | null,
          op: (db: { query: typeof queryMock }) => Promise<unknown>,
        ) => op({ query: queryMock }),
      ),
    } as unknown as DatabaseService;
    aiGatewayMock = {
      execute: vi.fn().mockResolvedValue({
        request_id: JOB_ID,
        generation_id: null,
        status: 'ok',
        provider_id: 'synthetic',
        model_id: MODEL_ID,
        prompt_version_id: PROMPT_ID,
        fallback_used: false,
        usage_units: { input: 100, output: 250 },
        cost: 0,
        latency_ms: 30,
        validation_status: 'passed',
        sources: [],
        output: makeAiExecResult().output,
      }),
    };
    handler = new TopicContentJobHandler(
      databaseMock,
      aiGatewayMock as unknown as AiGatewayService,
    );
  });

  it('short-circuits without calling AiGatewayService when an approved canonical topic already exists', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN public.skills')) {
        expect(sql).toContain('s.canonical_name AS skill_name');
        expect(sql).not.toMatch(/\bs\.name\b/);
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'draft',
            language: 'mixed',
            skill_name: 'PostgreSQL',
          },
        ];
      }
      if (sql.includes("status = 'approved'")) {
        return [{ id: APPROVED_TOPIC_ID, language: 'mixed' }];
      }
      return [];
    });

    const controller = new AbortController();
    const res = await handler.execute(makeTopicJob(), controller.signal);

    expect(aiGatewayMock.execute).not.toHaveBeenCalled();
    expect(res.skipAiGeneration).toBe(true);
    expect(res.resultType).toBe('topic');
    expect(res.resultId).toBe(APPROVED_TOPIC_ID);
  });

  it('calls AiGatewayService with snake_case AIRequestDTO outside DB tx when no approved canonical topic exists', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN public.skills')) {
        expect(sql).toContain('s.canonical_name AS skill_name');
        expect(sql).not.toMatch(/\bs\.name\b/);
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'draft',
            language: 'mixed',
            skill_name: 'PostgreSQL',
          },
        ];
      }
      if (sql.includes("status = 'approved'")) {
        return [];
      }
      return [];
    });

    const controller = new AbortController();
    const res = await handler.execute(makeTopicJob(), controller.signal);

    expect(aiGatewayMock.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: JOB_ID,
        user_id: USER_ID,
        task: 'topic_content',
        feature_key: 'daily_plan',
        output_schema: 'topic_content.v1',
        language: 'mixed',
      }),
      expect.objectContaining({
        persistTelemetry: false,
        signal: controller.signal,
      }),
    );
    expect(res.skipAiGeneration).toBeUndefined();
    expect(res.providerKey).toBe('synthetic');
    expect(res.modelId).toBe(MODEL_ID);
    expect(res.promptVersionId).toBe(PROMPT_ID);
    expect(res.inputUnits).toBe(100);
    expect(res.outputUnits).toBe(250);
  });

  it('updates draft topic in-place to approved, links ai_generation_id, acquires canonical advisory lock, and inserts learning_resources', async () => {
    const txQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.topics') && sql.includes('FOR UPDATE')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'draft',
          },
        ];
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        expect(params).toEqual([`${SKILL_ID}:sql-joins:mid`]);
        return [];
      }
      if (sql.includes("status = 'approved'") && sql.includes('SELECT id')) {
        return [];
      }
      if (sql.includes('UPDATE public.topics')) {
        expect(params?.[4]).toBe(AI_GEN_ID);
        return [[{ id: TOPIC_ID }], 1];
      }
      if (sql.includes('INSERT INTO public.learning_resources')) {
        expect(params?.[0]).toBe(TOPIC_ID);
        expect(params?.[3]).toBe(
          'https://www.postgresql.org/docs/current/tutorial-join.html',
        );
        return [];
      }
      return [];
    });

    const persisted = await handler.persistArtifact(
      { query: txQuery as unknown as JobQueryExecutor['query'] },
      makeTopicJob(),
      makeAiExecResult(),
      { aiGenerationId: AI_GEN_ID },
    );

    expect(persisted).toEqual({ resultType: 'topic', resultId: TOPIC_ID });
    const lockIdx = txQuery.mock.calls.findIndex(([sql]) =>
      String(sql).includes('pg_advisory_xact_lock'),
    );
    const approvedLookupIdx = txQuery.mock.calls.findIndex(
      ([sql]) =>
        String(sql).includes("status = 'approved'") &&
        String(sql).includes('SELECT id'),
    );
    expect(lockIdx).toBeGreaterThan(-1);
    expect(approvedLookupIdx).toBeGreaterThan(lockIdx);
    expect(
      txQuery.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO public.learning_resources'),
      ),
    ).toBe(true);
  });

  it('inserts content_version + 1 when regenerating a hidden topic without mutating roadmap_items', async () => {
    let insertedVersion: unknown = null;
    let insertedAiGenId: unknown = null;
    let resourceTopicId: unknown = null;

    const txQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.topics') && sql.includes('FOR UPDATE')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'hidden',
          },
        ];
      }
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes("status = 'approved'") && sql.includes('SELECT id'))
        return [];
      if (sql.includes('COALESCE(MAX(content_version), 0) + 1')) {
        return [{ next_version: 2 }];
      }
      if (sql.includes('INSERT INTO public.topics')) {
        insertedVersion = params?.[4];
        insertedAiGenId = params?.[8];
        return [[{ id: REGEN_TOPIC_ID }], 1];
      }
      if (sql.includes('INSERT INTO public.learning_resources')) {
        resourceTopicId = params?.[0];
        return [];
      }
      return [];
    });

    const persisted = await handler.persistArtifact(
      { query: txQuery as unknown as JobQueryExecutor['query'] },
      makeTopicJob(),
      makeAiExecResult(),
      { aiGenerationId: AI_GEN_ID },
    );

    expect(persisted).toEqual({
      resultType: 'topic',
      resultId: REGEN_TOPIC_ID,
    });
    expect(insertedVersion).toBe(2);
    expect(insertedAiGenId).toBe(AI_GEN_ID);
    expect(resourceTopicId).toBe(REGEN_TOPIC_ID);
    expect(
      txQuery.mock.calls.some(([sql]) => String(sql).includes('roadmap_items')),
    ).toBe(false);
  });

  it('reuses concurrently committed approved topic inside advisory lock without violating uq_topics_one_approved', async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.topics') && sql.includes('FOR UPDATE')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'draft',
          },
        ];
      }
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes("status = 'approved'") && sql.includes('SELECT id')) {
        return [{ id: APPROVED_TOPIC_ID }];
      }
      return [];
    });

    const persisted = await handler.persistArtifact(
      { query: txQuery as unknown as JobQueryExecutor['query'] },
      makeTopicJob(),
      makeAiExecResult(),
      { aiGenerationId: AI_GEN_ID },
    );

    expect(persisted).toEqual({
      resultType: 'topic',
      resultId: APPROVED_TOPIC_ID,
    });
    const lockIdx = txQuery.mock.calls.findIndex(([sql]) =>
      String(sql).includes('pg_advisory_xact_lock'),
    );
    const approvedLookupIdx = txQuery.mock.calls.findIndex(
      ([sql]) =>
        String(sql).includes("status = 'approved'") &&
        String(sql).includes('SELECT id'),
    );
    expect(lockIdx).toBeGreaterThan(-1);
    expect(approvedLookupIdx).toBeGreaterThan(lockIdx);
    expect(
      txQuery.mock.calls.some(
        ([sql]) =>
          String(sql).includes('UPDATE public.topics') ||
          String(sql).includes('INSERT INTO public.topics'),
      ),
    ).toBe(false);
  });

  it('verifyExpectedRefs validates canonical content_version independently of roadmap edits and rejects content_version drift', async () => {
    const txQuery = vi.fn(async (sql: string) => {
      if (sql.includes('WHERE id = $1')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 1,
            status: 'draft',
          },
        ];
      }
      if (sql.includes("status = 'approved'")) {
        return [];
      }
      return [];
    });

    const okResult = await handler.verifyExpectedRefs(
      { query: txQuery as unknown as JobQueryExecutor['query'] },
      makeTopicJob(),
    );
    expect(okResult).toEqual({ ok: true });

    txQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE id = $1')) {
        return [
          {
            id: TOPIC_ID,
            skill_id: SKILL_ID,
            slug: 'sql-joins',
            title: 'SQL Joins',
            career_level: 'mid',
            content_version: 2,
            status: 'draft',
          },
        ];
      }
      return [];
    });

    const driftResult = await handler.verifyExpectedRefs(
      { query: txQuery as unknown as JobQueryExecutor['query'] },
      makeTopicJob(),
    );
    expect(driftResult).toEqual({
      ok: false,
      reason: 'TOPIC_CONTENT_VERSION_DRIFT',
    });
  });
});
