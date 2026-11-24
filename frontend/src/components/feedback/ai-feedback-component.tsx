'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ApiError,
  submitRating,
  submitReport,
  type RatingTarget,
  type ReportReason,
  type ReportTarget,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import {
  beginRatingWrite,
  saveStoredRating,
  saveStoredReport,
  useStoredFeedback,
} from '@/lib/feedback-storage';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Modal } from '@/components/ui/modal';
import { StarRating } from '@/components/ui/star-rating';
import { Toast } from '@/components/ui/toast';

export type AIFeedbackComponentProps = {
  accessToken: string;
  ratingTarget?: { type: RatingTarget; id: string };
  reportTarget?: { type: ReportTarget; id: string };
  currentScore?: number;
  alreadyReported?: boolean;
  defaultReportReason?: ReportReason;
  compact?: boolean;
  onRated?: (score: number) => void;
  onReported?: (reportId: string) => void;
  className?: string;
};

type LocalRatingState = {
  draftScore: number | null;
  fallbackSavedScore: number | null;
  fallbackSavedComment: string | null;
  comment: string;
  commentPanelOpen: boolean | null;
  submitting: boolean;
  pendingRequestId: number | null;
  error: MappedError | null;
};

type LocalReportState = {
  modalOpen: boolean;
  reason: ReportReason;
  comment: string;
  submitting: boolean;
  pendingRequestId: number | null;
  submitted: boolean;
  submittedReason: ReportReason | null;
  submittedComment: string | null;
  reconciledDuplicate: boolean;
  error: MappedError | null;
};

type FeedbackToastState = {
  id: number;
  variant: 'success' | 'info';
  title: string;
  message: string;
};

const MAX_RATING_COMMENT_CODEPOINTS = 500;
const MAX_REPORT_COMMENT_CODEPOINTS = 1_000;

const REPORT_REASON_OPTIONS: ReadonlyArray<{
  value: ReportReason;
  label: string;
  hint: string;
}> = [
  {
    value: 'incorrect',
    label: 'Incorrect information',
    hint: 'Technical inaccuracy, wrong answer key, or invalid guidance.',
  },
  {
    value: 'unclear',
    label: 'Unclear or confusing',
    hint: 'Ambiguous wording, missing context, or hard-to-follow structure.',
  },
  {
    value: 'unfair_scoring',
    label: 'Unfair AI scoring',
    hint: 'Rubric evaluation missed valid Bangla, English, or Mixed reasoning.',
  },
  {
    value: 'outdated',
    label: 'Outdated content',
    hint: 'Deprecated API, superseded version, or stale ecosystem guidance.',
  },
  {
    value: 'inappropriate',
    label: 'Inappropriate content',
    hint: 'Unsafe, off-topic, or policy-violating material.',
  },
  {
    value: 'other',
    label: 'Other issue',
    hint: 'Any other quality or formatting problem.',
  },
];

function getReportReasonLabel(reason: ReportReason): string {
  return (
    REPORT_REASON_OPTIONS.find((opt) => opt.value === reason)?.label ?? reason
  );
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('block h-4 w-4 shrink-0', className)}
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" x2="4" y1="22" y2="15" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('block h-3.5 w-3.5 shrink-0', className)}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function normalizeValidScore(score: number | undefined): number | null {
  if (
    typeof score === 'number' &&
    Number.isInteger(score) &&
    score >= 1 &&
    score <= 5
  ) {
    return score;
  }
  return null;
}

/**
 * Component 29 `AIFeedbackComponent` (`C09` §2.7, `C05` §14.12 `EP-F01`–`EP-F02`, `R11`, `R16`, `R34`).
 *
 * Keys its internal stateful view on `(accessToken, ratingTarget, reportTarget)` so leaving or
 * returning to a scope cleanly retires transient modals/pending flags without synchronous
 * `setState` in `useEffect` or render, while persisting accepted feedback via `useSyncExternalStore`.
 */
