'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  createIdempotencyKey,
  getRoadmap,
  lockRoadmap,
  reviseRoadmap,
  type CareerLevel,
  type ItemPriority,
  type JobAcceptedDTO,
  type JobStatusDTO,
  type LockRoadmapDTO,
  type RevisionRequestDTO,
  type RoadmapDetailDTO,
  type RoadmapItemDTO,
  type RoadmapPhaseDTO,
  type SkillGapType,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { AILoadingState } from '@/components/ui/ai-loading-state';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/components/ui/cn';
import {
  ChevronRightIcon,
  LockIcon,
  SparklesIcon,
  WarningIcon,
} from '@/components/ui/icons';

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
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
      data-icon="arrow-left"
      className={cn('block shrink-0', className)}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export interface RoadmapDraftViewProps {
  accessToken: string;
  roadmapId: string;
  featureEnabled?: boolean;
  initialDraft?: RoadmapDetailDTO;
  pollJobStatus?: (jobId: string, signal: AbortSignal) => Promise<JobStatusDTO>;
  onLockedNavigate?: (roadmapId: string) => void;
}

type DraftFetchState =
  | { key: string; status: 'loaded'; draft: RoadmapDetailDTO }
  | { key: string; status: 'error'; error: MappedError };

type ActiveDraftJob =
  | { kind: 'refresh'; job: JobAcceptedDTO }
  | { kind: 'revision'; job: JobAcceptedDTO }
  | null;

const MAX_REVISION_CODEPOINTS = 2000;
const DETERMINISTIC_HTTP_STATUSES = new Set([400, 403, 404, 409, 422]);

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

const PRIORITY_BADGE_CLASSES: Record<ItemPriority, string> = {
  core: 'border-priority-core-border bg-priority-core-background text-priority-core-text',
  supporting:
    'border-priority-supporting-border bg-priority-supporting-background text-priority-supporting-text',
  optional:
    'border-priority-optional-border bg-priority-optional-background text-priority-optional-text',
};

const PRIORITY_LABELS: Record<ItemPriority, string> = {
  core: 'Core',
  supporting: 'Supporting',
  optional: 'Optional',
};

const GAP_BADGE_CLASSES: Record<SkillGapType, string> = {
  existing:
    'border-gap-existing-border bg-gap-existing-background text-gap-existing-text',
  transferable:
    'border-gap-transferable-border bg-gap-transferable-background text-gap-transferable-text',
  refresh:
    'border-gap-refresh-border bg-gap-refresh-background text-gap-refresh-text',
  strengthen:
    'border-gap-strengthen-border bg-gap-strengthen-background text-gap-strengthen-text',
  missing:
    'border-gap-missing-border bg-gap-missing-background text-gap-missing-text',
};

const GAP_LABELS: Record<SkillGapType, string> = {
  existing: 'Existing Skill',
  transferable: 'Transferable',
  refresh: 'Refresh',
  strengthen: 'Strengthen',
  missing: 'New Skill',
};

const secondaryLinkClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-action-secondary-border bg-action-secondary-background px-3.5 py-2 text-label font-medium leading-none text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active motion-reduce:transition-none';

function hasNulOrUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) {
      return true;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) {
        return true;
      }
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeExternalUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function sortPhasesAndItems(
  draft: RoadmapDetailDTO,
): {
  phases: RoadmapPhaseDTO[];
  titleById: Map<string, string>;
} {
  const titleById = new Map<string, string>();
  const allItems = [...draft.items];
  for (const phase of draft.phases) {
    for (const item of phase.items) {
      if (!allItems.some((existing) => existing.item_id === item.item_id)) {
        allItems.push(item);
      }
    }
  }
  for (const item of allItems) {
    if (item.item_id) titleById.set(item.item_id, item.title);
    if (item.id) titleById.set(item.id, item.title);
    if (item.lineage_id) titleById.set(item.lineage_id, item.title);
  }

  const phases = [...draft.phases]
    .sort((a, b) => a.phase_no - b.phase_no)
    .map((phase) => ({
      ...phase,
      items: [...phase.items]
        .filter((item) => !item.retired)
        .sort((a, b) => a.sequence_no - b.sequence_no),
    }));

  return { phases, titleById };
}

