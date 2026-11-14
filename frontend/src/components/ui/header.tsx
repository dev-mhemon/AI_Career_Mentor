'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { cn } from './cn';
import { SkipLink } from './skip-link';
import { InfoIcon } from './icons';

export type HeaderVariant = 'public' | 'authenticated' | 'admin';

export interface HeaderNavItem {
  href: string;
  label: string;
}

export interface HeaderProps {
  variant?: HeaderVariant;
  nav?: HeaderNavItem[];
  /** Right-side slot (account menu, focus switcher, etc.). */
  actions?: React.ReactNode;
  /** Force offline_banner state; defaults to browser connectivity. */
  offline?: boolean;
  /** Render a SkipLink inside the header (layout already has one; off by default). */
  includeSkipLink?: boolean;
}

const defaultNav: Record<HeaderVariant, HeaderNavItem[]> = {
  public: [
    { href: '/', label: 'Home' },
    { href: '/login', label: 'Sign in' },
    { href: '/register', label: 'Create account' },
  ],
  authenticated: [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/onboarding/profile', label: 'Profile Setup' },
    { href: '/settings', label: 'Settings' },
  ],
  admin: [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/onboarding/profile', label: 'Profile Setup' },
    { href: '/settings', label: 'Settings' },
  ],
};

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
const isOffline = () => !navigator.onLine;

export function Header({ variant = 'public', nav, actions, offline, includeSkipLink = false }: HeaderProps) {
  const browserOffline = useSyncExternalStore(subscribe, isOffline, () => false);
  const showOffline = offline ?? browserOffline;
  const items = nav ?? defaultNav[variant];

  return (
    <>
      {includeSkipLink && <SkipLink />}
      <header
        className="sticky top-0 z-(--z-header) flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-default bg-surface-default px-4 py-2 text-text-primary"
        style={{ minHeight: 'var(--size-header-height)' }}
      >
        <Link href="/" className="flex min-h-11 items-center text-heading-sm transition-colors hover:text-text-brand">
          AI Career Mentor
          {variant === 'admin' && (
            <span className="ml-2 rounded-full border border-border-default px-2 text-caption text-text-secondary">Admin</span>
          )}
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cn('flex min-h-11 items-center rounded-md px-3 text-label-lg text-text-secondary hover:bg-action-ghost-background-hover hover:text-text-primary')}
            >
              {i.label}
            </Link>
          ))}
          {actions}
        </nav>
      </header>
      {showOffline && (
        <div
          role="status"
          className="flex items-center gap-2 border-b border-feedback-info-border bg-feedback-info-background px-4 py-2 text-body-sm text-feedback-info-text"
        >
          <InfoIcon className="shrink-0 text-feedback-info-icon" />
          <span>You are offline. Reconnect to continue learning.</span>
        </div>
      )}
    </>
  );
}
