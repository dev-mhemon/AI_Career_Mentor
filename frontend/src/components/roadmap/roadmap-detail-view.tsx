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
import { useRouter } from 'next/navigation';
import {
  acceptRoadmapMerge,
  archiveRoadmap,
  focusRoadmap,
  getRoadmap,
  getRoadmapMerge,
  getRoadmapVersion,
  listRoadmapMerges,
  listRoadmapVersions,
  rejectRoadmapMerge,
  undoLastRoadmapMerge,
  type AcceptRoadmapMergeResultDTO,
  type ArchiveRoadmapResponseDTO,
  type CareerLevel,
  type FocusSwitchResponseDTO,
  type ItemPriority,
  type MergeOrigin,
  type MergeProposalDTO,
  type MergeStatus,
  type MergeSummaryDTO,
  type PaginatedMergeListDTO,
  type RejectRoadmapMergeResultDTO,
  type RoadmapDetailDTO,
  type RoadmapItemDTO,
  type RoadmapPhaseDTO,
  type RoadmapStatus,
  type RoadmapVersionDTO,
  type RoadmapVersionListResponseDTO,
  type RoadmapVersionOrigin,
  type SkillGapType,
  type UserMergeOrigin,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AccordionItem } from '@/components/ui/accordion';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompassIcon,
  LockIcon,
  MessageSquareIcon,
} from '@/components/ui/icons';
import { Modal, useBackdropDismiss } from '@/components/ui/modal';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Toast } from '@/components/ui/toast';
import { HoursPromptModal } from '@/components/learning/hours-prompt-modal';
import {
  RequestMergeModal,
  type MergeModalJobState,
} from './request-merge-modal';
import { RoadmapDiffViewer } from './roadmap-diff-viewer';

export type RoadmapDetailTab = 'active' | 'outline' | 'merges' | 'versions';

export interface RoadmapDetailViewProps {
  accessToken: string;
  roadmapId: string;
  preferredDailyHours?: number | null;
  initialRoadmap?: RoadmapDetailDTO;
  initialVersions?: RoadmapVersionListResponseDTO;
  initialMerges?: PaginatedMergeListDTO;
  initialTab?: RoadmapDetailTab;
  roadmapGeneratorEnabled?: boolean;
}

type MergesFetchState =
  | {
      key: string;
      status: 'loaded';
      items: MergeSummaryDTO[];
      nextCursor: string | null;
    }
  | { key: string; status: 'error'; error: MappedError };

const MERGE_ORIGIN_LABELS: Record<MergeOrigin, string> = {
  user_request: 'User Request',
  level_change: 'Career Level Change',
  ai_proposal: 'AI Proposal',
};

const MERGE_STATUS_LABELS: Record<MergeStatus, string> = {
  proposed: 'Pending Review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  undone: 'Undone',
  superseded: 'Superseded',
};

type MergeCardStyle = {
  cardClass: string;
  badgeClass: string;
  summaryClass: string;
  triggerClass: string;
};

const MERGE_STATUS_CARD_STYLES: Record<MergeStatus, MergeCardStyle> = {
  proposed: {
    cardClass:
      'border-l-4 border-l-teal-600 border-teal-200/90 bg-white shadow-sm ring-1 ring-teal-100/80 dark:border-l-teal-500 dark:border-teal-800/80 dark:bg-slate-900 dark:ring-teal-900/40',
    badgeClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-200',
    summaryClass: 'text-text-primary',
    triggerClass:
      'border-transparent bg-teal-600 text-white shadow-xs hover:bg-teal-700 dark:bg-teal-600 dark:hover:bg-teal-500',
  },
  accepted: {
    cardClass:
      'border-l-4 border-l-emerald-500 border-emerald-200/70 bg-emerald-50/20 dark:border-l-emerald-500 dark:border-emerald-900/70 dark:bg-emerald-950/15',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    summaryClass: 'text-text-secondary',
    triggerClass:
      'border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
  },
  undone: {
    cardClass:
      'border-l-4 border-l-amber-400 border-amber-200/80 bg-amber-50/25 dark:border-l-amber-500 dark:border-amber-900/70 dark:bg-amber-950/15',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
    summaryClass: 'text-text-secondary',
    triggerClass:
      'border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
  },
  rejected: {
    cardClass:
      'border-l-4 border-l-rose-400 border-rose-200/80 bg-rose-50/45 dark:border-l-rose-500 dark:border-rose-900/70 dark:bg-rose-950/20',
    badgeClass:
      'border-rose-200 bg-rose-100/70 text-rose-700 dark:border-rose-800/80 dark:bg-rose-950/60 dark:text-rose-300',
    summaryClass: 'text-slate-700 dark:text-slate-300',
    triggerClass:
      'border-slate-200 bg-white/90 text-slate-700 shadow-2xs hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
  },
  superseded: {
    cardClass:
      'border-l-4 border-l-slate-300 border-slate-200 bg-slate-50/60 dark:border-l-slate-700 dark:border-slate-800 dark:bg-slate-900/50',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    summaryClass: 'text-slate-600 dark:text-slate-400',
    triggerClass:
      'border-slate-200 bg-white/90 text-slate-600 shadow-2xs hover:bg-white hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
  },
};

function MergeStatusIcon({ status }: { status: MergeStatus }) {
  if (status === 'proposed') {
    return (
      <ClockIcon className="block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    );
  }
  if (status === 'accepted') {
    return (
      <CheckCircleIcon
        className="block h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      />
    );
  }
  if (status === 'undone') {
    return <UndoIcon className="block h-3.5 w-3.5 shrink-0" />;
  }
  if (status === 'rejected') {
    return (
      <CloseIcon className="block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    );
  }
  return null;
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('block h-4 w-4 shrink-0', className)}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function EditPencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('block h-3.5 w-3.5 shrink-0', className)}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

type VersionStateMeta = {
  label: string;
  badgeClass: string;
};

const VERSION_STATE_META: Record<string, VersionStateMeta> = {
  locked: {
    label: 'Locked',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  superseded: {
    label: 'Superseded',
    badgeClass:
      'border-slate-200/90 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  restored: {
    label: 'Restored',
    badgeClass:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  },
  draft: {
    label: 'Draft',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  },
};

function VersionStateBadge({ state }: { state: string }) {
  const key = state.trim().toLowerCase();
  const meta = VERSION_STATE_META[key] ?? {
    label: key ? `${key[0].toUpperCase()}${key.slice(1)}` : state,
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium leading-none',
        meta.badgeClass,
      )}
    >
      {key === 'locked' && (
        <LockIcon className="block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      {key === 'superseded' && (
        <ArchiveIcon className="block h-3.5 w-3.5 shrink-0" />
      )}
      {key === 'restored' && (
        <UndoIcon className="block h-3.5 w-3.5 shrink-0" />
      )}
      {key === 'draft' && (
        <EditPencilIcon className="block h-3.5 w-3.5 shrink-0" />
      )}
      <span>{meta.label}</span>
    </span>
  );
}

function generateClientIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-000000000000'.replace(/[08]/g, (c) =>
    (
      Number(c) ^
      (Math.floor(Math.random() * 16) & (15 >> (Number(c) / 4)))
    ).toString(16),
  );
}

function SparkleEditIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function LevelUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m17 11-5-5-5 5" />
      <path d="m17 18-5-5-5 5" />
    </svg>
  );
}

function UndoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
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
      actionLabel?: string;
      onAction?: () => void;
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

function formatFocusFeedback(
  res: FocusSwitchResponseDTO,
  onOpenHoursModal: () => void,
): NonNullable<DetailFeedback> {
  if (
    res.daily_plan.state === 'missing' &&
    res.daily_plan.requires_learning_hours
  ) {
    return {
      variant: 'warning',
      title: 'Focus Roadmap updated — set your daily learning hours',
      message:
        'This roadmap is now your Focus Roadmap. Choose your preferred daily study hours to create its Daily Plan.',
      actionLabel: 'Create Daily Plan',
      onAction: onOpenHoursModal,
    };
  }
  if (res.daily_plan.state === 'missing') {
    return {
      variant: 'info',
      title: 'Focus Roadmap updated',
      message:
        'This roadmap is now your Focus Roadmap. Create a Daily Plan to begin sequential daily lessons.',
      actionLabel: 'Create Daily Plan',
      onAction: onOpenHoursModal,
    };
  }
  return {
    variant: 'success',
    title: 'Focus Roadmap updated',
    message:
      'This roadmap is now your Focus Roadmap, and its existing Daily Plan is active and ready.',
    href: '/today',
    hrefLabel: 'Open Today',
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
  preferredDailyHours = null,
  initialRoadmap,
  initialVersions,
  initialMerges,
  initialTab,
  roadmapGeneratorEnabled = true,
}: RoadmapDetailViewProps) {
  const router = useRouter();
  const drawerTitleId = useId();
  const detailTabListId = useId();
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerSessionRef = useRef(0);
  const versionsSessionRef = useRef(0);
  const mergesSessionRef = useRef(0);
  const expandedDrawerSessionRef = useRef<number | null>(null);
  const snapshotAbortRef = useRef<AbortController | null>(null);
  const loadMoreVersionsAbortRef = useRef<AbortController | null>(null);
  const loadMoreMergesAbortRef = useRef<AbortController | null>(null);
  const mergeDetailAbortRef = useRef<AbortController | null>(null);
  const mergeDetailSessionRef = useRef(0);
  const activeTabRef = useRef<RoadmapDetailTab>('active');
  const scopeKeyRef = useRef(`${accessToken}:${roadmapId}`);
  const requestKeyRef = useRef('');
  const mountedRef = useRef(true);

  const [activeTab, setActiveTab] = useState<RoadmapDetailTab>(() => {
    if (initialTab) return initialTab;
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('tab');
      if (
        param === 'active' ||
        param === 'outline' ||
        param === 'merges' ||
        param === 'versions'
      ) {
        return param;
      }
    }
    return 'active';
  });

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
  const [refreshingVersions, setRefreshingVersions] = useState(false);
  const [loadingMoreVersionsKey, setLoadingMoreVersionsKey] = useState<
    string | null
  >(null);
  const [loadingSnapshotVersion, setLoadingSnapshotVersion] = useState<
    number | null
  >(null);

  const [mergesReloadTick, setMergesReloadTick] = useState(0);
  const [mergesState, setMergesState] = useState<MergesFetchState | null>(null);
  const [loadingMoreMergesKey, setLoadingMoreMergesKey] = useState<
    string | null
  >(null);
  const [mutatingMergeState, setMutatingMergeState] = useState<{
    mergeId: string;
    action: 'accept' | 'reject';
  } | null>(null);
  const [mergeMutationErrorState, setMergeMutationErrorState] = useState<{
    roadmapId: string;
    mergeId: string;
    error: MappedError;
  } | null>(null);
  const [mergeListActionError, setMergeListActionError] =
    useState<MappedError | null>(null);
  const [expandedMergeState, setExpandedMergeState] = useState<{
    roadmapId: string;
    mergeId: string | null;
  }>({ roadmapId, mergeId: null });
  const [mergeDetailsCache, setMergeDetailsCache] = useState<{
    roadmapId: string;
    byId: Record<string, MergeProposalDTO>;
  }>({ roadmapId, byId: {} });
  const [loadingMergeId, setLoadingMergeId] = useState<string | null>(null);
  const [mergeDetailErrorState, setMergeDetailErrorState] = useState<{
    roadmapId: string;
    mergeId: string;
    error: MappedError;
  } | null>(null);
  const [mergeModalState, setMergeModalState] = useState<{
    open: boolean;
    mode: UserMergeOrigin;
  }>({ open: false, mode: 'user_request' });
  const [mergeJobByRoadmap, setMergeJobByRoadmap] = useState<
    Record<string, MergeModalJobState | null>
  >({});
  const [undoModalVersionNo, setUndoModalVersionNo] = useState<number | null>(
    null,
  );
  const undoModalOpen = undoModalVersionNo !== null;
  const scopeKey = `${accessToken}:${roadmapId}`;
  const [undoingScope, setUndoingScope] = useState<string | null>(null);
  const [switchingFocusScope, setSwitchingFocusScope] = useState<string | null>(
    null,
  );
  const [archiveModalOpen, setArchiveModalOpen] = useState(false);
  const [archivingScope, setArchivingScope] = useState<string | null>(null);
  const undoing = undoingScope === scopeKey;
  const switchingFocus = switchingFocusScope === scopeKey;
  const archiving = archivingScope === scopeKey;
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [feedback, setFeedback] = useState<DetailFeedback>(null);
  const [archiveToast, setArchiveToast] = useState<ArchiveToast>(null);
  const [hoursModalTarget, setHoursModalTarget] = useState<{
    roadmapId: string;
    roadmapTitle?: string;
    initialHours: number | null;
  } | null>(null);

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
  const loadingMoreVersions = loadingMoreVersionsKey === versionsKey;
  const seededVersions =
    initialVersions && versionsReloadTick === 0 ? initialVersions : null;
  const shouldLoadVersions = drawerOpen || activeTab === 'versions';

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    scopeKeyRef.current = `${accessToken}:${roadmapId}`;
    requestKeyRef.current = requestKey;
  }, [accessToken, requestKey, roadmapId]);

  useEffect(() => {
    if (!shouldLoadVersions || seededVersions) {
      return;
    }

    let active = true;
    const effectSession = drawerSessionRef.current;
    versionsSessionRef.current += 1;
    loadMoreVersionsAbortRef.current?.abort();
    loadMoreVersionsAbortRef.current = null;
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
        setRefreshingVersions(false);
        setVersionsState((prev) => {
          if (
            expandedDrawerSessionRef.current === effectSession &&
            prev &&
            prev.key === versionsKey &&
            prev.status === 'loaded'
          ) {
            const seen = new Set(res.items.map((v) => v.id));
            return {
              key: versionsKey,
              status: 'loaded',
              items: [...res.items, ...prev.items.filter((v) => !seen.has(v.id))],
              nextCursor: prev.nextCursor,
            };
          }
          return {
            key: versionsKey,
            status: 'loaded',
            items: res.items,
            nextCursor: res.meta.next_cursor,
          };
        });
      })
      .catch((err) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setRefreshingVersions(false);
        setVersionsState({
          key: versionsKey,
          status: 'error',
          error: mapApiError(err),
        });
      });

    return () => {
      active = false;
      controller.abort();
      loadMoreVersionsAbortRef.current?.abort();
      loadMoreVersionsAbortRef.current = null;
    };
  }, [accessToken, roadmapId, seededVersions, shouldLoadVersions, versionsKey]);

  const mergesKey = `${accessToken}:${roadmapId}:merges:${mergesReloadTick}`;
  const loadingMoreMerges = loadingMoreMergesKey === mergesKey;
  const seededMerges =
    initialMerges && mergesReloadTick === 0 ? initialMerges : null;

  useEffect(() => {
    if (seededMerges) {
      return;
    }

    let active = true;
    mergesSessionRef.current += 1;
    loadMoreMergesAbortRef.current?.abort();
    loadMoreMergesAbortRef.current = null;
    const controller = new AbortController();

    listRoadmapMerges(
      accessToken,
      roadmapId,
      { limit: 20 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setMergesState({
          key: mergesKey,
          status: 'loaded',
          items: res.items,
          nextCursor: res.meta.next_cursor,
        });
      })
      .catch((err) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setMergesState({
          key: mergesKey,
          status: 'error',
          error: mapApiError(err),
        });
      });

    return () => {
      active = false;
      controller.abort();
      loadMoreMergesAbortRef.current?.abort();
      loadMoreMergesAbortRef.current = null;
    };
  }, [accessToken, mergesKey, roadmapId, seededMerges]);

  const openDrawer = useCallback(() => {
    drawerSessionRef.current += 1;
    versionsSessionRef.current += 1;
    expandedDrawerSessionRef.current = null;
    snapshotAbortRef.current?.abort();
    snapshotAbortRef.current = null;
    loadMoreVersionsAbortRef.current?.abort();
    loadMoreVersionsAbortRef.current = null;
    setLoadingSnapshotVersion(null);
    setLoadingMoreVersionsKey(null);
    setDrawerError(null);
    if (!seededVersions) {
      setRefreshingVersions(true);
      if (shouldLoadVersions) {
        setVersionsReloadTick((prev) => prev + 1);
      }
    } else {
      setRefreshingVersions(false);
    }
    setDrawerOpen(true);
  }, [seededVersions, shouldLoadVersions]);

  const closeDrawer = useCallback(() => {
    drawerSessionRef.current += 1;
    versionsSessionRef.current += 1;
    expandedDrawerSessionRef.current = null;
    snapshotAbortRef.current?.abort();
    snapshotAbortRef.current = null;
    loadMoreVersionsAbortRef.current?.abort();
    loadMoreVersionsAbortRef.current = null;
    setLoadingSnapshotVersion(null);
    setLoadingMoreVersionsKey(null);
    setRefreshingVersions(false);
    setDrawerOpen(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      snapshotAbortRef.current?.abort();
      loadMoreVersionsAbortRef.current?.abort();
      loadMoreMergesAbortRef.current?.abort();
      mergeDetailAbortRef.current?.abort();
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

  const activeMerges =
    mergesState && mergesState.key === mergesKey
      ? mergesState
      : seededMerges
        ? {
            key: mergesKey,
            status: 'loaded' as const,
            items: seededMerges.items,
            nextCursor: seededMerges.meta.next_cursor,
          }
        : null;

  const hasOpenMerge =
    activeMerges?.status === 'loaded' &&
    activeMerges.items.some((m) => m.status === 'proposed');
  const undoableMergeSummary =
    currentRoadmap?.status === 'locked' && activeMerges?.status === 'loaded'
      ? (activeMerges.items.find((m) => m.undo_available) ?? null)
      : null;

  const expandedMergeId =
    expandedMergeState.roadmapId === roadmapId
      ? expandedMergeState.mergeId
      : null;
  const activeMergeDetailsById =
    mergeDetailsCache.roadmapId === roadmapId ? mergeDetailsCache.byId : {};
  const activeMergeDetailError =
    mergeDetailErrorState && mergeDetailErrorState.roadmapId === roadmapId
      ? mergeDetailErrorState
      : null;

  const collapseMergeAccordion = useCallback(() => {
    mergeDetailSessionRef.current += 1;
    mergeDetailAbortRef.current?.abort();
    mergeDetailAbortRef.current = null;
    setLoadingMergeId(null);
    setExpandedMergeState({ roadmapId, mergeId: null });
    setMergeDetailErrorState(null);
  }, [roadmapId]);

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

  const handleSelectVersion = async (
    version: RoadmapVersionDTO,
    options?: { switchToActiveTab?: boolean },
  ) => {
    if (!currentRoadmap || loadingSnapshotVersion !== null) {
      return;
    }
    if (version.version_no === currentRoadmap.version_no) {
      setHistoricalSnapshot(null);
      setDrawerError(null);
      if (drawerOpen) {
        closeDrawer();
      }
      if (options?.switchToActiveTab) {
        setActiveTab('active');
      }
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
      if (drawerOpen) {
        closeDrawer();
      }
      if (options?.switchToActiveTab) {
        setActiveTab('active');
      }
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
      loadingMoreVersions ||
      refreshingVersions
    ) {
      return;
    }
    const sessionId = drawerSessionRef.current;
    const versionsSession = versionsSessionRef.current;
    const targetVersionsKey = versionsKey;
    loadMoreVersionsAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreVersionsAbortRef.current = controller;
    setLoadingMoreVersionsKey(targetVersionsKey);
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
      if (
        sessionId !== drawerSessionRef.current ||
        versionsSession !== versionsSessionRef.current ||
        controller.signal.aborted
      ) {
        return;
      }
      expandedDrawerSessionRef.current = sessionId;
      setVersionsState((prev) => {
        const existing =
          prev && prev.key === targetVersionsKey && prev.status === 'loaded'
            ? prev.items
            : activeVersions.items;
        const seen = new Set(existing.map((v) => v.id));
        return {
          key: targetVersionsKey,
          status: 'loaded',
          items: [...existing, ...page.items.filter((v) => !seen.has(v.id))],
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      if (
        sessionId !== drawerSessionRef.current ||
        versionsSession !== versionsSessionRef.current ||
        controller.signal.aborted
      ) {
        return;
      }
      setDrawerError(mapApiError(err));
    } finally {
      if (loadMoreVersionsAbortRef.current === controller) {
        loadMoreVersionsAbortRef.current = null;
      }
      if (
        sessionId === drawerSessionRef.current &&
        versionsSession === versionsSessionRef.current
      ) {
        setLoadingMoreVersionsKey((prev) =>
          prev === targetVersionsKey ? null : prev,
        );
      }
    }
  };

  const handleFocusSwitch = async () => {
    if (!currentRoadmap || switchingFocus || archiving) {
      return;
    }
    const startScope = `${accessToken}:${roadmapId}`;
    const startRequestKey = requestKey;
    const startRoadmap = currentRoadmap;
    setSwitchingFocusScope(startScope);
    setActionError(null);
    setFeedback(null);
    try {
      const res = await focusRoadmap(accessToken, roadmapId);
      if (!mountedRef.current || scopeKeyRef.current !== startScope) {
        return;
      }
      if (requestKeyRef.current !== startRequestKey) {
        setReloadTick((prev) => prev + 1);
      } else {
        setFetchState((prev) =>
          prev && prev.key === startRequestKey && prev.status === 'loaded'
            ? {
                ...prev,
                roadmap: {
                  ...prev.roadmap,
                  is_focus: res.focus_roadmap_id === prev.roadmap.id,
                },
              }
            : {
                key: startRequestKey,
                status: 'loaded',
                roadmap: {
                  ...startRoadmap,
                  is_focus: res.focus_roadmap_id === startRoadmap.id,
                },
              },
        );
      }
      const openHoursModal = () =>
        setHoursModalTarget({
          roadmapId: startRoadmap.id,
          roadmapTitle: startRoadmap.role_name,
          initialHours: res.daily_plan.requires_learning_hours
            ? null
            : preferredDailyHours,
        });
      setFeedback(formatFocusFeedback(res, openHoursModal));
      if (res.daily_plan.state === 'missing') {
        openHoursModal();
      }
    } catch (err) {
      if (!mountedRef.current || scopeKeyRef.current !== startScope) {
        return;
      }
      setActionError(mapApiError(err));
    } finally {
      if (mountedRef.current) {
        setSwitchingFocusScope((prev) => (prev === startScope ? null : prev));
      }
    }
  };

  const fetchMergeDetail = async (mergeId: string) => {
    mergeDetailSessionRef.current += 1;
    const session = mergeDetailSessionRef.current;
    mergeDetailAbortRef.current?.abort();
    const controller = new AbortController();
    mergeDetailAbortRef.current = controller;
    setMergeDetailErrorState(null);
    setLoadingMergeId(mergeId);

    try {
      const detail = await getRoadmapMerge(accessToken, roadmapId, mergeId, {
        signal: controller.signal,
      });
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        mergeDetailSessionRef.current !== session
      ) {
        return;
      }
      setMergeDetailsCache((prev) => ({
        roadmapId,
        byId: {
          ...(prev.roadmapId === roadmapId ? prev.byId : {}),
          [mergeId]: detail,
        },
      }));
    } catch (err) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        mergeDetailSessionRef.current !== session
      ) {
        return;
      }
      setMergeDetailErrorState({
        roadmapId,
        mergeId,
        error: mapApiError(err),
      });
    } finally {
      if (mergeDetailAbortRef.current === controller) {
        mergeDetailAbortRef.current = null;
      }
      if (mountedRef.current && mergeDetailSessionRef.current === session) {
        setLoadingMergeId(null);
      }
    }
  };

  const handleToggleMergeAccordion = (mergeId: string) => {
    if (expandedMergeId === mergeId) {
      collapseMergeAccordion();
      return;
    }
    setActiveTab('merges');
    setExpandedMergeState({ roadmapId, mergeId });
    setMergeDetailErrorState(null);
    if (!activeMergeDetailsById[mergeId]) {
      void fetchMergeDetail(mergeId);
    } else {
      mergeDetailAbortRef.current?.abort();
      mergeDetailAbortRef.current = null;
      setLoadingMergeId(null);
    }
  };

  const handleLoadMoreMerges = async () => {
    if (
      activeMerges?.status !== 'loaded' ||
      !activeMerges.nextCursor ||
      loadingMoreMerges
    ) {
      return;
    }
    const targetKey = mergesKey;
    const session = mergesSessionRef.current;
    loadMoreMergesAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreMergesAbortRef.current = controller;
    setLoadingMoreMergesKey(targetKey);
    setMergeListActionError(null);
    try {
      const page = await listRoadmapMerges(
        accessToken,
        roadmapId,
        { cursor: activeMerges.nextCursor, limit: 20 },
        { signal: controller.signal },
      );
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        mergesSessionRef.current !== session
      ) {
        return;
      }
      setMergesState((prev) => {
        const existing =
          prev && prev.key === targetKey && prev.status === 'loaded'
            ? prev.items
            : activeMerges.items;
        const seen = new Set(existing.map((m) => m.id));
        return {
          key: targetKey,
          status: 'loaded',
          items: [...existing, ...page.items.filter((m) => !seen.has(m.id))],
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      if (
        !mountedRef.current ||
        controller.signal.aborted ||
        mergesSessionRef.current !== session
      ) {
        return;
      }
      setMergeListActionError(mapApiError(err));
    } finally {
      if (loadMoreMergesAbortRef.current === controller) {
        loadMoreMergesAbortRef.current = null;
      }
      if (mountedRef.current && mergesSessionRef.current === session) {
        setLoadingMoreMergesKey((prev) => (prev === targetKey ? null : prev));
      }
    }
  };

  const refreshAllAfterMergeMutation = useCallback(() => {
    collapseMergeAccordion();
    versionsSessionRef.current += 1;
    mergesSessionRef.current += 1;
    snapshotAbortRef.current?.abort();
    snapshotAbortRef.current = null;
    loadMoreVersionsAbortRef.current?.abort();
    loadMoreVersionsAbortRef.current = null;
    loadMoreMergesAbortRef.current?.abort();
    loadMoreMergesAbortRef.current = null;
    setLoadingMoreVersionsKey(null);
    setLoadingMoreMergesKey(null);
    setMergeMutationErrorState(null);
    setHistoricalSnapshot(null);
    setMergeDetailsCache({ roadmapId, byId: {} });
    setReloadTick((prev) => prev + 1);
    setVersionsReloadTick((prev) => prev + 1);
    setMergesReloadTick((prev) => prev + 1);
  }, [collapseMergeAccordion, roadmapId]);

  const handleAcceptMergeProposal = useCallback(
    async (
      proposal: MergeProposalDTO,
      input: {
        base_version_no: number;
        acknowledge_large_expansion: boolean;
        idempotencyKey: string;
      },
      ifMatchVersionNo: number,
    ): Promise<AcceptRoadmapMergeResultDTO> => {
      const startScope = `${accessToken}:${roadmapId}`;
      setMutatingMergeState({ mergeId: proposal.id, action: 'accept' });
      setMergeMutationErrorState((prev) =>
        prev?.roadmapId === roadmapId && prev.mergeId === proposal.id
          ? null
          : prev,
      );
      try {
        const res = await acceptRoadmapMerge(
          accessToken,
          roadmapId,
          proposal.id,
          {
            base_version_no: input.base_version_no,
            acknowledge_large_expansion: input.acknowledge_large_expansion,
          },
          input.idempotencyKey,
          ifMatchVersionNo,
        );
        if (!mountedRef.current || scopeKeyRef.current !== startScope) {
          return res;
        }
        const levelSuffix =
          proposal.origin === 'level_change' && proposal.target_level
            ? ` Target level: ${LEVEL_LABELS[proposal.target_level] ?? proposal.target_level}.`
            : '';
        refreshAllAfterMergeMutation();
        setActiveTab('active');
        setArchiveToast({
          title: 'Merge accepted',
          message: `Merge accepted — roadmap updated to v${res.new_version_no}.${levelSuffix}`,
        });
        return res;
      } catch (err) {
        if (mountedRef.current && scopeKeyRef.current === startScope) {
          const mapped = mapApiError(err);
          setMergeMutationErrorState({
            roadmapId,
            mergeId: proposal.id,
            error: mapped,
          });
          if (activeTabRef.current !== 'merges') {
            setActionError(mapped);
          }
        }
        throw err;
      } finally {
        if (mountedRef.current) {
          setMutatingMergeState((prev) =>
            prev?.mergeId === proposal.id ? null : prev,
          );
        }
      }
    },
    [accessToken, refreshAllAfterMergeMutation, roadmapId],
  );

  const handleRejectMergeProposal = useCallback(
    async (
      proposal: MergeProposalDTO,
    ): Promise<RejectRoadmapMergeResultDTO> => {
      const startScope = `${accessToken}:${roadmapId}`;
      setMutatingMergeState({ mergeId: proposal.id, action: 'reject' });
      setMergeMutationErrorState((prev) =>
        prev?.roadmapId === roadmapId && prev.mergeId === proposal.id
          ? null
          : prev,
      );
      try {
        const res = await rejectRoadmapMerge(
          accessToken,
          roadmapId,
          proposal.id,
        );
        if (!mountedRef.current || scopeKeyRef.current !== startScope) {
          return res;
        }
        collapseMergeAccordion();
        mergesSessionRef.current += 1;
        loadMoreMergesAbortRef.current?.abort();
        loadMoreMergesAbortRef.current = null;
        setLoadingMoreMergesKey(null);
        setMergeMutationErrorState(null);
        setMergeDetailsCache({ roadmapId, byId: {} });
        setMergesReloadTick((prev) => prev + 1);
        setArchiveToast({
          title: 'Proposal rejected',
          message: 'Proposal rejected. Roadmap unchanged.',
        });
        return res;
      } catch (err) {
        if (mountedRef.current && scopeKeyRef.current === startScope) {
          const mapped = mapApiError(err);
          setMergeMutationErrorState({
            roadmapId,
            mergeId: proposal.id,
            error: mapped,
          });
          if (activeTabRef.current !== 'merges') {
            setActionError(mapped);
          }
        }
        throw err;
      } finally {
        if (mountedRef.current) {
          setMutatingMergeState((prev) =>
            prev?.mergeId === proposal.id ? null : prev,
          );
        }
      }
    },
    [accessToken, collapseMergeAccordion, roadmapId],
  );

  const handleConfirmUndo = async () => {
    if (!currentRoadmap || undoing) {
      return;
    }
    const startScope = `${accessToken}:${roadmapId}`;
    const expectedVersionNo = undoModalVersionNo ?? currentRoadmap.version_no;
    setUndoingScope(startScope);
    setActionError(null);
    setFeedback(null);
    try {
      const res = await undoLastRoadmapMerge(
        accessToken,
        roadmapId,
        generateClientIdempotencyKey(),
        expectedVersionNo,
      );
      if (!mountedRef.current || scopeKeyRef.current !== startScope) {
        return;
      }
      setUndoModalVersionNo(null);
      refreshAllAfterMergeMutation();
      setActiveTab('active');
      setArchiveToast({
        title: 'Last merge undone',
        message: `Last merge undone — restored v${res.restored_version_no}.`,
      });
    } catch (err) {
      if (!mountedRef.current || scopeKeyRef.current !== startScope) {
        return;
      }
      const mapped = mapApiError(err);
      setUndoModalVersionNo(null);
      setActionError(mapped);
      if (mapped.code === 'STALE_VERSION') {
        refreshAllAfterMergeMutation();
      } else {
        setMergesReloadTick((prev) => prev + 1);
      }
    } finally {
      if (mountedRef.current) {
        setUndoingScope((prev) => (prev === startScope ? null : prev));
      }
    }
  };

  const handleConfirmArchive = async () => {
    if (!currentRoadmap || archiving) {
      return;
    }
    const startScope = `${accessToken}:${roadmapId}`;
    const startRequestKey = requestKey;
    const startRoadmap = currentRoadmap;
    setArchivingScope(startScope);
    setActionError(null);
    setFeedback(null);
    setArchiveToast(null);
    try {
      const res = await archiveRoadmap(accessToken, roadmapId);
      if (!mountedRef.current || scopeKeyRef.current !== startScope) {
        return;
      }
      collapseMergeAccordion();
      mergesSessionRef.current += 1;
      snapshotAbortRef.current?.abort();
      snapshotAbortRef.current = null;
      loadMoreMergesAbortRef.current?.abort();
      loadMoreMergesAbortRef.current = null;
      setLoadingMoreMergesKey(null);
      setMergeMutationErrorState(null);
      setMergeDetailsCache({ roadmapId, byId: {} });
      setMergesReloadTick((prev) => prev + 1);
      setHistoricalSnapshot(null);
      if (requestKeyRef.current !== startRequestKey) {
        setReloadTick((prev) => prev + 1);
      } else {
        setFetchState((prev) =>
          prev && prev.key === startRequestKey && prev.status === 'loaded'
            ? {
                ...prev,
                roadmap: {
                  ...prev.roadmap,
                  status: 'archived',
                  is_focus: false,
                },
              }
            : {
                key: startRequestKey,
                status: 'loaded',
                roadmap: {
                  ...startRoadmap,
                  status: 'archived',
                  is_focus: false,
                },
              },
        );
      }
      setArchiveToast(
        formatArchiveFeedback(res, Boolean(startRoadmap.is_focus)),
      );
      setArchiveModalOpen(false);
    } catch (err) {
      if (!mountedRef.current || scopeKeyRef.current !== startScope) {
        return;
      }
      setActionError(mapApiError(err));
      setArchiveModalOpen(false);
    } finally {
      if (mountedRef.current) {
        setArchivingScope((prev) => (prev === startScope ? null : prev));
      }
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
  const mergeActionsDisabledReason = !roadmapGeneratorEnabled
    ? 'Roadmap generation is currently disabled for your account.'
    : hasOpenMerge
      ? 'Accept or reject the open merge proposal before creating a new one.'
      : undefined;
  const mergeButtonsDisabled =
    !roadmapGeneratorEnabled ||
    hasOpenMerge ||
    switchingFocus ||
    archiving ||
    undoing;

  const activeRoadmapPanel = (
    <div className="flex flex-col gap-6">
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

      <section
        aria-labelledby="detail-phases-heading"
        className="flex flex-col gap-4"
      >
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
              <h3
                className="text-heading-sm font-semibold text-text-primary"
                dir="auto"
              >
                Phase {phase.phase_no}: {phase.title}
              </h3>
              <span className="text-caption text-text-muted">
                {phase.items.length}{' '}
                {phase.items.length === 1 ? 'topic' : 'topics'}
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
                        {!item.retired && item.topic_id && (
                          <Link
                            href={`/mentor?context=topic&topicId=${encodeURIComponent(item.topic_id)}`}
                            aria-label={`Ask Mentor about ${item.title}`}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-teal-200/80 bg-teal-50/70 px-2.5 py-1 text-2xs font-medium leading-none text-teal-800 transition-colors hover:bg-teal-100/80 dark:border-teal-800/70 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-950/70"
                          >
                            <MessageSquareIcon className="block h-3 w-3 shrink-0" />
                            <span>Ask Mentor</span>
                          </Link>
                        )}
                      </div>
                    </div>

                    {item.required_depth && (
                      <p
                        className="mt-1.5 text-caption text-text-muted"
                        dir="auto"
                      >
                        Depth: {item.required_depth}
                      </p>
                    )}

                    {item.reason && (
                      <p
                        className="mt-2 text-body-sm text-text-secondary"
                        dir="auto"
                      >
                        {item.reason}
                      </p>
                    )}

                    {prereqs.length > 0 && (
                      <p
                        className="mt-2 text-caption text-text-muted"
                        dir="auto"
                      >
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
    </div>
  );

  const levelOutlinePanel = (
    <section
      aria-labelledby="detail-level-outline-heading"
      className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="detail-level-outline-heading"
          className="text-heading-md font-semibold text-text-primary"
        >
          Career Level Outline
        </h2>
        {currentRoadmap.status === 'locked' && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={mergeButtonsDisabled}
            title={mergeActionsDisabledReason}
            onClick={() =>
              setMergeModalState({ open: true, mode: 'level_change' })
            }
          >
            <LevelUpIcon className="block h-4 w-4 shrink-0" />
            <span>Change Career Level</span>
          </Button>
        )}
      </div>

      {displayedRoadmap.level_outline.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-secondary">
          No cross-level progression outline recorded for this version.
        </p>
      ) : (
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-label font-semibold text-text-primary">
                  {LEVEL_LABELS[level.career_level] ?? level.career_level}
                </p>
                {level.career_level === displayedRoadmap.target_level && (
                  <span className="inline-flex items-center justify-center rounded-full border border-feedback-success-border bg-feedback-success-background px-2 py-0.5 text-2xs font-semibold leading-none text-feedback-success-text">
                    Current Level
                  </span>
                )}
              </div>
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
      )}
    </section>
  );

  const mergeProposalsPanel = (
    <section
      aria-labelledby="detail-merges-heading"
      className="flex flex-col gap-5"
    >
      <div>
        <h2
          id="detail-merges-heading"
          className="text-heading-md font-semibold text-text-primary"
        >
          Merge Proposals
        </h2>
        <p className="mt-0.5 text-body-sm text-text-secondary">
          Review proposed updates, Career Level transitions, and AI
          suggestions before applying changes to your locked roadmap.
        </p>
      </div>

      {mergeListActionError && (
        <Alert variant="error_retryable" role="alert">
          {mergeListActionError.message}
        </Alert>
      )}

      {activeMerges === null ? (
        <div
          role="status"
          aria-busy="true"
          className="space-y-3 rounded-xl border border-border-default bg-surface-raised p-6"
        >
          <span className="sr-only">Loading merge proposals...</span>
          {[0, 1].map((idx) => (
            <div
              key={idx}
              aria-hidden="true"
              className="h-16 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : activeMerges.status === 'error' ? (
        <Alert
          variant="error_retryable"
          role="alert"
          onRetry={() => setMergesReloadTick((prev) => prev + 1)}
        >
          {activeMerges.error.message}
        </Alert>
      ) : activeMerges.items.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-surface-raised p-6 text-body-sm text-text-secondary">
          No merge proposals yet for this roadmap.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {activeMerges.items.map((mergeItem) => {
              const isOpen = expandedMergeId === mergeItem.id;
              const style =
                MERGE_STATUS_CARD_STYLES[mergeItem.status] ??
                MERGE_STATUS_CARD_STYLES.superseded;
              const loadedDetail = activeMergeDetailsById[mergeItem.id] ?? null;
              const itemError =
                activeMergeDetailError?.mergeId === mergeItem.id
                  ? activeMergeDetailError.error
                  : null;
              const isLoadingItem =
                loadingMergeId === mergeItem.id && !loadedDetail;
              const triggerLabel = isOpen
                ? 'Hide Changes'
                : mergeItem.status === 'proposed'
                  ? 'Review Changes'
                  : 'View Changes';

              return (
                <li key={mergeItem.id} data-merge-status={mergeItem.status}>
                  <AccordionItem
                    id={`${detailTabListId}-merge-${mergeItem.id}`}
                    isOpen={isOpen}
                    onToggle={() => handleToggleMergeAccordion(mergeItem.id)}
                    className={style.cardClass}
                    triggerClassName={style.triggerClass}
                    triggerContent={
                      <>
                        <span>{triggerLabel}</span>
                        <ChevronDownIcon
                          className={cn(
                            'transition-transform duration-200 motion-reduce:transition-none',
                            isOpen && 'rotate-180',
                          )}
                        />
                      </>
                    }
                    header={
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-2xs font-semibold leading-none text-text-primary">
                            {MERGE_ORIGIN_LABELS[mergeItem.origin] ??
                              mergeItem.origin}
                          </span>
                          <span
                            className={cn(
                              'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-semibold leading-none',
                              style.badgeClass,
                            )}
                          >
                            <MergeStatusIcon status={mergeItem.status} />
                            <span>
                              {MERGE_STATUS_LABELS[mergeItem.status] ??
                                mergeItem.status}
                            </span>
                          </span>
                          {mergeItem.target_level && (
                            <span className="inline-flex items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-2xs font-medium leading-none text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
                              → {LEVEL_LABELS[mergeItem.target_level]}
                            </span>
                          )}
                          {mergeItem.materially_large && (
                            <span className="inline-flex items-center justify-center rounded-full border border-feedback-warning-border bg-feedback-warning-background px-2 py-0.5 text-2xs font-medium leading-none text-feedback-warning-text">
                              Large expansion
                            </span>
                          )}
                          <span className="inline-flex items-center justify-center rounded-full border border-border-subtle bg-surface-subtle px-2 py-0.5 text-2xs font-mono leading-none text-text-muted">
                            Base v{mergeItem.base_version_no}
                          </span>
                        </div>
                        {mergeItem.reason && (
                          <p
                            className={cn('text-body-sm', style.summaryClass)}
                            dir="auto"
                          >
                            {mergeItem.reason}
                          </p>
                        )}
                      </div>
                    }
                  >
                    {isLoadingItem ? (
                      <div
                        role="status"
                        aria-busy="true"
                        className="space-y-3 py-1"
                      >
                        <p className="text-caption font-medium text-text-secondary">
                          Loading merge diff preview...
                        </p>
                        <div className="space-y-2.5" aria-hidden="true">
                          <div className="h-16 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                          <div className="h-20 rounded-lg bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                        </div>
                      </div>
                    ) : itemError ? (
                      <div className="flex flex-col gap-3">
                        <Alert
                          variant="error_retryable"
                          role="alert"
                          retryAfterSeconds={itemError.retryAfterSeconds}
                        >
                          {itemError.message}
                        </Alert>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => void fetchMergeDetail(mergeItem.id)}
                          >
                            Try Again
                          </Button>
                        </div>
                      </div>
                    ) : loadedDetail ? (
                      <RoadmapDiffViewer
                        accessToken={accessToken}
                        roadmapId={roadmapId}
                        merge={loadedDetail}
                        currentVersionNo={currentRoadmap.version_no}
                        roadmapGeneratorEnabled={roadmapGeneratorEnabled}
                        canMutate={currentRoadmap.status === 'locked'}
                        embedded
                        externalSubmittingAction={
                          mutatingMergeState?.mergeId === loadedDetail.id
                            ? mutatingMergeState.action
                            : null
                        }
                        externalError={
                          mergeMutationErrorState?.roadmapId === roadmapId &&
                          mergeMutationErrorState.mergeId === loadedDetail.id
                            ? mergeMutationErrorState.error
                            : null
                        }
                        onClearExternalError={() =>
                          setMergeMutationErrorState((prev) =>
                            prev?.roadmapId === roadmapId &&
                            prev.mergeId === loadedDetail.id
                              ? null
                              : prev,
                          )
                        }
                        acceptMergeAction={(input) =>
                          handleAcceptMergeProposal(
                            loadedDetail,
                            input,
                            currentRoadmap.version_no,
                          )
                        }
                        rejectMergeAction={() =>
                          handleRejectMergeProposal(loadedDetail)
                        }
                        onReloadRequested={() => {
                          refreshAllAfterMergeMutation();
                        }}
                      />
                    ) : null}
                  </AccordionItem>
                </li>
              );
            })}
          </ul>

          {activeMerges.nextCursor && (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={loadingMoreMerges}
                loadingText="Loading more..."
                disabled={loadingMoreMerges}
                onClick={() => void handleLoadMoreMerges()}
              >
                Load more proposals
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );

  const versionHistoryTabPanel = (
    <section
      aria-labelledby="detail-versions-tab-heading"
      className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="detail-versions-tab-heading"
          className="text-heading-md font-semibold text-text-primary"
        >
          Immutable Version History
        </h2>
        <span className="text-caption text-text-muted">
          Current active: v{currentRoadmap.version_no}
        </span>
      </div>

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
        <div role="status" aria-busy="true" className="space-y-3">
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
          onRetry={() => {
            setRefreshingVersions(true);
            setVersionsReloadTick((prev) => prev + 1);
          }}
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
                    onClick={() =>
                      void handleSelectVersion(version, {
                        switchToActiveTab: true,
                      })
                    }
                    className={cn(
                      'flex w-full cursor-pointer flex-col gap-1 rounded-lg border p-3.5 text-left transition-colors duration-(--duration-fast) motion-reduce:transition-none',
                      isSelectedSnapshot
                        ? 'border-border-focus bg-surface-accent'
                        : 'border-border-default bg-surface-default hover:bg-surface-subtle',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-label font-semibold text-text-primary">
                        Version v{version.version_no}
                      </span>
                      <div className="inline-flex flex-wrap items-center gap-1.5">
                        <VersionStateBadge state={version.state} />
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
                      {ORIGIN_LABELS[version.created_by] ?? version.created_by}{' '}
                      · {LEVEL_LABELS[version.target_level] ?? version.target_level}
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
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={loadingMoreVersions}
                disabled={loadingMoreVersions || refreshingVersions}
                onClick={() => void handleLoadMoreVersions()}
              >
                Load older versions
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-6 pt-2 sm:px-6 lg:px-8 lg:pb-8 lg:pt-3">
      <header className="sticky top-16 z-20 -mx-4 border-b border-slate-200/80 bg-slate-50/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 dark:border-slate-800 dark:bg-slate-950/95">
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

        <div className="flex flex-col gap-3">
          <div className="min-w-0 space-y-2.5">
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

              {currentRoadmap.status === 'locked' &&
                !currentRoadmap.is_focus &&
                !isViewingHistorical && (
                  <span className="inline-flex items-center justify-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-caption font-medium leading-none text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-300">
                    <CompassIcon
                      className="block h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>Non-Focus</span>
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

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {currentRoadmap.status === 'locked' && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={mergeButtonsDisabled}
                  title={mergeActionsDisabledReason}
                  onClick={() =>
                    setMergeModalState({ open: true, mode: 'user_request' })
                  }
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <SparkleEditIcon className="block h-4 w-4 shrink-0" />
                  <span>Request Change</span>
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={mergeButtonsDisabled}
                  title={mergeActionsDisabledReason}
                  onClick={() =>
                    setMergeModalState({ open: true, mode: 'level_change' })
                  }
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <LevelUpIcon className="block h-4 w-4 shrink-0" />
                  <span>Change Career Level</span>
                </Button>

                {currentRoadmap.is_focus && (
                  <Link
                    href="/mentor?context=focus_roadmap"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50/70 px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-teal-800 transition-colors hover:bg-teal-100/80 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-200 dark:hover:bg-teal-950/80"
                  >
                    <MessageSquareIcon className="block h-4 w-4 shrink-0" />
                    <span>Ask Mentor</span>
                  </Link>
                )}
              </>
            )}

            {(currentRoadmap.status === 'draft' ||
              currentRoadmap.status === 'locked') && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={switchingFocus || archiving || undoing}
                onClick={() => setArchiveModalOpen(true)}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
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
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
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
                disabled={switchingFocus || archiving || undoing}
                onClick={() => void handleFocusSwitch()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap"
              >
                <CompassIcon
                  className="block h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
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

      {currentRoadmap.status === 'locked' && !roadmapGeneratorEnabled && (
        <Alert variant="info" role="status">
          Roadmap generation is currently disabled for your account. You can
          continue viewing your locked roadmap, reviewing or rejecting merge
          proposals, undoing an eligible merge, and browsing Version History.
        </Alert>
      )}

      {currentRoadmap.status === 'locked' && undoableMergeSummary && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-feedback-warning-border bg-feedback-warning-background/70 px-4 py-3 text-body-sm text-feedback-warning-text"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Undo available for last merge</p>
            <p className="mt-0.5 text-caption">
              You can restore your previous locked roadmap and future incomplete
              Daily Plan until you start a quiz on a post-merge study day.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={undoing}
            loadingText="Undoing..."
            disabled={undoing || archiving || switchingFocus}
            onClick={() => setUndoModalVersionNo(currentRoadmap.version_no)}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 leading-none whitespace-nowrap"
          >
            <UndoIcon className="block h-4 w-4 shrink-0" />
            <span>Undo Last Merge</span>
          </Button>
        </div>
      )}

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
            feedback.onAction && feedback.actionLabel
              ? { label: feedback.actionLabel, onClick: feedback.onAction }
              : feedback.href && feedback.hrefLabel
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

      <div className="flex flex-col gap-4">
        <SegmentedTabs
          label="Roadmap Sections"
          ariaLabel="Roadmap detail views"
          idPrefix={detailTabListId}
          panelId={`${detailTabListId}-panel`}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as RoadmapDetailTab)}
          items={[
            { id: 'active', label: 'Active Roadmap' },
            { id: 'outline', label: 'Level Outline' },
            {
              id: 'merges',
              label: hasOpenMerge ? 'Merge Proposals (1)' : 'Merge Proposals',
            },
            { id: 'versions', label: 'Version History' },
          ]}
        />

        <div
          id={`${detailTabListId}-panel`}
          role="tabpanel"
          aria-labelledby={`${detailTabListId}-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === 'active'
            ? activeRoadmapPanel
            : activeTab === 'outline'
              ? levelOutlinePanel
              : activeTab === 'merges'
                ? mergeProposalsPanel
                : versionHistoryTabPanel}
        </div>
      </div>

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
                onRetry={() => {
                  setRefreshingVersions(true);
                  setVersionsReloadTick((prev) => prev + 1);
                }}
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
                            <div className="inline-flex flex-wrap items-center gap-1.5">
                              <VersionStateBadge state={version.state} />
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
                    disabled={loadingMoreVersions || refreshingVersions}
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
        description={
          currentRoadmap.status === 'locked'
            ? 'Archiving this roadmap also discontinues its linked career goal. For topic updates or Career Level changes on the same goal, use Request Change or Change Career Level (Merge) instead of archiving. Archiving preserves all learning progress, shared skill evidence, and daily plans. If this is your Focus Roadmap, focus will automatically reassign to another active locked roadmap if available.'
            : 'Archiving this draft roadmap also discontinues its linked career goal. Archiving preserves all learning progress, shared skill evidence, and daily plans.'
        }
        confirmLabel="Archive Roadmap"
        loading={archiving}
        onConfirm={() => void handleConfirmArchive()}
      />

      <Modal
        open={undoModalOpen}
        onClose={() => setUndoModalVersionNo(null)}
        variant="confirm"
        title="Undo last accepted merge?"
        description="This restores your immediately previous locked roadmap version and future incomplete Daily Plan days. Completed learning days and evidence are never rewritten. Once you start a quiz on a post-merge study day, undo closes permanently."
        confirmLabel="Confirm Undo"
        loading={undoing}
        onConfirm={() => void handleConfirmUndo()}
      />

      {currentRoadmap.status === 'locked' && mergeModalState.open && (
        <RequestMergeModal
          open={mergeModalState.open}
          initialMode={mergeModalState.mode}
          accessToken={accessToken}
          roadmapId={roadmapId}
          roadmapTitle={currentRoadmap.role_name}
          currentTargetLevel={currentRoadmap.target_level}
          currentVersionNo={currentRoadmap.version_no}
          roadmapGeneratorEnabled={roadmapGeneratorEnabled}
          persistedJobState={mergeJobByRoadmap[roadmapId] ?? null}
          onJobStateChange={(next) =>
            setMergeJobByRoadmap((prev) => ({
              ...prev,
              [roadmapId]: next,
            }))
          }
          onClose={() =>
            setMergeModalState((prev) => ({ ...prev, open: false }))
          }
          onMergeCreated={(proposal) => {
            setMergeJobByRoadmap((prev) => ({
              ...prev,
              [roadmapId]: null,
            }));
            setMergeModalState((prev) => ({ ...prev, open: false }));
            setMergeDetailsCache((prev) => ({
              roadmapId,
              byId: {
                ...(prev.roadmapId === roadmapId ? prev.byId : {}),
                [proposal.id]: proposal,
              },
            }));
            setExpandedMergeState({ roadmapId, mergeId: proposal.id });
            setMergeDetailErrorState(null);
            setActiveTab('merges');
            setMergesReloadTick((prev) => prev + 1);
          }}
        />
      )}

      {hoursModalTarget && (
        <HoursPromptModal
          open={Boolean(hoursModalTarget)}
          mode="create"
          accessToken={accessToken}
          roadmapId={hoursModalTarget.roadmapId}
          roadmapTitle={hoursModalTarget.roadmapTitle}
          initialHours={hoursModalTarget.initialHours}
          onClose={() => setHoursModalTarget(null)}
          onSuccess={() => {
            setHoursModalTarget(null);
            router.push('/today');
          }}
        />
      )}
    </main>
  );
}
