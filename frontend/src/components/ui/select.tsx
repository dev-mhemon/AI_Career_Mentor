'use client';

import type { ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { cn } from './cn';
import { ChevronDownIcon } from './icons';
import { FieldShell } from './input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  labelBadge?: ReactNode;
  placeholder?: string;
  options?: readonly SelectOption[];
  children?: ReactNode;
  ref?: Ref<HTMLSelectElement>;
}

const SELECT_BASE_CLASS =
  'min-h-11 w-full cursor-pointer appearance-none truncate rounded-md border bg-surface-default py-2 pl-3 pr-10 text-body text-text-primary ' +
  'transition-colors duration-(--duration-fast) ease-standard focus:outline-none focus:ring-2 ' +
  'disabled:cursor-not-allowed disabled:border-border-disabled disabled:bg-surface-disabled disabled:text-text-disabled';

/**
 * Reusable `<Select>` primitive with `appearance-none` and a right-padded `ChevronDownIcon`
 * matching the height, border, radius, and chevron style of `Input` and the Career Goal combobox.
 */
export function Select({
  id,
  label,
  error,
  hint,
  labelBadge,
  required,
  placeholder,
  options,
  children,
  className,
  disabled,
  ref,
  ...rest
}: SelectProps) {
  const describedBy = error
    ? `${id}-error`
    : hint
      ? `${id}-hint`
      : undefined;

  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      error={error}
      hint={hint}
      labelBadge={labelBadge}
    >
      <div className="group relative">
        <select
          ref={ref}
          id={id}
          required={required}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          className={cn(
            SELECT_BASE_CLASS,
            error
              ? 'border-2 border-border-danger focus:ring-border-danger'
              : 'border-border-default hover:border-border-strong focus:border-border-focus focus:ring-focus-ring',
            className,
          )}
          {...rest}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-muted transition-colors duration-(--duration-fast)',
            disabled
              ? 'text-text-disabled'
              : 'group-hover:text-text-primary group-focus-within:text-text-brand',
          )}
        >
          <ChevronDownIcon className="h-4 w-4 transition-transform duration-(--duration-fast) ease-standard motion-reduce:transition-none group-focus-within:rotate-180" />
        </span>
      </div>
    </FieldShell>
  );
}
