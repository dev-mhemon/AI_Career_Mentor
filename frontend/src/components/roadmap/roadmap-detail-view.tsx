'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import {
  archiveRoadmap,
  focusRoadmap,
  getRoadmap,
  getRoadmapVersion,
  listRoadmapVersions,
  type ArchiveRoadmapResponseDTO,
  type CareerLevel,
  type FocusSwitchResponseDTO,
  type ItemPriority,
  type RoadmapDetailDTO,
  type RoadmapItemDTO,
  type RoadmapPhaseDTO,
  type RoadmapStatus,
  type RoadmapVersionDTO,
  type RoadmapVersionListResponseDTO,
  type RoadmapVersionOrigin,
  type SkillGapType,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  LockIcon,
} from '@/components/ui/icons';
import { Modal, useBackdropDismiss } from '@/components/ui/modal';

export interface RoadmapDetailViewProps {
  accessToken: string;
  roadmapId: string;
  initialRoadmap?: RoadmapDetailDTO;
  initialVersions?: RoadmapVersionListResponseDTO;
}

type DetailFetchState =
  | { key: string; status: 'loaded'; roadmap: RoadmapDetailDTO }
  | { key: string; status: 'error'; error: MappedError };

type VersionsFetchState =
  | {
      key: string;
      status: 'loaded';
      items: RoadmapVersionDTO[];
      nextCursor: string | null;
    }
  | { key: string; status: 'error'; error: MappedError };

type DetailFeedback =
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

const ORIGIN_LABELS: Record<RoadmapVersionOrigin, string> = {
  ai: 'AI Generated',
  user_request: 'User Revision',
  merge: 'Merge Accepted',
  undo: 'Merge Undo',
};

const PRIORITY_BADGE_CLASSES: Record<ItemPriority, string> = {
  core: 'border-priority-core-border bg-priority-core-background text-priority-core-text',
  supporting:
    'border-priority-supporting-border bg-priority-supporting-background text-priority-supporting-text',
  optional:
    'border-priority-optional-border bg-priority-optional-background text-priority-optional-text',
};

const PRIORITY_LABELS: Record<ItemPriority, string> = {
  core: 'Core',
  supporting: 'Supporting',
  optional: 'Optional',
};

const GAP_BADGE_CLASSES: Record<SkillGapType, string> = {
  existing:
    'border-gap-existing-border bg-gap-existing-background text-gap-existing-text',
  transferable:
    'border-gap-transferable-border bg-gap-transferable-background text-gap-transferable-text',
  refresh:
    'border-gap-refresh-border bg-gap-refresh-background text-gap-refresh-text',
  strengthen:
    'border-gap-strengthen-border bg-gap-strengthen-background text-gap-strengthen-text',
  missing:
    'border-gap-missing-border bg-gap-missing-background text-gap-missing-text',
};

