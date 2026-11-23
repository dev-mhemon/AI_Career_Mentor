'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ApiError,
  createRoadmapMerge,
  getJobStatus,
  getRoadmapMerge,
  type CareerLevel,
  type JobAcceptedDTO,
  type JobResultRefDTO,
  type JobStatusDTO,
  type MergeProposalDTO,
  type UserMergeOrigin,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AILoadingState } from '@/components/ui/ai-loading-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { AlertCircleIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';

export type MergeModalJobState =
  | {
      kind: 'active';
      job: JobAcceptedDTO;
      mode: UserMergeOrigin;
    }
  | {
      kind: 'failed';
      job: JobStatusDTO;
      mode: UserMergeOrigin;
    };

export type RequestMergeModalProps = {
  open: boolean;
  initialMode?: UserMergeOrigin;
  accessToken: string;
  roadmapId: string;
  roadmapTitle: string;
  currentTargetLevel: CareerLevel;
  currentVersionNo: number;
  roadmapGeneratorEnabled?: boolean;
  /** Optional parent-managed in-memory job state (active or terminal failed) for same-session reopen. */
  persistedJobState?: MergeModalJobState | null;
  /** Optional callback whenever the modal's in-flight or failed job state changes. */
  onJobStateChange?: (next: MergeModalJobState | null) => void;
  onClose: () => void;
  onMergeCreated: (merge: MergeProposalDTO) => void;
};

type LevelOption = {
  value: CareerLevel;
  label: string;
  description: string;
};

const ALL_LEVELS: readonly LevelOption[] = [
  {
    value: 'junior',
    label: 'Junior',
    description:
      'Core fundamentals, guided production tasks, and clean foundations.',
  },
  {
    value: 'mid',
    label: 'Mid-Level',
    description:
      'Independent delivery, reliability patterns, testing, and debugging.',
  },
  {
    value: 'senior',
    label: 'Senior',
    description:
      'System design trade-offs, scalability, observability, and architecture.',
  },
];

const CHANGE_EXAMPLES: readonly string[] = [
  'Add OpenTelemetry observability and structured logging topics',
  'Strengthen SQL indexing and query performance tuning',
  'Retire outdated legacy topics and prioritize modern testing practices',
];

const MIN_INSTRUCTION_CHARS = 3;
const MAX_INSTRUCTION_CHARS = 1_000;

function jobStorageKey(roadmapId: string): string {
  return `acm:merge-job:${roadmapId}`;
}

type StoredActiveMergeEntry = {
  job: JobAcceptedDTO;
  mode: UserMergeOrigin | null;
};

function isValidActiveMergeJob(raw: unknown): raw is JobAcceptedDTO {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const parsed = raw as Partial<JobAcceptedDTO>;
  return (
    typeof parsed.job_id === 'string' &&
    parsed.job_id.trim().length > 0 &&
    parsed.kind === 'merge_proposal' &&
    (parsed.status === 'queued' || parsed.status === 'preparing') &&
    typeof parsed.poll_url === 'string' &&
    typeof parsed.retry_after_seconds === 'number'
  );
}

function isValidUserMergeOrigin(raw: unknown): raw is UserMergeOrigin {
  return raw === 'user_request' || raw === 'level_change';
}

function readStoredMergeJob(roadmapId: string): StoredActiveMergeEntry | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(jobStorageKey(roadmapId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as
      | { job?: unknown; mode?: unknown }
      | Partial<JobAcceptedDTO>
      | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if ('job' in parsed && isValidActiveMergeJob(parsed.job)) {
      return {
        job: parsed.job,
        mode: isValidUserMergeOrigin(parsed.mode) ? parsed.mode : null,
      };
    }
    if (isValidActiveMergeJob(parsed)) {
      return { job: parsed, mode: null };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredMergeJob(
  roadmapId: string,
  entry: { job: JobAcceptedDTO; mode: UserMergeOrigin } | null,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (!entry) {
      window.sessionStorage.removeItem(jobStorageKey(roadmapId));
    } else {
      window.sessionStorage.setItem(
        jobStorageKey(roadmapId),
        JSON.stringify({ job: entry.job, mode: entry.mode }),
      );
    }
  } catch {
    // sessionStorage may be unavailable in restricted contexts
  }
}

function generateIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return '00000000-0000-4000-8000-000000000000'.replace(/[08]/g, (c) =>
    (
      Number(c) ^
      (Math.floor(Math.random() * 16) & (15 >> (Number(c) / 4)))
    ).toString(16),
  );
}

function resolveFailedJobMessage(jobStatus: JobStatusDTO): string {
  const rawMessage = jobStatus.error?.message?.trim();
  if (rawMessage) {
    return rawMessage;
  }
  if (jobStatus.error?.code) {
    return mapApiError(
      new ApiError(
        502,
        '',
        jobStatus.error.code,
        undefined,
        [],
        Boolean(jobStatus.error.retryable),
      ),
    ).message;
  }
  return "We couldn't generate this right now. Your information has been saved. Please try again.";
}

function StartDifferentRequestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium leading-none text-slate-700 shadow-xs transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        data-icon="rotate-ccw"
        className="block h-4 w-4 shrink-0"
      >
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
      <span>Start a different request</span>
    </button>
  );
}

