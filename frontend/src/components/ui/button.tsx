import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn';
import { SpinnerIcon } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'oauth' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Alias of loading. */
  isLoading?: boolean;
  /** Copy shown while loading (progress copy swap). */
  loadingText?: string;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-action-primary-background text-action-primary-foreground hover:bg-action-primary-background-hover active:bg-action-primary-background-active disabled:bg-action-primary-background-disabled disabled:text-action-primary-foreground-disabled',
  secondary:
    'border border-action-secondary-border bg-action-secondary-background text-action-secondary-foreground hover:bg-action-secondary-background-hover hover:border-action-secondary-border-hover active:bg-action-secondary-background-active disabled:text-action-secondary-foreground-disabled',
  ghost:
    'bg-transparent text-action-ghost-foreground hover:bg-action-ghost-background-hover active:bg-action-ghost-background-active disabled:text-action-ghost-foreground-disabled',
  destructive:
    'bg-action-destructive-background text-action-destructive-foreground hover:bg-action-destructive-background-hover active:bg-action-destructive-background-active disabled:bg-action-primary-background-disabled disabled:text-action-primary-foreground-disabled',
  oauth:
    'border border-border-default bg-surface-default text-text-primary hover:bg-surface-subtle active:bg-surface-sunken disabled:text-text-disabled',
  link: "relative h-auto min-h-0 bg-transparent px-0 text-text-link underline underline-offset-2 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:min-w-11 before:-translate-y-1/2 before:content-[''] hover:text-text-link-hover disabled:text-text-disabled",
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-label',
  md: 'h-10 px-4 text-label-lg',
  lg: 'h-12 px-6 text-label-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading: loadingProp = false,
  isLoading = false,
  loadingText,
  fullWidth = false,
  disabled,
  type = 'button',
  className,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const loading = loadingProp || isLoading;
  const isLink = variant === 'link';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors duration-(--duration-fast) ease-standard',
        'disabled:cursor-not-allowed',
        // 44x44 min touch target for controls under 44px
        size !== 'lg' &&
          !isLink &&
          "after:absolute after:left-1/2 after:top-1/2 after:h-11 after:min-w-11 after:w-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        !isLink && sizes[size],
        variants[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <SpinnerIcon />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </button>
  );
}
