'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createIdempotencyKey,
  generateQuiz,
  getJobStatus,
  getToday,
  isJobAcceptedDTO,
  listLearningResources,
  type JobAcceptedDTO,
  type JobStatusDTO,
  type LearningResourceDTO,
  type TodayResponseDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AILoadingState } from '@/components/ui/ai-loading-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  RefreshCwIcon,
  SparklesIcon,
} from '@/components/ui/icons';
import { AIExplanationCard } from './ai-explanation-card';
import { HoursPromptModal } from './hours-prompt-modal';
import { LearningResourceCard } from './learning-resource-card';

export interface TodayViewProps {
  accessToken: string;
  dailyPlanEnabled?: boolean;
  quizPracticeEnabled?: boolean;
  initialToday?: TodayResponseDTO;
}

type FetchState =
  | { key: string; status: 'loaded'; today: TodayResponseDTO }
  | { key: string; status: 'error'; error: MappedError };

const primaryLinkClass =
  'inline-flex h-10 min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active sm:w-auto';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-label-md font-medium leading-none text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto';

const QUIZ_STATUS_LABELS: Record<string, string> = {
  generated: 'Quiz ready to start',
  started: 'Quiz in progress',
  submitted: 'Quiz submitted',
  ai_reviewed: 'Review completed',
  feedback_available: 'Feedback available',
};

/**
 * Screen 17 (`/today`): Today Learning Hub (`C05` §14.6 `EP-L04`, `PRD` §28).
 *
 * Handles all 5 `today_status` states (`no_focus_roadmap`, `no_daily_plan`, `plan_completed`,
 * `preparing`, `ready`) plus `403 FEATURE_DISABLED` with race-safe async reloads and `EP-J01`
 * polling. Never renders a "Mark Complete" button — only Practice Quiz submission (M08) unlocks
 * the next sequential day.
 */
