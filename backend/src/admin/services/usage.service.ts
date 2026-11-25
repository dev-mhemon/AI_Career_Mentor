import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../auth/services/database.service.js';
import { fail } from '../../common/http.js';
import {
  type AdminUsageQueryDTO,
  ISO_UTC_DATE_PATTERN,
  USAGE_GROUP_BY_VALUES,
  type UsageBucketDTO,
  type UsageByDayDTO,
  type UsageByFeatureDTO,
  type UsageByProviderDTO,
  type UsageGroupBy,
  type UsageSummaryDTO,
} from '../dto/admin.dto.js';

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_INCLUSIVE_UTC_DAYS = 366;
const MS_PER_UTC_DAY = 86_400_000;

interface RawUsageSummary {
  range?: { from?: string; to?: string };
  users?: { total?: number | string; active_last_7_days?: number | string };
  counts?: {
    roadmaps_locked?: number | string;
    quizzes_submitted?: number | string;
    mentor_messages?: number | string;
    technology_updates_generated?: number | string;
  };
  ai?: {
    requests?: number | string;
    failures?: number | string;
    fallbacks_used?: number | string;
    usage_units?: { input?: number | string; output?: number | string };
    estimated_cost_usd?: number | string;
    by_day?: Array<{
      day?: string;
      requests?: number | string;
      failures?: number | string;
      fallbacks_used?: number | string;
      input_units?: number | string;
      output_units?: number | string;
      estimated_cost_usd?: number | string;
    }>;
    by_feature?: Array<{
      feature_key?: string;
      requests?: number | string;
      estimated_cost_usd?: number | string;
    }>;
    by_provider?: Array<{
      provider_id?: string;
      requests?: number | string;
      estimated_cost_usd?: number | string;
    }>;
  };
}

/**
 * Formats a UTC millisecond timestamp as `YYYY-MM-DD`.
 */
