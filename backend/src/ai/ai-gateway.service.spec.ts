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
  });

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

  it('rejects duplicate roadmap lineage_id nodes and non-scalar array enums in OutputValidatorService', () => {
    const baseItem = {
      lineage_id: 'dup-node',
      topic_id: USER_ID,
      skill_id: USER_ID,
      title: 'Node',
      priority: 'core',
      gap_type: 'missing',
      required_depth: 'basic',
      estimated_effort_hours: 2,
      sequence_no: 1,
      depends_on_lineage_ids: ['dup-node'],
      reason: 'Self cycle',
      sources: [{ publisher: 'Docs', url: 'https://example.com' }],
    };

    expect(() =>
      outputValidator.validate('roadmap_generate', 'roadmap.v1', {
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
              baseItem,
              { ...baseItem, sequence_no: 2, depends_on_lineage_ids: [] },
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
      }),
    ).toThrow(HttpException);

    expect(() =>
      outputValidator.validate('roadmap_generate', 'roadmap.v1', {
        targetLevel: ['junior'],
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
            items: [{ ...baseItem, depends_on_lineage_ids: [] }],
          },
        ],
        level_outline: [],
        warnings: [],
        size_guardrail: {
          active_topic_count: 1,
          materially_large: false,
          warning: null,
        },
      }),
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
    const activePreparingIds = new Set<string>([verifiedPreparingRowId]);

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
        // Must restrict exemption strictly to active 'preparing' rows (never completed 'succeeded' rows)
        expect(sql).toContain("AND status = 'preparing'");
        const candidateId = String(params?.[0] ?? '');
        return activePreparingIds.has(candidateId) ? [{ id: candidateId }] : [];
      }
      if (sql.includes('INSERT INTO public.ai_requests')) {
        return [{ id: reservationId }];
      }
      return baseImpl(sql, params);
    });

    // 1. Unpersisted correlation UUID must NOT bypass quota reservation -> creates reservationId & binds telemetry to reservationId
    const unpersistedRes = await quotaGuard.reserveUserQuota(
      USER_ID.toUpperCase(),
      'mentor_chat',
      'en',
      unpersistedCorrelationId,
    );
    expect(unpersistedRes).toEqual({
      reservationId,
      telemetryRequestId: reservationId,
    });
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

    // 2. Unpersisted or completed UUID at quota limit still rejects with 503 AI_BUDGET_EXHAUSTED
    usedQuotaCount = 50;
    await expect(
      quotaGuard.reserveUserQuota(
        USER_ID,
        'mentor_chat',
        'en',
        unpersistedCorrelationId,
      ),
    ).rejects.toSatisfy((err) => {
      expectContractError(err, 503, 'AI_BUDGET_EXHAUSTED');
      return true;
    });

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
  });
});
