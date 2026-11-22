'use client';

import {
  useCallback,
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
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  LockIcon,
} from '@/components/ui/icons';
import { Modal, useBackdropDismiss } from '@/components/ui/modal';
import { Toast } from '@/components/ui/toast';

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

const primaryLinkClass =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-action-primary-background px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active motion-reduce:transition-none';

const secondaryLinkClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-action-secondary-border bg-action-secondary-background px-3.5 py-2 text-label font-medium leading-none text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active motion-reduce:transition-none';

function ArrowLeftIcon({ className }: { className?: string }) {
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
      data-icon="arrow-left"
      className={cn('block shrink-0', className)}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
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
  const drawerSessionRef = useRef(0);
  const snapshotAbortRef = useRef<AbortController | null>(null);
  const loadMoreVersionsAbortRef = useRef<AbortController | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<DetailFetchState | null>(null);
  const [historicalSnapshot, setHistoricalSnapshot] =
    useState<RoadmapDetailDTO | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerError, setDrawerError] = useState<MappedError | null>(null);
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
  const [archiveToast, setArchiveToast] = useState<ArchiveToast>(null);

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

  const openDrawer = useCallback(() => {
    drawerSessionRef.current += 1;
    snapshotAbortRef.current?.abort();
    snapshotAbortRef.current = null;
    loadMoreVersionsAbortRef.current?.abort();
    loadMoreVersionsAbortRef.current = null;
    setLoadingSnapshotVersion(null);
    setLoadingMoreVersions(false);
    setDrawerError(null);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    drawerSessionRef.current += 1;
    snapshotAbortRef.current?.abort();
    snapshotAbortRef.current = null;
    loadMoreVersionsAbortRef.current?.abort();
    loadMoreVersionsAbortRef.current = null;
    setLoadingSnapshotVersion(null);
    setLoadingMoreVersions(false);
    setDrawerOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      snapshotAbortRef.current?.abort();
      loadMoreVersionsAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const triggerEl = historyTriggerRef.current;
    const prevActive = document.activeElement as HTMLElement | null;
    const first =
      drawerPanelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      drawerPanelRef.current;
    first?.focus({ preventScroll: true });

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      const computedPadding = Number.parseFloat(
        window.getComputedStyle(document.body).paddingRight || '0',
      );
      document.body.style.paddingRight = `${(Number.isNaN(computedPadding) ? 0 : computedPadding) + scrollbarWidth}px`;
    }
    document.body.style.overflow = 'hidden';

    const onDocKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        closeDrawer();
      }
    };
    document.addEventListener('keydown', onDocKeyDown);

    return () => {
      document.removeEventListener('keydown', onDocKeyDown);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      (triggerEl ?? prevActive)?.focus({ preventScroll: true });
    };
  }, [closeDrawer, drawerOpen]);

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
    closeDrawer,
    loadingSnapshotVersion !== null,
  );

  const handleDrawerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDrawer();
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
      closeDrawer();
      return;
    }
    const sessionId = drawerSessionRef.current;
    snapshotAbortRef.current?.abort();
    const controller = new AbortController();
    snapshotAbortRef.current = controller;
    setLoadingSnapshotVersion(version.version_no);
    setDrawerError(null);
    try {
      const snapshot = await getRoadmapVersion(
        accessToken,
        roadmapId,
        version.version_no,
        { signal: controller.signal },
      );
      if (sessionId !== drawerSessionRef.current || controller.signal.aborted) {
        return;
      }
      setHistoricalSnapshot(snapshot);
      closeDrawer();
    } catch (err) {
      if (sessionId !== drawerSessionRef.current || controller.signal.aborted) {
        return;
      }
      setDrawerError(mapApiError(err));
    } finally {
      if (snapshotAbortRef.current === controller) {
        snapshotAbortRef.current = null;
      }
      if (sessionId === drawerSessionRef.current) {
        setLoadingSnapshotVersion(null);
      }
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
    const sessionId = drawerSessionRef.current;
    loadMoreVersionsAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreVersionsAbortRef.current = controller;
    setLoadingMoreVersions(true);
    setDrawerError(null);
    try {
      const page = await listRoadmapVersions(
        accessToken,
        roadmapId,
        {
          cursor: activeVersions.nextCursor,
          limit: 50,
        },
        { signal: controller.signal },
      );
      if (sessionId !== drawerSessionRef.current || controller.signal.aborted) {
        return;
      }
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
      if (sessionId !== drawerSessionRef.current || controller.signal.aborted) {
        return;
      }
      setDrawerError(mapApiError(err));
    } finally {
      if (loadMoreVersionsAbortRef.current === controller) {
        loadMoreVersionsAbortRef.current = null;
      }
      if (sessionId === drawerSessionRef.current) {
        setLoadingMoreVersions(false);
      }
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
    setArchiveToast(null);
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
      setArchiveToast(
        formatArchiveFeedback(res, Boolean(currentRoadmap.is_focus)),
      );
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
      <header className="border-b border-border-default pb-5">
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm leading-none">
            <li className="inline-flex items-center gap-1.5 leading-none">
              <Link
                href="/roadmaps"
                className="inline-flex items-center gap-1.5 leading-none font-medium text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-400 dark:hover:text-teal-300"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5 shrink-0" />
                <span>Roadmaps</span>
              </Link>
            </li>
            <li
              aria-hidden="true"
              className="inline-flex items-center leading-none text-slate-400"
            >
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </li>
            <li
              aria-current="page"
              className="inline-flex items-center leading-none font-medium text-slate-500 dark:text-slate-400"
              dir="auto"
            >
              {displayedRoadmap.role_name}
            </li>
          </ol>
        </nav>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <h1
              className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100"
              dir="auto"
            >
              {displayedRoadmap.role_name}
            </h1>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium leading-none',
                  STATUS_BADGE_CLASSES[currentRoadmap.status],
                )}
              >
                {currentRoadmap.status === 'locked' && (
                  <LockIcon className="block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                {currentRoadmap.status === 'archived' && (
                  <ArchiveIcon className="block h-3.5 w-3.5 shrink-0" />
                )}
                <span>{STATUS_LABELS[currentRoadmap.status]}</span>
              </span>

              {currentRoadmap.is_focus && !isViewingHistorical && (
                <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-2.5 py-1 text-caption font-semibold leading-none text-feedback-success-text">
                  <CheckCircleIcon
                    className="block h-3.5 w-3.5 shrink-0 text-feedback-success-icon"
                    aria-hidden="true"
                  />
                  <span>Focus Roadmap</span>
                </span>
              )}

              <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-medium leading-none text-text-secondary">
                {LEVEL_LABELS[displayedRoadmap.target_level] ??
                  displayedRoadmap.target_level}
              </span>

              <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-mono leading-none text-text-secondary">
                v{displayedRoadmap.version_no}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {(currentRoadmap.status === 'draft' ||
              currentRoadmap.status === 'locked') && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={switchingFocus || archiving}
                onClick={() => setArchiveModalOpen(true)}
                className="h-9 rounded-lg border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
              >
                <ArchiveIcon className="block h-4 w-4 shrink-0" />
                <span>Archive Roadmap</span>
              </Button>
            )}

            <Button
              ref={historyTriggerRef}
              type="button"
              variant="secondary"
              size="sm"
              onClick={openDrawer}
              className="h-9 rounded-lg border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <ClockIcon className="block h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Version History</span>
            </Button>

            {currentRoadmap.status === 'locked' && !currentRoadmap.is_focus && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={switchingFocus}
                loadingText="Switching focus..."
                disabled={switchingFocus || archiving}
                onClick={() => void handleFocusSwitch()}
                className="h-9 rounded-lg px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap"
              >
                <span>Set as Focus Roadmap</span>
              </Button>
            )}

            {currentRoadmap.status === 'draft' && (
              <Link
                href={`/roadmaps/${encodeURIComponent(roadmapId)}/draft`}
                className={primaryLinkClass}
              >
                <span>Open Draft Review</span>
                <ArrowRightIcon className="block h-4 w-4 shrink-0" />
              </Link>
            )}
          </div>
        </div>
      </header>

      {currentRoadmap.status === 'archived' && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300"
        >
          <ArchiveIcon className="block h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
          <span>
            This roadmap is archived and read-only. Your learning progress and skill evidence remain preserved.
          </span>
        </div>
      )}

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
                            'inline-flex items-center justify-center rounded-full border px-2 py-1 text-2xs font-medium leading-none',
                            PRIORITY_BADGE_CLASSES[item.priority],
                          )}
                        >
                          {PRIORITY_LABELS[item.priority]}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center justify-center rounded-full border px-2 py-1 text-2xs font-medium leading-none',
                            GAP_BADGE_CLASSES[item.gap_type],
                          )}
                        >
                          {GAP_LABELS[item.gap_type]}
                        </span>
                        {item.estimated_effort_hours !== null && (
                          <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2 py-1 text-2xs leading-none text-text-secondary">
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

      <div
        aria-hidden={!drawerOpen}
        inert={!drawerOpen ? true : undefined}
        className={cn(
          'fixed inset-0 z-50 flex justify-end overflow-hidden transition-[visibility] duration-300 motion-reduce:transition-none',
          drawerOpen
            ? 'visible pointer-events-auto'
            : 'invisible pointer-events-none',
        )}
      >
        <div
          {...backdropDismiss}
          data-testid="version-history-backdrop"
          aria-hidden="true"
          className={cn(
            'absolute inset-0 bg-slate-900/35 backdrop-blur-[1px] transition-opacity duration-300 ease-out motion-reduce:transition-none',
            drawerOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          ref={drawerPanelRef}
          role={drawerOpen ? 'dialog' : undefined}
          tabIndex={drawerOpen ? -1 : undefined}
          aria-modal={drawerOpen ? 'true' : undefined}
          aria-labelledby={drawerOpen ? drawerTitleId : undefined}
          onKeyDown={handleDrawerKeyDown}
          className={cn(
            'relative z-10 flex h-full w-full max-w-md flex-col border-l border-border-default bg-surface-raised text-text-primary shadow-xl outline-none transform-gpu will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            drawerOpen ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
            <h2 id={drawerTitleId} className="text-heading-sm font-semibold">
              Version History
            </h2>
            <button
              type="button"
              aria-label="Close version history"
              onClick={closeDrawer}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text-primary"
            >
              <CloseIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-5">
            {drawerError && (
              <Alert
                variant={
                  drawerError.tone === 'info'
                    ? 'info'
                    : drawerError.tone === 'warning'
                      ? 'warning'
                      : 'error_retryable'
                }
                role="alert"
                retryAfterSeconds={drawerError.retryAfterSeconds}
              >
                {drawerError.message}
              </Alert>
            )}
            {activeVersions === null ? (
              drawerOpen ? (
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
              ) : null
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
                              <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2 py-1 text-2xs font-medium leading-none text-text-secondary">
                                {version.state}
                              </span>
                              {isCurrentVersion && (
                                <span className="inline-flex items-center justify-center rounded-full border border-feedback-success-border bg-feedback-success-background px-2 py-1 text-2xs font-semibold leading-none text-feedback-success-text">
                                  Current
                                </span>
                              )}
                              {version.stale && (
                                <span className="inline-flex items-center justify-center rounded-full border border-feedback-warning-border bg-feedback-warning-background px-2 py-1 text-2xs font-medium leading-none text-feedback-warning-text">
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
        open={archiveModalOpen}
        onClose={() => setArchiveModalOpen(false)}
        variant="confirm"
        title={`Archive "${currentRoadmap.role_name}"?`}
        description="Archiving this roadmap also discontinues its linked career goal. Archiving preserves all learning progress, shared skill evidence, and daily plans. If this is your Focus Roadmap, focus will automatically reassign to another active locked roadmap if available."
        confirmLabel="Archive Roadmap"
        loading={archiving}
        onConfirm={() => void handleConfirmArchive()}
      />
    </main>
  );
}
