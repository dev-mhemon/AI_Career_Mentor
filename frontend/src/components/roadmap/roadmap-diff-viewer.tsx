'use client';

import { useEffect, useRef, useState } from 'react';
import {
  acceptRoadmapMerge,
  rejectRoadmapMerge,
  type AcceptRoadmapMergeResultDTO,
  type CareerLevel,
  type ItemPriority,
  type MergeOp,
  type MergeOperationDTO,
  type MergeOrigin,
  type MergeProposalDTO,
  type MergeStatus,
  type RejectRoadmapMergeResultDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  CloseIcon,
  MinusIcon,
  WarningIcon,
} from '@/components/ui/icons';

export type RoadmapDiffViewerProps = {
  accessToken: string;
  roadmapId: string;
  merge: MergeProposalDTO;
  currentVersionNo: number;
  roadmapGeneratorEnabled?: boolean;
  /** When false (e.g., archived roadmap), hides Accept/Reject controls while keeping diff inspectable. */
  canMutate?: boolean;
  /** When true, omits the outer card shell and redundant summary header for inline accordion embedding. */
  embedded?: boolean;
  /** Optional parent-owned Accept executor so tab switches never drop completion refreshes. */
  acceptMergeAction?: (input: {
    base_version_no: number;
    acknowledge_large_expansion: boolean;
    idempotencyKey: string;
  }) => Promise<AcceptRoadmapMergeResultDTO>;
  /** Optional parent-owned Reject executor so tab switches never drop completion refreshes. */
  rejectMergeAction?: () => Promise<RejectRoadmapMergeResultDTO>;
  /** Optional parent-tracked submitting state scoped to this merge.id. */
  externalSubmittingAction?: 'accept' | 'reject' | null;
  onAccepted?: (result: AcceptRoadmapMergeResultDTO) => void;
  onRejected?: (result: RejectRoadmapMergeResultDTO) => void;
  onReloadRequested?: () => void;
  onClose?: () => void;
};

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

const ORIGIN_META: Record<
  MergeOrigin,
  { label: string; badgeClass: string }
> = {
  user_request: {
    label: 'User Request',
    badgeClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/80 dark:bg-teal-950/50 dark:text-teal-200',
  },
  level_change: {
    label: 'Career Level Change',
    badgeClass:
      'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/80 dark:bg-indigo-950/50 dark:text-indigo-200',
  },
  ai_proposal: {
    label: 'AI Proposal',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/50 dark:text-amber-200',
  },
};

const STATUS_META: Record<
  MergeStatus,
  { label: string; badgeClass: string }
> = {
  proposed: {
    label: 'Pending Review',
    badgeClass:
      'border-feedback-info-border bg-feedback-info-background text-feedback-info-text',
  },
  accepted: {
    label: 'Accepted',
    badgeClass:
      'border-feedback-success-border bg-feedback-success-background text-feedback-success-text',
  },
  rejected: {
    label: 'Rejected',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  undone: {
    label: 'Undone',
    badgeClass:
      'border-feedback-warning-border bg-feedback-warning-background text-feedback-warning-text',
  },
  superseded: {
    label: 'Superseded',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
  },
};

const PRIORITY_LABELS: Record<ItemPriority, string> = {
  core: 'Core',
  supporting: 'Supporting',
  optional: 'Optional',
};

const OP_META: Record<
  MergeOp,
  {
    label: string;
    rowClass: string;
    badgeClass: string;
  }
> = {
  add_topic: {
    label: 'Added',
    rowClass:
      'border-emerald-200/90 bg-emerald-50/40 dark:border-emerald-900/70 dark:bg-emerald-950/20',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  },
  update_topic: {
    label: 'Updated',
    rowClass:
      'border-sky-200/90 bg-sky-50/40 dark:border-sky-900/70 dark:bg-sky-950/20',
    badgeClass:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200',
  },
  reprioritize: {
    label: 'Reprioritized',
    rowClass:
      'border-indigo-200/90 bg-indigo-50/40 dark:border-indigo-900/70 dark:bg-indigo-950/20',
    badgeClass:
      'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200',
  },
  reclassify: {
    label: 'Reclassified',
    rowClass:
      'border-amber-200/90 bg-amber-50/40 dark:border-amber-900/70 dark:bg-amber-950/20',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  },
  retire_topic: {
    label: 'Retired',
    rowClass:
      'border-rose-200/90 bg-rose-50/40 dark:border-rose-900/70 dark:bg-rose-950/20',
    badgeClass:
      'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  },
};

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

function OpIcon({ op }: { op: MergeOp }) {
  if (op === 'add_topic') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      >
        <path d="M3.5 8h9" />
        <path d="M8 3.5v9" />
      </svg>
    );
  }
  if (op === 'retire_topic') {
    return (
      <MinusIcon className="block h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    );
  }
  if (op === 'reprioritize') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      >
        <path d="M8 12.5v-9" />
        <path d="M4 7.5 8 3.5l4 4" />
      </svg>
    );
  }
  if (op === 'reclassify') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="block h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
      >
        <path d="m10.5 2.5 3 2.5-3 2.5" />
        <path d="M13.5 5H2.5" />
        <path d="m5.5 13.5-3-2.5 3-2.5" />
        <path d="M2.5 11h11" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      <path d="M8 13.5h5.5" />
      <path d="M11 2.75a1.5 1.5 0 0 1 2.12 2.12L5 13l-2.5.65.65-2.5L11 2.75Z" />
    </svg>
  );
}

