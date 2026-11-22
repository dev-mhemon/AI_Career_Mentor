'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  archiveRoadmap,
  focusRoadmap,
  listRoadmaps,
  type ArchiveRoadmapResponseDTO,
  type CareerLevel,
  type FocusSwitchResponseDTO,
  type RoadmapListResponseDTO,
  type RoadmapStatus,
  type RoadmapSummaryDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  CompassIcon,
  LockIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Toast } from '@/components/ui/toast';

function SlidersHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="sliders-horizontal"
      className={cn('block shrink-0', className)}
    >
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="archive"
      className={cn('block shrink-0', className)}
    >
      <rect width="20" height="5" x="2" y="3" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="arrow-right"
      className={cn('block shrink-0', className)}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function FileEditIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="file-edit"
      className={cn('block shrink-0', className)}
    >
      <path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon="eye"
      className={cn('block shrink-0', className)}
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export interface RoadmapsHubViewProps {
  accessToken: string;
  featureEnabled?: boolean;
  initialPage?: RoadmapListResponseDTO;
}

type HubFilter = 'all' | RoadmapStatus;

type HubFetchState =
  | {
      key: string;
      status: 'loaded';
      items: RoadmapSummaryDTO[];
      nextCursor: string | null;
    }
  | {
      key: string;
      status: 'error';
      error: MappedError;
    };

type HubFeedback =
  | {
      variant: 'success' | 'info' | 'warning' | 'error_retryable';
      title: string;
      message: string;
      href?: string;
      hrefLabel?: string;
    }
  | null;

type ArchiveToast = {
  title: string;
  message: string;
} | null;

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

const STATUS_LABELS: Record<RoadmapStatus, string> = {
  draft: 'Draft',
  locked: 'Locked',
  archived: 'Archived',
};

const STATUS_BADGE_CLASSES: Record<RoadmapStatus, string> = {
  draft:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/50 dark:text-amber-200',
  locked:
    'border-feedback-success-border bg-feedback-success-background text-feedback-success-text',
  archived:
    'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

type FilterCounts = Record<HubFilter, number>;

type SavedCountsState = {
  key: string;
  counts: FilterCounts;
} | null;

const FILTER_TABS: { id: HubFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'locked', label: 'Locked' },
  { id: 'draft', label: 'Draft' },
  { id: 'archived', label: 'Archived' },
];

function computeCountsFromAll(items: RoadmapSummaryDTO[]): FilterCounts {
  let locked = 0;
  let draft = 0;
  let archived = 0;
  for (const item of items) {
    if (item.status === 'locked') locked += 1;
    else if (item.status === 'draft') draft += 1;
    else if (item.status === 'archived') archived += 1;
  }
  return {
    all: items.length,
    locked,
    draft,
    archived,
  };
}

const primaryLinkClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-action-primary-background px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active motion-reduce:transition-none';

const secondaryLinkClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 motion-reduce:transition-none';

const archiveLinkClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 motion-reduce:transition-none';

const manageGoalsLinkClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium leading-none whitespace-nowrap text-slate-700 shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 motion-reduce:transition-none';

function formatFocusFeedback(res: FocusSwitchResponseDTO): NonNullable<HubFeedback> {
  if (
    res.daily_plan.state === 'missing' &&
    res.daily_plan.requires_learning_hours
  ) {
    return {
      variant: 'warning',
      title: 'Focus Roadmap updated — daily learning hours needed',
      message:
        'Your Focus Roadmap is active, but a Daily Plan cannot be scheduled until you set your preferred daily learning hours.',
      href: '/settings',
      hrefLabel: 'Set Daily Learning Hours',
    };
  }
  if (res.daily_plan.state === 'missing') {
    return {
      variant: 'info',
      title: 'Focus Roadmap updated',
      message:
        'This roadmap is now your Focus Roadmap. Set up its Daily Plan when you are ready to start daily lessons.',
    };
  }
  return {
    variant: 'success',
    title: 'Focus Roadmap updated',
    message:
      'This roadmap is now your Focus Roadmap, and its existing Daily Plan remains active.',
  };
}