export function TodayView({
  accessToken,
  dailyPlanEnabled = true,
  quizPracticeEnabled = true,
  initialToday,
}: TodayViewProps) {
  const router = useRouter();
  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<FetchState | null>(null);
  const [resourcesState, setResourcesState] = useState<{
    topicId: string;
    items: LearningResourceDTO[];
  } | null>(null);
  const [hoursModalOpen, setHoursModalOpen] = useState(false);
  const [failedJobState, setFailedJobState] = useState<{
    jobId: string;
    hasBuiltInRetry: boolean;
  } | null>(null);
  const [generatingQuizItemId, setGeneratingQuizItemId] = useState<
    string | null
  >(null);
  const [quizGenJobState, setQuizGenJobState] = useState<{
    planItemId: string;
    job: JobAcceptedDTO;
  } | null>(null);
  const [quizGenErrorState, setQuizGenErrorState] = useState<{
    planItemId: string;
    error: MappedError;
  } | null>(null);

  const requestGenRef = useRef(0);
  const quizIdemKeyRef = useRef<{ planItemId: string; key: string } | null>(
    null,
  );
  const mountedRef = useRef(true);
  const currentPlanItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const requestKey = `${accessToken}:${reloadTick}`;
  const seededToday = initialToday && reloadTick === 0 ? initialToday : null;

  useEffect(() => {
    if (seededToday) {
      return;
    }

    const gen = ++requestGenRef.current;
    const controller = new AbortController();

    getToday(accessToken, { signal: controller.signal })
      .then((today) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        setFetchState({ key: requestKey, status: 'loaded', today });
      })
      .catch((err) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
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
  }, [accessToken, requestKey, seededToday]);

  const activeState =
    fetchState && fetchState.key === requestKey
      ? fetchState
      : seededToday
        ? { key: requestKey, status: 'loaded' as const, today: seededToday }
        : null;

  const isLoading = activeState === null;
  const today = activeState?.status === 'loaded' ? activeState.today : null;
  const loadError = activeState?.status === 'error' ? activeState.error : null;

  const activeTopicId =
    today?.status === 'ready' ? (today.topic?.topic_id ?? null) : null;
  const activePlanItemId =
    today?.status === 'ready' ? (today.plan_day?.plan_item_id ?? null) : null;

  useEffect(() => {
    currentPlanItemIdRef.current = activePlanItemId;
  }, [activePlanItemId]);

  useEffect(() => {
    if (!activeTopicId) {
      return;
    }
    let active = true;
    const controller = new AbortController();

    listLearningResources(
      accessToken,
      { topic_id: activeTopicId, limit: 20 },
      { signal: controller.signal },
    )
      .then((res) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setResourcesState({ topicId: activeTopicId, items: res.items });
      })
      .catch(() => {
        // Fallback silently to `today.topic.sources` if resource endpoint is unavailable.
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, activeTopicId]);

  const triggerReload = useCallback(() => {
    setFailedJobState(null);
    setReloadTick((prev) => prev + 1);
  }, []);

  const pollTopicContentJob = useCallback(
    async (jobId: string, signal: AbortSignal): Promise<JobStatusDTO> => {
      try {
        const status = await getJobStatus(accessToken, jobId, { signal });
        if (status.status === 'failed') {
          setFailedJobState({
            jobId,
            hasBuiltInRetry: Boolean(
              status.retryable || status.error?.retryable,
            ),
          });
        } else {
          setFailedJobState((prev) => (prev?.jobId === jobId ? null : prev));
        }
        return status;
      } catch (err) {
        if (!signal.aborted) {
          setFailedJobState({ jobId, hasBuiltInRetry: true });
        }
        throw err;
      }
    },
    [accessToken],
  );

  const activeFailedJob =
    today?.status === 'preparing' &&
    today.job &&
    failedJobState?.jobId === today.job.job_id
      ? failedJobState
      : null;

  const handlePlanCreated = () => {
    setHoursModalOpen(false);
    triggerReload();
  };

  const generatingQuiz =
    activePlanItemId !== null && generatingQuizItemId === activePlanItemId;
  const quizGenJob =
    activePlanItemId !== null &&
    quizGenJobState?.planItemId === activePlanItemId
      ? quizGenJobState.job
      : null;
  const quizGenError =
    activePlanItemId !== null &&
    quizGenErrorState?.planItemId === activePlanItemId
      ? quizGenErrorState.error
      : null;

  const handleLaunchQuiz = async () => {
    const planItemId = today?.plan_day?.plan_item_id;
    if (!planItemId || generatingQuiz || !quizPracticeEnabled) {
      return;
    }
    setGeneratingQuizItemId(planItemId);
    setQuizGenErrorState((prev) =>
      prev?.planItemId === planItemId ? null : prev,
    );
    if (
      !quizIdemKeyRef.current ||
      quizIdemKeyRef.current.planItemId !== planItemId
    ) {
      quizIdemKeyRef.current = {
        planItemId,
        key: createIdempotencyKey(),
      };
    }
    const idemKey = quizIdemKeyRef.current.key;

    try {
      const outcome = await generateQuiz(
        accessToken,
        { daily_plan_item_id: planItemId },
        idemKey,
      );
      if (quizIdemKeyRef.current?.planItemId === planItemId) {
        quizIdemKeyRef.current = null;
      }
      if (!mountedRef.current || currentPlanItemIdRef.current !== planItemId) {
        return;
      }
      if (isJobAcceptedDTO(outcome)) {
        setQuizGenJobState({ planItemId, job: outcome });
      } else {
        router.push(`/quiz/${encodeURIComponent(outcome.attempt_id)}`);
      }
    } catch (err) {
      const mapped = mapApiError(err);
      if (
        err instanceof ApiError &&
        (err.statusCode === 400 ||
          err.statusCode === 403 ||
          err.statusCode === 404 ||
          err.statusCode === 409 ||
          err.statusCode === 422 ||
          err.statusCode === 429) &&
        quizIdemKeyRef.current?.planItemId === planItemId
      ) {
        quizIdemKeyRef.current = null;
      }
      if (!mountedRef.current || currentPlanItemIdRef.current !== planItemId) {
        return;
      }
      setQuizGenErrorState({ planItemId, error: mapped });
    } finally {
      if (mountedRef.current) {
        setGeneratingQuizItemId((prev) => (prev === planItemId ? null : prev));
      }
    }
  };

  const resolvedResources: LearningResourceDTO[] =
    activeTopicId && resourcesState?.topicId === activeTopicId
      ? resourcesState.items
      : (today?.topic?.sources ?? []).map((src, index) => ({
          id: `source-${index}`,
          title: src.publisher,
          publisher: src.publisher,
          url: src.url,
          resource_type: 'official_docs',
          retrieved_at: src.retrieved_at ?? null,
        }));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="min-w-0">
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
              Today
            </span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-heading-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Today&apos;s Learning
            </h1>
            {today?.plan_day && (
              <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 font-mono text-xs font-semibold leading-none tabular-nums text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
                Day {today.plan_day.day_no} of {today.plan_day.total_days}
              </span>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link href="/daily-plan" className={secondaryLinkClass}>
            <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
            <span>View Daily Plan</span>
          </Link>
        </div>
      </header>

      {isLoading && (
        <section
          aria-busy="true"
          aria-label="Loading today's learning unit"
          className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="h-6 w-1/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-full rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-5/6 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
        </section>
      )}

      {!isLoading && loadError && (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          {loadError.code === 'FEATURE_DISABLED' ? (
            <Alert
              variant="info"
              role="status"
              title="New topic content generation is temporarily paused"
            >
              {loadError.message} You can still view your Daily Plan and any
              previously prepared topics.
            </Alert>
          ) : (
            <Alert
              variant={
                loadError.tone === 'warning' ? 'warning' : 'error_retryable'
              }
              role="alert"
              retryAfterSeconds={loadError.retryAfterSeconds}
            >
              {loadError.message}
            </Alert>
          )}
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="secondary"
              onClick={triggerReload}
              className="w-full justify-center sm:w-auto"
            >
              <RefreshCwIcon className="block h-4 w-4 shrink-0" />
              <span>Retry</span>
            </Button>
            <Link href="/daily-plan" className={secondaryLinkClass}>
              <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
              <span>Open Daily Plan</span>
            </Link>
          </div>
        </section>
      )}

      {!isLoading && today?.status === 'no_focus_roadmap' && (
        <section className="flex flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-300">
            <CompassIcon className="block h-6 w-6 shrink-0" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
              Select a Focus Roadmap to start learning
            </h2>
            <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
              Your Today experience is driven by your active Focus Roadmap. Lock
              a draft roadmap or choose an existing locked roadmap as your Focus
              to unlock sequential daily learning.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5 pt-1 sm:w-auto sm:flex-row sm:items-center">
            <Link href="/roadmaps" className={primaryLinkClass}>
              <CompassIcon className="block h-4 w-4 shrink-0" />
              <span>Go to Roadmaps</span>
            </Link>
            <Link href="/career-profile" className={secondaryLinkClass}>
              <span>Manage Career Goals</span>
            </Link>
          </div>
        </section>
      )}

      {!isLoading && today?.status === 'no_daily_plan' && (
        <section className="flex flex-col items-start gap-4 rounded-2xl border border-teal-200/80 bg-white p-6 shadow-xs sm:p-8 dark:border-teal-900/60 dark:bg-slate-900">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-300">
            <ClockIcon className="block h-6 w-6 shrink-0" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
              Set your daily study hours to build your plan
            </h2>
            <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
              Your Focus Roadmap is locked and ready. Confirm how many hours per
              day you can study to generate your sequential Daily Plan. Missed
              calendar days never skip content.
            </p>
          </div>

          {!dailyPlanEnabled && (
            <Alert variant="info" role="status">
              Daily Plan creation is temporarily disabled. Existing plans and
              roadmaps remain accessible.
            </Alert>
          )}

          <div className="flex w-full flex-col gap-2.5 pt-1 sm:w-auto sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="primary"
              disabled={!dailyPlanEnabled || !today.roadmap_id}
              onClick={() => setHoursModalOpen(true)}
              className="w-full justify-center sm:w-auto"
            >
              <ClockIcon className="block h-4 w-4 shrink-0" />
              <span>Confirm Hours &amp; Create Daily Plan</span>
            </Button>
            {today.roadmap_id && (
              <Link
                href={`/roadmaps/${encodeURIComponent(today.roadmap_id)}`}
                className={secondaryLinkClass}
              >
                <span>View Focus Roadmap</span>
              </Link>
            )}
          </div>
        </section>
      )}

      {!isLoading && today?.status === 'plan_completed' && (
        <section className="flex flex-col items-start gap-4 rounded-2xl border border-emerald-200 bg-white p-6 shadow-xs sm:p-8 dark:border-emerald-900/60 dark:bg-slate-900">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300">
            <CheckCircleIcon className="block h-6 w-6 shrink-0" />
          </span>
          <div className="space-y-1.5">
            <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
              Daily Plan completed
            </h2>
            <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
              You have completed every sequential day in your current Focus
              Roadmap&apos;s Daily Plan. Review your completed schedule or switch
              Focus to another locked roadmap to keep progressing.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5 pt-1 sm:w-auto sm:flex-row sm:items-center">
            <Link href="/daily-plan" className={primaryLinkClass}>
              <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
              <span>Review Daily Plan</span>
            </Link>
            <Link href="/roadmaps" className={secondaryLinkClass}>
              <CompassIcon className="block h-4 w-4 shrink-0" />
              <span>Switch Focus Roadmap</span>
            </Link>
          </div>
        </section>
      )}

      {!isLoading && today?.status === 'preparing' && today.job && (
        <div className="flex flex-col gap-4">
          <AILoadingState
            job={today.job}
            title="Preparing today's topic study guide"
            variant="full_section_skeleton"
            accessToken={accessToken}
            pollJobStatus={pollTopicContentJob}
            skeletonCount={5}
            onJobSucceeded={() => {
              triggerReload();
            }}
            onRetryJob={() => {
              triggerReload();
            }}
          />
          {activeFailedJob ? (
            !activeFailedJob.hasBuiltInRetry && (
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="primary"
                  onClick={triggerReload}
                  className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
                >
                  <RefreshCwIcon className="block h-4 w-4 shrink-0" />
                  <span>Try Again</span>
                </Button>
                <Link href="/daily-plan" className={secondaryLinkClass}>
                  <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
                  <span>View Daily Plan</span>
                </Link>
              </div>
            )
          ) : (
            <p className="text-caption text-slate-500 dark:text-slate-400">
              You can safely browse your Daily Plan or Roadmaps while this study
              unit finishes preparing.
            </p>
          )}
        </div>
      )}

      {!isLoading && today?.status === 'ready' && today.topic && (
        <div
          data-testid="today-ready-grid"
          className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start"
        >
          {/* Left Main Column: AI Topic Study Guide & Key Questions */}
          <div className="min-w-0 space-y-6 lg:col-span-8">
            <AIExplanationCard
              title={today.topic.title}
              explanationMarkdown={today.topic.explanation_markdown}
              importantQuestions={today.topic.important_questions}
              contentVersion={today.topic.content_version}
              requiredDepth={today.topic.required_depth}
            />
          </div>

          {/* Right Sticky Action Rail: Daily Practice Quiz (top) + Verified Learning Resources (below) */}
          <aside
            aria-label="Practice quiz and verified learning resources"
            className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-20 lg:col-span-4"
          >
            {/* Top Card — Daily Practice Quiz (NEVER a "Mark Complete" button per PRD §33) */}
            <section
              aria-labelledby="today-practice-heading"
              className="flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-300">
                  <SparklesIcon className="block h-5 w-5 shrink-0" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2
                      id="today-practice-heading"
                      className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100"
                    >
                      Daily Practice Quiz
                    </h2>
                    <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium leading-none text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
                      {today.quiz.status
                        ? (QUIZ_STATUS_LABELS[today.quiz.status] ??
                          today.quiz.status)
                        : 'Ready'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-body-sm text-slate-600 dark:text-slate-400">
                    {!quizPracticeEnabled && !today.quiz.attempt_id
                      ? 'Practice Quiz generation is currently paused. Your study guide and resources remain available.'
                      : 'Submitting the practice quiz unlocks your next sequential Daily Plan day, and eligible answers contribute to level-scoped mastery evidence.'}
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col items-stretch">
                {today.quiz.attempt_id ? (
                  <Link
                    href={`/quiz/${encodeURIComponent(today.quiz.attempt_id)}`}
                    className="inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active"
                  >
                    <BookOpenIcon className="block h-4 w-4 shrink-0" />
                    <span>
                      {today.quiz.status === 'generated' ||
                      today.quiz.status === 'started'
                        ? 'Continue Practice Quiz'
                        : 'View Quiz Results'}
                    </span>
                  </Link>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    loading={generatingQuiz}
                    loadingText="Preparing Quiz..."
                    disabled={
                      !quizPracticeEnabled ||
                      generatingQuiz ||
                      Boolean(quizGenJob) ||
                      !today.plan_day?.plan_item_id
                    }
                    onClick={() => void handleLaunchQuiz()}
                    className="w-full shrink-0 justify-center whitespace-nowrap"
                  >
                    <BookOpenIcon className="block h-4 w-4 shrink-0" />
                    <span>Start Practice Quiz</span>
                  </Button>
                )}
              </div>

              {quizGenError && (
                <Alert
                  variant={
                    quizGenError.tone === 'warning'
                      ? 'warning'
                      : 'error_retryable'
                  }
                  role="alert"
                  retryAfterSeconds={quizGenError.retryAfterSeconds}
                >
                  {quizGenError.message}
                </Alert>
              )}

              {quizGenJob && activePlanItemId && (
                <AILoadingState
                  job={quizGenJob}
                  title="Preparing your topic Practice Quiz"
                  variant="inline_banner"
                  accessToken={accessToken}
                  onJobSucceeded={(resultRef) => {
                    const initiatedItemId = activePlanItemId;
                    setQuizGenJobState((prev) =>
                      prev?.planItemId === initiatedItemId ? null : prev,
                    );
                    if (
                      !mountedRef.current ||
                      currentPlanItemIdRef.current !== initiatedItemId
                    ) {
                      return;
                    }
                    if (resultRef?.id) {
                      router.push(`/quiz/${encodeURIComponent(resultRef.id)}`);
                    } else {
                      triggerReload();
                    }
                  }}
                  onRetryJob={() => {
                    setQuizGenJobState((prev) =>
                      prev?.planItemId === activePlanItemId ? null : prev,
                    );
                    void handleLaunchQuiz();
                  }}
                />
              )}
            </section>

            {/* Second Card — Verified Learning Resources */}
            {resolvedResources.length > 0 && (
              <section
                aria-labelledby="today-resources-heading"
                className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="today-resources-heading"
                    className="text-heading-sm font-semibold text-slate-900 dark:text-slate-100"
                  >
                    Verified Learning Resources
                  </h2>
                  <span className="text-caption text-slate-500 dark:text-slate-400">
                    External attribution links
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  {resolvedResources.map((res) => (
                    <LearningResourceCard
                      key={res.id}
                      title={res.title}
                      publisher={res.publisher}
                      url={res.url}
                      resourceType={res.resource_type}
                      retrievedAt={res.retrieved_at}
                    />
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      )}

      {today?.roadmap_id && (
        <HoursPromptModal
          open={hoursModalOpen}
          mode="create"
          accessToken={accessToken}
          roadmapId={today.roadmap_id}
          initialHours={today.preferred_daily_hours ?? null}
          onClose={() => setHoursModalOpen(false)}
          onSuccess={handlePlanCreated}
        />
      )}
    </main>
  );
}
