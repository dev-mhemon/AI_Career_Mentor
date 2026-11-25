'use client';

import type {
  TechnologyActionTiming,
  TechnologyReleaseStatus,
  TechnologyRelevanceLevel,
  TechnologyUpdateDTO,
} from '@/lib/api/client';
import { AIFeedbackComponent } from '@/components/feedback/ai-feedback-component';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  CheckCircleIcon,
  ClockIcon,
  CompassIcon,
  ExternalLinkIcon,
  EyeIcon,
  RadioIcon,
} from '@/components/ui/icons';

export type TechUpdateCardProps = {
  update: TechnologyUpdateDTO;
  accessToken?: string;
  currentRatingScore?: number;
  onRated?: (score: number) => void;
  isTodayHighlight?: boolean;
  isMarkingViewed?: boolean;
  onInspectDetail?: (
    update: TechnologyUpdateDTO,
    triggerEl: HTMLButtonElement | null,
  ) => void;
  onMarkViewed?: (update: TechnologyUpdateDTO) => void;
  className?: string;
};

export const RELEASE_STATUS_LABELS: Readonly<
  Record<TechnologyReleaseStatus, string>
> = {
  released: 'Released',
  announced: 'Announced',
  planned: 'Planned',
  experimental: 'Experimental',
};

export const RELEVANCE_LEVEL_LABELS: Readonly<
  Record<TechnologyRelevanceLevel, string>
> = {
  high: 'High Relevance',
  medium: 'Medium Relevance',
  low: 'Low Relevance',
};

export const ACTION_TIMING_LABELS: Readonly<
  Record<TechnologyActionTiming, string>
> = {
  act_now: 'Act Now',
  learn_later: 'Learn Later',
  awareness_only: 'Awareness Only',
};

export function getReleaseStatusChipClass(
  status: TechnologyReleaseStatus,
): string {
  switch (status) {
    case 'released':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-200';
    case 'announced':
      return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200';
    case 'planned':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200';
    case 'experimental':
      return 'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800/70 dark:bg-purple-950/60 dark:text-purple-200';
  }
}

export function getRelevanceChipClass(
  relevance: TechnologyRelevanceLevel,
): string {
  switch (relevance) {
    case 'high':
      return 'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200';
    case 'medium':
      return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
    case 'low':
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400';
  }
}

export function getActionTimingChipClass(
  timing: TechnologyActionTiming,
): string {
  switch (timing) {
    case 'act_now':
      return 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-200';
    case 'learn_later':
      return 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200';
    case 'awareness_only':
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

/**
 * Validates that an external `source_url` uses `https:` or `http:` before rendering `<a href>`.
 */
export function getSafeExternalHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function formatTechUpdateTimestamp(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return isoString;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

/**
 * Component 25 `AIExplanationCard` (`technology_update` variant, `C09` §2.7 / Screen 21 / `PRD` §41–§43):
 * Renders a personalized, source-grounded technology update with release status, relevance,
 * recommended action timing, roadmap relationship, publisher attribution, and view/read controls.
 */
export function TechUpdateCard({
  update,
  accessToken,
  currentRatingScore,
  onRated,
  isTodayHighlight = false,
  isMarkingViewed = false,
  onInspectDetail,
  onMarkViewed,
  className,
}: TechUpdateCardProps) {
  const safeSourceUrl = getSafeExternalHttpUrl(update.source_url);
  const formattedFetchedAt = formatTechUpdateTimestamp(update.fetched_at);

  return (
    <article
      aria-label={update.title}
      className={cn(
        'flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-xs transition-shadow sm:p-6 dark:bg-slate-900',
        isTodayHighlight
          ? 'border-teal-300/90 ring-1 ring-teal-500/15 dark:border-teal-800/80'
          : 'border-slate-200/90 dark:border-slate-800',
        className,
      )}
    >
      {/* Top Row: Badges & Local Date */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isTodayHighlight && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold leading-none text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/70 dark:text-teal-200">
              <RadioIcon className="block h-3.5 w-3.5 shrink-0" />
              <span>Today&apos;s Update</span>
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              getReleaseStatusChipClass(update.release_status),
            )}
          >
            {RELEASE_STATUS_LABELS[update.release_status]}
          </span>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              getRelevanceChipClass(update.relevance),
            )}
          >
            {RELEVANCE_LEVEL_LABELS[update.relevance]}
          </span>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              getActionTimingChipClass(update.action_timing),
            )}
          >
            {ACTION_TIMING_LABELS[update.action_timing]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
              update.viewed
                ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
            )}
          >
            {update.viewed && (
              <CheckCircleIcon className="block h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>{update.viewed ? 'Read' : 'Unread'}</span>
          </span>
          <span className="font-mono text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
            {update.local_date}
          </span>
        </div>
      </div>

      {/* Title */}
      <div>
        <h3
          className="text-heading-md font-semibold text-slate-900 dark:text-slate-100"
          dir="auto"
        >
          {update.title}
        </h3>
      </div>

      {/* What Changed & Why It Matters */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800/80 dark:bg-slate-950/40">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            What Changed
          </p>
          <p
            className="text-body-sm leading-relaxed text-slate-700 dark:text-slate-300"
            dir="auto"
          >
            {update.what_changed}
          </p>
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border border-teal-100/80 bg-teal-50/40 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">
            Why It Matters to You
          </p>
          <p
            className="text-body-sm leading-relaxed text-slate-700 dark:text-slate-300"
            dir="auto"
          >
            {update.why_it_matters}
          </p>
        </div>
      </div>

      {/* Optional Roadmap Relation */}
      {update.roadmap_relation && (
        <div className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-body-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <CompassIcon className="mt-0.5 block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Roadmap Relevance:{' '}
            </span>
            <span dir="auto">{update.roadmap_relation}</span>
          </div>
        </div>
      )}

      {/* Footer: Publisher / Source / Fetched At & Actions */}
      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">
            Source: {update.publisher}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="block h-3.5 w-3.5 shrink-0" />
            <span>Fetched {formattedFetchedAt}</span>
          </span>
          {safeSourceUrl && (
            <a
              href={safeSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center gap-1 font-semibold text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-300"
            >
              <span>Official Reference</span>
              <ExternalLinkIcon className="block h-3.5 w-3.5 shrink-0" />
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onInspectDetail && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(e) => onInspectDetail(update, e.currentTarget)}
              className="min-h-11"
            >
              <EyeIcon className="block h-4 w-4 shrink-0" />
              <span>View Details</span>
            </Button>
          )}
          {onMarkViewed && !update.viewed && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={isMarkingViewed}
              disabled={isMarkingViewed}
              onClick={() => onMarkViewed(update)}
              className="min-h-11"
            >
              <CheckCircleIcon className="block h-4 w-4 shrink-0" />
              <span>Mark as Read</span>
            </Button>
          )}
        </div>
      </div>

      {/* R34: Technology Updates support rating_1_5 ONLY — strictly omits reportTarget */}
      {accessToken && (
        <div className="border-t border-slate-100 dark:border-slate-800">
          <AIFeedbackComponent
            accessToken={accessToken}
            ratingTarget={{ type: 'technology_update', id: update.id }}
            currentScore={currentRatingScore}
            onRated={onRated}
            compact
          />
        </div>
      )}
    </article>
  );
}
