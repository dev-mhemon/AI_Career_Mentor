import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AiGatewayService } from './services/ai-gateway.service.js';
import { CircuitBreakerService } from './services/circuit-breaker.service.js';
import { ContextBuilderService } from './services/context-builder.service.js';
import { ModelRouterService } from './services/model-router.service.js';
import { OutputValidatorService } from './services/output-validator.service.js';
import { PromptManagerService } from './services/prompt-manager.service.js';
import {
  AI_PROVIDER_ADAPTER,
  SyntheticProviderAdapter,
} from './services/provider.adapter.js';
import { QuotaGuardService } from './services/quota-guard.service.js';

/**
 * Internal AI Gateway module (`ADR-008`, `C08` §4–5, `C05` §15.12).
 *
 * Intentionally declares zero HTTP controllers (`controllers: []`) so no external
 * client route can specify prompts, providers, or models directly.
 */
@Module({
  imports: [AuthModule],
  controllers: [],
  providers: [
    SyntheticProviderAdapter,
    {
      provide: AI_PROVIDER_ADAPTER,
      useExisting: SyntheticProviderAdapter,
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
    SyntheticProviderAdapter,
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
