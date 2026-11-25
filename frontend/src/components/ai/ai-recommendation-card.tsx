'use client';

import Link from 'next/link';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/button';
import { InfoIcon, SparklesIcon } from '@/components/ui/icons';

export type AIRecommendationVariant =
  | 'roadmap_summary'
  | 'optional_merge_banner';

export type AIRecommendationCardProps = {
  title: string;
  rationale: string;
  variant?: AIRecommendationVariant;
  sourceLabel?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  dismissible?: boolean;
  disclaimer?: string;
  className?: string;
};

const DEFAULT_DISCLAIMER =
  'AI learning guidance only — does not guarantee employment or silently edit locked roadmaps.';

/**
 * Component 26 — `AIRecommendationCard` (`C09 §2.7`).
 * Frames grounded AI roadmap rationale and optional merge suggestions with clear
 * attribution, `dir="auto"` mixed-language support, and non-guarantee boundaries (`PRD §21, §26`).
 */
export function AIRecommendationCard({
  title,
  rationale,
  variant = 'roadmap_summary',
  sourceLabel = 'AI Recommendation',
  actionLabel,
  actionHref,
  onAction,
  dismissible = false,
  disclaimer = DEFAULT_DISCLAIMER,
  className,
}: AIRecommendationCardProps) {
  const [dismissed, setDismissed] = useState(false);
  const dismissBtnRef = useRef<HTMLButtonElement>(null);
  const restoreBtnRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<'dismiss' | 'restore' | null>(null);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) {
      return;
    }
    pendingFocusRef.current = null;
    if (target === 'restore' && dismissed) {
      restoreBtnRef.current?.focus();
    } else if (target === 'dismiss' && !dismissed) {
      dismissBtnRef.current?.focus();
    }
  }, [dismissed]);

  const handleDismiss = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      pendingFocusRef.current = 'restore';
    }
    setDismissed(true);
  };

  const handleRestore = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      pendingFocusRef.current = 'dismiss';
    }
    setDismissed(false);
  };

  if (dismissed) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-xl border border-indigo-200/70 bg-indigo-50/40 px-4 py-2.5 text-xs text-slate-600 dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:text-slate-300',
          className,
        )}
      >
        <span>AI suggestion dismissed</span>
        <button
          ref={restoreBtnRef}
          type="button"
          onClick={handleRestore}
          className="font-medium text-indigo-700 underline-offset-2 hover:underline focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:text-indigo-300"
        >
          Restore
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-4 dark:border-indigo-900/70 dark:bg-indigo-950/25 sm:p-5',
        variant === 'optional_merge_banner' && 'border-l-4 border-l-indigo-600',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white/90 px-2.5 py-0.5 text-xs font-medium text-indigo-800 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200">
            <SparklesIcon className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>{sourceLabel}</span>
          </span>
          <h3
            dir="auto"
            className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h3>
        </div>

        {dismissible && (
          <button
            ref={dismissBtnRef}
            type="button"
            onClick={handleDismiss}
            className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Dismiss
          </button>
        )}
      </div>

      <p
        dir="auto"
        className="text-sm leading-relaxed text-slate-700 dark:text-slate-200"
      >
        {rationale}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <InfoIcon className="h-3.5 w-3.5 shrink-0" />
          <span>{disclaimer}</span>
        </p>

        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-700 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            {actionLabel}
          </Link>
        )}
        {actionLabel && !actionHref && onAction && (
          <Button type="button" variant="primary" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </section>
  );
}
