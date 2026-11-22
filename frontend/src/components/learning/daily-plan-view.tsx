'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ApiError,
  getDailyPlan,
  listRoadmaps,
  type DailyPlanResponseDTO,
  type PlanDayDTO,
  type RoadmapSummaryDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/icon-button';
import {
  BookOpenIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  CompassIcon,
  RefreshCwIcon,
} from '@/components/ui/icons';
import { DailyTaskCard } from './daily-task-card';
import { HoursPromptModal } from './hours-prompt-modal';

export interface DailyPlanViewProps {
  accessToken: string;
  initialRoadmapId?: string;
  dailyPlanEnabled?: boolean;
  preferredDailyHours?: number | null;
  initialPlan?: DailyPlanResponseDTO;
  initialNextCursor?: string | null;
  initialLockedRoadmaps?: RoadmapSummaryDTO[];
}

type PlanFetchState =
  | {
      key: string;
      status: 'loaded';
      plan: DailyPlanResponseDTO;
      days: PlanDayDTO[];
      nextCursor: string | null;
    }
  | {
      key: string;
      status: 'missing';
      code: 'DAILY_PLAN_NOT_FOUND' | 'NO_FOCUS_ROADMAP';
    }
  | {
      key: string;
      status: 'error';
      error: MappedError;
    };

const BANNER_AUTO_DISMISS_MS = 5_000;

const BANNER_PROGRESS_KEYFRAMES_CSS =
  '@keyframes agy-plan-banner-shrink{from{transform:scaleX(1)}to{transform:scaleX(0)}}' +
  '.agy-plan-banner-bar{animation:agy-plan-banner-shrink var(--banner-duration,5000ms) linear forwards}' +
  '@media(prefers-reduced-motion:reduce){.agy-plan-banner-bar{animation:none}}';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active sm:w-auto';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-label-md font-medium leading-none text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto';

/**
 * Screen 16 (`/daily-plan`): Sequential Daily Plan Timeline (`C05` §14.6 `EP-L01`–`EP-L03`, `PRD` §27).
 *
 * Renders sequential `Day 1..N` rows (never calendar dates), race-safe cursor pagination
 * (`requestGenRef`), locked roadmap switching, and `HoursPromptModal` for creating or rebuilding
 * future incomplete days without mutating completed days or the locked roadmap.
 */
