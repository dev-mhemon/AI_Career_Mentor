import type { ReactNode } from 'react';
import { cn } from './cn';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  MinusIcon,
  SparklesIcon,
  TargetIcon,
} from './icons';

export type SkillBadgeStatus = 'mastered' | 'in_progress' | 'gap' | 'target';

export type SkillBadgeVariant =
  | SkillBadgeStatus
  | 'core'
  | 'supporting'
  | 'optional'
  | 'existing'
  | 'transferable'
  | 'refresh'
  | 'strengthen'
  | 'missing';

export type SkillBadgeProps = {
  label: string;
  status?: SkillBadgeVariant;
  retired?: boolean;
  className?: string;
  icon?: ReactNode;
};

type BadgeStyleMeta = {
  statusText: string;
  containerClass: string;
  renderIcon: () => ReactNode;
};

const STATUS_META: Record<SkillBadgeVariant, BadgeStyleMeta> = {
  mastered: {
    statusText: 'Proficient',
    containerClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200',
    renderIcon: () => <CheckCircleIcon className="h-3.5 w-3.5" />,
  },
  in_progress: {
    statusText: 'In Progress',
    containerClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/80 dark:bg-teal-950/50 dark:text-teal-200',
    renderIcon: () => <ClockIcon className="h-3.5 w-3.5" />,
  },
  gap: {
    statusText: 'Gap',
    containerClass:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/50 dark:text-amber-200',
    renderIcon: () => <AlertCircleIcon className="h-3.5 w-3.5" />,
  },
  target: {
    statusText: 'Target',
    containerClass:
      'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/80 dark:bg-indigo-950/50 dark:text-indigo-200',
    renderIcon: () => <TargetIcon className="h-3.5 w-3.5" />,
  },
  core: {
    statusText: 'Core',
    containerClass:
      'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/80 dark:bg-teal-950/50 dark:text-teal-200',
    renderIcon: () => <TargetIcon className="h-3.5 w-3.5" />,
  },
  supporting: {
    statusText: 'Supporting',
    containerClass:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/50 dark:text-sky-200',
    renderIcon: () => <SparklesIcon className="h-3.5 w-3.5" />,
  },
  optional: {
    statusText: 'Optional',
    containerClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
    renderIcon: () => <MinusIcon className="h-3.5 w-3.5" />,
  },
  existing: {
    statusText: 'Existing',
    containerClass:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/80 dark:bg-emerald-950/50 dark:text-emerald-200',
    renderIcon: () => <CheckCircleIcon className="h-3.5 w-3.5" />,
  },
  transferable: {
    statusText: 'Transferable',
    containerClass:
      'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/80 dark:bg-sky-950/50 dark:text-sky-200',
    renderIcon: () => <SparklesIcon className="h-3.5 w-3.5" />,
  },
  refresh: {
    statusText: 'Refresh',
    containerClass:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/80 dark:bg-amber-950/50 dark:text-amber-200',
    renderIcon: () => <ClockIcon className="h-3.5 w-3.5" />,
  },
  strengthen: {
    statusText: 'Strengthen',
    containerClass:
      'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/80 dark:bg-indigo-950/50 dark:text-indigo-200',
    renderIcon: () => <TargetIcon className="h-3.5 w-3.5" />,
  },
  missing: {
    statusText: 'Missing',
    containerClass:
      'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/80 dark:bg-rose-950/50 dark:text-rose-200',
    renderIcon: () => <AlertCircleIcon className="h-3.5 w-3.5" />,
  },
};

/**
 * Component 15 — `SkillBadge` (`C09 §2.3`).
 * Renders skill proficiency/gap/priority pill pairing a distinct outline icon with text
 * (never relies on color alone per `PRD §54`).
 */
export function SkillBadge({
  label,
  status = 'target',
  retired = false,
  className,
  icon,
}: SkillBadgeProps) {
  const meta = STATUS_META[status];
  const labelNormalized = label.trim().toLowerCase();
  const statusNormalized = meta.statusText.toLowerCase();
  const showStatusSuffix = labelNormalized !== statusNormalized;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5',
        retired
          ? 'border-slate-200 bg-slate-100 text-slate-500 opacity-75 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400'
          : meta.containerClass,
        className,
      )}
    >
      {icon ?? meta.renderIcon()}
      <span dir="auto">{label}</span>
      {showStatusSuffix && (
        <span className="opacity-80">· {retired ? 'Retired' : meta.statusText}</span>
      )}
    </span>
  );
}
