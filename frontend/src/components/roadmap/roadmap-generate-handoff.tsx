'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  createIdempotencyKey,
  generateRoadmap,
  type CareerLevel,
  type GenerateRoadmapRequestDTO,
  type JobAcceptedDTO,
  type JobResultRefDTO,
  type JobStatusDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AILoadingState } from '@/components/ui/ai-loading-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { CompassIcon } from '@/components/ui/icons';

export interface RoadmapGenerateHandoffProps {
  /** Authenticated Bearer token passed from a Server Component or verified client session. */
  accessToken: string;
  /** Confirmed career goal UUID (`EP-R01` `career_goal_id`). */
  careerGoalId: string;
  /** Optional target career level (`junior` | `mid` | `senior`). */
  targetLevel?: CareerLevel;
  /** Explicit confirmation flag when supplying `targetLevel`. */
  levelConfirmed?: boolean;
  /** Feature gate status from `effective_access.roadmap_generator`. */
  featureEnabled?: boolean;
  /** Disables the trigger control externally (e.g. incomplete prerequisite form). */
  disabled?: boolean;
  /** Custom CTA label. */
  buttonLabel?: string;
  /** Optional navigation override (defaults to `router.push('/roadmaps/${id}/draft')`). */
  onNavigateToDraft?: (roadmapId: string) => void;
  /** Optional custom job poller for tests. */
  pollJobStatus?: (jobId: string, signal: AbortSignal) => Promise<JobStatusDTO>;
  className?: string;
}

const DETERMINISTIC_HTTP_STATUSES = new Set([400, 403, 404, 409, 422]);

/**
 * Reusable `EP-R01` (`POST /api/v1/roadmaps/generate`) + `EP-J01` (`AILoadingState`) handoff
 * for Screen 11 (`/onboarding/clarify`) or any confirmed goal entry point.
 * Navigates to `/roadmaps/[id]/draft` only after the background job reaches `succeeded`.
 */
export function RoadmapGenerateHandoff({
  accessToken,
  careerGoalId,
  targetLevel,
  levelConfirmed,
  featureEnabled = true,
  disabled = false,
  buttonLabel = 'Generate Roadmap Draft',
  onNavigateToDraft,
  pollJobStatus,
  className,
}: RoadmapGenerateHandoffProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [acceptedJob, setAcceptedJob] = useState<JobAcceptedDTO | null>(null);
  const [mappedError, setMappedError] = useState<MappedError | null>(null);
  const [errorResetKey, setErrorResetKey] = useState(0);

  // Reuses the same client UUID only when retrying an ambiguous/transient HTTP submission
  // of the identical payload; cleared on `202` acceptance or deterministic rejection.
  const pendingKeyRef = useRef<{ signature: string; key: string } | null>(null);

  const navigateToDraft = (roadmapId: string) => {
    if (onNavigateToDraft) {
      onNavigateToDraft(roadmapId);
      return;
    }
    router.push(`/roadmaps/${encodeURIComponent(roadmapId)}/draft`);
  };

  const startGeneration = async (forceFreshKey: boolean) => {
    const trimmedGoalId = careerGoalId.trim();
    if (!trimmedGoalId || !featureEnabled || disabled || submitting) {
      return;
    }

    const payload: GenerateRoadmapRequestDTO = {
      career_goal_id: trimmedGoalId,
      ...(targetLevel ? { target_level: targetLevel } : {}),
      ...(levelConfirmed !== undefined ? { level_confirmed: levelConfirmed } : {}),
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
      const job = await generateRoadmap(accessToken, payload, idempotencyKey);
      pendingKeyRef.current = null;
      setAcceptedJob(job);
    } catch (err) {
      if (
        err instanceof ApiError &&
        DETERMINISTIC_HTTP_STATUSES.has(err.statusCode)
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

  const isJobActive =
    acceptedJob !== null &&
    (acceptedJob.status === 'queued' || acceptedJob.status === 'preparing');

  return (
    <div className={cn('flex flex-col gap-4', className)}>
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
          pollJobStatus={pollJobStatus}
          onJobSucceeded={handleJobSucceeded}
          onRetryJob={() => void startGeneration(true)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="md"
          loading={submitting}
          loadingText="Starting generation..."
          disabled={
            !featureEnabled ||
            disabled ||
            !careerGoalId.trim() ||
            submitting ||
            isJobActive
          }
          onClick={() => void startGeneration(false)}
        >
          <CompassIcon className="h-4 w-4" aria-hidden="true" />
          <span>{buttonLabel}</span>
        </Button>
      </div>
    </div>
  );
}