/**
 * Dual-mode modal on Screen 15 for requesting locked-roadmap changes (`origin: 'user_request'`)
 * or transitioning target Career Level (`origin: 'level_change'`) via `EP-R08` (`202`) +
 * `EP-J01` (`AILoadingState`) -> `EP-R10` (`RoadmapDiffViewer`).
 *
 * Lifecycle guarantees:
 * - Unmounts form content when closed (`!open`) so unconfirmed draft selections and text reset
 *   cleanly without synchronous `setState` in `useEffect`.
 * - `sessionStorage` stores ONLY active in-flight jobs (`queued` / `preparing`) and is cleared
 *   immediately when a job settles to `failed` or `succeeded`, so a page reload after failure
 *   always opens cleanly to the fresh input form.
 * - Same-session reopen after a terminal failure renders the cached error card immediately
 *   without re-polling `EP-J01` or flashing `Preparing...`.
 */
export function RequestMergeModal(props: RequestMergeModalProps) {
  const { roadmapId, persistedJobState, onJobStateChange } = props;
  const [uncontrolledJobByRoadmap, setUncontrolledJobByRoadmap] = useState<
    Record<string, MergeModalJobState | null>
  >({});

  const isControlled = onJobStateChange !== undefined;
  const effectiveJobState = isControlled
    ? (persistedJobState ?? null)
    : (uncontrolledJobByRoadmap[roadmapId] ?? null);

  const handleJobStateChange = useCallback(
    (next: MergeModalJobState | null) => {
      if (isControlled) {
        onJobStateChange(next);
      } else {
        setUncontrolledJobByRoadmap((prev) => ({
          ...prev,
          [roadmapId]: next,
        }));
      }
    },
    [isControlled, onJobStateChange, roadmapId],
  );

  if (!props.open) {
    return null;
  }

  return (
    <RequestMergeModalContent
      {...props}
      jobState={effectiveJobState}
      onUpdateJobState={handleJobStateChange}
    />
  );
}

type RequestMergeModalContentProps = RequestMergeModalProps & {
  jobState: MergeModalJobState | null;
  onUpdateJobState: (next: MergeModalJobState | null) => void;
};

