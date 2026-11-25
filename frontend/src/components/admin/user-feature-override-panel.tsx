'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  getAdminUser,
  listAdminUsers,
  updateUserFeatureOverride,
  type AdminFeatureKey,
  type AdminUserDetailDTO,
  type AdminUserSummaryDTO,
} from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  CloseIcon,
  LockIcon,
  RefreshCwIcon,
  SearchIcon,
  SpinnerIcon,
} from '@/components/ui/icons';
import {
  ADMIN_FEATURE_META_BY_KEY,
  formatAdminUserContact,
} from './admin-feature-labels';
import { UserStatusBadge } from './admin-user-detail-drawer';

const SEARCH_DEBOUNCE_MS = 350;

export type UserFeatureOverridePanelProps = {
  accessToken: string;
  initialUserId?: string | null;
  globalRefreshNonce: number;
  onOverrideSaved: (message: string) => void;
};

const inputBaseClass =
  'h-11 min-h-11 w-full rounded-md border border-border-default bg-surface-default px-3 text-body text-text-primary placeholder:font-light placeholder:text-slate-500 transition-colors hover:border-border-strong focus:border-border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus dark:placeholder:text-slate-400';

/**
 * Per-user feature override panel (`EP-AD01`, `EP-AD02`, `EP-AD06`) inside Screen 25 (`/admin/features`).
 * Supports `350ms` debounced live user search (rate-limit safe with `AbortController`), `?userId=` deep-links,
 * zero-shake fixed-width 3-state controls (`Enabled` / `Disabled` / `Inherit(null)`), and automatic reload
 * whenever global feature controls change.
 */
