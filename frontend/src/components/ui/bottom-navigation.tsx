'use client';

import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { cn } from './cn';
import {
  BookOpenIcon,
  BotIcon,
  CalendarDaysIcon,
  CompassIcon,
  LockIcon,
  TargetIcon,
} from './icons';
import { useSafePathname } from '@/lib/navigation/use-safe-pathname';

export type BottomNavFeatureKey =
  | 'roadmap_generator'
  | 'daily_plan'
  | 'quiz_practice'
  | 'ai_practice_review'
  | 'progress_tracking'
  | 'ai_mentor'
  | 'technology_update';

export type BottomNavTab = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  activePrefixes: readonly string[];
  featureKey?: BottomNavFeatureKey;
};

export const LEARNER_BOTTOM_NAV_TABS: readonly BottomNavTab[] = [
  {
    href: '/today',
    label: 'Today',
    icon: BookOpenIcon,
    activePrefixes: ['/today'],
    featureKey: 'daily_plan',
  },
  {
    href: '/roadmaps',
    label: 'Roadmap',
    icon: CompassIcon,
    activePrefixes: ['/roadmaps'],
    featureKey: 'roadmap_generator',
  },
  {
    href: '/daily-plan',
    label: 'Daily Plan',
    icon: CalendarDaysIcon,
    activePrefixes: ['/daily-plan', '/quiz'],
    featureKey: 'daily_plan',
  },
  {
    href: '/progress',
    label: 'Progress',
    icon: TargetIcon,
    activePrefixes: ['/progress'],
    featureKey: 'progress_tracking',
  },
  {
    href: '/mentor',
    label: 'Mentor',
    icon: BotIcon,
    activePrefixes: ['/mentor'],
    featureKey: 'ai_mentor',
  },
];

export type BottomNavigationProps = {
  pathname?: string;
  todayReadyDot?: boolean;
  effectiveAccess?: Partial<Record<BottomNavFeatureKey, boolean>>;
  className?: string;
};

function isTabActive(pathname: string, tab: BottomNavTab): boolean {
  return tab.activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Component 03 — Mobile-only (`< 768px`) 5-tab thumb-zone navigation bar (`C09 §2.1`).
 * Rendered exclusively for active learner accounts inside `AppShell` (omitted on admin and suspended states).
 */
export function BottomNavigation({
  pathname: pathnameProp,
  todayReadyDot = false,
  effectiveAccess,
  className,
}: BottomNavigationProps) {
  const safePathname = useSafePathname();
  const currentPath = pathnameProp ?? safePathname;

  return (
    <nav
      role="navigation"
      aria-label="Primary Mobile Navigation"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900/95 md:hidden',
        className,
      )}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5 items-stretch px-1 py-1">
        {LEARNER_BOTTOM_NAV_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(currentPath, tab);
          const locked = Boolean(
            tab.featureKey && effectiveAccess?.[tab.featureKey] === false,
          );
          const showReadyDot = tab.href === '/today' && todayReadyDot;
          const accessibleLabel = locked
            ? `${tab.label} (feature restricted)`
            : showReadyDot
              ? `${tab.label} (ready)`
              : tab.label;

          return (
            <li key={tab.href} className="flex">
              <Link
                href={tab.href}
                aria-label={accessibleLabel}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] font-medium leading-tight transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600',
                  active
                    ? 'text-teal-700 dark:text-teal-300'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
                )}
              >
                <span className="relative inline-flex items-center justify-center">
                  <Icon className="h-5 w-5" />
                  {showReadyDot && (
                    <span
                      aria-hidden="true"
                      data-testid="bottom-nav-today-ready-dot"
                      className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-teal-600 ring-2 ring-white dark:bg-teal-400 dark:ring-slate-900"
                    />
                  )}
                  {locked && (
                    <LockIcon
                      data-testid={`bottom-nav-lock-${tab.href.slice(1)}`}
                      className="absolute -right-2 -top-1 h-3 w-3 text-slate-400 dark:text-slate-500"
                    />
                  )}
                </span>
                <span className="truncate">{tab.label}</span>
                {showReadyDot && <span className="sr-only">Ready</span>}
                {locked && <span className="sr-only">Restricted</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
