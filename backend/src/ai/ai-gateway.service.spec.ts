import 'reflect-metadata';
import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { AiModule } from './ai.module.js';
import { AI_TASKS, type AIRequestDTO, type AiModelRecord } from './ai.types.js';
import { AiGatewayService } from './services/ai-gateway.service.js';
import { CircuitBreakerService } from './services/circuit-breaker.service.js';
import { ContextBuilderService } from './services/context-builder.service.js';
import { ModelRouterService } from './services/model-router.service.js';
import { OutputValidatorService } from './services/output-validator.service.js';
import {
  computeTemplateHash,
  getBuiltInPromptTemplates,
  PromptManagerService,
} from './services/prompt-manager.service.js';
import { SyntheticProviderAdapter } from './services/provider.adapter.js';
import { QuotaGuardService } from './services/quota-guard.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const PROMPT_ID = '33333333-3333-4333-8333-333333333333';
const GENERATION_ID = '44444444-4444-4444-8444-444444444444';

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

const APPROVED_MODEL: AiModelRecord = {
  id: MODEL_ID,
  provider_key: 'google-gemini',
  model_identifier: 'gemini-2.5-flash',
  display_name: 'Gemini 2.5 Flash',
  input_price_per_m_units: 0.15,
  output_price_per_m_units: 0.6,
  approved_tasks: [...AI_TASKS],
  real_user_data_approved: true,
  fallback_rank: 1,
  is_active: true,
};

