import type { LearningState } from '@/lib/api/client';
import { cn } from '@/components/ui/cn';
import {
  BookOpenIcon,
  CheckCircleIcon,
  ClockIcon,
  SparklesIcon,
} from '@/components/ui/icons';

export interface SkillProgressBadgeProps {
  state: LearningState;
  size?: 'sm' | 'md';
  className?: string;
}

const STATE_META: Record<
  LearningState,
  {
    label: string;
    className: string;
    Icon: typeof CheckCircleIcon;
  }
> = {
  not_started: {
    label: 'Not Started',
    className:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    Icon: ClockIcon,
  },
  learning: {
    label: 'Learning',
    className:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200',
    Icon: BookOpenIcon,
  },
  practicing: {
    label: 'Practicing',
    className:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
    Icon: SparklesIcon,
  },
  proficient: {
    label: 'Proficient',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200',
    Icon: CheckCircleIcon,
  },
};

export const LEARNING_STATE_LABELS: Record<LearningState, string> = {
  not_started: 'Not Started',
  learning: 'Learning',
  practicing: 'Practicing',
  proficient: 'Proficient',
};

/**
 * SPEC #23 `SkillProgressBadge`:
 * Pure, accessible mastery state pill (`Not Started`, `Learning`, `Practicing`, `Proficient`).
 * Never uses `"Job Ready"` or percentage pass/fail copy (`PRD` §35).
 */
export function SkillProgressBadge({
  state,
  size = 'sm',
  className,
}: SkillProgressBadgeProps) {
  const meta = STATE_META[state] ?? STATE_META.not_started;
  const Icon = meta.Icon;

  return (
    <span
      data-learning-state={state}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-none',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs',
        meta.className,
        className,
      )}
    >
      <Icon className="block h-3.5 w-3.5 shrink-0" />
      <span>{meta.label}</span>
    </span>
  );
}
