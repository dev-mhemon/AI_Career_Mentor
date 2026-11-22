'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  createIdempotencyKey,
  generateRoadmap,
  getJobStatus,
  type CareerLevel,
  type GenerateRoadmapRequestDTO,
  type JobAcceptedDTO,
  type JobResultRefDTO,
  type JobStatusDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AILoadingState } from '@/components/ui/ai-loading-state';
import { Alert } from '@/components/ui/alert';
import { Button, type ButtonSize } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { SparklesIcon } from '@/components/ui/icons';

export interface RoadmapGenerateHandoffProps {
  /** Authenticated Bearer token passed from a Server Component or verified client session. */
  accessToken?: string;
  /** Confirmed career goal UUID (`EP-R01` `career_goal_id`). */
  careerGoalId: string;
  /** Target career level (`junior` | `mid` | `senior`), required by `EP-R01`. */
  targetLevel: CareerLevel;
  /** Explicit level confirmation flag (`true` required by `EP-R01`). */
  levelConfirmed?: boolean;
  /** Feature gate status from `effective_access.roadmap_generator`. */
  featureEnabled?: boolean;
  /** Disables the trigger control externally (e.g. incomplete prerequisite form). */
  disabled?: boolean;
  /** Custom CTA label. */
  buttonLabel?: string;
  /** CTA button size (`md` default for standalone onboarding; `sm` for compact card footers). */
  buttonSize?: ButtonSize;
  /** Optional custom `EP-R01` invoker (e.g. via Server Action glue when `accessToken` is kept server-side). */
  onGenerateRoadmap?: (
    body: GenerateRoadmapRequestDTO,
    idempotencyKey: string,
  ) => Promise<JobAcceptedDTO>;
  /** Optional navigation override (defaults to `router.push('/roadmaps/${id}/draft')`). */
  onNavigateToDraft?: (roadmapId: string) => void;
  /** Optional custom job poller for tests or Server Action glue. */
  pollJobStatus?: (jobId: string, signal: AbortSignal) => Promise<JobStatusDTO>;
  /** Optional layout compositor for embedding the trigger and conditional status slot in a card footer. */
  renderLayout?: (parts: {
    trigger: ReactNode;
    status: ReactNode | null;
    isGenerating: boolean;
  }) => ReactNode;
  className?: string;
}

const DETERMINISTIC_HTTP_STATUSES = new Set([400, 403, 404, 409, 422]);

/**
 * Reusable `EP-R01` (`POST /api/v1/roadmaps/generate`) + `EP-J01` (`AILoadingState`) handoff
 * for Screen 11 (`/onboarding/clarify`) or any confirmed goal entry point.
 * Navigates to `/roadmaps/[id]/draft` only after the background job reaches `succeeded`.
 */
