'use client';

import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Button } from '@/components/ui/button';
import { SpinnerIcon } from '@/components/ui/icons';

export type AdminDataTableColumnAlign = 'left' | 'center' | 'right';

export type AdminDataTableColumn<T> = {
  key: string;
  header: string;
  align?: AdminDataTableColumnAlign;
  headerClassName?: string;
  cellClassName?: string;
  render: (row: T) => ReactNode;
};

function resolveColumnAlign<T>(
  col: AdminDataTableColumn<T>,
  index: number,
  total: number,
): AdminDataTableColumnAlign {
  if (col.align) return col.align;
  if (index === 0) return 'left';
  if (total > 1 && index === total - 1) return 'right';
  return 'center';
}

export type AdminDataTableProps<T> = {
  regionLabel: string;
  columns: readonly AdminDataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  refreshing?: boolean;
  skeletonRowCount?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  onClearFilters?: () => void;
  clearFiltersLabel?: string;
  pagination?: {
    hasPrevious?: boolean;
    hasNext: boolean;
    onPrevious?: () => void;
    onNext: () => void;
    loading?: boolean;
    pageLabel?: string;
    nextLabel?: string;
  };
  className?: string;
};

/**
 * Reusable accessible table for Admin Screens 23–25 (`C09` R16).
 * - Labelled horizontally scrollable region (`role="region"`, `aria-label`, `tabIndex={0}`)
 * - Matched-height first-load skeleton rows (refresh preserves visible rows)
 * - Empty state with optional `Clear filters` button (`min-h-11`)
 * - Cursor pagination controls (`min-h-11` targets, keyboard-only `focus-visible` outline)
 */
export function AdminDataTable<T>({
  regionLabel,
  columns,
  rows,
  rowKey,
  loading = false,
  refreshing = false,
  skeletonRowCount = 5,
  emptyTitle = 'No matching records',
  emptyDescription = 'Adjust your filters or date range to see results.',
  onClearFilters,
  clearFiltersLabel = 'Clear filters',
  pagination,
  className,
}: AdminDataTableProps<T>) {
  const showInitialSkeleton = loading && rows.length === 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {refreshing && !showInitialSkeleton && (
        <div
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 self-end text-caption text-text-secondary"
        >
          <SpinnerIcon className="h-3.5 w-3.5 text-action-primary-background" />
          <span>Refreshing results…</span>
        </div>
      )}

      <div
        role="region"
        aria-label={regionLabel}
        aria-busy={showInitialSkeleton || refreshing}
        tabIndex={0}
        className="w-full overflow-x-auto rounded-xl border border-border-default bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <table className="w-full min-w-[640px] border-collapse text-left text-body-sm">
          <thead>
            <tr className="border-b border-border-default bg-surface-subtle">
              {columns.map((col, colIdx) => {
                const align = resolveColumnAlign(col, colIdx, columns.length);
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-4 py-3 text-caption font-semibold uppercase tracking-wider text-text-secondary',
                      align === 'left' && 'text-left',
                      align === 'center' && 'text-center',
                      align === 'right' && 'text-right',
                      col.headerClassName,
                    )}
                  >
                    {col.header}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border-subtle">
            {showInitialSkeleton ? (
              Array.from({ length: skeletonRowCount }).map((_, rowIdx) => (
                <tr
                  key={`skeleton-${rowIdx}`}
                  data-testid="admin-table-skeleton-row"
                  aria-hidden="true"
                >
                  {columns.map((col, colIdx) => {
                    const align = resolveColumnAlign(
                      col,
                      colIdx,
                      columns.length,
                    );
                    return (
                      <td key={col.key} className="px-4 py-3.5">
                        <div
                          className={cn(
                            'h-4 w-24 animate-pulse rounded bg-surface-subtle motion-reduce:animate-none',
                            align === 'center' && 'mx-auto w-20',
                            align === 'right' && 'ml-auto w-16',
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-10 text-center"
                >
                  <div className="mx-auto flex max-w-md flex-col items-center gap-2">
                    <p className="text-body-md font-semibold text-text-primary">
                      {emptyTitle}
                    </p>
                    <p className="text-body-sm text-text-secondary">
                      {emptyDescription}
                    </p>
                    {onClearFilters && (
                      <div className="pt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          onClick={onClearFilters}
                        >
                          {clearFiltersLabel}
                        </Button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={rowKey(row, idx)}
                  className="transition-colors hover:bg-surface-subtle/60"
                >
                  {columns.map((col, colIdx) => {
                    const align = resolveColumnAlign(
                      col,
                      colIdx,
                      columns.length,
                    );
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          'px-4 py-3 align-middle text-text-primary',
                          align === 'left' && 'text-left',
                          align === 'center' && 'text-center tabular-nums',
                          align === 'right' && 'text-right tabular-nums',
                          col.cellClassName,
                        )}
                      >
                        {col.render(row)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && (pagination.hasPrevious || pagination.hasNext) && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-caption text-text-secondary">
            {pagination.pageLabel ?? ''}
          </p>
          <div className="flex items-center gap-2">
            {pagination.onPrevious && (
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={!pagination.hasPrevious || Boolean(pagination.loading)}
                onClick={pagination.onPrevious}
              >
                Previous
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={!pagination.hasNext || Boolean(pagination.loading)}
              loading={Boolean(pagination.loading)}
              onClick={pagination.onNext}
            >
              {pagination.nextLabel ?? 'Next'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
