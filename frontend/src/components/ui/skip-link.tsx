import { cn } from './cn';

export function SkipLink({ href = '#main-content', children = 'Skip to main content' }: { href?: string; children?: string }) {
  return (
    <a
      href={href}
      className={cn(
        'sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-(--z-tooltip)',
        'focus-visible:rounded-md focus-visible:bg-action-primary-background focus-visible:px-4 focus-visible:py-2',
        'focus-visible:text-label-lg focus-visible:text-action-primary-foreground',
      )}
    >
      {children}
    </a>
  );
}
