'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getJobStatus,
  type JobAcceptedDTO,
  type JobResultRefDTO,
  type JobStatusDTO,
} from '@/lib/api/client';
import { mapApiError } from '@/lib/api/error-mapper';
import { Button } from './button';
import { cn } from './cn';
import { AlertCircleIcon, CheckCircleIcon, SpinnerIcon } from './icons';

export type AILoadingStateVariant = 'inline_banner' | 'full_section_skeleton';
export type AILoadingUIState =
  | 'queued'
  | 'preparing'
  | 'succeeded'
  | 'failed_retryable';

export interface AILoadingStateProps {
  /** Initial `JobAcceptedDTO` or current `JobStatusDTO` to display and poll. */
  job: JobAcceptedDTO | JobStatusDTO;
  /** Descriptive title for the pending AI work (e.g. "Preparing your career roadmap"). */
  title: string;
  /** Component 28 variant (`C09` §2.7). */
  variant?: AILoadingStateVariant;
  /** Bearer access token used by default `getJobStatus` polling when `pollJobStatus` is omitted. */
  accessToken?: string;
  /** Optional custom status fetcher (receives `jobId` and `AbortSignal`). */
  pollJobStatus?: (jobId: string, signal: AbortSignal) => Promise<JobStatusDTO>;
  /** Invoked once when polling transitions to `succeeded` with a non-null `result_ref`. */
  onJobSucceeded?: (resultRef: JobResultRefDTO, status: JobStatusDTO) => void;
  /** Invoked when the learner activates Retry on `failed_retryable`. */
  onRetryJob?: () => void;
  /** Number of skeleton lines in `full_section_skeleton` variant to prevent layout shift. */
  skeletonCount?: number;
  className?: string;
}

interface PolledSnapshot {
  jobId: string;
  status: JobStatusDTO;
}

interface PollFailureSnapshot {
  jobId: string;
  message: string;
}

function getRetryAfterSeconds(job: JobAcceptedDTO | JobStatusDTO): number {
  if (
    'retry_after_seconds' in job &&
    typeof job.retry_after_seconds === 'number' &&
    Number.isFinite(job.retry_after_seconds)
  ) {
    return Math.max(1, Math.round(job.retry_after_seconds));
  }
  return 3;
}

function resolveJobFailureCopy(jobError: JobStatusDTO['error']): string {
  if (!jobError?.code) {
    return "We couldn't generate this right now. Your information has been saved. Please try again.";
  }
  return mapApiError(
    new ApiError(502, '', jobError.code, undefined, [], jobError.retryable),
  ).message;
}

/**
 * Component 28 `AILoadingState` (`C09` §2.7 / `PRD` §48):
 * Non-blocking `Preparing` card & skeleton that polls `GET /api/v1/jobs/{id}` (`EP-J01`)
 * at `retry_after_seconds`, sets `aria-busy="true"` while active, respects `prefers-reduced-motion`,
 * preserves server job execution when unmounted, and shows preserved-data reassurance on failure.
 */
