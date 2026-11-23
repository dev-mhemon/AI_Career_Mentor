'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  createIdempotencyKey,
  getQuizAttempt,
  patchQuizAnswers,
  startQuizAttempt,
  submitQuizAttempt,
  type QuizAnswerInputDTO,
  type QuizAttemptDTO,
  type QuizResultDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  BookOpenIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  RefreshCwIcon,
  SparklesIcon,
} from '@/components/ui/icons';
import { ConfirmUnansweredModal } from './confirm-unanswered-modal';
import { QuizCard, type QuizDraftAnswer } from './quiz-card';
import { QuizResultView } from './quiz-result-view';

export interface QuizSessionViewProps {
  accessToken: string;
  attemptId: string;
  initialAttempt?: QuizAttemptDTO | null;
  initialResult?: QuizResultDTO | null;
  quizPracticeEnabled?: boolean;
  aiPracticeReviewEnabled?: boolean;
}

const STORAGE_KEY_PREFIX = 'agy_quiz_draft_v1:';
const AUTOSAVE_DEBOUNCE_MS = 900;

const DETERMINISTIC_SUBMIT_CLEAR_CODES = new Set([
  'INVALID_FORMAT',
  'VALIDATION_FAILED',
  'NO_ANSWERS_SUBMITTED',
  'UNANSWERED_CONFIRMATION_REQUIRED',
  'QUESTION_NOT_IN_QUIZ',
  'QUIZ_NOT_STARTED',
  'QUIZ_ALREADY_SUBMITTED',
  'FEATURE_DISABLED',
  'RATE_LIMIT_EXCEEDED',
]);

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-label-md font-medium leading-none text-slate-700 shadow-2xs transition-colors duration-(--duration-fast) ease-standard hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto';

function buildInitialDraftMap(
  attempt: QuizAttemptDTO | null,
): Record<string, QuizDraftAnswer> {
  const map: Record<string, QuizDraftAnswer> = {};
  if (!attempt) {
    return map;
  }
  for (const saved of attempt.saved_answers ?? []) {
    map[saved.question_id] = {
      selected_option_id: saved.selected_option_id ?? null,
      text: saved.text ?? null,
      i_dont_know: Boolean(saved.i_dont_know),
    };
  }
  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(
        `${STORAGE_KEY_PREFIX}${attempt.attempt_id}`,
      );
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, QuizDraftAnswer>;
        if (parsed && typeof parsed === 'object') {
          for (const q of attempt.questions) {
            const entry = parsed[q.question_id];
            if (entry && typeof entry === 'object') {
              map[q.question_id] = {
                selected_option_id:
                  typeof entry.selected_option_id === 'string'
                    ? entry.selected_option_id
                    : null,
                text: typeof entry.text === 'string' ? entry.text : null,
                i_dont_know: Boolean(entry.i_dont_know),
              };
            }
          }
        }
      }
    } catch {
      // Ignore storage access errors
    }
  }
  return map;
}

function isQuestionAnswered(draft: QuizDraftAnswer | undefined): boolean {
  if (!draft) {
    return false;
  }
  if (draft.i_dont_know) {
    return true;
  }
  if (
    typeof draft.selected_option_id === 'string' &&
    draft.selected_option_id.trim().length > 0
  ) {
    return true;
  }
  if (typeof draft.text === 'string' && draft.text.trim().length > 0) {
    return true;
  }
  return false;
}

function toAnswerInputDTO(
  questionId: string,
  draft: QuizDraftAnswer,
): QuizAnswerInputDTO {
  if (draft.i_dont_know) {
    return {
      question_id: questionId,
      i_dont_know: true,
    };
  }
  if (
    typeof draft.selected_option_id === 'string' &&
    draft.selected_option_id.trim().length > 0
  ) {
    return {
      question_id: questionId,
      selected_option_id: draft.selected_option_id.trim(),
    };
  }
  return {
    question_id: questionId,
    text: draft.text ?? '',
  };
}

/**
 * Screen 18 (`/quiz/[attemptId]`): Interactive Practice Quiz Session & Graded Results (`EP-Q02`–`EP-Q07`).
 */