function resolvePrerequisites(
  item: RoadmapItemDTO,
  titleById: Map<string, string>,
): string[] {
  const refs =
    item.depends_on.length > 0 ? item.depends_on : item.depends_on_lineage_ids;
  const resolved: string[] = [];
  for (const ref of refs) {
    const label = titleById.get(ref);
    if (label && !resolved.includes(label)) {
      resolved.push(label);
    }
  }
  return resolved;
}

/**
 * Screen 12 (`/roadmaps/[id]/draft`): reviews AI-generated Draft Roadmap,
 * handles stale-draft refresh (`EP-R04`), submits bounded Unicode revision instructions
 * with async `AILoadingState` polling (`EP-J01`), and executes atomic Lock (`EP-R05`).
 */
export function RoadmapDraftView({
  accessToken,
  roadmapId,
  featureEnabled = true,
  initialDraft,
  pollJobStatus,
  onLockedNavigate,
}: RoadmapDraftViewProps) {
  const router = useRouter();
  const instructionId = useId();
  const instructionHelpId = useId();
  const instructionErrorId = useId();

  const [reloadTick, setReloadTick] = useState(0);
  const [fetchState, setFetchState] = useState<DraftFetchState | null>(null);
  const [instruction, setInstruction] = useState('');
  const [instructionError, setInstructionError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveDraftJob>(null);
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [lockState, setLockState] = useState<'idle' | 'locking' | 'navigating'>('idle');
  const locking = lockState !== 'idle';
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [forceLargeConfirm, setForceLargeConfirm] = useState(false);
  const [actionError, setActionError] = useState<MappedError | null>(null);
  const [actionErrorResetKey, setActionErrorResetKey] = useState(0);

  const pendingRevisionKeyRef = useRef<{ signature: string; key: string } | null>(
    null,
  );
  const pendingLockKeyRef = useRef<{ signature: string; key: string } | null>(
    null,
  );

  const requestKey = `${accessToken}:${roadmapId}:${reloadTick}`;
  const seededDraft =
    initialDraft && initialDraft.id === roadmapId && reloadTick === 0
      ? initialDraft
      : null;

  useEffect(() => {
    if (seededDraft) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    getRoadmap(accessToken, roadmapId, 'draft', { signal: controller.signal })
      .then((draft) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'loaded',
          draft,
        });
      })
      .catch((err) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        setFetchState({
          key: requestKey,
          status: 'error',
          error: mapApiError(err),
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, requestKey, roadmapId, seededDraft]);

  const activeState =
    fetchState && fetchState.key === requestKey
      ? fetchState
      : seededDraft
        ? { key: requestKey, status: 'loaded' as const, draft: seededDraft }
        : null;

  const isLoading = activeState === null;
  const draft = activeState?.status === 'loaded' ? activeState.draft : null;
  const loadError = activeState?.status === 'error' ? activeState.error : null;

  const { phases, titleById } = useMemo(
    () =>
      draft
        ? sortPhasesAndItems(draft)
        : { phases: [], titleById: new Map<string, string>() },
    [draft],
  );

  const rawCodePointCount = Array.from(instruction).length;
  const trimmedInstruction = instruction.trim();
  const trimmedCodePointCount = Array.from(trimmedInstruction).length;

  const dispatchRevision = async (
    kind: 'refresh' | 'revision',
    body: RevisionRequestDTO,
    forceFreshKey: boolean,
  ) => {
    if (!featureEnabled || submittingRevision || activeJob || locking) {
      return;
    }

    const signature = `${kind}:${JSON.stringify(body)}`;
    const idempotencyKey =
      !forceFreshKey && pendingRevisionKeyRef.current?.signature === signature
        ? pendingRevisionKeyRef.current.key
        : createIdempotencyKey();

    pendingRevisionKeyRef.current = { signature, key: idempotencyKey };
    setSubmittingRevision(true);
    setActionError(null);

    try {
      const job = await reviseRoadmap(
        accessToken,
        roadmapId,
        body,
        idempotencyKey,
      );
      pendingRevisionKeyRef.current = null;
      setActiveJob({ kind, job });
    } catch (err) {
      if (
        err instanceof ApiError &&
        DETERMINISTIC_HTTP_STATUSES.has(err.statusCode)
      ) {
        pendingRevisionKeyRef.current = null;
      }
      setActionError(mapApiError(err));
      setActionErrorResetKey((prev) => prev + 1);
    } finally {
      setSubmittingRevision(false);
    }
  };

  const handleRevisionSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft) {
      return;
    }
    if (trimmedCodePointCount < 1) {
      setInstructionError('Enter revision instructions between 1 and 2000 characters.');
      return;
    }
    if (
      rawCodePointCount > MAX_REVISION_CODEPOINTS ||
      trimmedCodePointCount > MAX_REVISION_CODEPOINTS
    ) {
      setInstructionError(
        `Revision instruction must not exceed ${MAX_REVISION_CODEPOINTS} characters.`,
      );
      return;
    }
    if (hasNulOrUnpairedSurrogate(instruction)) {
      setInstructionError('Revision instruction contains unsupported control characters.');
      return;
    }

    setInstructionError(null);
    void dispatchRevision(
      'revision',
      {
        instruction: trimmedInstruction,
        expected_version_no: draft.version_no,
      },
      false,
    );
  };

  const handleRefreshStaleDraft = () => {
    if (!draft) {
      return;
    }
    void dispatchRevision(
      'refresh',
      {
        refresh_stale: true,
        expected_version_no: draft.version_no,
      },
      false,
    );
  };

  const handleJobSucceeded = () => {
    setActiveJob(null);
    setInstruction('');
    setInstructionError(null);
    setActionError(null);
    setConfirmLarge(false);
    setForceLargeConfirm(false);
    setReloadTick((prev) => prev + 1);
  };

  const handleRetryActiveJob = () => {
    if (!draft || !activeJob) {
      return;
    }
    const kind = activeJob.kind;
    setActiveJob(null);
    if (kind === 'refresh') {
      void dispatchRevision(
        'refresh',
        {
          refresh_stale: true,
          expected_version_no: draft.version_no,
        },
        true,
      );
      return;
    }
    if (trimmedCodePointCount >= 1 && trimmedCodePointCount <= MAX_REVISION_CODEPOINTS) {
      void dispatchRevision(
        'revision',
        {
          instruction: trimmedInstruction,
          expected_version_no: draft.version_no,
        },
        true,
      );
    }
  };

  const handleLockRoadmap = async () => {
    if (!draft || !featureEnabled || draft.stale || locking || activeJob) {
      return;
    }

    const requiresLargeAck =
      draft.size_guardrail.materially_large || forceLargeConfirm;
    if (requiresLargeAck && !confirmLarge) {
      return;
    }

    const payload: LockRoadmapDTO = {
      expected_version_no: draft.version_no,
      ...(confirmLarge ? { confirm_large_roadmap: true } : {}),
    };
    const signature = JSON.stringify(payload);
    const idempotencyKey =
      pendingLockKeyRef.current?.signature === signature
        ? pendingLockKeyRef.current.key
        : createIdempotencyKey();

    pendingLockKeyRef.current = { signature, key: idempotencyKey };
    setLockState('locking');
    setActionError(null);

    try {
      const locked = await lockRoadmap(
        accessToken,
        roadmapId,
        payload,
        idempotencyKey,
      );
      pendingLockKeyRef.current = null;
      setLockState('navigating');
      if (onLockedNavigate) {
        onLockedNavigate(locked.roadmap_id);
        return;
      }
      router.replace(`/roadmaps/${encodeURIComponent(locked.roadmap_id)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (DETERMINISTIC_HTTP_STATUSES.has(err.statusCode)) {
          pendingLockKeyRef.current = null;
        }
        if (err.code === 'LARGE_ROADMAP_CONFIRMATION_REQUIRED') {
          setForceLargeConfirm(true);
        }
      }
      setActionError(mapApiError(err));
      setActionErrorResetKey((prev) => prev + 1);
      setLockState('idle');
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-6"
        >
          <span className="sr-only">Loading roadmap draft...</span>
          <div className="h-7 w-1/2 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-4 w-2/3 rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          <div className="h-24 w-full rounded bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
        </div>
      </main>
    );
  }

  if (loadError || !draft) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
        <Alert
          variant={loadError?.code === 'NO_OPEN_DRAFT' ? 'warning' : 'error_retryable'}
          role="alert"
          title="Draft Roadmap unavailable"
          retryAfterSeconds={loadError?.retryAfterSeconds ?? null}
          onRetry={
            loadError?.retryable
              ? () => setReloadTick((prev) => prev + 1)
              : undefined
          }
        >
          {loadError?.message ?? 'Could not load this roadmap draft.'}
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Link href="/roadmaps" className={secondaryLinkClass}>
            Back to Roadmaps
          </Link>
          <Link
            href={`/roadmaps/${encodeURIComponent(roadmapId)}`}
            className={secondaryLinkClass}
          >
            View Roadmap
          </Link>
        </div>
      </main>
    );
  }

  const requiresLargeConfirmation =
    draft.size_guardrail.materially_large || forceLargeConfirm;
  const lockDisabled =
    draft.stale ||
    !featureEnabled ||
    Boolean(activeJob) ||
    locking ||
    (requiresLargeConfirmation && !confirmLarge);
  const canSubmitRevision =
    featureEnabled &&
    !submittingRevision &&
    !activeJob &&
    !locking &&
    trimmedCodePointCount >= 1 &&
    rawCodePointCount <= MAX_REVISION_CODEPOINTS &&
    trimmedCodePointCount <= MAX_REVISION_CODEPOINTS;
  const uniqueWarnings = Array.from(new Set(draft.warnings.filter(Boolean)));
  const isStaleVersionOrDraft =
    actionError?.code === 'STALE_VERSION' || actionError?.code === 'DRAFT_STALE';

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 border-b border-border-default pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm leading-none">
              <li className="inline-flex items-center gap-1.5 leading-none">
                <Link
                  href="/roadmaps"
                  className="inline-flex items-center gap-1.5 leading-none font-medium text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-400 dark:hover:text-teal-300"
                >
                  <ArrowLeftIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Roadmaps</span>
                </Link>
              </li>
              <li
                aria-hidden="true"
                className="inline-flex items-center leading-none text-slate-400"
              >
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </li>
              <li className="inline-flex items-center gap-1.5 leading-none">
                <Link
                  href={`/roadmaps/${encodeURIComponent(draft.id)}`}
                  className="inline-flex items-center leading-none font-medium text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-400 dark:hover:text-teal-300"
                  dir="auto"
                >
                  {draft.role_name}
                </Link>
              </li>
              <li
                aria-hidden="true"
                className="inline-flex items-center leading-none text-slate-400"
              >
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </li>
              <li
                aria-current="page"
                className="inline-flex items-center leading-none font-medium text-slate-500 dark:text-slate-400"
              >
                Draft Review
              </li>
            </ol>
          </nav>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-heading-xl font-semibold text-text-primary" dir="auto">
              {draft.role_name}
            </h1>
            <span className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-caption font-medium leading-none text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/50 dark:text-amber-200">
              Draft v{draft.version_no}
            </span>
            <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-medium leading-none text-text-secondary">
              {LEVEL_LABELS[draft.target_level] ?? draft.target_level}
            </span>
            <span
              className={cn(
                'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-caption font-medium leading-none',
                draft.size_guardrail.materially_large
                  ? 'border-feedback-warning-border bg-feedback-warning-background text-feedback-warning-text'
                  : 'border-border-default bg-surface-subtle text-text-secondary',
              )}
            >
              {draft.size_guardrail.active_topic_count} /{' '}
              {draft.size_guardrail.soft_max_topics} topics
            </span>
          </div>
          <p className="mt-1 text-body-sm text-text-secondary">
            Review the AI-generated phases and prerequisites, request structured revisions if needed, and lock when ready.
          </p>
        </div>

        <Link href="/roadmaps" className={secondaryLinkClass}>
          All Roadmaps
        </Link>
      </header>

      {!featureEnabled && (
        <Alert variant="info" role="status" title="Roadmap generation is temporarily disabled">
          You can read this existing draft in full, while AI revisions and locking are paused until generation is re-enabled.
        </Alert>
      )}

      {draft.stale && (
        <Alert
          variant="warning"
          role="alert"
          title="Stale draft — refresh required before locking"
          action={{
            label: submittingRevision ? 'Refreshing...' : 'Refresh Stale Draft',
            onClick: handleRefreshStaleDraft,
          }}
        >
          <p>
            {draft.stale_reason ||
              'Your saved profile skills or career goal changed since this draft was generated. Refresh the draft to align with your latest profile before locking.'}
          </p>
        </Alert>
      )}

      {draft.size_guardrail.materially_large && (
        <Alert
          variant="warning"
          role="status"
          title={`Large roadmap guardrail (${draft.size_guardrail.active_topic_count} topics)`}
        >
          {draft.size_guardrail.warning ||
            `This roadmap contains ${draft.size_guardrail.active_topic_count} active topics (above the recommended soft cap of ${draft.size_guardrail.soft_max_topics}). Explicit confirmation is required to lock it.`}
        </Alert>
      )}

      {uniqueWarnings.length > 0 && (
        <Alert variant="warning" role="status" title="Review notes">
          <ul className="list-disc space-y-1 pl-4">
            {uniqueWarnings.map((warning) => (
              <li key={warning} dir="auto">
                {warning}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <section
        aria-labelledby="draft-review-actions-heading"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col gap-3.5 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <h2
              id="draft-review-actions-heading"
              className="text-heading-md font-semibold text-text-primary"
            >
              Review &amp; Finalize Draft
            </h2>
            <p className="mt-1 text-body-sm text-text-secondary">
              Lock Draft v{draft.version_no} into a tracked roadmap (Daily Plan is configured separately), or request an AI revision below.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:items-center sm:gap-2.5">
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={locking}
              loadingText={
                lockState === 'navigating'
                  ? 'Opening roadmap...'
                  : 'Locking roadmap...'
              }
              disabled={lockDisabled}
              onClick={() => void handleLockRoadmap()}
              className="w-full justify-center whitespace-nowrap sm:w-auto"
            >
              <LockIcon className="block h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Lock Roadmap</span>
            </Button>
          </div>
        </div>

        {(draft.stale || requiresLargeConfirmation || actionError || activeJob) && (
          <div className="flex flex-col gap-3 border-b border-slate-100 py-4 dark:border-slate-800">
            {draft.stale && (
              <div className="flex items-start gap-2 rounded-md border border-feedback-warning-border bg-feedback-warning-background p-3 text-body-sm text-feedback-warning-text">
                <WarningIcon
                  className="mt-0.5 h-4 w-4 shrink-0 text-feedback-warning-icon"
                  aria-hidden="true"
                />
                <span>
                  Locking is disabled because this draft is stale. Refresh the stale draft below before locking.
                </span>
              </div>
            )}

            {requiresLargeConfirmation && (
              <Checkbox
                variant="warning_callout"
                required
                checked={confirmLarge}
                onChange={setConfirmLarge}
                disabled={draft.stale || !featureEnabled || Boolean(activeJob) || locking}
                label={`I confirm that I want to lock this large roadmap (${draft.size_guardrail.active_topic_count} active topics, above the ${draft.size_guardrail.soft_max_topics}-topic guideline).`}
              />
            )}

            {actionError && (
              <Alert
                variant={
                  actionError.tone === 'info'
                    ? 'info'
                    : actionError.tone === 'warning'
                      ? 'warning'
                      : 'error_retryable'
                }
                role="alert"
                retryAfterSeconds={actionError.retryAfterSeconds}
                resetKey={actionErrorResetKey}
                action={
                  isStaleVersionOrDraft
                    ? {
                        label: 'Reload Draft',
                        onClick: () => {
                          setActionError(null);
                          setReloadTick((prev) => prev + 1);
                        },
                      }
                    : undefined
                }
              >
                {actionError.message}
              </Alert>
            )}

            {activeJob && (
              <AILoadingState
                job={activeJob.job}
                title={
                  activeJob.kind === 'refresh'
                    ? 'Refreshing stale roadmap draft'
                    : 'Revising your roadmap draft'
                }
                variant="inline_banner"
                accessToken={accessToken}
                pollJobStatus={pollJobStatus}
                onJobSucceeded={handleJobSucceeded}
                onRetryJob={handleRetryActiveJob}
              />
            )}
          </div>
        )}

        <form onSubmit={handleRevisionSubmit} className="flex flex-col gap-3 pt-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={instructionId}
              className="text-label font-medium text-text-primary"
            >
              Revision instruction{' '}
              <span className="text-rose-600 dark:text-rose-400" aria-hidden="true">
                *
              </span>
            </label>
            <textarea
              id={instructionId}
              rows={2}
              required
              aria-required="true"
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                if (instructionError) {
                  setInstructionError(null);
                }
              }}
              aria-invalid={instructionError ? 'true' : undefined}
              aria-describedby={
                instructionError
                  ? `${instructionHelpId} ${instructionErrorId}`
                  : instructionHelpId
              }
              disabled={!featureEnabled || Boolean(activeJob) || locking}
              placeholder="Example: Expand SQL indexing exercises in Phase 2 and keep Phase 1 concise."
              className="w-full rounded-md border border-border-strong bg-surface-default px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-border-focus disabled:bg-surface-disabled disabled:text-text-disabled"
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption">
              <span id={instructionHelpId} className="text-text-muted">
                1 to {MAX_REVISION_CODEPOINTS} characters (Unicode code points).
              </span>
              <span
                className={cn(
                  'font-mono tabular-nums',
                  rawCodePointCount > MAX_REVISION_CODEPOINTS
                    ? 'font-semibold text-text-danger'
                    : 'text-text-muted',
                )}
              >
                {rawCodePointCount} / {MAX_REVISION_CODEPOINTS}
              </span>
            </div>
            {instructionError && (
              <p
                id={instructionErrorId}
                role="alert"
                className="text-caption text-text-danger"
              >
                {instructionError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <Button
              type="submit"
              variant="secondary"
              size="md"
              loading={submittingRevision}
              loadingText="Submitting revision..."
              disabled={!canSubmitRevision}
              className={cn(
                'w-full justify-center whitespace-nowrap transition-colors sm:w-auto',
                canSubmitRevision
                  ? 'border-teal-600 bg-teal-50 font-semibold text-teal-800 shadow-xs hover:border-teal-700 hover:bg-teal-100 dark:border-teal-500 dark:bg-teal-950/60 dark:text-teal-200 dark:hover:bg-teal-900/70'
                  : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 shadow-none hover:border-slate-200 hover:bg-slate-100 hover:text-slate-400 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-500',
              )}
            >
              <SparklesIcon
                className="block h-4 w-4 shrink-0"
                aria-hidden="true"
                data-icon="sparkles"
              />
              <span>Submit Revision</span>
            </Button>

            {draft.stale && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                loading={submittingRevision}
                loadingText="Refreshing..."
                disabled={!featureEnabled || submittingRevision || Boolean(activeJob) || locking}
                onClick={handleRefreshStaleDraft}
                className="w-full justify-center whitespace-nowrap sm:w-auto"
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
                  focusable={false}
                  className="block h-4 w-4 shrink-0"
                >
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
                <span>Refresh Stale Draft</span>
              </Button>
            )}
          </div>
        </form>
      </section>

      <section
        aria-labelledby="draft-summary-heading"
        className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
      >
        <h2
          id="draft-summary-heading"
          className="text-heading-md font-semibold text-text-primary"
        >
          Strategic Summary
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
            <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Current Situation
            </dt>
            <dd className="mt-1.5 text-body-sm text-text-primary" dir="auto">
              {draft.summary.current_situation}
            </dd>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
            <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Target Interpretation
            </dt>
            <dd className="mt-1.5 text-body-sm text-text-primary" dir="auto">
              {draft.summary.target_interpretation}
            </dd>
          </div>
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
            <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Expected Career Impact
            </dt>
            <dd className="mt-1.5 text-body-sm text-text-primary" dir="auto">
              {draft.summary.expected_career_impact}
            </dd>
          </div>
        </dl>
        {draft.summary.next_steps.length > 0 && (
          <div className="mt-4 border-t border-border-subtle pt-4">
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Recommended Next Steps
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm text-text-secondary">
              {draft.summary.next_steps.map((step, idx) => (
                <li key={`${idx}-${step}`} dir="auto">
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {draft.level_outline.length > 0 && (
        <section
          aria-labelledby="draft-level-outline-heading"
          className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
        >
          <h2
            id="draft-level-outline-heading"
            className="text-heading-md font-semibold text-text-primary"
          >
            Career Level Outline
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {draft.level_outline.map((level) => (
              <div
                key={level.career_level}
                className={cn(
                  'rounded-lg border p-4',
                  level.career_level === draft.target_level
                    ? 'border-border-focus bg-surface-accent'
                    : 'border-border-subtle bg-surface-subtle',
                )}
              >
                <p className="text-label font-semibold text-text-primary">
                  {LEVEL_LABELS[level.career_level] ?? level.career_level}
                  {level.career_level === draft.target_level && (
                    <span className="ml-2 text-caption text-text-brand">
                      (Target)
                    </span>
                  )}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-body-sm text-text-secondary">
                  {level.outline.map((bullet, idx) => (
                    <li key={`${level.career_level}-${idx}`} dir="auto">
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="draft-phases-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="draft-phases-heading"
            className="text-heading-md font-semibold text-text-primary"
          >
            Phases &amp; Topics
          </h2>
          <p className="text-caption text-text-muted">
            Topics are managed through structured AI revisions to keep dependencies valid.
          </p>
        </div>

        {phases.map((phase) => (
          <article
            key={phase.phase_no}
            className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-3">
              <h3 className="text-heading-sm font-semibold text-text-primary" dir="auto">
                Phase {phase.phase_no}: {phase.title}
              </h3>
              <span className="text-caption text-text-muted">
                {phase.items.length} {phase.items.length === 1 ? 'topic' : 'topics'}
              </span>
            </div>

            {phase.milestones.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {phase.milestones.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center rounded-md border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-medium text-text-secondary"
                    dir="auto"
                  >
                    Milestone: {m.title}
                  </span>
                ))}
              </div>
            )}

            <ol className="mt-4 flex flex-col gap-3">
              {phase.items.map((item) => {
                const prereqs = resolvePrerequisites(item, titleById);
                return (
                  <li
                    key={item.item_id}
                    className="rounded-lg border border-border-default bg-surface-default p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-caption font-mono text-text-muted">
                          #{item.sequence_no}
                        </span>
                        <h4
                          className="text-label-lg font-semibold text-text-primary"
                          dir="auto"
                        >
                          {item.title}
                        </h4>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center rounded-full border px-2 py-1 text-2xs font-medium leading-none',
                            PRIORITY_BADGE_CLASSES[item.priority],
                          )}
                        >
                          {PRIORITY_LABELS[item.priority]}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center justify-center rounded-full border px-2 py-1 text-2xs font-medium leading-none',
                            GAP_BADGE_CLASSES[item.gap_type],
                          )}
                        >
                          {GAP_LABELS[item.gap_type]}
                        </span>
                        {item.estimated_effort_hours !== null && (
                          <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2 py-1 text-2xs leading-none text-text-secondary">
                            {item.estimated_effort_hours} hrs
                          </span>
                        )}
                      </div>
                    </div>

                    {item.required_depth && (
                      <p className="mt-1.5 text-caption text-text-muted" dir="auto">
                        Depth: {item.required_depth}
                      </p>
                    )}

                    {item.reason && (
                      <p className="mt-2 text-body-sm text-text-secondary" dir="auto">
                        {item.reason}
                      </p>
                    )}

                    {prereqs.length > 0 && (
                      <p className="mt-2 text-caption text-text-muted" dir="auto">
                        Prerequisites: {prereqs.join(', ')}
                      </p>
                    )}

                    {item.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3 text-caption">
                        {item.sources.map((src, idx) => {
                          const href = safeExternalUrl(src.url);
                          if (!href) return null;
                          return (
                            <a
                              key={`${item.item_id}-src-${idx}`}
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-text-link underline underline-offset-2 hover:text-text-link-hover"
                            >
                              {src.publisher}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </article>
        ))}
      </section>
    </main>
  );
}
