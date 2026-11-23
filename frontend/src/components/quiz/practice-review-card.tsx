'use client';

import type {
  PerformanceLevel,
  PracticeFeedbackDTO,
  ReviewDimensionScore,
  ReviewStatus,
} from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  InfoIcon,
  RefreshCwIcon,
  SparklesIcon,
  SpinnerIcon,
} from '@/components/ui/icons';

export interface PracticeReviewCardProps {
  questionNumber: number;
  questionPrompt: string;
  userAnswer?: string | null;
  explanation?: string | null;
  reviewId: string | null;
  reviewStatus: ReviewStatus;
  feedback?: PracticeFeedbackDTO | null;
  aiPracticeReviewEnabled?: boolean;
  retrying?: boolean;
  retryErrorMessage?: string | null;
  feedbackLoadError?: string | null;
  isRawTextExpired?: boolean;
  onRetryReview?: (reviewId: string) => void;
  onRetryFeedbackLoad?: (reviewId: string) => void;
  className?: string;
}

const STATUS_BADGE: Record<
  ReviewStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'AI Review Pending',
    className:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200',
  },
  reviewed: {
    label: 'AI Reviewed',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200',
  },
  not_evidence: {
    label: 'Not Counted as Evidence',
    className:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  failed: {
    label: 'Review Unavailable',
    className:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
  },
};

const PERFORMANCE_LABELS: Record<
  PerformanceLevel,
  { label: string; className: string }
> = {
  good: {
    label: 'Solid Understanding',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200',
  },
  needs_work: {
    label: 'Needs Practice',
    className:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
  },
};

const DIMENSION_SCORE_META: Record<
  ReviewDimensionScore,
  { label: string; className: string }
> = {
  good: {
    label: 'Strong',
    className: 'text-emerald-700 dark:text-emerald-300',
  },
  partial: {
    label: 'Developing',
    className: 'text-amber-700 dark:text-amber-300',
  },
  weak: {
    label: 'Needs Focus',
    className: 'text-rose-700 dark:text-rose-300',
  },
};

/**
 * SPEC #22 `PracticeReviewCard`:
 * Renders structured AI Practice Review rubric feedback (`EP-PR02`) for a free-response answer,
 * including `review_status`, `performance_level`, rubric dimensions, strengths, mistakes,
 * improvement recommendations, and `EP-PR03` retry support when `review_status === 'failed'`.
 */