export function QuizSessionView({
  accessToken,
  attemptId: initialAttemptId,
  initialAttempt = null,
  initialResult = null,
  quizPracticeEnabled = true,
  aiPracticeReviewEnabled = true,
}: QuizSessionViewProps) {
  const router = useRouter();
  const [activeAttemptId, setActiveAttemptId] =
    useState<string>(initialAttemptId);
  const [reloadTick, setReloadTick] = useState(0);
  const [attemptState, setAttemptState] = useState<{
    id: string;
    attempt: QuizAttemptDTO;
  } | null>(
    initialAttempt ? { id: initialAttemptId, attempt: initialAttempt } : null,
  );
  const [loadErrorState, setLoadErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);

  const attemptRequestKey = `${accessToken}:${activeAttemptId}:${reloadTick}`;
  const loadError =
    loadErrorState && loadErrorState.key === attemptRequestKey
      ? loadErrorState.error
      : null;

  const activeAttempt =
    attemptState && attemptState.id === activeAttemptId
      ? attemptState.attempt
      : activeAttemptId === initialAttemptId
        ? initialAttempt
        : null;

  const [draftsByAttempt, setDraftsByAttempt] = useState<{
    attemptId: string;
    answers: Record<string, QuizDraftAnswer>;
  }>(() => ({
    attemptId: initialAttemptId,
    answers: buildInitialDraftMap(initialAttempt),
  }));

  const [startingQuiz, setStartingQuiz] = useState(false);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [confirmUnansweredOpen, setConfirmUnansweredOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error_backed_up' | 'error_unsaved'
  >('idle');
  const [unlockSummary, setUnlockSummary] = useState<{
    planDayUnlocked: boolean;
    nextPlanDayNo: number | null;
  } | null>(null);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const requestGenRef = useRef(0);
  const autosaveGenRef = useRef(0);
  const autosaveInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const activeAttemptIdRef = useRef(activeAttemptId);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchIdsRef = useRef<Set<string>>(new Set());
  const localBackupOkRef = useRef(true);
  const draftsRef = useRef<{
    attemptId: string;
    answers: Record<string, QuizDraftAnswer>;
  }>(draftsByAttempt);
  const submitIdemKeyRef = useRef<string | null>(null);
  const flushAutosaveRef = useRef<
    (
      targetAttemptId: string,
      answersSnapshot?: Record<string, QuizDraftAnswer>,
    ) => Promise<void>
  >(async () => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeAttemptIdRef.current = activeAttemptId;
  }, [activeAttemptId]);

  // Cooldown ticker
  useEffect(() => {
    if (cooldownUntilMs <= Date.now()) {
      return;
    }
    const timer = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= cooldownUntilMs) {
        clearInterval(timer);
      }
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldownUntilMs]);

  const cooldownRemainingSeconds =
    cooldownUntilMs > nowMs ? Math.ceil((cooldownUntilMs - nowMs) / 1_000) : 0;

  const shouldUseSeededAttempt =
    initialAttempt !== null &&
    activeAttemptId === initialAttemptId &&
    reloadTick === 0;

  // Fetch EP-Q02 when attempt is not seeded, when switching to attempt 2, or when Try Again increments reloadTick.
  // Never depend on activeAttempt/attemptState so Try Again cannot trigger an infinite reload loop.
  useEffect(() => {
    if (shouldUseSeededAttempt) {
      return;
    }
    const gen = ++requestGenRef.current;
    const controller = new AbortController();

    getQuizAttempt(accessToken, activeAttemptId, { signal: controller.signal })
      .then((loaded) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        const initialDrafts = buildInitialDraftMap(loaded);
        draftsRef.current = {
          attemptId: activeAttemptId,
          answers: initialDrafts,
        };
        setAttemptState({ id: activeAttemptId, attempt: loaded });
        setDraftsByAttempt({
          attemptId: activeAttemptId,
          answers: initialDrafts,
        });
        setLoadErrorState(null);
      })
      .catch((err) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        setLoadErrorState({
          key: attemptRequestKey,
          error: mapApiError(err),
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    accessToken,
    activeAttemptId,
    attemptRequestKey,
    reloadTick,
    shouldUseSeededAttempt,
  ]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  const currentAnswers: Record<string, QuizDraftAnswer> = useMemo(() => {
    if (draftsByAttempt.attemptId === activeAttemptId) {
      return draftsByAttempt.answers;
    }
    return buildInitialDraftMap(activeAttempt);
  }, [activeAttempt, activeAttemptId, draftsByAttempt]);

  const flushAutosave = useCallback(
    async (
      targetAttemptId: string,
      answersSnapshot?: Record<string, QuizDraftAnswer>,
    ) => {
      if (
        !quizPracticeEnabled ||
        !mountedRef.current ||
        activeAttemptIdRef.current !== targetAttemptId ||
        autosaveInFlightRef.current
      ) {
        return;
      }
      autosaveInFlightRef.current = true;
      let retryAfterFailureWithNewerEdits = false;
      try {
        while (
          mountedRef.current &&
          activeAttemptIdRef.current === targetAttemptId &&
          pendingPatchIdsRef.current.size > 0
        ) {
          if (autosaveTimerRef.current) {
            clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
          }
          const snapshot =
            draftsRef.current.attemptId === targetAttemptId
              ? draftsRef.current.answers
              : (answersSnapshot ?? {});
          const dirtyIds = Array.from(pendingPatchIdsRef.current);
          const sentDraftById = new Map<string, QuizDraftAnswer>();
          const payloadItems: QuizAnswerInputDTO[] = [];
          for (const qId of dirtyIds) {
            const draft = snapshot[qId];
            if (draft && isQuestionAnswered(draft)) {
              payloadItems.push(toAnswerInputDTO(qId, draft));
              sentDraftById.set(qId, draft);
            } else {
              pendingPatchIdsRef.current.delete(qId);
            }
          }
          if (payloadItems.length === 0) {
            break;
          }
          const gen = ++autosaveGenRef.current;
          setAutosaveStatus('saving');
          try {
            await patchQuizAnswers(accessToken, targetAttemptId, {
              answers: payloadItems,
            });
            // Clear acknowledged dirty IDs only if they were not edited again while PATCH was in flight
            const latestAnswers =
              draftsRef.current.attemptId === targetAttemptId
                ? draftsRef.current.answers
                : {};
            for (const [qId, sentDraft] of sentDraftById.entries()) {
              const current = latestAnswers[qId];
              if (
                current &&
                current.selected_option_id === sentDraft.selected_option_id &&
                current.text === sentDraft.text &&
                current.i_dont_know === sentDraft.i_dont_know
              ) {
                pendingPatchIdsRef.current.delete(qId);
              }
            }
            if (
              mountedRef.current &&
              activeAttemptIdRef.current === targetAttemptId &&
              gen === autosaveGenRef.current
            ) {
              setAutosaveStatus('saved');
            }
          } catch {
            // Detect whether newer edits were queued while this failed PATCH was in flight
            const latestAnswers =
              draftsRef.current.attemptId === targetAttemptId
                ? draftsRef.current.answers
                : {};
            for (const qId of pendingPatchIdsRef.current) {
              if (!sentDraftById.has(qId)) {
                retryAfterFailureWithNewerEdits = true;
                break;
              }
            }
            if (!retryAfterFailureWithNewerEdits) {
              for (const [qId, sentDraft] of sentDraftById.entries()) {
                const current = latestAnswers[qId];
                if (
                  current &&
                  (current.selected_option_id !==
                    sentDraft.selected_option_id ||
                    current.text !== sentDraft.text ||
                    current.i_dont_know !== sentDraft.i_dont_know)
                ) {
                  retryAfterFailureWithNewerEdits = true;
                  break;
                }
              }
            }
            // Keep failed question IDs in pendingPatchIdsRef so the next save retries them
            for (const qId of sentDraftById.keys()) {
              pendingPatchIdsRef.current.add(qId);
            }
            if (
              mountedRef.current &&
              activeAttemptIdRef.current === targetAttemptId &&
              gen === autosaveGenRef.current
            ) {
              setAutosaveStatus(
                localBackupOkRef.current ? 'error_backed_up' : 'error_unsaved',
              );
            }
            break;
          }
        }
      } finally {
        autosaveInFlightRef.current = false;
        if (
          retryAfterFailureWithNewerEdits &&
          mountedRef.current &&
          activeAttemptIdRef.current === targetAttemptId &&
          pendingPatchIdsRef.current.size > 0 &&
          !autosaveTimerRef.current
        ) {
          autosaveTimerRef.current = setTimeout(() => {
            autosaveTimerRef.current = null;
            void flushAutosaveRef.current(targetAttemptId);
          }, 2_000);
        }
      }
    },
    [accessToken, quizPracticeEnabled],
  );

  useEffect(() => {
    flushAutosaveRef.current = flushAutosave;
  }, [flushAutosave]);

  const scheduleAutosave = useCallback(
    (
      targetAttemptId: string,
      answersSnapshot: Record<string, QuizDraftAnswer>,
    ) => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = setTimeout(() => {
        autosaveTimerRef.current = null;
        void flushAutosave(targetAttemptId, answersSnapshot);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushAutosave],
  );

  const updateQuestionDraft = useCallback(
    (
      questionId: string,
      updater: (prev: QuizDraftAnswer | undefined) => QuizDraftAnswer,
    ) => {
      setActionError(null);
      const base =
        draftsRef.current.attemptId === activeAttemptId
          ? draftsRef.current.answers
          : buildInitialDraftMap(activeAttempt);
      const nextAnswer = updater(base[questionId]);
      const nextMap = { ...base, [questionId]: nextAnswer };
      draftsRef.current = {
        attemptId: activeAttemptId,
        answers: nextMap,
      };

      // Pure state update (zero side effects inside setDraftsByAttempt)
      setDraftsByAttempt({
        attemptId: activeAttemptId,
        answers: nextMap,
      });

      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(
            `${STORAGE_KEY_PREFIX}${activeAttemptId}`,
            JSON.stringify(nextMap),
          );
          localBackupOkRef.current = true;
        } catch {
          localBackupOkRef.current = false;
        }
      }

      if (activeAttempt?.status === 'started' && quizPracticeEnabled) {
        pendingPatchIdsRef.current.add(questionId);
        scheduleAutosave(activeAttemptId, nextMap);
      }
    },
    [activeAttempt, activeAttemptId, quizPracticeEnabled, scheduleAutosave],
  );

  const handleStartQuiz = async () => {
    if (!activeAttempt || startingQuiz || !quizPracticeEnabled) {
      return;
    }
    setStartingQuiz(true);
    setActionError(null);
    try {
      const started = await startQuizAttempt(accessToken, activeAttemptId);
      setAttemptState({ id: activeAttemptId, attempt: started });
    } catch (err) {
      setActionError(mapApiError(err));
    } finally {
      setStartingQuiz(false);
    }
  };

  const scrollToQuestion = useCallback((questionId: string) => {
    setMobileNavOpen(false);
    if (typeof document === 'undefined') {
      return;
    }
    const target = document.getElementById(`quiz-q-${questionId}`);
    if (target) {
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    }
  }, []);

  const questions = activeAttempt?.questions ?? [];
  const answeredCount = questions.filter((q) =>
    isQuestionAnswered(currentAnswers[q.question_id]),
  ).length;
  const unansweredCount = Math.max(0, questions.length - answeredCount);
  const progressPct =
    questions.length > 0
      ? Math.round((answeredCount / questions.length) * 100)
      : 0;

  const executeQuizSubmit = async (confirmUnanswered: boolean) => {
    if (
      !activeAttempt ||
      submittingQuiz ||
      !quizPracticeEnabled ||
      cooldownRemainingSeconds > 0
    ) {
      return;
    }

    const answerList: QuizAnswerInputDTO[] = [];
    for (const q of questions) {
      const draft = currentAnswers[q.question_id];
      if (draft && isQuestionAnswered(draft)) {
        answerList.push(toAnswerInputDTO(q.question_id, draft));
      }
    }

    if (answerList.length === 0) {
      setConfirmUnansweredOpen(false);
      setActionError({
        message:
          'Answer at least one question—or select "I don’t know"—before submitting the quiz.',
        tone: 'warning',
        status: 422,
        code: 'NO_ANSWERS_SUBMITTED',
        fieldErrors: {},
        retryAfterSeconds: null,
        retryable: false,
        requiresSignIn: false,
      });
      return;
    }

    if (!confirmUnanswered && unansweredCount > 0) {
      setConfirmUnansweredOpen(true);
      return;
    }

    // Pause autosave only once submission is confirmed; keep pendingPatchIdsRef until submit succeeds
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    setSubmittingQuiz(true);
    setActionError(null);

    if (!submitIdemKeyRef.current) {
      submitIdemKeyRef.current = createIdempotencyKey();
    }
    const idemKey = submitIdemKeyRef.current;

    try {
      const submitRes = await submitQuizAttempt(
        accessToken,
        activeAttemptId,
        {
          answers: answerList,
          ...(confirmUnanswered ? { confirm_unanswered: true } : {}),
        },
        idemKey,
      );
      submitIdemKeyRef.current = null;
      pendingPatchIdsRef.current.clear();
      setConfirmUnansweredOpen(false);
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(
            `${STORAGE_KEY_PREFIX}${activeAttemptId}`,
          );
        } catch {
          // Ignore storage error
        }
      }
      setUnlockSummary({
        planDayUnlocked: submitRes.plan_day_unlocked,
        nextPlanDayNo: submitRes.next_plan_day_no,
      });
      setAttemptState((prev) =>
        prev
          ? {
              ...prev,
              attempt: {
                ...prev.attempt,
                status: submitRes.status,
                submitted_at: new Date().toISOString(),
              },
            }
          : prev,
      );
    } catch (err) {
      const mapped = mapApiError(err);
      if (
        (err instanceof ApiError &&
          (err.statusCode === 400 ||
            err.statusCode === 409 ||
            err.statusCode === 422 ||
            err.statusCode === 429)) ||
        (mapped.code && DETERMINISTIC_SUBMIT_CLEAR_CODES.has(mapped.code))
      ) {
        submitIdemKeyRef.current = null;
      }
      if (mapped.code === 'UNANSWERED_CONFIRMATION_REQUIRED') {
        setConfirmUnansweredOpen(true);
      } else if (mapped.code === 'QUIZ_ALREADY_SUBMITTED') {
        setConfirmUnansweredOpen(false);
        pendingPatchIdsRef.current.clear();
        setAttemptState((prev) =>
          prev
            ? {
                ...prev,
                attempt: {
                  ...prev.attempt,
                  status: 'submitted',
                },
              }
            : prev,
        );
      } else {
        setConfirmUnansweredOpen(false);
        if (mapped.retryAfterSeconds && mapped.retryAfterSeconds > 0) {
          const now = Date.now();
          setNowMs(now);
          setCooldownUntilMs(now + mapped.retryAfterSeconds * 1_000);
        }
        setActionError(mapped);
        // Resume autosave for unsaved edits when submit fails
        if (
          pendingPatchIdsRef.current.size > 0 &&
          activeAttempt.status === 'started' &&
          quizPracticeEnabled
        ) {
          const latestSnapshot =
            draftsRef.current.attemptId === activeAttemptId
              ? draftsRef.current.answers
              : currentAnswers;
          scheduleAutosave(activeAttemptId, latestSnapshot);
        }
      }
    } finally {
      setSubmittingQuiz(false);
    }
  };

  const isSubmittedStatus =
    activeAttempt?.status === 'submitted' ||
    activeAttempt?.status === 'ai_reviewed' ||
    activeAttempt?.status === 'feedback_available';

  const mcqCount = questions.filter((q) => q.type === 'mcq').length;
  const frCount = questions.filter((q) => q.type === 'free_response').length;
  const topicTitle =
    (activeAttempt?.topic_title ?? initialResult?.topic_title ?? '').trim() ||
    null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Sticky Header & Breadcrumb (pinned cleanly below the h-16 AppShell top header) */}
      <header className="sticky top-16 z-20 -mx-4 flex flex-col gap-3 border-b border-slate-200/80 bg-surface-canvas/95 px-4 py-3.5 backdrop-blur-xs sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:-mx-8 lg:px-8 dark:border-slate-800">
        <div className="min-w-0">
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"
          >
            <Link
              href="/dashboard"
              className="inline-flex items-center leading-none transition-colors hover:text-slate-800 dark:hover:text-slate-200"
            >
              Dashboard
            </Link>
            <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
            <Link
              href="/daily-plan"
              className="inline-flex items-center leading-none transition-colors hover:text-slate-800 dark:hover:text-slate-200"
            >
              Daily Plan
            </Link>
            {topicTitle && (
              <>
                <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span
                  dir="auto"
                  title={topicTitle}
                  className="inline-flex max-w-[14rem] items-center truncate leading-none text-slate-600 sm:max-w-[22rem] dark:text-slate-300"
                >
                  {topicTitle}
                </span>
              </>
            )}
            <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="inline-flex items-center leading-none text-slate-700 dark:text-slate-200">
              Practice Quiz
            </span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-heading-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Practice Quiz
            </h1>
            {activeAttempt && (
              <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 font-mono text-xs font-semibold leading-none tabular-nums text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200">
                Attempt #{activeAttempt.attempt_no} ·{' '}
                {activeAttempt.career_level.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Link href="/today" className={secondaryLinkClass}>
            <BookOpenIcon className="block h-4 w-4 shrink-0" />
            <span>Today&apos;s Learning</span>
          </Link>
          <Link href="/daily-plan" className={secondaryLinkClass}>
            <CalendarDaysIcon className="block h-4 w-4 shrink-0" />
            <span>Daily Plan</span>
          </Link>
        </div>
      </header>

      {!quizPracticeEnabled && !isSubmittedStatus && (
        <Alert
          variant="info"
          role="status"
          title="Practice Quiz submissions are temporarily paused"
        >
          You can review existing quiz attempts and study guides while quiz
          submissions are paused.
        </Alert>
      )}

      {/* Loading Skeleton */}
      {!activeAttempt && !loadError && (
        <section
          aria-busy="true"
          aria-label="Loading quiz attempt"
          className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="h-6 w-1/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-full rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-4/5 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
        </section>
      )}

      {/* Load Error */}
      {!activeAttempt && loadError && (
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
              <span>Try Again</span>
            </Button>
          </div>
        </section>
      )}

      {/* State 1: Generated (Start Quiz Intro Card) */}
      {activeAttempt && activeAttempt.status === 'generated' && (
        <section
          aria-labelledby="quiz-start-heading"
          className="flex flex-col items-start gap-5 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-300">
            <SparklesIcon className="block h-6 w-6 shrink-0" />
          </span>
          <div className="space-y-2">
            <h2
              id="quiz-start-heading"
              className="text-heading-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Ready to begin your Practice Quiz
            </h2>
            <p className="max-w-2xl text-body-sm text-slate-600 dark:text-slate-400">
              Submitting this practice quiz completes today&apos;s sequential
              study unit and unlocks your next Daily Plan day. There is no
              pass/fail penalty—focus on honest recall and clear technical
              reasoning.
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Multiple Choice
              </span>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {mcqCount} {mcqCount === 1 ? 'Question' : 'Questions'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Free Response
              </span>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {frCount} {frCount === 1 ? 'Question' : 'Questions'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Autosave &amp; Retry
              </span>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Live draft save · 1 Retry
              </p>
            </div>
          </div>

          {actionError && (
            <Alert variant="error_retryable" role="alert">
              {actionError.message}
            </Alert>
          )}

          <div className="flex w-full flex-col gap-2.5 pt-1 sm:w-auto sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="primary"
              loading={startingQuiz}
              loadingText="Starting Quiz..."
              disabled={startingQuiz || !quizPracticeEnabled}
              onClick={() => void handleStartQuiz()}
              className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
            >
              <BookOpenIcon className="block h-4 w-4 shrink-0" />
              <span>Start Practice Quiz</span>
            </Button>
          </div>
        </section>
      )}

      {/* State 2: Started (Active Quiz Taking Session) */}
      {activeAttempt && activeAttempt.status === 'started' && (
        <div className="flex flex-col gap-5">
          {actionError && (
            <Alert
              variant={
                actionError.tone === 'warning' ? 'warning' : 'error_retryable'
              }
              role="alert"
              retryAfterSeconds={actionError.retryAfterSeconds}
            >
              {actionError.message}
            </Alert>
          )}

          <div
            data-testid="quiz-started-grid"
            className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start"
          >
            {/* Unified Sticky Progress & Question Navigator:
                - Mobile/Tablet (<lg): order-1 sticky top-36 z-20 compact bar with expandable Jump grid
                - Desktop (lg+): order-2 lg:col-span-4 lg:sticky lg:top-40 right navigator panel */}
            <aside
              aria-label="Quiz progress and question navigator"
              className="order-1 sticky top-36 z-20 flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-xs backdrop-blur-xs sm:p-5 lg:order-2 lg:top-40 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900/95"
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {answeredCount} of {questions.length} answered (
                    {progressPct}%)
                  </span>
                  <span
                    aria-live="polite"
                    className="inline-flex items-center gap-1.5 text-xs leading-none text-slate-500 dark:text-slate-400"
                  >
                    {autosaveStatus === 'saving' && (
                      <>
                        <ClockIcon className="block h-3.5 w-3.5 shrink-0 text-teal-600" />
                        <span>Saving draft...</span>
                      </>
                    )}
                    {autosaveStatus === 'saved' && (
                      <>
                        <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>Saved just now</span>
                      </>
                    )}
                    {autosaveStatus === 'error_backed_up' && (
                      <span>Draft backed up locally</span>
                    )}
                    {autosaveStatus === 'error_unsaved' && (
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        Could not save draft — check connection
                      </span>
                    )}
                  </span>
                </div>

                <div
                  role="progressbar"
                  aria-label="Questions answered"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                >
                  <div
                    className="h-full rounded-full bg-teal-600 transition-all duration-300 dark:bg-teal-400"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Mobile Jump Toggle + Submit Row (<lg) & Desktop Full-Width Submit (lg+) */}
              <div className="flex items-center justify-between gap-2 lg:hidden">
                <button
                  type="button"
                  aria-expanded={mobileNavOpen}
                  aria-controls="quiz-question-navigator"
                  onClick={() => setMobileNavOpen((prev) => !prev)}
                  className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold leading-none text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span>Jump ({answeredCount}/{questions.length})</span>
                  <ChevronDownIcon
                    className={cn(
                      'block h-3.5 w-3.5 shrink-0 transition-transform',
                      mobileNavOpen ? 'rotate-180' : '',
                    )}
                  />
                </button>
              </div>

              {/* Clickable 1..N Question Navigator Grid (always visible on lg+, toggleable on <lg) */}
              <div
                id="quiz-question-navigator"
                className={cn(
                  mobileNavOpen ? 'flex' : 'hidden',
                  'flex-col gap-3 border-t border-slate-100 pt-3.5 lg:flex dark:border-slate-800',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Question Navigator
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Click to jump
                  </span>
                </div>

                <div
                  role="navigation"
                  aria-label="Quiz questions"
                  className="grid grid-cols-5 gap-2"
                >
                  {questions.map((q, idx) => {
                    const answered = isQuestionAnswered(
                      currentAnswers[q.question_id],
                    );
                    const isFr = q.type === 'free_response';
                    return (
                      <button
                        key={q.question_id}
                        type="button"
                        aria-label={`Question ${idx + 1} (${answered ? 'Answered' : 'Unanswered'})`}
                        onClick={() => scrollToQuestion(q.question_id)}
                        className={cn(
                          'relative mx-auto flex h-10 w-10 shrink-0 cursor-pointer flex-col items-center justify-center rounded-full border font-mono text-xs font-semibold leading-none tabular-nums transition-colors',
                          isFr
                            ? answered
                              ? 'border-indigo-600 bg-indigo-600 text-white shadow-2xs hover:bg-indigo-700 dark:border-indigo-500 dark:bg-indigo-500 dark:text-white'
                              : 'border-indigo-200 bg-indigo-50/60 text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100/60 dark:border-indigo-800/80 dark:bg-indigo-950/50 dark:text-indigo-200 dark:hover:border-indigo-500'
                            : answered
                              ? 'border-teal-600 bg-teal-600 text-white shadow-2xs hover:bg-teal-700 dark:border-teal-500 dark:bg-teal-500 dark:text-slate-950'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-500',
                        )}
                      >
                        <span>{idx + 1}</span>
                        {isFr && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              'mt-0.5 text-[8px] font-bold uppercase leading-none',
                              answered
                                ? 'text-indigo-100'
                                : 'text-indigo-600 dark:text-indigo-300',
                            )}
                          >
                            FR
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Compact Legend */}
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5 leading-none">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-500"
                    />
                    <span>MCQ Answered</span>
                  </span>
                  {frCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 leading-none">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-600 dark:bg-indigo-500"
                      />
                      <span>FR Answered</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 leading-none">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                    />
                    <span>Unanswered</span>
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="primary"
                loading={submittingQuiz}
                loadingText="Submitting Quiz..."
                disabled={
                  submittingQuiz ||
                  !quizPracticeEnabled ||
                  cooldownRemainingSeconds > 0
                }
                onClick={() => void executeQuizSubmit(false)}
                className="w-full shrink-0 justify-center whitespace-nowrap"
              >
                <CheckCircleIcon className="block h-4 w-4 shrink-0" />
                <span>
                  {cooldownRemainingSeconds > 0
                    ? `Submit Quiz (${cooldownRemainingSeconds}s)`
                    : 'Submit Quiz'}
                </span>
              </Button>
            </aside>

            {/* Left Main Column: Question Cards List + Bottom Submit Bar */}
            <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1 lg:col-span-8">
              {questions.map((question, idx) => (
                <QuizCard
                  key={question.question_id}
                  id={`quiz-q-${question.question_id}`}
                  question={question}
                  questionNumber={idx + 1}
                  totalQuestions={questions.length}
                  draftAnswer={currentAnswers[question.question_id]}
                  disabled={submittingQuiz || !quizPracticeEnabled}
                  onSelectOption={(optionId) => {
                    updateQuestionDraft(question.question_id, () => ({
                      selected_option_id: optionId,
                      text: null,
                      i_dont_know: false,
                    }));
                  }}
                  onChangeText={(text) => {
                    updateQuestionDraft(question.question_id, () => ({
                      selected_option_id: null,
                      text,
                      i_dont_know: false,
                    }));
                  }}
                  onToggleIDontKnow={(checked) => {
                    updateQuestionDraft(question.question_id, (prev) => ({
                      selected_option_id: checked
                        ? null
                        : (prev?.selected_option_id ?? null),
                      text: checked ? null : (prev?.text ?? null),
                      i_dont_know: checked,
                    }));
                  }}
                />
              ))}

              {/* Bottom Submit Bar */}
              <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
                <div className="text-body-sm text-slate-600 dark:text-slate-400">
                  {unansweredCount === 0
                    ? 'All questions have a response. Ready to submit!'
                    : `${unansweredCount} of ${questions.length} ${unansweredCount === 1 ? 'question is' : 'questions are'} still unanswered.`}
                </div>
                <Button
                  type="button"
                  variant="primary"
                  loading={submittingQuiz}
                  loadingText="Submitting Quiz..."
                  disabled={
                    submittingQuiz ||
                    !quizPracticeEnabled ||
                    cooldownRemainingSeconds > 0
                  }
                  onClick={() => void executeQuizSubmit(false)}
                  className="w-full shrink-0 justify-center whitespace-nowrap sm:w-auto"
                >
                  <CheckCircleIcon className="block h-4 w-4 shrink-0" />
                  <span>
                    {cooldownRemainingSeconds > 0
                      ? `Submit Quiz (${cooldownRemainingSeconds}s)`
                      : 'Submit Practice Quiz'}
                  </span>
                </Button>
              </section>
            </div>
          </div>

          <ConfirmUnansweredModal
            open={confirmUnansweredOpen}
            unansweredCount={Math.max(1, unansweredCount)}
            totalCount={questions.length}
            submitting={submittingQuiz}
            onClose={() => setConfirmUnansweredOpen(false)}
            onConfirmSubmit={() => void executeQuizSubmit(true)}
          />
        </div>
      )}

      {/* State 3: Submitted / Feedback Available (Graded Results & Rubric Feedback) */}
      {activeAttempt && isSubmittedStatus && (
        <QuizResultView
          accessToken={accessToken}
          attemptId={activeAttemptId}
          questions={activeAttempt.questions}
          savedAnswers={activeAttempt.saved_answers}
          initialResult={
            activeAttemptId === initialAttemptId ? initialResult : null
          }
          planDayUnlocked={unlockSummary?.planDayUnlocked ?? false}
          nextPlanDayNo={unlockSummary?.nextPlanDayNo ?? null}
          quizPracticeEnabled={quizPracticeEnabled}
          aiPracticeReviewEnabled={aiPracticeReviewEnabled}
          onNavigateAttempt={(newId) => {
            setUnlockSummary(null);
            setActionError(null);
            setActiveAttemptId(newId);
            router.push(`/quiz/${encodeURIComponent(newId)}`);
          }}
        />
      )}
    </main>
  );
}
