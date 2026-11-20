'use client';

import { useEffect, useState } from 'react';
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
  ChevronRightIcon,
  CompassIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Tabs, type TabItem } from '@/components/ui/tabs';

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
    'border-feedback-info-border bg-feedback-info-background text-feedback-info-text',
  locked:
    'border-feedback-success-border bg-feedback-success-background text-feedback-success-text',
  archived:
    'border-border-default bg-surface-sunken text-text-secondary',
};

const FILTER_TABS: TabItem[] = [
  { id: 'all', label: 'All', panel: null },
  { id: 'locked', label: 'Locked', panel: null },
  { id: 'draft', label: 'Draft', panel: null },
  { id: 'archived', label: 'Archived', panel: null },
];

const primaryLinkClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md bg-action-primary-background px-4 py-2 text-label font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active motion-reduce:transition-none';

const secondaryLinkClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-action-secondary-border bg-action-secondary-background px-3.5 py-2 text-label font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active motion-reduce:transition-none';

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
): NonNullable<HubFeedback> {
  if (res.new_focus_roadmap_id) {
    return {
      variant: 'success',
      title: 'Roadmap archived',
      message:
        'All learning progress, shared skill evidence, and daily plans are preserved. Focus automatically reassigned to another active locked roadmap.',
    };
  }
  return {
    variant: 'success',
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
  const [filter, setFilter] = useState<HubFilter>('all');
  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<HubFetchState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [feedback, setFeedback] = useState<HubFeedback>(null);
  const [focusingId, setFocusingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RoadmapSummaryDTO | null>(
    null,
  );
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const requestKey = `${accessToken}:${filter}:${reloadTick}`;
  const seededInitial =
    initialPage && filter === 'all' && reloadTick === 0 ? initialPage : null;

  useEffect(() => {
    if (seededInitial) {
      return;
    }

    let active = true;
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
        if (!active || controller.signal.aborted) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'loaded',
          items: res.items,
          nextCursor: res.meta.next_cursor,
        });
      })
      .catch((err) => {
        if (!active || controller.signal.aborted) {
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
      controller.abort();
    };
  }, [accessToken, filter, requestKey, seededInitial]);

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
    if (!nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await listRoadmaps(accessToken, {
        ...(filter !== 'all' ? { status: filter } : {}),
        cursor: nextCursor,
        limit: 20,
      });
      setFetchState((prev) => {
        const currentItems =
          prev && prev.key === requestKey && prev.status === 'loaded'
            ? prev.items
            : items;
        const seenIds = new Set(currentItems.map((entry) => entry.id));
        const merged = [
          ...currentItems,
          ...page.items.filter((entry) => !seenIds.has(entry.id)),
        ];
        return {
          key: requestKey,
          status: 'loaded',
          items: merged,
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSetFocus = async (roadmap: RoadmapSummaryDTO) => {
    if (focusingId || archivingId) {
      return;
    }
    setFocusingId(roadmap.id);
    setActionError(null);
    setFeedback(null);
    try {
      const result = await focusRoadmap(accessToken, roadmap.id);
      setFetchState({
        key: requestKey,
        status: 'loaded',
        items: items.map((entry) => ({
          ...entry,
          is_focus: entry.id === result.focus_roadmap_id,
          has_daily_plan:
            entry.id === result.focus_roadmap_id
              ? result.daily_plan.state === 'existing'
              : entry.has_daily_plan,
        })),
        nextCursor,
      });
      setFeedback(formatFocusFeedback(result));
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setFocusingId(null);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget || archivingId) {
      return;
    }
    const target = archiveTarget;
    setArchivingId(target.id);
    setActionError(null);
    setFeedback(null);
    try {
      const result = await archiveRoadmap(accessToken, target.id);
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
          filter === 'locked' || filter === 'draft'
            ? entry.status === filter
            : true,
        );

      setFetchState({
        key: requestKey,
        status: 'loaded',
        items: updatedList,
        nextCursor,
      });
      setFeedback(formatArchiveFeedback(result));
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

        <Link href="/career-profile" className={secondaryLinkClass}>
          Manage Goals &amp; Profile
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
        <Tabs
          items={FILTER_TABS}
          value={filter}
          onValueChange={(nextId) => {
            setFilter(nextId as HubFilter);
            setActionError(null);
          }}
          hidePanels={true}
          aria-label="Filter roadmaps by status"
        />

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
                const primaryHref = isDraft
                  ? `/roadmaps/${encodeURIComponent(roadmap.id)}/draft`
                  : `/roadmaps/${encodeURIComponent(roadmap.id)}`;
                const primaryLabel = isDraft ? 'Review Draft' : 'View Roadmap';
                const hasStaleWarning = roadmap.stale || roadmap.stale_draft;
                const versionPointer =
                  roadmap.current_version_no !== null
                    ? `v${roadmap.current_version_no}`
                    : roadmap.draft_version_no !== null
                      ? `Draft v${roadmap.draft_version_no}`
                      : 'v1';

                return (
                  <li
                    key={roadmap.id}
                    className={cn(
                      'flex flex-col justify-between gap-4 rounded-xl border bg-surface-raised p-5 shadow-xs',
                      roadmap.is_focus
                        ? 'border-border-focus'
                        : 'border-border-default',
                    )}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-medium',
                            STATUS_BADGE_CLASSES[roadmap.status],
                          )}
                        >
                          {STATUS_LABELS[roadmap.status]}
                        </span>

                        <span className="inline-flex items-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-caption font-medium text-text-secondary">
                          {LEVEL_LABELS[roadmap.target_level] ??
                            roadmap.target_level}
                        </span>

                        <span className="inline-flex items-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-caption font-mono text-text-secondary">
                          {versionPointer}
                        </span>

                        {roadmap.is_focus && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-semibold text-feedback-success-text">
                            <CheckCircleIcon
                              className="h-3.5 w-3.5 text-feedback-success-icon"
                              aria-hidden="true"
                            />
                            <span>Focus Roadmap</span>
                          </span>
                        )}

                        {hasStaleWarning && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-feedback-warning-border bg-feedback-warning-background px-2.5 py-0.5 text-caption font-medium text-feedback-warning-text">
                            <WarningIcon
                              className="h-3.5 w-3.5 text-feedback-warning-icon"
                              aria-hidden="true"
                            />
                            <span>Stale Draft</span>
                          </span>
                        )}

                        {roadmap.has_open_merge && (
                          <span className="inline-flex items-center rounded-full border border-feedback-info-border bg-feedback-info-background px-2.5 py-0.5 text-caption font-medium text-feedback-info-text">
                            Open Merge
                          </span>
                        )}
                      </div>

                      <div>
                        <h2
                          className="text-heading-sm font-semibold text-text-primary"
                          dir="auto"
                        >
                          {roadmap.role_name}
                        </h2>
                        <p className="mt-1 text-caption text-text-muted">
                          {isDraft && roadmap.draft_version_no !== null
                            ? `Open Draft v${roadmap.draft_version_no}`
                            : roadmap.has_open_draft &&
                                roadmap.draft_version_no !== null
                              ? `Current v${roadmap.current_version_no ?? 1} · Open Draft v${roadmap.draft_version_no}`
                              : roadmap.has_daily_plan
                                ? 'Daily Plan active'
                                : 'No Daily Plan created yet'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-4">
                      <Link href={primaryHref} className={primaryLinkClass}>
                        <span>{primaryLabel}</span>
                        <ChevronRightIcon
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </Link>

                      {!isDraft &&
                        roadmap.has_open_draft &&
                        roadmap.draft_version_no !== null && (
                          <Link
                            href={`/roadmaps/${encodeURIComponent(roadmap.id)}/draft`}
                            className={secondaryLinkClass}
                          >
                            Review Draft
                          </Link>
                        )}

                      {isLocked && !roadmap.is_focus && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={focusingId === roadmap.id}
                          loadingText="Updating..."
                          disabled={
                            Boolean(focusingId) || Boolean(archivingId)
                          }
                          onClick={() => void handleSetFocus(roadmap)}
                        >
                          Set as Focus
                        </Button>
                      )}

                      {roadmap.status !== 'archived' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            Boolean(focusingId) || Boolean(archivingId)
                          }
                          onClick={() => setArchiveTarget(roadmap)}
                        >
                          Archive
                        </Button>
                      )}
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
                  onClick={() => void handleLoadMore()}
                >
                  Load more roadmaps
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <Modal
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        variant="confirm"
        title={
          archiveTarget
            ? `Archive "${archiveTarget.role_name}"?`
            : 'Archive Roadmap?'
        }
        description="Archiving this roadmap preserves all learning progress, shared skill evidence, and daily plans. If this is your Focus Roadmap, focus will automatically reassign to another active locked roadmap if available."
        confirmLabel="Archive Roadmap"
        loading={Boolean(archiveTarget && archivingId === archiveTarget.id)}
        onConfirm={() => void handleConfirmArchive()}
      />
    </main>
  );
}
