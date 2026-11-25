'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui/cn';

export type StarRatingProps = {
  value: number | null;
  onChange: (score: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
};

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export const STAR_LEVEL_COLOR_CLASSES: Readonly<Record<number, string>> = {
  1: 'text-rose-500 dark:text-rose-400',
  2: 'text-orange-500 dark:text-orange-400',
  3: 'text-amber-400 dark:text-amber-300',
  4: 'text-lime-500 dark:text-lime-400',
  5: 'text-emerald-500 dark:text-emerald-400',
};

const UNFILLED_STAR_CLASS = 'text-slate-300 dark:text-slate-600';

export function StarIcon({
  filled,
  className,
}: {
  filled: boolean;
  className?: string;
}) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'transparent'}
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn(
        'block shrink-0 transition-[color,fill,transform] duration-200 ease-out',
        className ?? 'h-5 w-5 sm:h-6 sm:w-6',
      )}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/**
 * Reusable accessible 1–5 star rating control (`role="radiogroup"`).
 *
 * - Smooth hover & fill transition across stars `1..N` with distinct color scale per level (`1..5`).
 * - Tight optical star spacing (`gap-0.5`, compact button padding `p-1 sm:p-1.5`) with responsive
 *   `h-5 w-5 sm:h-6 sm:w-6` star glyphs and full roving-tabindex keyboard arrow navigation.
 */
export function StarRating({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Rate this content',
  size = 'md',
  className,
}: StarRatingProps) {
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const starButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeVisualStar = (!disabled ? hoveredStar : null) ?? value ?? 0;
  const activeColorClass =
    STAR_LEVEL_COLOR_CLASSES[activeVisualStar] ?? UNFILLED_STAR_CLASS;

  const handleSelect = (star: number) => {
    if (disabled) {
      return;
    }
    onChange(star);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    star: number,
  ) => {
    if (disabled) {
      return;
    }
    let nextStar: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextStar = star < 5 ? star + 1 : 1;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextStar = star > 1 ? star - 1 : 5;
    }
    if (nextStar !== null) {
      event.preventDefault();
      handleSelect(nextStar);
      starButtonRefs.current[nextStar - 1]?.focus();
    }
  };

  const buttonPaddingClass =
    size === 'sm' ? 'min-h-11 min-w-11 p-2' : 'min-h-11 min-w-11 p-2 sm:p-2.5';
  const iconSizeClass =
    size === 'sm' ? 'h-5 w-5' : 'h-5 w-5 sm:h-6 sm:w-6';

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onMouseLeave={() => setHoveredStar(null)}
      className={cn('inline-flex items-center gap-1', className)}
    >
      {STAR_VALUES.map((star, idx) => {
        const isSelected = value === star;
        const isTabStop = isSelected || (value === null && star === 1);
        const isFilled = star <= activeVisualStar;

        return (
          <button
            key={star}
            ref={(el) => {
              starButtonRefs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
            tabIndex={isTabStop ? 0 : -1}
            disabled={disabled}
            onMouseEnter={() => {
              if (!disabled) {
                setHoveredStar(star);
              }
            }}
            onClick={() => handleSelect(star)}
            onKeyDown={(e) => handleKeyDown(e, star)}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center rounded-lg transition-[color,transform] duration-200 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 disabled:active:scale-100',
              buttonPaddingClass,
              isFilled ? activeColorClass : UNFILLED_STAR_CLASS,
            )}
          >
            <StarIcon filled={isFilled} className={iconSizeClass} />
          </button>
        );
      })}
    </div>
  );
}