export function AILoadingState({
  job,
  title,
  variant = 'inline_banner',
  accessToken,
  pollJobStatus,
  onJobSucceeded,
  onRetryJob,
  skeletonCount = 3,
  className,
}: AILoadingStateProps) {
  const [polled, setPolled] = useState<PolledSnapshot | null>(null);
  const [pollFailure, setPollFailure] = useState<PollFailureSnapshot | null>(
    null,
  );

  const onJobSucceededRef = useRef(onJobSucceeded);
  const pollJobStatusRef = useRef(pollJobStatus);

  useEffect(() => {
    onJobSucceededRef.current = onJobSucceeded;
    pollJobStatusRef.current = pollJobStatus;
  });

  const activePolled =
    polled && polled.jobId === job.job_id ? polled.status : null;
  const activePollFailure =
    pollFailure && pollFailure.jobId === job.job_id ? pollFailure.message : null;

  const effectiveRawStatus = activePolled?.status ?? job.status;
  const effectiveError =
    activePolled?.error ?? ('error' in job ? job.error : null);
  const effectiveRetryable =
    activePolled?.retryable ?? ('retryable' in job ? job.retryable : false);

  const uiState: AILoadingUIState = activePollFailure
    ? 'failed_retryable'
    : effectiveRawStatus === 'failed'
      ? 'failed_retryable'
      : effectiveRawStatus === 'succeeded'
        ? 'succeeded'
        : effectiveRawStatus === 'preparing'
          ? 'preparing'
          : 'queued';

  const isActive = uiState === 'queued' || uiState === 'preparing';
  const intervalSeconds = getRetryAfterSeconds(job);
  const hasPoller = Boolean(pollJobStatus || accessToken);

  useEffect(() => {
    if (!isActive || !hasPoller) {
      return;
    }

    let mounted = true;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const delayMs = intervalSeconds * 1_000;

    const executePoll = async () => {
      if (!mounted || controller.signal.aborted) {
        return;
      }
      const fetcher =
        pollJobStatusRef.current ??
        (accessToken
          ? (id: string, signal: AbortSignal) =>
              getJobStatus(accessToken, id, { signal })
          : null);
      if (!fetcher) {
        return;
      }

      try {
        const nextStatus = await fetcher(job.job_id, controller.signal);
        if (!mounted || controller.signal.aborted) {
          return;
        }
        setPollFailure(null);
        setPolled({ jobId: job.job_id, status: nextStatus });

        if (nextStatus.status === 'succeeded') {
          if (nextStatus.result_ref) {
            onJobSucceededRef.current?.(nextStatus.result_ref, nextStatus);
          }
          return;
        }
        if (nextStatus.status === 'failed') {
          return;
        }
        timerId = setTimeout(() => {
          void executePoll();
        }, delayMs);
      } catch (error) {
        if (!mounted || controller.signal.aborted) {
          return;
        }
        const mapped = mapApiError(error);
        setPollFailure({
          jobId: job.job_id,
          message: mapped.message,
        });
      }
    };

    timerId = setTimeout(() => {
      void executePoll();
    }, delayMs);

    return () => {
      mounted = false;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      controller.abort();
    };
  }, [accessToken, hasPoller, intervalSeconds, isActive, job.job_id]);

  const statusText =
    uiState === 'queued'
      ? 'Queued for processing...'
      : uiState === 'preparing'
        ? 'Preparing your personalized content...'
        : uiState === 'succeeded'
          ? 'Ready.'
          : activePollFailure ?? resolveJobFailureCopy(effectiveError);

  const chipLabel =
    uiState === 'queued'
      ? 'Queued'
      : uiState === 'preparing'
        ? 'Preparing'
        : uiState === 'succeeded'
          ? 'Completed'
          : 'Needs retry';

  const canRetry =
    Boolean(onRetryJob) &&
    uiState === 'failed_retryable' &&
    (Boolean(activePollFailure) ||
      effectiveRetryable ||
      Boolean(effectiveError?.retryable));

  const clampedSkeletonCount = Math.max(1, Math.min(8, skeletonCount));

  return (
    <section
      aria-busy={isActive ? 'true' : 'false'}
      aria-live="polite"
      role="status"
      data-variant={variant}
      data-state={uiState}
      className={cn(
        'rounded-lg border p-4 transition-colors duration-(--duration-normal) motion-reduce:transition-none',
        uiState === 'failed_retryable'
          ? 'border-feedback-danger-border bg-feedback-danger-background text-feedback-danger-text'
          : uiState === 'succeeded'
            ? 'border-feedback-success-border bg-feedback-success-background text-feedback-success-text'
            : 'border-ai-border bg-ai-surface text-ai-text',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 shrink-0">
            {isActive ? (
              <SpinnerIcon className="text-ai-icon" />
            ) : uiState === 'succeeded' ? (
              <CheckCircleIcon className="text-feedback-success-icon" />
            ) : (
              <AlertCircleIcon className="text-feedback-danger-icon" />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-label-lg font-medium" dir="auto">
                {title}
              </p>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium',
                  uiState === 'failed_retryable'
                    ? 'border-feedback-danger-border bg-feedback-danger-background text-feedback-danger-text'
                    : uiState === 'succeeded'
                      ? 'border-feedback-success-border bg-feedback-success-background text-feedback-success-text'
                      : 'border-feedback-info-border bg-feedback-info-background text-feedback-info-text',
                )}
              >
                {chipLabel}
              </span>
            </div>
            <p className="text-body-sm text-text-secondary" dir="auto">
              {statusText}
            </p>
            {uiState === 'failed_retryable' &&
              !/your information has been saved/i.test(statusText) && (
                <p className="text-body-sm font-medium" dir="auto">
                  Your information has been saved.
                </p>
              )}
          </div>
        </div>

        {uiState === 'failed_retryable' && canRetry && onRetryJob && (
          <Button size="sm" variant="secondary" onClick={onRetryJob}>
            Retry
          </Button>
        )}
      </div>

      {variant === 'full_section_skeleton' && isActive && (
        <div className="mt-4 space-y-3" aria-hidden="true">
          {Array.from({ length: clampedSkeletonCount }, (_, idx) => (
            <div
              key={idx}
              className={cn(
                'h-4 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none',
                idx === clampedSkeletonCount - 1 ? 'w-2/3' : 'w-full',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
