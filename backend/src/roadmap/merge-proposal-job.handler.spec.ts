import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AIResponseDTO, MergeProposalOutput } from '../ai/ai.types.js';
import type { AiGatewayService } from '../ai/services/ai-gateway.service.js';
import {
  deriveMergeTopicSlug,
  OutputValidatorService,
} from '../ai/services/output-validator.service.js';
import type { DatabaseService } from '../auth/services/database.service.js';
import type { JobQueryExecutor } from '../jobs/services/job-producer.service.js';
import type {
  ClaimedJobRow,
  JobExecutionResult,
} from '../jobs/services/postgres-job-queue.consumer.js';
import {
  assertMergeGraphAcyclic,
  buildMergeSizeImpact,
  buildValidTopicSlug,
  MergeProposalJobHandler,
} from './services/merge-proposal-job.handler.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROADMAP_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const VERSION_ID = '44444444-4444-4444-8444-444444444444';
const JOB_ID = '55555555-5555-4555-8555-555555555555';
const MERGE_ID = '66666666-6666-4666-8666-666666666666';
const AI_GEN_ID = '77777777-7777-4777-8777-777777777777';
const SKILL_ID = '88888888-8888-4888-8888-888888888888';
const LINEAGE_A = 'aaaa1111-1111-4111-8111-111111111111';
const LINEAGE_B = 'aaaa2222-2222-4222-8222-222222222222';
const LINEAGE_RETIRED = 'aaaa3333-3333-4333-8333-333333333333';
const TOPIC_A = 'bbbb1111-1111-4111-8111-111111111111';
const TOPIC_B = 'bbbb2222-2222-4222-8222-222222222222';
const TOPIC_NEW = 'bbbb9999-9999-4999-8999-999999999999';
const PLAN_ID = 'cccc1111-1111-4111-8111-111111111111';

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

function makeClaimedMergeJob(
  overrides: {
    origin?: 'user_request' | 'level_change' | 'ai_proposal';
    instruction?: string;
    target_level?: 'junior' | 'mid' | 'senior';
    base_version_no?: number;
  } = {},
): ClaimedJobRow {
  const origin = overrides.origin ?? 'user_request';
  const baseVersionNo = overrides.base_version_no ?? 2;
  return {
    id: JOB_ID,
    user_id: USER_ID,
    task: 'merge_proposal',
    feature_key: 'roadmap_generator',
    job_kind: 'merge_proposal',
    status: 'preparing',
    attempt_count: 1,
    locked_by: 'worker-1',
    locked_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    language: 'en',
    subject_type: 'roadmap',
    subject_id: ROADMAP_ID,
    idempotency_key: 'idem-merge-1',
    input_payload: {
      v: 1,
      args: {
        roadmap_id: ROADMAP_ID,
        base_version_no: baseVersionNo,
        origin,
        ...(overrides.instruction !== undefined
          ? { instruction: overrides.instruction }
          : origin === 'user_request'
            ? {
                instruction:
                  'Add OpenTelemetry observability and update SQL depth',
              }
            : {}),
        ...(overrides.target_level !== undefined
          ? { target_level: overrides.target_level }
          : origin === 'level_change'
            ? { target_level: 'senior' }
            : {}),
      },
      expected_refs: {
        base_version_no: baseVersionNo,
      },
    },
  };
}

function makeBaseItems() {
  return [
    {
      id: 'item-a',
      lineage_id: LINEAGE_A,
      topic_id: TOPIC_A,
      skill_id: SKILL_ID,
      phase_no: 1,
      phase_title: 'Foundations',
      title: 'SQL Indexing',
      priority: 'core',
      gap_type: 'strengthen',
      required_depth: 'Mid-level indexing',
      estimated_effort_hours: '2.0',
      sequence_no: 1,
      depends_on_lineage_ids: [],
      reason: 'Core backend skill',
      retired: false,
      sources: [],
    },
    {
      id: 'item-b',
      lineage_id: LINEAGE_B,
      topic_id: TOPIC_B,
      skill_id: SKILL_ID,
      phase_no: 1,
      phase_title: 'Foundations',
      title: 'Query Tuning',
      priority: 'supporting',
      gap_type: 'missing',
      required_depth: 'Explain analyze',
      estimated_effort_hours: '2.0',
      sequence_no: 2,
      depends_on_lineage_ids: [LINEAGE_A],
      reason: 'Builds on indexing',
      retired: false,
      sources: [],
    },
    {
      id: 'item-retired',
      lineage_id: LINEAGE_RETIRED,
      topic_id: 'bbbb3333-3333-4333-8333-333333333333',
      skill_id: SKILL_ID,
      phase_no: 2,
      phase_title: 'Legacy',
      title: 'Old SOAP Services',
      priority: 'optional',
      gap_type: 'refresh',
      required_depth: null,
      estimated_effort_hours: '1.0',
      sequence_no: 3,
      depends_on_lineage_ids: [],
      reason: 'Legacy',
      retired: true,
      sources: [],
    },
  ];
}

function makeExecResult(output: MergeProposalOutput): JobExecutionResult {
  return {
    resultType: 'roadmap_merge',
    resultId: ROADMAP_ID,
    providerKey: 'synthetic',
    modelId: 'model-1',
    promptVersionId: 'prompt-1',
    outputSchemaId: 'merge_proposal.v1',
    fallbackUsed: false,
    language: 'en',
    inputUnits: 500,
    outputUnits: 250,
    latencyMs: 120,
    output,
  };
}

