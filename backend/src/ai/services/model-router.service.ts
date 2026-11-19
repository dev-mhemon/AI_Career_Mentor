import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../auth/services/database.service.js';
import { readAiGatewayConfiguration } from '../../config.js';
import type { AiExecutionMode, AiModelRecord, AiTask } from '../ai.types.js';
import { CircuitBreakerService } from './circuit-breaker.service.js';

export interface RouteSelectionResult {
  candidates: AiModelRecord[];
  totalApprovedCount: number;
  quarantinedCount: number;
}

/**
 * Resolves ordered model candidates from `public.ai_models` (`PRD` §47, `C08` §4.3).
 *
 * Enforces:
 * - `is_active = true` and `task = ANY(approved_tasks)`
 * - `real_user_data_approved = true` whenever `mode !== 'synthetic'` (fail closed)
 * - Deterministic ordering by `fallback_rank ASC NULLS LAST`, then lowest input price
 * - `CircuitBreakerService` skip for quarantined (`OPEN`) models
 */
@Injectable()
export class ModelRouterService {
  private readonly defaultMode: AiExecutionMode;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CircuitBreakerService)
    private readonly circuitBreaker: CircuitBreakerService,
    @Optional() @Inject(ConfigService) configService?: ConfigService,
  ) {
    this.defaultMode = readAiGatewayConfiguration(
      configService ?? process.env,
    ).executionMode;
  }

  private async runRead<T>(
    operation: (db: { query: DatabaseService['query'] }) => Promise<T>,
  ): Promise<T> {
    if (typeof this.database.transaction === 'function') {
      return this.database.transaction(
        null,
        (db) => operation(db),
        false,
        false,
        true,
      );
    }
    return operation(this.database);
  }

  /**
   * Selects active, task-approved, privacy-compliant models ordered by `fallback_rank`
   * and filters out currently quarantined circuit-breaker entries.
   */
  async selectCandidates(
    task: AiTask,
    requestedMode?: AiExecutionMode,
  ): Promise<RouteSelectionResult> {
    const effectiveMode: AiExecutionMode =
      (requestedMode ?? this.defaultMode) === 'synthetic'
        ? 'synthetic'
        : 'real_user';
    const requireRealUserApproval = effectiveMode !== 'synthetic';

    const rows = await this.runRead((db) =>
      db.query<AiModelRecord[]>(
        `SELECT id,
                provider_key,
                model_identifier,
                display_name,
                input_price_per_m_units::float8 AS input_price_per_m_units,
                output_price_per_m_units::float8 AS output_price_per_m_units,
                approved_tasks::text[] AS approved_tasks,
                real_user_data_approved,
                fallback_rank,
                is_active
           FROM public.ai_models
          WHERE is_active = true
            AND $1::public.ai_task = ANY(approved_tasks)
            AND ($2::boolean = false OR real_user_data_approved = true)
          ORDER BY fallback_rank ASC NULLS LAST,
                   input_price_per_m_units ASC,
                   id ASC`,
        [task, requireRealUserApproval],
      ),
    );

    const eligible = (rows ?? [])
      .filter((row) => {
        if (!row || row.is_active === false) {
          return false;
        }
        if (
          Array.isArray(row.approved_tasks) &&
          !row.approved_tasks.includes(task)
        ) {
          return false;
        }
        if (requireRealUserApproval && row.real_user_data_approved !== true) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const rankA = a.fallback_rank ?? Number.MAX_SAFE_INTEGER;
        const rankB = b.fallback_rank ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) {
          return rankA - rankB;
        }
        const priceA = Number(a.input_price_per_m_units ?? 0);
        const priceB = Number(b.input_price_per_m_units ?? 0);
        if (priceA !== priceB) {
          return priceA - priceB;
        }
        return a.id.localeCompare(b.id);
      });

    const candidates: AiModelRecord[] = [];
    let quarantinedCount = 0;

    for (const model of eligible) {
      if (this.circuitBreaker.isAvailable(model.id)) {
        candidates.push({
          ...model,
          input_price_per_m_units: Number(model.input_price_per_m_units ?? 0),
          output_price_per_m_units: Number(model.output_price_per_m_units ?? 0),
        });
      } else {
        quarantinedCount += 1;
      }
    }

    return {
      candidates,
      totalApprovedCount: eligible.length,
      quarantinedCount,
    };
  }
}
