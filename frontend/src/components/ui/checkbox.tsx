'use client';

import { useEffect, useId, useRef, type Ref } from 'react';
import { cn } from './cn';
import { AlertCircleIcon, CheckIcon, MinusIcon } from './icons';

export type CheckboxVariant = 'standard' | 'warning_callout';

export interface CheckboxProps {
  label: React.ReactNode;
  variant?: CheckboxVariant;
  name?: string;
  id?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  value?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Checkbox({
  label,
  variant = 'standard',
  name,
  id,
  checked,
  defaultChecked,
  indeterminate = false,
  onChange,
  error,
  disabled,
  readOnly,
  required,
  value,
  ref,
}: CheckboxProps) {
  const autoId = useId();
  const cid = id ?? autoId;
  const inner = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate, checked]);

  const callout = variant === 'warning_callout';
  return (
    <div className="flex flex-col gap-1.5">
      <div className={callout ? undefined : 'inline-flex items-center'}>
        <label
        htmlFor={cid}
        className={cn(
          'cursor-pointer select-none gap-2.5 rounded-md',
          callout
            ? 'flex w-full items-start border border-feedback-warning-border bg-feedback-warning-background p-3 text-feedback-warning-text'
            : 'inline-flex min-h-11 items-center text-text-primary',
          disabled && 'cursor-not-allowed text-text-disabled',
        )}
      >
        <span
          className={cn(
            "relative inline-flex h-5 w-5 shrink-0 items-center justify-center before:absolute before:-inset-3 before:content-['']",
            callout && 'mt-0.5',
          )}
        >
          <input
            ref={(el) => {
              inner.current = el;
              if (typeof ref === 'function') ref(el);
              else if (ref) ref.current = el;
            }}
            id={cid}
            type="checkbox"
            name={name}
            value={value}
            checked={checked}
            defaultChecked={defaultChecked}
            disabled={disabled}
            required={required}
            aria-readonly={readOnly ? 'true' : undefined}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${cid}-error` : undefined}
            onClick={(e) => {
              if (readOnly) e.preventDefault();
            }}
            onChange={(e) => {
              if (readOnly) return;
              onChange?.(e.target.checked);
            }}
            className={cn(
              'peer h-5 w-5 cursor-[inherit] appearance-none rounded-sm border-2 bg-surface-default',
              'checked:border-action-primary-background checked:bg-action-primary-background',
              'indeterminate:border-action-primary-background indeterminate:bg-action-primary-background',
              error ? 'border-border-danger' : 'border-border-strong',
              'disabled:border-border-disabled disabled:bg-surface-disabled',
            )}
          />
          <CheckIcon className="pointer-events-none absolute hidden h-3.5 w-3.5 text-action-primary-foreground peer-checked:block peer-indeterminate:hidden" />
          <MinusIcon className="pointer-events-none absolute hidden h-3.5 w-3.5 text-action-primary-foreground peer-indeterminate:block" />
        </span>
        <span
          className={cn(
            'text-body leading-snug',
            callout &&
              required &&
              "after:ml-0.5 after:font-medium after:text-text-danger after:content-['*']",
          )}
          dir="auto"
        >
          {label}
        </span>
      </label>
      {!callout && required ? (
        <span aria-hidden="true" className="ml-0.5 font-medium text-text-danger">
          *
        </span>
      ) : null}
      </div>
      {error && (
        <p
          id={`${cid}-error`}
          className="flex items-center gap-1.5 pl-0 text-caption leading-snug text-text-danger"
        >
          <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
          <span dir="auto">{error}</span>
        </p>
      )}
    </div>
  );
}
