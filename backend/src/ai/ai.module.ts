import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import {
  readAiGatewayConfiguration,
  readGeminiProviderConfiguration,
} from '../config.js';
import { AiGatewayService } from './services/ai-gateway.service.js';
import { CircuitBreakerService } from './services/circuit-breaker.service.js';
import { ContextBuilderService } from './services/context-builder.service.js';
import { GeminiProviderAdapter } from './services/gemini-provider.adapter.js';
import { ModelRouterService } from './services/model-router.service.js';
import { OutputValidatorService } from './services/output-validator.service.js';
import { PromptManagerService } from './services/prompt-manager.service.js';
import {
  AI_PROVIDER_ADAPTER,
  ProviderInvocationError,
  SyntheticProviderAdapter,
  UnconfiguredRealUserProviderAdapter,
  type ProviderAdapter,
} from './services/provider.adapter.js';
import { QuotaGuardService } from './services/quota-guard.service.js';

/**
 * Internal AI Gateway module (`ADR-008`, `C08` §4–5, `C05` §15.12).
 *
 * Intentionally declares zero HTTP controllers (`controllers: []`) so no external
 * client route can specify prompts, providers, or models directly.
 *
 * Binds `AI_PROVIDER_ADAPTER` to `SyntheticProviderAdapter` when `AI_EXECUTION_MODE=synthetic`,
 * `GeminiProviderAdapter` when `AI_EXECUTION_MODE=real_user` and `GEMINI_API_KEY` is configured,
 * and fails closed (`UnconfiguredRealUserProviderAdapter`) in `real_user` mode when no key is set
 * so synthetic output can never be returned as real-user model output.
 */
@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [
    SyntheticProviderAdapter,
    {
      provide: AI_PROVIDER_ADAPTER,
      inject: [
        SyntheticProviderAdapter,
        { token: ConfigService, optional: true },
      ],
      useFactory: (
        syntheticAdapter: SyntheticProviderAdapter,
        configService?: ConfigService,
      ): ProviderAdapter => {
        const source = configService ?? process.env;
        const cfg = readAiGatewayConfiguration(source);
        if (cfg.executionMode !== 'synthetic') {
          const geminiCfg = readGeminiProviderConfiguration(source);
          if (geminiCfg.apiKey) {
            return new GeminiProviderAdapter({
              apiKey: geminiCfg.apiKey,
              defaultTimeoutMs: geminiCfg.timeoutMs,
            });
          }
          return new UnconfiguredRealUserProviderAdapter();
        }
        return {
          invoke: (request) => {
            if (request.mode === 'real_user') {
              return Promise.reject(
                new ProviderInvocationError(
                  'policy_rejected',
                  'Synthetic provider adapter cannot serve real_user requests',
                  503,
                ),
              );
            }
            return syntheticAdapter.invoke(request);
          },
        };
      },
    },
    CircuitBreakerService,
    ModelRouterService,
    PromptManagerService,
    ContextBuilderService,
    OutputValidatorService,
    QuotaGuardService,
    AiGatewayService,
  ],
  exports: [
    AI_PROVIDER_ADAPTER,
    CircuitBreakerService,
    ModelRouterService,
    PromptManagerService,
    ContextBuilderService,
    OutputValidatorService,
    QuotaGuardService,
    AiGatewayService,
  ],
})
export class AiModule {}