export function AIFeedbackComponent(props: AIFeedbackComponentProps) {
  const hasRating = Boolean(props.ratingTarget?.id?.trim());
  const hasReport = Boolean(props.reportTarget?.id?.trim());

  if (!hasRating && !hasReport) {
    return null;
  }

  const instanceKey = [
    props.accessToken,
    hasRating && props.ratingTarget
      ? `${props.ratingTarget.type}:${props.ratingTarget.id.trim()}`
      : '',
    hasReport && props.reportTarget
      ? `${props.reportTarget.type}:${props.reportTarget.id.trim()}`
      : '',
  ].join('|');

  return <AIFeedbackInner key={instanceKey} {...props} />;
}

function AIFeedbackInner({
  accessToken,
  ratingTarget,
  reportTarget,
  currentScore,
  alreadyReported = false,
  defaultReportReason = 'incorrect',
  compact = false,
  onRated,
  onReported,
  className,
}: AIFeedbackComponentProps) {
  const uid = useId();
  const ratingCommentId = `${uid}-rating-comment`;
  const reportCommentId = `${uid}-report-comment`;

  const hasRating = Boolean(ratingTarget?.id?.trim());
  const hasReport = Boolean(reportTarget?.id?.trim());

  const seededScore = normalizeValidScore(currentScore);
  const storedRatingEntry = useStoredFeedback(accessToken, ratingTarget);
  const storedReportEntry = useStoredFeedback(accessToken, reportTarget);
  const persistedRating = storedRatingEntry?.rating ?? null;
  const persistedReport = storedReportEntry?.report ?? null;

  const [ratingState, setRatingState] = useState<LocalRatingState>(() => ({
    draftScore: null,
    fallbackSavedScore: null,
    fallbackSavedComment: null,
    comment: '',
    commentPanelOpen: null,
    submitting: false,
    pendingRequestId: null,
    error: null,
  }));

  const [reportState, setReportState] = useState<LocalReportState>(() => ({
    modalOpen: false,
    reason: defaultReportReason,
    comment: '',
    submitting: false,
    pendingRequestId: null,
    submitted: false,
    submittedReason: null,
    submittedComment: null,
    reconciledDuplicate: false,
    error: null,
  }));

  const [feedbackToast, setFeedbackToast] = useState<FeedbackToastState | null>(
    null,
  );

  const mountedRef = useRef(true);
  const ratingRequestIdRef = useRef(0);
  const reportRequestIdRef = useRef(0);
  const toastCounterRef = useRef(0);
  const reportTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fallbackFocusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleCloseReportModal = useCallback(() => {
    setReportState((prev) => {
      if (prev.submitting) {
        return prev;
      }
      return { ...prev, modalOpen: false };
    });
  }, []);

  // Coherent accepted rating source: shared persisted store wins over local fallback so sibling
  // mounted instances immediately stay synchronized without shadowing newer updates.
  const resolvedSavedScore =
    persistedRating?.score ??
    ratingState.fallbackSavedScore ??
    seededScore ??
    null;
  const resolvedSavedComment =
    persistedRating !== null
      ? (persistedRating.comment ?? null)
      : ratingState.fallbackSavedScore !== null
        ? ratingState.fallbackSavedComment
        : null;

  const ratingCodePoints = Array.from(ratingState.comment.trim()).length;
  const ratingOverLimit = ratingCodePoints > MAX_RATING_COMMENT_CODEPOINTS;
  const defaultRatingPanelOpen = !compact && resolvedSavedScore === null;
  const showRatingForm =
    ratingState.error !== null ||
    (ratingState.commentPanelOpen ?? defaultRatingPanelOpen);
  // Preserve active unsaved draft selection while editing; reflect shared accepted score when idle.
  const resolvedSelectedScore =
    showRatingForm && ratingState.draftScore !== null
      ? ratingState.draftScore
      : resolvedSavedScore;
  const canSubmitRating =
    resolvedSelectedScore !== null &&
    !ratingOverLimit &&
    !ratingState.submitting;

  const isAlreadyReported =
    Boolean(alreadyReported) ||
    Boolean(persistedReport?.reported) ||
    reportState.submitted ||
    reportState.reconciledDuplicate;
  const resolvedSubmittedReason =
    reportState.submittedReason ?? persistedReport?.reason ?? null;
  const reportComment =
    (
      reportState.submittedComment ??
      persistedReport?.comment ??
      ''
    ).trim() || null;

  const isReportModalOpen =
    hasReport && !isAlreadyReported && reportState.modalOpen;
  const reportCodePoints = Array.from(reportState.comment.trim()).length;
  const reportOverLimit = reportCodePoints > MAX_REPORT_COMMENT_CODEPOINTS;
  const canSubmitReport = !reportOverLimit && !reportState.submitting;

  const emitToast = (
    variant: 'success' | 'info',
    title: string,
    message: string,
  ) => {
    toastCounterRef.current += 1;
    setFeedbackToast({
      id: toastCounterRef.current,
      variant,
      title,
      message,
    });
  };

  const handleSelectStar = (star: number) => {
    if (ratingState.submitting) {
      return;
    }
    setRatingState((prev) => ({
      ...prev,
      draftScore: star,
      comment:
        prev.commentPanelOpen === true
          ? prev.comment
          : prev.comment || resolvedSavedComment || '',
      commentPanelOpen: true,
      error: null,
    }));
  };

  const handleEditReview = () => {
    if (ratingState.submitting) {
      return;
    }
    setRatingState((prev) => ({
      ...prev,
      draftScore: resolvedSavedScore ?? resolvedSelectedScore,
      comment: resolvedSavedComment ?? '',
      commentPanelOpen: true,
      error: null,
    }));
  };

  const handleRatingSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !ratingTarget ||
      resolvedSelectedScore === null ||
      ratingOverLimit ||
      ratingState.submitting
    ) {
      return;
    }

    const requestToken = accessToken;
    const targetType = ratingTarget.type;
    const targetId = ratingTarget.id.trim();
    const trimmedComment = ratingState.comment.trim();
    const scoreToSubmit = resolvedSelectedScore;
    ratingRequestIdRef.current += 1;
    const requestId = ratingRequestIdRef.current;
    const writeSeq = beginRatingWrite();

    setRatingState((prev) => ({
      ...prev,
      draftScore: scoreToSubmit,
      submitting: true,
      pendingRequestId: requestId,
      error: null,
    }));

    try {
      const res = await submitRating(requestToken, {
        target_type: targetType,
        target_id: targetId,
        score: scoreToSubmit,
        ...(trimmedComment.length > 0 ? { comment: trimmedComment } : {}),
      });

      // Persist accepted rating with monotonic sequence guard (watermark advances only on 200 OK).
      saveStoredRating(
        requestToken,
        targetType,
        targetId,
        {
          score: res.score,
          ...(trimmedComment.length > 0 ? { comment: trimmedComment } : {}),
        },
        writeSeq,
      );

      if (!mountedRef.current || ratingRequestIdRef.current !== requestId) {
        return;
      }

      setRatingState((prev) => {
        if (prev.pendingRequestId !== requestId) {
          return prev;
        }
        return {
          ...prev,
          draftScore: null,
          fallbackSavedScore: res.score,
          fallbackSavedComment:
            trimmedComment.length > 0 ? trimmedComment : null,
          comment: '',
          submitting: false,
          pendingRequestId: null,
          commentPanelOpen: false,
          error: null,
        };
      });
      emitToast(
        'success',
        'Rating saved',
        `Your rating (${res.score}/5) has been recorded.`,
      );
      onRated?.(res.score);
    } catch (err) {
      if (!mountedRef.current || ratingRequestIdRef.current !== requestId) {
        return;
      }
      const mapped = mapApiError(err);
      setRatingState((prev) => {
        if (prev.pendingRequestId !== requestId) {
          return prev;
        }
        return {
          ...prev,
          submitting: false,
          pendingRequestId: null,
          commentPanelOpen: true,
          error: mapped,
        };
      });
    }
  };

  const handleOpenReportModal = () => {
    if (isAlreadyReported) {
      return;
    }
    setReportState((prev) => ({
      ...prev,
      modalOpen: true,
      reason: prev.reason ?? defaultReportReason,
      error: null,
    }));
  };

  const handleReportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reportTarget || reportOverLimit || reportState.submitting) {
      return;
    }

    const requestToken = accessToken;
    const targetType = reportTarget.type;
    const targetId = reportTarget.id.trim();
    const reasonToSubmit = reportState.reason;
    const trimmedComment = reportState.comment.trim();
    reportRequestIdRef.current += 1;
    const requestId = reportRequestIdRef.current;

    setReportState((prev) => ({
      ...prev,
      submitting: true,
      pendingRequestId: requestId,
      error: null,
    }));

    try {
      const res = await submitReport(requestToken, {
        target_type: targetType,
        target_id: targetId,
        reason: reasonToSubmit,
        ...(trimmedComment.length > 0 ? { comment: trimmedComment } : {}),
      });

      const submittedComment =
        trimmedComment.length > 0 ? trimmedComment : null;
      // Persist accepted report for the originating account & target even across token refresh or unmount.
      saveStoredReport(requestToken, targetType, targetId, {
        reason: reasonToSubmit,
        ...(submittedComment ? { comment: submittedComment } : {}),
      });

      if (!mountedRef.current || reportRequestIdRef.current !== requestId) {
        return;
      }

      setReportState((prev) => {
        if (prev.pendingRequestId !== requestId) {
          return prev;
        }
        return {
          ...prev,
          modalOpen: false,
          comment: '',
          submitting: false,
          pendingRequestId: null,
          submitted: true,
          submittedReason: reasonToSubmit,
          submittedComment,
          error: null,
        };
      });
      emitToast(
        'success',
        'Report submitted',
        'Thank you. Your report has been received for review.',
      );
      onReported?.(res.report_id);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'REPORT_ALREADY_SUBMITTED'
      ) {
        // Persist duplicate reconciliation ONLY for exact REPORT_ALREADY_SUBMITTED.
        saveStoredReport(requestToken, targetType, targetId, {});

        if (!mountedRef.current || reportRequestIdRef.current !== requestId) {
          return;
        }

        setReportState((prev) => {
          if (prev.pendingRequestId !== requestId) {
            return prev;
          }
          return {
            ...prev,
            modalOpen: false,
            submitting: false,
            pendingRequestId: null,
            reconciledDuplicate: true,
            error: null,
          };
        });
        emitToast(
          'info',
          'Already reported',
          'You have already submitted a report for this item.',
        );
        return;
      }

      if (!mountedRef.current || reportRequestIdRef.current !== requestId) {
        return;
      }

      const mapped = mapApiError(err);
      setReportState((prev) => {
        if (prev.pendingRequestId !== requestId) {
          return prev;
        }
        return {
          ...prev,
          submitting: false,
          pendingRequestId: null,
          error: mapped,
        };
      });
    }
  };

  const reviewComment = (resolvedSavedComment ?? '').trim();
  const showReviewPreview =
    hasRating &&
    resolvedSavedScore !== null &&
    reviewComment.length > 0 &&
    !showRatingForm;
  const showReportPreview =
    hasReport &&
    isAlreadyReported &&
    (resolvedSubmittedReason !== null || reportComment !== null);

  return (
    <div
      ref={fallbackFocusRef}
      tabIndex={-1}
      data-testid="ai-feedback"
      className={cn(
        'flex flex-col outline-none',
        compact ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      <div
        data-testid="ai-feedback-action-row"
        className="my-0 flex flex-wrap items-center justify-between gap-3 py-3"
      >
        {/* Independent Rating Capability (EP-F01) */}
        {hasRating && ratingTarget && (
          <div
            data-rating-target-type={ratingTarget.type}
            data-rating-target-id={ratingTarget.id}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-sm font-medium leading-none text-slate-700 dark:text-slate-200">
              Rate quality:
            </span>
            <StarRating
              value={resolvedSelectedScore}
              onChange={handleSelectStar}
              disabled={ratingState.submitting}
              ariaLabel="Rate this content"
              size={compact ? 'sm' : 'md'}
            />
            {resolvedSavedScore !== null && (
              <span
                data-testid="ai-feedback-score"
                className="font-mono text-xs font-medium leading-none tabular-nums text-slate-500 dark:text-slate-400"
              >
                ({resolvedSavedScore})
              </span>
            )}
          </div>
        )}

        {/* Independent Report Capability (EP-F02) */}
        {hasReport && reportTarget && (
          <div
            data-report-target-type={reportTarget.type}
            data-report-target-id={reportTarget.id}
            className="flex flex-wrap items-center gap-2"
          >
            {isAlreadyReported ? (
              <span
                aria-disabled="true"
                data-feedback-state="already_reported"
                className="inline-flex h-9 min-h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium leading-none text-red-700 dark:border-red-800/70 dark:bg-red-950/50 dark:text-red-300"
              >
                <FlagIcon className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <span>Reported</span>
              </span>
            ) : (
              <Button
                ref={reportTriggerRef}
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleOpenReportModal}
                className="inline-flex !h-9 min-h-9 items-center gap-1.5 text-slate-600 hover:border-rose-200 hover:text-rose-700 dark:text-slate-300 dark:hover:border-rose-800 dark:hover:text-rose-300"
              >
                <FlagIcon />
                <span>Report issue</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Separated Submitted Review & Report Summary Blocks */}
      {(showReviewPreview || showReportPreview) && (
        <div data-testid="ai-feedback-summary" className="flex flex-col">
          {showReviewPreview && (
            <div
              data-testid="ai-feedback-review-preview"
              className={cn(
                'flex flex-col gap-1 border-t border-slate-100 bg-transparent pt-3 dark:border-slate-800/80',
                (showReportPreview || showRatingForm) && 'pb-3',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Your review
                </span>
                <button
                  type="button"
                  onClick={handleEditReview}
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-sm font-medium text-teal-700 transition-colors hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 dark:text-teal-300 dark:hover:text-teal-200"
                >
                  <PencilIcon />
                  <span>Edit</span>
                </button>
              </div>
              <p
                dir="auto"
                className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300"
              >
                {reviewComment}
              </p>
            </div>
          )}

          {showReportPreview && (
            <div
              data-testid="ai-feedback-report-section"
              className={cn(
                'border-t border-slate-100 pt-3 dark:border-slate-800/80',
                showRatingForm && 'pb-3',
              )}
            >
              <div
                data-testid="ai-feedback-report-preview"
                className="flex flex-col rounded-xl border border-red-200/80 bg-red-50/45 px-3.5 py-2.5 shadow-2xs dark:border-red-900/60 dark:bg-red-950/30"
              >
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  Your report
                </p>
                {resolvedSubmittedReason && (
                  <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {getReportReasonLabel(resolvedSubmittedReason)}
                  </p>
                )}
                {reportComment && (
                  <p
                    dir="auto"
                    className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 dark:text-slate-300"
                  >
                    {reportComment}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expandable / Standard Rating Comment + Submit Form */}
      {hasRating && ratingTarget && showRatingForm && (
        <form
          onSubmit={handleRatingSubmit}
          className="flex flex-col gap-2.5 border-t border-slate-100 pt-3 dark:border-slate-800/80"
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={ratingCommentId}
                className="text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Rating comment (optional)
              </label>
              <span
                className={cn(
                  'font-mono text-xs tabular-nums',
                  ratingOverLimit
                    ? 'font-semibold text-rose-600 dark:text-rose-400'
                    : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {ratingCodePoints} / {MAX_RATING_COMMENT_CODEPOINTS}
              </span>
            </div>
            <textarea
              id={ratingCommentId}
              rows={2}
              dir="auto"
              value={ratingState.comment}
              disabled={ratingState.submitting}
              onChange={(e) => {
                const val = e.target.value;
                setRatingState((prev) => ({
                  ...prev,
                  comment: val,
                  error: null,
                }));
              }}
              placeholder="Share optional feedback on usefulness or clarity..."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {ratingOverLimit && (
              <p
                role="alert"
                className="text-xs font-medium text-rose-600 dark:text-rose-400"
              >
                Comment must be {MAX_RATING_COMMENT_CODEPOINTS} characters or
                fewer.
              </p>
            )}
          </div>

          {ratingState.error && (
            <Alert variant="warning" role="alert">
              {ratingState.error.message}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={ratingState.submitting}
              loadingText="Saving..."
              disabled={!canSubmitRating}
              className="inline-flex min-h-11 items-center gap-1.5"
            >
              <span>
                {resolvedSavedScore !== null
                  ? 'Update rating'
                  : 'Submit rating'}
              </span>
            </Button>
            {(compact || resolvedSavedScore !== null) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={ratingState.submitting}
                onClick={() =>
                  setRatingState((prev) => ({
                    ...prev,
                    draftScore: null,
                    comment: '',
                    commentPanelOpen: false,
                    error: null,
                  }))
                }
                className="min-h-11"
              >
                <span>Cancel</span>
              </Button>
            )}
          </div>
        </form>
      )}

      {/* Compound Report Modal (EP-F02 — never uses legacy variant="report_dialog") */}
      {hasReport && reportTarget && (
        <Modal
          open={isReportModalOpen}
          onClose={handleCloseReportModal}
          disableClose={reportState.submitting}
          returnFocusTo={reportTriggerRef}
          fallbackReturnFocusTo={fallbackFocusRef}
          size="md"
        >
          <form
            onSubmit={handleReportSubmit}
            className="flex min-h-0 flex-1 flex-col"
          >
            <Modal.Header>
              <div className="min-w-0">
                <Modal.Title>Report content issue</Modal.Title>
                <Modal.Description>
                  Select the primary reason for reporting this item. Reports
                  from independent learners help identify content that needs
                  review or regeneration.
                </Modal.Description>
              </div>
              <Modal.Close disabled={reportState.submitting} />
            </Modal.Header>

            <Modal.Body className="flex flex-col gap-4">
              <fieldset
                disabled={reportState.submitting}
                className="flex flex-col gap-2"
              >
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Reason for report
                </legend>
                <div
                  role="radiogroup"
                  aria-label="Report reason"
                  className="flex flex-col gap-2"
                >
                  {REPORT_REASON_OPTIONS.map((opt) => {
                    const checked = reportState.reason === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                          checked
                            ? 'border-teal-600 bg-teal-50/70 dark:border-teal-500 dark:bg-teal-950/40'
                            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60',
                        )}
                      >
                        <input
                          type="radio"
                          name={`${uid}-report-reason`}
                          value={opt.value}
                          checked={checked}
                          onChange={() =>
                            setReportState((prev) => ({
                              ...prev,
                              reason: opt.value,
                              error: null,
                            }))
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {opt.label}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {opt.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={reportCommentId}
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Additional details (optional)
                  </label>
                  <span
                    className={cn(
                      'font-mono text-xs tabular-nums',
                      reportOverLimit
                        ? 'font-semibold text-rose-600 dark:text-rose-400'
                        : 'text-slate-500 dark:text-slate-400',
                    )}
                  >
                    {reportCodePoints} / {MAX_REPORT_COMMENT_CODEPOINTS}
                  </span>
                </div>
                <textarea
                  id={reportCommentId}
                  rows={3}
                  dir="auto"
                  value={reportState.comment}
                  disabled={reportState.submitting}
                  onChange={(e) => {
                    const val = e.target.value;
                    setReportState((prev) => ({
                      ...prev,
                      comment: val,
                      error: null,
                    }));
                  }}
                  placeholder="Describe what was inaccurate, unclear, or unfairly scored..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                {reportOverLimit && (
                  <p
                    role="alert"
                    className="text-xs font-medium text-rose-600 dark:text-rose-400"
                  >
                    Comment must be {MAX_REPORT_COMMENT_CODEPOINTS} characters
                    or fewer.
                  </p>
                )}
              </div>

              {reportState.error && (
                <Alert variant="warning" role="alert">
                  {reportState.error.message}
                </Alert>
              )}
            </Modal.Body>

            <Modal.Footer>
              <Button
                type="button"
                variant="secondary"
                disabled={reportState.submitting}
                onClick={handleCloseReportModal}
                className="min-h-11"
              >
                <span>Cancel</span>
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={reportState.submitting}
                loadingText="Submitting..."
                disabled={!canSubmitReport}
                className="inline-flex min-h-11 items-center gap-1.5"
              >
                <FlagIcon />
                <span>Submit report</span>
              </Button>
            </Modal.Footer>
          </form>
        </Modal>
      )}

      {feedbackToast && (
        <Toast
          key={feedbackToast.id}
          variant={feedbackToast.variant}
          role="status"
          title={feedbackToast.title}
          autoDismissMs={5000}
          onDismiss={() => setFeedbackToast(null)}
        >
          {feedbackToast.message}
        </Toast>
      )}
    </div>
  );
}