function formatOperationMetadata(op: MergeOperationDTO): string[] {
  const notes: string[] = [];
  const payload = op.payload ?? {};
  if (typeof payload.phase_no === 'number' && Number.isFinite(payload.phase_no)) {
    notes.push(`Phase ${payload.phase_no}`);
  }
  if (typeof payload.gap_type === 'string' && payload.gap_type.trim()) {
    notes.push(`Classification: ${payload.gap_type.trim()}`);
  }
  if (
    typeof payload.required_depth === 'string' &&
    payload.required_depth.trim()
  ) {
    notes.push(`Depth: ${payload.required_depth.trim()}`);
  }
  if (
    typeof payload.estimated_effort_hours === 'number' &&
    Number.isFinite(payload.estimated_effort_hours)
  ) {
    notes.push(`~${payload.estimated_effort_hours} hrs guidance`);
  }
  return notes;
}

/**
 * Component 17 `RoadmapDiffViewer` (`C09` §2.4 / Screen 15):
 * Visual diff inspector for `MergeProposalDTO` (`EP-R10`) with explicit operation
 * indicators (`+ Added`, `~ Updated`, `↑ Reprioritized`, `⇄ Reclassified`, `- Retired`),
 * soft-size expansion acknowledgement (`EP-R11`), Daily Plan impact preview,
 * and Accept / Reject actions.
 */
