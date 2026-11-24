'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  listTechnologyUpdates,
  type TechnologyUpdateListDTO,
} from '@/lib/api/client';
import { mapApiError, type MappedError } from '@/lib/api/error-mapper';
import {
  ACTION_TIMING_LABELS,
  getActionTimingChipClass,
  getReleaseStatusChipClass,
  getRelevanceChipClass,
  RELEASE_STATUS_LABELS,
  RELEVANCE_LEVEL_LABELS,
} from './tech-update-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import {
  ChevronRightIcon,
  RadioIcon,
  RefreshCwIcon,
  SpinnerIcon,
} from '@/components/ui/icons';

export type DashboardTechUpdatesPreviewProps = {
  accessToken: string;
  enabled: boolean;
};

type ScopedPreviewState = {
  token: string;
  status: 'loading' | 'ready' | 'error';
  listData: TechnologyUpdateListDTO | null;
  error: MappedError | null;
};

/**
 * Screen 13 (`/dashboard`) optional Technology Updates preview card (`Accepted N01 implementation contract`):
 * - Rendered ONLY when `effective_access.technology_update === true`.
 * - When `enabled === false`, renders `null` and makes ZERO `EP-T01` requests.
 * - Loading, `generation_pending`, `no_important_changes`, `temporarily_unavailable`, and fetch errors
 *   remain strictly card-local and never block Today, Roadmaps, or Progress.
 */
export function DashboardTechUpdatesPreview({
  accessToken,
  enabled,
}: DashboardTechUpdatesPreviewProps) {
  const [reloadTick, setReloadTick] = useState(0);
  const [scopedState, setScopedState] = useState<ScopedPreviewState>(() => ({
    token: accessToken,
    status: 'loading',
    listData: null,
    error: null,
  }));

  const fetchGenRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const gen = ++fetchGenRef.current;
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await listTechnologyUpdates(accessToken, {
          limit: 1,
          signal: controller.signal,
        });
        if (controller.signal.aborted || gen !== fetchGenRef.current) {
          return;
        }
        setScopedState({
          token: accessToken,
          status: 'ready',
          listData: res.data,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted || gen !== fetchGenRef.current) {
          return;
        }
        setScopedState({
          token: accessToken,
          status: 'error',
          listData: null,
          error: mapApiError(err, { feature: 'technology_update' }),
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [accessToken, enabled, reloadTick]);

  if (!enabled) {
    return null;
  }

  const status: ScopedPreviewState['status'] =
    scopedState.token !== accessToken ? 'loading' : scopedState.status;
  const listData =
    scopedState.token === accessToken ? scopedState.listData : null;
  const error = scopedState.token === accessToken ? scopedState.error : null;
  const latestItem = listData?.items[0] ?? null;

  return (
    <article
      aria-label="Daily technology update preview"
      className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider leading-none text-teal-700 dark:text-teal-300">
          <RadioIcon className="block h-3.5 w-3.5 shrink-0" />
          <span>Daily Technology Intelligence</span>
        </span>
        <Link
          href="/tech-updates"
          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 transition-colors hover:text-teal-800 hover:underline dark:text-teal-300"
        >
          <span>Open Tech Updates</span>
          <ChevronRightIcon className="block h-3.5 w-3.5 shrink-0" />
        </Link>
      </div>

      {status === 'loading' && (
        <div
          aria-busy="true"
          className="flex items-center gap-2.5 text-body-sm text-slate-600 dark:text-slate-400"
        >
          <SpinnerIcon className="block h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
          <span>Checking today&apos;s personalized technology update...</span>
        </div>
      )}

      {status === 'error' && error && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-sm text-slate-600 dark:text-slate-400">
            {error.message}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setScopedState((prev) => ({
                ...prev,
                token: accessToken,
                status: 'loading',
                error: null,
              }));
              setReloadTick((prev) => prev + 1);
            }}
          >
            <RefreshCwIcon className="block h-3.5 w-3.5 shrink-0" />
            <span>Retry</span>
          </Button>
        </div>
      )}

      {status === 'ready' && listData && (
        <div className="flex flex-col gap-3">
          {latestItem ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
                    getReleaseStatusChipClass(latestItem.release_status),
                  )}
                >
                  {RELEASE_STATUS_LABELS[latestItem.release_status]}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
                    getRelevanceChipClass(latestItem.relevance),
                  )}
                >
                  {RELEVANCE_LEVEL_LABELS[latestItem.relevance]}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
                    getActionTimingChipClass(latestItem.action_timing),
                  )}
                >
                  {ACTION_TIMING_LABELS[latestItem.action_timing]}
                </span>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  {latestItem.local_date}
                </span>
              </div>

              <Link
                href="/tech-updates"
                className="text-base font-semibold text-slate-900 transition-colors hover:text-teal-700 hover:underline dark:text-slate-100 dark:hover:text-teal-300"
                dir="auto"
              >
                {latestItem.title}
              </Link>
              <p
                className="text-body-sm text-slate-600 dark:text-slate-400"
                dir="auto"
              >
                {latestItem.why_it_matters}
              </p>
            </div>
          ) : listData.generation_pending ? (
            <p className="text-body-sm text-slate-600 dark:text-slate-400">
              Today&apos;s personalized technology update is scheduled for
              background generation.
            </p>
          ) : (
            <p className="text-body-sm text-slate-600 dark:text-slate-400">
              {listData.message ??
                'No important changes for your current learning path today.'}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
