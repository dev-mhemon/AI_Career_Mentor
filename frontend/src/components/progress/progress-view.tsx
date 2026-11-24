'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  getProgress,
  getProgressHistory,
  listRoadmaps,
  type CareerLevel,
  type LearningState,
  type ProgressHistoryItemDTO,
  type ProgressResponseDTO,
  type RoadmapSummaryDTO,
  type SkillProgressDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  AlertCircleIcon,
  BookOpenIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  EyeIcon,
  RefreshCwIcon,
  TargetIcon,
} from '@/components/ui/icons';
import { SegmentedTabs } from '@/components/ui/segmented-tabs';
import { Select } from '@/components/ui/select';
import { ProgressHistoryCard } from './progress-history-card';
import { SkillDetailDrawer } from './skill-detail-drawer';
import { SkillProgressBadge } from './skill-progress-badge';

export type ProgressTabKey =
  | 'overview'
  | 'shared_skills'
  | 'weak_areas'
  | 'history';

export interface ProgressViewProps {
  accessToken: string;
  initialProgress?: ProgressResponseDTO | null;
  initialProgressNextCursor?: string | null;
  initialHistory?: ProgressHistoryItemDTO[] | null;
  initialHistoryNextCursor?: string | null;
  initialRoadmaps?: RoadmapSummaryDTO[];
}

const PROGRESS_TABS: ReadonlyArray<{
  key: ProgressTabKey;
  label: string;
}> = [
  { key: 'overview', label: 'Overview' },
  { key: 'shared_skills', label: 'Shared Skills' },
  { key: 'weak_areas', label: 'Weak Areas' },
  { key: 'history', label: 'History' },
];

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

const primaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active sm:w-auto';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-label-md font-medium leading-none text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto';

