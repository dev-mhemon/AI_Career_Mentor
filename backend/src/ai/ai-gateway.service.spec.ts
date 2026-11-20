import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../auth/services/database.service.js';
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
import {
  AI_PROVIDER_ADAPTER,
  ProviderInvocationError,
  SyntheticProviderAdapter,
  type ProviderAdapter,
} from './services/provider.adapter.js';
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
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        return [[{ id: String(params?.[0] ?? '') }], 1];
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
          max_output_units: 4_000,
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

    // Roadmap DAG cycle check (valid UUIDs, including mixed-case equivalence)
    const NODE_A_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    const NODE_B_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
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
                lineage_id: NODE_A_UUID,
                topic_id: USER_ID,
                skill_id: USER_ID,
                title: 'A',
                priority: 'core',
                gap_type: 'missing',
                required_depth: 'basic',
                estimated_effort_hours: 2,
                sequence_no: 1,
                depends_on_lineage_ids: [NODE_B_UUID.toUpperCase()],
                reason: 'Needed',
                sources: [{ publisher: 'Docs', url: 'https://example.com' }],
              },
              {
                lineage_id: NODE_B_UUID,
                topic_id: MODEL_ID,
                skill_id: MODEL_ID,
                title: 'B',
                priority: 'core',
                gap_type: 'missing',
                required_depth: 'basic',
                estimated_effort_hours: 2,
                sequence_no: 2,
                depends_on_lineage_ids: [NODE_A_UUID.toUpperCase()],
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

    // 4. Valid whitespace-padded UUID request_id referencing an active preparing row -> trimmed UUID bound cleanly
    syntheticAdapter.setModelRule(MODEL_ID, 'ok');
    const validRequestId = '77777777-7777-4777-8777-777777777777';
    const baseImpl = queryMock.getMockImplementation() as (
      sql: string,
      params?: unknown[],
    ) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('SELECT id') &&
        sql.includes('FROM public.ai_requests') &&
        sql.includes("status = 'preparing'") &&
        params?.[0] === validRequestId
      ) {
        return [{ id: validRequestId }];
      }
      return baseImpl(sql, params);
    });
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

  it('binds AI_PROVIDER_ADAPTER fail-closed in real_user mode and only enables SyntheticProviderAdapter in synthetic mode', async () => {
    const mockDataSource = {
      query: queryMock,
      transaction: transactionMock,
    };

    const realUserModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              SUPABASE_URL: 'https://test.supabase.co',
              AI_EXECUTION_MODE: 'real_user',
            }),
          ],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        AiModule,
      ],
    })
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .overrideProvider(DatabaseService)
      .useValue(databaseMock)
      .compile();

    const realAdapter =
      realUserModule.get<ProviderAdapter>(AI_PROVIDER_ADAPTER);
    await expect(
      realAdapter.invoke({
        requestId: USER_ID,
        model: APPROVED_MODEL,
        task: 'mentor_chat',
        language: 'en',
        systemPrompt: 'sys',
        userEnvelope: 'env',
        outputSchemaId: 'mentor_chat.v1',
        maxOutputUnits: 100,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(ProviderInvocationError);
    await realUserModule.close();

    const syntheticModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              SUPABASE_URL: 'https://test.supabase.co',
              AI_EXECUTION_MODE: 'synthetic',
            }),
          ],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        AiModule,
      ],
    })
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .overrideProvider(DatabaseService)
      .useValue(databaseMock)
      .compile();

    const synthAdapter =
      syntheticModule.get<ProviderAdapter>(AI_PROVIDER_ADAPTER);
    const synthResult = await synthAdapter.invoke({
      requestId: USER_ID,
      model: APPROVED_MODEL,
      task: 'mentor_chat',
      language: 'en',
      systemPrompt: 'sys',
      userEnvelope: 'env',
      outputSchemaId: 'mentor_chat.v1',
      maxOutputUnits: 100,
      timeoutMs: 1000,
      mode: 'synthetic',
    });
    expect(synthResult.output).toBeDefined();
    await expect(
      synthAdapter.invoke({
        requestId: USER_ID,
        model: APPROVED_MODEL,
        task: 'mentor_chat',
        language: 'en',
        systemPrompt: 'sys',
        userEnvelope: 'env',
        outputSchemaId: 'mentor_chat.v1',
        maxOutputUnits: 100,
        timeoutMs: 1000,
        mode: 'real_user',
      }),
    ).rejects.toBeInstanceOf(ProviderInvocationError);
    await syntheticModule.close();
  }, 15_000);

  it('serializes mentor_chat quota admission with advisory lock + reservation row and marks failed reservations failed', async () => {
    const reservationId = '88888888-8888-4888-8888-888888888888';
    const baseImpl = queryMock.getMockImplementation() as (
      sql: string,
      params?: unknown[],
    ) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: reservationId }];
      }
      return baseImpl(sql, params);
    });

    syntheticAdapter.setModelRule(MODEL_ID, 'provider_error');
    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-quota-fail-release',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 502, 'AI_SERVICE_ERROR');
      return true;
    });

    const lockCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('pg_advisory_xact_lock'),
    );
    const reserveInsert = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO public.ai_requests'),
    );
    const failRelease = queryMock.mock.calls.find(
      ([sql]) =>
        String(sql).includes('UPDATE public.ai_requests') &&
        String(sql).includes("SET status = 'failed'"),
    );
    expect(lockCall).toBeDefined();
    expect(reserveInsert).toBeDefined();
    expect(failRelease).toBeDefined();
    expect((failRelease?.[1] as unknown[])[0]).toBe(reservationId);
  });

  it('rejects duplicate roadmap lineage_id (including mixed-case UUIDs), invalid non-UUID lineage/deps, and non-scalar array enums while accepting unique UUIDs', () => {
    const LINEAGE_UUID_1 = '11111111-1111-4111-8111-111111111111';
    const LINEAGE_UUID_2 = '22222222-2222-4222-8222-222222222222';
    const baseItem = {
      lineage_id: LINEAGE_UUID_1,
      topic_id: USER_ID,
      skill_id: USER_ID,
      title: 'Node',
      priority: 'core',
      gap_type: 'missing',
      required_depth: 'basic',
      estimated_effort_hours: 2,
      sequence_no: 1,
      depends_on_lineage_ids: [] as string[],
      reason: 'Core topic',
      sources: [{ publisher: 'Docs', url: 'https://example.com' }],
    };

    const makeRoadmap = (
      items: unknown[],
      targetLevel: unknown = 'junior',
    ) => ({
      targetLevel,
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
          items,
        },
      ],
      level_outline: [],
      warnings: [],
      size_guardrail: {
        active_topic_count: items.length,
        materially_large: false,
        warning: null,
      },
    });

    // Unique valid UUIDs pass cleanly (isolated baseline proving duplicate check is the sole cause below)
    expect(() =>
      outputValidator.validate(
        'roadmap_generate',
        'roadmap.v1',
        makeRoadmap([
          baseItem,
          {
            ...baseItem,
            lineage_id: LINEAGE_UUID_2,
            sequence_no: 2,
            depends_on_lineage_ids: [LINEAGE_UUID_1.toUpperCase()],
          },
        ]),
      ),
    ).not.toThrow();

    // Isolated duplicate lineage_id (same UUID in uppercase, zero depends_on_lineage_ids) -> rejected
    expect(() =>
      outputValidator.validate(
        'roadmap_generate',
        'roadmap.v1',
        makeRoadmap([
          baseItem,
          {
            ...baseItem,
            lineage_id: LINEAGE_UUID_1.toUpperCase(),
            sequence_no: 2,
            depends_on_lineage_ids: [],
          },
        ]),
      ),
    ).toThrow(HttpException);

    // Non-UUID lineage_id or depends_on_lineage_ids -> rejected
    expect(() =>
      outputValidator.validate(
        'roadmap_generate',
        'roadmap.v1',
        makeRoadmap([{ ...baseItem, lineage_id: 'not-a-uuid' }]),
      ),
    ).toThrow(HttpException);

    expect(() =>
      outputValidator.validate(
        'roadmap_generate',
        'roadmap.v1',
        makeRoadmap([{ ...baseItem, depends_on_lineage_ids: ['not-a-uuid'] }]),
      ),
    ).toThrow(HttpException);

    // Non-scalar array enum -> rejected
    expect(() =>
      outputValidator.validate(
        'roadmap_generate',
        'roadmap.v1',
        makeRoadmap([baseItem], ['junior']),
      ),
    ).toThrow(HttpException);
  });

  it('commits generation telemetry and quota reservation completion in one atomic transaction and rolls back both when completion fails', async () => {
    const reservationId = '99999999-9999-4999-8999-999999999999';
    let commitCount = 0;
    let rollbackCount = 0;
    let currentTxId = 0;
    let telemetryInsertTxId = -1;
    let reservationCompleteTxId = -1;

    const qrManagerQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO public.ai_generations')) {
        telemetryInsertTxId = currentTxId;
        return [{ id: GENERATION_ID }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        reservationCompleteTxId = currentTxId;
        throw new Error('Simulated reservation completion failure');
      }
      return [];
    });

    const realDb = new DatabaseService({
      createQueryRunner: vi.fn(() => {
        currentTxId += 1;
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          startTransaction: vi.fn().mockResolvedValue(undefined),
          commitTransaction: vi.fn(async () => {
            commitCount += 1;
          }),
          rollbackTransaction: vi.fn(async () => {
            rollbackCount += 1;
          }),
          release: vi.fn().mockResolvedValue(undefined),
          manager: { query: qrManagerQuery },
        };
      }),
    } as unknown as DataSource);

    const atomicQuotaGuard = new QuotaGuardService(realDb, configMock);
    await expect(
      atomicQuotaGuard.finalizeGenerationSuccess(
        {
          requestId: null,
          task: 'mentor_chat',
          providerKey: 'google-gemini',
          modelId: MODEL_ID,
          promptVersionId: PROMPT_ID,
          outputSchemaId: 'mentor_chat.v1',
          validationStatus: 'passed',
          fallbackUsed: false,
          language: 'en',
          inputUnits: 10,
          outputUnits: 20,
          latencyMs: 15,
          output: { ok: true },
        },
        reservationId,
      ),
    ).rejects.toThrow('Simulated reservation completion failure');

    // Both writes ran inside the exact same transaction, which rolled back instead of committing
    expect(telemetryInsertTxId).toBe(1);
    expect(reservationCompleteTxId).toBe(1);
    expect(commitCount).toBe(0);
    expect(rollbackCount).toBe(1);
  });

  it('does not allow unpersisted, foreign, or completed request_id to bypass quota, binds telemetry to reservationId, and canonicalizes lock UUIDs', async () => {
    const reservationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const unpersistedCorrelationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const verifiedPreparingRowId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const foreignOwnerRowId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const completedRowId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';

    const persistedRows = [
      {
        id: verifiedPreparingRowId,
        user_id: USER_ID,
        task: 'mentor_chat',
        status: 'preparing',
      },
      {
        id: foreignOwnerRowId,
        user_id: OTHER_USER_ID,
        task: 'mentor_chat',
        status: 'preparing',
      },
      {
        id: completedRowId,
        user_id: USER_ID,
        task: 'mentor_chat',
        status: 'succeeded',
      },
    ];

    const baseImpl = queryMock.getMockImplementation() as (
      sql: string,
      params?: unknown[],
    ) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes('SELECT id') &&
        sql.includes('FROM public.ai_requests') &&
        sql.includes('WHERE id = $1')
      ) {
        // Must restrict exemption strictly to owned active 'preparing' rows for the same task
        expect(sql).toContain('AND user_id = $2');
        expect(sql).toContain('AND task = $3::public.ai_task');
        expect(sql).toContain("AND status = 'preparing'");
        const [candidateId, candidateUser, candidateTask] = (params ?? []) as [
          string,
          string,
          string,
        ];
        const matched = persistedRows.find(
          (r) =>
            r.id === candidateId &&
            r.user_id === candidateUser &&
            r.task === candidateTask &&
            r.status === 'preparing',
        );
        return matched ? [{ id: matched.id }] : [];
      }
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: reservationId }];
      }
      return baseImpl(sql, params);
    });

    // 1. Unpersisted, foreign-owner, and completed UUIDs must NOT bypass quota reservation
    for (const candidateId of [
      unpersistedCorrelationId,
      foreignOwnerRowId,
      completedRowId,
    ]) {
      const res = await quotaGuard.reserveUserQuota(
        USER_ID.toUpperCase(),
        'mentor_chat',
        'en',
        candidateId,
      );
      expect(res).toEqual({
        reservationId,
        telemetryRequestId: reservationId,
      });
    }
    const lockCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('pg_advisory_xact_lock'),
    );
    expect(String(lockCall?.[0])).toContain('($1::uuid)::text');
    expect((lockCall?.[1] as unknown[])[0]).toBe(USER_ID.toLowerCase());

    // End-to-end gateway call with unpersisted request_id binds ai_generations.request_id to reservationId (never the unpersisted UUID)
    queryMock.mockClear();
    await gateway.execute({
      request_id: unpersistedCorrelationId,
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-unpersisted-fk-safe',
      budget: {
        max_input_units: 2000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });
    const genInsert = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO public.ai_generations'),
    );
    expect((genInsert?.[1] as unknown[])[0]).toBe(reservationId);

    // 2. Unpersisted, foreign, or completed UUID at quota limit still rejects with 503 AI_BUDGET_EXHAUSTED
    usedQuotaCount = 50;
    for (const candidateId of [
      unpersistedCorrelationId,
      foreignOwnerRowId,
      completedRowId,
    ]) {
      await expect(
        quotaGuard.reserveUserQuota(USER_ID, 'mentor_chat', 'en', candidateId),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'AI_BUDGET_EXHAUSTED');
        return true;
      });
    }

    // 3. Verified active 'preparing' owned row skips duplicate reservation insert and retains verified telemetryRequestId
    usedQuotaCount = 1;
    queryMock.mockClear();
    const verifiedRes = await quotaGuard.reserveUserQuota(
      USER_ID,
      'mentor_chat',
      'en',
      verifiedPreparingRowId,
    );
    expect(verifiedRes).toEqual({
      reservationId: null,
      telemetryRequestId: verifiedPreparingRowId,
    });
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO public.ai_requests'),
      ),
    ).toBe(false);

    // 4. Unmetered task (goal_interpretation) also verifies existingRequestId before binding telemetryRequestId
    const unmeteredUnpersisted = await quotaGuard.reserveUserQuota(
      USER_ID,
      'goal_interpretation',
      'en',
      unpersistedCorrelationId,
    );
    expect(unmeteredUnpersisted).toEqual({
      reservationId: null,
      telemetryRequestId: null,
    });
    const unmeteredForeign = await quotaGuard.reserveUserQuota(
      USER_ID,
      'goal_interpretation',
      'en',
      foreignOwnerRowId,
    );
    expect(unmeteredForeign).toEqual({
      reservationId: null,
      telemetryRequestId: null,
    });
  });

  it('rolls back telemetry and fails with 503 AI_SERVICE_ERROR when completeQuotaReservation affects 0 rows (e.g. reaped mid-flight)', async () => {
    const reservationId = '99999999-9999-4999-8999-999999999998';
    let commitCount = 0;
    let rollbackCount = 0;

    const qrManagerQuery = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO public.ai_generations')) {
        return [{ id: GENERATION_ID }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'succeeded'")
      ) {
        expect(sql).toContain('RETURNING id');
        return [[], 0];
      }
      return [];
    });

    const realDb = new DatabaseService({
      createQueryRunner: vi.fn(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        startTransaction: vi.fn().mockResolvedValue(undefined),
        commitTransaction: vi.fn(async () => {
          commitCount += 1;
        }),
        rollbackTransaction: vi.fn(async () => {
          rollbackCount += 1;
        }),
        release: vi.fn().mockResolvedValue(undefined),
        manager: { query: qrManagerQuery },
      })),
    } as unknown as DataSource);

    const atomicQuotaGuard = new QuotaGuardService(realDb, configMock);
    await expect(
      atomicQuotaGuard.finalizeGenerationSuccess(
        {
          requestId: reservationId,
          task: 'mentor_chat',
          providerKey: 'google-gemini',
          modelId: MODEL_ID,
          promptVersionId: PROMPT_ID,
          outputSchemaId: 'mentor_chat.v1',
          validationStatus: 'passed',
          fallbackUsed: false,
          language: 'en',
          inputUnits: 10,
          outputUnits: 20,
          latencyMs: 15,
          output: { ok: true },
        },
        reservationId,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'AI_SERVICE_ERROR');
      return true;
    });
    expect(commitCount).toBe(0);
    expect(rollbackCount).toBe(1);
  });

  it('preserves the original request error when failQuotaReservation cleanup throws and enforces SyntheticProviderAdapter max_output_units without tripping circuit breaker', async () => {
    const reservationId = '88888888-8888-4888-8888-888888888889';
    const baseImpl = queryMock.getMockImplementation() as (
      sql: string,
      params?: unknown[],
    ) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: reservationId }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes("SET status = 'failed'")
      ) {
        throw new Error('DB connection dropped during cleanup');
      }
      return baseImpl(sql, params);
    });

    syntheticAdapter.setModelRule(MODEL_ID, 'timeout');
    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-cleanup-failure-preserves-error',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      // Original 504 AI_TIMEOUT must be rethrown rather than masked by cleanup DB error
      expectContractError(err, 504, 'AI_TIMEOUT');
      return true;
    });

    // SyntheticProviderAdapter output exceeding max_output_units throws 503 AI_BUDGET_EXHAUSTED without tripping circuit breaker
    syntheticAdapter.clearModelRules();
    circuitBreaker.reset();
    queryMock.mockImplementation(baseImpl);
    const quizSchemaId = getBuiltInPromptTemplates().find(
      (t) => t.task === 'quiz_generate',
    )!.outputSchemaId;
    for (let i = 0; i < CircuitBreakerService.FAILURE_THRESHOLD + 1; i += 1) {
      await expect(
        gateway.execute({
          task: 'quiz_generate',
          user_id: USER_ID,
          context: {},
          output_schema: quizSchemaId,
          language: 'en',
          idempotency_key: `idem-max-output-over-${i}`,
          budget: {
            max_input_units: 2000,
            max_output_units: 50,
            timeout_ms: 5000,
          },
        }),
      ).rejects.toSatisfy((err) => {
        expectContractError(err, 503, 'AI_BUDGET_EXHAUSTED');
        return true;
      });
    }
    expect(circuitBreaker.getState(MODEL_ID)).toBe('CLOSED');
  });

  it('releases HALF_OPEN canary without recording a model failure when touchQuotaReservation rejects before fallback', async () => {
    vi.useFakeTimers();
    const FALLBACK_MODEL_ID = '55555555-5555-4555-8555-555555555555';
    const RESERVATION_ID = '66666666-6666-4666-8666-666666666666';
    const FALLBACK_MODEL: AiModelRecord = {
      ...APPROVED_MODEL,
      id: FALLBACK_MODEL_ID,
      provider_key: 'openai',
      model_identifier: 'gpt-4o-mini-fallback',
      display_name: 'Fallback Model',
      fallback_rank: 2,
    };

    // Trip fallback model to OPEN and advance 60s into HALF_OPEN
    for (let i = 0; i < CircuitBreakerService.FAILURE_THRESHOLD; i += 1) {
      circuitBreaker.recordFailure(FALLBACK_MODEL_ID);
    }
    expect(circuitBreaker.getState(FALLBACK_MODEL_ID)).toBe('OPEN');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(circuitBreaker.getState(FALLBACK_MODEL_ID)).toBe('HALF_OPEN');

    const baseImpl = queryMock.getMockImplementation() as (
      sql: string,
      params?: unknown[],
    ) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.ai_models')) {
        return [APPROVED_MODEL, FALLBACK_MODEL];
      }
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: RESERVATION_ID }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes('SET locked_at = clock_timestamp()')
      ) {
        throw new Error('Simulated touchQuotaReservation DB failure');
      }
      return baseImpl(sql, params);
    });

    syntheticAdapter.setModelRule(MODEL_ID, 'provider_error');
    const acquireSpy = vi.spyOn(circuitBreaker, 'acquireAttempt');
    const releaseSpy = vi.spyOn(circuitBreaker, 'releaseCanary');
    const failureSpy = vi.spyOn(circuitBreaker, 'recordFailure');

    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-touch-rejects-canary-release',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toThrow('Simulated touchQuotaReservation DB failure');

    // Acquired HALF_OPEN canary token on fallback candidate was released cleanly
    const fallbackAdmissionIdx = acquireSpy.mock.calls.findIndex(
      ([id]) => id === FALLBACK_MODEL_ID,
    );
    expect(fallbackAdmissionIdx).toBeGreaterThanOrEqual(0);
    const acquiredToken = (
      acquireSpy.mock.results[fallbackAdmissionIdx]?.value as {
        canaryToken: string | null;
      }
    )?.canaryToken;
    expect(typeof acquiredToken).toBe('string');
    expect(releaseSpy).toHaveBeenCalledWith(FALLBACK_MODEL_ID, acquiredToken);

    // No model failure recorded for fallback candidate; circuit remains HALF_OPEN and acquirable
    expect(failureSpy.mock.calls.some(([id]) => id === FALLBACK_MODEL_ID)).toBe(
      false,
    );
    expect(circuitBreaker.getState(FALLBACK_MODEL_ID)).toBe('HALF_OPEN');
    const nextAttempt = circuitBreaker.acquireAttempt(FALLBACK_MODEL_ID);
    expect(nextAttempt.allowed).toBe(true);
    expect(typeof nextAttempt.canaryToken).toBe('string');
  });

  it('matches Frontend developer in SyntheticProviderAdapter to Frontend Development plus 2 distinct alternatives (3 roles total)', async () => {
    const res = await gateway.execute<{
      proposedRole: { canonicalRoleId: string; name: string } | null;
      alternativeRoles: Array<{
        canonicalRoleId: string;
        name: string;
        matchReason: string;
      }>;
    }>({
      task: 'goal_interpretation',
      user_id: USER_ID,
      context: {
        clarification_round: 0,
        approved_roles: [
          {
            canonical_role_id: 'aaaa1111-1111-4111-8111-111111111111',
            slug: 'frontend-development',
            name: 'Frontend Development',
          },
          {
            canonical_role_id: 'bbbb2222-2222-4222-8222-222222222222',
            slug: 'full-stack-development',
            name: 'Full-Stack Development',
          },
          {
            canonical_role_id: 'cccc3333-3333-4333-8333-333333333333',
            slug: 'mobile-development',
            name: 'Mobile Development',
          },
        ],
      },
      untrusted_inputs: ['Frontend developer'],
      output_schema: 'goal_interpretation.v1',
      language: 'en',
      idempotency_key: 'idem-synthetic-frontend-3-roles',
      budget: {
        max_input_units: 2000,
        max_output_units: 1000,
        timeout_ms: 5000,
      },
    });

    expect(res.output?.proposedRole).toEqual({
      canonicalRoleId: 'aaaa1111-1111-4111-8111-111111111111',
      name: 'Frontend Development',
    });
    expect(res.output?.alternativeRoles).toHaveLength(2);
    const allNames = [
      res.output?.proposedRole?.name,
      ...(res.output?.alternativeRoles ?? []).map((r) => r.name),
    ];
    expect(new Set(allNames).size).toBe(3);
    expect(res.output?.alternativeRoles.map((r) => r.name)).toEqual([
      'Full-Stack Development',
      'Mobile Development',
    ]);
  });

  it('matches Data analyst using the exact CareerGoalService createGoal payload shape to 3 distinct seeded roles with Data Engineering first', async () => {
    const res = await gateway.execute<{
      proposedRole: { canonicalRoleId: string; name: string } | null;
      alternativeRoles: Array<{
        canonicalRoleId: string;
        name: string;
        matchReason: string;
      }>;
    }>({
      task: 'goal_interpretation',
      user_id: USER_ID,
      feature_key: 'roadmap_generator',
      context: {
        clarification_round: 0,
        approved_roles: [
          {
            canonical_role_id: '10000001-0000-4000-8000-000000000001',
            slug: 'frontend-development',
            name: 'Frontend Development',
          },
          {
            canonical_role_id: '10000001-0000-4000-8000-000000000002',
            slug: 'backend-development',
            name: 'Backend Development',
          },
          {
            canonical_role_id: '10000001-0000-4000-8000-000000000003',
            slug: 'full-stack-development',
            name: 'Full-Stack Development',
          },
          {
            canonical_role_id: '10000001-0000-4000-8000-000000000004',
            slug: 'data-engineering',
            name: 'Data Engineering',
          },
          {
            canonical_role_id: '10000001-0000-4000-8000-000000000005',
            slug: 'ai-ml-engineering',
            name: 'AI / Machine Learning Engineering',
          },
        ],
      },
      untrusted_inputs: ['Data analyst'],
      output_schema: 'goal_interpretation.v1',
      language: 'en',
      idempotency_key: 'idem-synthetic-data-analyst-3-roles',
      budget: {
        max_input_units: 4000,
        max_output_units: 1500,
        timeout_ms: 9500,
      },
    });

    expect(res.output?.proposedRole).toEqual({
      canonicalRoleId: '10000001-0000-4000-8000-000000000004',
      name: 'Data Engineering',
    });
    expect(res.output?.alternativeRoles).toHaveLength(2);
    expect(res.output?.alternativeRoles.map((r) => r.name)).toEqual([
      'AI / Machine Learning Engineering',
      'Backend Development',
    ]);
    const allIds = [
      res.output?.proposedRole?.canonicalRoleId,
      ...(res.output?.alternativeRoles ?? []).map((r) => r.canonicalRoleId),
    ];
    expect(new Set(allIds).size).toBe(3);
  });

  it('releases HALF_OPEN canary and throws AI_TIMEOUT without invoking fallback when deadline expires during touchQuotaReservation', async () => {
    vi.useFakeTimers();
    const FALLBACK_MODEL_ID = '55555555-5555-4555-8555-555555555555';
    const RESERVATION_ID = '66666666-6666-4666-8666-666666666666';
    const FALLBACK_MODEL: AiModelRecord = {
      ...APPROVED_MODEL,
      id: FALLBACK_MODEL_ID,
      provider_key: 'openai',
      model_identifier: 'gpt-4o-mini-fallback',
      display_name: 'Fallback Model',
      fallback_rank: 2,
    };

    for (let i = 0; i < CircuitBreakerService.FAILURE_THRESHOLD; i += 1) {
      circuitBreaker.recordFailure(FALLBACK_MODEL_ID);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(circuitBreaker.getState(FALLBACK_MODEL_ID)).toBe('HALF_OPEN');

    const baseImpl = queryMock.getMockImplementation() as (
      sql: string,
      params?: unknown[],
    ) => Promise<unknown>;
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.ai_models')) {
        return [APPROVED_MODEL, FALLBACK_MODEL];
      }
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: RESERVATION_ID }];
      }
      if (
        sql.includes('UPDATE public.ai_requests') &&
        sql.includes('SET locked_at = clock_timestamp()')
      ) {
        // Advance clock past the 5_000ms gateway deadline while touching the reservation
        vi.advanceTimersByTime(6_000);
        return [];
      }
      return baseImpl(sql, params);
    });

    const fallbackInvoked = vi.fn();
    syntheticAdapter.setModelRule(MODEL_ID, 'provider_error');
    syntheticAdapter.setModelRule(FALLBACK_MODEL_ID, () => {
      fallbackInvoked();
      throw new ProviderInvocationError('timeout', 'Should not run', 504);
    });

    const releaseSpy = vi.spyOn(circuitBreaker, 'releaseCanary');
    const failureSpy = vi.spyOn(circuitBreaker, 'recordFailure');

    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-touch-expires-deadline',
        budget: {
          max_input_units: 2000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 504, 'AI_TIMEOUT');
      return true;
    });

    expect(fallbackInvoked).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledWith(
      FALLBACK_MODEL_ID,
      expect.any(String),
    );
    expect(failureSpy.mock.calls.some(([id]) => id === FALLBACK_MODEL_ID)).toBe(
      false,
    );
    expect(circuitBreaker.getState(FALLBACK_MODEL_ID)).toBe('HALF_OPEN');
  });

  it('does not match "studios" as iOS and drops unavailable alternative roles on partial approved_roles catalogs', async () => {
    const partialRoles = [
      {
        canonical_role_id: 'aaaa1111-1111-4111-8111-111111111111',
        slug: 'frontend-development',
        name: 'Frontend Development',
      },
      {
        canonical_role_id: 'bbbb2222-2222-4222-8222-222222222222',
        slug: 'backend-development',
        name: 'Backend Development',
      },
      {
        canonical_role_id: 'cccc3333-3333-4333-8333-333333333333',
        slug: 'full-stack-development',
        name: 'Full-Stack Development',
      },
    ];

    const studiosRes = await gateway.execute<{
      proposedRole: { canonicalRoleId: string; name: string } | null;
      alternativeRoles: Array<{ canonicalRoleId: string; name: string }>;
    }>({
      task: 'goal_interpretation',
      user_id: USER_ID,
      context: { clarification_round: 0, approved_roles: partialRoles },
      untrusted_inputs: ['Backend developer for game studios'],
      output_schema: 'goal_interpretation.v1',
      language: 'en',
      idempotency_key: 'idem-synthetic-studios-backend',
      budget: {
        max_input_units: 2000,
        max_output_units: 1000,
        timeout_ms: 5000,
      },
    });

    expect(studiosRes.output?.proposedRole).toEqual({
      canonicalRoleId: 'bbbb2222-2222-4222-8222-222222222222',
      name: 'Backend Development',
    });
    // cloud-engineering is absent from partialRoles -> dropped instead of emitting a synthetic UUID
    expect(studiosRes.output?.alternativeRoles).toEqual([
      {
        canonicalRoleId: 'cccc3333-3333-4333-8333-333333333333',
        name: 'Full-Stack Development',
        matchReason: 'Overlapping API and web engineering skills.',
      },
    ]);

    const frontendRes = await gateway.execute<{
      proposedRole: { canonicalRoleId: string; name: string } | null;
      alternativeRoles: Array<{ canonicalRoleId: string; name: string }>;
    }>({
      task: 'goal_interpretation',
      user_id: USER_ID,
      context: { clarification_round: 0, approved_roles: partialRoles },
      untrusted_inputs: ['Frontend developer'],
      output_schema: 'goal_interpretation.v1',
      language: 'en',
      idempotency_key: 'idem-synthetic-partial-frontend',
      budget: {
        max_input_units: 2000,
        max_output_units: 1000,
        timeout_ms: 5000,
      },
    });

    expect(frontendRes.output?.proposedRole).toEqual({
      canonicalRoleId: 'aaaa1111-1111-4111-8111-111111111111',
      name: 'Frontend Development',
    });
    // mobile-development is absent from partialRoles -> dropped cleanly
    expect(frontendRes.output?.alternativeRoles).toEqual([
      {
        canonicalRoleId: 'cccc3333-3333-4333-8333-333333333333',
        name: 'Full-Stack Development',
        matchReason:
          'Combines frontend UI expertise with backend API development.',
      },
    ]);
  });
});
