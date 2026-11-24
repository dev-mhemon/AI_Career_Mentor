'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getTechnologyUpdate,
  listTechnologyUpdates,
  markTechnologyUpdateViewed,
  type TechnologyUpdateDTO,
  type TechnologyUpdateListDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AIExplanationCard } from '@/components/learning/ai-explanation-card';
import {
  ACTION_TIMING_LABELS,
  formatTechUpdateTimestamp,
  getActionTimingChipClass,
  getReleaseStatusChipClass,
  getRelevanceChipClass,
  getSafeExternalHttpUrl,
  RELEASE_STATUS_LABELS,
  RELEVANCE_LEVEL_LABELS,
} from './tech-update-card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompassIcon,
  ExternalLinkIcon,
  RadioIcon,
  RefreshCwIcon,
  SparklesIcon,
  SpinnerIcon,
} from '@/components/ui/icons';

function BroadcastOffIcon({ className }: { className?: string }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
      className={cn('block h-5 w-5 shrink-0', className)}
    >
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c1.4 1.4 2 3.4 1.6 5.2" />
      <path d="M19.1 4.9c2.5 2.5 3.4 6.1 2.7 9.4" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export type TechUpdatesFilter = 'all' | 'high_relevance' | 'unread';

export type TechUpdatesViewProps = {
  accessToken: string;
  technologyUpdateEnabled: boolean;
};

type ScopedListState = {
  token: string;
  status: 'loading' | 'ready' | 'feature_disabled' | 'error';
  listData: TechnologyUpdateListDTO | null;
  nextCursor: string | null;
  error: MappedError | null;
};

const NO_IMPORTANT_CHANGES_FALLBACK =
  'No important changes for your current learning path today.';
const TEMPORARILY_UNAVAILABLE_FALLBACK =
  'Technology updates are temporarily unavailable.';

/**
 * Screen 21 (`/tech-updates`) client workspace (`C09` §3.4 Screen 21, `C05` §14.11 `EP-T01`–`EP-T03`, `R25`).
 */
export function TechUpdatesView({
  accessToken,
  technologyUpdateEnabled,
}: TechUpdatesViewProps) {
  const [reloadTick, setReloadTick] = useState(0);
  const [activeFilter, setActiveFilter] = useState<TechUpdatesFilter>('all');
  const [subscribeNoticeOpen, setSubscribeNoticeOpen] = useState(false);
  const [scopedState, setScopedState] = useState<ScopedListState>(() => ({
    token: accessToken,
    status: technologyUpdateEnabled ? 'loading' : 'feature_disabled',
    listData: null,
    nextCursor: null,
    error: null,
  }));

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<MappedError | null>(null);
  const [markingViewedIds, setMarkingViewedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [actionError, setActionError] = useState<MappedError | null>(null);

  const [detailModal, setDetailModal] = useState<{
    token: string;
    updateId: string;
    seedUpdate: TechnologyUpdateDTO;
    detailUpdate: TechnologyUpdateDTO | null;
    loading: boolean;
    error: MappedError | null;
  } | null>(null);

  const fetchGenRef = useRef(0);
  const loadMoreGenRef = useRef(0);
  const detailGenRef = useRef(0);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogContainerRef = useRef<HTMLDivElement | null>(null);
  const dialogCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!technologyUpdateEnabled) {
      return;
    }
    const gen = ++fetchGenRef.current;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await listTechnologyUpdates(accessToken, {
          limit: 20,
          signal: controller.signal,
        });
        if (controller.signal.aborted || gen !== fetchGenRef.current) {
          return;
        }
        setScopedState({
          token: accessToken,
          status: 'ready',
          listData: res.data,
          nextCursor: res.meta.next_cursor,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted || gen !== fetchGenRef.current) {
          return;
        }
        const mapped = mapApiError(err, { feature: 'technology_update' });
        if (mapped.code === 'FEATURE_DISABLED' || mapped.status === 403) {
          setScopedState({
            token: accessToken,
            status: 'feature_disabled',
            listData: null,
            nextCursor: null,
            error: mapped,
          });
          return;
        }
        setScopedState({
          token: accessToken,
          status: 'error',
          listData: null,
          nextCursor: null,
          error: mapped,
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [accessToken, technologyUpdateEnabled, reloadTick]);

  // Focus management, Tab focus trap, and Escape key handler for the EP-T02 detail inspection dialog
  const isDetailModalOpen = detailModal !== null;
  useEffect(() => {
    if (!isDetailModalOpen) {
      return;
    }
    const closeBtn = dialogCloseButtonRef.current;
    if (closeBtn && typeof closeBtn.focus === 'function') {
      closeBtn.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDetailModal(null);
        const trigger = lastTriggerRef.current;
        if (trigger && typeof trigger.focus === 'function') {
          trigger.focus();
        }
        return;
      }

      if (event.key === 'Tab') {
        const container = dialogContainerRef.current;
        if (!container) {
          return;
        }
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (!active || !container.contains(active) || active === first) {
            event.preventDefault();
            last.focus();
          }
        } else if (!active || !container.contains(active) || active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDetailModalOpen]);

  const effectiveStatus: ScopedListState['status'] = !technologyUpdateEnabled
    ? 'feature_disabled'
    : scopedState.token !== accessToken
      ? 'loading'
      : scopedState.status;

  const listData =
    scopedState.token === accessToken ? scopedState.listData : null;
  const nextCursor =
    scopedState.token === accessToken ? scopedState.nextCursor : null;
  const initialError =
    scopedState.token === accessToken ? scopedState.error : null;

  const items = useMemo(() => listData?.items ?? [], [listData]);

  const highRelevanceCount = useMemo(
    () => items.filter((item) => item.relevance === 'high').length,
    [items],
  );
  const unreadCount = useMemo(
    () => items.filter((item) => !item.viewed).length,
    [items],
  );

  const filteredItems = useMemo(() => {
    switch (activeFilter) {
      case 'high_relevance':
        return items.filter((item) => item.relevance === 'high');
      case 'unread':
        return items.filter((item) => !item.viewed);
      case 'all':
      default:
        return items;
    }
  }, [items, activeFilter]);

  const handleRetryInitial = () => {
    setActionError(null);
    setLoadMoreError(null);
    setScopedState((prev) => ({
      ...prev,
      token: accessToken,
      status: 'loading',
      error: null,
    }));
    setReloadTick((prev) => prev + 1);
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) {
      return;
    }
    const requestToken = accessToken;
    const gen = ++loadMoreGenRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await listTechnologyUpdates(requestToken, {
        limit: 20,
        cursor: nextCursor,
      });
      if (gen !== loadMoreGenRef.current) {
        return;
      }
      setScopedState((prev) => {
        if (prev.token !== requestToken || !prev.listData) {
          return prev;
        }
        const existingIds = new Set(prev.listData.items.map((item) => item.id));
        const appended = res.data.items.filter(
          (item) => !existingIds.has(item.id),
        );
        return {
          ...prev,
          listData: {
            ...prev.listData,
            items: [...prev.listData.items, ...appended],
          },
          nextCursor: res.meta.next_cursor,
        };
      });
    } catch (err) {
      if (gen !== loadMoreGenRef.current || requestToken !== accessToken) {
        return;
      }
      setLoadMoreError(mapApiError(err, { feature: 'technology_update' }));
    } finally {
      if (gen === loadMoreGenRef.current) {
        setLoadingMore(false);
      }
    }
  };

  const handleMarkViewed = async (update: TechnologyUpdateDTO) => {
    if (update.viewed || markingViewedIds.has(update.id)) {
      return;
    }
    const requestToken = accessToken;
    setActionError(null);
    setDetailModal((prev) =>
      prev && prev.updateId === update.id ? { ...prev, error: null } : prev,
    );
    setMarkingViewedIds((prev) => {
      const next = new Set(prev);
      next.add(update.id);
      return next;
    });

    try {
      const viewedRes = await markTechnologyUpdateViewed(
        requestToken,
        update.id,
      );
      setScopedState((prev) => {
        if (prev.token !== requestToken || !prev.listData) {
          return prev;
        }
        return {
          ...prev,
          listData: {
            ...prev.listData,
            items: prev.listData.items.map((item) =>
              item.id === viewedRes.id ? { ...item, viewed: true } : item,
            ),
          },
        };
      });
      setDetailModal((prev) => {
        if (
          !prev ||
          prev.token !== requestToken ||
          prev.updateId !== viewedRes.id
        ) {
          return prev;
        }
        return {
          ...prev,
          seedUpdate: { ...prev.seedUpdate, viewed: true },
          detailUpdate: prev.detailUpdate
            ? { ...prev.detailUpdate, viewed: true }
            : null,
        };
      });
    } catch (err) {
      if (requestToken !== accessToken) {
        return;
      }
      const mapped = mapApiError(err, { feature: 'technology_update' });
      setActionError(mapped);
      setDetailModal((prev) =>
        prev && prev.token === requestToken && prev.updateId === update.id
          ? { ...prev, error: mapped }
          : prev,
      );
    } finally {
      setMarkingViewedIds((prev) => {
        const next = new Set(prev);
        next.delete(update.id);
        return next;
      });
    }
  };

  const handleInspectDetail = (
    update: TechnologyUpdateDTO,
    triggerEl: HTMLButtonElement | null,
  ) => {
    lastTriggerRef.current = triggerEl;
    const requestToken = accessToken;
    const gen = ++detailGenRef.current;
    setDetailModal({
      token: requestToken,
      updateId: update.id,
      seedUpdate: update,
      detailUpdate: null,
      loading: true,
      error: null,
    });

    void (async () => {
      try {
        const freshDetail = await getTechnologyUpdate(requestToken, update.id);
        if (gen !== detailGenRef.current) {
          return;
        }
        setDetailModal((prev) => {
          if (
            !prev ||
            prev.token !== requestToken ||
            prev.updateId !== update.id
          ) {
            return prev;
          }
          const preservedViewed =
            prev.seedUpdate.viewed ||
            Boolean(prev.detailUpdate?.viewed) ||
            freshDetail.viewed;
          return {
            ...prev,
            detailUpdate: {
              ...freshDetail,
              viewed: preservedViewed,
            },
            loading: false,
            error: null,
          };
        });
        setScopedState((prev) => {
          if (prev.token !== requestToken || !prev.listData) {
            return prev;
          }
          return {
            ...prev,
            listData: {
              ...prev.listData,
              items: prev.listData.items.map((item) =>
                item.id === freshDetail.id
                  ? {
                      ...freshDetail,
                      viewed: item.viewed || freshDetail.viewed,
                    }
                  : item,
              ),
            },
          };
        });
      } catch (err) {
        if (gen !== detailGenRef.current) {
          return;
        }
        setDetailModal((prev) => {
          if (
            !prev ||
            prev.token !== requestToken ||
            prev.updateId !== update.id
          ) {
            return prev;
          }
          return {
            ...prev,
            loading: false,
            error: mapApiError(err, { feature: 'technology_update' }),
          };
        });
      }
    })();
  };

  const handleCloseDetailModal = () => {
    setDetailModal(null);
    const trigger = lastTriggerRef.current;
    if (trigger && typeof trigger.focus === 'function') {
      trigger.focus();
    }
  };

  const activeDetailUpdate =
    detailModal?.detailUpdate ?? detailModal?.seedUpdate ?? null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Page Header & Breadcrumb */}
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"
          >
            <Link
              href="/dashboard"
              className="transition-colors hover:text-slate-800 dark:hover:text-slate-200"
            >
              AI Career Mentor
            </Link>
            <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-slate-700 dark:text-slate-200">
              Daily Technology Updates
            </span>
          </nav>
          <h1 className="mt-1.5 text-heading-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Daily Technology Updates
          </h1>
          <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
            Personalized daily tech updates aligned with your Focus Roadmap.
          </p>
        </div>
      </div>

      {/* Default OFF / 403 FEATURE_DISABLED Informational Screen (PRD §7, §38, C09 Screen 21) */}
      {effectiveStatus === 'feature_disabled' && (
        <section
          aria-label="Technology updates disabled notice"
          className="flex flex-col items-start gap-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-teal-500/20 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
              <BroadcastOffIcon />
            </span>
            <div>
              <h2 className="text-heading-md font-semibold text-slate-900 dark:text-slate-100">
                Tech Updates Locked
              </h2>
              <p className="mt-0.5 text-caption text-slate-500 dark:text-slate-400">
                Premium feature · Disabled on your plan
              </p>
            </div>
          </div>

          <p className="w-full text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Get one verified, source-grounded technology update each day
            tailored to your Focus Roadmap, target role, and skills.
          </p>

          <div className="flex w-full flex-col items-start gap-3 pt-1">
            <button
              type="button"
              aria-expanded={subscribeNoticeOpen}
              onClick={() => setSubscribeNoticeOpen((prev) => !prev)}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 text-sm font-semibold leading-none text-white transition-colors hover:bg-teal-800"
            >
              <SparklesIcon
                strokeWidth={1.75}
                className="block h-4 w-4 shrink-0"
              />
              <span className="leading-none">Subscribe</span>
            </button>
            {subscribeNoticeOpen && (
              <p
                role="status"
                className="w-full rounded-xl border border-teal-200/80 bg-teal-50/60 px-4 py-3 text-xs font-medium text-teal-900 dark:border-teal-800/70 dark:bg-teal-950/40 dark:text-teal-200"
              >
                Subscription checkout is coming soon. Contact your administrator
                to enable early access for your account.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Initial Loading Skeleton */}
      {effectiveStatus === 'loading' && (
        <section
          aria-label="Loading technology updates"
          aria-busy="true"
          className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center gap-3 text-body-sm font-medium text-slate-600 dark:text-slate-300">
            <SpinnerIcon className="block h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
            <span>Loading your personalized technology updates...</span>
          </div>
        </section>
      )}

      {/* Initial Load Error */}
      {effectiveStatus === 'error' && initialError && (
        <section
          aria-label="Technology updates error"
          className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <Alert variant="error_retryable" role="alert">
            {initialError.message}
          </Alert>
          <div>
            <Button
              type="button"
              variant="primary"
              onClick={handleRetryInitial}
            >
              <RefreshCwIcon className="block h-4 w-4 shrink-0" />
              <span>Try Again</span>
            </Button>
          </div>
        </section>
      )}

      {/* Ready State */}
      {effectiveStatus === 'ready' && listData && (
        <>
          {actionError && (
            <Alert variant="error_retryable" role="alert">
              {actionError.message}
            </Alert>
          )}

          {/* Today Status Banner (R25) */}
          {listData.generation_pending && listData.today_state === null && (
            <section
              aria-label="Today's update generation pending"
              className="flex flex-col gap-2 rounded-2xl border border-teal-200/80 bg-teal-50/60 p-5 shadow-2xs dark:border-teal-900/60 dark:bg-teal-950/30"
            >
              <div className="flex items-center gap-2.5">
                <ClockIcon className="block h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                  Today&apos;s technology update is scheduled for background
                  generation
                </h2>
              </div>
              <p className="text-body-sm text-slate-600 dark:text-slate-400">
                Daily updates are prepared on an hourly timezone-aware schedule
                from verified external release notes and documentation. Any
                previously delivered updates remain available below.
              </p>
            </section>
          )}

          {listData.today_state === 'no_important_changes' && (
            <section
              aria-label="No important changes today"
              className="flex flex-col gap-2 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center gap-2.5">
                <CheckCircleIcon className="block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                  {listData.message ?? NO_IMPORTANT_CHANGES_FALLBACK}
                </h2>
              </div>
              <p className="text-body-sm text-slate-600 dark:text-slate-400">
                We checked today&apos;s ecosystem releases against your Focus
                Roadmap and skills and suppressed low-value noise.
              </p>
            </section>
          )}

          {listData.today_state === 'temporarily_unavailable' && (
            <section
              aria-label="Technology updates temporarily unavailable"
              className="flex flex-col gap-2 rounded-2xl border border-amber-200/90 bg-amber-50/70 p-5 shadow-2xs dark:border-amber-900/60 dark:bg-amber-950/30"
            >
              <div className="flex items-center gap-2.5">
                <RadioIcon className="block h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
                <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                  {listData.message ?? TEMPORARILY_UNAVAILABLE_FALLBACK}
                </h2>
              </div>
              <p className="text-body-sm text-slate-600 dark:text-slate-400">
                Fresh external source verification could not be completed for
                today. We never fabricate daily updates from stale model memory.
              </p>
            </section>
          )}

          {/* Filter Pills (All | High Relevance | Unread) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Filter technology updates"
              className="flex flex-wrap items-center gap-2"
            >
              <button
                type="button"
                aria-pressed={activeFilter === 'all'}
                onClick={() => setActiveFilter('all')}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                  activeFilter === 'all'
                    ? 'border-teal-600 bg-teal-600 text-white shadow-2xs dark:border-teal-500 dark:bg-teal-500 dark:text-slate-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                <span>All</span>
                <span className="font-mono text-[11px] opacity-85">
                  ({items.length})
                </span>
              </button>

              <button
                type="button"
                aria-pressed={activeFilter === 'high_relevance'}
                onClick={() => setActiveFilter('high_relevance')}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                  activeFilter === 'high_relevance'
                    ? 'border-teal-600 bg-teal-600 text-white shadow-2xs dark:border-teal-500 dark:bg-teal-500 dark:text-slate-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                <span>High Relevance</span>
                <span className="font-mono text-[11px] opacity-85">
                  ({highRelevanceCount})
                </span>
              </button>

              <button
                type="button"
                aria-pressed={activeFilter === 'unread'}
                onClick={() => setActiveFilter('unread')}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors',
                  activeFilter === 'unread'
                    ? 'border-teal-600 bg-teal-600 text-white shadow-2xs dark:border-teal-500 dark:bg-teal-500 dark:text-slate-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                <span>Unread</span>
                <span className="font-mono text-[11px] opacity-85">
                  ({unreadCount})
                </span>
              </button>
            </div>
          </div>

          {/* Empty State vs Filtered Empty State vs Update Cards */}
          {items.length === 0 ? (
            <section
              aria-label="No delivered technology updates yet"
              className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                No delivered technology updates yet
              </h2>
              <p className="text-body-sm text-slate-600 dark:text-slate-400">
                When a meaningful ecosystem release matches your Focus Roadmap
                and learning stage, it will appear here automatically.
              </p>
            </section>
          ) : filteredItems.length === 0 ? (
            <section
              aria-label="No technology updates match the current filter"
              className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                  No updates match this filter
                </h2>
                <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
                  Clear the active filter to view all delivered technology
                  updates.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setActiveFilter('all')}
              >
                Clear filters
              </Button>
            </section>
          ) : (
            <section
              aria-label="Delivered technology updates"
              className="flex flex-col gap-4"
            >
              {filteredItems.map((update, idx) => (
                <AIExplanationCard
                  key={update.id}
                  variant="technology_update"
                  update={update}
                  isTodayHighlight={
                    idx === 0 &&
                    activeFilter === 'all' &&
                    listData.today_state === 'available'
                  }
                  isMarkingViewed={markingViewedIds.has(update.id)}
                  onInspectDetail={handleInspectDetail}
                  onMarkViewed={(u) => void handleMarkViewed(u)}
                />
              ))}
            </section>
          )}

          {/* Pagination Error & Load More */}
          {loadMoreError && (
            <Alert variant="error_retryable" role="alert">
              {loadMoreError.message}
            </Alert>
          )}

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="secondary"
                loading={loadingMore}
                disabled={loadingMore}
                onClick={() => void handleLoadMore()}
              >
                <span>Load more</span>
              </Button>
            </div>
          )}
        </>
      )}

      {/* EP-T02 Detail Inspection Modal Dialog */}
      {detailModal &&
        detailModal.token === accessToken &&
        activeDetailUpdate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
            onClick={handleCloseDetailModal}
          >
            <div
              ref={dialogContainerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="tech-update-detail-title"
              className="flex max-h-[90dvh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                      getReleaseStatusChipClass(
                        activeDetailUpdate.release_status,
                      ),
                    )}
                  >
                    {RELEASE_STATUS_LABELS[activeDetailUpdate.release_status]}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                      getRelevanceChipClass(activeDetailUpdate.relevance),
                    )}
                  >
                    {RELEVANCE_LEVEL_LABELS[activeDetailUpdate.relevance]}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                      getActionTimingChipClass(
                        activeDetailUpdate.action_timing,
                      ),
                    )}
                  >
                    {ACTION_TIMING_LABELS[activeDetailUpdate.action_timing]}
                  </span>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {activeDetailUpdate.local_date}
                  </span>
                </div>
                <h2
                  id="tech-update-detail-title"
                  className="mt-2.5 text-heading-lg font-semibold text-slate-900 dark:text-slate-100"
                  dir="auto"
                >
                  {activeDetailUpdate.title}
                </h2>
              </div>

              <button
                ref={dialogCloseButtonRef}
                type="button"
                aria-label="Close update details"
                onClick={handleCloseDetailModal}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                <CloseIcon className="block h-5 w-5 shrink-0" />
              </button>
            </div>

            {detailModal.loading && (
              <div
                aria-live="polite"
                className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400"
              >
                <SpinnerIcon className="block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                <span>Refreshing update details...</span>
              </div>
            )}

            {detailModal.error && (
              <Alert variant="warning" role="alert">
                {detailModal.error.message}
              </Alert>
            )}

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  What Changed
                </p>
                <p
                  className="text-body-sm leading-relaxed text-slate-700 dark:text-slate-300"
                  dir="auto"
                >
                  {activeDetailUpdate.what_changed}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 rounded-xl border border-teal-100/80 bg-teal-50/40 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
                <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
                  Why It Matters to You
                </p>
                <p
                  className="text-body-sm leading-relaxed text-slate-700 dark:text-slate-300"
                  dir="auto"
                >
                  {activeDetailUpdate.why_it_matters}
                </p>
              </div>

              {activeDetailUpdate.roadmap_relation && (
                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-body-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  <CompassIcon className="mt-0.5 block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Roadmap Relevance:{' '}
                    </span>
                    <span dir="auto">
                      {activeDetailUpdate.roadmap_relation}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Source: {activeDetailUpdate.publisher}
                </span>
                <span>
                  Fetched{' '}
                  {formatTechUpdateTimestamp(activeDetailUpdate.fetched_at)}
                </span>
                {getSafeExternalHttpUrl(activeDetailUpdate.source_url) && (
                  <a
                    href={
                      getSafeExternalHttpUrl(activeDetailUpdate.source_url)!
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1 font-semibold text-teal-700 hover:underline dark:text-teal-300"
                  >
                    <span>Open Source Reference</span>
                    <ExternalLinkIcon className="block h-3.5 w-3.5 shrink-0" />
                  </a>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {!activeDetailUpdate.viewed && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={markingViewedIds.has(activeDetailUpdate.id)}
                    disabled={markingViewedIds.has(activeDetailUpdate.id)}
                    onClick={() => void handleMarkViewed(activeDetailUpdate)}
                    className="min-h-11"
                  >
                    <CheckCircleIcon className="block h-4 w-4 shrink-0" />
                    <span>Mark as Read</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleCloseDetailModal}
                  className="min-h-11"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