describe('MergeProposalJobHandler', () => {
  it('computes size_impact and detects cycles in pure helpers', () => {
    const small = buildMergeSizeImpact(10, 12, 45);
    expect(small).toMatchObject({
      active_topics_before: 10,
      active_topics_after: 12,
      before: 10,
      after: 12,
      delta: 2,
      soft_limit: 45,
      materially_large: false,
      warning: null,
    });

    const large = buildMergeSizeImpact(44, 47, 45);
    expect(large.materially_large).toBe(true);
    expect(large.delta).toBe(3);
    expect(large.warning).toContain('47');

    const cyclic = new Map<string, string[]>([
      [LINEAGE_A, [LINEAGE_B]],
      [LINEAGE_B, [LINEAGE_A]],
    ]);
    try {
      assertMergeGraphAcyclic(cyclic);
      expect.unreachable('expected AI_VALIDATION_FAILED');
    } catch (error) {
      expectContractError(error, 502, 'AI_VALIDATION_FAILED');
    }
  });

  it('executes merge_proposal outside DB transaction with grounded context and returns JobExecutionResult', async () => {
    const dbQuery = vi.fn(async (sql: string) => {
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      if (sql.includes('FROM public.roadmaps') && !sql.includes('JOIN')) {
        return [
          {
            id: ROADMAP_ID,
            status: 'locked',
            current_version_id: VERSION_ID,
            target_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.roadmap_versions')) {
        return [{ id: VERSION_ID, version_no: 2 }];
      }
      if (sql.includes('FROM public.roadmap_merges')) return [];
      if (sql.includes('FROM public.system_configurations')) {
        return [{ config_value: 45 }];
      }
      if (sql.includes('JOIN public.career_roles')) {
        return [
          {
            id: ROADMAP_ID,
            canonical_role_id: ROLE_ID,
            role_name: 'Backend Development',
            target_level: 'mid',
            current_version_id: VERSION_ID,
          },
        ];
      }
      if (sql.includes('FROM public.roadmap_items'))
        return makeBaseItems().slice(0, 2);
      if (sql.includes('FROM public.skill_progress')) {
        return [
          {
            skill_id: SKILL_ID,
            career_level: 'mid',
            learning_state: 'practicing',
          },
        ];
      }
      if (sql.includes('FROM public.learning_evidence')) {
        return [
          {
            skill_id: SKILL_ID,
            career_level: 'mid',
            source_type: 'quiz_attempt',
            performance_level: 'good',
          },
        ];
      }
      if (sql.includes('FROM public.skills')) {
        return [{ id: SKILL_ID, slug: 'sql', canonical_name: 'SQL' }];
      }
      return [];
    });

    let inTx = false;
    let aiExecutedInTx: boolean | null = null;
    const database = {
      transaction: vi.fn(async (_userId, fn) => {
        inTx = true;
        try {
          return await fn({ query: dbQuery });
        } finally {
          inTx = false;
        }
      }),
    } as unknown as DatabaseService;

    const aiOutput: MergeProposalOutput = {
      reason: 'Adds observability topic per user request.',
      target_level: null,
      operations: [
        {
          sort_order: 1,
          op: 'add_topic',
          lineage_id: null,
          topic_id: 'opentelemetry-tracing',
          title: 'OpenTelemetry Tracing',
          priority: 'supporting',
          reason: 'Requested observability topic',
          payload: {
            phase_no: 2,
            skill_id: SKILL_ID,
            estimated_effort_hours: 2,
          },
        },
      ],
      size_impact: {
        active_topics_before: 2,
        active_topics_after: 3,
        materially_large: false,
        warning: null,
      },
    };

    const aiResponse: AIResponseDTO<MergeProposalOutput> = {
      request_id: JOB_ID,
      generation_id: AI_GEN_ID,
      status: 'ok',
      output: aiOutput,
      provider_id: 'synthetic',
      model_id: 'model-1',
      prompt_version_id: 'prompt-1',
      fallback_used: false,
      usage_units: { input: 410, output: 190 },
      cost: 0,
      latency_ms: 85,
      sources: [],
      validation_status: 'passed',
    };
    const aiGateway = {
      execute: vi.fn().mockImplementation(async () => {
        aiExecutedInTx = inTx;
        return aiResponse;
      }),
    } as unknown as AiGatewayService;

    const handler = new MergeProposalJobHandler(database, aiGateway);
    const res = await handler.execute(
      makeClaimedMergeJob({ origin: 'user_request' }),
      new AbortController().signal,
    );

    expect(handler.canHandle('merge_proposal')).toBe(true);
    expect(res.resultType).toBe('roadmap_merge');
    expect(res.outputSchemaId).toBe('merge_proposal.v1');
    expect(aiGateway.execute).toHaveBeenCalledTimes(1);
    expect(aiExecutedInTx).toBe(false);
    expect(inTx).toBe(false);
    const callArgs = vi.mocked(aiGateway.execute).mock.calls[0];
    expect(callArgs[0].task).toBe('merge_proposal');
    expect(callArgs[1]).toMatchObject({ persistTelemetry: false });
  });

  it('persists valid user_request merge proposal with topic provisioning, size_impact, and daily_plan_impact', async () => {
    const insertedMergeParams: unknown[][] = [];
    const insertedItemParams: unknown[][] = [];

    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (
          sql.includes('FROM public.roadmap_merges') &&
          sql.includes('SELECT')
        ) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return makeBaseItems();
        }
        if (sql.includes('FROM public.skills')) {
          return [{ id: SKILL_ID }];
        }
        if (sql.includes('FROM public.topics') && sql.includes('slug =')) {
          return [];
        }
        if (sql.includes('INSERT INTO public.topics')) {
          return [[{ id: TOPIC_NEW }], 1];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 2 }]; // soft_limit = 2 -> size_after 3 => materially_large = true
        }
        if (sql.includes('FROM public.daily_plans')) {
          return [{ id: PLAN_ID, hours_per_day: '2.0', status: 'active' }];
        }
        if (sql.includes('FROM public.daily_plan_items')) {
          return [
            {
              id: 'dpi-1',
              day_no: 1,
              lineage_id: LINEAGE_A,
              status: 'completed',
            },
            {
              id: 'dpi-2',
              day_no: 2,
              lineage_id: LINEAGE_B,
              status: 'pending',
            },
          ];
        }
        if (sql.includes('FROM public.quiz_attempts')) return [];
        if (sql.includes('FROM public.ai_requests')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          insertedMergeParams.push(params ?? []);
          return [[{ id: MERGE_ID }], 1];
        }
        if (sql.includes('INSERT INTO public.roadmap_merge_items')) {
          insertedItemParams.push(params ?? []);
          return [];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    const output: MergeProposalOutput = {
      reason: 'Adds OpenTelemetry and elevates Query Tuning to core.',
      target_level: null,
      operations: [
        {
          sort_order: 2,
          op: 'reprioritize',
          lineage_id: LINEAGE_B,
          topic_id: null,
          title: null,
          priority: 'core',
          reason: 'High production impact',
          payload: {},
        },
        {
          sort_order: 1,
          op: 'add_topic',
          lineage_id: null,
          topic_id: 'otel-tracing',
          title: 'OpenTelemetry Tracing',
          priority: 'supporting',
          reason: 'Requested observability coverage',
          payload: {
            skill_id: SKILL_ID,
            phase_no: 2,
            estimated_effort_hours: 2,
            depends_on_lineage_ids: [LINEAGE_A],
          },
        },
      ],
      size_impact: {
        active_topics_before: 99, // intentionally wrong from AI — server recomputes!
        active_topics_after: 99,
        materially_large: false,
        warning: null,
      },
    };

    const persisted = await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({ origin: 'user_request' }),
      makeExecResult(output),
      { aiGenerationId: AI_GEN_ID },
    );

    expect(persisted).toEqual({
      resultType: 'roadmap_merge',
      resultId: MERGE_ID,
    });
    expect(insertedMergeParams).toHaveLength(1);
    const mergeArgs = insertedMergeParams[0];
    // size_before=2, size_after=3, materially_large=true (3 > soft_limit 2), ai_generation_id=AI_GEN_ID
    expect(mergeArgs[7]).toBe(2);
    expect(mergeArgs[8]).toBe(3);
    expect(mergeArgs[9]).toBe(true);
    expect(JSON.parse(String(mergeArgs[10]))).toEqual({
      has_active_plan: true,
      completed_days_unchanged: 1,
      future_days_affected: 1,
    });
    expect(mergeArgs[11]).toBe(AI_GEN_ID);

    // Operations inserted in contiguous sort_order 1..2
    expect(insertedItemParams).toHaveLength(2);
    expect(insertedItemParams[0][2]).toBe(1);
    expect(insertedItemParams[0][3]).toBe('add_topic');
    expect(insertedItemParams[0][4]).toBeNull(); // lineage_id null for add_topic
    expect(insertedItemParams[0][5]).toBe(TOPIC_NEW); // resolved canonical topic_id NOT NULL
    expect(insertedItemParams[1][2]).toBe(2);
    expect(insertedItemParams[1][3]).toBe('reprioritize');
    expect(insertedItemParams[1][4]).toBe(LINEAGE_B);

    // Must never mutate roadmaps, roadmap_versions, or roadmap_items during proposal persistence
    const executedSqls = tx.query.mock.calls.map((c) => String(c[0]));
    expect(
      executedSqls.some((s) => /UPDATE\s+public\.roadmaps\b/i.test(s)),
    ).toBe(false);
    expect(
      executedSqls.some((s) =>
        /(?:INSERT\s+INTO|UPDATE)\s+public\.roadmap_versions\b/i.test(s),
      ),
    ).toBe(false);
    expect(
      executedSqls.some((s) =>
        /(?:INSERT\s+INTO|UPDATE)\s+public\.roadmap_items\b/i.test(s),
      ),
    ).toBe(false);
  });

  it('persists level_change proposal preserving requested target_level without mutating roadmap', async () => {
    const insertedMergeParams: unknown[][] = [];

    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (
          sql.includes('FROM public.roadmap_merges') &&
          sql.includes('SELECT')
        ) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          insertedMergeParams.push(params ?? []);
          return [[{ id: MERGE_ID }], 1];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    const output: MergeProposalOutput = {
      reason: 'Elevates SQL depth for Senior target level.',
      target_level: 'senior',
      operations: [
        {
          sort_order: 1,
          op: 'update_topic',
          lineage_id: LINEAGE_A,
          topic_id: null,
          title: 'Distributed SQL Indexing & Partitioning',
          priority: 'core',
          reason: 'Senior architectural depth required',
          payload: {
            required_depth: 'Production sharding and index internals',
          },
        },
      ],
      size_impact: {
        active_topics_before: 2,
        active_topics_after: 2,
        materially_large: false,
        warning: null,
      },
    };

    const persisted = await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({ origin: 'level_change', target_level: 'senior' }),
      makeExecResult(output),
    );

    expect(persisted.resultId).toBe(MERGE_ID);
    expect(insertedMergeParams[0][2]).toBe('level_change');
    expect(insertedMergeParams[0][4]).toBe('senior');
    expect(insertedMergeParams[0][9]).toBe(false); // materially_large = false
    const levelSqls = tx.query.mock.calls.map((c) => String(c[0]));
    expect(levelSqls.some((s) => /UPDATE\s+public\.roadmaps\b/i.test(s))).toBe(
      false,
    );
    expect(
      levelSqls.some((s) =>
        /(?:INSERT\s+INTO|UPDATE)\s+public\.roadmap_versions\b/i.test(s),
      ),
    ).toBe(false);
    expect(
      levelSqls.some((s) =>
        /(?:INSERT\s+INTO|UPDATE)\s+public\.roadmap_items\b/i.test(s),
      ),
    ).toBe(false);
  });

  it('rejects unknown or retired lineage_id with AI_VALIDATION_FAILED before any DB insert', async () => {
    const querySpy = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.users')) return [{ status: 'active' }];
      if (sql.includes('FROM public.roadmaps')) {
        return [
          {
            id: ROADMAP_ID,
            status: 'locked',
            target_level: 'mid',
            current_version_id: VERSION_ID,
          },
        ];
      }
      if (sql.includes('FROM public.roadmap_versions')) {
        return [{ id: VERSION_ID, version_no: 2 }];
      }
      if (sql.includes('FROM public.roadmap_merges')) return [];
      if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
      return [];
    });

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    const retiredOpOutput: MergeProposalOutput = {
      reason: 'Tries to modify already retired topic',
      target_level: null,
      operations: [
        {
          sort_order: 1,
          op: 'update_topic',
          lineage_id: LINEAGE_RETIRED,
          topic_id: null,
          title: 'Revive SOAP',
          priority: 'optional',
          reason: 'Invalid target',
          payload: {},
        },
      ],
      size_impact: {
        active_topics_before: 2,
        active_topics_after: 2,
        materially_large: false,
        warning: null,
      },
    };

    await expect(
      handler.persistArtifact(
        { query: querySpy } as unknown as JobQueryExecutor,
        makeClaimedMergeJob(),
        makeExecResult(retiredOpOutput),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });

    // Zero INSERT queries executed
    const sqlCalls = querySpy.mock.calls.map((c) => c[0]);
    expect(
      sqlCalls.some((s) => s.includes('INSERT INTO public.roadmap_merges')),
    ).toBe(false);
  });

  it('rejects simulated DAG cycle with AI_VALIDATION_FAILED', async () => {
    const tx = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (sql.includes('FROM public.roadmap_merges')) return [];
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    // LINEAGE_B already depends on LINEAGE_A; making LINEAGE_A depend on LINEAGE_B creates cycle A -> B -> A
    const cycleOutput: MergeProposalOutput = {
      reason: 'Introduces circular dependency',
      target_level: null,
      operations: [
        {
          sort_order: 1,
          op: 'update_topic',
          lineage_id: LINEAGE_A,
          topic_id: null,
          title: 'SQL Indexing',
          priority: 'core',
          reason: 'Cycle test',
          payload: { depends_on_lineage_ids: [LINEAGE_B] },
        },
      ],
      size_impact: {
        active_topics_before: 2,
        active_topics_after: 2,
        materially_large: false,
        warning: null,
      },
    };

    await expect(
      handler.persistArtifact(
        tx as unknown as JobQueryExecutor,
        makeClaimedMergeJob(),
        makeExecResult(cycleOutput),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });
  });

  it('fails with STALE_JOB_INPUT when base_version_no drifts before persistArtifact', async () => {
    const tx = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 3 }]; // drifted from expected base_version_no = 2
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    const refCheck = await handler.verifyExpectedRefs(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({ base_version_no: 2 }),
    );
    expect(refCheck).toEqual({ ok: false, reason: 'BASE_VERSION_DRIFT' });

    const validOutput: MergeProposalOutput = {
      reason: 'Minor update',
      target_level: null,
      operations: [
        {
          sort_order: 1,
          op: 'reprioritize',
          lineage_id: LINEAGE_A,
          topic_id: null,
          title: null,
          priority: 'core',
          reason: 'Core',
          payload: {},
        },
      ],
      size_impact: {
        active_topics_before: 2,
        active_topics_after: 2,
        materially_large: false,
        warning: null,
      },
    };

    await expect(
      handler.persistArtifact(
        tx as unknown as JobQueryExecutor,
        makeClaimedMergeJob({ base_version_no: 2 }),
        makeExecResult(validOutput),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expectContractError(err, 409, 'STALE_JOB_INPUT');
      return true;
    });
  });

  it('accepts Gemini merge_proposal payloads with null add_topic topic_id, omitted priority/payload/size_impact, and mixed casing while preserving topic_id NOT NULL and safety invariants', async () => {
    const validator = new OutputValidatorService();

    // Live Gemini shape that previously failed OutputValidatorService with AI_VALIDATION_FAILED:
    // - target_level uppercase ("Mid") / omitted
    // - add_topic with topic_id: null (new topic) and title provided
    // - retire_topic omitting priority and payload
    // - size_impact omitted (server recomputes authoritatively)
    const rawGeminiOutput: Record<string, unknown> = {
      reason: 'Elevates Data Engineering roadmap to Mid-Level depth.',
      target_level: 'Mid',
      operations: [
        {
          sort_order: 0,
          op: 'ADD_TOPIC',
          topic_id: null,
          lineage_id: null,
          title: 'Apache Airflow Orchestration',
          priority: 'Core',
          reason: 'Production pipeline orchestration for Mid-Level scope',
          payload: {
            skill_id: SKILL_ID,
            phase_no: 2,
            gap_type: 'missing',
            estimated_effort_hours: 3,
            depends_on_lineage_ids: [LINEAGE_A],
          },
        },
        {
          op: 'retire_topic',
          lineage_id: LINEAGE_B.toUpperCase(),
          reason: 'Superseded by deeper query architecture coverage',
        },
      ],
    };

    const validated = validator.validate<MergeProposalOutput>(
      'merge_proposal',
      'merge_proposal.v1',
      rawGeminiOutput,
    );

    expect(validated.target_level).toBe('mid');
    expect(validated.operations[0].sort_order).toBe(1);
    expect(validated.operations[0].op).toBe('add_topic');
    expect(validated.operations[0].topic_id).toBeNull();
    expect(validated.operations[0].priority).toBe('core');
    expect(validated.operations[1].sort_order).toBe(2);
    expect(validated.operations[1].lineage_id).toBe(LINEAGE_B);
    expect(validated.operations[1].priority).toBeNull();
    expect(validated.operations[1].payload).toEqual({});

    const insertedItemParams: unknown[][] = [];
    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'junior',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 1 }];
        }
        if (
          sql.includes('FROM public.roadmap_merges') &&
          sql.includes('SELECT')
        ) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (sql.includes('FROM public.skills')) return [{ id: SKILL_ID }];
        if (sql.includes('FROM public.topics') && sql.includes('slug =')) {
          return [];
        }
        if (sql.includes('INSERT INTO public.topics')) {
          return [[{ id: TOPIC_NEW }], 1];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          return [[{ id: MERGE_ID }], 1];
        }
        if (sql.includes('INSERT INTO public.roadmap_merge_items')) {
          insertedItemParams.push(params ?? []);
          return [];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    const persisted = await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({
        origin: 'level_change',
        target_level: 'mid',
        base_version_no: 1,
      }),
      makeExecResult(validated),
      { aiGenerationId: AI_GEN_ID },
    );

    expect(persisted).toEqual({
      resultType: 'roadmap_merge',
      resultId: MERGE_ID,
    });
    expect(insertedItemParams).toHaveLength(2);
    expect(insertedItemParams[0][3]).toBe('add_topic');
    expect(insertedItemParams[0][4]).toBeNull();
    expect(insertedItemParams[0][5]).toBe(TOPIC_NEW); // canonical topic_id NOT NULL
    expect(insertedItemParams[1][3]).toBe('retire_topic');
    expect(insertedItemParams[1][4]).toBe(LINEAGE_B);

    // Real invariant preserved: add_topic with neither topic_id nor title still fails validation
    expect(() =>
      validator.validate('merge_proposal', 'merge_proposal.v1', {
        reason: 'Missing topic identity',
        target_level: null,
        operations: [
          {
            sort_order: 1,
            op: 'add_topic',
            topic_id: null,
            title: null,
            reason: 'Invalid empty topic',
            payload: {},
          },
        ],
      }),
    ).toThrow(HttpException);
  });

  it('trims trailing hyphens after truncation in buildValidTopicSlug and deriveMergeTopicSlug', () => {
    const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    // 62 'a's + space + 'b' => hyphen lands at index 62 (63rd char) when sliced to 63
    const titleBoundary = `${'a'.repeat(62)} b`;
    const slug = buildValidTopicSlug(titleBoundary);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug).toMatch(slugPattern);
    expect(slug.endsWith('-')).toBe(false);

    const validatorSlug = deriveMergeTopicSlug(titleBoundary, 1);
    expect(validatorSlug.length).toBeLessThanOrEqual(63);
    expect(validatorSlug).toMatch(slugPattern);
    expect(validatorSlug.endsWith('-')).toBe(false);

    // Non-ASCII fallback preserved
    expect(deriveMergeTopicSlug('বাংলা!!!', 3)).toBe('new-topic-3');

    // 53 'a's + space + 'b' => hyphen lands at index 53 when sliced to 54 with disambiguator
    const disambigBoundary = `${'a'.repeat(53)} b`;
    const disambigSlug = buildValidTopicSlug(disambigBoundary, 'slot-2');
    expect(disambigSlug.length).toBeLessThanOrEqual(63);
    expect(disambigSlug).toMatch(slugPattern);
    expect(disambigSlug.endsWith('-')).toBe(false);
  });

  it.each([
    [
      'non-scalar phase_no',
      { skill_id: SKILL_ID, phase_no: { toString: null } as unknown as number },
    ],
    [
      'non-scalar estimated_effort_hours',
      {
        skill_id: SKILL_ID,
        phase_no: 1,
        estimated_effort_hours: { toString: null } as unknown as number,
      },
    ],
  ])(
    'rejects malformed %s with 502 AI_VALIDATION_FAILED instead of throwing TypeError',
    async (_label, badPayload) => {
      const querySpy = vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (sql.includes('FROM public.roadmap_merges')) return [];
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (sql.includes('FROM public.skills')) return [{ id: SKILL_ID }];
        if (sql.includes('FROM public.topics') && sql.includes('slug =')) {
          return [];
        }
        if (sql.includes('INSERT INTO public.topics')) {
          return [[{ id: TOPIC_NEW }], 1];
        }
        return [];
      });

      const handler = new MergeProposalJobHandler(
        {} as DatabaseService,
        {} as AiGatewayService,
      );

      const badScalarOutput: MergeProposalOutput = {
        reason: 'Malformed numeric scalar',
        target_level: null,
        operations: [
          {
            sort_order: 1,
            op: 'add_topic',
            lineage_id: null,
            topic_id: 'otel-tracing',
            title: 'OpenTelemetry Tracing',
            priority: 'supporting',
            reason: 'Guard check',
            payload: badPayload,
          },
        ],
        size_impact: {
          active_topics_before: 2,
          active_topics_after: 3,
          materially_large: false,
          warning: null,
        },
      };

      await expect(
        handler.persistArtifact(
          { query: querySpy } as unknown as JobQueryExecutor,
          makeClaimedMergeJob(),
          makeExecResult(badScalarOutput),
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expectContractError(err, 502, 'AI_VALIDATION_FAILED');
        return true;
      });
      expect(
        querySpy.mock.calls.some((c) =>
          String(c[0]).includes('INSERT INTO public.roadmap_merges'),
        ),
      ).toBe(false);
    },
  );

  it('prevents sort_order collisions and rejects duplicate or ambiguous sort_order sequences', async () => {
    const validator = new OutputValidatorService();

    // Unambiguous mixed omission: op[0] omits sort_order while op[1] explicitly claims 1 -> op[0] gets unused slot 2
    const mixedValid = validator.validate<MergeProposalOutput>(
      'merge_proposal',
      'merge_proposal.v1',
      {
        reason: 'Mixed explicit and omitted sort orders',
        target_level: null,
        operations: [
          {
            op: 'reprioritize',
            lineage_id: LINEAGE_B,
            priority: 'core',
            reason: 'Second op without explicit sort_order',
          },
          {
            sort_order: 1,
            op: 'reprioritize',
            lineage_id: LINEAGE_A,
            priority: 'core',
            reason: 'Explicit first op',
          },
        ],
      },
    );
    expect(mixedValid.operations[0].sort_order).toBe(2);
    expect(mixedValid.operations[1].sort_order).toBe(1);

    // Explicit collision [1, 1] -> rejected by both validator and handler
    const duplicateOps = {
      reason: 'Duplicate sort_order',
      target_level: null,
      operations: [
        {
          sort_order: 1,
          op: 'reprioritize',
          lineage_id: LINEAGE_A,
          priority: 'core',
          reason: 'First',
          payload: {},
        },
        {
          sort_order: 1,
          op: 'reprioritize',
          lineage_id: LINEAGE_B,
          priority: 'core',
          reason: 'Collision',
          payload: {},
        },
      ],
    };
    expect(() =>
      validator.validate('merge_proposal', 'merge_proposal.v1', duplicateOps),
    ).toThrow(HttpException);

    // Ambiguous mixed omission [undefined, 5] -> rejected
    const ambiguousOps = {
      reason: 'Ambiguous mixed sort_order',
      target_level: null,
      operations: [
        {
          op: 'reprioritize',
          lineage_id: LINEAGE_A,
          priority: 'core',
          reason: 'Omitted',
          payload: {},
        },
        {
          sort_order: 5,
          op: 'reprioritize',
          lineage_id: LINEAGE_B,
          priority: 'core',
          reason: 'Out-of-range explicit',
          payload: {},
        },
      ],
    };
    expect(() =>
      validator.validate('merge_proposal', 'merge_proposal.v1', ambiguousOps),
    ).toThrow(HttpException);

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );
    const tx = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        return [];
      }),
    };
    await expect(
      handler.persistArtifact(
        tx as unknown as JobQueryExecutor,
        makeClaimedMergeJob(),
        makeExecResult(duplicateOps as unknown as MergeProposalOutput),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });
  });

  it('pins user_request add_topic resolution to locked roadmap target_level, looks up supplied topic_id slug first, and rejects malformed skill_id', async () => {
    const topicSlugLookups: Array<{ slug: unknown; level: unknown }> = [];
    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (
          sql.includes('FROM public.roadmap_merges') &&
          sql.includes('SELECT')
        ) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (sql.includes('FROM public.skills')) return [{ id: SKILL_ID }];
        if (sql.includes('FROM public.topics') && sql.includes('slug =')) {
          topicSlugLookups.push({ slug: params?.[1], level: params?.[2] });
          if (params?.[1] === 'otel-tracing') {
            return [{ id: TOPIC_NEW, title: 'OpenTelemetry Canonical' }];
          }
          return [];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          return [[{ id: MERGE_ID }], 1];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    // AI emits target_level: 'senior' on a 'mid' user_request roadmap; must stay pinned to 'mid'
    // and resolve supplied slug 'otel-tracing' before title-derived slug 'observability-deep-dive'
    const res = await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({ origin: 'user_request' }),
      makeExecResult({
        reason: 'অবজার্ভেবিলিটি যোগ করুন 🚀',
        target_level: 'senior',
        operations: [
          {
            sort_order: 1,
            op: 'add_topic',
            lineage_id: null,
            topic_id: 'otel-tracing',
            title: 'Observability Deep Dive',
            priority: 'supporting',
            reason: 'Canonical slug reuse',
            payload: { phase_no: 1 },
          },
        ],
        size_impact: {
          active_topics_before: 2,
          active_topics_after: 3,
          materially_large: false,
          warning: null,
        },
      }),
    );
    expect(res).toEqual({ resultType: 'roadmap_merge', resultId: MERGE_ID });
    expect(topicSlugLookups).toEqual([{ slug: 'otel-tracing', level: 'mid' }]);

    // Malformed non-UUID skill_id ('kubernetes') must fail 502 AI_VALIDATION_FAILED (no silent fallback)
    await expect(
      handler.persistArtifact(
        tx as unknown as JobQueryExecutor,
        makeClaimedMergeJob({ origin: 'user_request' }),
        makeExecResult({
          reason: 'Malformed skill_id test',
          target_level: null,
          operations: [
            {
              sort_order: 1,
              op: 'add_topic',
              lineage_id: null,
              topic_id: 'k8s-pods',
              title: 'Kubernetes Pods',
              priority: 'supporting',
              reason: 'Bad skill id',
              payload: { skill_id: 'kubernetes', phase_no: 1 },
            },
          ],
          size_impact: {
            active_topics_before: 2,
            active_topics_after: 3,
            materially_large: false,
            warning: null,
          },
        }),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });
  });

  it('rejects NUL characters and unpaired surrogates in nested payloads before any DB write', async () => {
    const querySpy = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.users')) return [{ status: 'active' }];
      return [];
    });
    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    for (const badPayload of [
      { nested: { note: 'bad\u0000nul' } },
      { nested: { note: 'lone\uD800surrogate' } },
      { ['bad\u0000key']: 'ok' },
    ]) {
      await expect(
        handler.persistArtifact(
          { query: querySpy } as unknown as JobQueryExecutor,
          makeClaimedMergeJob(),
          makeExecResult({
            reason: 'Control char test',
            target_level: null,
            operations: [
              {
                sort_order: 1,
                op: 'reprioritize',
                lineage_id: LINEAGE_A,
                topic_id: null,
                title: null,
                priority: 'core',
                reason: 'Check payload validation',
                payload: badPayload,
              },
            ],
            size_impact: {
              active_topics_before: 2,
              active_topics_after: 2,
              materially_large: false,
              warning: null,
            },
          }),
        ),
      ).rejects.toSatisfy((err: unknown) => {
        expectContractError(err, 502, 'AI_VALIDATION_FAILED');
        return true;
      });
    }
    expect(
      querySpy.mock.calls.some((c) =>
        String(c[0]).includes('INSERT INTO public.roadmap_merges'),
      ),
    ).toBe(false);
  });

  it('reserves instruction-relevant approved skills when trimming oversized context envelopes', async () => {
    const K8S_SKILL_ID = '88888888-8888-4888-8888-888888888899';
    const fillerSkills = Array.from({ length: 450 }, (_, idx) => ({
      id: `99990000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
      slug: `generic-skill-${idx}-${'x'.repeat(80)}`,
      canonical_name: `Generic Skill ${idx} ${'Name'.repeat(20)}`,
    }));

    const dbQuery = vi.fn(async (sql: string) => {
      if (sql.includes('effective_feature_access')) return [{ enabled: true }];
      if (sql.includes('FROM public.roadmaps') && !sql.includes('JOIN')) {
        return [
          {
            id: ROADMAP_ID,
            status: 'locked',
            current_version_id: VERSION_ID,
            target_level: 'mid',
          },
        ];
      }
      if (sql.includes('FROM public.roadmap_versions')) {
        return [{ id: VERSION_ID, version_no: 2 }];
      }
      if (sql.includes('FROM public.roadmap_merges')) return [];
      if (sql.includes('FROM public.system_configurations')) {
        return [{ config_value: 45 }];
      }
      if (sql.includes('JOIN public.career_roles')) {
        return [
          {
            id: ROADMAP_ID,
            canonical_role_id: ROLE_ID,
            role_name: 'Backend Development',
            target_level: 'mid',
            current_version_id: VERSION_ID,
          },
        ];
      }
      if (sql.includes('FROM public.roadmap_items')) {
        return makeBaseItems().slice(0, 2);
      }
      if (sql.includes('FROM public.skills')) {
        return [
          { id: SKILL_ID, slug: 'sql', canonical_name: 'SQL' },
          {
            id: K8S_SKILL_ID,
            slug: 'kubernetes',
            canonical_name: 'Kubernetes',
          },
          ...fillerSkills,
        ];
      }
      return [];
    });

    const aiGateway = {
      execute: vi.fn().mockResolvedValue({
        request_id: JOB_ID,
        generation_id: AI_GEN_ID,
        status: 'ok',
        output: {
          reason: 'Adds Kubernetes',
          target_level: null,
          operations: [
            {
              sort_order: 1,
              op: 'reprioritize',
              lineage_id: LINEAGE_A,
              topic_id: null,
              title: null,
              priority: 'core',
              reason: 'Ok',
              payload: {},
            },
          ],
          size_impact: {
            active_topics_before: 2,
            active_topics_after: 2,
            materially_large: false,
            warning: null,
          },
        },
        provider_id: 'synthetic',
        model_id: 'model-1',
        prompt_version_id: 'prompt-1',
        fallback_used: false,
        usage_units: { input: 100, output: 50 },
        cost: 0,
        latency_ms: 40,
        sources: [],
        validation_status: 'passed',
      }),
    } as unknown as AiGatewayService;

    const handler = new MergeProposalJobHandler(
      {
        transaction: vi.fn(async (_u, fn) => fn({ query: dbQuery })),
      } as unknown as DatabaseService,
      aiGateway,
    );

    await handler.execute(
      makeClaimedMergeJob({
        origin: 'user_request',
        instruction: 'Please add Kubernetes container orchestration basics',
      }),
      new AbortController().signal,
    );

    const sentContext = vi.mocked(aiGateway.execute).mock.calls[0][0]
      .context as { approved_skills: Array<{ id: string; slug: string }> };
    const sentSkillIds = sentContext.approved_skills.map((s) => s.id);
    expect(sentSkillIds).toContain(SKILL_ID);
    expect(sentSkillIds).toContain(K8S_SKILL_ID);
    expect(sentSkillIds.length).toBeLessThan(fillerSkills.length);
  });

  it('normalizes existing-item depends_on_lineage_ids and drops pre-existing retired base dependencies during simulation', async () => {
    const insertedItemParams: unknown[][] = [];
    const baseItemsWithRetiredDep = makeBaseItems().map((item, idx) =>
      idx === 1
        ? {
            ...item,
            depends_on_lineage_ids: [LINEAGE_A, LINEAGE_RETIRED],
          }
        : item,
    );

    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (
          sql.includes('FROM public.roadmap_merges') &&
          sql.includes('SELECT')
        ) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_items')) {
          return baseItemsWithRetiredDep;
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          return [[{ id: MERGE_ID }], 1];
        }
        if (sql.includes('INSERT INTO public.roadmap_merge_items')) {
          insertedItemParams.push(params ?? []);
          return [];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    const output: MergeProposalOutput = {
      reason:
        'Updates dependency casing while base item references retired lineage',
      target_level: null,
      operations: [
        {
          sort_order: 1,
          op: 'update_topic',
          lineage_id: LINEAGE_B,
          topic_id: null,
          title: 'Query Tuning',
          priority: 'core',
          reason: 'Normalize deps',
          payload: {
            depends_on_lineage_ids: [
              ` ${LINEAGE_A.toUpperCase()} `,
              LINEAGE_RETIRED.toUpperCase(),
            ],
          },
        },
      ],
      size_impact: {
        active_topics_before: 2,
        active_topics_after: 2,
        materially_large: false,
        warning: null,
      },
    };

    await expect(
      handler.persistArtifact(
        tx as unknown as JobQueryExecutor,
        makeClaimedMergeJob(),
        makeExecResult(output),
      ),
    ).resolves.toEqual({ resultType: 'roadmap_merge', resultId: MERGE_ID });

    expect(insertedItemParams).toHaveLength(1);
    const savedPayload = JSON.parse(String(insertedItemParams[0][9])) as {
      depends_on_lineage_ids?: string[];
    };
    expect(savedPayload.depends_on_lineage_ids).toEqual([
      LINEAGE_A,
      LINEAGE_RETIRED,
    ]);
  });

  it('preserves referenced canonical topic skill_id during level conversion and pins ai_proposal additions to locked roadmap level', async () => {
    const REFERENCED_SKILL_ID = '88888888-8888-4888-8888-888888888877';
    const REFERENCED_TOPIC_UUID = 'bbbb7777-7777-4777-8777-777777777777';
    const checkedSkills: unknown[] = [];
    const insertedTopicParams: unknown[][] = [];

    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (
          sql.includes('FROM public.roadmap_merges') &&
          sql.includes('SELECT')
        ) {
          return [];
        }
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (sql.includes('FROM public.topics') && sql.includes('WHERE id =')) {
          return [
            {
              id: REFERENCED_TOPIC_UUID,
              skill_id: REFERENCED_SKILL_ID,
              title: 'Distributed Caching',
              career_level: 'mid',
            },
          ];
        }
        if (sql.includes('FROM public.skills')) {
          checkedSkills.push(params?.[0]);
          return [{ id: params?.[0] }];
        }
        if (sql.includes('FROM public.topics') && sql.includes('slug =')) {
          return [];
        }
        if (sql.includes('INSERT INTO public.topics')) {
          insertedTopicParams.push(params ?? []);
          return [[{ id: TOPIC_NEW }], 1];
        }
        if (sql.includes('FROM public.system_configurations')) {
          return [{ config_value: 45 }];
        }
        if (sql.includes('FROM public.daily_plans')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          return [[{ id: MERGE_ID }], 1];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    // 1. level_change ('senior') referencing a 'mid' canonical topic UUID with omitted payload.skill_id
    //    retains REFERENCED_SKILL_ID instead of falling back to SKILL_ID
    await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({ origin: 'level_change', target_level: 'senior' }),
      makeExecResult({
        reason: 'Level conversion preserves referenced topic skill_id',
        target_level: 'senior',
        operations: [
          {
            sort_order: 1,
            op: 'add_topic',
            lineage_id: null,
            topic_id: REFERENCED_TOPIC_UUID,
            title: 'Distributed Caching',
            priority: 'core',
            reason: 'Senior caching depth',
            payload: { phase_no: 2 },
          },
        ],
        size_impact: {
          active_topics_before: 2,
          active_topics_after: 3,
          materially_large: false,
          warning: null,
        },
      }),
    );
    expect(checkedSkills).toEqual([REFERENCED_SKILL_ID]);
    expect(insertedTopicParams[0]?.[0]).toBe(REFERENCED_SKILL_ID);
    expect(insertedTopicParams[0]?.[3]).toBe('senior');

    // 2. ai_proposal emitting target_level: 'senior' on a 'mid' roadmap still resolves at 'mid'
    insertedTopicParams.length = 0;
    await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob({ origin: 'ai_proposal' }),
      makeExecResult({
        reason: 'Tech update proposal',
        target_level: 'senior',
        operations: [
          {
            sort_order: 1,
            op: 'add_topic',
            lineage_id: null,
            topic_id: 'pg-17-tuning',
            title: 'PostgreSQL 17 Tuning',
            priority: 'supporting',
            reason: 'New LTS features',
            payload: { phase_no: 1 },
          },
        ],
        size_impact: {
          active_topics_before: 2,
          active_topics_after: 3,
          materially_large: false,
          warning: null,
        },
      }),
    );
    expect(insertedTopicParams[0]?.[3]).toBe('mid');
  });

  it('strips reprioritize depends_on_lineage_ids, excludes earliest incomplete day from preview, rejects unapproved fast-path skills, and truncates surrogate-pair titles safely', async () => {
    const insertedItemPayloads: unknown[] = [];
    const insertedMergeImpacts: unknown[] = [];
    const tx = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (sql.includes('FROM public.roadmap_merges')) return [];
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (sql.includes('FROM public.system_configurations')) return [];
        if (sql.includes('FROM public.daily_plans')) {
          return [{ id: 'dp-1', hours_per_day: 2 }];
        }
        if (sql.includes('FROM public.daily_plan_items')) {
          return [
            { id: 'dpi-1', day_no: 1, status: 'completed' },
            { id: 'dpi-2', day_no: 2, status: 'pending' }, // earliest incomplete -> excluded
            { id: 'dpi-3', day_no: 3, status: 'pending' }, // future mutable -> counted
          ];
        }
        if (sql.includes('FROM public.quiz_attempts')) return [];
        if (sql.includes('FROM public.ai_requests')) return [];
        if (sql.includes('INSERT INTO public.roadmap_merges')) {
          insertedMergeImpacts.push(JSON.parse(String(params?.[10] ?? '{}')));
          return [[{ id: MERGE_ID }], 1];
        }
        if (sql.includes('INSERT INTO public.roadmap_merge_items')) {
          insertedItemPayloads.push(JSON.parse(String(params?.[9] ?? '{}')));
          return [];
        }
        return [];
      }),
    };

    const handler = new MergeProposalJobHandler(
      {} as DatabaseService,
      {} as AiGatewayService,
    );

    // 1. reprioritize with cyclic depends_on_lineage_ids is ignored/stripped (matching Accept),
    //    and daily_plan_impact excludes earliest incomplete day (Day 2) so future_days_affected = 1.
    const emojiTitle = `${'A'.repeat(239)}🚀tail`;
    await handler.persistArtifact(
      tx as unknown as JobQueryExecutor,
      makeClaimedMergeJob(),
      makeExecResult({
        reason: 'Reprioritize only',
        target_level: null,
        operations: [
          {
            sort_order: 1,
            op: 'reprioritize',
            lineage_id: LINEAGE_A,
            topic_id: null,
            title: emojiTitle,
            priority: 'core',
            reason: 'Promote priority',
            payload: { depends_on_lineage_ids: [LINEAGE_B] },
          },
        ],
        size_impact: {
          active_topics_before: 2,
          active_topics_after: 2,
          materially_large: false,
          warning: null,
        },
      }),
    );
    expect(insertedItemPayloads[0]).toEqual({});
    expect(insertedMergeImpacts[0]).toEqual({
      has_active_plan: true,
      completed_days_unchanged: 1,
      future_days_affected: 1,
    });

    // 2. Fast-path UUID topic with unapproved skill fails 502 AI_VALIDATION_FAILED
    const UNAPPROVED_TOPIC = '77777777-7777-4777-8777-777777777799';
    const txUnapproved = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM public.users')) return [{ status: 'active' }];
        if (sql.includes('FROM public.roadmaps')) {
          return [
            {
              id: ROADMAP_ID,
              status: 'locked',
              target_level: 'mid',
              current_version_id: VERSION_ID,
            },
          ];
        }
        if (sql.includes('FROM public.roadmap_versions')) {
          return [{ id: VERSION_ID, version_no: 2 }];
        }
        if (sql.includes('FROM public.roadmap_merges')) return [];
        if (sql.includes('FROM public.roadmap_items')) return makeBaseItems();
        if (
          sql.includes('FROM public.topics') &&
          sql.includes('WHERE id = $1')
        ) {
          return [
            {
              id: UNAPPROVED_TOPIC,
              skill_id: '88888888-8888-4888-8888-888888888899',
              title: 'Hidden Topic',
              career_level: 'mid',
            },
          ];
        }
        if (sql.includes('FROM public.skills')) return [];
        return [];
      }),
    };
    await expect(
      handler.persistArtifact(
        txUnapproved as unknown as JobQueryExecutor,
        makeClaimedMergeJob(),
        makeExecResult({
          reason: 'Try unapproved skill topic',
          target_level: null,
          operations: [
            {
              sort_order: 1,
              op: 'add_topic',
              lineage_id: null,
              topic_id: UNAPPROVED_TOPIC,
              title: 'Hidden Topic',
              priority: 'supporting',
              reason: 'Should reject',
              payload: {},
            },
          ],
          size_impact: {
            active_topics_before: 2,
            active_topics_after: 3,
            materially_large: false,
            warning: null,
          },
        }),
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });
  });
});
