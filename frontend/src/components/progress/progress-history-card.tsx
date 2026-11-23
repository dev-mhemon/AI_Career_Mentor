import Link from 'next/link';
import type { CareerLevel, ProgressHistoryItemDTO } from '@/lib/api/client';
import {
  BookOpenIcon,
  ChevronRightIcon,
  ClockIcon,
  SparklesIcon,
} from '@/components/ui/icons';
import { SkillProgressBadge } from './skill-progress-badge';

export interface ProgressHistoryCardProps {
  item: ProgressHistoryItemDTO;
  skillName?: string;
}

const LEVEL_LABELS: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * SPEC #24 `ProgressHistoryCard`:
 * Renders an `EP-G03` `ProgressHistoryItemDTO` (`state_change` or `evidence_added`),
 * level-scoped state transition pills, explainable `reason`, and deep link to
 * `/quiz/${source_attempt_id}` (`R29`).
 */
export function ProgressHistoryCard({
  item,
  skillName,
}: ProgressHistoryCardProps) {
  const isStateChange = item.event === 'state_change';
  const formattedDate = formatTimestamp(item.occurred_at);

  return (
    <article
      data-history-id={item.id}
      data-history-event={item.event}
      className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold leading-none text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {isStateChange ? (
              <SparklesIcon className="block h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
            ) : (
              <BookOpenIcon className="block h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
            )}
            <span>
              {isStateChange ? 'Mastery State Updated' : 'Practice Evidence Added'}
            </span>
          </span>

          <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {LEVEL_LABELS[item.career_level] ?? item.career_level}
          </span>

          <span className="inline-flex items-center gap-1 text-xs leading-none text-slate-500 dark:text-slate-400">
            <ClockIcon className="block h-3.5 w-3.5 shrink-0" />
            <span>{formattedDate}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h3
            dir="auto"
            className="text-body-md font-semibold text-slate-900 dark:text-slate-100"
          >
            {skillName ?? 'Skill Progress'}
          </h3>

          {item.from_state &&
          item.to_state &&
          item.from_state !== item.to_state ? (
            <div className="inline-flex flex-wrap items-center gap-1.5">
              <SkillProgressBadge state={item.from_state} />
              <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0 text-slate-400" />
              <SkillProgressBadge state={item.to_state} />
            </div>
          ) : item.to_state ? (
            <SkillProgressBadge state={item.to_state} />
          ) : null}
        </div>

        {item.reason && (
          <p
            dir="auto"
            className="text-body-sm leading-relaxed text-slate-600 dark:text-slate-400"
          >
            {item.reason}
          </p>
        )}
      </div>

      {item.source_attempt_id && (
        <div className="flex shrink-0 items-center">
          <Link
            href={`/quiz/${encodeURIComponent(item.source_attempt_id)}`}
            className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-medium leading-none text-slate-700 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto"
          >
            <BookOpenIcon className="block h-3.5 w-3.5 shrink-0" />
            <span>View Quiz Attempt</span>
          </Link>
        </div>
      )}
    </article>
  );
}
