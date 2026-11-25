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
  listAdminUsers,
  type AdminUserDetailDTO,
  type AdminUserStatus,
  type AdminUserSummaryDTO,
} from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  CheckCircleIcon,
  EyeIcon,
  LockIcon,
  RefreshCwIcon,
  SearchIcon,
} from '@/components/ui/icons';
import { Select } from '@/components/ui/select';
import { Toast } from '@/components/ui/toast';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from './admin-data-table';
import {
  formatAdminUserContact,
  formatAdminUtcTimestamp,
} from './admin-feature-labels';
import {
  AdminUserDetailDrawer,
  UserStatusBadge,
} from './admin-user-detail-drawer';
import { UserStatusModal } from './user-status-modal';

export type AdminUsersViewProps = {
  accessToken: string;
};

type UserFilterState = {
  q: string;
  status: 'all' | AdminUserStatus;
};

const DEFAULT_FILTERS: UserFilterState = {
  q: '',
  status: 'all',
};

const inputBaseClass =
  'h-11 min-h-11 w-full rounded-md border border-border-default bg-surface-default px-3 text-body text-text-primary placeholder:font-light placeholder:text-slate-500 transition-colors hover:border-border-strong focus:border-border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus dark:placeholder:text-slate-400';

/**
 * Screen 24 (`/admin/users`): Admin User Management (`C09` §3.5, `R16`, `PRD §7, §51`).
 * Supports search/status filtering, cursor pagination, aggregate-only user inspection,
 * and mandatory-reason suspend/reactivate workflows.
 */
