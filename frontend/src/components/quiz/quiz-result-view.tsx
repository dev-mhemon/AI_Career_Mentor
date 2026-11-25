'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createIdempotencyKey,
  getJobStatus,
  getPracticeReviewFeedback,
  getQuizResult,
  isJobAcceptedDTO,
  listPracticeReviews,
  retryPracticeReview,
  retryQuizAttempt,
  type JobAcceptedDTO,
  type JobStatusDTO,
  type PracticeFeedbackDTO,
  type QuizQuestionDTO,
  type QuizResultDTO,
  type QuizResultFreeResponseQuestionDTO,
  type QuizResultMcqQuestionDTO,
  type SavedQuizAnswerDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { SkillProgressBadge } from '@/components/progress/skill-progress-badge';
import { AILoadingState } from '@/components/ui/ai-loading-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  BookOpenIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  SparklesIcon,
  TargetIcon,
} from '@/components/ui/icons';
import { PracticeReviewCard } from './practice-review-card';
import { QuizCard } from './quiz-card';

export interface QuizResultViewProps {
  accessToken: string;
  attemptId: string;
  questions: readonly QuizQuestionDTO[];
  savedAnswers?: readonly SavedQuizAnswerDTO[];
  initialResult?: QuizResultDTO | null;
  planDayUnlocked?: boolean;
  nextPlanDayNo?: number | null;
  quizPracticeEnabled?: boolean;
  aiPracticeReviewEnabled?: boolean;
  onNavigateAttempt?: (newAttemptId: string) => void;
}

const primaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active sm:w-auto';

const masteryPrimaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-4 text-label-md font-semibold leading-none text-white shadow-xs transition-colors duration-(--duration-fast) ease-standard hover:bg-teal-700 active:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 sm:w-auto';

const DETERMINISTIC_CLEAR_CODES = new Set([
  'INVALID_FORMAT',
  'VALIDATION_FAILED',
  'RETRY_LIMIT_REACHED',
  'QUIZ_NOT_SUBMITTED',
  'FEATURE_DISABLED',
  'RATE_LIMIT_EXCEEDED',
]);

/**
 * Post-submission Quiz Result & AI Practice Review view (`EP-Q06`, `EP-Q07`, `EP-PR01`–`EP-PR03`).
 *
 * Guarantees:
 * - Zero pass/fail verdicts and zero `"Job Ready"` wording (`PRD` §33, §35).
 * - Automatically polls `EP-Q06` / `EP-PR01` while any free-response review has `review_status === 'pending'`
 *   and loads `EP-PR02` rubric feedback for every reviewed/not_evidence free-response item.
 * - Supports `EP-PR03` individual review retry (handling `200`, `202`, `409`, and `410 RAW_RESPONSE_EXPIRED`).
 * - Supports `EP-Q07` single quiz retry (`H-IDEM`) when `retry_available === true`.
 */
