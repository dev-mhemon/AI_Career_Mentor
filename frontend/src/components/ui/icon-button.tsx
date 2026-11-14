import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn';

export type IconButtonVariant = 'ghost' | 'outline' | 'danger';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  'aria-label': string;
  variant?: IconButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

const variants: Record<IconButtonVariant, string> = {
  ghost:
    'text-action-ghost-foreground hover:bg-action-ghost-background-hover active:bg-action-ghost-background-active disabled:text-action-ghost-foreground-disabled',
  outline:
    'border border-action-secondary-border text-action-secondary-foreground hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active disabled:text-action-secondary-foreground-disabled',
  danger:
    'text-text-danger hover:bg-feedback-danger-background active:bg-feedback-danger-background disabled:text-text-disabled',
};

export function IconButton({
  variant = 'ghost',
  type = 'button',
  className,
  children,
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-md',
        'transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
