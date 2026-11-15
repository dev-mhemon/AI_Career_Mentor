'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { cn } from './cn';
import { SkipLink } from './skip-link';
import {
  BellIcon,
  ChevronDownIcon,
  InfoIcon,
  LogOutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from './icons';
import { logoutAction } from '@/lib/auth/actions';
import {
  resolveShellUserDisplay,
  type ShellUserInfo,
} from '@/lib/auth/user-display';
import { useSafePathname } from '@/lib/navigation/use-safe-pathname';

export type HeaderVariant = 'public' | 'authenticated' | 'admin';

export interface HeaderNavItem {
  href: string;
  label: string;
}

export interface HeaderProps {
  variant?: HeaderVariant;
  nav?: HeaderNavItem[];
  /** Optional authenticated user summary for avatar, full name, and current role. */
  user?: ShellUserInfo | null;
  /** Server Action invoked by the Sign Out menu item. */
  signOutAction?: () => Promise<void> | void;
  /** Whether the user account is suspended. */
  isSuspended?: boolean;
  /** Right-side slot (kept for public variant compatibility). */
  actions?: React.ReactNode;
  /** Force offline_banner state; defaults to browser connectivity. */
  offline?: boolean;
  /** Render a SkipLink inside the header (layout already has one; off by default). */
  includeSkipLink?: boolean;
  /** Mobile sidebar drawer trigger callback. */
  onOpenMobileMenu?: () => void;
  /** Mobile sidebar drawer open state for ARIA synchronization. */
  isMobileMenuOpen?: boolean;
  /** Target sidebar id for aria-controls. */
  sidebarId?: string;
  /** Ref forwarded to the mobile drawer trigger button for focus restoration. */
  mobileTriggerRef?: RefObject<HTMLButtonElement | null>;
}

const publicNav: HeaderNavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/login', label: 'Sign in' },
  { href: '/register', label: 'Create account' },
];

const QUICK_SEARCH_ROUTES = [
  { href: '/dashboard', label: 'Dashboard', keywords: 'dashboard overview workspace', restrictedWhenSuspended: true },
  { href: '/onboarding/profile', label: 'Profile Setup', keywords: 'profile onboarding skills experience role', restrictedWhenSuspended: true },
  { href: '/settings', label: 'Account Settings', keywords: 'settings timezone hours contact delete account', restrictedWhenSuspended: false },
];

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

const isOffline = () => !navigator.onLine;