export function DailyPlanView({
  accessToken,
  initialRoadmapId,
  dailyPlanEnabled = true,
  preferredDailyHours = null,
  initialPlan,
  initialNextCursor = null,
  initialLockedRoadmaps,
}: DailyPlanViewProps) {
  const tabListId = useId();
  const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | undefined>(
    initialRoadmapId,
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<PlanFetchState | null>(null);
  const [lockedRoadmaps, setLockedRoadmaps] = useState<RoadmapSummaryDTO[]>(
    initialLockedRoadmaps ?? [],
  );
  const [metadataReloadTick, setMetadataReloadTick] = useState(0);
  const [metadataErrorState, setMetadataErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);
  const [loadingMoreKey, setLoadingMoreKey] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<MappedError | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'rebuild' | null>(null);
  const [banner, setBanner] = useState<{ id: number; message: string } | null>(
    null,
  );

  const requestGenRef = useRef(0);
  const bannerSeqRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!banner) {
      return;
    }
    const timer = setTimeout(() => {
      setBanner(null);
    }, BANNER_AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [banner]);

  const requestKey = `${accessToken}:${selectedRoadmapId ?? 'focus'}:${reloadTick}`;
  const loadingMore = loadingMoreKey === requestKey;
  const metadataKey = `${accessToken}:${metadataReloadTick}`;
  const activeMetadataError =
    !initialLockedRoadmaps &&
    metadataErrorState &&
    metadataErrorState.key === metadataKey
      ? metadataErrorState.error
      : null;
  const seededState: PlanFetchState | null = useMemo(
    () =>
      initialPlan &&
      reloadTick === 0 &&
      selectedRoadmapId === initialRoadmapId
        ? {
            key: requestKey,
            status: 'loaded',
            plan: initialPlan,
            days: initialPlan.days,
            nextCursor: initialNextCursor,
          }
        : null,
    [
      initialNextCursor,
      initialPlan,
      initialRoadmapId,
      reloadTick,
      requestKey,
      selectedRoadmapId,
    ],
  );

  useEffect(() => {
    if (initialLockedRoadmaps) {
      return;
    }
    let active = true;
    const controller = new AbortController();

    listRoadmaps(
      accessToken,
      { status: 'locked', limit: 50 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setLockedRoadmaps(res.items);
        setMetadataErrorState(null);
      })
      .catch((err) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setMetadataErrorState({ key: metadataKey, error: mapApiError(err) });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, initialLockedRoadmaps, metadataKey]);

  useEffect(() => {
    if (seededState) {
      return;
    }

    loadMoreAbortRef.current?.abort();
    const gen = ++requestGenRef.current;
    const controller = new AbortController();

    getDailyPlan(
      accessToken,
      {
        ...(selectedRoadmapId ? { roadmap_id: selectedRoadmapId } : {}),
        limit: 20,
      },
      { signal: controller.signal },
    )
      .then((res) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'loaded',
          plan: res.plan,
          days: res.plan.days,
          nextCursor: res.meta.next_cursor,
        });
      })
      .catch((err) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        if (
          err instanceof ApiError &&
          (err.code === 'DAILY_PLAN_NOT_FOUND' ||
            err.code === 'NO_FOCUS_ROADMAP')
        ) {
          setFetchState({
            key: requestKey,
            status: 'missing',
            code: err.code,
          });
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'error',
          error: mapApiError(err),
        });
      });

    return () => {
      controller.abort();
    };
  }, [accessToken, requestKey, seededState, selectedRoadmapId]);

  const activeState =
    fetchState && fetchState.key === requestKey ? fetchState : seededState;
  const isLoading = activeState === null;
  const loadedPlan = activeState?.status === 'loaded' ? activeState.plan : null;
  const days = activeState?.status === 'loaded' ? activeState.days : [];
  const nextCursor =
    activeState?.status === 'loaded' ? activeState.nextCursor : null;

  const activeRoadmapMeta = lockedRoadmaps.find(
    (rm) =>
      rm.id === (selectedRoadmapId ?? loadedPlan?.roadmap_id) ||
      (!selectedRoadmapId && !loadedPlan && rm.is_focus),
  );
  const effectiveRoadmapId =
    selectedRoadmapId ?? loadedPlan?.roadmap_id ?? activeRoadmapMeta?.id ?? null;

  const handleSelectRoadmap = (roadmapId: string) => {
    if (loadingMore || modalMode !== null) {
      return;
    }
    loadMoreAbortRef.current?.abort();
    setLoadMoreError(null);
    setBanner(null);
    setSelectedRoadmapId(roadmapId);
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore || modalMode !== null || !loadedPlan) {
      return;
    }
    const gen = requestGenRef.current;
    const captureKey = requestKey;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMoreKey(captureKey);
    setLoadMoreError(null);

    try {
      const page = await getDailyPlan(
        accessToken,
        {
          roadmap_id: loadedPlan.roadmap_id,
          cursor: nextCursor,
          limit: 20,
        },
        { signal: controller.signal },
      );
      if (gen !== requestGenRef.current || controller.signal.aborted) {
        return;
      }
      setFetchState((prev) => {
        const currentDays =
          prev && prev.key === captureKey && prev.status === 'loaded'
            ? prev.days
            : days;
        const seenDayNos = new Set(currentDays.map((d) => d.day_no));
        const merged = [
          ...currentDays,
          ...page.plan.days.filter((d) => !seenDayNos.has(d.day_no)),
        ];
        return {
          key: captureKey,
          status: 'loaded',
          plan: page.plan,
          days: merged,
          nextCursor: page.meta.next_cursor,
        };
      });
    } catch (err) {
      if (gen !== requestGenRef.current || controller.signal.aborted) {
        return;
      }
      setLoadMoreError(mapApiError(err));
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null;
      }
      setLoadingMoreKey((prev) => (prev === captureKey ? null : prev));
    }
  };

  const handleModalSuccess = (updatedPlan: DailyPlanResponseDTO) => {
    const wasCreate = modalMode === 'create';
    loadMoreAbortRef.current?.abort();
    setLoadingMoreKey(null);
    setModalMode(null);
    setLoadMoreError(null);
    bannerSeqRef.current += 1;
    setBanner({
      id: bannerSeqRef.current,
      message: wasCreate
        ? `Daily Plan created at ${updatedPlan.hours_per_day} hrs/day (${updatedPlan.total_days} sequential days).`
        : `Daily Plan rebuilt at ${updatedPlan.hours_per_day} hrs/day. Completed days and any in-progress quiz remain preserved.`,
    });
    requestGenRef.current += 1;
    setFetchState({
      key: requestKey,
      status: 'loaded',
      plan: updatedPlan,
      days: updatedPlan.days,
      nextCursor: null,
    });
    setReloadTick((prev) => prev + 1);
  };

  const progressPct =
    loadedPlan && loadedPlan.total_days > 0
      ? Math.round((loadedPlan.completed_days / loadedPlan.total_days) * 100)
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
              Daily Plan
            </span>
          </nav>
          <h1 className="mt-1.5 text-heading-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Daily Plan
          </h1>
          <p className="mt-1 w-full max-w-xl text-pretty text-body-sm text-slate-600 dark:text-slate-400">
            Sequential learning days paced to your available hours. Missed
            calendar days never skip topics or rewrite history.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center">
          {loadedPlan && (
            <Button
              type="button"
              variant="secondary"
              disabled={!dailyPlanEnabled || loadingMore}
              onClick={() => setModalMode('rebuild')}
              className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
            >
              <RefreshCwIcon className="block h-4 w-4 shrink-0" />
              <span>Rebuild Plan</span>
            </Button>
          )}
          <Link href="/today" className={primaryLinkClass}>
            <BookOpenIcon className="block h-4 w-4 shrink-0" />
            <span>Open Today</span>
          </Link>
        </div>
      </header>

      {lockedRoadmaps.length > 1 && (
        <div className="border-b border-slate-200 dark:border-slate-800">
          <div
            role="tablist"
            aria-label="Select locked roadmap Daily Plan"
            className="-mb-px flex flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {lockedRoadmaps.map((rm) => {
              const selected = rm.id === effectiveRoadmapId;
              return (
                <button
                  key={rm.id}
                  role="tab"
                  type="button"
                  id={`${tabListId}-tab-${rm.id}`}
                  aria-selected={selected}
                  aria-controls={`${tabListId}-panel`}
                  disabled={loadingMore}
                  onClick={() => handleSelectRoadmap(rm.id)}
                  className={cn(
                    'inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-label-md font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    selected
                      ? 'border-teal-600 text-teal-700 dark:border-teal-400 dark:text-teal-300'
                      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                  )}
                >
                  <span dir="auto">{rm.role_name}</span>
                  {rm.is_focus && (
                    <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold leading-none text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                      Focus
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!dailyPlanEnabled && (
        <Alert variant="info" role="status" title="Plan creation & rebuild paused">
          Daily Plan changes are temporarily disabled. Your existing sequential
          plan remains viewable in read-only mode.
        </Alert>
      )}

      {banner && (
        <div
          data-testid="daily-plan-success-banner"
          className="relative overflow-hidden rounded-lg"
        >
          <style>{BANNER_PROGRESS_KEYFRAMES_CSS}</style>
          <Alert
            variant="success"
            role="status"
            className="pr-12 pb-[18px]"
          >
            {banner.message}
          </Alert>
          <IconButton
            aria-label="Dismiss status banner"
            onClick={() => setBanner(null)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            <CloseIcon className="block h-4 w-4 shrink-0" />
          </IconButton>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] w-full bg-emerald-500/15 dark:bg-teal-400/15"
          >
            <div
              key={banner.id}
              data-testid="daily-plan-banner-progress"
              className="agy-plan-banner-bar h-full w-full origin-left bg-emerald-500 dark:bg-teal-400 motion-reduce:[animation:none]"
              style={
                {
                  '--banner-duration': `${BANNER_AUTO_DISMISS_MS}ms`,
                } as CSSProperties
              }
            />
          </div>
        </div>
      )}

      <div id={`${tabListId}-panel`} role="tabpanel">
        {isLoading && (
          <section
            aria-busy="true"
            aria-label="Loading daily plan"
            className="flex flex-col gap-3"
          >
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="h-24 rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="h-4 w-1/4 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
                <div className="mt-3 h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
              </div>
            ))}
          </section>
        )}

        {!isLoading && activeState?.status === 'error' && (
          <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <Alert
              variant={
                activeState.error.tone === 'warning'
                  ? 'warning'
                  : 'error_retryable'
              }
              role="alert"
            >
              {activeState.error.message}
            </Alert>
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setReloadTick((prev) => prev + 1)}
                className="w-full justify-center sm:w-auto"
              >
                <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                <span>Try Again</span>
              </Button>
            </div>
          </section>
        )}

        {!isLoading && activeState?.status === 'missing' && (
          <section className="flex flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-300">
              <CalendarDaysIcon className="block h-6 w-6 shrink-0" />
            </span>

            {activeState.code === 'NO_FOCUS_ROADMAP' ? (
              <>
                <div className="space-y-1.5">
                  <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
                    No Focus Roadmap selected yet
                  </h2>
                  <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
                    Lock a career roadmap and set it as your Focus Roadmap to
                    build and track a sequential Daily Plan.
                  </p>
                </div>
                <Link href="/roadmaps" className={primaryLinkClass}>
                  <CompassIcon className="block h-4 w-4 shrink-0" />
                  <span>Open Roadmaps</span>
                </Link>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
                    No Daily Plan created yet
                  </h2>
                  <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
                    Confirm your daily study hours to convert this locked roadmap
                    into a sequential Day 1..N schedule.
                  </p>
                </div>
                {activeMetadataError && !effectiveRoadmapId && (
                  <div className="flex w-full flex-col gap-2.5">
                    <Alert
                      variant={
                        activeMetadataError.tone === 'warning'
                          ? 'warning'
                          : 'error_retryable'
                      }
                      role="alert"
                      title="Could not load locked roadmap details"
                    >
                      {activeMetadataError.message} Retry loading your roadmaps
                      to create a Daily Plan.
                    </Alert>
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          setMetadataReloadTick((prev) => prev + 1)
                        }
                        className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                      >
                        <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                        <span>Retry Roadmap Load</span>
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!dailyPlanEnabled || !effectiveRoadmapId}
                    onClick={() => setModalMode('create')}
                    className="w-full justify-center sm:w-auto"
                  >
                    <ClockIcon className="block h-4 w-4 shrink-0" />
                    <span>Create Daily Plan</span>
                  </Button>
                  <Link href="/roadmaps" className={secondaryLinkClass}>
                    <span>Back to Roadmaps</span>
                  </Link>
                </div>
              </>
            )}
          </section>
        )}

        {!isLoading && loadedPlan && (
          <div className="flex flex-col gap-5">
            {/* Summary Strip */}
            <section
              aria-label="Daily Plan summary"
              className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:grid-cols-3 sm:gap-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium leading-none text-slate-500 dark:text-slate-400">
                  Daily Pace
                </span>
                <div className="inline-flex min-h-6 items-center gap-1.5 font-mono text-lg font-semibold leading-none tabular-nums text-slate-900 dark:text-slate-100">
                  <ClockIcon className="block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  <span>{loadedPlan.hours_per_day} hrs / day</span>
                </div>
                <span className="text-caption leading-snug text-slate-500 dark:text-slate-400">
                  Roadmap v{loadedPlan.roadmap_version_no}
                  {loadedPlan.is_focus ? ' · Focus Roadmap' : ''}
                </span>
              </div>

              <div className="flex flex-col gap-1.5 sm:items-center sm:text-center">
                <span className="text-xs font-medium leading-none text-slate-500 dark:text-slate-400">
                  Sequential Progress
                </span>
                <p className="inline-flex min-h-6 items-center font-mono text-lg font-semibold leading-none tabular-nums text-slate-900 dark:text-slate-100">
                  {loadedPlan.completed_days} / {loadedPlan.total_days} days
                </p>
                <div className="flex min-h-[1.125rem] w-full items-center sm:mx-auto sm:max-w-[14rem]">
                  <div
                    role="progressbar"
                    aria-label="Daily Plan completion"
                    aria-valuenow={progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                  >
                    <div
                      className="h-full rounded-full bg-teal-600 transition-all duration-300 dark:bg-teal-400"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 sm:items-end sm:text-right">
                <span className="text-xs font-medium leading-none text-slate-500 dark:text-slate-400">
                  Current Day
                </span>
                <p className="inline-flex min-h-6 items-center font-mono text-lg font-semibold leading-none tabular-nums text-slate-900 dark:text-slate-100">
                  {loadedPlan.next_incomplete_day_no !== null
                    ? `Day ${loadedPlan.next_incomplete_day_no}`
                    : 'All days complete'}
                </p>
                <span className="text-caption leading-snug text-slate-500 dark:text-slate-400">
                  {loadedPlan.is_focus
                    ? 'Drives your Today view'
                    : 'Non-Focus roadmap plan'}
                </span>
              </div>
            </section>

            {/* Sequential Timeline */}
            <section
              aria-label="Sequential learning days"
              className="flex flex-col gap-3"
            >
              {days.map((day) => {
                const isNextDay =
                  loadedPlan.next_incomplete_day_no === day.day_no;
                return (
                  <DailyTaskCard
                    key={day.day_no}
                    dayNo={day.day_no}
                    status={day.status}
                    topics={day.topics}
                    isActiveDay={isNextDay}
                    action={
                      isNextDay && loadedPlan.is_focus ? (
                        <Link href="/today" className={primaryLinkClass}>
                          <BookOpenIcon className="block h-4 w-4 shrink-0" />
                          <span>Study Day {day.day_no}</span>
                        </Link>
                      ) : undefined
                    }
                  />
                );
              })}
            </section>

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
                  loadingText="Loading more days..."
                  disabled={loadingMore || modalMode !== null}
                  onClick={() => void handleLoadMore()}
                  className="w-full justify-center border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                >
                  <span>Load more days</span>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {modalMode !== null && effectiveRoadmapId && (
        <HoursPromptModal
          open={modalMode !== null}
          mode={modalMode}
          accessToken={accessToken}
          roadmapId={effectiveRoadmapId}
          roadmapTitle={activeRoadmapMeta?.role_name}
          planId={loadedPlan?.plan_id}
          initialHours={
            modalMode === 'rebuild'
              ? loadedPlan?.hours_per_day ?? preferredDailyHours
              : preferredDailyHours
          }
          onClose={() => setModalMode(null)}
          onSuccess={handleModalSuccess}
        />
      )}
    </main>
  );
}
