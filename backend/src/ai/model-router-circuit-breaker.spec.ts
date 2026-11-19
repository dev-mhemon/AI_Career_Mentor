import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import { AI_TASKS, type AiModelRecord } from './ai.types.js';
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
const PRIMARY_MODEL_ID = '22222222-2222-4222-8222-222222222222';
const SECONDARY_MODEL_ID = '33333333-3333-4333-8333-333333333333';
const UNAPPROVED_MODEL_ID = '44444444-4444-4444-8444-444444444444';
const PROMPT_ID = '55555555-5555-4555-8555-555555555555';
const GENERATION_ID = '66666666-6666-4666-8666-666666666666';

const PRIMARY_APPROVED: AiModelRecord = {
  id: PRIMARY_MODEL_ID,
  provider_key: 'google-gemini',
  model_identifier: 'gemini-2.5-pro-primary',
  display_name: 'Primary Model',
  input_price_per_m_units: 0.5,
  output_price_per_m_units: 1.5,
  approved_tasks: [...AI_TASKS],
  real_user_data_approved: true,
  fallback_rank: 1,
  is_active: true,
};

const SECONDARY_APPROVED: AiModelRecord = {
  id: SECONDARY_MODEL_ID,
  provider_key: 'openai',
  model_identifier: 'gpt-4o-mini-fallback',
  display_name: 'Secondary Fallback',
  input_price_per_m_units: 0.15,
  output_price_per_m_units: 0.6,
  approved_tasks: [...AI_TASKS],
  real_user_data_approved: true,
  fallback_rank: 2,
  is_active: true,
};

const FREE_UNAPPROVED: AiModelRecord = {
  id: UNAPPROVED_MODEL_ID,
  provider_key: 'free-tier-experimental',
  model_identifier: 'experimental-free-model',
  display_name: 'Free Experimental',
  input_price_per_m_units: 0,
  output_price_per_m_units: 0,
  approved_tasks: [...AI_TASKS],
  real_user_data_approved: false,
  fallback_rank: 1,
  is_active: true,
};