export function formatUtcDate(utcMs: number): string {
  const date = new Date(utcMs);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Strictly parses a real UTC calendar date `YYYY-MM-DD` (rejecting impossible dates such as `2026-02-30`).
 */
export function parseStrictUtcDate(raw: string, field: 'from' | 'to'): number {
  const trimmed = raw.trim();
  if (!ISO_UTC_DATE_PATTERN.test(trimmed)) {
    fail(422, 'VALIDATION_FAILED', `Invalid ${field} date`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must use YYYY-MM-DD format`,
      },
    ]);
  }
  const [yearStr, monthStr, dayStr] = trimmed.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    fail(422, 'VALIDATION_FAILED', `Invalid calendar date for ${field}`, [
      {
        field,
        code: 'VALIDATION_FAILED',
        message: `${field} must be a valid calendar date`,
      },
    ]);
  }
  return utcMs;
}

function toFiniteNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Handles `EP-AD08` (`GET /api/v1/admin/usage`) in compliance with `C05 §14.14` and Accepted `R30`.
 * Delegates aggregate calculation to frozen SQL function `private.admin_usage_summary(p_from, p_to)`
 * and maps the selected dimension into `series: { group_by, buckets }`.
 */
@Injectable()
export class UsageService {
  constructor(
    @Inject(DatabaseService)
    private readonly database: DatabaseService,
  ) {}

  /**
   * Returns current UTC calendar date midnight in milliseconds. Overridable in tests via spy.
   */
  protected getTodayUtcMidnightMs(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  /**
   * `EP-AD08` (`GET /api/v1/admin/usage`, `200 OK`):
   * Counts and aggregate AI cost only; zero private user text (`PRD §51`, `R11`, `R30`).
   */
  async getUsageSummary(
    actorId: string,
    query?: AdminUsageQueryDTO,
  ): Promise<UsageSummaryDTO> {
    const groupBy: UsageGroupBy = query?.group_by ?? 'day';
    if (!USAGE_GROUP_BY_VALUES.includes(groupBy)) {
      fail(422, 'VALIDATION_FAILED', 'Invalid group_by value', [
        {
          field: 'group_by',
          code: 'INVALID_ENUM_VALUE',
          message: 'group_by must be day, feature, or provider',
        },
      ]);
    }

    const todayUtcMs = this.getTodayUtcMidnightMs();
    let fromMs: number;
    let toMs: number;

    if (query?.from !== undefined && query?.to !== undefined) {
      fromMs = parseStrictUtcDate(query.from, 'from');
      toMs = parseStrictUtcDate(query.to, 'to');
    } else if (query?.to !== undefined) {
      toMs = parseStrictUtcDate(query.to, 'to');
      fromMs = toMs - (DEFAULT_LOOKBACK_DAYS - 1) * MS_PER_UTC_DAY;
    } else if (query?.from !== undefined) {
      fromMs = parseStrictUtcDate(query.from, 'from');
      toMs = todayUtcMs;
    } else {
      toMs = todayUtcMs;
      fromMs = toMs - (DEFAULT_LOOKBACK_DAYS - 1) * MS_PER_UTC_DAY;
    }

    if (fromMs > toMs) {
      fail(422, 'VALIDATION_FAILED', 'from date must not be after to date', [
        {
          field: 'from',
          code: 'VALIDATION_FAILED',
          message: 'from must be on or before to',
        },
      ]);
    }

    const inclusiveDays = Math.round((toMs - fromMs) / MS_PER_UTC_DAY) + 1;
    if (inclusiveDays > MAX_INCLUSIVE_UTC_DAYS) {
      fail(
        422,
        'VALIDATION_FAILED',
        `Date range cannot exceed ${MAX_INCLUSIVE_UTC_DAYS} inclusive UTC days`,
        [
          {
            field: 'to',
            code: 'VALIDATION_FAILED',
            message: `Date range must be at most ${MAX_INCLUSIVE_UTC_DAYS} inclusive UTC days`,
          },
        ],
      );
    }

    const fromDateStr = formatUtcDate(fromMs);
    const toDateStr = formatUtcDate(toMs);

    const rawSummary = await this.database.transaction(
      actorId,
      async (db) => {
        const rows = (await db.query(
          'SELECT private.admin_usage_summary($1::date, $2::date) AS summary',
          [fromDateStr, toDateStr],
        )) as Array<{ summary?: RawUsageSummary | null }>;
        return rows[0]?.summary ?? {};
      },
      true,
      false,
      true,
    );

    return this.buildUsageSummaryDto(
      rawSummary,
      fromMs,
      toMs,
      fromDateStr,
      toDateStr,
      groupBy,
    );
  }

  private buildUsageSummaryDto(
    raw: RawUsageSummary,
    fromMs: number,
    toMs: number,
    fromDateStr: string,
    toDateStr: string,
    groupBy: UsageGroupBy,
  ): UsageSummaryDTO {
    const rawByDayMap = new Map<string, UsageByDayDTO>();
    for (const item of raw.ai?.by_day ?? []) {
      const dayKey =
        typeof item?.day === 'string' ? item.day.slice(0, 10) : null;
      if (!dayKey || !ISO_UTC_DATE_PATTERN.test(dayKey)) continue;
      rawByDayMap.set(dayKey, {
        day: dayKey,
        requests: toFiniteNumber(item.requests),
        failures: toFiniteNumber(item.failures),
        fallbacks_used: toFiniteNumber(item.fallbacks_used),
        input_units: toFiniteNumber(item.input_units),
        output_units: toFiniteNumber(item.output_units),
        estimated_cost_usd: toFiniteNumber(item.estimated_cost_usd),
      });
    }

    const byDay: UsageByDayDTO[] = [];
    for (let cursor = fromMs; cursor <= toMs; cursor += MS_PER_UTC_DAY) {
      const key = formatUtcDate(cursor);
      const existing = rawByDayMap.get(key);
      byDay.push(
        existing ?? {
          day: key,
          requests: 0,
          failures: 0,
          fallbacks_used: 0,
          input_units: 0,
          output_units: 0,
          estimated_cost_usd: 0,
        },
      );
    }

    const byFeature: UsageByFeatureDTO[] = (raw.ai?.by_feature ?? [])
      .filter(
        (item): item is { feature_key: string } & typeof item =>
          typeof item?.feature_key === 'string' && item.feature_key.length > 0,
      )
      .map((item) => ({
        feature_key: item.feature_key,
        requests: toFiniteNumber(item.requests),
        estimated_cost_usd: toFiniteNumber(item.estimated_cost_usd),
      }));

    const byProvider: UsageByProviderDTO[] = (raw.ai?.by_provider ?? [])
      .filter(
        (item): item is { provider_id: string } & typeof item =>
          typeof item?.provider_id === 'string' && item.provider_id.length > 0,
      )
      .map((item) => ({
        provider_id: item.provider_id,
        requests: toFiniteNumber(item.requests),
        estimated_cost_usd: toFiniteNumber(item.estimated_cost_usd),
      }));

    let buckets: UsageBucketDTO[];
    if (groupBy === 'day') {
      buckets = byDay.map((entry) => ({
        key: entry.day,
        requests: entry.requests,
        estimated_cost_usd: entry.estimated_cost_usd,
        failures: entry.failures,
        fallbacks_used: entry.fallbacks_used,
        input_units: entry.input_units,
        output_units: entry.output_units,
      }));
    } else if (groupBy === 'feature') {
      buckets = byFeature.map((entry) => ({
        key: entry.feature_key,
        requests: entry.requests,
        estimated_cost_usd: entry.estimated_cost_usd,
        failures: null,
        fallbacks_used: null,
        input_units: null,
        output_units: null,
      }));
    } else {
      buckets = byProvider.map((entry) => ({
        key: entry.provider_id,
        requests: entry.requests,
        estimated_cost_usd: entry.estimated_cost_usd,
        failures: null,
        fallbacks_used: null,
        input_units: null,
        output_units: null,
      }));
    }

    return {
      range: {
        from: fromDateStr,
        to: toDateStr,
      },
      series: {
        group_by: groupBy,
        buckets,
      },
      users: {
        total: toFiniteNumber(raw.users?.total),
        active_last_7_days: toFiniteNumber(raw.users?.active_last_7_days),
      },
      counts: {
        roadmaps_locked: toFiniteNumber(raw.counts?.roadmaps_locked),
        quizzes_submitted: toFiniteNumber(raw.counts?.quizzes_submitted),
        mentor_messages: toFiniteNumber(raw.counts?.mentor_messages),
        technology_updates_generated: toFiniteNumber(
          raw.counts?.technology_updates_generated,
        ),
      },
      ai: {
        requests: toFiniteNumber(raw.ai?.requests),
        failures: toFiniteNumber(raw.ai?.failures),
        fallbacks_used: toFiniteNumber(raw.ai?.fallbacks_used),
        usage_units: {
          input: toFiniteNumber(raw.ai?.usage_units?.input),
          output: toFiniteNumber(raw.ai?.usage_units?.output),
        },
        estimated_cost_usd: toFiniteNumber(raw.ai?.estimated_cost_usd),
        by_day: byDay,
        by_feature: byFeature,
        by_provider: byProvider,
      },
    };
  }
}
