'use client';

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';

export type SegmentedTabItem = {
  id: string;
  label: string;
  badge?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type SegmentedTabsProps = {
  label: string;
  items: ReadonlyArray<SegmentedTabItem>;
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  idPrefix?: string;
  panelId?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Reusable accessible segmented tab control with a crisp section micro-title
 * and a 60fps sliding active background pill driven via direct DOM refs
 * (`useLayoutEffect` + `ResizeObserver`, zero synchronous `setState`).
 */
export function SegmentedTabs({
  label,
  items,
  activeId,
  onChange,
  ariaLabel,
  idPrefix,
  panelId,
  disabled = false,
  className,
}: SegmentedTabsProps) {
  const generatedId = useId();
  const prefix = idPrefix ?? generatedId;
  const labelId = `${prefix}-label`;

  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasMeasuredRef = useRef(false);

  const activeIndex = items.findIndex((item) => item.id === activeId);
  const resolvedActiveIndex = activeIndex >= 0 ? activeIndex : 0;
  const activeItemDisabled = Boolean(
    disabled || items[resolvedActiveIndex]?.disabled,
  );
  const firstEnabledIndex = disabled
    ? -1
    : items.findIndex((item) => !item.disabled);
  const rovingFocusIndex = activeItemDisabled
    ? firstEnabledIndex
    : resolvedActiveIndex;

  const updateIndicator = useCallback(
    (animate: boolean) => {
      const indicator = indicatorRef.current;
      const activeButton = tabRefs.current[resolvedActiveIndex];
      if (!indicator) {
        return;
      }
      if (!activeButton || activeButton.offsetWidth === 0) {
        indicator.style.opacity = '0';
        return;
      }

      if (!animate) {
        indicator.style.transition = 'none';
      } else {
        indicator.style.transition = '';
      }

      indicator.style.transform = `translate3d(${activeButton.offsetLeft}px, ${activeButton.offsetTop}px, 0)`;
      indicator.style.width = `${activeButton.offsetWidth}px`;
      indicator.style.height = `${activeButton.offsetHeight}px`;
      indicator.style.opacity = '1';

      if (!animate) {
        // Flush layout before re-enabling transitions for subsequent tab switches.
        void indicator.offsetWidth;
        indicator.style.transition = '';
      }
    },
    [resolvedActiveIndex],
  );

  useLayoutEffect(() => {
    const shouldAnimate = hasMeasuredRef.current;
    updateIndicator(shouldAnimate);
    hasMeasuredRef.current = true;

    const container = containerRef.current;
    const activeButton = tabRefs.current[resolvedActiveIndex];

    const handleResize = () => {
      updateIndicator(false);
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handleResize);
      if (container) {
        observer.observe(container);
      }
      if (activeButton) {
        observer.observe(activeButton);
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
    }

    return () => {
      observer?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
    };
  }, [updateIndicator, items, resolvedActiveIndex]);

  const handleKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (disabled || items.length === 0) {
      return;
    }

    const isItemDisabled = (idx: number) =>
      Boolean(disabled || items[idx]?.disabled);

    const findNextEnabled = (start: number, step: 1 | -1): number | null => {
      const count = items.length;
      for (let offset = 1; offset <= count; offset += 1) {
        const candidate = (start + step * offset + count) % count;
        if (!isItemDisabled(candidate)) {
          return candidate;
        }
      }
      return null;
    };

    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIdx = findNextEnabled(index, 1);
    } else if (e.key === 'ArrowLeft') {
      nextIdx = findNextEnabled(index, -1);
    } else if (e.key === 'Home') {
      nextIdx = items.findIndex((_, idx) => !isItemDisabled(idx));
      if (nextIdx < 0) nextIdx = null;
    } else if (e.key === 'End') {
      for (let idx = items.length - 1; idx >= 0; idx -= 1) {
        if (!isItemDisabled(idx)) {
          nextIdx = idx;
          break;
        }
      }
    }

    if (nextIdx === null) {
      return;
    }

    const target = items[nextIdx];
    if (!target) {
      return;
    }

    e.preventDefault();
    onChange(target.id);
    tabRefs.current[nextIdx]?.focus();
  };

  return (
    <div className={cn('min-w-0', className)}>
      <p
        id={labelId}
        className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
      >
        {label}
      </p>
      <div className="overflow-x-auto pb-1">
        <div
          ref={containerRef}
          role="tablist"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : labelId}
          className="relative inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-900/80"
        >
          <div
            ref={indicatorRef}
            aria-hidden="true"
            data-testid="segmented-tabs-indicator"
            className="pointer-events-none absolute top-0 left-0 z-0 rounded-lg bg-white opacity-0 shadow-sm ring-1 ring-slate-200/80 transition-[transform,width,height,opacity] duration-200 ease-out motion-reduce:transition-none dark:bg-slate-800 dark:ring-slate-700"
          />

          {items.map((item, idx) => {
            const selected = idx === resolvedActiveIndex;
            const itemDisabled = Boolean(disabled || item.disabled);
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                type="button"
                id={`${prefix}-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={idx === rovingFocusIndex ? 0 : -1}
                disabled={itemDisabled}
                onClick={() => onChange(item.id)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={cn(
                  'relative z-10 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm leading-none whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  selected
                    ? 'font-semibold text-teal-700 dark:text-teal-300'
                    : 'font-medium text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100',
                )}
              >
                {item.icon}
                <span dir="auto">{item.label}</span>
                {item.badge}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
