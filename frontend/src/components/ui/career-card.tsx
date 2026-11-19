'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { CheckIcon } from './icons';
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

  const body = (
    <>
      <RowTag className="flex flex-wrap items-center gap-2">
        <TitleTag dir="auto" className="text-heading-sm text-text-primary">
          {title}
        </TitleTag>
        {recommended !== undefined && (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium',
              recommended
                ? 'border-border-focus bg-surface-subtle text-text-brand'
                : 'border-border-default bg-surface-default text-text-secondary',
            )}
          >
            {recommended ? 'Recommended' : 'Alternative'}
          </span>
        )}
        {status && <GoalStatusBadge status={status} />}
        {selectable && selected && (
          <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-text-brand">
            <CheckIcon className="h-4 w-4" aria-hidden="true" />
            Selected
          </span>
        )}
      </RowTag>
      {(category || level) && (
        <TextTag className="block text-caption text-text-secondary">
          {[category, level ? `${LEVEL_LABEL[level]} level` : null]
            .filter(Boolean)
            .join(' · ')}
        </TextTag>
      )}
      {rationale ? (
        <TextTag dir="auto" className="block text-body-sm text-text-secondary">
          {rationale}
        </TextTag>
      ) : null}
      {children}
    </>
  );

  const shell =
    'flex w-full flex-col gap-2 rounded-lg border bg-surface-default p-4 text-left shadow-xs';

  if (!selectable) {
    return <article className={cn(shell, 'border-border-default', className)}>{body}</article>;
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
        'min-h-11 cursor-pointer transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled',
        selected
          ? 'border-2 border-border-focus bg-surface-subtle'
          : 'border-border-strong hover:border-border-focus',
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