describe('AiGatewayService & QuotaGuardService (Internal AI Gateway, 9 Tasks, Validation & R26 Quotas)', () => {
  let queryMock: ReturnType<typeof vi.fn>;
  let transactionMock: ReturnType<typeof vi.fn>;
  let databaseMock: DatabaseService;
  let configMock: ConfigService;
  let circuitBreaker: CircuitBreakerService;
  let modelRouter: ModelRouterService;
  let promptManager: PromptManagerService;
  let contextBuilder: ContextBuilderService;
  let outputValidator: OutputValidatorService;
  let quotaGuard: QuotaGuardService;
  let syntheticAdapter: SyntheticProviderAdapter;
  let gateway: AiGatewayService;

  let systemConfigMap: Record<string, unknown>;
  let usedQuotaCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    systemConfigMap = {
      'ai_quota.roadmap_drafts_per_24h': 5,
      'ai_quota.mentor_messages_per_24h': 50,
    };
    usedQuotaCount = 0;

    const templates = new Map(
      getBuiltInPromptTemplates().map((t) => [t.task, t]),
    );

    queryMock = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.system_configurations')) {
        const key = String(params?.[0]);
        return key in systemConfigMap
          ? [{ config_value: systemConfigMap[key] }]
          : [];
      }
      if (
        sql.includes('AS used_count') &&
        sql.includes('FROM public.ai_requests')
      ) {
        return [{ used_count: usedQuotaCount }];
      }
      if (sql.includes('FROM public.prompt_versions')) {
        const task = String(params?.[0]) as (typeof AI_TASKS)[number];
        const tpl = templates.get(task);
        if (!tpl) return [];
        return [
          {
            id: PROMPT_ID,
            task: tpl.task,
            name: tpl.ref,
            version: 1,
            template_ref: tpl.ref,
            template_hash: computeTemplateHash(tpl.template),
            output_schema_id: tpl.outputSchemaId,
            is_active: true,
          },
        ];
      }
      if (sql.includes('FROM public.ai_models')) {
        return [APPROVED_MODEL];
      }
      if (sql.includes('INSERT INTO public.ai_generations')) {
        return [{ id: GENERATION_ID }];
      }
      return [];
    });

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
      get: vi.fn((key: string) => {
        if (key === 'AI_QUOTA_CACHE_TTL_MS') return '5000';
        if (key === 'AI_EXECUTION_MODE') return 'real_user';
        return undefined;
      }),
    } as unknown as ConfigService;

    circuitBreaker = new CircuitBreakerService();
    modelRouter = new ModelRouterService(
      databaseMock,
      circuitBreaker,
      configMock,
    );
    promptManager = new PromptManagerService(databaseMock);
    contextBuilder = new ContextBuilderService();
    outputValidator = new OutputValidatorService();
    quotaGuard = new QuotaGuardService(databaseMock, configMock);
    syntheticAdapter = new SyntheticProviderAdapter();
    gateway = new AiGatewayService(
      quotaGuard,
      promptManager,
      contextBuilder,
      modelRouter,
      circuitBreaker,
      outputValidator,
      syntheticAdapter,
    );
  });

  afterEach(() => {
    syntheticAdapter.clearModelRules();
    circuitBreaker.reset();
    quotaGuard.invalidateCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('declares zero HTTP controllers on AiModule (100% internal boundary)', () => {
    const controllers = Reflect.getMetadata('controllers', AiModule) as
      unknown[] | undefined;
    expect(controllers ?? []).toEqual([]);
  });

  it('executes all 9 public.ai_task workflows deterministically offline and records content-free ai_generations telemetry', async () => {
    const schemaByTask = new Map(
      getBuiltInPromptTemplates().map((t) => [t.task, t.outputSchemaId]),
    );

    for (const task of AI_TASKS) {
      const request: AIRequestDTO = {
        task,
        user_id: USER_ID,
        context: { target: 'backend-development', level: 'junior' },
        untrusted_inputs: ['Build REST APIs and SQL skills'],
        output_schema: schemaByTask.get(task)!,
        language: 'mixed',
        idempotency_key: `idem-${task}`,
        budget: {
          max_input_units: 4_000,
          max_output_units: 2_000,
          timeout_ms: 10_000,
        },
      };

      const res = await gateway.execute(request);
      expect(res.status).toBe('ok');
      expect(res.validation_status).toBe('passed');
      expect(res.generation_id).toBe(GENERATION_ID);
      expect(res.provider_id).toBe('google-gemini');
      expect(res.model_id).toBe(MODEL_ID);
      expect(res.output).not.toBeNull();
    }

    const genInsert = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO public.ai_generations'),
    );
    expect(genInsert).toBeDefined();
    expect(String(genInsert?.[0])).toContain('output_hash');
    expect(String(genInsert?.[0])).not.toContain('total_units');
    expect(String(genInsert?.[0])).not.toContain('cost_usd');
  });

  it('rejects tasks outside the 9-task allowlist and oversized input budgets', async () => {
    await expect(
      gateway.execute({
        task: 'arbitrary_admin_prompt',
        user_id: USER_ID,
        context: {},
        output_schema: 'unknown.v1',
        language: 'en',
        idempotency_key: 'idem-bad-task',
        budget: {
          max_input_units: 1000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'INVALID_ENUM_VALUE');
      return true;
    });

    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: { large: 'x'.repeat(2_000) },
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-budget-over',
        budget: {
          max_input_units: 20,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 422, 'VALIDATION_FAILED');
      return true;
    });
  });

  it('discards invalid schema outputs, roadmap DAG cycles, and Job Ready guarantees with 502 AI_VALIDATION_FAILED', async () => {
    syntheticAdapter.setModelRule(MODEL_ID, 'invalid_schema');
    await expect(
      gateway.execute({
        task: 'goal_interpretation',
        user_id: USER_ID,
        context: { goal: 'Backend' },
        output_schema: 'goal_interpretation.v1',
        language: 'en',
        idempotency_key: 'idem-invalid',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });

    // Roadmap DAG cycle check
    syntheticAdapter.setModelRule(MODEL_ID, async () => ({
      inputUnits: 100,
      outputUnits: 100,
      latencyMs: 10,
      output: {
        targetLevel: 'junior',
        summary: {
          current_situation: 'Start',
          target_interpretation: 'Backend',
          expected_career_impact: 'Growth',
          next_steps: ['Step 1'],
        },
        phases: [
          {
            phase_no: 1,
            title: 'P1',
            milestones: [],
            items: [
              {
                lineage_id: 'node-a',
                topic_id: USER_ID,
                skill_id: USER_ID,
                title: 'A',
                priority: 'core',
                gap_type: 'missing',
                required_depth: 'basic',
                estimated_effort_hours: 2,
                sequence_no: 1,
                depends_on_lineage_ids: ['node-b'],
                reason: 'Needed',
                sources: [{ publisher: 'Docs', url: 'https://example.com' }],
              },
              {
                lineage_id: 'node-b',
                topic_id: MODEL_ID,
                skill_id: MODEL_ID,
                title: 'B',
                priority: 'core',
                gap_type: 'missing',
                required_depth: 'basic',
                estimated_effort_hours: 2,
                sequence_no: 2,
                depends_on_lineage_ids: ['node-a'],
                reason: 'Cycle',
                sources: [{ publisher: 'Docs', url: 'https://example.com' }],
              },
            ],
          },
        ],
        level_outline: [],
        warnings: [],
        size_guardrail: {
          active_topic_count: 2,
          materially_large: false,
          warning: null,
        },
      },
    }));

    await expect(
      gateway.execute({
        task: 'roadmap_generate',
        user_id: USER_ID,
        context: {},
        output_schema: 'roadmap.v1',
        language: 'en',
        idempotency_key: 'idem-cycle',
        budget: {
          max_input_units: 2000,
          max_output_units: 1000,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });

    // Mentor chat "Job Ready" guarantee check
    syntheticAdapter.setModelRule(MODEL_ID, async () => ({
      inputUnits: 50,
      outputUnits: 30,
      latencyMs: 10,
      output: {
        content: 'Complete this and you are Job Ready with a guaranteed job!',
        language: 'en',
        safety_mode: false,
        learning_claim_recorded: false,
      },
    }));

    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-guarantee',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });
  });

  it('enforces R26 quota bounds (1..10000, <=5s cache TTL, safe default on invalid config) and throws 503 AI_BUDGET_EXHAUSTED', async () => {
    vi.useFakeTimers();

    // Invalid string/null/float/out-of-range values fall back to safe default 5
    for (const invalidVal of ['10', null, 5.5, 0, 10_001, true]) {
      quotaGuard.invalidateCache();
      systemConfigMap['ai_quota.roadmap_drafts_per_24h'] = invalidVal;
      await expect(
        quotaGuard.getBoundedConfigInteger('ai_quota.roadmap_drafts_per_24h'),
      ).resolves.toBe(5);
    }

    // Valid integer within 1..10000 is cached for <= 5s
    quotaGuard.invalidateCache();
    systemConfigMap['ai_quota.roadmap_drafts_per_24h'] = 3;
    await expect(
      quotaGuard.getBoundedConfigInteger('ai_quota.roadmap_drafts_per_24h'),
    ).resolves.toBe(3);

    systemConfigMap['ai_quota.roadmap_drafts_per_24h'] = 7;
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(
      quotaGuard.getBoundedConfigInteger('ai_quota.roadmap_drafts_per_24h'),
    ).resolves.toBe(3);

    await vi.advanceTimersByTimeAsync(1_500);
    await expect(
      quotaGuard.getBoundedConfigInteger('ai_quota.roadmap_drafts_per_24h'),
    ).resolves.toBe(7);

    // Exhausted quota throws 503 AI_BUDGET_EXHAUSTED
    usedQuotaCount = 7;
    await expect(
      gateway.execute({
        task: 'roadmap_generate',
        user_id: USER_ID,
        context: {},
        output_schema: 'roadmap.v1',
        language: 'en',
        idempotency_key: 'idem-quota-hit',
        budget: {
          max_input_units: 2000,
          max_output_units: 1000,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'AI_BUDGET_EXHAUSTED');
      return true;
    });
  });

  it('never logs raw prompts, untrusted inputs, or completions', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log');
    const warnSpy = vi.spyOn(Logger.prototype, 'warn');
    const errorSpy = vi.spyOn(Logger.prototype, 'error');

    await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: { note: 'SENTINEL_PRIVATE_CONTEXT_999' },
      untrusted_inputs: ['SENTINEL_USER_PROMPT_888'],
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-no-log',
      budget: {
        max_input_units: 2000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });

    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('SENTINEL_PRIVATE_CONTEXT_999');
        expect(serialized).not.toContain('SENTINEL_USER_PROMPT_888');
      }
    }
  });

  it('persists nullable request_id as null in recordGenerationTelemetry when omitted or non-UUID on both passed and failed validation paths', async () => {
    const telemetrySpy = vi.spyOn(quotaGuard, 'recordGenerationTelemetry');

    // 1. Omitted request_id on validation-pass path -> requestId: null
    await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-null-req-pass',
      budget: {
        max_input_units: 2000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });

    // 2. Non-UUID request_id on validation-pass path -> requestId: null (never forwards invalid UUID to Postgres)
    await gateway.execute({
      request_id: 'not-a-valid-uuid',
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-bad-req-pass',
      budget: {
        max_input_units: 2000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });

    // 3. Non-UUID request_id on validation-fail path -> requestId: null with validationStatus: 'failed'
    syntheticAdapter.setModelRule(MODEL_ID, 'invalid_schema');
    await expect(
      gateway.execute({
        request_id: '  also-invalid  ',
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-bad-req-fail',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 502, 'AI_VALIDATION_FAILED');
      return true;
    });

    // 4. Valid whitespace-padded UUID request_id -> trimmed UUID bound cleanly
    syntheticAdapter.setModelRule(MODEL_ID, 'ok');
    const validRequestId = '77777777-7777-4777-8777-777777777777';
    await gateway.execute({
      request_id: `  ${validRequestId}  `,
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-valid-req-pass',
      budget: {
        max_input_units: 2000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });

    expect(telemetrySpy).toHaveBeenCalledTimes(4);
    const telemetryArgs = telemetrySpy.mock.calls.map(([arg]) => ({
      requestId: arg.requestId,
      validationStatus: arg.validationStatus,
    }));
    expect(telemetryArgs).toEqual([
      { requestId: null, validationStatus: 'passed' },
      { requestId: null, validationStatus: 'passed' },
      { requestId: null, validationStatus: 'failed' },
      { requestId: validRequestId, validationStatus: 'passed' },
    ]);

    const insertBindings = queryMock.mock.calls
      .filter(([sql]) =>
        String(sql).includes('INSERT INTO public.ai_generations'),
      )
      .map(([, params]) => ({
        requestId: (params as unknown[])[0],
        validationStatus: (params as unknown[])[6],
      }));
    expect(insertBindings).toEqual([
      { requestId: null, validationStatus: 'passed' },
      { requestId: null, validationStatus: 'passed' },
      { requestId: null, validationStatus: 'failed' },
      { requestId: validRequestId, validationStatus: 'passed' },
    ]);
  });
});
