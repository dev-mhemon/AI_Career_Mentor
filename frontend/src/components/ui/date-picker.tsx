'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from './icons';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const SHORT_MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

type CalendarDayCell = {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
  disabled: boolean;
  isToday: boolean;
  isSelected: boolean;
};

export type DatePickerProps = {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  error?: string;
  clearable?: boolean;
  className?: string;
  'aria-label'?: string;
};

function parseIsoUtcParts(
  raw: string,
): { year: number; month: number; day: number } | null {
  const trimmed = raw.trim();
  if (!ISO_DATE_PATTERN.test(trimmed)) return null;
  const [yStr, mStr, dStr] = trimmed.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toIsoUtcDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayUtcParts(): {
  year: number;
  month: number;
  day: number;
  iso: string;
} {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  return { year, month, day, iso: toIsoUtcDate(year, month, day) };
}

export function formatDatePickerDisplay(iso: string): string | null {
  const parts = parseIsoUtcParts(iso);
  if (!parts) return null;
  return `${SHORT_MONTH_NAMES[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function isOutOfBounds(iso: string, min?: string, max?: string): boolean {
  const validMin = min && parseIsoUtcParts(min) ? min.trim() : null;
  const validMax = max && parseIsoUtcParts(max) ? max.trim() : null;
  if (validMin && iso < validMin) return true;
  if (validMax && iso > validMax) return true;
  return false;
}

function buildCalendarGrid(
  viewYear: number,
  viewMonth: number,
  selectedIso: string,
  todayIso: string,
  min?: string,
  max?: string,
): CalendarDayCell[] {
  const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
  const startWeekday = firstOfMonth.getUTCDay();
  const gridStartMs =
    Date.UTC(viewYear, viewMonth - 1, 1) - startWeekday * 86_400_000;

  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(gridStartMs + i * 86_400_000);
    const y = cellDate.getUTCFullYear();
    const m = cellDate.getUTCMonth() + 1;
    const d = cellDate.getUTCDate();
    const iso = toIsoUtcDate(y, m, d);
    cells.push({
      iso,
      day: d,
      inCurrentMonth: y === viewYear && m === viewMonth,
      disabled: isOutOfBounds(iso, min, max),
      isToday: iso === todayIso,
      isSelected: iso === selectedIso,
    });
  }
  return cells;
}

/**
 * Reusable Tailwind v4 UTC `DatePicker` emitting `YYYY-MM-DD` strings (or `''`).
 * Provides an elevated accessible calendar popover (`role="dialog"`, `aria-modal="false"`),
 * month navigation, `Today (UTC)` / `Clear` shortcuts, and keyboard-only `focus-visible` outlines.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  placeholder = 'Select date',
  min,
  max,
  disabled = false,
  error,
  clearable = true,
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const initialParts = parseIsoUtcParts(value) ?? getTodayUtcParts();
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initialParts.year);
  const [viewMonth, setViewMonth] = useState(initialParts.month);

  const today = useMemo(() => getTodayUtcParts(), []);
  const formattedValue = useMemo(() => formatDatePickerDisplay(value), [value]);
  const todayDisabled = isOutOfBounds(today.iso, min, max);

  const cells = useMemo(
    () =>
      buildCalendarGrid(
        viewYear,
        viewMonth,
        value.trim(),
        today.iso,
        min,
        max,
      ),
    [viewYear, viewMonth, value, today.iso, min, max],
  );

  const closeAndFocusTrigger = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        containerRef.current &&
        !containerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndFocusTrigger();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeAndFocusTrigger]);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen) {
      const anchor = parseIsoUtcParts(value) ?? getTodayUtcParts();
      setViewYear(anchor.year);
      setViewMonth(anchor.month);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDate = (iso: string) => {
    onChange(iso);
    closeAndFocusTrigger();
  };

  const handleSelectToday = () => {
    if (todayDisabled) return;
    setViewYear(today.year);
    setViewMonth(today.month);
    onChange(today.iso);
    closeAndFocusTrigger();
  };

  const handleClear = () => {
    onChange('');
    closeAndFocusTrigger();
  };

  const errorId = error ? `${id}-error` : undefined;

  return (
    <div ref={containerRef} className={cn('relative flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={id}
          className="text-label-lg text-text-primary"
        >
          {label}
        </label>
      )}

      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? popoverId : undefined}
        aria-describedby={errorId}
        onClick={handleToggle}
        className={cn(
          'flex h-11 min-h-11 w-full cursor-pointer items-center justify-between gap-2.5 rounded-md border bg-surface-default px-3 py-2 text-left text-body transition-colors duration-(--duration-fast) ease-standard focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled',
          error
            ? 'border-2 border-border-danger text-text-primary'
            : 'border-border-default text-text-primary hover:border-border-strong',
        )}
      >
        <span
          className={cn(
            'truncate',
            formattedValue
              ? 'text-text-primary'
              : 'font-light text-slate-500 dark:text-slate-400',
          )}
        >
          {formattedValue ?? placeholder}
        </span>
        <CalendarDaysIcon className="h-4 w-4 text-text-muted" />
      </button>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="text-caption font-medium text-feedback-danger-text"
        >
          {error}
        </p>
      )}

      {isOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-label={label ? `${label} calendar` : 'Choose date'}
          className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        >
          {/* Month / Year Header */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={handlePrevMonth}
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>

            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {MONTH_NAMES[viewMonth - 1]} {viewYear}
            </span>

            <button
              type="button"
              aria-label="Next month"
              onClick={handleNextMonth}
              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>

          {/* Weekday Headers */}
          <div
            aria-hidden="true"
            className="mb-1.5 grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
          >
            {WEEKDAY_LABELS.map((wd) => (
              <span key={wd} className="py-1">
                {wd}
              </span>
            ))}
          </div>

          {/* Day Grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                disabled={cell.disabled}
                aria-label={cell.iso}
                aria-pressed={cell.isSelected}
                aria-current={cell.isToday ? 'date' : undefined}
                onClick={() => handleSelectDate(cell.iso)}
                className={cn(
                  'inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-xs tabular-nums transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-35',
                  cell.isSelected
                    ? 'bg-teal-600 font-semibold text-white hover:bg-teal-700'
                    : cell.inCurrentMonth
                      ? 'text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                      : 'text-slate-400 hover:bg-slate-100/70 dark:text-slate-600 dark:hover:bg-slate-800/60',
                  cell.isToday &&
                    !cell.isSelected &&
                    'font-semibold ring-1 ring-teal-500/70',
                )}
              >
                {cell.day}
              </button>
            ))}
          </div>

          {/* Footer Shortcuts */}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <button
              type="button"
              disabled={todayDisabled}
              onClick={handleSelectToday}
              className="inline-flex min-h-9 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-teal-300 dark:hover:bg-teal-500/10"
            >
              Today (UTC)
            </button>
            {clearable && (
              <button
                type="button"
                disabled={!value}
                onClick={handleClear}
                className="inline-flex min-h-9 cursor-pointer items-center rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
