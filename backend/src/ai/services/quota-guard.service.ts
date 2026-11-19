import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import { readAiGatewayConfiguration } from '../../config.js';
import type { AiTask, UiLanguage } from '../ai.types.js';

export const R26_MIN_OPERATIONAL_LIMIT = 1;
export const R26_MAX_OPERATIONAL_LIMIT = 10_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BoundedConfigSpec {
  defaultValue: number;
  min: number;
  max: number;
}

const SYSTEM_CONFIG_SPECS: Readonly<Record<string, BoundedConfigSpec>> = {
  'ai_quota.roadmap_drafts_per_24h': {
    defaultValue: 5,
    min: R26_MIN_OPERATIONAL_LIMIT,
    max: R26_MAX_OPERATIONAL_LIMIT,
  },
  'ai_quota.mentor_messages_per_24h': {
    defaultValue: 50,
    min: R26_MIN_OPERATIONAL_LIMIT,
    max: R26_MAX_OPERATIONAL_LIMIT,
  },
  'roadmap.soft_size_max_topics': {
    defaultValue: 45,
    min: R26_MIN_OPERATIONAL_LIMIT,
    max: R26_MAX_OPERATIONAL_LIMIT,
  },
};

const TASK_TO_QUOTA_KEY: Readonly<Partial<Record<AiTask, string>>> = {
  roadmap_generate: 'ai_quota.roadmap_drafts_per_24h',
  mentor_chat: 'ai_quota.mentor_messages_per_24h',
};

interface CachedConfigEntry {
  value: number;
  expiresAtMs: number;
}

export interface GenerationTelemetryInput {
  requestId: string | null;
  task: AiTask;
  providerKey: string;
  modelId: string;
  promptVersionId: string;
  outputSchemaId: string;
  validationStatus: 'passed' | 'failed';
  fallbackUsed: boolean;
  language: UiLanguage | null;
  inputUnits: number;
  outputUnits: number;
  latencyMs: number;
  output: unknown;
}

export interface TelemetryQueryExecutor {
  query<T = unknown>(query: string, parameters?: unknown[]): Promise<T>;
}

/**
 * Enforces `R26` (`1..10000` integer bounds, `<= 5s` cache TTL, safe fallback never unlimited)
 * over `public.system_configurations`, checks per-user 24h AI quotas (`503 AI_BUDGET_EXHAUSTED`),
 * and records content-free telemetry in `public.ai_generations` (`output_hash` only).
 */
