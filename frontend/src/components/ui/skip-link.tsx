import { cn } from './cn';

export function SkipLink({ href = '#main-content', children = 'Skip to main content' }: { href?: string; children?: string }) {
  return (
    <a
      href={href}
      className={cn(
        'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-(--z-tooltip)',
        'focus:rounded-md focus:bg-action-primary-background focus:px-4 focus:py-2',
        'focus:text-label-lg focus:text-action-primary-foreground',
      )}
    >
      {children}
    </a>
  );
}
