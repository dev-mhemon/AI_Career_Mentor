'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { listAdminAuditLogs, type AuditLogDTO } from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { RefreshCwIcon } from '@/components/ui/icons';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from './admin-data-table';
import { parseStrictUtcDateMs } from './admin-usage-view';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminAuditLogsViewProps = {
  accessToken: string;
};

type AuditFilters = {
  action: string;
  actor_id: string;
  target_user_id: string;
  from: string;
  to: string;
};

const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: '',
  actor_id: '',
  target_user_id: '',
  from: '',
  to: '',
};

function formatUtcTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${parsed.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function shortenUuid(id: string | null): string {
  if (!id) return '—';
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function summarizeStateRecord(record: Record<string, unknown> | null): string {
  if (!record) return 'none';
  const parts = Object.entries(record)
    .filter(([k]) => k !== 'reason')
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v === null ? 'inherit' : String(v)}`);
  return parts.length > 0 ? parts.join(', ') : 'recorded';
}

const textInputClass =
  'h-11 min-h-11 w-full rounded-md border border-border-default bg-surface-default px-3 text-body text-text-primary placeholder:font-light placeholder:text-slate-500 transition-colors hover:border-border-strong focus:border-border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus dark:placeholder:text-slate-400';

/**
 * Dedicated Admin Audit Logs page (`/admin/audit-logs`, `EP-AD07`, `R16`, `PRD §51`).
 * Displays filtered, keyset-paginated, immutable admin audit records with zero private user text.
 */
export function AdminAuditLogsView({ accessToken }: AdminAuditLogsViewProps) {
  const [filtersDraft, setFiltersDraft] =
    useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [activeFilters, setActiveFilters] =
    useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditLogDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const activeQueryRef = useRef<{
    filters: AuditFilters;
    cursor: string | undefined;
  }>({
    filters: EMPTY_AUDIT_FILTERS,
    cursor: undefined,
  });

  const fetchAuditLogs = useCallback(
    async (
      filters: AuditFilters,
      cursor: string | undefined,
      isRefresh: boolean,
    ) => {
      activeQueryRef.current = { filters, cursor };
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await listAdminAuditLogs(
          accessToken,
          {
            ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
            ...(filters.actor_id.trim()
              ? { actor_id: filters.actor_id.trim() }
              : {}),
            ...(filters.target_user_id.trim()
              ? { target_user_id: filters.target_user_id.trim() }
              : {}),
            ...(filters.from.trim()
              ? { from: `${filters.from.trim()}T00:00:00Z` }
              : {}),
            ...(filters.to.trim()
              ? { to: `${filters.to.trim()}T23:59:59Z` }
              : {}),
            limit: 20,
            ...(cursor ? { cursor } : {}),
          },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setAuditLogs(res.items);
          setNextCursor(res.meta.next_cursor);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(mapApiError(err).message);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [accessToken],
  );

  // Initial mount / token refresh load — preserves active filters & cursor, aborts on unmount.
  useEffect(() => {
    let active = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { filters, cursor } = activeQueryRef.current;

    void listAdminAuditLogs(
      accessToken,
      {
        ...(filters.action.trim() ? { action: filters.action.trim() } : {}),
        ...(filters.actor_id.trim()
          ? { actor_id: filters.actor_id.trim() }
          : {}),
        ...(filters.target_user_id.trim()
          ? { target_user_id: filters.target_user_id.trim() }
          : {}),
        ...(filters.from.trim()
          ? { from: `${filters.from.trim()}T00:00:00Z` }
          : {}),
        ...(filters.to.trim() ? { to: `${filters.to.trim()}T23:59:59Z` } : {}),
        limit: 20,
        ...(cursor ? { cursor } : {}),
      },
      { signal: controller.signal },
    )
      .then((res) => {
        if (active && !controller.signal.aborted) {
          setAuditLogs(res.items);
          setNextCursor(res.meta.next_cursor);
          setLoading(false);
          setRefreshing(false);
        }
      })
      .catch((err: unknown) => {
        if (active && !controller.signal.aborted) {
          setError(mapApiError(err).message);
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
      abortRef.current?.abort();
    };
  }, [accessToken]);

  const handleApplyFilters = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const actorTrimmed = filtersDraft.actor_id.trim();
      const targetTrimmed = filtersDraft.target_user_id.trim();
      const fromTrimmed = filtersDraft.from.trim();
      const toTrimmed = filtersDraft.to.trim();

      if (actorTrimmed && !UUID_PATTERN.test(actorTrimmed)) {
        setFilterError('Actor ID must be a valid UUID.');
        return;
      }
      if (targetTrimmed && !UUID_PATTERN.test(targetTrimmed)) {
        setFilterError('Target User ID must be a valid UUID.');
        return;
      }
      if (fromTrimmed && toTrimmed) {
        const fromMs = parseStrictUtcDateMs(fromTrimmed);
        const toMs = parseStrictUtcDateMs(toTrimmed);
        if (fromMs === null || toMs === null || fromMs > toMs) {
          setFilterError(
            'Audit log start date must be on or before end date.',
          );
          return;
        }
      }

      setFilterError(null);
      const nextFilters: AuditFilters = {
        action: filtersDraft.action.trim(),
        actor_id: actorTrimmed,
        target_user_id: targetTrimmed,
        from: fromTrimmed,
        to: toTrimmed,
      };
      setActiveFilters(nextFilters);
      setCursorStack([]);
      setCurrentCursor(undefined);
      void fetchAuditLogs(nextFilters, undefined, auditLogs.length > 0);
    },
    [auditLogs.length, fetchAuditLogs, filtersDraft],
  );

  const handleClearFilters = useCallback(() => {
    setFiltersDraft(EMPTY_AUDIT_FILTERS);
    setActiveFilters(EMPTY_AUDIT_FILTERS);
    setFilterError(null);
    setCursorStack([]);
    setCurrentCursor(undefined);
    void fetchAuditLogs(EMPTY_AUDIT_FILTERS, undefined, auditLogs.length > 0);
  }, [auditLogs.length, fetchAuditLogs]);

  const handleNextPage = useCallback(() => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
    void fetchAuditLogs(activeFilters, nextCursor, true);
  }, [activeFilters, currentCursor, fetchAuditLogs, nextCursor]);

  const handlePreviousPage = useCallback(() => {
    if (cursorStack.length === 0) return;
    const prevCursor = cursorStack[cursorStack.length - 1];
    setCursorStack((prev) => prev.slice(0, -1));
    setCurrentCursor(prevCursor);
    void fetchAuditLogs(activeFilters, prevCursor, true);
  }, [activeFilters, cursorStack, fetchAuditLogs]);

  const isAtDefaultFilters =
    filtersDraft.action.trim() === '' &&
    filtersDraft.actor_id.trim() === '' &&
    filtersDraft.target_user_id.trim() === '' &&
    filtersDraft.from.trim() === '' &&
    filtersDraft.to.trim() === '' &&
    activeFilters.action === '' &&
    activeFilters.actor_id === '' &&
    activeFilters.target_user_id === '' &&
    activeFilters.from === '' &&
    activeFilters.to === '';

  const auditColumns = useMemo<readonly AdminDataTableColumn<AuditLogDTO>[]>(
    () => [
      {
        key: 'created_at',
        header: 'Timestamp (UTC)',
        align: 'left',
        render: (row) => (
          <span className="whitespace-nowrap font-mono text-caption text-text-secondary">
            {formatUtcTimestamp(row.created_at)}
          </span>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        align: 'center',
        render: (row) => (
          <span className="inline-flex items-center rounded-md border border-border-default bg-surface-subtle px-2 py-0.5 font-mono text-caption font-medium text-text-primary">
            {row.action}
          </span>
        ),
      },
      {
        key: 'actor_id',
        header: 'Actor',
        align: 'center',
        render: (row) => (
          <span
            className="font-mono text-caption text-text-secondary"
            title={row.actor_id ?? undefined}
          >
            {shortenUuid(row.actor_id)}
          </span>
        ),
      },
      {
        key: 'target',
        header: 'Target',
        align: 'center',
        render: (row) => (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-caption font-medium text-text-primary">
              {row.target_type ?? '—'}
            </span>
            <span
              className="font-mono text-caption text-text-tertiary"
              title={row.target_id ?? undefined}
            >
              {shortenUuid(row.target_id)}
            </span>
          </div>
        ),
      },
      {
        key: 'diff',
        header: 'Before → After',
        align: 'center',
        render: (row) => (
          <div className="flex flex-wrap items-center justify-center gap-1.5 text-caption">
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-text-secondary">
              {summarizeStateRecord(row.before)}
            </span>
            <span aria-hidden="true" className="text-text-tertiary">
              →
            </span>
            <span className="rounded bg-feedback-info-background px-1.5 py-0.5 font-mono text-feedback-info-text">
              {summarizeStateRecord(row.after)}
            </span>
          </div>
        ),
      },
      {
        key: 'request_id',
        header: 'Request ID',
        align: 'right',
        render: (row) => (
          <span
            className="font-mono text-caption text-text-tertiary"
            title={row.request_id ?? undefined}
          >
            {shortenUuid(row.request_id)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <main
      aria-labelledby="admin-audit-logs-heading"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      <header className="flex flex-col gap-1.5 border-b border-border-default pb-6">
        <h1
          id="admin-audit-logs-heading"
          className="text-heading-lg font-semibold text-text-primary"
        >
          Admin Audit Logs
        </h1>
        <p className="max-w-xl text-body-sm text-text-secondary">
          Immutable, append-only record of every administrative status and
          feature-control write.
        </p>
      </header>

      <form
        onSubmit={handleApplyFilters}
        noValidate
        className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border-default bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label
            htmlFor="audit-action-filter"
            className="text-label-lg text-text-primary"
          >
            Action
          </label>
          <input
            id="audit-action-filter"
            type="text"
            placeholder="e.g. user.suspend"
            value={filtersDraft.action}
            onChange={(e) =>
              setFiltersDraft((prev) => ({
                ...prev,
                action: e.target.value,
              }))
            }
            className={textInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label
            htmlFor="audit-actor-filter"
            className="text-label-lg text-text-primary"
          >
            Actor UUID
          </label>
          <input
            id="audit-actor-filter"
            type="text"
            placeholder="Admin UUID"
            value={filtersDraft.actor_id}
            onChange={(e) =>
              setFiltersDraft((prev) => ({
                ...prev,
                actor_id: e.target.value,
              }))
            }
            className={textInputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label
            htmlFor="audit-target-filter"
            className="text-label-lg text-text-primary"
          >
            Target User UUID
          </label>
          <input
            id="audit-target-filter"
            type="text"
            placeholder="Target user UUID"
            value={filtersDraft.target_user_id}
            onChange={(e) =>
              setFiltersDraft((prev) => ({
                ...prev,
                target_user_id: e.target.value,
              }))
            }
            className={textInputClass}
          />
        </div>

        <DatePicker
          id="audit-from-filter"
          label="Audit From (UTC)"
          placeholder="Start date"
          value={filtersDraft.from}
          clearable={true}
          className="lg:col-span-2"
          onChange={(next) =>
            setFiltersDraft((prev) => ({
              ...prev,
              from: next,
            }))
          }
        />

        <DatePicker
          id="audit-to-filter"
          label="Audit To (UTC)"
          placeholder="End date"
          value={filtersDraft.to}
          clearable={true}
          className="lg:col-span-2"
          onChange={(next) =>
            setFiltersDraft((prev) => ({
              ...prev,
              to: next,
            }))
          }
        />

        <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="h-11 shrink-0 whitespace-nowrap"
            loading={refreshing}
          >
            Filter
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="h-11 shrink-0 whitespace-nowrap"
            disabled={isAtDefaultFilters}
            onClick={handleClearFilters}
          >
            Clear filters
          </Button>
        </div>
      </form>

      {filterError && (
        <Alert variant="error_retryable" role="alert">
          {filterError}
        </Alert>
      )}

      {error && (
        <Alert variant="error_retryable" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() =>
                void fetchAuditLogs(
                  activeFilters,
                  currentCursor,
                  auditLogs.length > 0,
                )
              }
            >
              <RefreshCwIcon className="h-4 w-4" />
              <span>Retry audit logs</span>
            </Button>
          </div>
        </Alert>
      )}

      <AdminDataTable
        regionLabel="Admin audit logs table"
        columns={auditColumns}
        rows={auditLogs}
        rowKey={(row) => row.id}
        loading={loading}
        refreshing={refreshing}
        emptyTitle="No matching audit activity"
        emptyDescription="No administrative audit records matched the current filters."
        onClearFilters={!isAtDefaultFilters ? handleClearFilters : undefined}
        pagination={{
          hasPrevious: cursorStack.length > 0,
          hasNext: Boolean(nextCursor),
          onPrevious: handlePreviousPage,
          onNext: handleNextPage,
          loading: refreshing,
          pageLabel: `Page ${cursorStack.length + 1}`,
        }}
      />
    </main>
  );
}