export function Header({
  variant = 'authenticated',
  nav,
  user,
  signOutAction = logoutAction,
  isSuspended = false,
  actions,
  offline,
  includeSkipLink = false,
  onOpenMobileMenu,
  isMobileMenuOpen = false,
  sidebarId = 'app-sidebar',
  mobileTriggerRef,
}: HeaderProps) {
  const pathname = useSafePathname();
  const browserOffline = useSyncExternalStore(subscribe, isOffline, () => false);
  const showOffline = offline ?? browserOffline;

  const userMenuId = useId();
  const notificationsId = useId();
  const searchListboxId = useId();

  const [prevPathname, setPrevPathname] = useState(pathname);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (isUserMenuOpen) {
      setIsUserMenuOpen(false);
    }
    if (isNotificationsOpen) {
      setIsNotificationsOpen(false);
    }
    if (isSearchActive) {
      setIsSearchActive(false);
    }
  }

  const isSearchOpen = isSearchActive && searchQuery.trim().length > 0;

  const userMenuContainerRef = useRef<HTMLDivElement>(null);
  const userTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuCardRef = useRef<HTMLDivElement>(null);
  const notificationsContainerRef = useRef<HTMLDivElement>(null);
  const notificationsTriggerRef = useRef<HTMLButtonElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suppressSearchFocusOpenRef = useRef(false);

  const { displayName, initials, roleLabel } = useMemo(
    () => resolveShellUserDisplay(user),
    [user],
  );

  const filteredRoutes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return QUICK_SEARCH_ROUTES.filter((item) => {
      if (isSuspended && item.restrictedWhenSuspended) return false;
      return (
        item.label.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q) ||
        item.keywords.includes(q)
      );
    });
  }, [searchQuery, isSuspended]);

  useEffect(() => {
    if (!isUserMenuOpen && !isNotificationsOpen && !isSearchOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      if (
        isUserMenuOpen &&
        userMenuContainerRef.current &&
        !userMenuContainerRef.current.contains(target)
      ) {
        setIsUserMenuOpen(false);
      }
      if (
        isNotificationsOpen &&
        notificationsContainerRef.current &&
        !notificationsContainerRef.current.contains(target)
      ) {
        setIsNotificationsOpen(false);
      }
      if (
        isSearchOpen &&
        searchContainerRef.current &&
        !searchContainerRef.current.contains(target)
      ) {
        setIsSearchActive(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      if (isUserMenuOpen) {
        event.preventDefault();
        setIsUserMenuOpen(false);
        userTriggerRef.current?.focus();
        return;
      }
      if (isNotificationsOpen) {
        event.preventDefault();
        setIsNotificationsOpen(false);
        notificationsTriggerRef.current?.focus();
        return;
      }
      if (isSearchOpen) {
        event.preventDefault();
        setIsSearchActive(false);
        suppressSearchFocusOpenRef.current = true;
        try {
          searchInputRef.current?.focus();
        } finally {
          suppressSearchFocusOpenRef.current = false;
        }
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen, isNotificationsOpen, isSearchOpen]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const firstItem =
      userMenuCardRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [isUserMenuOpen]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(
      userMenuCardRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;

    event.preventDefault();
    const activeIdx = items.indexOf(document.activeElement as HTMLElement);
    const nextIdx =
      event.key === 'ArrowDown'
        ? activeIdx === -1
          ? 0
          : (activeIdx + 1) % items.length
        : activeIdx <= 0
          ? items.length - 1
          : activeIdx - 1;
    items[nextIdx]?.focus();
  }

  if (variant === 'public') {
    const items = nav ?? publicNav;
    return (
      <>
        {includeSkipLink && <SkipLink />}
        <header
          className="sticky top-0 z-30 flex h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-200/80 bg-white/95 px-4 text-slate-900 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-100 lg:px-8"
        >
          <Link
            href="/"
            className="flex min-h-11 items-center text-heading-sm font-semibold transition-colors hover:text-teal-700 dark:hover:text-teal-300"
          >
            AI Career Mentor
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-1">
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className="flex min-h-11 items-center rounded-md px-3 text-label-lg text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
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

  return (
    <>
      {includeSkipLink && <SkipLink />}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 lg:px-8">
        {/* Left Area: Mobile drawer trigger + Quick Search pill */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:flex-initial sm:gap-3">
          {onOpenMobileMenu && (
            <button
              ref={mobileTriggerRef}
              type="button"
              aria-label="Open sidebar"
              aria-expanded={isMobileMenuOpen}
              aria-controls={sidebarId}
              onClick={onOpenMobileMenu}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden cursor-pointer"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          )}

          <div
            ref={searchContainerRef}
            className="relative flex min-w-0 flex-1 sm:flex-initial"
          >
            <div className="flex min-w-0 flex-1 max-w-[10.5rem] items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/80 px-4 py-1.5 text-sm transition-colors focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700/70 dark:bg-slate-800/80 dark:focus-within:bg-slate-900 sm:max-w-none sm:w-60 md:w-72">
              <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={searchInputRef}
                type="search"
                aria-label="Quick Search"
                aria-controls={isSearchOpen ? searchListboxId : undefined}
                placeholder="Quick Search..."
                value={searchQuery}
                onFocus={() => {
                  if (suppressSearchFocusOpenRef.current) return;
                  setIsSearchActive(true);
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchActive(true);
                }}
                className="w-full bg-transparent text-sm text-slate-800 placeholder:font-light placeholder:text-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            {isSearchOpen && (
              <div
                id={searchListboxId}
                role="region"
                aria-label="Quick search results"
                className="absolute left-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-200/80 bg-white py-2 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900"
              >
                {filteredRoutes.length > 0 ? (
                  <ul className="flex flex-col">
                    {filteredRoutes.map((route) => (
                      <li key={route.href}>
                        <Link
                          href={route.href}
                          onClick={() => {
                            setIsSearchActive(false);
                            setSearchQuery('');
                          }}
                          className="flex items-center justify-between px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-teal-50 hover:text-teal-700 dark:text-slate-200 dark:hover:bg-teal-500/10 dark:hover:text-teal-300 cursor-pointer"
                        >
                          <span className="font-medium">{route.label}</span>
                          <span className="text-xs text-slate-400">{route.href}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                    No matching workspace pages.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Utility & User Profile Area */}
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
          <div ref={notificationsContainerRef} className="relative">
            <button
              ref={notificationsTriggerRef}
              type="button"
              aria-label="Notifications"
              aria-expanded={isNotificationsOpen}
              aria-haspopup="dialog"
              aria-controls={notificationsId}
              onClick={() => {
                setIsUserMenuOpen(false);
                setIsNotificationsOpen((prev) => !prev);
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
            >
              <BellIcon className="h-4 w-4" />
            </button>

            {isNotificationsOpen && (
              <div
                id={notificationsId}
                role="dialog"
                aria-label="Notifications"
                className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200/80 bg-white p-4 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900"
              >
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Notifications
                </p>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  You are all caught up. No new notifications.
                </p>
              </div>
            )}
          </div>

          <span
            aria-hidden="true"
            className="h-6 w-px bg-slate-200 dark:bg-slate-800"
          />

          {/* User Profile Trigger & Dropdown Menu */}
          <div ref={userMenuContainerRef} className="relative">
            <button
              ref={userTriggerRef}
              type="button"
              aria-label={`User menu (${displayName})`}
              aria-expanded={isUserMenuOpen}
              aria-haspopup="menu"
              aria-controls={userMenuId}
              onClick={() => {
                setIsNotificationsOpen(false);
                setIsUserMenuOpen((prev) => !prev);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setIsNotificationsOpen(false);
                  if (isUserMenuOpen) {
                    userMenuCardRef.current
                      ?.querySelector<HTMLElement>('[role="menuitem"]')
                      ?.focus();
                  } else {
                    setIsUserMenuOpen(true);
                  }
                }
              }}
              className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/80 cursor-pointer"
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-teal-600/20 bg-teal-600/10 text-xs font-semibold text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300"
              >
                {initials}
              </span>
              <span className="hidden sm:flex sm:flex-col sm:items-start sm:text-left">
                <span className="max-w-[150px] truncate text-sm font-semibold leading-tight text-slate-800 dark:text-slate-100">
                  {displayName}
                </span>
                <span className="max-w-[150px] truncate text-xs leading-tight text-slate-500 dark:text-slate-400">
                  {roleLabel}
                </span>
              </span>
              <ChevronDownIcon
                className={cn(
                  'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
                  isUserMenuOpen && 'rotate-180',
                )}
              />
            </button>

            {isUserMenuOpen && (
              <div
                ref={userMenuCardRef}
                id={userMenuId}
                role="menu"
                aria-label="User profile menu"
                onKeyDown={handleMenuKeyDown}
                className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200/80 bg-white py-2 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Welcome back 👋!
                </div>

                {!isSuspended && (
                  <Link
                    href="/onboarding/profile"
                    role="menuitem"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80 dark:hover:text-white cursor-pointer"
                  >
                    <UserIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>Profile</span>
                  </Link>
                )}

                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setIsUserMenuOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80 dark:hover:text-white cursor-pointer"
                >
                  <SettingsIcon className="h-4 w-4 shrink-0 text-slate-400" />
                  <span>Account Settings</span>
                </Link>

                <div
                  role="separator"
                  className="my-1.5 border-t border-slate-100 dark:border-slate-800"
                />

                <form action={signOutAction} className="px-1">
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 cursor-pointer"
                  >
                    <LogOutIcon className="h-4 w-4 shrink-0" />
                    <span>Sign Out</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
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
