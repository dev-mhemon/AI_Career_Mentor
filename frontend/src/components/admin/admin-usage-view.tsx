'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  getAdminUsage,
  type AdminUsageGroupBy,
  type UsageSeriesBucketDTO,
  type UsageSummaryDTO,
} from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { BarChartIcon, InfoIcon, RefreshCwIcon } from '@/components/ui/icons';
import { Select } from '@/components/ui/select';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from './admin-data-table';

const MS_PER_UTC_DAY = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_INCLUSIVE_UTC_DAYS = 366;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type UsageRangePreset =
  | '7d'
  | '14d'
  | '30d'
  | 'this_month'
  | '90d'
  | 'custom';

export type AdminUsageViewProps = {
  accessToken: string;
  initialTodayUtc?: string;
};

export function formatUtcDateString(utcMs: number): string {
  const date = new Date(utcMs);
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseStrictUtcDateMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) return null;
  const [yStr, mStr, dStr] = trimmed.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

function resolveTodayUtcMs(todayOverride?: string): number {
  const parsed = todayOverride ? parseStrictUtcDateMs(todayOverride) : null;
  if (parsed !== null) return parsed;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function getPresetUtcDateRange(
  preset: Exclude<UsageRangePreset, 'custom'>,
  todayOverride?: string,
): { from: string; to: string } {
  const todayMs = resolveTodayUtcMs(todayOverride);
  const to = formatUtcDateString(todayMs);

  if (preset === 'this_month') {
    const todayDate = new Date(todayMs);
    const firstOfMonthMs = Date.UTC(
      todayDate.getUTCFullYear(),
      todayDate.getUTCMonth(),
      1,
    );
    return { from: formatUtcDateString(firstOfMonthMs), to };
  }

  const days =
    preset === '7d'
      ? 7
      : preset === '14d'
        ? 14
        : preset === '30d'
          ? 30
          : 90;
  const fromMs = todayMs - (days - 1) * MS_PER_UTC_DAY;
  return { from: formatUtcDateString(fromMs), to };
}

export function getDefaultUtcDateRange(todayOverride?: string): {
  from: string;
  to: string;
} {
  const todayMs = resolveTodayUtcMs(todayOverride);
  const fromMs = todayMs - (DEFAULT_LOOKBACK_DAYS - 1) * MS_PER_UTC_DAY;
  return {
    from: formatUtcDateString(fromMs),
    to: formatUtcDateString(todayMs),
  };
}

export function validateUtcDateRange(from: string, to: string): string | null {
  const fromMs = parseStrictUtcDateMs(from);
  if (fromMs === null) {
    return 'Enter a valid UTC start date (YYYY-MM-DD).';
  }
  const toMs = parseStrictUtcDateMs(to);
  if (toMs === null) {
    return 'Enter a valid UTC end date (YYYY-MM-DD).';
  }
  if (fromMs > toMs) {
    return 'Start date (from) must be on or before end date (to).';
  }
  const inclusiveDays = Math.round((toMs - fromMs) / MS_PER_UTC_DAY) + 1;
  if (inclusiveDays > MAX_INCLUSIVE_UTC_DAYS) {
    return `Date range cannot exceed ${MAX_INCLUSIVE_UTC_DAYS} inclusive UTC days.`;
  }
  return null;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatNullableNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

const RANGE_PRESET_OPTIONS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '14d', label: 'Last 14 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: '90d', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom' },
] as const;

const GROUP_BY_OPTIONS = [
  { value: 'day', label: 'Day (UTC)' },
  { value: 'feature', label: 'Feature' },
  { value: 'provider', label: 'Provider' },
] as const;

/**
 * Screen 23 (`/admin`): Admin Dashboard & Usage Telemetry (`C09` §3.5, `R16`, `R30`, `PRD §50–§51`).
 * Defaults to Last 7 Days (inclusive UTC) with quick presets, aggregate counts/cost cards,
 * and `series.buckets` breakdown. Private learner content is strictly excluded.
 */