export function QuizResultView({
  accessToken,
  attemptId,
  questions,
  savedAnswers = [],
  initialResult = null,
  planDayUnlocked = false,
  nextPlanDayNo = null,
  quizPracticeEnabled = true,
  aiPracticeReviewEnabled = true,
  onNavigateAttempt,
}: QuizResultViewProps) {
  const router = useRouter();
  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<
    | { key: string; status: 'loaded'; result: QuizResultDTO }
    | { key: string; status: 'error'; error: MappedError }
    | null
  >(null);
  const [liveResultOverride, setLiveResultOverride] = useState<{
    key: string;
    result: QuizResultDTO;
  } | null>(null);
  const [feedbackByReviewId, setFeedbackByReviewId] = useState<
    Record<string, PracticeFeedbackDTO>
  >({});
  const [feedbackLoadErrorById, setFeedbackLoadErrorById] = useState<
    Record<string, string>
  >({});
  const [feedbackRetryTick, setFeedbackRetryTick] = useState(0);
  const [polledReadyReviewIds, setPolledReadyReviewIds] = useState<string[]>(
    [],
  );
  const [retryingReviewId, setRetryingReviewId] = useState<string | null>(null);
  const [reviewErrorById, setReviewErrorById] = useState<
    Record<string, string>
  >({});
  const [expiredReviewIds, setExpiredReviewIds] = useState<
    Record<string, boolean>
  >({});

  // EP-Q07 retry quiz state
  const scope = `${accessToken}:${attemptId}`;
  const [retryingQuizScope, setRetryingQuizScope] = useState<string | null>(
    null,
  );
  const retryingQuiz = retryingQuizScope === scope;
  const [retryQuizJob, setRetryQuizJob] = useState<JobAcceptedDTO | null>(null);
  const [retryQuizError, setRetryQuizError] = useState<MappedError | null>(
    null,
  );
  const [retryCooldownUntilMs, setRetryCooldownUntilMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const retryIdemKeyRef = useRef<string | null>(null);
  const requestGenRef = useRef(0);
  const pollEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const currentScopeRef = useRef(`${accessToken}:${attemptId}`);
  const inFlightReviewIdsRef = useRef<Set<string>>(new Set());
  const loadedReviewIdsRef = useRef<Set<string>>(new Set());
  const failedFeedbackIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const scope = `${accessToken}:${attemptId}`;
    if (currentScopeRef.current !== scope) {
      currentScopeRef.current = scope;
      pollEpochRef.current += 1;
      inFlightReviewIdsRef.current.clear();
      loadedReviewIdsRef.current.clear();
      failedFeedbackIdsRef.current.clear();
    }
  }, [accessToken, attemptId]);

  const requestKey = `${accessToken}:${attemptId}:${reloadTick}`;
  const seededResult =
    initialResult && reloadTick === 0 ? initialResult : null;
  const activeFetchState =
    fetchState && fetchState.key === requestKey
      ? fetchState
      : seededResult
        ? { key: requestKey, status: 'loaded' as const, result: seededResult }
        : null;
  const activeResult =
    liveResultOverride && liveResultOverride.key === requestKey
      ? liveResultOverride.result
      : activeFetchState?.status === 'loaded'
        ? activeFetchState.result
        : null;
  const loadError =
    activeFetchState?.status === 'error' ? activeFetchState.error : null;

  // Cooldown ticker for 429 rate-limit enforcement
  useEffect(() => {
    if (retryCooldownUntilMs <= Date.now()) {
      return;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= retryCooldownUntilMs) {
        clearInterval(timer);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [retryCooldownUntilMs]);

  const cooldownRemainingSeconds =
    retryCooldownUntilMs > nowMs
      ? Math.ceil((retryCooldownUntilMs - nowMs) / 1_000)
      : 0;

  // Load initial EP-Q06 result if not seeded or on manual reload
  useEffect(() => {
    if (seededResult) {
      return;
    }
    const gen = ++requestGenRef.current;
    const controller = new AbortController();

    getQuizResult(accessToken, attemptId, { signal: controller.signal })
      .then((res) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        setFetchState({ key: requestKey, status: 'loaded', result: res });
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
  }, [accessToken, attemptId, requestKey, seededResult]);

  // Fetch EP-PR02 feedback details for any FR review that is reviewed or not_evidence
  const frResultQuestions = (activeResult?.questions ?? []).filter(
    (q): q is QuizResultFreeResponseQuestionDTO => q.type === 'free_response',
  );

  const hasPendingReviews = frResultQuestions.some(
    (q) => q.review_status === 'pending',
  );

  const readyReviewIdsKey = Array.from(
    new Set([
      ...frResultQuestions
        .filter(
          (fr) =>
            Boolean(fr.practice_review_id) &&
            (fr.review_status === 'reviewed' ||
              fr.review_status === 'not_evidence'),
        )
        .map((fr) => fr.practice_review_id as string),
      ...polledReadyReviewIds,
    ]),
  )
    .sort()
    .join(',');

  // Dedicated ready-detail effect (attempt-scoped, never tied to the polling AbortController)
  useEffect(() => {
    if (!readyReviewIdsKey) {
      return;
    }
    const scope = `${accessToken}:${attemptId}`;
    const reviewIds = readyReviewIdsKey.split(',').filter(Boolean);
    for (const revId of reviewIds) {
      if (
        loadedReviewIdsRef.current.has(revId) ||
        inFlightReviewIdsRef.current.has(revId) ||
        failedFeedbackIdsRef.current.has(revId)
      ) {
        continue;
      }
      inFlightReviewIdsRef.current.add(revId);
      getPracticeReviewFeedback(accessToken, revId)
        .then((detail) => {
          if (!mountedRef.current || currentScopeRef.current !== scope) {
            return;
          }
          loadedReviewIdsRef.current.add(revId);
          failedFeedbackIdsRef.current.delete(revId);
          setFeedbackLoadErrorById((prev) => {
            if (!(revId in prev)) {
              return prev;
            }
            const next = { ...prev };
            delete next[revId];
            return next;
          });
          setFeedbackByReviewId((prev) => ({ ...prev, [revId]: detail }));
        })
        .catch((err) => {
          if (!mountedRef.current || currentScopeRef.current !== scope) {
            return;
          }
          failedFeedbackIdsRef.current.add(revId);
          setFeedbackLoadErrorById((prev) => ({
            ...prev,
            [revId]: mapApiError(err).message,
          }));
        })
        .finally(() => {
          inFlightReviewIdsRef.current.delete(revId);
        });
    }
  }, [accessToken, attemptId, feedbackRetryTick, readyReviewIdsKey]);

  const handleRetryFeedbackLoad = useCallback((reviewId: string) => {
    failedFeedbackIdsRef.current.delete(reviewId);
    setFeedbackLoadErrorById((prev) => {
      if (!(reviewId in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[reviewId];
      return next;
    });
    setFeedbackRetryTick((prev) => prev + 1);
  }, []);

  // Multi-FR polling: keep polling EP-PR01 + EP-Q06 independently while any FR review is still pending.
  // Never fetch EP-PR02 on the polling AbortController so the final poll stopping cannot abort detail fetches.
  useEffect(() => {
    if (!hasPendingReviews) {
      return;
    }
    let active = true;
    let pollInFlight = false;
    const controller = new AbortController();

    const timer = setInterval(async () => {
      if (!active || controller.signal.aborted || pollInFlight) {
        return;
      }
      pollInFlight = true;
      const pollEpoch = pollEpochRef.current;
      try {
        const [reviewsOutcome, resultOutcome] = await Promise.allSettled([
          listPracticeReviews(accessToken, attemptId, {
            signal: controller.signal,
          }),
          getQuizResult(accessToken, attemptId, {
            signal: controller.signal,
          }),
        ]);
        if (
          !active ||
          controller.signal.aborted ||
          pollEpoch !== pollEpochRef.current
        ) {
          return;
        }
        if (resultOutcome.status === 'fulfilled') {
          setLiveResultOverride({
            key: requestKey,
            result: resultOutcome.value,
          });
        }
        if (reviewsOutcome.status === 'fulfilled') {
          const newlyReady = reviewsOutcome.value
            .filter(
              (rev) =>
                rev.review_status === 'reviewed' ||
                rev.review_status === 'not_evidence',
            )
            .map((rev) => rev.id);
          if (newlyReady.length > 0) {
            setPolledReadyReviewIds((prev) => {
              const merged = new Set([...prev, ...newlyReady]);
              return merged.size === prev.length ? prev : Array.from(merged);
            });
          }
        }
      } finally {
        pollInFlight = false;
      }
    }, 3_000);

    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [accessToken, attemptId, hasPendingReviews, requestKey]);

  const handleRetryPracticeReview = useCallback(
    async (reviewId: string) => {
      if (retryingReviewId || !aiPracticeReviewEnabled) {
        return;
      }
      const capturedScope = currentScopeRef.current;
      const capturedRequestKey = requestKey;
      const seedBaseResult = activeResult;
      setRetryingReviewId(reviewId);
      setReviewErrorById((prev) => {
        const next = { ...prev };
        delete next[reviewId];
        return next;
      });

      try {
        const outcome = await retryPracticeReview(accessToken, reviewId);
        if (!mountedRef.current || currentScopeRef.current !== capturedScope) {
          return;
        }
        // Reject any in-flight poll snapshots started before this retry succeeded
        pollEpochRef.current += 1;
        if (isJobAcceptedDTO(outcome)) {
          loadedReviewIdsRef.current.delete(reviewId);
          failedFeedbackIdsRef.current.delete(reviewId);
          setFeedbackLoadErrorById((prev) => {
            if (!(reviewId in prev)) {
              return prev;
            }
            const next = { ...prev };
            delete next[reviewId];
            return next;
          });
          setPolledReadyReviewIds((prev) =>
            prev.filter((id) => id !== reviewId),
          );
          // Mark review as pending in local result so the polling loop picks it up
          setLiveResultOverride((prev) => {
            const base =
              prev && prev.key === capturedRequestKey
                ? prev.result
                : seedBaseResult;
            if (!base) {
              return prev;
            }
            return {
              key: capturedRequestKey,
              result: {
                ...base,
                questions: base.questions.map((q) =>
                  q.type === 'free_response' &&
                  q.practice_review_id === reviewId
                    ? { ...q, review_status: 'pending' }
                    : q,
                ),
              },
            };
          });
        } else {
          // 200 OK already reviewed
          loadedReviewIdsRef.current.add(reviewId);
          failedFeedbackIdsRef.current.delete(reviewId);
          setFeedbackLoadErrorById((prev) => {
            if (!(reviewId in prev)) {
              return prev;
            }
            const next = { ...prev };
            delete next[reviewId];
            return next;
          });
          setFeedbackByReviewId((prev) => ({ ...prev, [reviewId]: outcome }));
          setLiveResultOverride((prev) => {
            const base =
              prev && prev.key === capturedRequestKey
                ? prev.result
                : seedBaseResult;
            if (!base) {
              return prev;
            }
            return {
              key: capturedRequestKey,
              result: {
                ...base,
                questions: base.questions.map((q) =>
                  q.type === 'free_response' &&
                  q.practice_review_id === reviewId
                    ? { ...q, review_status: outcome.review_status }
                    : q,
                ),
              },
            };
          });
        }
      } catch (err) {
        if (!mountedRef.current || currentScopeRef.current !== capturedScope) {
          return;
        }
        const mapped = mapApiError(err);
        if (
          (err instanceof ApiError && err.statusCode === 410) ||
          mapped.code === 'RAW_RESPONSE_EXPIRED'
        ) {
          setExpiredReviewIds((prev) => ({ ...prev, [reviewId]: true }));
        }
        setReviewErrorById((prev) => ({
          ...prev,
          [reviewId]: mapped.message,
        }));
      } finally {
        if (mountedRef.current) {
          setRetryingReviewId((prev) => (prev === reviewId ? null : prev));
        }
      }
    },
    [
      accessToken,
      activeResult,
      aiPracticeReviewEnabled,
      requestKey,
      retryingReviewId,
    ],
  );

  const navigateToNewAttempt = useCallback(
    (newAttemptId: string) => {
      if (onNavigateAttempt) {
        onNavigateAttempt(newAttemptId);
      } else {
        router.push(`/quiz/${encodeURIComponent(newAttemptId)}`);
      }
    },
    [onNavigateAttempt, router],
  );

  const handleRetryQuiz = async () => {
    if (
      retryingQuiz ||
      !quizPracticeEnabled ||
      cooldownRemainingSeconds > 0 ||
      !activeResult?.retry_available
    ) {
      return;
    }
    const capturedScope = currentScopeRef.current;
    setRetryingQuizScope(capturedScope);
    setRetryQuizError(null);

    if (!retryIdemKeyRef.current) {
      retryIdemKeyRef.current = createIdempotencyKey();
    }
    const idemKey = retryIdemKeyRef.current;

    try {
      const outcome = await retryQuizAttempt(accessToken, attemptId, idemKey);
      retryIdemKeyRef.current = null;
      if (!mountedRef.current || currentScopeRef.current !== capturedScope) {
        return;
      }
      if (isJobAcceptedDTO(outcome)) {
        setRetryQuizJob(outcome);
      } else {
        navigateToNewAttempt(outcome.attempt_id);
      }
    } catch (err) {
      if (!mountedRef.current || currentScopeRef.current !== capturedScope) {
        return;
      }
      const mapped = mapApiError(err);
      if (
        (err instanceof ApiError &&
          (err.statusCode === 400 ||
            err.statusCode === 409 ||
            err.statusCode === 422 ||
            err.statusCode === 429)) ||
        (mapped.code && DETERMINISTIC_CLEAR_CODES.has(mapped.code))
      ) {
        retryIdemKeyRef.current = null;
      }
      if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
        const now = Date.now();
        setNowMs(now);
        setRetryCooldownUntilMs(now + mapped.retryAfterSeconds * 1_000);
      }
      setRetryQuizError(mapped);
    } finally {
      if (mountedRef.current) {
        setRetryingQuizScope((prev) => (prev === capturedScope ? null : prev));
      }
    }
  };

  const pollRetryQuizJob = useCallback(
    async (jobId: string, signal: AbortSignal): Promise<JobStatusDTO> => {
      return getJobStatus(accessToken, jobId, { signal });
    },
    [accessToken],
  );

  if (!activeResult && !loadError) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading quiz results"
        className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="h-6 w-1/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
        <div className="h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
      </section>
    );
  }

  if (!activeResult && loadError) {
    return (
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <Alert variant="error_retryable" role="alert">
          {loadError.message}
        </Alert>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setReloadTick((prev) => prev + 1)}
            className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
          >
            <RefreshCwIcon className="block h-4 w-4 shrink-0" />
            <span>Retry Loading Results</span>
          </Button>
        </div>
      </section>
    );
  }

  if (!activeResult) {
    return null;
  }

  const questionsById = new Map<string, QuizQuestionDTO>(
    questions.map((q) => [q.question_id, q]),
  );
  const savedById = new Map<string, SavedQuizAnswerDTO>(
    savedAnswers.map((a) => [a.question_id, a]),
  );
  const mcqResults = activeResult.questions.filter(
    (q): q is QuizResultMcqQuestionDTO => q.type === 'mcq',
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Top Summary Hero */}
      <section
        aria-label="Quiz completion summary"
        className="flex flex-col gap-5 rounded-2xl border border-teal-200/80 bg-white p-5 shadow-xs sm:p-6 dark:border-teal-900/60 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold leading-none text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200">
                <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0" />
                <span>Attempt #{activeResult.attempt_no} Submitted</span>
              </span>
              {planDayUnlocked && (
                <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold leading-none text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
                  {nextPlanDayNo !== null
                    ? `Day ${nextPlanDayNo} Unlocked`
                    : 'Daily Plan Day Completed'}
                </span>
              )}
              {activeResult.performance_level && (
                <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium leading-none text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {activeResult.performance_level === 'good'
                    ? 'Strong Practice Signal'
                    : 'Concepts to Reinforce'}
                </span>
              )}
            </div>
            <h2 className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100">
              Practice Quiz Summary
            </h2>
            <p className="text-body-sm text-slate-600 dark:text-slate-400">
              Your Daily Plan progress is saved. Review the explanations and
              rubric feedback below to strengthen your understanding.
            </p>
          </div>

          {/* MCQ Score Box (Formative indicator only — never a pass/fail threshold) */}
          <div className="flex shrink-0 flex-col items-start rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 sm:items-end dark:border-slate-800 dark:bg-slate-950/50">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Multiple Choice
            </span>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {activeResult.mcq_score.correct} / {activeResult.mcq_score.total}
            </p>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Questions answered correctly
            </span>
          </div>
        </div>

        {/* Level-Scoped Mastery Update Banner */}
        {activeResult.progress_change && (
          <div className="flex flex-col gap-3 rounded-xl border border-teal-200/70 bg-teal-50/50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-teal-900/60 dark:bg-teal-950/30">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-800 dark:text-teal-300">
                  Skill Mastery Updated ({activeResult.progress_change.career_level})
                </span>
                <SkillProgressBadge state={activeResult.progress_change.from} />
                <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
                <SkillProgressBadge state={activeResult.progress_change.to} />
              </div>
              <p className="text-body-sm text-slate-700 dark:text-slate-300">
                {activeResult.progress_change.reason}
              </p>
            </div>
            <Link href="/progress" className={masteryPrimaryLinkClass}>
              <TargetIcon className="block h-4 w-4 shrink-0" />
              <span>Skill Mastery</span>
            </Link>
          </div>
        )}

        {/* Improvement Recommendations */}
        {activeResult.improvement_recommendations.length > 0 && (
          <div className="space-y-1.5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Recommended Study Focus
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-body-sm text-slate-700 dark:text-slate-300">
              {activeResult.improvement_recommendations.map((rec, idx) => (
                <li key={idx} dir="auto">
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        )}

        {retryQuizError && (
          <Alert
            variant={
              retryQuizError.tone === 'warning' ? 'warning' : 'error_retryable'
            }
            role="alert"
            retryAfterSeconds={retryQuizError.retryAfterSeconds}
          >
            {retryQuizError.message}
          </Alert>
        )}

        {retryQuizJob && (
          <AILoadingState
            job={retryQuizJob}
            title="Preparing retry quiz variant"
            variant="inline_banner"
            accessToken={accessToken}
            pollJobStatus={pollRetryQuizJob}
            onJobSucceeded={(resultRef) => {
              setRetryQuizJob(null);
              if (resultRef?.id) {
                navigateToNewAttempt(resultRef.id);
              }
            }}
            onRetryJob={() => {
              setRetryQuizJob(null);
              void handleRetryQuiz();
            }}
          />
        )}

        {/* Navigation & Optional Single Retry Actions */}
        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center dark:border-slate-800">
          <Link href="/today" className={primaryLinkClass}>
            <BookOpenIcon className="block h-4 w-4 shrink-0" />
            <span>
              {planDayUnlocked ? 'Continue to Next Day' : "Today's Learning"}
            </span>
          </Link>

          {activeResult.retry_available && !retryQuizJob && (
            <Button
              type="button"
              variant="secondary"
              loading={retryingQuiz}
              loadingText="Starting Retry..."
              disabled={
                retryingQuiz ||
                !quizPracticeEnabled ||
                cooldownRemainingSeconds > 0
              }
              onClick={() => void handleRetryQuiz()}
              className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
            >
              <RefreshCwIcon className="block h-4 w-4 shrink-0" />
              <span>
                {cooldownRemainingSeconds > 0
                  ? `Retry Quiz (${cooldownRemainingSeconds}s)`
                  : 'Retry Quiz (1 Retry Available)'}
              </span>
            </Button>
          )}
        </div>
      </section>

      {/* AI Practice Review Section (Free-Response Questions) */}
      {frResultQuestions.length > 0 && (
        <section
          aria-labelledby="practice-reviews-heading"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="practice-reviews-heading"
              className="inline-flex items-center gap-2 text-heading-md font-semibold text-slate-900 dark:text-slate-100"
            >
              <SparklesIcon className="block h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <span>AI Practice Review Feedback</span>
            </h3>
            {hasPendingReviews && (
              <span className="text-xs font-medium text-sky-700 dark:text-sky-300">
                Auto-refreshing pending reviews...
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {frResultQuestions.map((fr, idx) => {
              const qMeta = questionsById.get(fr.question_id);
              const saved = savedById.get(fr.question_id);
              const resolvedUserAnswer =
                fr.user_answer !== undefined
                  ? fr.user_answer
                  : saved
                    ? saved.i_dont_know
                      ? null
                      : (saved.text ?? null)
                    : undefined;
              const revId = fr.practice_review_id;
              const feedback = revId ? feedbackByReviewId[revId] : null;
              return (
                <PracticeReviewCard
                  key={fr.question_id}
                  questionNumber={idx + 1}
                  questionPrompt={
                    qMeta?.prompt ?? `Free-Response Question #${idx + 1}`
                  }
                  userAnswer={resolvedUserAnswer}
                  explanation={fr.explanation ?? null}
                  reviewId={revId}
                  reviewStatus={fr.review_status}
                  feedback={feedback}
                  aiPracticeReviewEnabled={aiPracticeReviewEnabled}
                  retrying={retryingReviewId === revId}
                  retryErrorMessage={
                    revId ? (reviewErrorById[revId] ?? null) : null
                  }
                  feedbackLoadError={
                    revId ? (feedbackLoadErrorById[revId] ?? null) : null
                  }
                  isRawTextExpired={
                    revId ? Boolean(expiredReviewIds[revId]) : false
                  }
                  accessToken={accessToken}
                  questionId={fr.question_id}
                  questionReportable={fr.reportable}
                  onRetryReview={handleRetryPracticeReview}
                  onRetryFeedbackLoad={handleRetryFeedbackLoad}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Graded Multiple-Choice Question Breakdown */}
      {mcqResults.length > 0 && (
        <section
          aria-labelledby="mcq-review-heading"
          className="flex flex-col gap-4"
        >
          <h3
            id="mcq-review-heading"
            className="text-heading-md font-semibold text-slate-900 dark:text-slate-100"
          >
            Multiple-Choice Review ({mcqResults.length})
          </h3>
          <div className="flex flex-col gap-4">
            {mcqResults.map((mcq, idx) => {
              const qMeta = questionsById.get(mcq.question_id) ?? {
                question_id: mcq.question_id,
                type: 'mcq' as const,
                difficulty: 'application' as const,
                prompt: `Question ${idx + 1}`,
                options: [
                  {
                    option_id: mcq.correct_answer,
                    text: `Option ${mcq.correct_answer.toUpperCase()}`,
                  },
                ],
                response_hint: null,
                max_length: null,
                allow_i_dont_know: true,
              };
              const saved = savedById.get(mcq.question_id);
              return (
                <QuizCard
                  key={mcq.question_id}
                  question={qMeta}
                  questionNumber={idx + 1}
                  totalQuestions={mcqResults.length}
                  gradedMcqResult={mcq}
                  submittedIDontKnow={Boolean(saved?.i_dont_know)}
                  accessToken={accessToken}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