describe('ModelRouterService & CircuitBreakerService (Approval Gate, Fallback & 5-Failure/60s Quarantine)', () => {
  let modelsFromDb: AiModelRecord[];
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

  beforeEach(() => {
    vi.clearAllMocks();
    modelsFromDb = [SECONDARY_APPROVED, PRIMARY_APPROVED];

    const templates = new Map(
      getBuiltInPromptTemplates().map((t) => [t.task, t]),
    );

    queryMock = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM public.ai_models')) {
        return modelsFromDb;
      }
      if (sql.includes('FROM public.system_configurations')) {
        return [{ config_value: 50 }];
      }
      if (sql.includes('AS used_count')) {
        return [{ used_count: 0 }];
      }
      if (sql.includes('FROM public.prompt_versions')) {
        const tpl = templates.get(
          String(params?.[0]) as (typeof AI_TASKS)[number],
        );
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
      get: vi.fn((key: string) =>
        key === 'AI_EXECUTION_MODE' ? 'real_user' : undefined,
      ),
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('orders models by fallback_rank and rejects unapproved models in real_user mode while permitting them in synthetic mode', async () => {
    modelsFromDb = [FREE_UNAPPROVED, SECONDARY_APPROVED];

    const realUserRoute = await modelRouter.selectCandidates(
      'mentor_chat',
      'real_user',
    );
    expect(realUserRoute.candidates.map((m) => m.id)).toEqual([
      SECONDARY_MODEL_ID,
    ]);

    // When ONLY unapproved model exists in real_user mode -> 503 AI_BUDGET_EXHAUSTED
    modelsFromDb = [FREE_UNAPPROVED];
    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-real-user-gate',
        mode: 'real_user',
        budget: {
          max_input_units: 1000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toSatisfy((err) => {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(503);
      expect((httpErr.getResponse() as { code?: string }).code).toBe(
        'AI_BUDGET_EXHAUSTED',
      );
      return true;
    });

    // Explicitly marked synthetic mode permits real_user_data_approved = false model
    const syntheticRes = await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-synthetic-ok',
      mode: 'synthetic',
      budget: {
        max_input_units: 1000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });
    expect(syntheticRes.status).toBe('ok');
    expect(syntheticRes.model_id).toBe(UNAPPROVED_MODEL_ID);
  });

  it('opens circuit breaker after 5 consecutive failures within 60s, routes to fallback_rank=2, probes HALF_OPEN canary after 60s, and closes on recovery', async () => {
    vi.useFakeTimers();
    modelsFromDb = [SECONDARY_APPROVED, PRIMARY_APPROVED];

    // Primary fails with 5xx, secondary succeeds -> triggers fallback_used = true
    syntheticAdapter.setModelRule(PRIMARY_MODEL_ID, 'provider_error');

    for (let i = 0; i < 4; i += 1) {
      const res = await gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: `idem-fail-${i}`,
        budget: {
          max_input_units: 1000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      });
      expect(res.model_id).toBe(SECONDARY_MODEL_ID);
      expect(res.fallback_used).toBe(true);
      expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('CLOSED');
    }

    // 5th consecutive failure opens primary circuit breaker
    await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-fail-5',
      budget: {
        max_input_units: 1000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('OPEN');

    // During 60s quarantine, primary is skipped without invoking it
    const invokeSpy = vi.spyOn(syntheticAdapter, 'invoke');
    const quarantinedRes = await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-quarantined',
      budget: {
        max_input_units: 1000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });
    expect(quarantinedRes.model_id).toBe(SECONDARY_MODEL_ID);
    expect(quarantinedRes.fallback_used).toBe(true);
    expect(
      invokeSpy.mock.calls.some(([req]) => req.model.id === PRIMARY_MODEL_ID),
    ).toBe(false);

    // After 60s quarantine expires -> HALF_OPEN single canary probe
    await vi.advanceTimersByTimeAsync(60_000);
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('HALF_OPEN');

    // Only one concurrent canary probe slot is granted while HALF_OPEN
    expect(circuitBreaker.canAttempt(PRIMARY_MODEL_ID)).toBe(true);
    expect(circuitBreaker.canAttempt(PRIMARY_MODEL_ID)).toBe(false);

    // Canary failure re-opens quarantine for 60s
    expect(circuitBreaker.recordFailure(PRIMARY_MODEL_ID)).toBe('OPEN');

    // Advance another 60s, recover primary model, execute canary -> transitions to CLOSED
    await vi.advanceTimersByTimeAsync(60_000);
    syntheticAdapter.setModelRule(PRIMARY_MODEL_ID, 'ok');
    const recovered = await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-recovered',
      budget: {
        max_input_units: 1000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });
    expect(recovered.model_id).toBe(PRIMARY_MODEL_ID);
    expect(recovered.fallback_used).toBe(false);
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('CLOSED');
  });

  it('does not leak HALF_OPEN canary slots on unused fallback models or rate-limited probes', async () => {
    vi.useFakeTimers();
    modelsFromDb = [PRIMARY_APPROVED, SECONDARY_APPROVED];

    // Trip secondary into OPEN then advance 60s into HALF_OPEN
    for (let i = 0; i < CircuitBreakerService.FAILURE_THRESHOLD; i += 1) {
      circuitBreaker.recordFailure(SECONDARY_MODEL_ID);
    }
    expect(circuitBreaker.getState(SECONDARY_MODEL_ID)).toBe('OPEN');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(circuitBreaker.getState(SECONDARY_MODEL_ID)).toBe('HALF_OPEN');

    // Primary succeeds -> unused secondary HALF_OPEN canary slot must remain available
    const primaryRes = await gateway.execute({
      task: 'mentor_chat',
      user_id: USER_ID,
      context: {},
      output_schema: 'mentor_chat.v1',
      language: 'en',
      idempotency_key: 'idem-primary-ok',
      budget: {
        max_input_units: 1000,
        max_output_units: 500,
        timeout_ms: 5000,
      },
    });
    expect(primaryRes.model_id).toBe(PRIMARY_MODEL_ID);
    expect(circuitBreaker.isAvailable(SECONDARY_MODEL_ID)).toBe(true);

    // Rate-limited HALF_OPEN canary releases its slot instead of deadlocking
    modelsFromDb = [SECONDARY_APPROVED];
    syntheticAdapter.setModelRule(SECONDARY_MODEL_ID, 'rate_limit');
    await expect(
      gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-rate-limited',
        budget: {
          max_input_units: 1000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(circuitBreaker.getState(SECONDARY_MODEL_ID)).toBe('HALF_OPEN');
    expect(circuitBreaker.isAvailable(SECONDARY_MODEL_ID)).toBe(true);
  });

  it('enforces HALF_OPEN canary reservation token ownership so late pre-open releases cannot clear an active canary', async () => {
    vi.useFakeTimers();

    // Request A admitted while CLOSED -> canaryToken = null
    const admissionA = circuitBreaker.acquireAttempt(PRIMARY_MODEL_ID);
    expect(admissionA).toEqual({ allowed: true, canaryToken: null });

    // Trip circuit to OPEN and advance past 60s quarantine into HALF_OPEN
    for (let i = 0; i < CircuitBreakerService.FAILURE_THRESHOLD; i += 1) {
      circuitBreaker.recordFailure(PRIMARY_MODEL_ID);
    }
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('OPEN');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('HALF_OPEN');

    // Request B admitted as HALF_OPEN canary -> receives unique token T1
    const admissionB = circuitBreaker.acquireAttempt(PRIMARY_MODEL_ID);
    expect(admissionB.allowed).toBe(true);
    expect(typeof admissionB.canaryToken).toBe('string');
    expect(admissionB.canaryToken).not.toBe('');

    // Late Request A (admitted while CLOSED with null token) or mismatched token calls releaseCanary
    circuitBreaker.releaseCanary(PRIMARY_MODEL_ID, admissionA.canaryToken);
    circuitBreaker.releaseCanary(PRIMARY_MODEL_ID, 'wrong-token');

    // Request C MUST still be blocked while Request B holds canary reservation T1
    expect(circuitBreaker.isAvailable(PRIMARY_MODEL_ID)).toBe(false);
    expect(circuitBreaker.acquireAttempt(PRIMARY_MODEL_ID)).toEqual({
      allowed: false,
      canaryToken: null,
    });

    // Request B releasing with matching T1 frees the HALF_OPEN canary slot cleanly
    circuitBreaker.releaseCanary(PRIMARY_MODEL_ID, admissionB.canaryToken);
    expect(circuitBreaker.isAvailable(PRIMARY_MODEL_ID)).toBe(true);
    const admissionNext = circuitBreaker.acquireAttempt(PRIMARY_MODEL_ID);
    expect(admissionNext.allowed).toBe(true);
    expect(admissionNext.canaryToken).not.toBeNull();
  });

  it('prevents a late pre-open CLOSED success (canaryToken = null) from prematurely closing an OPEN quarantine', () => {
    const preOpenAdmission = circuitBreaker.acquireAttempt(PRIMARY_MODEL_ID);
    expect(preOpenAdmission).toEqual({ allowed: true, canaryToken: null });

    for (let i = 0; i < CircuitBreakerService.FAILURE_THRESHOLD; i += 1) {
      circuitBreaker.recordFailure(PRIMARY_MODEL_ID, null);
    }
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('OPEN');

    // Late success from pre-open request must NOT end the 60s quarantine
    circuitBreaker.recordSuccess(
      PRIMARY_MODEL_ID,
      preOpenAdmission.canaryToken,
    );
    expect(circuitBreaker.getState(PRIMARY_MODEL_ID)).toBe('OPEN');
    expect(circuitBreaker.isAvailable(PRIMARY_MODEL_ID)).toBe(false);
  });

  it('never leaks provider_key, model_identifier, or model_id in client-facing errors', async () => {
    modelsFromDb = [PRIMARY_APPROVED];
    syntheticAdapter.setModelRule(PRIMARY_MODEL_ID, 'provider_error');

    let caught: unknown;
    try {
      await gateway.execute({
        task: 'mentor_chat',
        user_id: USER_ID,
        context: {},
        output_schema: 'mentor_chat.v1',
        language: 'en',
        idempotency_key: 'idem-no-leak',
        budget: {
          max_input_units: 1000,
          max_output_units: 500,
          timeout_ms: 5000,
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const serialized = JSON.stringify((caught as HttpException).getResponse());
    expect(serialized).not.toContain('google-gemini');
    expect(serialized).not.toContain('gemini-2.5-pro-primary');
    expect(serialized).not.toContain(PRIMARY_MODEL_ID);
  });
});
