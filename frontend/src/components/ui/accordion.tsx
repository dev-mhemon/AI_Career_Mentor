'use client';

import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export type AccordionItemProps = {
  id: string;
  isOpen: boolean;
  onToggle: () => void;
  header: ReactNode;
  children: ReactNode;
  /** Optional custom content inside the accessible toggle button (defaults to a rotating chevron). */
  triggerContent?: ReactNode;
  triggerAriaLabel?: string;
  triggerClassName?: string;
  triggerDisabled?: boolean;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
};

/**
 * Reusable accessible accordion card powered by CSS Grid row transitions
 * (`grid-rows-[0fr]` <-> `grid-rows-[1fr]` over `300ms` cubic-bezier, zero JS height measurement).
 *
 * Keeps mounted children inside the `min-h-0 overflow-hidden` track with `aria-hidden` + `inert`
 * while collapsed so close animations collapse as smoothly as open animations without tab-focus leaks.
 */
export function AccordionItem({
  id,
  isOpen,
  onToggle,
  header,
  children,
  triggerContent,
  triggerAriaLabel,
  triggerClassName,
  triggerDisabled = false,
  className,
  headerClassName,
  contentClassName,
}: AccordionItemProps) {
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;
  const hasContent =
    children !== null && children !== undefined && children !== false;

  return (
    <div className={cn('rounded-xl border transition-colors', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 p-4',
          headerClassName,
        )}
      >
        <div id={headerId} className="min-w-0 flex-1">
          {header}
        </div>

        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={triggerAriaLabel}
          aria-labelledby={
            triggerAriaLabel === undefined && triggerContent === undefined
              ? headerId
              : undefined
          }
          disabled={triggerDisabled}
          onClick={onToggle}
          className={cn(
            'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium leading-none whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName ??
              'border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
          )}
        >
          {triggerContent ?? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={cn(
                'block h-4 w-4 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                isOpen && 'rotate-180',
              )}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </button>
      </div>

      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        aria-hidden={!isOpen}
        inert={!isOpen ? true : undefined}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {hasContent && (
            <div
              className={cn(
                'border-t border-slate-200/80 px-4 pb-4 pt-4 dark:border-slate-800',
                contentClassName,
              )}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
