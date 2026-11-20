'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';
import type { CareerLevel, GoalStatus } from '@/lib/api/client';

const STATUS_LABEL: Record<GoalStatus, string> = {
  clarifying: 'Clarifying',
  awaiting_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  discontinued: 'Discontinued',
};

const STATUS_TONE: Record<GoalStatus, string> = {
  clarifying:
    'border-feedback-info-border bg-feedback-info-background text-feedback-info-text',
  awaiting_confirmation:
    'border-feedback-warning-border bg-feedback-warning-background text-feedback-warning-text',
  confirmed:
    'border-feedback-success-border bg-feedback-success-background text-feedback-success-text',
  discontinued:
    'border-border-default bg-surface-subtle text-text-muted',
};

const LEVEL_LABEL: Record<CareerLevel, string> = {
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
};

/** Text-labelled (never color-only) goal status badge shared by Screen 11 and Screen 14. */
export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-medium',
        STATUS_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export interface CareerCardProps {
  /** Canonical role title. */
  title: string;
  /** `R29`: nullable. When `null`/absent, no rationale text is rendered. */
  rationale?: string | null;
  category?: string | null;
  level?: CareerLevel | null;
  /** Marks the AI's primary proposal (`true`) vs an alternative (`false`). */
  recommended?: boolean;
  /** Optional explicit badge copy (overrides default `"Recommended"` / `"Alternative"` label). */
  badgeLabel?: string;
  status?: GoalStatus;
  /** When provided, the card behaves as a radio option. */
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * Component #13 `CareerCard`.
 * Selectable mode renders `role="radio"` + `aria-checked` and must sit inside `CareerCardGroup`.
 */
export function CareerCard({
  title,
  rationale = null,
  category,
  level,
  recommended,
  badgeLabel,
  status,
  selected = false,
  onSelect,
  disabled = false,
  children,
  className,
}: CareerCardProps) {
  const selectable = typeof onSelect === 'function';
  const TitleTag = selectable ? 'span' : 'h3';
  const TextTag = selectable ? 'span' : 'p';
  const RowTag = selectable ? 'span' : 'div';

  const resolvedBadgeLabel =
    badgeLabel ??
    (recommended !== undefined ? (recommended ? 'Recommended' : 'Alternative') : null);
  const hasBadges = Boolean(resolvedBadgeLabel) || Boolean(status);
  const hasTopRow = selectable || hasBadges;

  const body = (
    <>
      {hasTopRow && (
        <RowTag className="flex w-full items-center justify-between gap-2">
          {selectable ? (
            <span
              aria-hidden="true"
              className={cn(
                'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] shadow-xs ring-4 transition-all duration-200 ease-out motion-reduce:transition-none',
                selected
                  ? 'border-teal-600 bg-teal-600 ring-teal-500/15 dark:border-teal-400 dark:bg-teal-500 dark:ring-teal-400/20'
                  : 'border-slate-300 bg-white ring-transparent group-hover:border-teal-500/80 group-hover:ring-teal-500/10 dark:border-slate-600 dark:bg-surface-default dark:group-hover:border-teal-400 dark:group-hover:ring-teal-400/15',
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full bg-white transition-all duration-200 ease-out motion-reduce:transition-none',
                  selected ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
                )}
              />
            </span>
          ) : (
            <span aria-hidden="true" />
          )}
          {hasBadges && (
            <RowTag className="flex flex-wrap items-center justify-end gap-2">
              {resolvedBadgeLabel && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium transition-colors duration-200 ease-out motion-reduce:transition-none',
                    recommended
                      ? 'border-border-focus bg-surface-subtle text-text-brand'
                      : 'border-border-default bg-surface-default text-text-secondary',
                  )}
                >
                  {resolvedBadgeLabel}
                </span>
              )}
              {status && <GoalStatusBadge status={status} />}
            </RowTag>
          )}
        </RowTag>
      )}
      <TitleTag
        dir="auto"
        className={cn(
          'block w-full text-left text-heading-sm text-text-primary transition-colors duration-200 ease-out motion-reduce:transition-none',
          hasTopRow && 'mt-3',
        )}
      >
        {title}
      </TitleTag>
      {(category || level) && (
        <TextTag className="mt-1.5 block text-caption text-text-secondary">
          {[category, level ? `${LEVEL_LABEL[level]} level` : null]
            .filter(Boolean)
            .join(' · ')}
        </TextTag>
      )}
      {rationale ? (
        <TextTag dir="auto" className="mt-1.5 block text-body-sm text-text-secondary">
          {rationale}
        </TextTag>
      ) : null}
      {children}
    </>
  );

  const shell = 'flex h-full w-full flex-col rounded-lg p-4 text-left shadow-xs';

  if (!selectable) {
    return (
      <article
        className={cn(
          shell,
          'border border-border-default bg-surface-default',
          className,
        )}
      >
        {body}
      </article>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        shell,
        'group min-h-[120px] cursor-pointer border-[1.5px] ring-4 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:hover:translate-y-0 disabled:hover:shadow-none',
        selected
          ? 'border-teal-600 bg-teal-50/60 shadow-sm ring-teal-500/20 dark:border-teal-400 dark:bg-teal-950/40 dark:ring-teal-400/25'
          : 'border-slate-200/90 bg-white ring-transparent hover:-translate-y-0.5 hover:border-teal-400/80 hover:bg-slate-50/70 hover:shadow-md active:translate-y-0 dark:border-border-default dark:bg-surface-default dark:hover:border-teal-400/80 dark:hover:bg-surface-subtle',
        className,
      )}
    >
      {body}
    </button>
  );
}

/** `role="radiogroup"` wrapper for selectable `CareerCard`s with ←/→/↑/↓ roving focus. */
export function CareerCardGroup({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = groupRef.current;
    if (!root) return;
    const radios = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="radio"]:not([disabled])'),
    );
    if (radios.length === 0) return;
    const checkedIndex = radios.findIndex((r) => r.getAttribute('aria-checked') === 'true');
    const activeIndex = checkedIndex >= 0 ? checkedIndex : 0;
    radios.forEach((radio, idx) => {
      radio.tabIndex = idx === activeIndex ? 0 : -1;
    });
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    const radios = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="radio"]:not([disabled])',
      ),
    );
    const index = radios.findIndex((el) => el === document.activeElement);
    if (index < 0 || radios.length === 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = radios[(index + step + radios.length) % radios.length];
    next.focus();
    next.click();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex flex-col gap-3', className)}
    >
      {children}
    </div>
  );
}