function formatArchiveFeedback(
  res: ArchiveRoadmapResponseDTO,
  wasFocused: boolean,
): NonNullable<ArchiveToast> {
  if (wasFocused && res.new_focus_roadmap_id) {
    return {
      title: 'Roadmap archived',
      message:
        'All learning progress, shared skill evidence, and daily plans are preserved. Focus automatically reassigned to another active locked roadmap.',
    };
  }
  return {
    title: 'Roadmap archived',
    message:
      'All learning progress, shared skill evidence, and daily plans are preserved.',
  };
}

/**
 * Roadmaps Hub (`/roadmaps`): lists owned roadmaps (`EP-R02`), supports status tabs and
 * cursor pagination, highlights focus/stale/open-merge flags, and runs inline Focus Switch
 * (`EP-R14`) and Archive (`EP-R15`) actions.
 */
export function RoadmapsHubView({
  accessToken,
  featureEnabled = true,
  initialPage,
}: RoadmapsHubViewProps) {
  const tabsUid = useId();
  const tabRefs = useRef<Record<HubFilter, HTMLButtonElement | null>>({
    all: null,
    locked: null,
    draft: null,
    archived: null,
  });
  const requestGenRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  const [filter, setFilter] = useState<HubFilter>('all');
  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<HubFetchState | null>(null);
  const [savedCounts, setSavedCounts] = useState<SavedCountsState>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [feedback, setFeedback] = useState<HubFeedback>(null);
  const [archiveToast, setArchiveToast] = useState<ArchiveToast>(null);
  const [focusingId, setFocusingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RoadmapSummaryDTO | null>(
    null,
  );
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const requestKey = `${accessToken}:${filter}:${reloadTick}`;
  const countsKey = `${accessToken}:${reloadTick}`;
  const seededInitial =
    initialPage && filter === 'all' && reloadTick === 0 ? initialPage : null;

  useEffect(() => {
    if (seededInitial) {
      return;
    }

    let active = true;
    const requestGen = ++requestGenRef.current;
    const controller = new AbortController();

    listRoadmaps(
      accessToken,
      {
        ...(filter !== 'all' ? { status: filter } : {}),
        limit: 20,
      },
      { signal: controller.signal },
    )
      .then((res) => {
        if (
          !active ||
          controller.signal.aborted ||
          requestGen !== requestGenRef.current
        ) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'loaded',
          items: res.items,
          nextCursor: res.meta.next_cursor,
        });
        if (filter === 'all') {
          const computed = computeCountsFromAll(res.items);
          setSavedCounts((prev) => {
            if (res.meta.next_cursor && prev && prev.key === countsKey) {
              const mergedCounts: FilterCounts = {
                all: Math.max(prev.counts.all, computed.all),
                locked: Math.max(prev.counts.locked, computed.locked),
                draft: Math.max(prev.counts.draft, computed.draft),
                archived: Math.max(prev.counts.archived, computed.archived),
              };
              mergedCounts.all = Math.max(
                mergedCounts.all,
                mergedCounts.locked + mergedCounts.draft + mergedCounts.archived,
              );
              return { key: countsKey, counts: mergedCounts };
            }
            return { key: countsKey, counts: computed };
          });
        } else {
          setSavedCounts((prev) => {
            const base: FilterCounts =
              prev && prev.key === countsKey
                ? prev.counts
                : initialPage && reloadTick === 0
                  ? computeCountsFromAll(initialPage.items)
                  : { all: 0, locked: 0, draft: 0, archived: 0 };
            const nextFilterCount = res.meta.next_cursor
              ? Math.max(base[filter], res.items.length)
              : res.items.length;
            const updated: FilterCounts = {
              ...base,
              [filter]: nextFilterCount,
            };
            updated.all = Math.max(
              base.all,
              updated.locked + updated.draft + updated.archived,
            );
            return { key: countsKey, counts: updated };
          });
        }
      })
      .catch((err) => {
        if (
          !active ||
          controller.signal.aborted ||
          requestGen !== requestGenRef.current
        ) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'error',
          error: mapApiError(err),
        });
      });

    return () => {
      active = false;
      requestGenRef.current += 1;
      controller.abort();
      loadMoreAbortRef.current?.abort();
      loadMoreAbortRef.current = null;
    };
  }, [
    accessToken,
    countsKey,
    filter,
    initialPage,
    reloadTick,
    requestKey,
    seededInitial,
  ]);

  const tabCounts: FilterCounts | null =
    savedCounts && savedCounts.key === countsKey
      ? savedCounts.counts
      : initialPage && reloadTick === 0
        ? computeCountsFromAll(initialPage.items)
        : null;

  const selectFilter = (nextId: HubFilter) => {
    if (nextId === filter) {
      return;
    }
    requestGenRef.current += 1;
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    setFilter(nextId);
    setLoadingMore(false);
    setActionError(null);
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = FILTER_TABS.findIndex((t) => t.id === filter);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % FILTER_TABS.length;
    else if (e.key === 'ArrowLeft')
      next = (idx - 1 + FILTER_TABS.length) % FILTER_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = FILTER_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const nextId = FILTER_TABS[next].id;
    selectFilter(nextId);
    tabRefs.current[nextId]?.focus();
  };

  const activeState =
    fetchState && fetchState.key === requestKey
      ? fetchState
      : seededInitial
        ? {
            key: requestKey,
            status: 'loaded' as const,
            items: seededInitial.items,
            nextCursor: seededInitial.meta.next_cursor,
          }
        : null;

  const isLoading = activeState === null;
  const items = activeState?.status === 'loaded' ? activeState.items : [];
  const nextCursor =
    activeState?.status === 'loaded' ? activeState.nextCursor : null;
  const loadError = activeState?.status === 'error' ? activeState.error : null;

  const handleLoadMore = async () => {
    if (
      !nextCursor ||
      loadingMore ||
      Boolean(focusingId) ||
      Boolean(archivingId)
    ) {
      return;
    }
    const loadGen = requestGenRef.current;
    const loadFilter = filter;
    const loadRequestKey = requestKey;
    const loadCountsKey = countsKey;
    const baseItems = items;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await listRoadmaps(
        accessToken,
        {
          ...(loadFilter !== 'all' ? { status: loadFilter } : {}),
          cursor: nextCursor,
          limit: 20,
        },
        { signal: controller.signal },
      );
      if (loadGen !== requestGenRef.current || controller.signal.aborted) {
        return;
      }
      const seenIds = new Set(baseItems.map((entry) => entry.id));
      const merged = [
        ...baseItems,
        ...page.items.filter((entry) => !seenIds.has(entry.id)),
      ];
      setFetchState({
        key: loadRequestKey,
        status: 'loaded',
        items: merged,
        nextCursor: page.meta.next_cursor,
      });
      if (loadFilter === 'all') {
        const computed = computeCountsFromAll(merged);
        setSavedCounts((prev) => {
          if (page.meta.next_cursor && prev && prev.key === loadCountsKey) {
            const mergedCounts: FilterCounts = {
              all: Math.max(prev.counts.all, computed.all),
              locked: Math.max(prev.counts.locked, computed.locked),
              draft: Math.max(prev.counts.draft, computed.draft),
              archived: Math.max(prev.counts.archived, computed.archived),
            };
            mergedCounts.all = Math.max(
              mergedCounts.all,
              mergedCounts.locked + mergedCounts.draft + mergedCounts.archived,
            );
            return { key: loadCountsKey, counts: mergedCounts };
          }
          return { key: loadCountsKey, counts: computed };
        });
      } else {
        setSavedCounts((prev) => {
          const base: FilterCounts =
            prev && prev.key === loadCountsKey
              ? prev.counts
              : { all: 0, locked: 0, draft: 0, archived: 0 };
          const nextFilterCount = page.meta.next_cursor
            ? Math.max(base[loadFilter], merged.length)
            : merged.length;
          const updated: FilterCounts = {
            ...base,
            [loadFilter]: nextFilterCount,
          };
          updated.all = Math.max(
            base.all,
            updated.locked + updated.draft + updated.archived,
          );
          return { key: loadCountsKey, counts: updated };
        });
      }
    } catch (err) {
      if (loadGen !== requestGenRef.current || controller.signal.aborted) {
        return;
      }
      setActionError(mapApiError(err));
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
      }
      if (loadGen === requestGenRef.current) {
        setLoadingMore(false);
      }
    }
  };

  const handleSetFocus = async (roadmap: RoadmapSummaryDTO) => {
    if (focusingId || archivingId || loadingMore) {
      return;
    }
    const mutationGen = requestGenRef.current;
    const mutationRequestKey = requestKey;
    const mutationNextCursor = nextCursor;
    setFocusingId(roadmap.id);
    setActionError(null);
    setFeedback(null);
    try {
      const result = await focusRoadmap(accessToken, roadmap.id);
      if (mutationGen === requestGenRef.current) {
        setFetchState({
          key: mutationRequestKey,
          status: 'loaded',
          items: items.map((entry) => ({
            ...entry,
            is_focus: entry.id === result.focus_roadmap_id,
            has_daily_plan:
              entry.id === result.focus_roadmap_id
                ? result.daily_plan.state === 'existing'
                : entry.has_daily_plan,
          })),
          nextCursor: mutationNextCursor,
        });
      } else {
        setReloadTick((prev) => prev + 1);
      }
      setFeedback(formatFocusFeedback(result));
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setFocusingId(null);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget || archivingId || focusingId || loadingMore) {
      return;
    }
    const target = archiveTarget;
    const mutationGen = requestGenRef.current;
    const mutationRequestKey = requestKey;
    const mutationCountsKey = countsKey;
    const mutationFilter = filter;
    const mutationNextCursor = nextCursor;
    setArchivingId(target.id);
    setActionError(null);
    setFeedback(null);
    setArchiveToast(null);
    try {
      const result = await archiveRoadmap(accessToken, target.id);
      if (mutationGen === requestGenRef.current) {
        const updatedList = items
          .map((entry) => {
            if (entry.id === result.archived_roadmap_id) {
              return {
                ...entry,
                status: 'archived' as const,
                is_focus: false,
              };
            }
            if (result.new_focus_roadmap_id) {
              return {
                ...entry,
                is_focus: entry.id === result.new_focus_roadmap_id,
              };
            }
            return entry;
          })
          .filter((entry) =>
            mutationFilter === 'locked' || mutationFilter === 'draft'
              ? entry.status === mutationFilter
              : true,
          );

        setFetchState({
          key: mutationRequestKey,
          status: 'loaded',
          items: updatedList,
          nextCursor: mutationNextCursor,
        });
        setSavedCounts((prev) => {
          const base: FilterCounts | null =
            prev && prev.key === mutationCountsKey
              ? prev.counts
              : initialPage && reloadTick === 0
                ? computeCountsFromAll(initialPage.items)
                : null;
          if (!base) {
            return prev;
          }
          const prevStatus = target.status;
          if (prevStatus === 'archived') {
            return { key: mutationCountsKey, counts: base };
          }
          return {
            key: mutationCountsKey,
            counts: {
              ...base,
              [prevStatus]: Math.max(0, base[prevStatus] - 1),
              archived: base.archived + 1,
            },
          };
        });
      } else {
        setReloadTick((prev) => prev + 1);
      }
      setArchiveToast(formatArchiveFeedback(result, Boolean(target.is_focus)));
      setArchiveTarget(null);
    } catch (err) {
      setActionError(mapApiError(err));
      setArchiveTarget(null);
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-3 border-b border-border-default pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-caption font-medium uppercase tracking-wider text-text-brand">
            Learning Paths
          </p>
          <h1 className="mt-1 text-heading-xl font-semibold text-text-primary">
            Your Roadmaps
          </h1>
          <p className="mt-1 text-body-sm text-text-secondary">
            Review draft roadmaps, switch your active Focus Roadmap, or inspect archived career paths.
          </p>
        </div>

        <Link href="/career-profile" className={manageGoalsLinkClass}>
          <SlidersHorizontalIcon className="block h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
          <span>Manage Goals &amp; Profile</span>
        </Link>
      </header>

      {!featureEnabled && (
        <Alert variant="info" role="status" title="New roadmap generation is disabled">
          Your existing locked, draft, and archived roadmaps remain viewable and manageable while generation is turned off.
        </Alert>
      )}

      {feedback && (
        <Alert
          variant={feedback.variant}
          role={feedback.variant === 'error_retryable' ? 'alert' : 'status'}
          title={feedback.title}
          action={
            feedback.href && feedback.hrefLabel
              ? { label: feedback.hrefLabel, href: feedback.href }
              : undefined
          }
        >
          {feedback.message}
        </Alert>
      )}

      {actionError && (
        <Alert
          variant={
            actionError.tone === 'info'
              ? 'info'
              : actionError.tone === 'warning'
                ? 'warning'
                : 'error_retryable'
          }
          role="alert"
          retryAfterSeconds={actionError.retryAfterSeconds}
        >
          {actionError.message}
        </Alert>
      )}

      <section aria-label="Roadmap filter and list" className="flex flex-col gap-5">
        <div className="border-b border-border-default">
          <div
            role="tablist"
            aria-label="Filter roadmaps by status"
            onKeyDown={handleTabKeyDown}
            className="-mb-px flex flex-nowrap items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:gap-2"
          >
            {FILTER_TABS.map((tab) => {
              const isSelected = filter === tab.id;
              const count = tabCounts ? tabCounts[tab.id] : null;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[tab.id] = el;
                  }}
                  role="tab"
                  type="button"
                  id={`${tabsUid}-tab-${tab.id}`}
                  aria-controls={`${tabsUid}-panel`}
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => selectFilter(tab.id)}
                  className={cn(
                    'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-label-lg leading-none transition-colors duration-(--duration-fast) ease-standard sm:px-4',
                    isSelected
                      ? 'border-action-primary-background text-text-brand'
                      : 'border-transparent text-text-secondary hover:text-text-primary',
                  )}
                >
                  <span>{tab.label}</span>
                  {count !== null && (
                    <span
                      data-testid={`filter-tab-count-${tab.id}`}
                      className={cn(
                        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium leading-none tabular-nums',
                        isSelected
                          ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div
          id={`${tabsUid}-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsUid}-tab-${filter}`}
          className="flex flex-col gap-5"
        >
        {isLoading ? (
          <div
            aria-busy="true"
            aria-live="polite"
            role="status"
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            <span className="sr-only">Loading roadmaps...</span>
            {[0, 1].map((idx) => (
              <div
                key={idx}
                aria-hidden="true"
                className="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-5"
              >
                <div className="h-5 w-1/2 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                <div className="h-4 w-1/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                <div className="h-10 w-full rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <Alert
            variant="error_retryable"
            role="alert"
            title="Unable to load roadmaps"
            retryAfterSeconds={loadError.retryAfterSeconds}
            onRetry={() => setReloadTick((prev) => prev + 1)}
          >
            {loadError.message}
          </Alert>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-default bg-surface-subtle text-text-brand">
              <CompassIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="text-heading-sm font-semibold text-text-primary">
              {filter === 'all'
                ? 'No roadmaps yet'
                : `No ${filter} roadmaps found`}
            </h2>
            <p className="text-body-sm text-text-secondary">
              {filter === 'all'
                ? 'Complete your profile and confirm a career goal to generate your first personalized roadmap draft.'
                : 'Switch status tabs to view roadmaps in another stage.'}
            </p>
            {filter === 'all' && (
              <Link href="/career-profile" className={primaryLinkClass}>
                Manage Goals &amp; Profile
              </Link>
            )}
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {items.map((roadmap) => {
                const isDraft = roadmap.status === 'draft';
                const isLocked = roadmap.status === 'locked';
                const isArchived = roadmap.status === 'archived';
                const primaryHref = isDraft
                  ? `/roadmaps/${encodeURIComponent(roadmap.id)}/draft`
                  : `/roadmaps/${encodeURIComponent(roadmap.id)}`;
                const primaryLabel = isArchived
                  ? 'View Archive'
                  : isDraft
                    ? 'Review Draft'
                    : 'View Roadmap';
                const hasStaleWarning =
                  !isArchived && (roadmap.stale || roadmap.stale_draft);
                const versionPointer = `v${
                  roadmap.current_version_no ?? roadmap.draft_version_no ?? 1
                }`;
                const statusDescription = isArchived
                  ? 'Archived · Read-only. Progress and skill evidence are preserved.'
                  : isDraft
                    ? 'Pending review — revise with AI or lock when ready.'
                    : roadmap.has_open_draft && roadmap.draft_version_no !== null
                      ? `Current v${roadmap.current_version_no ?? 1} · Open Draft v${roadmap.draft_version_no}`
                      : roadmap.has_daily_plan
                        ? 'Daily Plan active'
                        : 'No Daily Plan created yet';

                return (
                  <li
                    key={roadmap.id}
                    className={cn(
                      'flex flex-col justify-between overflow-hidden rounded-2xl border border-l-4 transition-all',
                      isArchived
                        ? 'border-slate-200 border-l-slate-300 bg-slate-50/75 dark:border-slate-800 dark:border-l-slate-600 dark:bg-slate-900/50'
                        : isDraft
                          ? 'border-slate-200 border-l-amber-400 bg-white hover:shadow-sm dark:border-slate-800 dark:border-l-amber-400 dark:bg-slate-900'
                          : roadmap.is_focus
                            ? 'border-teal-500/80 border-l-teal-600 bg-white ring-1 ring-teal-500/15 hover:shadow-sm dark:bg-slate-900'
                            : 'border-slate-200 border-l-teal-600 bg-white hover:shadow-sm dark:border-slate-800 dark:bg-slate-900',
                    )}
                  >
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium leading-none',
                            STATUS_BADGE_CLASSES[roadmap.status],
                          )}
                        >
                          {isLocked && (
                            <LockIcon className="block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          )}
                          {isDraft && <FileEditIcon className="block h-3.5 w-3.5 shrink-0" />}
                          {isArchived && <ArchiveIcon className="block h-3.5 w-3.5 shrink-0" />}
                          <span>{STATUS_LABELS[roadmap.status]}</span>
                        </span>

                        <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-medium leading-none text-text-secondary">
                          {LEVEL_LABELS[roadmap.target_level] ??
                            roadmap.target_level}
                        </span>

                        <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-mono leading-none text-text-secondary">
                          {versionPointer}
                        </span>

                        {!isArchived && roadmap.is_focus && (
                          <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-1 text-caption font-semibold leading-none text-feedback-success-text">
                            <CheckCircleIcon
                              className="block h-3.5 w-3.5 shrink-0 text-feedback-success-icon"
                              aria-hidden="true"
                            />
                            <span>Focus Roadmap</span>
                          </span>
                        )}

                        {hasStaleWarning && (
                          <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-feedback-warning-border bg-feedback-warning-background px-2.5 py-1 text-caption font-medium leading-none text-feedback-warning-text">
                            <WarningIcon
                              className="block h-3.5 w-3.5 shrink-0 text-feedback-warning-icon"
                              aria-hidden="true"
                            />
                            <span>Stale Draft</span>
                          </span>
                        )}

                        {!isArchived && roadmap.has_open_merge && (
                          <span className="inline-flex items-center justify-center rounded-full border border-feedback-info-border bg-feedback-info-background px-2.5 py-1 text-caption font-medium leading-none text-feedback-info-text">
                            Open Merge
                          </span>
                        )}
                      </div>

                      <div>
                        <h2
                          className={cn(
                            'text-heading-sm font-semibold',
                            isArchived
                              ? 'text-slate-600 dark:text-slate-300'
                              : 'text-text-primary',
                          )}
                          dir="auto"
                        >
                          {roadmap.role_name}
                        </h2>
                        <p className="mt-1 text-caption text-text-muted">
                          {statusDescription}
                        </p>
                      </div>
                    </div>

                    <div
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5',
                        isArchived
                          ? 'border-slate-200/80 bg-slate-100/50 dark:border-slate-800 dark:bg-slate-900/70'
                          : 'border-slate-100 bg-slate-50/60 dark:border-slate-800/80 dark:bg-slate-900/60',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {isArchived ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium leading-none text-slate-500 dark:text-slate-400">
                            <EyeIcon className="block h-3.5 w-3.5 shrink-0" />
                            <span>Read-only archive</span>
                          </span>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={
                                loadingMore ||
                                Boolean(focusingId) ||
                                Boolean(archivingId)
                              }
                              onClick={() => setArchiveTarget(roadmap)}
                              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none text-slate-600 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                            >
                              <ArchiveIcon className="block h-4 w-4 shrink-0" />
                              <span>Archive</span>
                            </Button>

                            {isLocked && !roadmap.is_focus && (
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                loading={focusingId === roadmap.id}
                                loadingText="Updating..."
                                disabled={
                                  loadingMore ||
                                  Boolean(focusingId) ||
                                  Boolean(archivingId)
                                }
                                onClick={() => void handleSetFocus(roadmap)}
                                className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 shadow-2xs hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <span>Set as Focus</span>
                              </Button>
                            )}

                            {isLocked &&
                              roadmap.has_open_draft &&
                              roadmap.draft_version_no !== null && (
                                <Link
                                  href={`/roadmaps/${encodeURIComponent(roadmap.id)}/draft`}
                                  className={secondaryLinkClass}
                                >
                                  <span>Review Draft</span>
                                </Link>
                              )}
                          </>
                        )}
                      </div>

                      <Link
                        href={primaryHref}
                        className={cn(
                          isArchived ? archiveLinkClass : primaryLinkClass,
                          'ml-auto',
                        )}
                      >
                        <span>{primaryLabel}</span>
                        <ArrowRightIcon className="block h-4 w-4 shrink-0" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  loading={loadingMore}
                  loadingText="Loading more..."
                  disabled={
                    loadingMore || Boolean(focusingId) || Boolean(archivingId)
                  }
                  onClick={() => void handleLoadMore()}
                >
                  Load more roadmaps
                </Button>
              </div>
            )}
          </>
        )}
        </div>
      </section>

      {archiveToast && (
        <Toast
          variant="success"
          role="status"
          title={archiveToast.title}
          autoDismissMs={6000}
          onDismiss={() => setArchiveToast(null)}
        >
          {archiveToast.message}
        </Toast>
      )}

      <Modal
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        variant="confirm"
        title={
          archiveTarget
            ? `Archive "${archiveTarget.role_name}"?`
            : 'Archive Roadmap?'
        }
        description="Archiving this roadmap also discontinues its linked career goal. Archiving preserves all learning progress, shared skill evidence, and daily plans. If this is your Focus Roadmap, focus will automatically reassign to another active locked roadmap if available."
        confirmLabel="Archive Roadmap"
        loading={Boolean(archiveTarget && archivingId === archiveTarget.id)}
        onConfirm={() => void handleConfirmArchive()}
      />
    </main>
  );
}
