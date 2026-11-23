'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getSkillProgressDetail,
  type CareerLevel,
  type SkillProgressDetailDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  CheckCircleIcon,
  ClockIcon,
  CompassIcon,
  RefreshCwIcon,
} from '@/components/ui/icons';
import {
  Modal,
  ModalBody,
  ModalClose,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { SkillProgressBadge } from './skill-progress-badge';

export interface SkillDetailDrawerProps {
  open: boolean;
  accessToken: string;
  skillId: string | null;
  skillName?: string;
  careerLevelFilter?: CareerLevel;
  roadmapNamesById?: ReadonlyMap<string, string>;
  onClose: () => void;
}

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior Level',
  mid: 'Mid-Level',
  senior: 'Senior Level',
};

function formatDate(iso: string | null): string {
  if (!iso) {
    return 'No practice evidence yet';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Accessible skill detail dialog (`EP-G02`, `R29`):
 * Displays level-scoped mastery states (`junior`, `mid`, `senior`), explainable `state_reason`,
 * `evidence_summary` counts (quiz attempts, AI Practice Reviews, retry improvement),
 * and roadmap depth requirements — never exposing raw free-response answer text.
 */
export function SkillDetailDrawer({
  open,
  accessToken,
  skillId,
  skillName,
  careerLevelFilter,
  roadmapNamesById,
  onClose,
}: SkillDetailDrawerProps) {
  const [reloadTick, setReloadTick] = useState(0);
  const [detailState, setDetailState] = useState<{
    key: string;
    detail: SkillProgressDetailDTO;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    key: string;
    error: MappedError;
  } | null>(null);

  const requestGenRef = useRef(0);
  const requestKey = `${accessToken}:${skillId ?? ''}:${careerLevelFilter ?? 'all'}:${reloadTick}`;

  useEffect(() => {
    if (!open || !skillId) {
      return;
    }
    const gen = ++requestGenRef.current;
    const controller = new AbortController();

    getSkillProgressDetail(
      accessToken,
      skillId,
      careerLevelFilter ? { career_level: careerLevelFilter } : undefined,
      { signal: controller.signal },
    )
      .then((detail) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        setDetailState({ key: requestKey, detail });
        setErrorState(null);
      })
      .catch((err) => {
        if (gen !== requestGenRef.current || controller.signal.aborted) {
          return;
        }
        setErrorState({ key: requestKey, error: mapApiError(err) });
      });

    return () => {
      controller.abort();
    };
  }, [accessToken, careerLevelFilter, open, requestKey, skillId]);

  const activeDetail =
    detailState && detailState.key === requestKey ? detailState.detail : null;
  const activeError =
    errorState && errorState.key === requestKey ? errorState.error : null;
  const isLoading = open && Boolean(skillId) && !activeDetail && !activeError;

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <ModalHeader>
        <div className="space-y-1">
          <ModalTitle>{activeDetail?.name ?? skillName ?? 'Skill Mastery Detail'}</ModalTitle>
          <ModalDescription>
            Level-scoped practice evidence and mastery progression across your
            career roadmaps.
          </ModalDescription>
        </div>
        <ModalClose />
      </ModalHeader>

      <ModalBody className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        {isLoading && (
          <div
            aria-busy="true"
            aria-label="Loading skill progress detail"
            className="flex flex-col gap-3 py-2"
          >
            <div className="h-20 rounded-xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="h-20 rounded-xl bg-skeleton-base motion-safe:animate-pulse motion-reduce:animate-none" />
          </div>
        )}

        {!isLoading && activeError && (
          <div className="flex flex-col gap-3">
            <Alert variant="error_retryable" role="alert">
              {activeError.message}
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
          </div>
        )}

        {!isLoading && activeDetail && activeDetail.levels.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-body-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
            No level-scoped evidence has been recorded for this skill yet.
            Complete a topic Practice Quiz to begin building mastery evidence.
          </div>
        )}

        {!isLoading &&
          activeDetail &&
          activeDetail.levels.map((lvl) => (
            <section
              key={lvl.career_level}
              aria-label={`${LEVEL_LABELS[lvl.career_level]} mastery`}
              className="flex flex-col gap-3.5 rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="inline-flex items-center text-body-md font-semibold leading-none text-slate-900 dark:text-slate-100">
                    {LEVEL_LABELS[lvl.career_level] ?? lvl.career_level}
                  </h4>
                  <SkillProgressBadge state={lvl.learning_state} />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs leading-none text-slate-500 dark:text-slate-400">
                  <ClockIcon className="block h-3.5 w-3.5 shrink-0" />
                  <span>{formatDate(lvl.last_evidence_at)}</span>
                </span>
              </div>

              {lvl.state_reason && (
                <p
                  dir="auto"
                  className="text-body-sm leading-relaxed text-slate-700 dark:text-slate-300"
                >
                  {lvl.state_reason}
                </p>
              )}

              {/* Evidence Summary Strip */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Total Evidence
                  </span>
                  <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {lvl.evidence_summary.count}{' '}
                    {lvl.evidence_summary.count === 1 ? 'record' : 'records'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Quiz &amp; AI Reviews
                  </span>
                  <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {lvl.evidence_summary.quiz_attempts} quiz ·{' '}
                    {lvl.evidence_summary.practice_reviews} review
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Retry Signal
                  </span>
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold leading-none text-slate-900 dark:text-slate-100">
                    {lvl.evidence_summary.retry_improved === true ? (
                      <>
                        <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span>Improved on retry</span>
                      </>
                    ) : (
                      <span>Standard progression</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Roadmap Requirements */}
              {lvl.roadmap_requirements.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Roadmap Depth Requirements
                  </span>
                  <ul className="flex flex-col gap-1.5">
                    {lvl.roadmap_requirements.map((req, idx) => (
                      <li
                        key={`${req.roadmap_id}-${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-300"
                      >
                        <span className="inline-flex items-center gap-1.5 font-medium leading-none">
                          <CompassIcon className="block h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                          <span>
                            {roadmapNamesById?.get(req.roadmap_id) ??
                              'Active Career Roadmap'}
                          </span>
                        </span>
                        {req.required_depth && (
                          <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            {req.required_depth}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
      </ModalBody>

      <ModalFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="w-full shrink-0 justify-center whitespace-nowrap border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:w-auto"
        >
          <span>Close</span>
        </Button>
      </ModalFooter>
    </Modal>
  );
}
