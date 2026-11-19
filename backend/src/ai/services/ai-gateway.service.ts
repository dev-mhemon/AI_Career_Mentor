import { HttpException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fail } from '../../common/http.js';
import {
  AI_TASKS,
  type AIRequestDTO,
  type AIResponseDTO,
  type AiTask,
} from '../ai.types.js';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import { ContextBuilderService } from './context-builder.service.js';
import { ModelRouterService } from './model-router.service.js';
import { OutputValidatorService } from './output-validator.service.js';
import { PromptManagerService } from './prompt-manager.service.js';
import {
  AI_PROVIDER_ADAPTER,
  ProviderInvocationError,
  type ProviderAdapter,
  type ProviderInvocationResult,
} from './provider.adapter.js';
import { QuotaGuardService } from './quota-guard.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_AI_TASK_SET: ReadonlySet<string> = new Set<string>(AI_TASKS);
const VALID_LANGUAGES: ReadonlySet<string> = new Set(['bn', 'en', 'mixed']);
const MAX_TIMEOUT_MS = 120_000;

export interface AiGatewayExecuteOptions {
  /** Set false when caller commits `public.ai_generations` atomically inside its own commit gate. */
  persistTelemetry?: boolean;
  signal?: AbortSignal;
}

/**
 * Internal AI Gateway (`ADR-008`, `C08` §4–5, `C05` §15.12).
 *
 * Sole egress boundary for all 9 `public.ai_task` workflows. Never exposes HTTP endpoints
 * and never logs raw prompts, `input_payload`, or completions.
 */
@Injectable()
export class AiGatewayService {
  constructor(
    @Inject(QuotaGuardService) private readonly quotaGuard: QuotaGuardService,
    @Inject(PromptManagerService)
    private readonly promptManager: PromptManagerService,
    @Inject(ContextBuilderService)
    private readonly contextBuilder: ContextBuilderService,
    @Inject(ModelRouterService)
    private readonly modelRouter: ModelRouterService,
    @Inject(CircuitBreakerService)
    private readonly circuitBreaker: CircuitBreakerService,
    @Inject(OutputValidatorService)
    private readonly outputValidator: OutputValidatorService,
    @Inject(AI_PROVIDER_ADAPTER)
    private readonly providerAdapter: ProviderAdapter,
  ) {}

  private validateRequest(request: AIRequestDTO): AiTask {
    if (
      !request ||
      typeof request.task !== 'string' ||
      !VALID_AI_TASK_SET.has(request.task)
    ) {
      fail(422, 'INVALID_ENUM_VALUE', 'Unsupported AI task');
    }
    if (
      typeof request.user_id !== 'string' ||
      !UUID_PATTERN.test(request.user_id.trim())
    ) {
      fail(422, 'VALIDATION_FAILED', 'Valid user_id UUID is required');
    }
    if (
      typeof request.language !== 'string' ||
      !VALID_LANGUAGES.has(request.language)
    ) {
      fail(422, 'UNSUPPORTED_LANGUAGE', 'Unsupported language');
    }
    if (
      typeof request.output_schema !== 'string' ||
      !request.output_schema.trim()
    ) {
      fail(422, 'VALIDATION_FAILED', 'output_schema is required');
    }
    if (
      typeof request.idempotency_key !== 'string' ||
      !request.idempotency_key.trim()
    ) {
      fail(422, 'VALIDATION_FAILED', 'idempotency_key is required');
    }
    const b = request.budget;
    if (
      !b ||
      !Number.isInteger(b.max_input_units) ||
      b.max_input_units <= 0 ||
      !Number.isInteger(b.max_output_units) ||
      b.max_output_units <= 0 ||
      !Number.isInteger(b.timeout_ms) ||
      b.timeout_ms <= 0 ||
      b.timeout_ms > MAX_TIMEOUT_MS
    ) {
      fail(422, 'VALIDATION_FAILED', 'Invalid AI request budget bounds');
    }
    return request.task as AiTask;
  }