export function AdminUsersView({ accessToken }: AdminUsersViewProps) {
  const [filtersDraft, setFiltersDraft] =
    useState<UserFilterState>(DEFAULT_FILTERS);
  const [activeFilters, setActiveFilters] =
    useState<UserFilterState>(DEFAULT_FILTERS);

  const [users, setUsers] = useState<AdminUserSummaryDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [updatedDetail, setUpdatedDetail] = useState<AdminUserDetailDTO | null>(
    null,
  );
  const [statusModalUser, setStatusModalUser] =
    useState<AdminUserDetailDTO | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const activeQueryRef = useRef<{
    filters: UserFilterState;
    cursor: string | undefined;
  }>({
    filters: DEFAULT_FILTERS,
    cursor: undefined,
  });

  const fetchUsers = useCallback(
    async (
      filters: UserFilterState,
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
        const res = await listAdminUsers(
          accessToken,
          {
            ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
            ...(filters.status !== 'all' ? { status: filters.status } : {}),
            limit: 20,
            ...(cursor ? { cursor } : {}),
          },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setUsers(res.items);
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

  // Initial mount / token refresh fetch — preserves active filters & pagination cursor.
  useEffect(() => {
    let active = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { filters, cursor } = activeQueryRef.current;

    void listAdminUsers(
      accessToken,
      {
        ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
        ...(filters.status !== 'all' ? { status: filters.status } : {}),
        limit: 20,
        ...(cursor ? { cursor } : {}),
      },
      { signal: controller.signal },
    )
      .then((res) => {
        if (active && !controller.signal.aborted) {
          setUsers(res.items);
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
      const next: UserFilterState = {
        q: filtersDraft.q.trim(),
        status: filtersDraft.status,
      };
      setActiveFilters(next);
      setCursorStack([]);
      setCurrentCursor(undefined);
      void fetchUsers(next, undefined, users.length > 0);
    },
    [fetchUsers, filtersDraft, users.length],
  );

  const handleStatusFilterChange = useCallback(
    (nextStatus: 'all' | AdminUserStatus) => {
      const next: UserFilterState = {
        q: filtersDraft.q.trim(),
        status: nextStatus,
      };
      setFiltersDraft((prev) => ({ ...prev, status: nextStatus }));
      setActiveFilters(next);
      setCursorStack([]);
      setCurrentCursor(undefined);
      void fetchUsers(next, undefined, users.length > 0);
    },
    [fetchUsers, filtersDraft.q, users.length],
  );

  const handleClearFilters = useCallback(() => {
    setFiltersDraft(DEFAULT_FILTERS);
    setActiveFilters(DEFAULT_FILTERS);
    setCursorStack([]);
    setCurrentCursor(undefined);
    void fetchUsers(DEFAULT_FILTERS, undefined, users.length > 0);
  }, [fetchUsers, users.length]);

  const handleNextPage = useCallback(() => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
    void fetchUsers(activeFilters, nextCursor, true);
  }, [activeFilters, currentCursor, fetchUsers, nextCursor]);

  const handlePreviousPage = useCallback(() => {
    if (cursorStack.length === 0) return;
    const prevCursor = cursorStack[cursorStack.length - 1];
    setCursorStack((prev) => prev.slice(0, -1));
    setCurrentCursor(prevCursor);
    void fetchUsers(activeFilters, prevCursor, true);
  }, [activeFilters, cursorStack, fetchUsers]);

  const handleStatusUpdated = useCallback(
    (updated: AdminUserDetailDTO) => {
      setStatusModalUser(null);
      setUpdatedDetail(updated);
      const contactLabel = formatAdminUserContact(updated);
      setToastMessage(
        updated.status === 'suspended'
          ? `Account ${contactLabel} has been suspended.`
          : `Account ${contactLabel} has been reactivated.`,
      );
      void fetchUsers(activeFilters, currentCursor, true);
    },
    [activeFilters, currentCursor, fetchUsers],
  );

  const isAtDefaultFilters =
    filtersDraft.q.trim() === '' &&
    filtersDraft.status === 'all' &&
    activeFilters.q === '' &&
    activeFilters.status === 'all';

  const columns = useMemo<readonly AdminDataTableColumn<AdminUserSummaryDTO>[]>(
    () => [
      {
        key: 'contact',
        header: 'Contact',
        align: 'left',
        render: (row) => {
          const email = row.email?.trim() || null;
          const phone = row.phone?.trim() || null;
          const primaryContact = email ?? phone ?? row.contact_masked;
          return (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-text-primary">
                {primaryContact}
              </span>
              {email && phone && (
                <span className="text-caption text-text-secondary">
                  {phone}
                </span>
              )}
              <span className="font-mono text-[11px] text-text-tertiary">
                {row.id.slice(0, 8)}…
              </span>
            </div>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        align: 'center',
        render: (row) => <UserStatusBadge status={row.status} />,
      },
      {
        key: 'roadmap_count',
        header: 'Roadmaps',
        align: 'center',
        render: (row) => row.roadmap_count.toLocaleString('en-US'),
      },
      {
        key: 'technology_update_enabled',
        header: 'Tech Updates',
        align: 'center',
        render: (row) =>
          row.technology_update_enabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-medium text-feedback-success-text">
              <CheckCircleIcon className="h-3.5 w-3.5" />
              <span>Enabled</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-caption font-medium text-text-secondary">
              <LockIcon className="h-3.5 w-3.5" />
              <span>Disabled</span>
            </span>
          ),
      },
      {
        key: 'created_at',
        header: 'Created (UTC)',
        align: 'center',
        render: (row) => (
          <span className="whitespace-nowrap font-mono text-caption text-text-secondary">
            {formatAdminUtcTimestamp(row.created_at)}
          </span>
        ),
      },
      {
        key: 'last_active_at',
        header: 'Last Active (UTC)',
        align: 'center',
        render: (row) => (
          <span className="whitespace-nowrap font-mono text-caption text-text-secondary">
            {formatAdminUtcTimestamp(row.last_active_at)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        render: (row) => (
          <div className="flex justify-end">
            <button
              type="button"
              aria-label={`Inspect ${formatAdminUserContact(row)}`}
              title="Inspect user"
              onClick={() => {
                setUpdatedDetail(null);
                setSelectedUserId(row.id);
              }}
              className="inline-flex h-10 w-10 min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg border border-border-default bg-surface-raised text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-subtle hover:text-text-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <EyeIcon className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <main
      aria-labelledby="admin-users-heading"
      className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8"
    >
      {toastMessage && (
        <Toast variant="success" onDismiss={() => setToastMessage(null)}>
          {toastMessage}
        </Toast>
      )}

      <header className="flex flex-col gap-1.5 border-b border-border-default pb-6">
        <h1
          id="admin-users-heading"
          className="text-heading-lg font-semibold text-text-primary"
        >
          Platform Users
        </h1>
        <p className="max-w-2xl text-body-sm text-text-secondary">
          Search user accounts, inspect aggregate activity and effective feature
          access, or suspend/reactivate accounts with a mandatory audit reason.
        </p>
      </header>

      {/* Search & Status Filter Bar */}
      <form
        onSubmit={handleApplyFilters}
        noValidate
        className="grid grid-cols-1 items-end gap-3 rounded-xl border border-border-default bg-surface-raised p-4 sm:grid-cols-12"
      >
        <div className="flex flex-col gap-1.5 sm:col-span-5">
          <label
            htmlFor="admin-users-search"
            className="text-label-lg text-text-primary"
          >
            Search by email, phone, or User UUID
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              id="admin-users-search"
              type="search"
              value={filtersDraft.q}
              onChange={(e) =>
                setFiltersDraft((prev) => ({ ...prev, q: e.target.value }))
              }
              placeholder="Search contact fragment or UUID…"
              className={`${inputBaseClass} pl-9`}
            />
          </div>
        </div>

        <div className="sm:col-span-3">
          <Select
            id="admin-users-status-filter"
            label="Account Status"
            value={filtersDraft.status}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
            ]}
            onChange={(e) =>
              handleStatusFilterChange(
                e.target.value as 'all' | AdminUserStatus,
              )
            }
          />
        </div>

        <div className="flex items-end gap-2 sm:col-span-4 sm:justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="h-11 shrink-0 whitespace-nowrap"
            loading={refreshing}
          >
            Search
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

      {error && (
        <Alert variant="error_retryable" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() =>
                void fetchUsers(activeFilters, currentCursor, users.length > 0)
              }
            >
              <RefreshCwIcon className="h-4 w-4" />
              <span>Retry</span>
            </Button>
          </div>
        </Alert>
      )}

      <AdminDataTable
        regionLabel="Admin users table"
        columns={columns}
        rows={users}
        rowKey={(row) => row.id}
        loading={loading}
        refreshing={refreshing}
        emptyTitle="No users matched your filters"
        emptyDescription="Try a different search fragment or clear active filters."
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

      <AdminUserDetailDrawer
        userId={selectedUserId}
        accessToken={accessToken}
        externalDetail={updatedDetail}
        disableEscape={Boolean(statusModalUser)}
        onClose={() => setSelectedUserId(null)}
        onRequestStatusChange={(detail) => setStatusModalUser(detail)}
      />

      <UserStatusModal
        open={Boolean(statusModalUser)}
        accessToken={accessToken}
        user={statusModalUser}
        onClose={() => setStatusModalUser(null)}
        onSuccess={handleStatusUpdated}
      />
    </main>
  );
}
