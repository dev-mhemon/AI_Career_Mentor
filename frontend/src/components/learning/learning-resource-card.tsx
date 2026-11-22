import type { ResourceType } from '@/lib/api/client';
import { cn } from '@/components/ui/cn';
import { ExternalLinkIcon, GlobeIcon } from '@/components/ui/icons';

export interface LearningResourceCardProps {
  title: string;
  publisher: string;
  url: string;
  resourceType?: ResourceType;
  retrievedAt?: string | null;
  className?: string;
}

const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  official_docs: 'Official Docs',
  release_notes: 'Release Notes',
  article: 'Article',
  standard: 'Standard',
  video: 'Video',
  other: 'Resource',
};

const RESOURCE_TYPE_BADGE: Record<ResourceType, string> = {
  official_docs:
    'border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800/70 dark:bg-teal-950/60 dark:text-teal-200',
  release_notes:
    'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-200',
  article:
    'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  standard:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-200',
  video:
    'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/70 dark:bg-sky-950/60 dark:text-sky-200',
  other:
    'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

function resolveSafeHttpUrl(raw: string): { safeHref: string | null; domain: string } {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { safeHref: null, domain: '' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safeHref: null, domain: '' };
    }
    return {
      safeHref: parsed.toString(),
      domain: parsed.hostname.replace(/^www\./i, ''),
    };
  } catch {
    return { safeHref: null, domain: '' };
  }
}

/**
 * Component 20 `LearningResourceCard` (`C09` §2.5 / `PRD` §41, §58):
 * Attribution-only external learning resource link card with safe `https?://` validation,
 * `target="_blank" rel="noopener noreferrer"`, and screen-reader new-tab announcement.
 */
export function LearningResourceCard({
  title,
  publisher,
  url,
  resourceType = 'official_docs',
  retrievedAt,
  className,
}: LearningResourceCardProps) {
  const { safeHref, domain } = resolveSafeHttpUrl(url);
  const label = RESOURCE_TYPE_LABELS[resourceType] ?? 'Resource';
  const badgeClass =
    RESOURCE_TYPE_BADGE[resourceType] ?? RESOURCE_TYPE_BADGE.other;

  const content = (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-medium leading-none',
            badgeClass,
          )}
        >
          {label}
        </span>
        {domain && (
          <span className="inline-flex items-center gap-1 text-xs leading-none text-slate-500 dark:text-slate-400">
            <GlobeIcon className="block h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{domain}</span>
          </span>
        )}
      </div>

      <p
        className="text-body-md font-semibold text-slate-900 group-hover:text-teal-700 dark:text-slate-100 dark:group-hover:text-teal-300"
        dir="auto"
      >
        {title}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-slate-500 dark:text-slate-400">
        <span dir="auto">Source: {publisher}</span>
        {retrievedAt && (
          <span>Verified {retrievedAt.slice(0, 10)}</span>
        )}
      </div>
    </div>
  );

  if (!safeHref) {
    return (
      <div
        className={cn(
          'flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60',
          className,
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group flex min-h-11 items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-teal-400/70 hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500/60 dark:hover:bg-slate-800/60',
        className,
      )}
    >
      {content}
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors group-hover:border-teal-200 group-hover:bg-teal-50 group-hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:border-teal-800 dark:group-hover:bg-teal-950/60 dark:group-hover:text-teal-300">
        <ExternalLinkIcon className="block h-4 w-4 shrink-0" />
        <span className="sr-only">(opens in new tab)</span>
      </span>
    </a>
  );
}