export function PracticeReviewCard({
  questionNumber,
  questionPrompt,
  userAnswer,
  explanation,
  reviewId,
  reviewStatus,
  feedback,
  aiPracticeReviewEnabled = true,
  retrying = false,
  retryErrorMessage = null,
  feedbackLoadError = null,
  isRawTextExpired = false,
  onRetryReview,
  onRetryFeedbackLoad,
  className,
}: PracticeReviewCardProps) {
  const effectiveStatus = feedback?.review_status ?? reviewStatus;
  const statusMeta = STATUS_BADGE[effectiveStatus] ?? STATUS_BADGE.pending;
  const perfLevel = feedback?.performance_level ?? null;
  const perfMeta = perfLevel ? PERFORMANCE_LABELS[perfLevel] : null;
  const hasSubmittedAnswer =
    !isRawTextExpired &&
    typeof userAnswer === 'string' &&
    userAnswer.trim().length > 0;
  const hasExplanation =
    typeof explanation === 'string' && explanation.trim().length > 0;

  return (
    <article
      data-review-id={reviewId ?? undefined}
      data-review-status={effectiveStatus}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold leading-none text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200">
            <SparklesIcon className="block h-3.5 w-3.5 shrink-0" />
            <span>Free Response #{questionNumber}</span>
          </span>
          <span
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              statusMeta.className,
            )}
          >
            {effectiveStatus === 'pending' && (
              <SpinnerIcon className="block h-3.5 w-3.5 shrink-0" />
            )}
            {effectiveStatus === 'reviewed' && (
              <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0" />
            )}
            {effectiveStatus === 'failed' && (
              <AlertCircleIcon className="block h-3.5 w-3.5 shrink-0" />
            )}
            <span>{statusMeta.label}</span>
          </span>
        </div>

        {perfMeta && (
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              perfMeta.className,
            )}
          >
            {perfMeta.label}
          </span>
        )}
      </div>

      {/* Question Prompt */}
      <h4
        dir="auto"
        className="text-body-md font-semibold text-slate-900 dark:text-slate-100"
      >
        {questionPrompt}
      </h4>

      {/* 1. Your Submitted Answer */}
      {(isRawTextExpired || hasSubmittedAnswer || userAnswer === null) && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Your Submitted Answer
          </p>
          {isRawTextExpired ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              <InfoIcon className="block h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
              <span>
                Submitted answer expired after the 90-day retention period.
              </span>
            </div>
          ) : hasSubmittedAnswer ? (
            <pre
              dir="auto"
              className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200"
            >
              {userAnswer}
            </pre>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3.5 py-2.5 text-sm font-medium text-amber-900 dark:border-amber-700/80 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertCircleIcon className="block h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>No response submitted (Skipped)</span>
            </div>
          )}
        </div>
      )}

      {/* Pending State */}
      {effectiveStatus === 'pending' && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-sky-200/80 bg-sky-50/60 p-4 text-body-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200"
        >
          <SpinnerIcon className="block h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <span>
            Evaluating your free-response answer against the topic rubric.
            Feedback will appear here automatically once ready.
          </span>
        </div>
      )}

      {/* Not Evidence / Skipped State */}
      {effectiveStatus === 'not_evidence' && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-body-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
          <div className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 block h-4 w-4 shrink-0 text-slate-500" />
            <p>This answer was not counted toward skill mastery evidence.</p>
          </div>
          {feedback?.improvement_recommendations &&
            feedback.improvement_recommendations.length > 0 && (
              <ul className="ml-6 list-disc space-y-1 text-xs text-slate-600 dark:text-slate-400">
                {feedback.improvement_recommendations.map((rec, i) => (
                  <li key={i} dir="auto">
                    {rec}
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}

      {/* Failed State + EP-PR03 Retry CTA */}
      {effectiveStatus === 'failed' && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-body-sm text-amber-900 dark:text-amber-200">
            {isRawTextExpired
              ? 'The original free-response text has expired under the 90-day privacy retention policy and can no longer be re-evaluated.'
              : !aiPracticeReviewEnabled
                ? 'AI Practice Review is currently paused. Your quiz submission and Daily Plan progress were saved.'
                : (retryErrorMessage ??
                  'AI review could not complete for this response. Your answer is saved and you can retry the review.')}
          </p>
          {reviewId && onRetryReview && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={retrying}
                loadingText="Retrying AI Review..."
                disabled={
                  retrying || !aiPracticeReviewEnabled || isRawTextExpired
                }
                onClick={() => onRetryReview(reviewId)}
                className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
              >
                <RefreshCwIcon className="block h-3.5 w-3.5 shrink-0" />
                <span>Retry AI Review</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Transient EP-PR02 Feedback Load Error Recovery */}
      {!feedback &&
        feedbackLoadError &&
        reviewId &&
        onRetryFeedbackLoad && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/30"
          >
            <p className="text-body-sm text-amber-900 dark:text-amber-200">
              {feedbackLoadError}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onRetryFeedbackLoad(reviewId)}
                className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
              >
                <RefreshCwIcon className="block h-3.5 w-3.5 shrink-0" />
                <span>Retry feedback</span>
              </Button>
            </div>
          </div>
        )}

      {/* 2. AI Corrections & Feedback (Reviewed Rubric Breakdown) */}
      {effectiveStatus === 'reviewed' && feedback && (
        <div className="flex flex-col gap-4">
          {feedback.dimensions && (
            <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-950/40">
              {(
                [
                  ['Correctness', feedback.dimensions.correctness],
                  ['Understanding', feedback.dimensions.understanding],
                  ['Reasoning', feedback.dimensions.reasoning],
                ] as const
              ).map(([dimLabel, score]) => {
                const dimMeta =
                  DIMENSION_SCORE_META[score] ?? DIMENSION_SCORE_META.partial;
                return (
                  <div
                    key={dimLabel}
                    className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:gap-1"
                  >
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      {dimLabel}
                    </span>
                    <span
                      className={cn('text-xs font-semibold', dimMeta.className)}
                    >
                      {dimMeta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {(feedback.mistakes.length > 0 || feedback.weaknesses.length > 0) && (
            <div className="space-y-1.5 rounded-xl border border-rose-200/80 bg-rose-50/50 p-3.5 dark:border-rose-900/60 dark:bg-rose-950/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                Mistakes &amp; Corrections
              </p>
              <ul className="list-disc space-y-1 pl-5 text-body-sm text-rose-950 dark:text-rose-200">
                {[...feedback.mistakes, ...feedback.weaknesses].map(
                  (item, idx) => (
                    <li key={idx} dir="auto">
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}

          {feedback.strengths.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Strengths
              </p>
              <ul className="list-disc space-y-1 pl-5 text-body-sm text-emerald-950 dark:text-emerald-200">
                {feedback.strengths.map((item, idx) => (
                  <li key={idx} dir="auto">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feedback.improvement_recommendations.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/25">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                How to Improve
              </p>
              <ul className="list-disc space-y-1 pl-5 text-body-sm text-slate-700 dark:text-slate-300">
                {feedback.improvement_recommendations.map((item, idx) => (
                  <li key={idx} dir="auto">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span>
              {feedback.evidence_eligible
                ? 'Recorded as level-scoped learning evidence'
                : 'Formative feedback (not recorded as mastery evidence)'}
            </span>
          </div>
        </div>
      )}

      {/* 3. Reference Answer / Explanation */}
      {hasExplanation && (
        <div className="flex items-start gap-2.5 rounded-xl border border-teal-200/80 bg-teal-50/40 p-3.5 text-body-sm text-slate-700 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-slate-200">
          <InfoIcon className="mt-0.5 block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-800 dark:text-teal-300">
              Reference Answer &amp; Explanation
            </p>
            <p dir="auto" className="mt-1 whitespace-pre-line leading-relaxed">
              {explanation!.trim()}
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
