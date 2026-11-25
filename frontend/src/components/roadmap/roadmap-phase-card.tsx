'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  LockIcon,
  SparklesIcon,
} from '@/components/ui/icons';

export type RoadmapPhaseStatus =
  | 'draft'
  | 'locked'
  | 'level_outline'
  | 'completed'
  | 'in_progress'
  | 'upcoming';

export type RoadmapPhaseCardProps = {
  phaseNo: number;
  title: string;
  status?: RoadmapPhaseStatus;
  estimatedHours?: number | null;
  topicCount?: number;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  children?: ReactNode;
  className?: string;
};

type PhaseStatusMeta = {
  label: string;
  badgeClass: string;
  renderIcon: () => ReactNode;
};

const PHASE_STATUS_META: Record<RoadmapPhaseStatus, PhaseStatusMeta> = {
  draft: {
    label: 'Draft',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/50 dark:text-amber-200',
    renderIcon: () => <SparklesIcon className="h-3.5 w-3.5" />,
  },
  locked: {
    label: 'Locked',
    badgeClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/80 dark:bg-teal-950/50 dark:text-teal-200',
    renderIcon: () => <LockIcon className="h-3.5 w-3.5" />,
  },
  level_outline: {
    label: 'Outline Only',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    renderIcon: () => <ClockIcon className="h-3.5 w-3.5" />,
  },
  completed: {
    label: 'Completed',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200',
    renderIcon: () => <CheckCircleIcon className="h-3.5 w-3.5" />,
  },
  in_progress: {
    label: 'In Progress',
    badgeClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/80 dark:bg-teal-950/50 dark:text-teal-200',
    renderIcon: () => <ClockIcon className="h-3.5 w-3.5" />,
  },
  upcoming: {
    label: 'Upcoming',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    renderIcon: () => <ClockIcon className="h-3.5 w-3.5" />,
  },
};

/**
 * Component 16 — `RoadmapPhaseCard` (`C09 §2.4`).
 * Displays an ordered roadmap phase with non-color-only status badge, guidance-only
 * effort estimate (`PRD §20`), `dir="auto"` title, and read-only structure (no drag handles per `PRD §21`).
 */
export function RoadmapPhaseCard({
  phaseNo,
  title,
  status = 'locked',
  estimatedHours,
  topicCount,
  defaultExpanded = true,
  collapsible = true,
  children,
  className,
}: RoadmapPhaseCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();
  const meta = PHASE_STATUS_META[status];
  const hasHours =
    typeof estimatedHours === 'number' &&
    Number.isFinite(estimatedHours) &&
    estimatedHours > 0;

  return (
    <section
      aria-label={`Phase ${phaseNo}: ${title}`}
      className={cn(
        'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900',
        status === 'level_outline' && 'opacity-85',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900/80 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-slate-200/80 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              Phase {phaseNo}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                meta.badgeClass,
              )}
            >
              {meta.renderIcon()}
              <span>{meta.label}</span>
            </span>
            {typeof topicCount === 'number' && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {topicCount} {topicCount === 1 ? 'topic' : 'topics'}
              </span>
            )}
          </div>
          <h3
            dir="auto"
            className="mt-1.5 text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            Phase {phaseNo}: {title}
          </h3>
          {hasHours && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              ~{estimatedHours}h · আনুমানিক সময় — Guidance only
            </p>
          )}
        </div>

        {collapsible && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span>{expanded ? 'Hide' : 'Show'}</span>
            <ChevronDownIcon
              className={cn(
                'h-4 w-4 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </button>
        )}
      </div>

      {(!collapsible || expanded) && children && (
        <div id={contentId} className="p-4 sm:p-5">
          {children}
        </div>
      )}
    </section>
  );
}