export function AdminUsageView({
  accessToken,
  initialTodayUtc,
}: AdminUsageViewProps) {
  const defaultRange = useMemo(
    () => getDefaultUtcDateRange(initialTodayUtc),
    [initialTodayUtc],
  );

  const [preset, setPreset] = useState<UsageRangePreset>('7d');
  const [fromInput, setFromInput] = useState(defaultRange.from);
  const [toInput, setToInput] = useState(defaultRange.to);
  const [groupByInput, setGroupByInput] = useState<AdminUsageGroupBy>('day');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const [usage, setUsage] = useState<UsageSummaryDTO | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageRefreshing, setUsageRefreshing] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  const usageAbortRef = useRef<AbortController | null>(null);
  const activeQueryRef = useRef<{
    from: string;
    to: string;
    group_by: AdminUsageGroupBy;
  }>({
    from: defaultRange.from,
    to: defaultRange.to,
    group_by: 'day',
  });

  const fetchUsage = useCallback(
    async (
      params: { from: string; to: string; group_by: AdminUsageGroupBy },
      isRefresh: boolean,
    ) => {
      activeQueryRef.current = params;
      usageAbortRef.current?.abort();
      const controller = new AbortController();
      usageAbortRef.current = controller;

      if (isRefresh) {
        setUsageRefreshing(true);
      } else {
        setUsageLoading(true);
      }
      setUsageError(null);

      try {
        const result = await getAdminUsage(accessToken, params, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setUsage(result);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setUsageError(mapApiError(err).message);
      } finally {
        if (!controller.signal.aborted) {
          setUsageLoading(false);
          setUsageRefreshing(false);
        }
      }
    },
    [accessToken],
  );

  // Initial mount / token refresh fetch — preserves active custom range & group_by,
  // aborts any prior interaction request, and cleans up on unmount.
  useEffect(() => {
    let active = true;
    usageAbortRef.current?.abort();
    const controller = new AbortController();
    usageAbortRef.current = controller;
    const query = activeQueryRef.current;

    void getAdminUsage(accessToken, query, { signal: controller.signal })
      .then((res) => {
        if (active && !controller.signal.aborted) {
          setUsage(res);
          setUsageLoading(false);
          setUsageRefreshing(false);
        }
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) {
          setUsageError(mapApiError(err).message);
          setUsageLoading(false);
          setUsageRefreshing(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
      usageAbortRef.current?.abort();
    };
  }, [accessToken]);

  const handleUsageSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const validationMsg = validateUtcDateRange(fromInput, toInput);
      if (validationMsg) {
        setRangeError(validationMsg);
        return;
      }
      setRangeError(null);
      void fetchUsage(
        {
          from: fromInput.trim(),
          to: toInput.trim(),
          group_by: groupByInput,
        },
        Boolean(usage),
      );
    },
    [fetchUsage, fromInput, toInput, groupByInput, usage],
  );

  const handlePresetChange = useCallback(
    (nextPreset: UsageRangePreset) => {
      setPreset(nextPreset);
      if (nextPreset === 'custom') return;
      const nextRange = getPresetUtcDateRange(nextPreset, initialTodayUtc);
      setFromInput(nextRange.from);
      setToInput(nextRange.to);
      setRangeError(null);
      void fetchUsage(
        {
          from: nextRange.from,
          to: nextRange.to,
          group_by: groupByInput,
        },
        Boolean(usage),
      );
    },
    [fetchUsage, groupByInput, initialTodayUtc, usage],
  );

  const handleGroupByChange = useCallback(
    (nextGroupBy: AdminUsageGroupBy) => {
      setGroupByInput(nextGroupBy);
      const validationMsg = validateUtcDateRange(fromInput, toInput);
      if (validationMsg) {
        setRangeError(validationMsg);
        return;
      }
      setRangeError(null);
      void fetchUsage(
        {
          from: fromInput.trim(),
          to: toInput.trim(),
          group_by: nextGroupBy,
        },
        Boolean(usage),
      );
    },
    [fetchUsage, fromInput, toInput, usage],
  );

  const maxBucketRequests = useMemo(() => {
    if (!usage) return 0;
    return usage.series.buckets.reduce(
      (max, bucket) => (bucket.requests > max ? bucket.requests : max),
      0,
    );
  }, [usage]);

  const bucketColumns = useMemo<
    readonly AdminDataTableColumn<UsageSeriesBucketDTO>[]
  >(
    () => [
      {
        key: 'key',
        header:
          usage?.series.group_by === 'feature'
            ? 'Feature'
            : usage?.series.group_by === 'provider'
              ? 'Provider'
              : 'UTC Date',
        align: 'left',
        render: (row) => (
          <span className="font-mono text-caption font-medium text-text-primary">
            {row.key}
          </span>
        ),
      },
      {
        key: 'requests',
        header: 'Requests',
        align: 'center',
        render: (row) => formatNumber(row.requests),
      },
      {
        key: 'failures',
        header: 'Failures',
        align: 'center',
        render: (row) => formatNullableNumber(row.failures),
      },
      {
        key: 'fallbacks_used',
        header: 'Fallbacks',
        align: 'center',
        render: (row) => formatNullableNumber(row.fallbacks_used),
      },
      {
        key: 'input_units',
        header: 'Input Units',
        align: 'center',
        render: (row) => formatNullableNumber(row.input_units),
      },
      {
        key: 'output_units',
        header: 'Output Units',
        align: 'center',
        render: (row) => formatNullableNumber(row.output_units),
      },
      {
        key: 'estimated_cost_usd',
        header: 'Est. Cost (USD)',
        align: 'right',
        render: (row) => formatUsd(row.estimated_cost_usd),
      },
    ],
    [usage?.series.group_by],
  );

  return (
    <main
      aria-labelledby="admin-dashboard-heading"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      {/* Clean Page Header */}
      <header className="flex flex-col gap-1.5 border-b border-border-default pb-6">
        <h1
          id="admin-dashboard-heading"
          className="text-heading-lg font-semibold text-text-primary"
        >
          Admin Dashboard
        </h1>
        <p className="max-w-xl text-body-sm text-text-secondary">
          Monitor platform usage and AI cost telemetry. Private learner content
          is excluded.
        </p>
      </header>

      {/* Retained Window Notice (R30) */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border border-feedback-info-border bg-feedback-info-background px-4 py-3 text-body-sm text-feedback-info-text"
      >
        <InfoIcon className="mt-0.5 h-4 w-4 text-feedback-info-icon" />
        <p>
          <strong>Retained data window:</strong> AI operational logs are
          retained for up to <strong>30 days</strong>. Requests older than the
          active retention window are purged and do not appear in historical AI
          totals or series buckets.
        </p>
      </div>

      {/* Aggregate Usage & Filter Bar */}
      <section
        aria-labelledby="usage-section-heading"
        className="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2
              id="usage-section-heading"
              className="inline-flex items-center gap-1.5 text-heading-md font-semibold text-text-primary"
            >
              <BarChartIcon className="h-5 w-5 text-action-primary-background" />
              <span>Aggregate Usage</span>
            </h2>
            {usage && (
              <p className="mt-0.5 text-caption text-text-secondary">
                Inclusive UTC range: {usage.range.from} to {usage.range.to}
              </p>
            )}
          </div>

          <form
            onSubmit={handleUsageSubmit}
            noValidate
            className="grid grid-cols-1 gap-3 rounded-xl border border-border-default bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-12 lg:items-end"
          >
            <div className="lg:col-span-2">
              <Select
                id="usage-range-preset"
                name="range_preset"
                label="Range"
                value={preset}
                options={RANGE_PRESET_OPTIONS}
                onChange={(e) =>
                  handlePresetChange(e.target.value as UsageRangePreset)
                }
              />
            </div>

            <DatePicker
              id="usage-from-date"
              label="From (UTC)"
              value={fromInput}
              clearable={false}
              className="lg:col-span-3"
              onChange={(next) => {
                setFromInput(next);
                setPreset('custom');
                if (rangeError) setRangeError(null);
              }}
            />

            <DatePicker
              id="usage-to-date"
              label="To (UTC)"
              value={toInput}
              clearable={false}
              className="lg:col-span-3"
              onChange={(next) => {
                setToInput(next);
                setPreset('custom');
                if (rangeError) setRangeError(null);
              }}
            />

            <div className="lg:col-span-2">
              <Select
                id="usage-group-by"
                name="group_by"
                label="Group by"
                value={groupByInput}
                options={GROUP_BY_OPTIONS}
                onChange={(e) =>
                  handleGroupByChange(e.target.value as AdminUsageGroupBy)
                }
              />
            </div>

            <div className="flex items-end lg:col-span-2">
              <Button
                type="submit"
                variant="primary"
                size="md"
                className="h-11 w-full shrink-0 whitespace-nowrap"
                loading={usageRefreshing}
              >
                Apply Range
              </Button>
            </div>
          </form>
        </div>

        {rangeError && (
          <Alert variant="error_retryable" role="alert">
            {rangeError}
          </Alert>
        )}

        {usageError && (
          <Alert variant="error_retryable" role="alert">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{usageError}</span>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  const validationMsg = validateUtcDateRange(
                    fromInput,
                    toInput,
                  );
                  if (validationMsg) {
                    setRangeError(validationMsg);
                    return;
                  }
                  void fetchUsage(
                    {
                      from: fromInput.trim(),
                      to: toInput.trim(),
                      group_by: groupByInput,
                    },
                    Boolean(usage),
                  );
                }}
              >
                <RefreshCwIcon className="h-4 w-4" />
                <span>Retry usage</span>
              </Button>
            </div>
          </Alert>
        )}

        {/* Metric Cards */}
        {usageLoading && !usage ? (
          <div
            data-testid="usage-metrics-skeleton"
            aria-busy="true"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="h-28 animate-pulse rounded-xl border border-border-default bg-surface-raised p-4 motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : usage ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Users"
              value={formatNumber(usage.users.total)}
              helper={`${formatNumber(usage.users.active_last_7_days)} active in last 7 days`}
            />
            <MetricCard
              label="Roadmaps Locked"
              value={formatNumber(usage.counts.roadmaps_locked)}
              helper="In selected UTC range"
            />
            <MetricCard
              label="Quizzes Submitted"
              value={formatNumber(usage.counts.quizzes_submitted)}
              helper="In selected UTC range"
            />
            <MetricCard
              label="Mentor Messages (Count)"
              value={formatNumber(usage.counts.mentor_messages)}
              helper="Aggregate count only — content excluded"
            />
            <MetricCard
              label="Tech Updates Generated"
              value={formatNumber(usage.counts.technology_updates_generated)}
              helper="In selected UTC range"
            />
            <MetricCard
              label="AI Requests"
              value={formatNumber(usage.ai.requests)}
              helper={`${formatNumber(usage.ai.failures)} failures · ${formatNumber(usage.ai.fallbacks_used)} fallbacks`}
            />
            <MetricCard
              label="AI Usage Units"
              value={formatNumber(
                usage.ai.usage_units.input + usage.ai.usage_units.output,
              )}
              helper={`${formatNumber(usage.ai.usage_units.input)} in · ${formatNumber(usage.ai.usage_units.output)} out`}
            />
            <MetricCard
              label="Estimated AI Cost"
              value={formatUsd(usage.ai.estimated_cost_usd)}
              helper="Within 30-day retained log window"
            />
          </div>
        ) : null}

        {/* Visual Series Breakdown */}
        {usage && usage.series.buckets.length > 0 && (
          <div className="rounded-xl border border-border-default bg-surface-raised p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-heading-sm font-semibold text-text-primary">
                AI Request Series ({usage.series.group_by})
              </h3>
              <span className="text-caption text-text-secondary">
                {usage.series.buckets.length}{' '}
                {usage.series.buckets.length === 1 ? 'bucket' : 'buckets'}
              </span>
            </div>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {usage.series.buckets.map((bucket) => {
                const widthPct =
                  maxBucketRequests > 0
                    ? Math.max(
                        bucket.requests > 0 ? 2 : 0,
                        Math.round((bucket.requests / maxBucketRequests) * 100),
                      )
                    : 0;
                return (
                  <div
                    key={bucket.key}
                    className="grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 text-caption"
                  >
                    <span className="truncate font-mono text-text-secondary">
                      {bucket.key}
                    </span>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-subtle">
                      <div
                        className="h-full rounded-full bg-action-primary-background transition-[width] duration-200"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="whitespace-nowrap font-mono tabular-nums text-text-primary">
                      {formatNumber(bucket.requests)} req ·{' '}
                      {formatUsd(bucket.estimated_cost_usd)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabular Series Breakdown */}
        <AdminDataTable
          regionLabel="AI usage series breakdown table"
          columns={bucketColumns}
          rows={usage?.series.buckets ?? []}
          rowKey={(row) => row.key}
          loading={usageLoading}
          refreshing={usageRefreshing}
          emptyTitle="No usage buckets in range"
          emptyDescription="Zero usage counts are valid for the selected range or dimension."
        />
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-xl border border-border-default bg-surface-raised p-4 shadow-xs">
      <span className="text-caption font-medium text-text-secondary">
        {label}
      </span>
      <span className="text-heading-lg font-semibold tabular-nums text-text-primary">
        {value}
      </span>
      <span className="text-caption text-text-tertiary">{helper}</span>
    </div>
  );
}