function formatShortDate(iso: string | null): string {
  if (!iso) {
    return 'No evidence yet';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Collapses duplicate `achievement_history` pairs where both `'state_change'` and `'evidence_added'`
 * were recorded for the same underlying `(source, source_id, skill_id, career_level)`,
 * keeping only the richer `'state_change'` card.
 */
function deduplicateHistoryItems(
  items: readonly ProgressHistoryItemDTO[],
): ProgressHistoryItemDTO[] {
  const stateChangeKeys = new Set<string>();
  for (const item of items) {
    if (item.event === 'state_change' && item.source_id) {
      stateChangeKeys.add(
        `${item.source ?? ''}:${item.source_id}:${item.skill_id}:${item.career_level}`,
      );
    }
  }
  const seenIds = new Set<string>();
  const out: ProgressHistoryItemDTO[] = [];
  for (const item of items) {
    if (seenIds.has(item.id)) {
      continue;
    }
    if (
      item.event === 'evidence_added' &&
      item.source_id &&
      stateChangeKeys.has(
        `${item.source ?? ''}:${item.source_id}:${item.skill_id}:${item.career_level}`,
      )
    ) {
      continue;
    }
    seenIds.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Screen 19 (`/progress`): Skill Progress & Topic Mastery (`C05` §14.9 `EP-G01`–`EP-G03`, `PRD` §34–§36).
 *
 * Guarantees:
 * - Level-scoped skill progress (`Not Started`, `Learning`, `Practicing`, `Proficient`) with zero `"Job Ready"` wording.
 * - 4 accessible tabs (`Overview`, `Shared Skills`, `Weak Areas`, `History`) with roving `tabIndex` and ArrowLeft/Right/Home/End navigation.
 * - Filters by roadmap, `career_level`, and `learning_state` with `R16` clear-filters recovery.
 * - Opens `SkillDetailDrawer` (`EP-G02`) on skill selection and links `EP-G03` history items to `/quiz/[attemptId]`.
 */
export function ProgressView({
  accessToken,
  initialProgress = null,
  initialProgressNextCursor = null,
  initialHistory = null,
  initialHistoryNextCursor = null,
  initialRoadmaps,
}: ProgressViewProps) {
  const tabListId = useId();
  const [activeTab, setActiveTab] = useState<ProgressTabKey>('overview');
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string>('');
  const [selectedCareerLevel, setSelectedCareerLevel] = useState<
    CareerLevel | ''
  >('');
  const [selectedLearningState, setSelectedLearningState] = useState<
    LearningState | ''
  >('');
  const [progressReloadTick, setProgressReloadTick] = useState(0);
  const [historyReloadTick, setHistoryReloadTick] = useState(0);
  const [roadmapsReloadTick, setRoadmapsReloadTick] = useState(0);

  const [roadmapsState, setRoadmapsState] = useState<{
    token: string;
    tick: number;
    status: 'loaded' | 'error';
    items: RoadmapSummaryDTO[];
  } | null>(null);

  const [progressState, setProgressState] = useState<{
    key: string;
    progress: ProgressResponseDTO;
    skills: SkillProgressDTO[];
    nextCursor: string | null;
  } | null>(null);
  const [progressErrorState, setProgressErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);
  const [skillsPaginationErrorState, setSkillsPaginationErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);
  const [loadingMoreSkillsKey, setLoadingMoreSkillsKey] = useState<
    string | null
  >(null);

  const [historyState, setHistoryState] = useState<{
    key: string;
    items: ProgressHistoryItemDTO[];
    nextCursor: string | null;
  } | null>(null);
  const [historyErrorState, setHistoryErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);
  const [loadMoreHistoryErrorState, setLoadMoreHistoryErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);
  const [loadingMoreHistoryKey, setLoadingMoreHistoryKey] = useState<
    string | null
  >(null);

  const [selectedSkillForDetail, setSelectedSkillForDetail] = useState<{
    skillId: string;
    name: string;
  } | null>(null);

  const progressGenRef = useRef(0);
  const historyGenRef = useRef(0);
  const loadMoreSkillsReqIdRef = useRef(0);
  const loadMoreHistoryReqIdRef = useRef(0);

  const hasActiveFilters = Boolean(
    selectedRoadmapId || selectedCareerLevel || selectedLearningState,
  );

  const progressQueryKey = `${accessToken}:${selectedRoadmapId}:${selectedCareerLevel}:${selectedLearningState}:${progressReloadTick}`;
  const historyQueryKey = `${accessToken}:history:${historyReloadTick}`;

  const seededProgress = useMemo(
    () =>
      initialProgress && !hasActiveFilters && progressReloadTick === 0
        ? {
            key: progressQueryKey,
            progress: initialProgress,
            skills: initialProgress.skills,
            nextCursor: initialProgressNextCursor,
          }
        : null,
    [
      hasActiveFilters,
      initialProgress,
      initialProgressNextCursor,
      progressQueryKey,
      progressReloadTick,
    ],
  );

  const seededHistory = useMemo(
    () =>
      initialHistory && historyReloadTick === 0
        ? {
            key: historyQueryKey,
            items: initialHistory,
            nextCursor: initialHistoryNextCursor,
          }
        : null,
    [
      historyQueryKey,
      historyReloadTick,
      initialHistory,
      initialHistoryNextCursor,
    ],
  );

  // Load user's active locked roadmaps for filter & cross-roadmap badges
  useEffect(() => {
    if (initialRoadmaps) {
      return;
    }
    let active = true;
    const controller = new AbortController();

    listRoadmaps(
      accessToken,
      { status: 'locked', limit: 20 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setRoadmapsState({
          token: accessToken,
          tick: roadmapsReloadTick,
          status: 'loaded',
          items: res.items,
        });
      })
      .catch(() => {
        if (!active || controller.signal.aborted) {
          return;
        }
        // Non-fatal metadata enrichment: settle state so unified filter bar exits loading cleanly
        setRoadmapsState({
          token: accessToken,
          tick: roadmapsReloadTick,
          status: 'error',
          items: [],
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, initialRoadmaps, roadmapsReloadTick]);

  // Load EP-G01 Progress
  useEffect(() => {
    if (seededProgress) {
      return;
    }
    const gen = ++progressGenRef.current;
    const controller = new AbortController();

    getProgress(
      accessToken,
      {
        ...(selectedRoadmapId ? { roadmap_id: selectedRoadmapId } : {}),
        ...(selectedCareerLevel ? { career_level: selectedCareerLevel } : {}),
        ...(selectedLearningState
          ? { learning_state: selectedLearningState }
          : {}),
        limit: 20,
      },
      { signal: controller.signal },
    )
      .then((res) => {
        if (gen !== progressGenRef.current || controller.signal.aborted) {
          return;
        }
        setProgressState({
          key: progressQueryKey,
          progress: res.progress,
          skills: res.progress.skills,
          nextCursor: res.meta.next_cursor,
        });
        setProgressErrorState(null);
        setSkillsPaginationErrorState((prev) =>
          prev && prev.key === progressQueryKey ? null : prev,
        );
      })
      .catch((err) => {
        if (gen !== progressGenRef.current || controller.signal.aborted) {
          return;
        }
        setProgressErrorState({
          key: progressQueryKey,
          error: mapApiError(err),
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    accessToken,
    progressQueryKey,
    seededProgress,
    selectedCareerLevel,
    selectedLearningState,
    selectedRoadmapId,
  ]);

  // Load EP-G03 Progress History
  useEffect(() => {
    if (seededHistory) {
      return;
    }
    const gen = ++historyGenRef.current;
    const controller = new AbortController();

    getProgressHistory(
      accessToken,
      { limit: 20 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (gen !== historyGenRef.current || controller.signal.aborted) {
          return;
        }
        setHistoryState({
          key: historyQueryKey,
          items: res.items,
          nextCursor: res.meta.next_cursor,
        });
        setHistoryErrorState(null);
      })
      .catch((err) => {
        if (gen !== historyGenRef.current || controller.signal.aborted) {
          return;
        }
        setHistoryErrorState({
          key: historyQueryKey,
          error: mapApiError(err),
        });
      });

    return () => {
      controller.abort();
    };
  }, [accessToken, historyQueryKey, seededHistory]);

  const isLoadingRoadmaps =
    !initialRoadmaps &&
    (!roadmapsState ||
      roadmapsState.token !== accessToken ||
      roadmapsState.tick !== roadmapsReloadTick);
  const roadmapsLoadFailed =
    !initialRoadmaps &&
    roadmapsState !== null &&
    roadmapsState.token === accessToken &&
    roadmapsState.tick === roadmapsReloadTick &&
    roadmapsState.status === 'error';
  const roadmaps = useMemo(
    () =>
      initialRoadmaps ??
      (roadmapsState && roadmapsState.token === accessToken
        ? roadmapsState.items
        : []),
    [accessToken, initialRoadmaps, roadmapsState],
  );

  const roadmapNamesById = useMemo(
    () => new Map(roadmaps.map((rm) => [rm.id, rm.role_name])),
    [roadmaps],
  );

  const activeProgressData =
    progressState && progressState.key === progressQueryKey
      ? progressState
      : seededProgress;
  const activeProgressError =
    progressErrorState && progressErrorState.key === progressQueryKey
      ? progressErrorState.error
      : null;
  const activeSkillsPaginationError =
    skillsPaginationErrorState &&
    skillsPaginationErrorState.key === progressQueryKey
      ? skillsPaginationErrorState.error
      : null;
  const isLoadingProgress =
    activeProgressData === null && activeProgressError === null;
  const hasSettledProgressForToken =
    Boolean(
      progressState && progressState.key.startsWith(`${accessToken}:`),
    ) ||
    Boolean(
      progressErrorState &&
        progressErrorState.key.startsWith(`${accessToken}:`),
    );
  const isLoadingInitialFilterBar =
    !initialProgress &&
    ((isLoadingRoadmaps && roadmapsReloadTick === 0) ||
      (isLoadingProgress && !hasActiveFilters && !hasSettledProgressForToken));

  const activeHistoryData =
    historyState && historyState.key === historyQueryKey
      ? historyState
      : seededHistory;
  const visibleHistoryItems = useMemo(
    () => deduplicateHistoryItems(activeHistoryData?.items ?? []),
    [activeHistoryData],
  );
  const activeHistoryError =
    historyErrorState && historyErrorState.key === historyQueryKey
      ? historyErrorState.error
      : null;
  const activeLoadMoreHistoryError =
    loadMoreHistoryErrorState &&
    loadMoreHistoryErrorState.key === historyQueryKey
      ? loadMoreHistoryErrorState.error
      : null;
  const isLoadingHistory =
    activeHistoryData === null && activeHistoryError === null;

  const skills = useMemo(
    () => activeProgressData?.skills ?? [],
    [activeProgressData],
  );
  const weakAreas = activeProgressData?.progress.weak_areas ?? [];
  const sharedSkills = skills.filter(
    (s) => s.shared_with_roadmap_ids.length > 0,
  );
  const skillNamesById = useMemo(
    () => new Map(skills.map((s) => [s.skill_id, s.name])),
    [skills],
  );

  const countsByState = useMemo(() => {
    const counts: Record<LearningState, number> = {
      not_started: 0,
      learning: 0,
      practicing: 0,
      proficient: 0,
    };
    for (const s of skills) {
      counts[s.learning_state] = (counts[s.learning_state] ?? 0) + 1;
    }
    return counts;
  }, [skills]);

  const handleClearFilters = () => {
    setSelectedRoadmapId('');
    setSelectedCareerLevel('');
    setSelectedLearningState('');
  };

  const handleLoadMoreSkills = async () => {
    if (
      !activeProgressData?.nextCursor ||
      loadingMoreSkillsKey === progressQueryKey
    ) {
      return;
    }
    const captureKey = progressQueryKey;
    const gen = progressGenRef.current;
    const reqId = ++loadMoreSkillsReqIdRef.current;
    setLoadingMoreSkillsKey(captureKey);
    setSkillsPaginationErrorState((prev) =>
      prev && prev.key === captureKey ? null : prev,
    );
    try {
      const page = await getProgress(accessToken, {
        ...(selectedRoadmapId ? { roadmap_id: selectedRoadmapId } : {}),
        ...(selectedCareerLevel ? { career_level: selectedCareerLevel } : {}),
        ...(selectedLearningState
          ? { learning_state: selectedLearningState }
          : {}),
        cursor: activeProgressData.nextCursor,
        limit: 20,
      });
      if (gen !== progressGenRef.current) {
        return;
      }
      setProgressState((prev) => {
        const current =
          prev && prev.key === captureKey ? prev.skills : skills;
        const seen = new Set(
          current.map((s) => `${s.skill_id}:${s.career_level}`),
        );
        const merged = [
          ...current,
          ...page.progress.skills.filter(
            (s) => !seen.has(`${s.skill_id}:${s.career_level}`),
          ),
        ];
        return {
          key: captureKey,
          progress: page.progress,
          skills: merged,
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      if (gen !== progressGenRef.current) {
        return;
      }
      setSkillsPaginationErrorState({
        key: captureKey,
        error: mapApiError(err),
      });
    } finally {
      if (loadMoreSkillsReqIdRef.current === reqId) {
        setLoadingMoreSkillsKey((prev) => (prev === captureKey ? null : prev));
      }
    }
  };

  const handleLoadMoreHistory = async () => {
    if (
      !activeHistoryData?.nextCursor ||
      loadingMoreHistoryKey === historyQueryKey
    ) {
      return;
    }
    const captureKey = historyQueryKey;
    const gen = historyGenRef.current;
    const reqId = ++loadMoreHistoryReqIdRef.current;
    setLoadingMoreHistoryKey(captureKey);
    setLoadMoreHistoryErrorState((prev) =>
      prev && prev.key === captureKey ? null : prev,
    );
    try {
      const page = await getProgressHistory(accessToken, {
        cursor: activeHistoryData.nextCursor,
        limit: 20,
      });
      if (gen !== historyGenRef.current) {
        return;
      }
      setHistoryState((prev) => {
        const current =
          prev && prev.key === captureKey
            ? prev.items
            : (activeHistoryData?.items ?? []);
        const seen = new Set(current.map((h) => h.id));
        return {
          key: captureKey,
          items: [...current, ...page.items.filter((h) => !seen.has(h.id))],
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      if (gen !== historyGenRef.current) {
        return;
      }
      setLoadMoreHistoryErrorState({
        key: captureKey,
        error: mapApiError(err),
      });
    } finally {
      if (loadMoreHistoryReqIdRef.current === reqId) {
        setLoadingMoreHistoryKey((prev) => (prev === captureKey ? null : prev));
      }
    }
  };

  const selectedTabId = `${tabListId}-tab-${activeTab}`;
  const roadmapProgress = activeProgressData?.progress.roadmap_progress;
  const roadmapCompletionPct =
    roadmapProgress && roadmapProgress.items_total > 0
      ? Math.round(
          (roadmapProgress.items_completed / roadmapProgress.items_total) * 100,
        )
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header & Breadcrumb */}
      <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"
          >
            <Link
              href="/dashboard"
              className="inline-flex items-center leading-none transition-colors hover:text-slate-800 dark:hover:text-slate-200"
            >
              Dashboard
            </Link>
            <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="inline-flex items-center leading-none text-slate-700 dark:text-slate-200">
              Progress
            </span>
          </nav>
          <h1 className="mt-1.5 text-heading-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Skill Progress &amp; Topic Mastery
          </h1>
          <p className="mt-1 w-full max-w-xl text-pretty text-body-sm text-slate-600 dark:text-slate-400">
            Level-scoped skill mastery backed by verified Practice Quiz and AI
            Practice Review evidence across your roadmaps.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
          <Link href="/daily-plan" className={secondaryLinkClass}>
            <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
            <span>Daily Plan</span>
          </Link>
          <Link href="/today" className={primaryLinkClass}>
            <BookOpenIcon className="block h-4 w-4 shrink-0" />
            <span>Today&apos;s Learning</span>
          </Link>
        </div>
      </header>

      {/* Mastery KPI Summary Strip */}
      {activeProgressData && (
        <section
          aria-label="Mastery summary metrics"
          className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        >
          <div className="col-span-2 flex flex-col justify-between gap-2 rounded-2xl border border-teal-200/80 bg-white p-4 shadow-xs sm:col-span-1 dark:border-teal-900/60 dark:bg-slate-900">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Roadmap Topics
            </span>
            <p className="font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {roadmapProgress?.items_completed ?? 0} /{' '}
              {roadmapProgress?.items_total ?? 0}
            </p>
            <div
              role="progressbar"
              aria-label="Roadmap items completed"
              aria-valuenow={roadmapCompletionPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-teal-600 dark:bg-teal-400"
                style={{ width: `${roadmapCompletionPct}%` }}
              />
            </div>
          </div>

          <div className="flex flex-col justify-between gap-1 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Proficient
            </span>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {countsByState.proficient}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Repeated strong evidence
            </span>
          </div>

          <div className="flex flex-col justify-between gap-1 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
              Practicing
            </span>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {countsByState.practicing}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Active hands-on practice
            </span>
          </div>

          <div className="flex flex-col justify-between gap-1 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <span className="text-xs font-medium text-sky-700 dark:text-sky-300">
              Learning
            </span>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {countsByState.learning}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Foundational study
            </span>
          </div>

          <div className="flex flex-col justify-between gap-1 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Not Started
            </span>
            <p className="font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {countsByState.not_started}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Scheduled ahead
            </span>
          </div>
        </section>
      )}

      {/* Accessible 4-Tab Bar */}
      <SegmentedTabs
        label="Progress Views"
        ariaLabel="Skill progress views"
        idPrefix={tabListId}
        panelId={`${tabListId}-panel`}
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as ProgressTabKey)}
        items={PROGRESS_TABS.map((tab) => {
          const badgeCount =
            tab.key === 'shared_skills'
              ? sharedSkills.length
              : tab.key === 'weak_areas'
                ? weakAreas.length
                : null;
          return {
            id: tab.key,
            label: tab.label,
            badge:
              badgeCount !== null && badgeCount > 0 ? (
                <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold leading-none tabular-nums text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {badgeCount}
                </span>
              ) : undefined,
          };
        })}
      />

      {/* Filters Bar (for Overview & Shared Skills & Weak Areas) */}
      {activeTab !== 'history' && (
        <section
          aria-label="Filter skill progress"
          className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs sm:flex-row sm:flex-wrap sm:items-end sm:justify-between dark:border-slate-800 dark:bg-slate-900"
        >
          {isLoadingInitialFilterBar ? (
            <div
              data-testid="progress-filter-skeleton"
              aria-busy="true"
              aria-label="Loading progress filters"
              className="flex w-full flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="grid flex-1 grid-cols-1 items-end gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((idx) => (
                  <div key={idx} className="flex flex-col gap-1.5">
                    <div className="h-4 w-24 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                    <div className="h-11 w-full rounded-xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                  </div>
                ))}
              </div>
              <div className="h-11 w-full shrink-0 rounded-xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none sm:w-28" />
            </div>
          ) : (
            <>
              <div className="grid flex-1 grid-cols-1 items-end gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <Select
                    id={`${tabListId}-filter-roadmap`}
                    label="Roadmap"
                    aria-label="Filter by roadmap"
                    value={selectedRoadmapId}
                    disabled={isLoadingRoadmaps}
                    onChange={(e) => setSelectedRoadmapId(e.target.value)}
                    className="!h-11 !rounded-xl"
                    options={[
                      { value: '', label: 'Focused Roadmap (Default)' },
                      ...roadmaps.map((rm) => ({
                        value: rm.id,
                        label: `${rm.role_name}${rm.is_focus ? ' (Focus)' : ''}`,
                      })),
                    ]}
                  />
                  {roadmapsLoadFailed && (
                    <div
                      role="status"
                      className="flex items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300"
                    >
                      <span>Couldn&apos;t load roadmap list.</span>
                      <button
                        type="button"
                        onClick={() =>
                          setRoadmapsReloadTick((prev) => prev + 1)
                        }
                        className="shrink-0 cursor-pointer font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200"
                      >
                        Retry roadmaps
                      </button>
                    </div>
                  )}
                </div>

                <Select
                  id={`${tabListId}-filter-career-level`}
                  label="Career Level"
                  aria-label="Filter by career level"
                  value={selectedCareerLevel}
                  onChange={(e) =>
                    setSelectedCareerLevel(e.target.value as CareerLevel | '')
                  }
                  className="!h-11 !rounded-xl"
                  options={[
                    { value: '', label: 'All Target Levels' },
                    { value: 'junior', label: 'Junior' },
                    { value: 'mid', label: 'Mid-Level' },
                    { value: 'senior', label: 'Senior' },
                  ]}
                />

                <Select
                  id={`${tabListId}-filter-mastery-state`}
                  label="Mastery State"
                  aria-label="Filter by mastery state"
                  value={selectedLearningState}
                  onChange={(e) =>
                    setSelectedLearningState(
                      e.target.value as LearningState | '',
                    )
                  }
                  className="!h-11 !rounded-xl"
                  options={[
                    { value: '', label: 'All Mastery States' },
                    { value: 'not_started', label: 'Not Started' },
                    { value: 'learning', label: 'Learning' },
                    { value: 'practicing', label: 'Practicing' },
                    { value: 'proficient', label: 'Proficient' },
                  ]}
                />
              </div>

              <button
                type="button"
                disabled={!hasActiveFilters}
                onClick={handleClearFilters}
                className="inline-flex h-11 min-h-11 w-full shrink-0 cursor-pointer items-center justify-center self-end whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/30 disabled:cursor-not-allowed disabled:border-slate-200/80 disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:border-slate-800 dark:disabled:bg-slate-900/50 dark:disabled:text-slate-500 sm:w-auto"
              >
                <span>Clear Filters</span>
              </button>
            </>
          )}
        </section>
      )}

      {/* Tab Panel Body */}
      <div
        id={`${tabListId}-panel`}
        role="tabpanel"
        aria-labelledby={selectedTabId}
        className="flex flex-col gap-4"
      >
        {/* Tab 1 & 2: Overview & Shared Skills */}
        {(activeTab === 'overview' || activeTab === 'shared_skills') && (
          <>
            {isLoadingProgress && (
              <section
                aria-busy="true"
                aria-label="Loading skill progress"
                className="flex flex-col gap-3"
              >
                {[0, 1, 2].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="h-4 w-1/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                    <div className="mt-3 h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                  </div>
                ))}
              </section>
            )}

            {!isLoadingProgress && activeProgressError && (
              <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <Alert variant="error_retryable" role="alert">
                  {activeProgressError.message}
                </Alert>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setProgressReloadTick((prev) => prev + 1)}
                    className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                  >
                    <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                    <span>Try Again</span>
                  </Button>
                </div>
              </section>
            )}

            {!isLoadingProgress &&
              !activeProgressError &&
              (() => {
                const list =
                  activeTab === 'shared_skills' ? sharedSkills : skills;
                if (list.length === 0) {
                  return (
                    <section className="flex flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-300">
                        <TargetIcon className="block h-6 w-6 shrink-0" />
                      </span>
                      <div className="space-y-1.5">
                        <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
                          {hasActiveFilters
                            ? 'No skills match your active filters'
                            : activeTab === 'shared_skills'
                              ? 'No cross-roadmap shared skills yet'
                              : 'No skill progress recorded yet'}
                        </h2>
                        <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
                          {hasActiveFilters
                            ? 'Clear your career level or mastery state filters to view all tracked skills.'
                            : activeTab === 'shared_skills'
                              ? 'When a skill appears across multiple active career roadmaps, your level-scoped progress is shared automatically here.'
                              : 'Lock a career roadmap and complete your first Daily Practice Quiz on Today to start building level-scoped skill evidence.'}
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                        {activeTab === 'shared_skills' &&
                        activeProgressData?.nextCursor ? (
                          <div className="flex w-full flex-col gap-2.5">
                            {activeSkillsPaginationError && (
                              <Alert variant="error_retryable" role="alert">
                                {activeSkillsPaginationError.message}
                              </Alert>
                            )}
                            <div>
                              <Button
                                type="button"
                                variant="secondary"
                                loading={
                                  loadingMoreSkillsKey === progressQueryKey
                                }
                                loadingText="Loading more skills..."
                                onClick={() => void handleLoadMoreSkills()}
                                className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                              >
                                <span>
                                  {activeSkillsPaginationError
                                    ? 'Retry Load More Skills'
                                    : 'Load More Skills'}
                                </span>
                              </Button>
                            </div>
                          </div>
                        ) : hasActiveFilters ? (
                          <Button
                            type="button"
                            variant="primary"
                            onClick={handleClearFilters}
                            className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
                          >
                            <span>Clear Filters</span>
                          </Button>
                        ) : (
                          <>
                            <Link href="/today" className={primaryLinkClass}>
                              <BookOpenIcon className="block h-4 w-4 shrink-0" />
                              <span>Today&apos;s Learning</span>
                            </Link>
                            <Link
                              href="/roadmaps"
                              className={secondaryLinkClass}
                            >
                              <CompassIcon className="block h-4 w-4 shrink-0" />
                              <span>View Roadmaps</span>
                            </Link>
                          </>
                        )}
                      </div>
                    </section>
                  );
                }

                return (
                  <div className="flex flex-col gap-3">
                    {list.map((skill) => (
                      <article
                        key={`${skill.skill_id}:${skill.career_level}`}
                        data-skill-id={skill.skill_id}
                        className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3
                              dir="auto"
                              className="text-body-md font-semibold text-slate-900 dark:text-slate-100"
                            >
                              {skill.name}
                            </h3>
                            <SkillProgressBadge state={skill.learning_state} />
                            <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {LEVEL_LABELS[skill.career_level] ??
                                skill.career_level}
                            </span>
                            {skill.weak_area && (
                              <span className="inline-flex items-center justify-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold leading-none text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200">
                                <AlertCircleIcon className="block h-3.5 w-3.5 shrink-0" />
                                <span>Needs Focus</span>
                              </span>
                            )}
                            {skill.shared_with_roadmap_ids.length > 0 && (
                              <span className="inline-flex items-center justify-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium leading-none text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
                                <CompassIcon className="block h-3.5 w-3.5 shrink-0" />
                                <span>
                                  Shared with{' '}
                                  {skill.shared_with_roadmap_ids.length}{' '}
                                  {skill.shared_with_roadmap_ids.length === 1
                                    ? 'other roadmap'
                                    : 'other roadmaps'}
                                </span>
                              </span>
                            )}
                          </div>

                          {skill.state_reason && (
                            <p
                              dir="auto"
                              className="text-body-sm text-slate-600 dark:text-slate-400"
                            >
                              {skill.state_reason}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1 leading-none">
                              <ClockIcon className="block h-3.5 w-3.5 shrink-0" />
                              <span>
                                Last evidence:{' '}
                                {formatShortDate(skill.last_evidence_at)}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedSkillForDetail({
                                skillId: skill.skill_id,
                                name: skill.name,
                              })
                            }
                            className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none text-slate-700 shadow-2xs transition hover:border-teal-300 hover:bg-teal-50/60 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-700 dark:hover:bg-teal-950/40 dark:hover:text-teal-300 sm:w-auto"
                          >
                            <EyeIcon className="block h-4 w-4 shrink-0" />
                            <span>Inspect Evidence</span>
                          </button>
                        </div>
                      </article>
                    ))}

                    {activeSkillsPaginationError && (
                      <Alert variant="error_retryable" role="alert">
                        {activeSkillsPaginationError.message}
                      </Alert>
                    )}

                    {(activeTab === 'overview' ||
                      activeTab === 'shared_skills') &&
                      activeProgressData?.nextCursor && (
                        <div className="flex justify-center pt-2">
                          <Button
                            type="button"
                            variant="secondary"
                            loading={loadingMoreSkillsKey === progressQueryKey}
                            loadingText="Loading more skills..."
                            onClick={() => void handleLoadMoreSkills()}
                            className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                          >
                            <span>
                              {activeSkillsPaginationError
                                ? 'Retry Load More Skills'
                                : 'Load More Skills'}
                            </span>
                          </Button>
                        </div>
                      )}
                  </div>
                );
              })()}
          </>
        )}

        {/* Tab 3: Weak Areas */}
        {activeTab === 'weak_areas' && (
          <>
            {isLoadingProgress && (
              <section
                aria-busy="true"
                aria-label="Loading weak areas"
                className="flex flex-col gap-3"
              >
                {[0, 1].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="h-4 w-1/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                    <div className="mt-3 h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                  </div>
                ))}
              </section>
            )}

            {!isLoadingProgress && activeProgressError && (
              <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <Alert variant="error_retryable" role="alert">
                  {activeProgressError.message}
                </Alert>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setProgressReloadTick((prev) => prev + 1)}
                    className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                  >
                    <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                    <span>Try Again</span>
                  </Button>
                </div>
              </section>
            )}

            {!isLoadingProgress &&
              !activeProgressError &&
              (weakAreas.length === 0 ? (
                <section className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
                    No weak areas flagged right now
                  </h2>
                  <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
                    When a recent Practice Quiz or AI Practice Review indicates
                    concepts that need reinforcement, those skills appear here
                    with targeted recommendations.
                  </p>
                </section>
              ) : (
                <div className="flex flex-col gap-3">
                  {weakAreas.map((weak) => (
                    <article
                      key={weak.skill_id}
                      className="flex flex-col gap-3 rounded-xl border border-amber-200/90 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-amber-900/60 dark:bg-slate-900"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold leading-none text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200">
                            <AlertCircleIcon className="block h-3.5 w-3.5 shrink-0" />
                            <span>Priority Review</span>
                          </span>
                          <h3
                            dir="auto"
                            className="text-body-md font-semibold text-slate-900 dark:text-slate-100"
                          >
                            {weak.name}
                          </h3>
                        </div>
                        <p
                          dir="auto"
                          className="text-body-sm text-slate-600 dark:text-slate-400"
                        >
                          {weak.reason}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedSkillForDetail({
                              skillId: weak.skill_id,
                              name: weak.name,
                            })
                          }
                          className="inline-flex w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none text-slate-700 shadow-2xs transition hover:border-teal-300 hover:bg-teal-50/60 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-700 dark:hover:bg-teal-950/40 dark:hover:text-teal-300 sm:w-auto"
                        >
                          <EyeIcon className="block h-4 w-4 shrink-0" />
                          <span>Inspect Evidence</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
          </>
        )}

        {/* Tab 4: History (EP-G03) */}
        {activeTab === 'history' && (
          <>
            {isLoadingHistory && (
              <section
                aria-busy="true"
                aria-label="Loading progress history"
                className="flex flex-col gap-3"
              >
                {[0, 1].map((idx) => (
                  <div
                    key={idx}
                    className="h-20 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                  />
                ))}
              </section>
            )}

            {!isLoadingHistory && activeHistoryError && (
              <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <Alert variant="error_retryable" role="alert">
                  {activeHistoryError.message}
                </Alert>
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setHistoryReloadTick((prev) => prev + 1)}
                    className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                  >
                    <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                    <span>Retry</span>
                  </Button>
                </div>
              </section>
            )}

            {!isLoadingHistory &&
              !activeHistoryError &&
              visibleHistoryItems.length === 0 && (
                <section className="flex flex-col items-start gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
                    No mastery history events yet
                  </h2>
                  <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
                    Eligible Practice Quiz and AI Practice Review evidence and
                    level-scoped mastery state transitions are recorded here
                    when mastery changes.
                  </p>
                </section>
              )}

            {!isLoadingHistory &&
              !activeHistoryError &&
              visibleHistoryItems.length > 0 && (
                <div className="flex flex-col gap-3">
                  {visibleHistoryItems.map((item) => (
                    <ProgressHistoryCard
                      key={item.id}
                      item={item}
                      skillName={skillNamesById.get(item.skill_id)}
                    />
                  ))}

                  {activeLoadMoreHistoryError && (
                    <Alert variant="error_retryable" role="alert">
                      {activeLoadMoreHistoryError.message}
                    </Alert>
                  )}

                  {activeHistoryData?.nextCursor && (
                    <div className="flex justify-center pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        loading={loadingMoreHistoryKey === historyQueryKey}
                        loadingText="Loading more history..."
                        onClick={() => void handleLoadMoreHistory()}
                        className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                      >
                        <span>Load More History</span>
                      </Button>
                    </div>
                  )}
                </div>
              )}
          </>
        )}
      </div>

      {/* EP-G02 Skill Detail Modal / Drawer */}
      <SkillDetailDrawer
        open={Boolean(selectedSkillForDetail)}
        accessToken={accessToken}
        skillId={selectedSkillForDetail?.skillId ?? null}
        skillName={selectedSkillForDetail?.name}
        careerLevelFilter={selectedCareerLevel || undefined}
        roadmapNamesById={roadmapNamesById}
        onClose={() => setSelectedSkillForDetail(null)}
      />
    </main>
  );
}