export function RoadmapGenerateHandoff({
  accessToken = '',
  careerGoalId,
  targetLevel,
  levelConfirmed = true,
  featureEnabled = true,
  disabled = false,
  buttonLabel = 'Generate Roadmap Draft',
  buttonSize = 'md',
  onGenerateRoadmap,
  onNavigateToDraft,
  pollJobStatus,
  renderLayout,
  className,
}: RoadmapGenerateHandoffProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [acceptedJob, setAcceptedJob] = useState<JobAcceptedDTO | null>(null);
  const [jobTerminated, setJobTerminated] = useState(false);
  const [mappedError, setMappedError] = useState<MappedError | null>(null);
  const [errorResetKey, setErrorResetKey] = useState(0);

  // Reuses the same client UUID only when retrying an ambiguous/transient HTTP submission
  // of the identical payload; cleared on `202` acceptance, deterministic rejection, or confirmed `429 RATE_LIMITED`.
  const pendingKeyRef = useRef<{ signature: string; key: string } | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const navigateToDraft = (roadmapId: string) => {
    if (onNavigateToDraft) {
      onNavigateToDraft(roadmapId);
      return;
    }
    router.push(`/roadmaps/${encodeURIComponent(roadmapId)}/draft`);
  };

  const startGeneration = async (forceFreshKey: boolean) => {
    const trimmedGoalId = careerGoalId.trim();
    if (
      !trimmedGoalId ||
      !targetLevel ||
      levelConfirmed !== true ||
      !featureEnabled ||
      disabled ||
      submitting
    ) {
      return;
    }

    const payload: GenerateRoadmapRequestDTO = {
      career_goal_id: trimmedGoalId,
      target_level: targetLevel,
      level_confirmed: true,
    };
    const signature = JSON.stringify(payload);
    const idempotencyKey =
      !forceFreshKey && pendingKeyRef.current?.signature === signature
        ? pendingKeyRef.current.key
        : createIdempotencyKey();

    pendingKeyRef.current = { signature, key: idempotencyKey };
    setSubmitting(true);
    setMappedError(null);

    try {
      const job = onGenerateRoadmap
        ? await onGenerateRoadmap(payload, idempotencyKey)
        : await generateRoadmap(accessToken, payload, idempotencyKey);
      pendingKeyRef.current = null;
      activeJobIdRef.current = job.job_id;
      setJobTerminated(false);
      setAcceptedJob(job);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (DETERMINISTIC_HTTP_STATUSES.has(err.statusCode) ||
          (err.statusCode === 429 && err.code === 'RATE_LIMITED'))
      ) {
        pendingKeyRef.current = null;
      }
      setMappedError(mapApiError(err));
      setErrorResetKey((prev) => prev + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleJobSucceeded = (resultRef: JobResultRefDTO) => {
    const roadmapId = resultRef?.id?.trim();
    if (!roadmapId) {
      setMappedError({
        message: 'Your roadmap was generated, but its identifier was missing. Open Roadmaps to view it.',
        tone: 'warning',
        status: null,
        fieldErrors: {},
        retryAfterSeconds: null,
        retryable: false,
        requiresSignIn: false,
      });
      return;
    }
    navigateToDraft(roadmapId);
  };

  const wrappedPollJobStatus = async (
    jobId: string,
    signal: AbortSignal,
  ): Promise<JobStatusDTO> => {
    const status = pollJobStatus
      ? await pollJobStatus(jobId, signal)
      : await getJobStatus(accessToken, jobId, { signal });
    if (
      isMountedRef.current &&
      !signal.aborted &&
      activeJobIdRef.current === jobId &&
      (status.status === 'failed' || status.status === 'succeeded')
    ) {
      setJobTerminated(true);
    }
    return status;
  };

  const isJobActive =
    acceptedJob !== null &&
    !jobTerminated &&
    (acceptedJob.status === 'queued' || acceptedJob.status === 'preparing');

  const hasStatusContent = !featureEnabled || mappedError !== null || acceptedJob !== null;
  const statusSlot = hasStatusContent ? (
    <>
      {!featureEnabled && (
        <Alert variant="info" role="status" title="Roadmap generation paused">
          New roadmap generation is currently disabled. Your existing roadmaps, versions, and learning progress remain accessible.
        </Alert>
      )}

      {mappedError && (
        <Alert
          variant={mappedError.tone === 'info' ? 'info' : mappedError.tone === 'warning' ? 'warning' : 'error_retryable'}
          role="alert"
          retryAfterSeconds={mappedError.retryAfterSeconds}
          resetKey={errorResetKey}
          onRetry={
            mappedError.retryable && featureEnabled && !disabled
              ? () => void startGeneration(false)
              : undefined
          }
          retryLabel="Try Again"
        >
          {mappedError.message}
        </Alert>
      )}

      {acceptedJob ? (
        <AILoadingState
          job={acceptedJob}
          title="Generating your roadmap draft"
          variant="full_section_skeleton"
          accessToken={accessToken}
          pollJobStatus={wrappedPollJobStatus}
          onJobSucceeded={handleJobSucceeded}
          onRetryJob={() => void startGeneration(true)}
        />
      ) : null}
    </>
  ) : null;

  const triggerButton = (
    <Button
      type="button"
      variant="primary"
      size={buttonSize}
      loading={submitting}
      loadingText="Starting generation..."
      disabled={
        !featureEnabled ||
        disabled ||
        !careerGoalId.trim() ||
        !targetLevel ||
        levelConfirmed !== true ||
        submitting ||
        isJobActive
      }
      onClick={() => void startGeneration(false)}
      className={cn(
        'leading-none whitespace-nowrap',
        buttonSize === 'sm' && 'h-9 rounded-xl px-3.5 py-2 text-sm',
      )}
    >
      <SparklesIcon
        className="block h-4 w-4 shrink-0"
        aria-hidden="true"
        data-icon="sparkles"
      />
      <span>{buttonLabel}</span>
    </Button>
  );

  if (renderLayout) {
    return (
      <>
        {renderLayout({
          trigger: triggerButton,
          status: statusSlot,
          isGenerating: submitting || isJobActive,
        })}
      </>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {statusSlot}
      <div className="flex flex-wrap items-center gap-3">{triggerButton}</div>
    </div>
  );
}