function RequestMergeModalContent({
  open,
  initialMode = 'user_request',
  accessToken,
  roadmapId,
  roadmapTitle,
  currentTargetLevel,
  currentVersionNo,
  roadmapGeneratorEnabled = true,
  jobState,
  onUpdateJobState,
  onClose,
  onMergeCreated,
}: RequestMergeModalContentProps) {
  const instructionId = useId();
  const modeTabListId = useId();
  const modePanelId = `${modeTabListId}-panel`;
  const mountedRef = useRef(true);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const modeTabRefs = useRef<Record<UserMergeOrigin, HTMLButtonElement | null>>({
    user_request: null,
    level_change: null,
  });

  const availableLevels = ALL_LEVELS.filter(
    (level) => level.value !== currentTargetLevel,
  );

  const modalScope = `${roadmapId}:${initialMode}:${currentTargetLevel}`;
  const [modeState, setModeState] = useState<{
    scope: string;
    mode: UserMergeOrigin;
  }>({ scope: modalScope, mode: initialMode });
  const [targetLevelState, setTargetLevelState] = useState<{
    scope: string;
    level: CareerLevel | null;
  }>({ scope: modalScope, level: null });
  const [instruction, setInstruction] = useState('');
  const [instructionTouched, setInstructionTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<MappedError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingResult, setLoadingResult] = useState(false);
  const [pendingResultState, setPendingResultState] = useState<{
    roadmapId: string;
    mergeId: string;
    mode: UserMergeOrigin;
  } | null>(null);
  const [storedActiveJobState, setStoredActiveJobState] = useState<{
    roadmapId: string;
    entry: StoredActiveMergeEntry | null;
  }>(() => ({
    roadmapId,
    entry: jobState ? null : readStoredMergeJob(roadmapId),
  }));

  const mode = modeState.scope === modalScope ? modeState.mode : initialMode;
  const selectedLevel: CareerLevel | null =
    targetLevelState.scope === modalScope &&
    targetLevelState.level !== null &&
    targetLevelState.level !== currentTargetLevel
      ? targetLevelState.level
      : null;

  // Prefer in-memory session state (active or cached failed); fall back to sessionStorage
  // ONLY for an active in-flight job resumed after a page reload.
  const storedEntry: StoredActiveMergeEntry | null =
    jobState !== null
      ? null
      : storedActiveJobState.roadmapId === roadmapId
        ? storedActiveJobState.entry
        : readStoredMergeJob(roadmapId);

  const activeJob: JobAcceptedDTO | null =
    jobState?.kind === 'active'
      ? jobState.job
      : jobState?.kind === 'failed'
        ? null
        : (storedEntry?.job ?? null);

  const failedJob: JobStatusDTO | null =
    jobState?.kind === 'failed' ? jobState.job : null;

  const pendingResult =
    pendingResultState && pendingResultState.roadmapId === roadmapId
      ? pendingResultState
      : null;

  const jobMode: UserMergeOrigin =
    jobState?.mode ?? storedEntry?.mode ?? pendingResult?.mode ?? mode;
  const hasJobView = Boolean(activeJob || failedJob || pendingResult);
  const displayMode: UserMergeOrigin = hasJobView ? jobMode : mode;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
    };
  }, []);

  const trimmedInstruction = instruction.trim();
  const charCount = Array.from(trimmedInstruction).length;

  const isUserRequestValid =
    charCount >= MIN_INSTRUCTION_CHARS && charCount <= MAX_INSTRUCTION_CHARS;
  const isLevelChangeValid =
    selectedLevel !== null &&
    selectedLevel !== currentTargetLevel &&
    (charCount === 0 ||
      (charCount >= MIN_INSTRUCTION_CHARS &&
        charCount <= MAX_INSTRUCTION_CHARS));

  const isSubmitDisabled =
    submitting ||
    loadingResult ||
    !roadmapGeneratorEnabled ||
    (mode === 'user_request' ? !isUserRequestValid : !isLevelChangeValid);

  const liveInstructionError = (() => {
    if (validationError) {
      return validationError;
    }
    if (charCount > MAX_INSTRUCTION_CHARS) {
      return mode === 'level_change'
        ? `Optional notes must be between ${MIN_INSTRUCTION_CHARS} and ${MAX_INSTRUCTION_CHARS} characters.`
        : `Instruction must be ${MAX_INSTRUCTION_CHARS} characters or fewer.`;
    }
    if (
      instructionTouched &&
      mode === 'user_request' &&
      charCount < MIN_INSTRUCTION_CHARS
    ) {
      return `Describe the change in at least ${MIN_INSTRUCTION_CHARS} characters.`;
    }
    if (
      instructionTouched &&
      mode === 'level_change' &&
      charCount > 0 &&
      charCount < MIN_INSTRUCTION_CHARS
    ) {
      return `Optional notes must be between ${MIN_INSTRUCTION_CHARS} and ${MAX_INSTRUCTION_CHARS} characters.`;
    }
    return null;
  })();

  const clearJobState = useCallback(() => {
    writeStoredMergeJob(roadmapId, null);
    setStoredActiveJobState({ roadmapId, entry: null });
    onUpdateJobState(null);
  }, [onUpdateJobState, roadmapId]);

  const setActiveJob = useCallback(
    (job: JobAcceptedDTO, currentMode: UserMergeOrigin) => {
      writeStoredMergeJob(roadmapId, { job, mode: currentMode });
      setStoredActiveJobState({
        roadmapId,
        entry: { job, mode: currentMode },
      });
      onUpdateJobState({ kind: 'active', job, mode: currentMode });
    },
    [onUpdateJobState, roadmapId],
  );

  const setFailedJob = useCallback(
    (status: JobStatusDTO, currentMode: UserMergeOrigin) => {
      writeStoredMergeJob(roadmapId, null);
      setStoredActiveJobState({ roadmapId, entry: null });
      onUpdateJobState({ kind: 'failed', job: status, mode: currentMode });
    },
    [onUpdateJobState, roadmapId],
  );

  const handleClose = () => {
    if (submitting || loadingResult) {
      return;
    }
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    setValidationError(null);
    setSubmitError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting || loadingResult || hasJobView || !roadmapGeneratorEnabled) {
      return;
    }

    if (mode === 'user_request') {
      if (charCount < MIN_INSTRUCTION_CHARS) {
        setValidationError(
          `Describe the change in at least ${MIN_INSTRUCTION_CHARS} characters.`,
        );
        return;
      }
      if (charCount > MAX_INSTRUCTION_CHARS) {
        setValidationError(
          `Instruction must be ${MAX_INSTRUCTION_CHARS} characters or fewer.`,
        );
        return;
      }
    } else {
      if (!selectedLevel || selectedLevel === currentTargetLevel) {
        setValidationError(
          'Choose a Career Level different from the current roadmap level.',
        );
        return;
      }
      if (
        charCount > 0 &&
        (charCount < MIN_INSTRUCTION_CHARS || charCount > MAX_INSTRUCTION_CHARS)
      ) {
        setValidationError(
          `Optional notes must be between ${MIN_INSTRUCTION_CHARS} and ${MAX_INSTRUCTION_CHARS} characters.`,
        );
        return;
      }
    }

    setValidationError(null);
    setSubmitError(null);
    setSubmitting(true);

    try {
      const accepted = await createRoadmapMerge(
        accessToken,
        roadmapId,
        {
          origin: mode,
          ...(mode === 'level_change' && selectedLevel
            ? { target_level: selectedLevel }
            : {}),
          ...(trimmedInstruction.length > 0
            ? { instruction: trimmedInstruction }
            : {}),
          base_version_no: currentVersionNo,
        },
        generateIdempotencyKey(),
        currentVersionNo,
      );
      if (!mountedRef.current) {
        return;
      }
      setSubmitting(false);
      setActiveJob(accepted, mode);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setSubmitting(false);
      setSubmitError(mapApiError(error));
    }
  };

  const pollMergeJobStatus = useCallback(
    async (jobId: string, signal: AbortSignal): Promise<JobStatusDTO> => {
      const nextStatus = await getJobStatus(accessToken, jobId, { signal });
      if (signal.aborted || !mountedRef.current) {
        return nextStatus;
      }
      if (nextStatus.status === 'failed') {
        setFailedJob(nextStatus, jobMode);
      } else if (nextStatus.status === 'succeeded') {
        writeStoredMergeJob(roadmapId, null);
      }
      return nextStatus;
    },
    [accessToken, jobMode, roadmapId, setFailedJob],
  );

  const loadProposalPreview = useCallback(
    async (mergeId: string, previewMode: UserMergeOrigin) => {
      if (!mergeId || !mountedRef.current) {
        return;
      }
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      setPendingResultState({ roadmapId, mergeId, mode: previewMode });
      setLoadingResult(true);
      setSubmitError(null);

      try {
        const proposal = await getRoadmapMerge(
          accessToken,
          roadmapId,
          mergeId,
          { signal: controller.signal },
        );
        if (!mountedRef.current || controller.signal.aborted) {
          return;
        }
        setLoadingResult(false);
        setPendingResultState(null);
        clearJobState();
        setInstruction('');
        onMergeCreated(proposal);
      } catch (error) {
        if (!mountedRef.current || controller.signal.aborted) {
          return;
        }
        setLoadingResult(false);
        clearJobState();
        setSubmitError(mapApiError(error));
      } finally {
        if (fetchAbortRef.current === controller) {
          fetchAbortRef.current = null;
        }
      }
    },
    [accessToken, clearJobState, onMergeCreated, roadmapId],
  );

  const handleJobSucceeded = useCallback(
    async (resultRef: JobResultRefDTO) => {
      if (!resultRef?.id || !mountedRef.current) {
        return;
      }
      await loadProposalPreview(resultRef.id, jobMode);
    },
    [jobMode, loadProposalPreview],
  );

  const handleResetJob = () => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = null;
    setLoadingResult(false);
    setPendingResultState(null);
    clearJobState();
    setSubmitError(null);
    setValidationError(null);
  };

  const selectMode = (nextMode: UserMergeOrigin) => {
    setModeState({ scope: modalScope, mode: nextMode });
    setInstructionTouched(false);
    setValidationError(null);
    setSubmitError(null);
  };

  const handleModeTabKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    current: UserMergeOrigin,
  ) => {
    if (submitting || hasJobView) {
      return;
    }
    let next: UserMergeOrigin | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      next = current === 'user_request' ? 'level_change' : 'user_request';
    } else if (e.key === 'Home') {
      next = 'user_request';
    } else if (e.key === 'End') {
      next = 'level_change';
    }
    if (!next) {
      return;
    }
    e.preventDefault();
    selectMode(next);
    modeTabRefs.current[next]?.focus();
  };

  const currentLevelLabel =
    ALL_LEVELS.find((l) => l.value === currentTargetLevel)?.label ??
    currentTargetLevel;
  const selectedLevelLabel = selectedLevel
    ? (ALL_LEVELS.find((l) => l.value === selectedLevel)?.label ??
      selectedLevel)
    : null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      disableClose={submitting || loadingResult}
      size="lg"
    >
      <Modal.Header>
        <div className="min-w-0">
          <Modal.Title>
            {displayMode === 'level_change'
              ? 'Change Career Level'
              : 'Request Roadmap Change'}
          </Modal.Title>
          <Modal.Description>
            {roadmapTitle} · Current level: {currentLevelLabel} (v
            {currentVersionNo}). Changes are prepared as a reviewable merge
            proposal—your locked roadmap never changes without your acceptance.
          </Modal.Description>
        </div>
        <Modal.Close />
      </Modal.Header>

      <Modal.Body>
        <div className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label="Merge request type"
            className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900/80"
          >
            <button
              ref={(el) => {
                modeTabRefs.current.user_request = el;
              }}
              id={`${modeTabListId}-tab-user_request`}
              type="button"
              role="tab"
              aria-selected={displayMode === 'user_request'}
              aria-controls={modePanelId}
              tabIndex={displayMode === 'user_request' ? 0 : -1}
              disabled={submitting || hasJobView}
              onClick={() => selectMode('user_request')}
              onKeyDown={(e) => handleModeTabKeyDown(e, 'user_request')}
              className={cn(
                'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-3 text-label leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                displayMode === 'user_request'
                  ? 'bg-white font-semibold text-teal-700 shadow-sm ring-1 ring-teal-200/80 dark:bg-slate-800 dark:text-teal-300 dark:ring-teal-700/60'
                  : 'font-medium text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100',
              )}
            >
              Request Change
            </button>
            <button
              ref={(el) => {
                modeTabRefs.current.level_change = el;
              }}
              id={`${modeTabListId}-tab-level_change`}
              type="button"
              role="tab"
              aria-selected={displayMode === 'level_change'}
              aria-controls={modePanelId}
              tabIndex={displayMode === 'level_change' ? 0 : -1}
              disabled={submitting || hasJobView}
              onClick={() => selectMode('level_change')}
              onKeyDown={(e) => handleModeTabKeyDown(e, 'level_change')}
              className={cn(
                'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-3 text-label leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                displayMode === 'level_change'
                  ? 'bg-white font-semibold text-teal-700 shadow-sm ring-1 ring-teal-200/80 dark:bg-slate-800 dark:text-teal-300 dark:ring-teal-700/60'
                  : 'font-medium text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100',
              )}
            >
              Change Career Level
            </button>
          </div>

          <div
            id={modePanelId}
            role="tabpanel"
            aria-labelledby={`${modeTabListId}-tab-${displayMode}`}
            className="flex flex-col gap-4"
          >

          {!roadmapGeneratorEnabled && (
            <Alert variant="info" role="status">
              Roadmap generation is currently disabled for your account. Your
              existing roadmap, daily plan, and progress remain accessible.
            </Alert>
          )}

          {submitError && (
            <Alert
              variant={
                submitError.tone === 'info'
                  ? 'info'
                  : submitError.tone === 'warning'
                    ? 'warning'
                    : 'error_retryable'
              }
              role="alert"
              retryAfterSeconds={submitError.retryAfterSeconds}
            >
              {submitError.message}
            </Alert>
          )}

          {failedJob ? (
            <div className="space-y-3">
              <section
                aria-busy="false"
                role="alert"
                data-testid="merge-job-failed-card"
                className="rounded-lg border border-feedback-danger-border bg-feedback-danger-background p-4 text-feedback-danger-text"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    <AlertCircleIcon className="block h-5 w-5 shrink-0 text-feedback-danger-icon" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-label-lg font-medium" dir="auto">
                        {jobMode === 'level_change'
                          ? 'Career Level merge proposal could not be generated'
                          : 'Roadmap merge proposal could not be generated'}
                      </p>
                      <span className="inline-flex items-center justify-center rounded-full border border-feedback-danger-border bg-feedback-danger-background px-2 py-0.5 text-2xs font-medium leading-none text-feedback-danger-text">
                        Failed
                      </span>
                    </div>
                    <p className="text-body-sm text-text-secondary" dir="auto">
                      {resolveFailedJobMessage(failedJob)}
                    </p>
                    <p className="text-body-sm font-medium">
                      Your locked roadmap and learning progress remain
                      unchanged.
                    </p>
                  </div>
                </div>
              </section>
              <div className="flex justify-end">
                <StartDifferentRequestButton onClick={handleResetJob} />
              </div>
            </div>
          ) : activeJob ? (
            <div className="space-y-3">
              <AILoadingState
                job={activeJob}
                title={
                  jobMode === 'level_change'
                    ? 'Preparing Career Level merge proposal'
                    : 'Preparing roadmap merge proposal'
                }
                variant="full_section_skeleton"
                accessToken={accessToken}
                pollJobStatus={pollMergeJobStatus}
                onJobSucceeded={(ref) => void handleJobSucceeded(ref)}
                onRetryJob={handleResetJob}
              />
              {loadingResult && (
                <p className="text-body-sm text-text-secondary" role="status">
                  Loading generated diff preview...
                </p>
              )}
            </div>
          ) : pendingResult ? (
            <div className="space-y-3 rounded-lg border border-border-default bg-surface-subtle p-4">
              <p className="text-body-sm text-text-primary">
                Your merge proposal was generated, but we couldn&apos;t load the
                preview right now. Retry loading it without creating a duplicate
                request.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={loadingResult}
                  onClick={handleClose}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={loadingResult}
                  loadingText="Loading proposal..."
                  onClick={() =>
                    void loadProposalPreview(
                      pendingResult.mergeId,
                      pendingResult.mode,
                    )
                  }
                >
                  Retry Loading Proposal
                </Button>
              </div>
            </div>
          ) : (
            <>
              {mode === 'level_change' && (
                <div className="space-y-3">
                  <fieldset className="space-y-2.5">
                    <legend className="text-label font-medium text-text-primary">
                      Select new target Career Level{' '}
                      <span className="text-rose-600" aria-hidden="true">
                        *
                      </span>
                    </legend>

                    <div
                      data-testid="level-transition-badge"
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/60"
                    >
                      <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium leading-none text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        Current: {currentLevelLabel}
                      </span>
                      <span
                        aria-hidden="true"
                        className="font-semibold leading-none text-slate-400"
                      >
                        →
                      </span>
                      {selectedLevelLabel ? (
                        <span className="inline-flex items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 font-semibold leading-none text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                          Proposed: {selectedLevelLabel}
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center rounded-full border border-dashed border-slate-300 bg-white px-2.5 py-1 font-medium leading-none text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                          Select a level
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {availableLevels.map((option) => {
                        const isSelected = selectedLevel === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={submitting || !roadmapGeneratorEnabled}
                            onClick={() => {
                              setTargetLevelState({
                                scope: modalScope,
                                level: option.value,
                              });
                              setValidationError(null);
                            }}
                            className={cn(
                              'flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                              isSelected
                                ? 'border-teal-500 bg-teal-50/40 ring-1 ring-teal-500/30 dark:border-teal-500/70 dark:bg-teal-950/25'
                                : 'border-border-default bg-surface-default hover:border-slate-300 hover:bg-surface-subtle dark:hover:border-slate-700',
                            )}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-2 leading-none">
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                    isSelected
                                      ? 'border-teal-600 bg-teal-600 dark:border-teal-400 dark:bg-teal-400'
                                      : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900',
                                  )}
                                >
                                  {isSelected && (
                                    <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-slate-950" />
                                  )}
                                </span>
                                <span className="text-label font-semibold text-text-primary">
                                  {option.label}
                                </span>
                              </span>
                              {isSelected && (
                                <span className="inline-flex shrink-0 items-center justify-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold leading-none text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                                  Proposed target
                                </span>
                              )}
                            </div>
                            <span className="pl-6 text-caption text-text-secondary">
                              {option.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="rounded-lg border border-feedback-info-border bg-feedback-info-background/70 p-3.5 text-body-sm text-feedback-info-text">
                    Your roadmap evolves in place without archiving. Existing
                    completed days and learning evidence remain preserved, and
                    skill states at the new level are evaluated against that
                    level’s requirements.
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={instructionId}
                    className="text-label font-medium text-text-primary"
                  >
                    {mode === 'level_change' ? (
                      'Additional focus notes (optional)'
                    ) : (
                      <>
                        What would you like to change?{' '}
                        <span className="text-rose-600" aria-hidden="true">
                          *
                        </span>
                      </>
                    )}
                  </label>
                  <span
                    className={cn(
                      'text-caption font-mono',
                      charCount > MAX_INSTRUCTION_CHARS
                        ? 'text-text-danger'
                        : 'text-text-muted',
                    )}
                  >
                    {charCount} / {MAX_INSTRUCTION_CHARS}
                  </span>
                </div>

                <textarea
                  id={instructionId}
                  rows={4}
                  required={mode === 'user_request'}
                  aria-required={mode === 'user_request' ? 'true' : undefined}
                  value={instruction}
                  disabled={submitting || !roadmapGeneratorEnabled}
                  onChange={(e) => {
                    setInstruction(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  onBlur={() => setInstructionTouched(true)}
                  placeholder={
                    mode === 'level_change'
                      ? 'Optional: emphasize distributed systems, architecture reviews, or specific tools...'
                      : 'e.g. Add OpenTelemetry observability and retire outdated topics...'
                  }
                  aria-invalid={liveInstructionError ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-lg border bg-surface-default px-3.5 py-2.5 text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus/40 disabled:cursor-not-allowed disabled:opacity-60',
                    liveInstructionError
                      ? 'border-border-danger'
                      : 'border-border-default focus:border-border-focus',
                  )}
                />

                {liveInstructionError ? (
                  <p role="alert" className="text-caption text-text-danger">
                    {liveInstructionError}
                  </p>
                ) : mode === 'user_request' ? (
                  <p className="text-caption text-text-muted">
                    Enter at least {MIN_INSTRUCTION_CHARS} characters to
                    generate a merge proposal.
                  </p>
                ) : null}

                {mode === 'user_request' && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-caption text-text-muted">Examples:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CHANGE_EXAMPLES.map((example) => (
                        <button
                          key={example}
                          type="button"
                          disabled={submitting || !roadmapGeneratorEnabled}
                          onClick={() => {
                            setInstruction(example);
                            setValidationError(null);
                          }}
                          className="inline-flex cursor-pointer items-center rounded-md border border-border-default bg-surface-subtle px-2.5 py-1 text-left text-2xs leading-snug text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          </div>
        </div>
      </Modal.Body>

      {!hasJobView && (
        <Modal.Footer>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={handleClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={submitting}
            loadingText="Submitting request..."
            disabled={isSubmitDisabled}
            onClick={() => void handleSubmit()}
            className="disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mode === 'level_change'
              ? 'Generate Level Change Proposal'
              : 'Generate Merge Proposal'}
          </Button>
        </Modal.Footer>
      )}
    </Modal>
  );
}