  /**
   * Executes one AI workflow through quota guard -> prompt SHA-256 verification ->
   * PII-redacted/injection-isolated context -> approved model routing -> circuit breaker fallback ->
   * strict output schema validation -> content-free telemetry.
   */
  async execute<T = unknown>(
    request: AIRequestDTO,
    options: AiGatewayExecuteOptions = {},
  ): Promise<AIResponseDTO<T>> {
    const task = this.validateRequest(request);
    const dbRequestId =
      typeof request.request_id === 'string' &&
      UUID_PATTERN.test(request.request_id.trim())
        ? request.request_id.trim()
        : null;
    const requestId = dbRequestId ?? randomUUID();
    const userId = request.user_id.trim();
    const outputSchema = request.output_schema.trim();
    const persistTelemetry = options.persistTelemetry ?? true;

    await this.quotaGuard.enforceUserQuota(userId, task);

    const prompt = await this.promptManager.resolvePrompt(task, outputSchema);
    const builtContext = this.contextBuilder.buildContext(request);
    const route = await this.modelRouter.selectCandidates(task, request.mode);

    if (route.totalApprovedCount === 0) {
      fail(
        503,
        'AI_BUDGET_EXHAUSTED',
        'AI capacity is temporarily unavailable. Existing data remains accessible.',
        undefined,
        true,
      );
    }

    if (route.candidates.length === 0) {
      fail(
        502,
        'AI_SERVICE_ERROR',
        'AI service encountered an error. Please try again later.',
        undefined,
        true,
      );
    }

    let lastFailureKind: 'timeout' | 'rate_limit' | 'provider_error' =
      'provider_error';
    let lastInvocation: ProviderInvocationResult | null = null;
    let chosenModel = route.candidates[0];
    let chosenCanaryToken: string | null = null;
    let fallbackUsed = route.quarantinedCount > 0;

    for (let i = 0; i < route.candidates.length; i += 1) {
      if (options.signal?.aborted) {
        lastFailureKind = 'timeout';
        break;
      }
      const candidate = route.candidates[i];
      const admission = this.circuitBreaker.acquireAttempt(candidate.id);
      if (!admission.allowed) {
        fallbackUsed = true;
        continue;
      }
      chosenModel = candidate;
      chosenCanaryToken = admission.canaryToken;
      if (i > 0) {
        fallbackUsed = true;
      }

      try {
        lastInvocation = await this.providerAdapter.invoke({
          requestId,
          model: candidate,
          task,
          language: request.language,
          systemPrompt: prompt.systemPrompt,
          userEnvelope: builtContext.userEnvelope,
          outputSchemaId: prompt.outputSchemaId,
          maxOutputUnits: request.budget.max_output_units,
          timeoutMs: request.budget.timeout_ms,
          signal: options.signal,
        });
        break;
      } catch (error) {
        if (options.signal?.aborted) {
          this.circuitBreaker.releaseCanary(
            candidate.id,
            admission.canaryToken,
          );
          lastFailureKind = 'timeout';
          break;
        }
        if (error instanceof ProviderInvocationError) {
          lastFailureKind = error.kind;
          if (error.kind === 'timeout' || error.kind === 'provider_error') {
            this.circuitBreaker.recordFailure(
              candidate.id,
              admission.canaryToken,
            );
          } else {
            this.circuitBreaker.releaseCanary(
              candidate.id,
              admission.canaryToken,
            );
          }
          continue;
        }
        lastFailureKind = 'provider_error';
        this.circuitBreaker.recordFailure(candidate.id, admission.canaryToken);
      }
    }

    if (!lastInvocation) {
      if (lastFailureKind === 'timeout') {
        fail(
          504,
          'AI_TIMEOUT',
          'AI generation timed out. Please try again.',
          undefined,
          true,
        );
      }
      if (lastFailureKind === 'rate_limit') {
        fail(
          503,
          'AI_BUDGET_EXHAUSTED',
          'AI capacity is temporarily unavailable. Existing data remains accessible.',
          undefined,
          true,
        );
      }
      fail(
        502,
        'AI_SERVICE_ERROR',
        'AI service encountered an error. Please try again later.',
        undefined,
        true,
      );
    }

    let validatedOutput: T;
    try {
      validatedOutput = this.outputValidator.validate<T>(
        task,
        prompt.outputSchemaId,
        lastInvocation.output,
      );
    } catch (validationError) {
      this.circuitBreaker.recordSuccess(chosenModel.id, chosenCanaryToken);
      if (persistTelemetry) {
        await this.quotaGuard.recordGenerationTelemetry({
          requestId: dbRequestId,
          task,
          providerKey: chosenModel.provider_key,
          modelId: chosenModel.id,
          promptVersionId: prompt.promptVersionId,
          outputSchemaId: prompt.outputSchemaId,
          validationStatus: 'failed',
          fallbackUsed,
          language: request.language,
          inputUnits: lastInvocation.inputUnits,
          outputUnits: lastInvocation.outputUnits,
          latencyMs: lastInvocation.latencyMs,
          output: null,
        });
      }
      if (validationError instanceof HttpException) {
        throw validationError;
      }
      fail(
        502,
        'AI_VALIDATION_FAILED',
        'AI output failed validation and was discarded. Please try again.',
        undefined,
        true,
      );
    }

    this.circuitBreaker.recordSuccess(chosenModel.id, chosenCanaryToken);

    const estimatedCost = Number(
      (
        (lastInvocation.inputUnits * chosenModel.input_price_per_m_units +
          lastInvocation.outputUnits * chosenModel.output_price_per_m_units) /
        1_000_000
      ).toFixed(8),
    );

    const generationId = persistTelemetry
      ? await this.quotaGuard.recordGenerationTelemetry({
          requestId: dbRequestId,
          task,
          providerKey: chosenModel.provider_key,
          modelId: chosenModel.id,
          promptVersionId: prompt.promptVersionId,
          outputSchemaId: prompt.outputSchemaId,
          validationStatus: 'passed',
          fallbackUsed,
          language: request.language,
          inputUnits: lastInvocation.inputUnits,
          outputUnits: lastInvocation.outputUnits,
          latencyMs: lastInvocation.latencyMs,
          output: validatedOutput,
        })
      : null;

    return {
      request_id: requestId,
      generation_id: generationId,
      status: 'ok',
      output: validatedOutput,
      provider_id: chosenModel.provider_key,
      model_id: chosenModel.id,
      fallback_used: fallbackUsed,
      prompt_version_id: prompt.promptVersionId,
      usage_units: {
        input: lastInvocation.inputUnits,
        output: lastInvocation.outputUnits,
      },
      cost: estimatedCost,
      latency_ms: lastInvocation.latencyMs,
      validation_status: 'passed',
      sources: lastInvocation.sources ?? [],
    };
  }
}
