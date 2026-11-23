import type { ReactNode } from 'react';
import type {
  CareerLevel,
  PlanDayStatus,
  PlanDayTopicDTO,
} from '@/lib/api/client';
import { cn } from '@/components/ui/cn';
import {
  BookOpenIcon,
  CheckCircleIcon,
  ClockIcon,
  LockIcon,
} from '@/components/ui/icons';

export interface DailyTaskCardProps {
  /** Sequential day index (`Day 1..N` — never a calendar date per `PRD §27`). */
  dayNo: number;
  status: PlanDayStatus;
  topics: readonly PlanDayTopicDTO[];
  /** Highlights this card as the next active incomplete day. */
  isActiveDay?: boolean;
  /** Reserves the `Today` badge strictly for the active Focus Roadmap (`false` renders `Current Day`). */
  isFocusRoadmap?: boolean;
  /** Optional skill or career level pills for Today / single-topic views. */
  skillLabel?: string;
  careerLevel?: CareerLevel;
  effortHours?: number | null;
  /** Optional trailing action slot (e.g. "Continue Today" link — never a "Mark Complete" button). */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const STATUS_META: Record<
  PlanDayStatus,
  {
    label: string;
    badgeClass: string;
    dayChipClass: string;
  }
> = {
  completed: {
    label: 'Completed',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200',
    dayChipClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  in_progress: {
    label: 'In Progress',
    badgeClass:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/50 dark:text-sky-200',
    dayChipClass:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/50 dark:text-sky-300',
  },
  pending: {
    label: 'Upcoming',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dayChipClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

/**
 * Component 19 `DailyTaskCard` (`C09` §2.5 / `PRD` §27):
 * Pure presentational card rendering a sequential `Day N` learning unit with status badge,
 * topic list, metadata pills, and an optional action slot. Never renders calendar dates or
 * a "Mark Complete" button.
 */
export function DailyTaskCard({
  dayNo,
  status,
  topics,
  isActiveDay = false,
  isFocusRoadmap = true,
  skillLabel,
  careerLevel,
  effortHours,
  action,
  children,
  className,
}: DailyTaskCardProps) {
  const meta = STATUS_META[status];

  return (
    <article
      data-day-no={dayNo}
      data-status={status}
      className={cn(
        'rounded-xl border bg-white p-4 shadow-xs transition-shadow sm:p-5 dark:bg-slate-900',
        isActiveDay
          ? 'border-teal-500/70 ring-1 ring-teal-500/20 dark:border-teal-400/70 dark:ring-teal-400/20'
          : 'border-slate-200/90 dark:border-slate-800',
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center justify-center rounded-full border px-2.5 py-1 font-mono text-xs font-semibold leading-none tabular-nums',
                isActiveDay
                  ? 'border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500 dark:text-slate-950'
                  : meta.dayChipClass,
              )}
            >
              Day {dayNo}
            </span>

            {isActiveDay && status !== 'completed' && (
              <span
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
                  isFocusRoadmap
                    ? 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200'
                    : 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
                )}
              >
                <BookOpenIcon className="block h-3.5 w-3.5 shrink-0" />
                <span>{isFocusRoadmap ? 'Today' : 'Current Day'}</span>
              </span>
            )}

            {(!isActiveDay || status !== 'pending') && (
              <span
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none',
                  meta.badgeClass,
                )}
              >
                {status === 'completed' ? (
                  <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0" />
                ) : status === 'in_progress' ? (
                  <BookOpenIcon className="block h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ClockIcon className="block h-3.5 w-3.5 shrink-0" />
                )}
                <span>{meta.label}</span>
              </span>
            )}

            {careerLevel && (
              <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {LEVEL_LABELS[careerLevel]}
              </span>
            )}

            {skillLabel && (
              <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {skillLabel}
              </span>
            )}

            {typeof effortHours === 'number' &&
              Number.isFinite(effortHours) &&
              effortHours > 0 && (
                <span className="inline-flex items-center justify-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs font-medium leading-none tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <ClockIcon className="block h-3 w-3 shrink-0" />
                  <span>{effortHours}h</span>
                </span>
              )}
          </div>

          <ul className="flex flex-col gap-1.5">
            {topics.map((topic) => (
              <li
                key={topic.plan_item_id}
                className="flex items-start gap-2 text-body-md font-medium text-slate-900 dark:text-slate-100"
                dir="auto"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
                    status === 'completed'
                      ? 'bg-emerald-500'
                      : isActiveDay
                        ? 'bg-teal-600 dark:bg-teal-400'
                        : 'bg-slate-400 dark:bg-slate-500',
                  )}
                />
                <span className="min-w-0 break-words">{topic.title}</span>
              </li>
            ))}
          </ul>

          {children}
        </div>

        {action ? (
          <div className="flex w-full shrink-0 items-center sm:w-auto">
            {action}
          </div>
        ) : status === 'pending' && !isActiveDay ? (
          <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex shrink-0 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-sm font-medium leading-none text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
            >
              <LockIcon className="block h-3.5 w-3.5 shrink-0" />
              <span>Locked</span>
            </button>
            {dayNo > 1 && (
              <span className="text-xs text-slate-500 sm:text-right dark:text-slate-400">
                Complete Day {dayNo - 1} to unlock
              </span>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