export function RoadmapDiffViewer({
  accessToken,
  roadmapId,
  merge,
  currentVersionNo,
  roadmapGeneratorEnabled = true,
  canMutate = true,
  embedded = false,
  acceptMergeAction,
  rejectMergeAction,
  externalSubmittingAction = null,
  onAccepted,
  onRejected,
  onReloadRequested,
  onClose,
}: RoadmapDiffViewerProps) {
  const scopeKey = `${roadmapId}:${merge.id}:${merge.status}`;
  const scopeRef = useRef(scopeKey);
  const mountedRef = useRef(true);

  const [ackState, setAckState] = useState<{
    scope: string;
    checked: boolean;
  }>({ scope: scopeKey, checked: false });
  const [submittingState, setSubmittingState] = useState<{
    mergeId: string;
    action: 'accept' | 'reject';
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    scope: string;
    error: MappedError;
  } | null>(null);

  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ackLargeExpansion = ackState.scope === scopeKey && ackState.checked;
  const actionError =
    errorState && errorState.scope === scopeKey ? errorState.error : null;
  const submitting: 'accept' | 'reject' | null =
    externalSubmittingAction ??
    (submittingState && submittingState.mergeId === merge.id
      ? submittingState.action
      : null);

  const isPending = merge.status === 'proposed' && canMutate;
  const requiresLargeAck = Boolean(merge.size_impact.materially_large);
  const isStaleBase =
    isPending && merge.base_version_no !== currentVersionNo;

  const acceptDisabled =
    !isPending ||
    !roadmapGeneratorEnabled ||
    submitting !== null ||
    (requiresLargeAck && !ackLargeExpansion);

  const rejectDisabled = !isPending || submitting !== null;

  const originMeta = ORIGIN_META[merge.origin] ?? ORIGIN_META.user_request;
  const statusMeta = STATUS_META[merge.status] ?? STATUS_META.proposed;

  const delta =
    typeof merge.size_impact.delta === 'number'
      ? merge.size_impact.delta
      : merge.size_impact.active_topics_after -
        merge.size_impact.active_topics_before;
  const deltaLabel = delta > 0 ? `+${delta}` : String(delta);

  const handleAccept = async () => {
    if (acceptDisabled) {
      return;
    }
    const callScope = scopeKey;
    const targetMergeId = merge.id;
    const idempotencyKey = generateIdempotencyKey();
    const ack = requiresLargeAck ? ackLargeExpansion : false;
    setSubmittingState({ mergeId: targetMergeId, action: 'accept' });
    setErrorState(null);
    try {
      const result = acceptMergeAction
        ? await acceptMergeAction({
            base_version_no: merge.base_version_no,
            acknowledge_large_expansion: ack,
            idempotencyKey,
          })
        : await acceptRoadmapMerge(
            accessToken,
            roadmapId,
            targetMergeId,
            {
              base_version_no: merge.base_version_no,
              acknowledge_large_expansion: ack,
            },
            idempotencyKey,
            currentVersionNo,
          );
      if (mountedRef.current) {
        setSubmittingState((prev) =>
          prev?.mergeId === targetMergeId ? null : prev,
        );
      }
      if (!acceptMergeAction) {
        onAccepted?.(result);
      }
    } catch (error) {
      if (!mountedRef.current || scopeRef.current !== callScope) {
        if (mountedRef.current) {
          setSubmittingState((prev) =>
            prev?.mergeId === targetMergeId ? null : prev,
          );
        }
        return;
      }
      setSubmittingState((prev) =>
        prev?.mergeId === targetMergeId ? null : prev,
      );
      setErrorState({ scope: callScope, error: mapApiError(error) });
    }
  };

  const handleReject = async () => {
    if (rejectDisabled) {
      return;
    }
    const callScope = scopeKey;
    const targetMergeId = merge.id;
    setSubmittingState({ mergeId: targetMergeId, action: 'reject' });
    setErrorState(null);
    try {
      const result = rejectMergeAction
        ? await rejectMergeAction()
        : await rejectRoadmapMerge(accessToken, roadmapId, targetMergeId);
      if (mountedRef.current) {
        setSubmittingState((prev) =>
          prev?.mergeId === targetMergeId ? null : prev,
        );
      }
      if (!rejectMergeAction) {
        onRejected?.(result);
      }
    } catch (error) {
      if (!mountedRef.current || scopeRef.current !== callScope) {
        if (mountedRef.current) {
          setSubmittingState((prev) =>
            prev?.mergeId === targetMergeId ? null : prev,
          );
        }
        return;
      }
      setSubmittingState((prev) =>
        prev?.mergeId === targetMergeId ? null : prev,
      );
      setErrorState({ scope: callScope, error: mapApiError(error) });
    }
  };

  const showReloadAction =
    Boolean(onReloadRequested) &&
    (actionError?.code === 'STALE_VERSION' ||
      actionError?.code === 'MERGE_NOT_PENDING');

  return (
    <section
      aria-label="Roadmap merge proposal diff"
      className={cn(
        'flex flex-col',
        embedded
          ? 'gap-4'
          : 'gap-5 rounded-xl border border-border-default bg-surface-raised p-5 shadow-xs sm:p-6',
      )}
    >
      {embedded ? (
        merge.instruction ? (
          <p className="text-caption text-text-muted" dir="auto">
            Request: “{merge.instruction}”
          </p>
        ) : null
      ) : (
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-caption font-semibold leading-none',
                  originMeta.badgeClass,
                )}
              >
                {originMeta.label}
              </span>
              <span
                className={cn(
                  'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-caption font-medium leading-none',
                  statusMeta.badgeClass,
                )}
              >
                {statusMeta.label}
              </span>
              {merge.target_level && (
                <span className="inline-flex items-center justify-center rounded-full border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-caption font-medium leading-none text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
                  Target:{' '}
                  {LEVEL_LABELS[merge.target_level] ?? merge.target_level}
                </span>
              )}
              <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-subtle px-2.5 py-1 text-caption font-mono leading-none text-text-secondary">
                Base v{merge.base_version_no}
              </span>
            </div>

            {merge.reason && (
              <p className="text-body-sm text-text-primary" dir="auto">
                {merge.reason}
              </p>
            )}
            {merge.instruction && (
              <p className="text-caption text-text-muted" dir="auto">
                Request: “{merge.instruction}”
              </p>
            )}
          </div>

          {onClose && (
            <button
              type="button"
              aria-label="Close diff preview"
              disabled={submitting !== null}
              onClick={onClose}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <CloseIcon
                className="block h-4 w-4 shrink-0"
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      )}

      {isStaleBase && (
        <Alert
          variant="warning"
          role="status"
          title="Roadmap version updated"
          action={
            onReloadRequested
              ? { label: 'Reload roadmap', onClick: onReloadRequested }
              : undefined
          }
        >
          This proposal was computed against v{merge.base_version_no}, while the
          locked roadmap is now at v{currentVersionNo}. Accepting will require
          the latest version.
        </Alert>
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
          action={
            showReloadAction && onReloadRequested
              ? { label: 'Reload latest version', onClick: onReloadRequested }
              : undefined
          }
        >
          {actionError.message}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div
          className={cn(
            'rounded-lg border p-4',
            requiresLargeAck
              ? 'border-feedback-warning-border bg-feedback-warning-background/60'
              : 'border-border-subtle bg-surface-subtle',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Roadmap Size Impact
            </p>
            <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-raised px-2 py-0.5 text-2xs font-mono font-medium leading-none text-text-primary">
              {merge.size_impact.before} → {merge.size_impact.after} ({deltaLabel})
            </span>
          </div>
          <p className="mt-1.5 text-body-sm text-text-secondary">
            Recommended soft limit: {merge.size_impact.soft_limit} active topics.
          </p>
          {merge.size_impact.warning && (
            <p
              className="mt-2 inline-flex items-start gap-1.5 text-caption font-medium text-feedback-warning-text"
              dir="auto"
            >
              <WarningIcon
                className="mt-0.5 block h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{merge.size_impact.warning}</span>
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-subtle p-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
            Daily Plan Impact
          </p>
          {merge.daily_plan_impact.has_active_plan ? (
            <div className="mt-2 space-y-1 text-body-sm text-text-secondary">
              <p className="inline-flex items-center gap-1.5 leading-none text-feedback-success-text">
                <CheckCircleIcon
                  className="block h-4 w-4 shrink-0 text-feedback-success-icon"
                  aria-hidden="true"
                />
                <span>
                  {merge.daily_plan_impact.completed_days_unchanged} completed{' '}
                  {merge.daily_plan_impact.completed_days_unchanged === 1
                    ? 'day'
                    : 'days'}{' '}
                  unchanged
                </span>
              </p>
              <p>
                {merge.daily_plan_impact.future_days_affected} future incomplete{' '}
                {merge.daily_plan_impact.future_days_affected === 1
                  ? 'day'
                  : 'days'}{' '}
                will be reconciled after acceptance.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-body-sm text-text-secondary">
              No active Daily Plan yet. Accepting updates your locked roadmap
              without modifying prior progress or skill evidence.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-label-lg font-semibold text-text-primary">
            Proposed Operations
          </h3>
          <span className="text-caption text-text-muted">
            {merge.operations.length}{' '}
            {merge.operations.length === 1 ? 'change' : 'changes'}
          </span>
        </div>

        {merge.operations.length === 0 ? (
          <p className="rounded-lg border border-border-subtle bg-surface-subtle p-4 text-body-sm text-text-secondary">
            No item-level operations recorded for this proposal.
          </p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {merge.operations.map((op) => {
              const meta = OP_META[op.op] ?? OP_META.update_topic;
              const notes = formatOperationMetadata(op);
              return (
                <li
                  key={op.id}
                  data-merge-op={op.op}
                  className={cn(
                    'rounded-lg border p-3.5',
                    meta.rowClass,
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
                          meta.badgeClass,
                        )}
                      >
                        <OpIcon op={op.op} />
                        <span className="leading-none">{meta.label}</span>
                      </span>
                      <span
                        className="text-label font-semibold text-text-primary"
                        dir="auto"
                      >
                        {op.title ?? 'Roadmap topic'}
                      </span>
                    </div>

                    {op.priority && (
                      <span className="inline-flex items-center justify-center rounded-full border border-border-default bg-surface-raised px-2 py-0.5 text-2xs font-medium leading-none text-text-secondary">
                        Priority: {PRIORITY_LABELS[op.priority] ?? op.priority}
                      </span>
                    )}
                  </div>

                  {op.reason && (
                    <p
                      className="mt-2 text-body-sm text-text-secondary"
                      dir="auto"
                    >
                      {op.reason}
                    </p>
                  )}

                  {notes.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {notes.map((note) => (
                        <span
                          key={note}
                          className="inline-flex items-center rounded-md border border-border-subtle bg-surface-raised/80 px-2 py-0.5 text-2xs leading-none text-text-muted"
                        >
                          {note}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {isPending && requiresLargeAck && (
        <Checkbox
          variant="warning_callout"
          checked={ackLargeExpansion}
          disabled={submitting !== null || !roadmapGeneratorEnabled}
          required
          onChange={(checked) => {
            setAckState({ scope: scopeKey, checked });
            if (
              checked &&
              actionError?.code === 'MERGE_EXPANSION_ACK_REQUIRED'
            ) {
              setErrorState(null);
            }
          }}
          label={`I acknowledge this merge expands the roadmap to ${merge.size_impact.after} active topics (above the recommended soft limit of ${merge.size_impact.soft_limit}).`}
        />
      )}

      {isPending && !roadmapGeneratorEnabled && (
        <Alert variant="info" role="status">
          Roadmap updates are currently disabled for your account. You can still
          review this diff or reject the proposal.
        </Alert>
      )}

      {isPending && (
        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border-subtle pt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={submitting === 'reject'}
            loadingText="Rejecting..."
            disabled={rejectDisabled}
            onClick={() => void handleReject()}
          >
            Reject Proposal
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={submitting === 'accept'}
            loadingText="Applying merge..."
            disabled={acceptDisabled}
            onClick={() => void handleAccept()}
          >
            Accept Merge
          </Button>
        </div>
      )}
    </section>
  );
}