const GAP_LABELS: Record<SkillGapType, string> = {
  existing: 'Existing Skill',
  transferable: 'Transferable',
  refresh: 'Refresh',
  strengthen: 'Strengthen',
  missing: 'New Skill',
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const secondaryLinkClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-action-secondary-border bg-action-secondary-background px-3.5 py-2 text-label font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active motion-reduce:transition-none';

function safeExternalUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function sortPhasesAndItems(
  roadmap: RoadmapDetailDTO,
): {
  phases: RoadmapPhaseDTO[];
  titleById: Map<string, string>;
} {
  const titleById = new Map<string, string>();
  const allItems = [...roadmap.items];
  for (const phase of roadmap.phases) {
    for (const item of phase.items) {
      if (!allItems.some((existing) => existing.item_id === item.item_id)) {
        allItems.push(item);
      }
    }
  }
  for (const item of allItems) {
    if (item.item_id) titleById.set(item.item_id, item.title);
    if (item.id) titleById.set(item.id, item.title);
    if (item.lineage_id) titleById.set(item.lineage_id, item.title);
  }

  const phases = [...roadmap.phases]
    .sort((a, b) => a.phase_no - b.phase_no)
    .map((phase) => ({
      ...phase,
      items: [...phase.items]
        .filter((item) => !item.retired)
        .sort((a, b) => a.sequence_no - b.sequence_no),
    }));

  return { phases, titleById };
}

function resolvePrerequisites(
  item: RoadmapItemDTO,
  titleById: Map<string, string>,
): string[] {
  const refs =
    item.depends_on.length > 0 ? item.depends_on : item.depends_on_lineage_ids;
  const resolved: string[] = [];
  for (const ref of refs) {
    const label = titleById.get(ref);
    if (label && !resolved.includes(label)) {
      resolved.push(label);
    }
  }
  return resolved;
}

function formatFocusFeedback(res: FocusSwitchResponseDTO): NonNullable<DetailFeedback> {
  if (
    res.daily_plan.state === 'missing' &&
    res.daily_plan.requires_learning_hours
  ) {
    return {
      variant: 'warning',
      title: 'Focus Roadmap updated — set your daily learning hours',
      message:
        'This roadmap is now your Focus Roadmap. Configure your preferred daily study hours in Settings before creating its Daily Plan.',
      href: '/settings',
      hrefLabel: 'Configure Daily Hours',
    };
  }
  if (res.daily_plan.state === 'missing') {
    return {
      variant: 'info',
      title: 'Focus Roadmap updated',
      message:
        'This roadmap is now your Focus Roadmap. You can set up a Daily Plan for this roadmap next.',
    };
  }
  return {
    variant: 'success',
    title: 'Focus Roadmap updated',
    message:
      'This roadmap is now your Focus Roadmap, and its existing Daily Plan is active and ready.',
  };
}

function formatArchiveFeedback(
  res: ArchiveRoadmapResponseDTO,
): NonNullable<DetailFeedback> {
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
 * Screen 15 (`/roadmaps/[id]`): displays a locked or archived roadmap (`EP-R03`),
 * opens an accessible Version History Drawer (`EP-R06` / `EP-R07`) for read-only
 * immutable version snapshots, and supports Focus Switching (`EP-R14`) and Archiving (`EP-R15`).
 */
export function RoadmapDetailView({
  accessToken,
  roadmapId,
  initialRoadmap,
  initialVersions,
}: RoadmapDetailViewProps) {
  const drawerTitleId = useId();
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<DetailFetchState | null>(null);
  const [historicalSnapshot, setHistoricalSnapshot] =
    useState<RoadmapDetailDTO | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [versionsReloadTick, setVersionsReloadTick] = useState(0);
  const [versionsState, setVersionsState] = useState<VersionsFetchState | null>(
    null,
  );
  const [loadingMoreVersions, setLoadingMoreVersions] = useState(false);
  const [loadingSnapshotVersion, setLoadingSnapshotVersion] = useState<
    number | null
  >(null);

  const [switchingFocus, setSwitchingFocus] = useState(false);
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [feedback, setFeedback] = useState<DetailFeedback>(null);

  const requestKey = `${accessToken}:${roadmapId}:${reloadTick}`;
  const seededRoadmap =
    initialRoadmap && initialRoadmap.id === roadmapId && reloadTick === 0
      ? initialRoadmap
      : null;

  useEffect(() => {
    if (seededRoadmap) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    getRoadmap(accessToken, roadmapId, 'current', { signal: controller.signal })
      .then((roadmap) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'loaded',
          roadmap,
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
  }, [accessToken, requestKey, roadmapId, seededRoadmap]);

  const versionsKey = `${accessToken}:${roadmapId}:versions:${versionsReloadTick}`;
  const seededVersions =
    initialVersions && versionsReloadTick === 0 ? initialVersions : null;

  useEffect(() => {
    if (!drawerOpen || seededVersions) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    listRoadmapVersions(
      accessToken,
      roadmapId,
      { limit: 50 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setVersionsState({
          key: versionsKey,
          status: 'loaded',
          items: res.items,
          nextCursor: res.meta.next_cursor,
        });
      })
      .catch((err) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setVersionsState({
          key: versionsKey,
          status: 'error',
          error: mapApiError(err),
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, drawerOpen, roadmapId, seededVersions, versionsKey]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const triggerEl = historyTriggerRef.current;
    const prevActive = document.activeElement as HTMLElement | null;
    const first =
      drawerPanelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      drawerPanelRef.current;
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      (triggerEl ?? prevActive)?.focus();
    };
  }, [drawerOpen]);

  const activeState =
    fetchState && fetchState.key === requestKey
      ? fetchState
      : seededRoadmap
        ? { key: requestKey, status: 'loaded' as const, roadmap: seededRoadmap }
        : null;

  const isLoading = activeState === null;
  const currentRoadmap =
    activeState?.status === 'loaded' ? activeState.roadmap : null;
  const loadError = activeState?.status === 'error' ? activeState.error : null;

  const displayedRoadmap = historicalSnapshot ?? currentRoadmap;
  const isViewingHistorical =
    historicalSnapshot !== null &&
    currentRoadmap !== null &&
    historicalSnapshot.version_no !== currentRoadmap.version_no;

  const activeVersions =
    versionsState && versionsState.key === versionsKey
      ? versionsState
      : seededVersions
        ? {
            key: versionsKey,
            status: 'loaded' as const,
            items: seededVersions.items,
            nextCursor: seededVersions.meta.next_cursor,
          }
        : null;

  const { phases, titleById } = useMemo(
    () =>
      displayedRoadmap
        ? sortPhasesAndItems(displayedRoadmap)
        : { phases: [], titleById: new Map<string, string>() },
    [displayedRoadmap],
  );

  const backdropDismiss = useBackdropDismiss(
    () => setDrawerOpen(false),
    loadingSnapshotVersion !== null,
  );

  const handleDrawerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setDrawerOpen(false);
      return;
    }
    if (e.key !== 'Tab' || !drawerPanelRef.current) {
      return;
    }
    const nodes = [...drawerPanelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (nodes.length === 0) {
      e.preventDefault();
      drawerPanelRef.current.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === drawerPanelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || active === drawerPanelRef.current)) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleSelectVersion = async (version: RoadmapVersionDTO) => {
    if (!currentRoadmap || loadingSnapshotVersion !== null) {
      return;
    }
    if (version.version_no === currentRoadmap.version_no) {
      setHistoricalSnapshot(null);
      setDrawerOpen(false);
      return;
    }
    setLoadingSnapshotVersion(version.version_no);
    setActionError(null);
    try {
      const snapshot = await getRoadmapVersion(
        accessToken,
        roadmapId,
        version.version_no,
      );
      setHistoricalSnapshot(snapshot);
      setDrawerOpen(false);
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setLoadingSnapshotVersion(null);
    }
  };

  const handleLoadMoreVersions = async () => {
    if (
      activeVersions?.status !== 'loaded' ||
      !activeVersions.nextCursor ||
      loadingMoreVersions
    ) {
      return;
    }
    setLoadingMoreVersions(true);
    setActionError(null);
    try {
      const page = await listRoadmapVersions(accessToken, roadmapId, {
        cursor: activeVersions.nextCursor,
        limit: 50,
      });
      setVersionsState((prev) => {
        const existing =
          prev && prev.key === versionsKey && prev.status === 'loaded'
            ? prev.items
            : activeVersions.items;
        const seen = new Set(existing.map((v) => v.id));
        return {
          key: versionsKey,
          status: 'loaded',
          items: [...existing, ...page.items.filter((v) => !seen.has(v.id))],
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setLoadingMoreVersions(false);
    }
  };

  const handleFocusSwitch = async () => {
    if (!currentRoadmap || switchingFocus || archiving) {
      return;
    }
    setSwitchingFocus(true);
    setActionError(null);
    setFeedback(null);
    try {
      const res = await focusRoadmap(accessToken, roadmapId);
      setFetchState({
        key: requestKey,
        status: 'loaded',
        roadmap: {
          ...currentRoadmap,
          is_focus: res.focus_roadmap_id === currentRoadmap.id,
        },
      });
      setFeedback(formatFocusFeedback(res));
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setSwitchingFocus(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!currentRoadmap || archiving) {
      return;
    }
    setArchiving(true);
    setActionError(null);
    setFeedback(null);
    try {
      const res = await archiveRoadmap(accessToken, roadmapId);
      setHistoricalSnapshot(null);
      setFetchState({
        key: requestKey,
        status: 'loaded',
        roadmap: {
          ...currentRoadmap,
          status: 'archived',
          is_focus: false,
        },
      });
      setFeedback(formatArchiveFeedback(res));
      setArchiveModalOpen(false);
    } catch (err) {
      setActionError(mapApiError(err));
      setArchiveModalOpen(false);
    } finally {
      setArchiving(false);
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-6"
        >
          <span className="sr-only">Loading roadmap...</span>
          <div className="h-7 w-1/2 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-24 w-full rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
        </div>
      </main>
    );
  }

  if (loadError || !displayedRoadmap || !currentRoadmap) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
        <Alert
          variant="error_retryable"
          role="alert"
          title="Roadmap unavailable"
          retryAfterSeconds={loadError?.retryAfterSeconds ?? null}
          onRetry={
            loadError?.retryable
              ? () => setReloadTick((prev) => prev + 1)
              : undefined
          }
        >
          {loadError?.message ?? 'Could not load this roadmap.'}
        </Alert>
        <div>
          <Link href="/roadmaps" className={secondaryLinkClass}>
            Back to Roadmaps
          </Link>
        </div>
      </main>
    );
  }

  const uniqueWarnings = Array.from(
    new Set(displayedRoadmap.warnings.filter(Boolean)),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 border-b border-border-default pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <nav aria-label="Breadcrumb" className="text-caption text-text-muted">
            <Link href="/roadmaps" className="hover:underline">
              Roadmaps
            </Link>{' '}
            / <span>{displayedRoadmap.role_name}</span>
          </nav>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-heading-xl font-semibold text-text-primary" dir="auto">
              {displayedRoadmap.role_name}
            </h1>

            <span className="inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-medium text-feedback-success-text">
              {currentRoadmap.status === 'locked' && (
                <LockIcon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{STATUS_LABELS[currentRoadmap.status]}</span>
            </span>

            {currentRoadmap.is_focus && !isViewingHistorical && (
              <span className="inline-flex items-center gap-1 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-0.5 text-caption font-semibold text-feedback-success-text">
                <CheckCircleIcon
                  className="h-3.5 w-3.5 text-feedback-success-icon"
                  aria-hidden="true"
                />
                <span>Focus Roadmap</span>
              </span>
            )}

            <span className="inline-flex items-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-caption font-medium text-text-secondary">
              {LEVEL_LABELS[displayedRoadmap.target_level] ??
                displayedRoadmap.target_level}
            </span>

            <span className="inline-flex items-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-caption font-mono text-text-secondary">
              v{displayedRoadmap.version_no}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={historyTriggerRef}
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setDrawerOpen(true)}
          >
            <ClockIcon className="h-4 w-4" aria-hidden="true" />
            <span>Version History</span>
          </Button>

          {currentRoadmap.status === 'locked' && !currentRoadmap.is_focus && (
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={switchingFocus}
              loadingText="Switching focus..."
              disabled={switchingFocus || archiving}
              onClick={() => void handleFocusSwitch()}
            >
              Set as Focus Roadmap
            </Button>
          )}

          {currentRoadmap.status === 'draft' && (
            <Link
              href={`/roadmaps/${encodeURIComponent(roadmapId)}/draft`}
              className={secondaryLinkClass}
            >
              Open Draft Review
            </Link>
          )}

          {(currentRoadmap.status === 'draft' ||
            currentRoadmap.status === 'locked') && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={switchingFocus || archiving}
              onClick={() => setArchiveModalOpen(true)}
            >
              Archive Roadmap
            </Button>
          )}
        </div>
      </header>

      {isViewingHistorical && historicalSnapshot && (
        <Alert
          variant="info"
          role="status"
          title={`Viewing Version v${historicalSnapshot.version_no} (Read-Only)`}
          action={{
            label: 'Return to Current',
            onClick: () => setHistoricalSnapshot(null),
          }}
        >
          You are inspecting immutable snapshot v{historicalSnapshot.version_no}. Switch back to see the active current version (v{currentRoadmap.version_no}).
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

      {uniqueWarnings.length > 0 && (
        <Alert variant="warning" role="status" title="Roadmap notes">
          <ul className="list-disc space-y-1 pl-4">
            {uniqueWarnings.map((warning) => (
              <li key={warning} dir="auto">
                {warning}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <section
        aria-labelledby="detail-summary-heading"
        className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
      >
        <h2
          id="detail-summary-heading"
          className="text-heading-md font-semibold text-text-primary"
        >
          Roadmap Summary
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
            <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Current Situation
            </dt>
            <dd className="mt-1.5 text-body-sm text-text-primary" dir="auto">
              {displayedRoadmap.summary.current_situation}
            </dd>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
            <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Target Interpretation
            </dt>
            <dd className="mt-1.5 text-body-sm text-text-primary" dir="auto">
              {displayedRoadmap.summary.target_interpretation}
            </dd>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
            <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Expected Career Impact
            </dt>
            <dd className="mt-1.5 text-body-sm text-text-primary" dir="auto">
              {displayedRoadmap.summary.expected_career_impact}
            </dd>
          </div>
        </dl>
        {displayedRoadmap.summary.next_steps.length > 0 && (
          <div className="mt-4 border-t border-border-subtle pt-4">
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Next Steps
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-text-secondary">
              {displayedRoadmap.summary.next_steps.map((step, idx) => (
                <li key={`${idx}-${step}`} dir="auto">
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {displayedRoadmap.level_outline.length > 0 && (
        <section
          aria-labelledby="detail-level-outline-heading"
          className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
        >
          <h2
            id="detail-level-outline-heading"
            className="text-heading-md font-semibold text-text-primary"
          >
            Career Level Outline
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {displayedRoadmap.level_outline.map((level) => (
              <div
                key={level.career_level}
                className={cn(
                  'rounded-lg border p-4',
                  level.career_level === displayedRoadmap.target_level
                    ? 'border-border-focus bg-surface-accent'
                    : 'border-border-subtle bg-surface-subtle',
                )}
              >
                <p className="text-label font-semibold text-text-primary">
                  {LEVEL_LABELS[level.career_level] ?? level.career_level}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-body-sm text-text-secondary">
                  {level.outline.map((bullet, idx) => (
                    <li key={`${level.career_level}-${idx}`} dir="auto">
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="detail-phases-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="detail-phases-heading"
            className="text-heading-md font-semibold text-text-primary"
          >
            Phases &amp; Curriculum
          </h2>
          <span className="text-caption text-text-muted">
            {displayedRoadmap.size_guardrail.active_topic_count} active topics
          </span>
        </div>

        {phases.map((phase) => (
          <article
            key={phase.phase_no}
            className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-3">
              <h3 className="text-heading-sm font-semibold text-text-primary" dir="auto">
                Phase {phase.phase_no}: {phase.title}
              </h3>
              <span className="text-caption text-text-muted">
                {phase.items.length} {phase.items.length === 1 ? 'topic' : 'topics'}
              </span>
            </div>

            {phase.milestones.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {phase.milestones.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center rounded-md border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-medium text-text-secondary"
                    dir="auto"
                  >
                    Milestone: {m.title}
                  </span>
                ))}
              </div>
            )}

            <ol className="mt-4 flex flex-col gap-3">
              {phase.items.map((item) => {
                const prereqs = resolvePrerequisites(item, titleById);
                return (
                  <li
                    key={item.item_id}
                    className="rounded-lg border border-border-default bg-surface-default p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption font-mono text-text-muted">
                          #{item.sequence_no}
                        </span>
                        <h4
                          className="text-label-lg font-semibold text-text-primary"
                          dir="auto"
                        >
                          {item.title}
                        </h4>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium',
                            PRIORITY_BADGE_CLASSES[item.priority],
                          )}
                        >
                          {PRIORITY_LABELS[item.priority]}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium',
                            GAP_BADGE_CLASSES[item.gap_type],
                          )}
                        >
                          {GAP_LABELS[item.gap_type]}
                        </span>
                        {item.estimated_effort_hours !== null && (
                          <span className="inline-flex items-center rounded-full border border-border-default bg-surface-subtle px-2 py-0.5 text-2xs text-text-secondary">
                            {item.estimated_effort_hours} hrs
                          </span>
                        )}
                      </div>
                    </div>

                    {item.required_depth && (
                      <p className="mt-1.5 text-caption text-text-muted" dir="auto">
                        Depth: {item.required_depth}
                      </p>
                    )}

                    {item.reason && (
                      <p className="mt-2 text-body-sm text-text-secondary" dir="auto">
                        {item.reason}
                      </p>
                    )}

                    {prereqs.length > 0 && (
                      <p className="mt-2 text-caption text-text-muted" dir="auto">
                        Prerequisites: {prereqs.join(', ')}
                      </p>
                    )}

                    {item.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3 text-caption">
                        {item.sources.map((src, idx) => {
                          const href = safeExternalUrl(src.url);
                          if (!href) return null;
                          return (
                            <a
                              key={`${item.item_id}-src-${idx}`}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-text-link underline underline-offset-2 hover:text-text-link-hover"
                            >
                              {src.publisher}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </article>
        ))}
      </section>

      {drawerOpen && (
        <div
          {...backdropDismiss}
          className="fixed inset-0 z-(--z-drawer) flex justify-end bg-surface-overlay"
        >
          <div
            ref={drawerPanelRef}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby={drawerTitleId}
            onKeyDown={handleDrawerKeyDown}
            className="flex h-full w-full max-w-md flex-col border-l border-border-default bg-surface-raised text-text-primary shadow-xl outline-none transition-transform duration-(--duration-normal) motion-reduce:transition-none"
          >
            <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
              <h2 id={drawerTitleId} className="text-heading-sm font-semibold">
                Version History
              </h2>
              <button
                type="button"
                aria-label="Close version history"
                onClick={() => setDrawerOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
              >
                <CloseIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
              {activeVersions === null ? (
                <div
                  role="status"
                  aria-busy="true"
                  aria-live="polite"
                  className="space-y-3"
                >
                  <span className="sr-only">Loading version history...</span>
                  {[0, 1, 2].map((idx) => (
                    <div
                      key={idx}
                      aria-hidden="true"
                      className="h-16 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none"
                    />
                  ))}
                </div>
              ) : activeVersions.status === 'error' ? (
                <Alert
                  variant="error_retryable"
                  role="alert"
                  onRetry={() => setVersionsReloadTick((prev) => prev + 1)}
                >
                  {activeVersions.error.message}
                </Alert>
              ) : activeVersions.items.length === 0 ? (
                <p className="text-body-sm text-text-secondary">
                  No versions found for this roadmap.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-2.5">
                    {activeVersions.items.map((version) => {
                      const isCurrentVersion =
                        version.version_no === currentRoadmap.version_no;
                      const isSelectedSnapshot =
                        displayedRoadmap.version_no === version.version_no;

                      return (
                        <li key={version.id}>
                          <button
                            type="button"
                            disabled={loadingSnapshotVersion !== null}
                            aria-current={isSelectedSnapshot ? 'true' : undefined}
                            onClick={() => void handleSelectVersion(version)}
                            className={cn(
                              'flex w-full flex-col gap-1 rounded-lg border p-3.5 text-left transition-colors duration-(--duration-fast) motion-reduce:transition-none',
                              isSelectedSnapshot
                                ? 'border-border-focus bg-surface-accent'
                                : 'border-border-default bg-surface-default hover:bg-surface-subtle',
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-label font-semibold text-text-primary">
                                Version v{version.version_no}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-full border border-border-default bg-surface-subtle px-2 py-0.5 text-2xs font-medium text-text-secondary">
                                  {version.state}
                                </span>
                                {isCurrentVersion && (
                                  <span className="rounded-full border border-feedback-success-border bg-feedback-success-background px-2 py-0.5 text-2xs font-semibold text-feedback-success-text">
                                    Current
                                  </span>
                                )}
                                {version.stale && (
                                  <span className="rounded-full border border-feedback-warning-border bg-feedback-warning-background px-2 py-0.5 text-2xs font-medium text-feedback-warning-text">
                                    Stale
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-caption text-text-muted">
                              {ORIGIN_LABELS[version.created_by] ?? version.created_by} ·{' '}
                              {LEVEL_LABELS[version.target_level] ?? version.target_level}
                            </p>
                            {loadingSnapshotVersion === version.version_no && (
                              <span className="text-caption text-text-brand">
                                Loading snapshot...
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {activeVersions.nextCursor && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={loadingMoreVersions}
                      onClick={() => void handleLoadMoreVersions()}
                    >
                      Load older versions
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        variant="confirm"
        title={`Archive "${currentRoadmap.role_name}"?`}
        description="Archiving preserves all learning progress, shared skill evidence, and daily plans. If this is your Focus Roadmap, focus will automatically reassign to another active locked roadmap if available."
        confirmLabel="Archive Roadmap"
        loading={archiving}
        onConfirm={() => void handleConfirmArchive()}
      />
    </main>
  );
}
