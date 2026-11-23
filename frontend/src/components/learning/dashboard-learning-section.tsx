'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  focusRoadmap,
  getToday,
  type ProgressResponseDTO,
  type RoadmapSummaryDTO,
  type TodayResponseDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  LockIcon,
  RefreshCwIcon,
  SpinnerIcon,
  TargetIcon,
} from '@/components/ui/icons';
import { HoursPromptModal } from './hours-prompt-modal';

export interface DashboardLearningSectionProps {
  accessToken: string;
  initialToday: TodayResponseDTO | null;
  initialTodayError?: boolean;
  initialRoadmaps: RoadmapSummaryDTO[];
  initialProgress?: ProgressResponseDTO | null;
  dailyPlanEnabled: boolean;
  preferredDailyHours: number | null;
}

const primaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active sm:w-auto';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-label-md font-medium leading-none text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto';

const compactSecondaryLinkClass =
  'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium leading-none text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

/**
 * Interactive Dashboard Screen 13 learning strip:
 * - Left Hero Card (`lg:col-span-7`): Highlighted Focus Roadmap + `EP-L04` Today's Learning CTAs
 * - Right Card (`lg:col-span-5`): Other non-focused active roadmaps (up to 2) + inline `EP-R14` Focus Switch
 */
export function DashboardLearningSection({
  accessToken,
  initialToday,
  initialTodayError = false,
  initialRoadmaps,
  initialProgress = null,
  dailyPlanEnabled,
  preferredDailyHours,
}: DashboardLearningSectionProps) {
  const router = useRouter();
  const [roadmapsOverride, setRoadmapsOverride] = useState<{
    base: RoadmapSummaryDTO[];
    value: RoadmapSummaryDTO[];
  } | null>(null);
  const [todayOverride, setTodayOverride] = useState<{
    base: TodayResponseDTO | null;
    value: TodayResponseDTO | null;
  } | null>(null);
  const [todayErrorOverride, setTodayErrorOverride] = useState<{
    base: TodayResponseDTO | null;
    failed: boolean;
  } | null>(null);
  const [refreshingToday, setRefreshingToday] = useState(false);
  const [focusingId, setFocusingId] = useState<string | null>(null);
  const [focusError, setFocusError] = useState<MappedError | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  const [hoursModalTarget, setHoursModalTarget] = useState<{
    roadmapId: string;
    roadmapTitle?: string;
    initialHours: number | null;
  } | null>(null);

  const todayRefreshGenRef = useRef(0);

  const roadmaps =
    roadmapsOverride && roadmapsOverride.base === initialRoadmaps
      ? roadmapsOverride.value
      : initialRoadmaps;
  const today =
    todayOverride && todayOverride.base === initialToday
      ? todayOverride.value
      : initialToday;
  const todayLoadError =
    todayErrorOverride && todayErrorOverride.base === initialToday
      ? todayErrorOverride.failed
      : initialTodayError;

  const activeRoadmaps = roadmaps.filter((rm) => rm.status !== 'archived');
  // Keep hero roadmap title/link/modal strictly aligned with today.roadmap_id when present
  const focusedRoadmap = today?.roadmap_id
    ? (activeRoadmaps.find((rm) => rm.id === today.roadmap_id) ?? null)
    : (activeRoadmaps.find((rm) => rm.is_focus) ?? null);
  const otherActiveRoadmaps = focusedRoadmap
    ? activeRoadmaps.filter((rm) => rm.id !== focusedRoadmap.id)
    : activeRoadmaps;

  const refreshToday = async (fallbackToday?: TodayResponseDTO) => {
    const gen = ++todayRefreshGenRef.current;
    setRefreshingToday(true);
    try {
      const freshToday = await getToday(accessToken);
      if (gen !== todayRefreshGenRef.current) {
        return;
      }
      setTodayOverride({ base: initialToday, value: freshToday });
      setTodayErrorOverride({ base: initialToday, failed: false });
    } catch {
      if (gen !== todayRefreshGenRef.current) {
        return;
      }
      if (fallbackToday) {
        setTodayOverride({ base: initialToday, value: fallbackToday });
        setTodayErrorOverride({ base: initialToday, failed: false });
      } else if (!today) {
        setTodayErrorOverride({ base: initialToday, failed: true });
      }
      router.refresh();
    } finally {
      if (gen === todayRefreshGenRef.current) {
        setRefreshingToday(false);
      }
    }
  };

  const handleSetFocus = async (roadmap: RoadmapSummaryDTO) => {
    if (focusingId) {
      return;
    }
    setFocusingId(roadmap.id);
    setFocusError(null);
    setFocusNotice(null);
    try {
      const res = await focusRoadmap(accessToken, roadmap.id);
      setRoadmapsOverride({
        base: initialRoadmaps,
        value: roadmaps.map((entry) => ({
          ...entry,
          is_focus: entry.id === res.focus_roadmap_id,
          has_daily_plan:
            entry.id === res.focus_roadmap_id
              ? res.daily_plan.state === 'existing'
              : entry.has_daily_plan,
        })),
      });
      const fallbackMissingToday: TodayResponseDTO | undefined =
        res.daily_plan.state === 'missing'
          ? {
              status: 'no_daily_plan',
              roadmap_id: res.focus_roadmap_id,
              plan_id: null,
              plan_day: null,
              topic: null,
              quiz: { attempt_id: null, status: null, can_retry: false },
              job: null,
              requires_learning_hours: res.daily_plan.requires_learning_hours,
              preferred_daily_hours: res.daily_plan.requires_learning_hours
                ? null
                : preferredDailyHours,
            }
          : undefined;
      // Always reload EP-L04 Today after focus switch so cancelling HoursPromptModal never leaves stale roadmap_id
      const todayReload = refreshToday(fallbackMissingToday);
      if (res.daily_plan.state === 'missing') {
        setHoursModalTarget({
          roadmapId: roadmap.id,
          roadmapTitle: roadmap.role_name,
          initialHours: res.daily_plan.requires_learning_hours
            ? null
            : preferredDailyHours,
        });
        void todayReload;
      } else {
        setFocusNotice(
          `${roadmap.role_name} is now your Focus Roadmap and its existing Daily Plan is active.`,
        );
        await todayReload;
        router.refresh();
      }
    } catch (err) {
      setFocusError(mapApiError(err));
    } finally {
      setFocusingId(null);
    }
  };

  const showHeroCard = Boolean(today || todayLoadError);
  const hasProgressSummary = Boolean(
    initialProgress &&
      (initialProgress.skills.length > 0 ||
        initialProgress.roadmap_progress.items_total > 0),
  );

  if (!showHeroCard && activeRoadmaps.length === 0 && !hasProgressSummary) {
    return null;
  }

  const proficientCount = (initialProgress?.skills ?? []).filter(
    (s) => s.learning_state === 'proficient',
  ).length;
  const practicingCount = (initialProgress?.skills ?? []).filter(
    (s) => s.learning_state === 'practicing',
  ).length;
  const learningCount = (initialProgress?.skills ?? []).filter(
    (s) => s.learning_state === 'learning',
  ).length;
  const weakAreaCount = initialProgress?.weak_areas.length ?? 0;

  return (
    <section
      aria-label="Today and active roadmaps"
      className="flex flex-col gap-5"
    >
      {focusNotice && (
        <Alert variant="success" role="status">
          {focusNotice}
        </Alert>
      )}
      {focusError && (
        <Alert variant="error_retryable" role="alert">
          {focusError.message}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Hero Card: Highlighted Focus Roadmap + Today's Learning */}
        {showHeroCard && (
          <article
            aria-label="Focused roadmap and today's learning"
            className="flex flex-col justify-between gap-4 rounded-xl border border-teal-200/80 bg-white p-5 shadow-xs lg:col-span-7 dark:border-teal-900/60 dark:bg-slate-900"
          >
            <div className="flex flex-col gap-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider leading-none text-teal-700 dark:text-teal-300">
                  <BookOpenIcon className="block h-3.5 w-3.5 shrink-0" />
                  <span>Today&apos;s Learning</span>
                </span>
                {today?.plan_day && (
                  <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 font-mono text-xs font-semibold leading-none tabular-nums text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
                    Day {today.plan_day.day_no} of {today.plan_day.total_days}
                  </span>
                )}
              </div>

              {focusedRoadmap && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200/70 bg-teal-50/60 px-3.5 py-2.5 dark:border-teal-900/60 dark:bg-teal-950/30">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TargetIcon className="block h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                    <Link
                      href={`/roadmaps/${encodeURIComponent(focusedRoadmap.id)}`}
                      className="truncate text-sm font-semibold text-slate-900 transition-colors hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-300"
                      dir="auto"
                    >
                      {focusedRoadmap.role_name}
                    </Link>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-white px-2.5 py-1 text-[11px] font-semibold leading-none text-teal-700 dark:border-teal-800 dark:bg-slate-900 dark:text-teal-300">
                      Focus
                    </span>
                    <span className="inline-flex items-center justify-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium capitalize leading-none text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300">
                      <LockIcon className="block h-3 w-3 shrink-0" />
                      <span>{focusedRoadmap.status}</span>
                    </span>
                  </div>
                </div>
              )}

              {!today && todayLoadError && (
                <Alert
                  variant="warning"
                  role="alert"
                  title="Could not load Today's learning status"
                >
                  Today&apos;s learning summary is temporarily unavailable. Retry
                  here or open Today directly.
                </Alert>
              )}

              {today?.status === 'ready' && today.topic && (
                <div>
                  <h2
                    className="text-heading-md font-semibold text-slate-900 dark:text-slate-100"
                    dir="auto"
                  >
                    {today.topic.title}
                  </h2>
                  <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
                    Study today&apos;s guided explanation, check key questions,
                    and review curated documentation.
                  </p>
                </div>
              )}

              {today?.status === 'preparing' && (
                <div className="flex items-start gap-2.5">
                  <SpinnerIcon className="mt-0.5 block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  <div>
                    <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                      Preparing today&apos;s study guide
                    </h2>
                    <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
                      Your next sequential topic is generating in the
                      background. Open Today to monitor live readiness.
                    </p>
                  </div>
                </div>
              )}

              {today?.status === 'no_daily_plan' && (
                <div>
                  <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                    Confirm daily hours to launch your Daily Plan
                  </h2>
                  <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
                    Your Focus Roadmap is locked. Confirm your preferred daily
                    study hours to schedule sequential learning days.
                  </p>
                </div>
              )}

              {today?.status === 'no_focus_roadmap' && (
                <div>
                  <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                    Choose a Focus Roadmap
                  </h2>
                  <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
                    Lock a career roadmap and set it as Focus to start daily
                    sequential study units.
                  </p>
                </div>
              )}

              {today?.status === 'plan_completed' && (
                <div className="flex items-start gap-2.5">
                  <CheckCircleIcon className="mt-0.5 block h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <h2 className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100">
                      Focus Daily Plan completed
                    </h2>
                    <p className="mt-1 text-body-sm text-slate-600 dark:text-slate-400">
                      All scheduled days for this roadmap are complete. Review
                      your schedule or switch Focus to another roadmap.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-4 sm:flex-row sm:items-center dark:border-slate-800">
              {refreshingToday || Boolean(focusingId) ? (
                <Button
                  type="button"
                  variant="primary"
                  loading={true}
                  loadingText="Updating Today..."
                  disabled={true}
                  className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
                >
                  <span>Updating Today...</span>
                </Button>
              ) : !today && todayLoadError ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void refreshToday()}
                    className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                  >
                    <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                    <span>Retry Today</span>
                  </Button>
                  <Link href="/today" className={primaryLinkClass}>
                    <BookOpenIcon className="block h-4 w-4 shrink-0" />
                    <span>Open Today</span>
                  </Link>
                </>
              ) : today?.status === 'no_daily_plan' && today.roadmap_id ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={!dailyPlanEnabled}
                  onClick={() => {
                    const matched = activeRoadmaps.find(
                      (rm) => rm.id === today.roadmap_id,
                    );
                    setHoursModalTarget({
                      roadmapId: today.roadmap_id!,
                      roadmapTitle: matched?.role_name,
                      initialHours:
                        today.preferred_daily_hours ?? preferredDailyHours,
                    });
                  }}
                  className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
                >
                  <ClockIcon className="block h-4 w-4 shrink-0" />
                  <span>Create Daily Plan</span>
                </Button>
              ) : today?.status === 'no_focus_roadmap' ? (
                <Link href="/roadmaps" className={primaryLinkClass}>
                  <CompassIcon className="block h-4 w-4 shrink-0" />
                  <span>Open Roadmaps</span>
                </Link>
              ) : (
                <Link href="/today" className={primaryLinkClass}>
                  <BookOpenIcon className="block h-4 w-4 shrink-0" />
                  <span>Continue Today</span>
                </Link>
              )}

              <Link href="/daily-plan" className={secondaryLinkClass}>
                <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
                <span>View Daily Plan</span>
              </Link>
            </div>
          </article>
        )}

        {/* Right Card: Other Active Roadmaps (Non-Focused Only) */}
        <article
          aria-label="Other active roadmaps"
          className={cn(
            'flex flex-col justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900',
            showHeroCard ? 'lg:col-span-5' : 'lg:col-span-12',
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider leading-none text-slate-500 dark:text-slate-400">
                  <TargetIcon className="block h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                  <span>
                    {focusedRoadmap
                      ? 'Other Active Roadmaps'
                      : 'Active Roadmaps'}
                  </span>
                </h2>
                <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium leading-none tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {activeRoadmaps.length} / 3 active
                </span>
              </div>
              <Link
                href="/roadmaps"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold leading-none text-teal-700 hover:underline dark:text-teal-300"
              >
                <span>All</span>
                <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0" />
              </Link>
            </div>

            {activeRoadmaps.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <p className="text-body-sm text-slate-600 dark:text-slate-400">
                  No active roadmaps yet. Confirm a career goal to generate your
                  first personalized roadmap.
                </p>
                <Link
                  href="/career-profile"
                  className={compactSecondaryLinkClass}
                >
                  <CompassIcon className="block h-3.5 w-3.5 shrink-0" />
                  <span>Set Career Goal</span>
                </Link>
              </div>
            ) : otherActiveRoadmaps.length === 0 ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30">
                <p className="text-body-sm text-slate-600 dark:text-slate-400">
                  No other active roadmaps yet. You can track up to 3 active
                  roadmaps at once.
                </p>
                <Link
                  href="/career-profile"
                  className={compactSecondaryLinkClass}
                >
                  <CompassIcon className="block h-3.5 w-3.5 shrink-0" />
                  <span>Explore Career Goals</span>
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {otherActiveRoadmaps.slice(0, 2).map((rm) => {
                  const isDraft = rm.status === 'draft';
                  const detailHref = isDraft
                    ? `/roadmaps/${encodeURIComponent(rm.id)}/draft`
                    : `/roadmaps/${encodeURIComponent(rm.id)}`;

                  return (
                    <li
                      key={rm.id}
                      className="flex flex-col gap-2.5 rounded-lg border border-slate-200/80 bg-slate-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/40"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={detailHref}
                          className="block truncate text-sm font-semibold text-slate-900 hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-300"
                          dir="auto"
                        >
                          {rm.role_name}
                        </Link>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize leading-none',
                              isDraft
                                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-200'
                                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                            )}
                          >
                            {rm.status}
                          </span>
                        </div>
                      </div>

                      {rm.status === 'locked' && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          loading={focusingId === rm.id}
                          disabled={Boolean(focusingId)}
                          onClick={() => void handleSetFocus(rm)}
                          className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
                        >
                          <span>Set as Focus</span>
                        </Button>
                      )}

                      {isDraft && (
                        <Link
                          href={detailHref}
                          className={cn(
                            compactSecondaryLinkClass,
                            'w-full sm:w-auto',
                          )}
                        >
                          <span>Review Draft</span>
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </article>
      </div>

      {/* Skill Mastery Summary Strip (EP-G01) */}
      {hasProgressSummary && initialProgress && (
        <article
          aria-label="Skill mastery summary"
          className="flex flex-col gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider leading-none text-teal-700 dark:text-teal-300">
                <TargetIcon className="block h-3.5 w-3.5 shrink-0" />
                <span>Skill Mastery ({initialProgress.career_level})</span>
              </span>
              <span className="inline-flex items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-xs font-semibold leading-none tabular-nums text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200">
                {proficientCount} Proficient
              </span>
              <span className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-mono text-xs font-semibold leading-none tabular-nums text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200">
                {practicingCount} Practicing
              </span>
              <span className="inline-flex items-center justify-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-mono text-xs font-semibold leading-none tabular-nums text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200">
                {learningCount} Learning
              </span>
              {weakAreaCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold leading-none text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-200">
                  {weakAreaCount}{' '}
                  {weakAreaCount === 1 ? 'Weak Area' : 'Weak Areas'}
                </span>
              )}
            </div>
            <p className="text-body-sm text-slate-600 dark:text-slate-400">
              {initialProgress.roadmap_progress.items_completed} of{' '}
              {initialProgress.roadmap_progress.items_total} sequential roadmap
              topics completed across your practice quizzes.
            </p>
          </div>

          <Link href="/progress" className={secondaryLinkClass}>
            <TargetIcon className="block h-4 w-4 shrink-0" />
            <span>View Progress</span>
          </Link>
        </article>
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
    </section>
  );
}