export function UserFeatureOverridePanel({
  accessToken,
  initialUserId = null,
  globalRefreshNonce,
  onOverrideSaved,
}: UserFeatureOverridePanelProps) {
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<AdminUserSummaryDTO[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchExecuted, setSearchExecuted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    initialUserId,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const executeSearch = useCallback(
    async (query: string) => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setSearchLoading(true);
      setSearchError(null);

      try {
        const res = await listAdminUsers(
          accessToken,
          { q: query, limit: 10 },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setSearchResults(res.items);
          setSearchExecuted(true);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setSearchError(mapApiError(err).message);
        setSearchExecuted(true);
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    },
    [accessToken],
  );

  const handleSearchInputChange = useCallback(
    (nextValue: string) => {
      setSearchInput(nextValue);
      // Immediately clear the active user selection (unmounting & aborting any in-flight EP-AD02 fetch)
      // so the previously inspected user cannot be accidentally edited while searching for another user.
      setSelectedUserId(null);

      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      const trimmed = nextValue.trim();
      if (!trimmed) {
        searchAbortRef.current?.abort();
        searchAbortRef.current = null;
        setSearchResults([]);
        setSearchExecuted(false);
        setSearchLoading(false);
        setSearchError(null);
        return;
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void executeSearch(trimmed);
      }, SEARCH_DEBOUNCE_MS);
    },
    [executeSearch],
  );

  const handleSelectUser = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setSearchResults([]);
    setSearchExecuted(false);
    setSearchError(null);
  }, []);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSelectedUserId(null);
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const trimmed = searchInput.trim();
      if (!trimmed) return;
      void executeSearch(trimmed);
    },
    [executeSearch, searchInput],
  );

  const handleClearSearch = useCallback(() => {
    handleSearchInputChange('');
    inputRef.current?.focus();
  }, [handleSearchInputChange]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      searchAbortRef.current?.abort();
    };
  }, []);

  return (
    <section
      aria-labelledby="user-overrides-heading"
      className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="user-overrides-heading"
          className="text-heading-md font-semibold text-text-primary"
        >
          Per-User Feature Overrides
        </h2>
        <p className="text-body-sm text-text-secondary">
          Search a user account to enable, disable, or inherit individual
          feature access (including enabling Daily Technology Updates per user).
        </p>
      </div>

      {/* Cohesive max-w-xl Live Debounced Search + Matching Results */}
      <div className="flex w-full max-w-xl flex-col gap-2">
        <form onSubmit={handleSearchSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="override-user-search"
              className="text-label-lg text-text-primary"
            >
              Find user (email, phone fragment, or UUID)
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <input
                ref={inputRef}
                id="override-user-search"
                type="text"
                autoComplete="off"
                value={searchInput}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                placeholder="Type email, phone fragment, or UUID…"
                className={cn(inputBaseClass, 'pl-9 pr-16')}
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {searchLoading && (
                  <SpinnerIcon
                    aria-label="Searching users"
                    className="h-4 w-4 text-action-primary-background"
                  />
                )}
                {searchInput.length > 0 && (
                  <button
                    type="button"
                    aria-label="Clear user search"
                    onClick={handleClearSearch}
                    className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-subtle hover:text-text-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>

        {searchError && (
          <Alert variant="error_retryable" role="alert">
            {searchError}
          </Alert>
        )}

        {searchExecuted &&
          !searchLoading &&
          searchResults.length === 0 &&
          !searchError &&
          searchInput.trim().length > 0 && (
            <p className="rounded-xl border border-border-default bg-surface-subtle/50 px-3.5 py-2.5 text-body-sm text-text-secondary">
              No matching users found. Try another contact fragment or UUID.
            </p>
          )}

        {searchResults.length > 0 && (
          <ul
            aria-label="Matching users"
            className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900"
          >
            {searchResults.map((user) => {
              const isSelected = selectedUserId === user.id;
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => handleSelectUser(user.id)}
                    className={cn(
                      'flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-focus',
                      isSelected
                        ? 'bg-teal-50/75 dark:bg-teal-950/35'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-body-sm font-medium text-text-primary">
                        {formatAdminUserContact(user)}
                      </div>
                      <div className="truncate font-mono text-[11px] text-text-tertiary">
                        {user.id}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isSelected && (
                        <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300">
                          Selected
                        </span>
                      )}
                      <UserStatusBadge status={user.status} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedUserId ? (
        <SelectedUserOverrideMatrix
          key={selectedUserId}
          userId={selectedUserId}
          accessToken={accessToken}
          globalRefreshNonce={globalRefreshNonce}
          onOverrideSaved={onOverrideSaved}
          onChangeUser={handleClearSearch}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border-default px-4 py-6 text-center text-body-sm text-text-secondary">
          Search and select a user above to inspect and manage their per-user
          feature overrides.
        </div>
      )}
    </section>
  );
}

type SelectedUserOverrideMatrixProps = {
  userId: string;
  accessToken: string;
  globalRefreshNonce: number;
  onOverrideSaved: (message: string) => void;
  onChangeUser: () => void;
};

function SelectedUserOverrideMatrix({
  userId,
  accessToken,
  globalRefreshNonce,
  onOverrideSaved,
  onChangeUser,
}: SelectedUserOverrideMatrixProps) {
  const [detail, setDetail] = useState<AdminUserDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<AdminFeatureKey | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const mountedRef = useRef(true);
  const activeTokenRef = useRef(accessToken);
  const detailAbortRef = useRef<AbortController | null>(null);
  const mutationEpochRef = useRef(0);

  useEffect(() => {
    activeTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Loads EP-AD02 on mount, on retry, or whenever a global feature flag changes.
  // Coordinates with mutationEpochRef so an older in-flight GET can never overwrite a newer PATCH.
  useEffect(() => {
    let active = true;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    const fetchEpoch = mutationEpochRef.current;

    void getAdminUser(accessToken, userId, { signal: controller.signal })
      .then((res) => {
        if (detailAbortRef.current === controller) {
          detailAbortRef.current = null;
        }
        if (
          active &&
          !controller.signal.aborted &&
          mutationEpochRef.current === fetchEpoch
        ) {
          setDetail(res);
          setLoadError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (detailAbortRef.current === controller) {
          detailAbortRef.current = null;
        }
        if (
          active &&
          !controller.signal.aborted &&
          mutationEpochRef.current === fetchEpoch
        ) {
          setLoadError(mapApiError(err).message);
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (detailAbortRef.current === controller) {
        detailAbortRef.current = null;
      }
    };
  }, [accessToken, userId, globalRefreshNonce, retryNonce]);

  const handleSelectOverride = useCallback(
    async (featureKey: AdminFeatureKey, nextValue: boolean | null) => {
      if (savingKey !== null) return;
      const abortPendingDetail = () => {
        detailAbortRef.current?.abort();
        detailAbortRef.current = null;
      };
      // Invalidate & abort any older in-flight GET reload so it cannot overwrite this mutation.
      const abortedPendingReload = detailAbortRef.current !== null;
      mutationEpochRef.current += 1;
      abortPendingDetail();

      setSavingKey(featureKey);
      setMutationError(null);

      const requestToken = activeTokenRef.current;
      try {
        const updated = await updateUserFeatureOverride(requestToken, userId, {
          feature_key: featureKey,
          enabled: nextValue,
        });
        if (!mountedRef.current) {
          return;
        }
        if (activeTokenRef.current !== requestToken) {
          setRetryNonce((n) => n + 1);
          return;
        }
        // Reject any detail GET issued before this write committed.
        mutationEpochRef.current += 1;
        abortPendingDetail();
        setDetail(updated);
        const label = ADMIN_FEATURE_META_BY_KEY[featureKey]?.label ?? featureKey;
        const stateText =
          nextValue === null
            ? 'Inherit default'
            : nextValue
              ? 'Enabled'
              : 'Disabled';
        onOverrideSaved(`Updated ${label} override to ${stateText}.`);
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        if (activeTokenRef.current !== requestToken) {
          if (abortedPendingReload) {
            setRetryNonce((n) => n + 1);
          }
          return;
        }
        // Pessimistic: preserve override error and resume any aborted detail reload.
        setMutationError(mapApiError(err).message);
        if (abortedPendingReload) {
          setRetryNonce((n) => n + 1);
        }
      } finally {
        if (mountedRef.current) {
          setSavingKey(null);
        }
      }
    },
    [onOverrideSaved, savingKey, userId],
  );

  if (loading && !detail) {
    return (
      <div
        data-testid="user-override-skeleton"
        aria-busy="true"
        className="flex flex-col gap-3"
      >
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="h-14 animate-pulse rounded-lg bg-surface-subtle motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (loadError && !detail) {
    return (
      <Alert variant="error_retryable" role="alert">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{loadError}</span>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              setLoading(true);
              setLoadError(null);
              setRetryNonce((n) => n + 1);
            }}
          >
            <RefreshCwIcon className="h-4 w-4" />
            <span>Retry user</span>
          </Button>
        </div>
      </Alert>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex flex-col gap-4 border-t border-border-default pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body-md font-semibold text-text-primary">
            {formatAdminUserContact(detail)}
          </p>
          <p className="font-mono text-caption text-text-tertiary">
            {detail.id}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <UserStatusBadge status={detail.status} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9 shrink-0 whitespace-nowrap"
            onClick={onChangeUser}
          >
            Change user
          </Button>
        </div>
      </div>

      {detail.status === 'suspended' && (
        <Alert variant="warning">
          This account is <strong>suspended</strong>. System suspension
          overrides all feature permissions — effective access remains OFF until
          the account is reactivated.
        </Alert>
      )}

      {mutationError && (
        <Alert variant="error_retryable" role="alert">
          {mutationError}
        </Alert>
      )}

      <div
        role="region"
        aria-label="Per-user feature overrides table"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border border-border-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <table className="w-full min-w-[640px] border-collapse text-left text-body-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface-subtle text-caption font-semibold uppercase tracking-wider text-text-secondary">
              <th scope="col" className="px-4 py-3 text-left">
                Feature
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                Global
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                User Override
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Effective Access
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {detail.feature_access.map((entry) => {
              const meta = ADMIN_FEATURE_META_BY_KEY[entry.feature_key];
              const isRowSaving = savingKey === entry.feature_key;
              const rowDisabled = savingKey !== null;
              const options: Array<{
                label: string;
                value: boolean | null;
              }> = [
                { label: 'Enabled', value: true },
                { label: 'Disabled', value: false },
                { label: 'Inherit', value: null },
              ];

              return (
                <tr key={entry.feature_key}>
                  <td className="px-4 py-3 text-left align-middle">
                    <div className="font-medium text-text-primary">
                      {meta?.label ?? entry.feature_key}
                    </div>
                    <div className="font-mono text-caption text-text-tertiary">
                      {entry.feature_key}
                      {meta && !meta.defaultUserEnabled
                        ? ' · default OFF'
                        : ' · default ON'}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-center align-middle text-caption">
                    <span
                      className={
                        entry.global_enabled
                          ? 'inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                      }
                    >
                      {entry.global_enabled ? 'Global ON' : 'Global OFF'}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-center align-middle">
                    <div
                      role="group"
                      aria-label={`${meta?.label ?? entry.feature_key} override`}
                      aria-busy={isRowSaving ? 'true' : undefined}
                      className={cn(
                        'inline-grid w-[252px] grid-cols-3 rounded-xl border border-slate-200 bg-slate-50 p-1 transition-opacity duration-150 dark:border-slate-700 dark:bg-slate-800/70',
                        isRowSaving && 'cursor-wait opacity-65',
                      )}
                    >
                      {options.map((opt) => {
                        const selected = entry.user_override === opt.value;
                        const activeClass =
                          opt.value === true
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : opt.value === false
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'bg-slate-700 text-white shadow-xs';
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            aria-pressed={selected}
                            disabled={rowDisabled || selected}
                            onClick={() =>
                              void handleSelectOverride(
                                entry.feature_key,
                                opt.value,
                              )
                            }
                            className={cn(
                              'inline-flex h-9 w-full cursor-pointer items-center justify-center rounded-lg px-2 text-caption font-medium transition-colors duration-150 ease-out focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed',
                              selected
                                ? activeClass
                                : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary disabled:opacity-60',
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>

                  <td className="px-4 py-3 text-right align-middle">
                    {entry.effective ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-caption font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <CheckCircleIcon className="h-3.5 w-3.5" />
                        <span>Effective ON</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-caption font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300">
                        <LockIcon className="h-3.5 w-3.5" />
                        <span>Effective OFF</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
