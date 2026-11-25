import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { CheckCircleIcon, ClockIcon, TargetIcon } from '@/components/ui/icons';
import {
  SkillBadge,
  type SkillBadgeVariant,
} from '@/components/ui/skill-badge';

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed';

export type MilestoneSkillTag = {
  label: string;
  status?: SkillBadgeVariant;
};

export type MilestoneCardProps = {
  title: string;
  status: MilestoneStatus;
  completedTopics: number;
  totalTopics: number;
  targetCriteria?: string;
  skills?: readonly MilestoneSkillTag[];
  action?: ReactNode;
  className?: string;
};

type MilestoneMeta = {
  label: string;
  badgeClass: string;
  renderIcon: () => ReactNode;
};

const MILESTONE_STATUS_META: Record<MilestoneStatus, MilestoneMeta> = {
  pending: {
    label: 'Pending',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    renderIcon: () => <TargetIcon className="h-3.5 w-3.5" />,
  },
  in_progress: {
    label: 'In Progress',
    badgeClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/80 dark:bg-teal-950/50 dark:text-teal-200',
    renderIcon: () => <ClockIcon className="h-3.5 w-3.5" />,
  },
  completed: {
    label: 'Completed',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200',
    renderIcon: () => <CheckCircleIcon className="h-3.5 w-3.5" />,
  },
};

/**
 * Component 18 — `MilestoneCard` (`C09 §2.4`).
 * Displays phase milestone completion state, accessible `<progress>` bar,
 * skill tags (`SkillBadge`), target criteria, and encouraging learning copy
 * with zero employment-guarantee or gamified trophy imagery (`PRD §36`).
 */
export function MilestoneCard({
  title,
  status,
  completedTopics,
  totalTopics,
  targetCriteria,
  skills = [],
  action,
  className,
}: MilestoneCardProps) {
  const safeTotal = Math.max(0, totalTopics);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completedTopics));
  const percent =
    safeTotal === 0
      ? 0
      : Math.min(100, Math.round((safeCompleted / safeTotal) * 100));
  const meta = MILESTONE_STATUS_META[status];

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              meta.badgeClass,
            )}
          >
            {meta.renderIcon()}
            <span>{meta.label}</span>
          </span>
          <h4
            dir="auto"
            className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h4>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {targetCriteria && (
        <p
          dir="auto"
          className="text-xs leading-relaxed text-slate-600 dark:text-slate-300"
        >
          {targetCriteria}
        </p>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>
            {safeCompleted} / {safeTotal} topics
          </span>
          <span className="font-mono">{percent}%</span>
        </div>
        <progress
          value={safeCompleted}
          max={Math.max(1, safeTotal)}
          aria-label={`${title}: ${safeCompleted} of ${safeTotal} topics completed`}
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100 accent-teal-600 dark:bg-slate-800"
        />
      </div>

      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <SkillBadge
              key={`${skill.label}-${skill.status ?? 'target'}`}
              label={skill.label}
              status={skill.status ?? 'target'}
            />
          ))}
        </div>
      )}
    </article>
  );
}