@Injectable()
export class QuotaGuardService {
  private readonly cache = new Map<string, CachedConfigEntry>();
  readonly cacheTtlMs: number;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(ConfigService) configService?: ConfigService,
  ) {
    this.cacheTtlMs = readAiGatewayConfiguration(
      configService ?? process.env,
    ).quotaCacheTtlMs;
  }

  private async runTx<T>(
    operation: (db: TelemetryQueryExecutor) => Promise<T>,
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

  /** Clears cached `system_configurations` entries after approved configuration updates (`R26`). */
  invalidateCache(configKey?: string): void {
    if (configKey) {
      this.cache.delete(configKey);
      return;
    }
    this.cache.clear();
  }

  /**
   * Reads a bounded integer setting from `public.system_configurations` (`R26`).
   * Rejects strings, `null`, booleans, floats, and out-of-range integers -> returns safe default.
   */
  async getBoundedConfigInteger(configKey: string): Promise<number> {
    const spec = SYSTEM_CONFIG_SPECS[configKey] ?? {
      defaultValue: 5,
      min: R26_MIN_OPERATIONAL_LIMIT,
      max: R26_MAX_OPERATIONAL_LIMIT,
    };

    const now = Date.now();
    const cached = this.cache.get(configKey);
    if (cached && now < cached.expiresAtMs) {
      return cached.value;
    }

    let resolved = spec.defaultValue;
    try {
      const rows = await this.runTx((db) =>
        db.query<Array<{ config_value: unknown }>>(
          `SELECT config_value
             FROM public.system_configurations
            WHERE config_key = $1`,
          [configKey],
        ),
      );
      const raw = Array.isArray(rows) ? rows[0]?.config_value : undefined;
      if (
        typeof raw === 'number' &&
        Number.isInteger(raw) &&
        raw >= spec.min &&
        raw <= spec.max
      ) {
        resolved = raw;
      }
    } catch {
      resolved = spec.defaultValue;
    }

    this.cache.set(configKey, {
      value: resolved,
      expiresAtMs: now + this.cacheTtlMs,
    });
    return resolved;
  }

  /**
   * Verifies 24h rolling quota for `(userId, task)` against `public.system_configurations`.
   * Throws `503 AI_BUDGET_EXHAUSTED` when exceeded (`PRD` §47: existing reads stay unaffected).
   */
  async enforceUserQuota(userId: string, task: AiTask): Promise<void> {
    const configKey = TASK_TO_QUOTA_KEY[task];
    if (!configKey) {
      return;
    }

    const limit = await this.getBoundedConfigInteger(configKey);
    const rows = await this.runTx((db) =>
      db.query<Array<{ used_count: number | string }>>(
        `SELECT count(*)::int AS used_count
           FROM public.ai_requests
          WHERE user_id = $1
            AND task = $2::public.ai_task
            AND status <> 'failed'
            AND created_at > clock_timestamp() - interval '24 hours'`,
        [userId, task],
      ),
    );
    const usedCount = Number(
      Array.isArray(rows) ? (rows[0]?.used_count ?? 0) : 0,
    );
    if (Number.isFinite(usedCount) && usedCount >= limit) {
      fail(
        503,
        'AI_BUDGET_EXHAUSTED',
        'AI capacity is temporarily unavailable. Existing data remains accessible.',
        undefined,
        true,
      );
    }
  }

  /**
   * Inserts a permanent content-free telemetry record into `public.ai_generations`
   * storing SHA-256 `output_hash` and unit counts while letting DB triggers compute `total_units`/`cost_usd`.
   */
  async recordGenerationTelemetry(
    input: GenerationTelemetryInput,
    tx?: TelemetryQueryExecutor,
  ): Promise<string | null> {
    const normalizedRequestId =
      typeof input.requestId === 'string' &&
      UUID_PATTERN.test(input.requestId.trim())
        ? input.requestId.trim()
        : null;
    const outputHash = createHash('sha256')
      .update(JSON.stringify(input.output ?? null), 'utf8')
      .digest('hex');

    const runInsert = async (
      executor: TelemetryQueryExecutor,
    ): Promise<string | null> => {
      const rows = await executor.query<Array<{ id: string }>>(
        `INSERT INTO public.ai_generations (
           request_id,
           task,
           provider_key,
           model_id,
           prompt_version_id,
           output_schema_id,
           validation_status,
           fallback_used,
           language,
           input_units,
           output_units,
           latency_ms,
           output_hash
         )
         VALUES (
           $1,
           $2::public.ai_task,
           $3,
           $4,
           $5,
           $6,
           $7::public.ai_validation_status,
           $8,
           $9::public.ui_language,
           $10,
           $11,
           $12,
           $13
         )
         RETURNING id`,
        [
          normalizedRequestId,
          input.task,
          input.providerKey,
          input.modelId,
          input.promptVersionId,
          input.outputSchemaId,
          input.validationStatus,
          input.fallbackUsed,
          input.language,
          Math.max(0, Math.trunc(input.inputUnits)),
          Math.max(0, Math.trunc(input.outputUnits)),
          Math.max(0, Math.trunc(input.latencyMs)),
          outputHash,
        ],
      );
      return Array.isArray(rows) ? (rows[0]?.id ?? null) : null;
    };

    if (tx) {
      return runInsert(tx);
    }
    return this.runTx(runInsert);
  }
}
