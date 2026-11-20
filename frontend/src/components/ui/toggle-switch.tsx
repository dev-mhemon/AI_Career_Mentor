'use client';

import { useId } from 'react';
import { cn } from './cn';

export interface ToggleSwitchProps {
  checked: boolean;
  /** Called with the next value when the user toggles. */
  onCheckedChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** `saving` state: sets `aria-busy` and ignores further toggles. */
  saving?: boolean;
  id?: string;
  className?: string;
}

/**
 * Component #08 `ToggleSwitch` (`standard` variant).
 * Native `<button role="switch">`, so Space/Enter activate it through the browser's button semantics.
 */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  saving = false,
  id,
  className,
}: ToggleSwitchProps) {
  const uid = useId();
  const baseId = id ?? `toggle-${uid}`;
  const labelId = `${baseId}-label`;
  const descId = `${baseId}-desc`;
  const inactive = disabled || saving;

  return (
    <div
      className={cn(
        'flex min-h-11 items-center justify-between gap-4 rounded-md border px-3 py-2',
        'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
        checked
          ? 'border-border-focus bg-surface-subtle'
          : 'border-border-default bg-surface-default',
        inactive && 'bg-surface-disabled',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span
          id={labelId}
          dir="auto"
          className={cn(
            'text-label-lg',
            disabled ? 'text-text-disabled' : 'text-text-primary',
          )}
        >
          {label}
        </span>
        {description && (
          <span id={descId} dir="auto" className="text-caption text-text-secondary">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        id={baseId}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        aria-busy={saving ? 'true' : undefined}
        disabled={disabled}
        aria-disabled={inactive || undefined}
        onClick={() => {
          if (!inactive) onCheckedChange(!checked);
        }}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
          'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed',
          checked ? 'bg-action-primary-background' : 'bg-neutral-300 dark:bg-neutral-600',
          (disabled || saving) && 'opacity-(--opacity-disabled)',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs',
            'transition-transform duration-(--duration-fast) ease-standard motion-reduce:transition-none',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
