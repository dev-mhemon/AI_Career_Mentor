'use client';

import Link from 'next/link';
import type { ComponentType, RefObject, SVGProps } from 'react';
import { cn } from './cn';
import {
  BotIcon,
  CalendarDaysIcon,
  CloseIcon,
  CompassIcon,
  LayoutDashboardIcon,
  LockIcon,
  RadioIcon,
  SettingsIcon,
  SidebarToggleIcon,
  TargetIcon,
  UserCheckIcon,
} from './icons';
import { useSafePathname } from '@/lib/navigation/use-safe-pathname';

export interface SidebarNavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  lockedWhenSuspended?: boolean;
  activePrefixes?: string[];
}

export interface SidebarSection {
  title: string;
  items: SidebarNavItem[];
}

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: 'MAIN',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboardIcon,
        lockedWhenSuspended: true,
      },
      {
        href: '/daily-plan',
        label: 'Daily Plan',
        icon: CalendarDaysIcon,
        lockedWhenSuspended: true,
        activePrefixes: ['/daily-plan', '/today', '/quiz'],
      },
      {
        href: '/progress',
        label: 'Progress',
        icon: TargetIcon,
        lockedWhenSuspended: true,
      },
      {
        href: '/roadmaps',
        label: 'Roadmaps',
        icon: CompassIcon,
        lockedWhenSuspended: true,
      },
      {
        href: '/mentor',
        label: 'AI Mentor',
        icon: BotIcon,
        lockedWhenSuspended: true,
      },
      {
        href: '/tech-updates',
        label: 'Tech Updates',
        icon: RadioIcon,
        lockedWhenSuspended: true,
      },
      {
        href: '/profile',
        label: 'Profile',
        icon: UserCheckIcon,
        lockedWhenSuspended: true,
      },
      {
        href: '/career-profile',
        label: 'Career Goals',
        icon: CompassIcon,
        lockedWhenSuspended: true,
      },
    ],
  },
  {
    title: 'ACCOUNT & WORKSPACE',
    items: [
      {
        href: '/settings',
        label: 'Settings',
        icon: SettingsIcon,
      },
    ],
  },
];

export interface SidebarProps {
  id?: string;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  isSuspended?: boolean;
  variant?: 'authenticated' | 'admin';
  sidebarRef?: RefObject<HTMLElement | null>;
  pathname?: string;
}

function BrandBadgeIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable={false}
    >
      <path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9L12 2.5Z" />
      <path d="M12 7v10" />
      <path d="m7.5 10.5 4.5-3.5 4.5 3.5" />
      <circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') {
    return pathname === '/';
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isRouteActive(pathname: string, item: SidebarNavItem): boolean {
  const prefixes = item.activePrefixes ?? [item.href];
  return prefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

export function Sidebar({
  id = 'app-sidebar',
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  isSuspended = false,
  variant = 'authenticated',
  sidebarRef,
  pathname: pathnameProp,
}: SidebarProps) {
  const activeHookPathname = useSafePathname();
  const pathname = pathnameProp ?? activeHookPathname;

  return (
    <>
      {isMobileOpen && (
        <div
          aria-hidden="true"
          data-testid="sidebar-backdrop"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] transition-opacity lg:hidden"
        />
      )}

      <aside
        id={id}
        ref={sidebarRef}
        aria-label="Primary sidebar"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r border-slate-200/80 bg-white text-slate-700 transition-[width,transform] duration-200 ease-standard dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
          'w-64 lg:z-30 lg:translate-x-0',
          isCollapsed ? 'lg:w-[72px]' : 'lg:w-64',
          isMobileOpen
            ? 'visible translate-x-0 shadow-xl'
            : 'invisible -translate-x-full lg:visible lg:shadow-none',
        )}
      >
        <div
          className={cn(
            'flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 px-5 dark:border-slate-800',
            isCollapsed && 'lg:justify-center lg:gap-1 lg:px-1.5',
          )}
        >
          <Link
            href="/"
            onClick={onCloseMobile}
            title={isCollapsed ? 'AI Career Mentor' : undefined}
            className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 cursor-pointer"
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-600 to-teal-500 text-white shadow-xs',
                isCollapsed && 'lg:h-7 lg:w-7',
              )}
            >
              <BrandBadgeIcon />
            </span>
            <span
              className={cn(
                'truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100',
                isCollapsed && 'lg:hidden',
              )}
            >
              AI Career Mentor
            </span>
            {variant === 'admin' && !isCollapsed && (
              <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:border-teal-800 dark:bg-teal-500/10 dark:text-teal-300">
                Admin
              </span>
            )}
          </Link>

          <button
            type="button"
            aria-label="Toggle sidebar"
            aria-expanded={!isCollapsed}
            aria-controls={id}
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:inline-flex cursor-pointer',
              isCollapsed && 'lg:h-7 lg:w-7',
            )}
          >
            <SidebarToggleIcon className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Close sidebar"
            onClick={onCloseMobile}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden cursor-pointer"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <nav
          aria-label="Primary"
          className="flex flex-1 flex-col gap-6 overflow-y-auto py-5"
        >
          {SIDEBAR_SECTIONS.map((section) => (
            <div key={section.title}>
              <p
                className={cn(
                  'mb-2 px-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500',
                  isCollapsed && 'lg:sr-only',
                )}
              >
                {section.title}
              </p>
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = isRouteActive(pathname, item);
                  const isCurrentPage = matchesPrefix(pathname, item.href);
                  const locked = isSuspended && Boolean(item.lockedWhenSuspended);

                  if (locked) {
                    return (
                      <li key={item.href}>
                        <span
                          aria-disabled="true"
                          title={isCollapsed ? `${item.label} (Locked)` : undefined}
                          className={cn(
                            'mx-2 flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 opacity-75 cursor-not-allowed dark:text-slate-600',
                            isCollapsed && 'lg:mx-0 lg:justify-center lg:px-2',
                          )}
                        >
                          <Icon className="block h-4 w-4 shrink-0" />
                          <span
                            className={cn(
                              'truncate',
                              isCollapsed && 'lg:sr-only',
                            )}
                          >
                            {item.label}
                          </span>
                          <LockIcon
                            className={cn(
                              'ml-auto block h-3.5 w-3.5 shrink-0',
                              isCollapsed && 'lg:hidden',
                            )}
                          />
                        </span>
                      </li>
                    );
                  }

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onCloseMobile}
                        aria-current={isCurrentPage ? 'page' : undefined}
                        title={isCollapsed ? item.label : undefined}
                        className={cn(
                          'flex min-h-11 items-center gap-3 py-2 text-sm transition-colors cursor-pointer',
                          active
                            ? 'border-r-2 border-teal-600 bg-teal-50 px-5 font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300'
                            : 'mx-2 rounded-lg px-3 text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-100',
                          isCollapsed && 'lg:mx-0 lg:justify-center lg:px-2',
                        )}
                      >
                        <Icon className="block h-4 w-4 shrink-0" />
                        <span
                          className={cn(
                            'truncate',
                            isCollapsed && 'lg:sr-only',
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div
          className={cn(
            'mt-auto shrink-0 border-t border-slate-200/80 px-4 py-3.5 dark:border-slate-800',
            isCollapsed && 'lg:px-2',
          )}
        >
          <p
            className={cn(
              'truncate text-xs text-slate-400 dark:text-slate-500',
              isCollapsed && 'lg:hidden',
            )}
          >
            &copy; 2026 AI Career Mentor
          </p>
          {isCollapsed && (
            <p
              aria-hidden="true"
              className="hidden text-center text-[11px] text-slate-400 dark:text-slate-500 lg:block"
            >
              &copy; 26
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
