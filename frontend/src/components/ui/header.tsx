'use client';

import Link from 'next/link';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { cn } from './cn';
import { SkipLink } from './skip-link';
import {
  BellIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  GlobeIcon,
  InfoIcon,
  LogOutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
} from './icons';
import { logoutAction } from '@/lib/auth/actions';
import { rotateTelemetrySessionId } from '@/lib/telemetry/telemetry';
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
  /** Whether the visitor has an active session in `variant="public"` (defaults to `Boolean(user)`). */
  authenticated?: boolean;
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

const publicAuthenticatedNav: HeaderNavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Sign in' },
  { href: '/dashboard', label: 'Create account' },
];

interface QuickSearchRoute {
  href: string;
  label: string;
  keywords: string;
  restrictedWhenSuspended: boolean;
  labelLower: string;
  hrefLower: string;
}

const QUICK_SEARCH_ROUTES: readonly QuickSearchRoute[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    keywords: 'dashboard overview workspace',
    restrictedWhenSuspended: true,
    labelLower: 'dashboard',
    hrefLower: '/dashboard',
  },
  {
    href: '/today',
    label: 'Today',
    keywords: 'today learning study lesson topic',
    restrictedWhenSuspended: true,
    labelLower: 'today',
    hrefLower: '/today',
  },
  {
    href: '/daily-plan',
    label: 'Daily Plan',
    keywords: 'daily plan schedule sequence days rebuild',
    restrictedWhenSuspended: true,
    labelLower: 'daily plan',
    hrefLower: '/daily-plan',
  },
  {
    href: '/profile',
    label: 'Profile',
    keywords: 'profile name role experience education',
    restrictedWhenSuspended: true,
    labelLower: 'profile',
    hrefLower: '/profile',
  },
  {
    href: '/career-profile',
    label: 'Career Goals',
    keywords: 'career goals skills preferences roadmap track',
    restrictedWhenSuspended: true,
    labelLower: 'career goals',
    hrefLower: '/career-profile',
  },
  {
    href: '/settings',
    label: 'Account Settings',
    keywords: 'settings timezone hours contact delete account',
    restrictedWhenSuspended: false,
    labelLower: 'account settings',
    hrefLower: '/settings',
  },
];

const ADMIN_QUICK_SEARCH_ROUTES: readonly QuickSearchRoute[] = [
  {
    href: '/admin',
    label: 'Admin Dashboard',
    keywords: 'admin dashboard usage telemetry cost audit logs',
    restrictedWhenSuspended: true,
    labelLower: 'admin dashboard',
    hrefLower: '/admin',
  },
  {
    href: '/admin/users',
    label: 'Admin Users',
    keywords: 'admin users suspend reactivate search accounts',
    restrictedWhenSuspended: true,
    labelLower: 'admin users',
    hrefLower: '/admin/users',
  },
  {
    href: '/admin/features',
    label: 'Admin Feature Controls',
    keywords: 'admin features flags overrides technology update',
    restrictedWhenSuspended: true,
    labelLower: 'admin feature controls',
    hrefLower: '/admin/features',
  },
  {
    href: '/admin/audit-logs',
    label: 'Admin Audit Logs',
    keywords: 'admin audit logs history actions trail',
    restrictedWhenSuspended: true,
    labelLower: 'admin audit logs',
    hrefLower: '/admin/audit-logs',
  },
];

type ConnectivityBannerState = 'online' | 'offline' | 'reconnected';

const RECONNECTED_BANNER_DURATION_MS = 4000;

let connectivityState: ConnectivityBannerState = 'online';
let reconnectClearTimer: ReturnType<typeof setTimeout> | null = null;
const connectivityListeners = new Set<() => void>();
let windowConnectivityBound = false;

function notifyConnectivityListeners(): void {
  for (const listener of connectivityListeners) {
    listener();
  }
}

function clearReconnectTimer(): void {
  if (reconnectClearTimer !== null) {
    clearTimeout(reconnectClearTimer);
    reconnectClearTimer = null;
  }
}

function handleWindowOffline(): void {
  clearReconnectTimer();
  if (connectivityState !== 'offline') {
    connectivityState = 'offline';
    notifyConnectivityListeners();
  }
}

function handleWindowOnline(): void {
  clearReconnectTimer();
  if (connectivityState === 'offline') {
    connectivityState = 'reconnected';
    notifyConnectivityListeners();
    reconnectClearTimer = setTimeout(() => {
      reconnectClearTimer = null;
      if (connectivityState === 'reconnected') {
        connectivityState = 'online';
        notifyConnectivityListeners();
      }
    }, RECONNECTED_BANNER_DURATION_MS);
  } else if (connectivityState !== 'online') {
    connectivityState = 'online';
    notifyConnectivityListeners();
  }
}

function subscribeConnectivity(cb: () => void): () => void {
  if (typeof window !== 'undefined' && !windowConnectivityBound) {
    connectivityState = navigator.onLine ? 'online' : 'offline';
    window.addEventListener('online', handleWindowOnline);
    window.addEventListener('offline', handleWindowOffline);
    windowConnectivityBound = true;
  }
  connectivityListeners.add(cb);
  return () => {
    connectivityListeners.delete(cb);
    if (
      connectivityListeners.size === 0 &&
      typeof window !== 'undefined' &&
      windowConnectivityBound
    ) {
      window.removeEventListener('online', handleWindowOnline);
      window.removeEventListener('offline', handleWindowOffline);
      clearReconnectTimer();
      windowConnectivityBound = false;
      connectivityState = 'online';
    }
  };
}

const getConnectivitySnapshot = (): ConnectivityBannerState => {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'offline';
  }
  return connectivityState;
};

const getServerConnectivity = (): ConnectivityBannerState => 'online';

const OfflineBanner = memo(function OfflineBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-feedback-info-border bg-feedback-info-background px-4 py-2 text-body-sm text-feedback-info-text"
    >
      <InfoIcon className="shrink-0 text-feedback-info-icon" />
      <span>You are offline. Reconnect to continue learning.</span>
    </div>
  );
});

const ReconnectedBanner = memo(function ReconnectedBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-feedback-success-border bg-feedback-success-background px-4 py-2 text-body-sm text-feedback-success-text"
    >
      <CheckCircleIcon className="shrink-0 text-feedback-success-icon" />
      <span>Back online. Your connection has been restored.</span>
    </div>
  );
});

const PublicHeader = memo(function PublicHeader({
  items,
  actions,
  includeSkipLink,
  showOffline,
  showReconnected,
}: {
  items: HeaderNavItem[];
  actions?: React.ReactNode;
  includeSkipLink: boolean;
  showOffline: boolean;
  showReconnected: boolean;
}) {
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
              key={`${i.href}:${i.label}`}
              href={i.href}
              className="flex min-h-11 items-center rounded-md px-3 text-label-lg text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              {i.label}
            </Link>
          ))}
          {actions}
        </nav>
      </header>
      {showOffline && <OfflineBanner />}
      {showReconnected && <ReconnectedBanner />}
    </>
  );
});

const HeaderQuickSearch = memo(function HeaderQuickSearch({
  containerRef,
  inputRef,
  searchListboxId,
  searchQuery,
  isSearchOpen,
  filteredRoutes,
  onFocus,
  onChange,
  onResultClick,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  searchListboxId: string;
  searchQuery: string;
  isSearchOpen: boolean;
  filteredRoutes: readonly QuickSearchRoute[];
  onFocus: () => void;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onResultClick: () => void;
}) {
  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 sm:flex-initial">
      <div className="flex min-w-0 flex-1 max-w-[10.5rem] items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/80 px-4 py-1.5 text-sm transition-colors focus-within:border-teal-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-teal-500/20 dark:border-slate-700/70 dark:bg-slate-800/80 dark:focus-within:bg-slate-900 sm:max-w-none sm:w-60 md:w-72">
        <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Quick Search"
          aria-controls={isSearchOpen ? searchListboxId : undefined}
          placeholder="Quick Search..."
          value={searchQuery}
          onFocus={onFocus}
          onChange={onChange}
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
                    onClick={onResultClick}
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
  );
});

const HeaderNotifications = memo(function HeaderNotifications({
  containerRef,
  triggerRef,
  notificationsId,
  isOpen,
  onToggle,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  notificationsId: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Notifications"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={notificationsId}
        onClick={onToggle}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
      >
        <BellIcon className="h-4 w-4" />
      </button>

      {isOpen && (
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
  );
});

const HeaderUserMenu = memo(function HeaderUserMenu({
  containerRef,
  triggerRef,
  cardRef,
  userMenuId,
  isOpen,
  isAdmin,
  displayName,
  initials,
  roleLabel,
  isSuspended,
  signOutAction,
  onToggle,
  onTriggerKeyDown,
  onMenuKeyDown,
  onClose,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  userMenuId: string;
  isOpen: boolean;
  isAdmin: boolean;
  displayName: string;
  initials: string;
  roleLabel: string;
  isSuspended: boolean;
  signOutAction: () => Promise<void> | void;
  onToggle: () => void;
  onTriggerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onMenuKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
}) {
  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`User menu (${displayName})`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls={userMenuId}
        onClick={onToggle}
        onKeyDown={onTriggerKeyDown}
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
          {!isAdmin && (
            <span className="max-w-[150px] truncate text-xs leading-tight text-slate-500 dark:text-slate-400">
              {roleLabel}
            </span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && (
        <div
          ref={cardRef}
          id={userMenuId}
          role="menu"
          aria-label="User profile menu"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-slate-200/80 bg-white py-2 shadow-lg ring-1 ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {isAdmin ? 'Admin' : 'Welcome back 👋!'}
          </div>

          {!isAdmin && !isSuspended && (
            <Link
              href="/profile"
              role="menuitem"
              onClick={onClose}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80 dark:hover:text-white cursor-pointer"
            >
              <UserIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span>Profile</span>
            </Link>
          )}

          {!isAdmin && (
            <Link
              href="/settings"
              role="menuitem"
              onClick={onClose}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/80 dark:hover:text-white cursor-pointer"
            >
              <SettingsIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span>Account Settings</span>
            </Link>
          )}

          {!isAdmin && (
            <div
              role="separator"
              className="my-1.5 border-t border-slate-100 dark:border-slate-800"
            />
          )}

          <form action={signOutAction} className="px-1">
            <button
              type="submit"
              role="menuitem"
              onClick={() => rotateTelemetrySessionId()}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 cursor-pointer"
            >
              <LogOutIcon className="h-4 w-4 shrink-0" />
              <span>Sign Out</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
});

export const Header = memo(function Header({
  variant = 'authenticated',
  nav,
  user,
  authenticated,
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
  const browserConnectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getServerConnectivity,
  );
  const bannerState: ConnectivityBannerState =
    offline === true
      ? 'offline'
      : offline === false
        ? 'online'
        : browserConnectivity;
  const showOffline = bannerState === 'offline';
  const showReconnected = bannerState === 'reconnected';

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

  const hasUser = Boolean(user);
  const userFullName =
    typeof user?.fullName === 'string' ? user.fullName : null;
  const userCurrentRole =
    typeof user?.currentRole === 'string' ? user.currentRole : null;
  const userEmail = typeof user?.email === 'string' ? user.email : null;
  const userPhone = typeof user?.phone === 'string' ? user.phone : null;

  const { displayName, initials, roleLabel } = useMemo(
    () =>
      resolveShellUserDisplay(
        hasUser
          ? {
              fullName: userFullName,
              currentRole: userCurrentRole,
              email: userEmail,
              phone: userPhone,
            }
          : null,
      ),
    [hasUser, userFullName, userCurrentRole, userEmail, userPhone],
  );

  const isAdminVariant = variant === 'admin';
  const effectiveDisplayName = isAdminVariant ? 'Admin' : displayName;
  const effectiveInitials = isAdminVariant ? 'AD' : initials;
  const effectiveRoleLabel = isAdminVariant ? '' : roleLabel;

  const filteredRoutes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const routes =
      variant === 'admin' ? ADMIN_QUICK_SEARCH_ROUTES : QUICK_SEARCH_ROUTES;
    return routes.filter((item) => {
      if (isSuspended && item.restrictedWhenSuspended) return false;
      return (
        item.labelLower.includes(q) ||
        item.hrefLower.includes(q) ||
        item.keywords.includes(q)
      );
    });
  }, [searchQuery, isSuspended, variant]);

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

  const handleMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
    },
    [],
  );

  const handleSearchFocus = useCallback(() => {
    if (suppressSearchFocusOpenRef.current) return;
    setIsSearchActive(true);
  }, []);

  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setIsSearchActive(true);
  }, []);

  const handleSearchResultClick = useCallback(() => {
    setIsSearchActive(false);
    setSearchQuery('');
  }, []);

  const handleToggleNotifications = useCallback(() => {
    setIsUserMenuOpen(false);
    setIsNotificationsOpen((prev) => !prev);
  }, []);

  const handleToggleUserMenu = useCallback(() => {
    setIsNotificationsOpen(false);
    setIsUserMenuOpen((prev) => !prev);
  }, []);

  const handleCloseUserMenu = useCallback(() => {
    setIsUserMenuOpen(false);
  }, []);

  const handleUserTriggerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
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
    },
    [isUserMenuOpen],
  );

  if (variant === 'public') {
    const isAuthenticated = authenticated ?? hasUser;
    const items = nav ?? (isAuthenticated ? publicAuthenticatedNav : publicNav);
    return (
      <PublicHeader
        items={items}
        actions={actions}
        includeSkipLink={includeSkipLink}
        showOffline={showOffline}
        showReconnected={showReconnected}
      />
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

          <HeaderQuickSearch
            containerRef={searchContainerRef}
            inputRef={searchInputRef}
            searchListboxId={searchListboxId}
            searchQuery={searchQuery}
            isSearchOpen={isSearchOpen}
            filteredRoutes={filteredRoutes}
            onFocus={handleSearchFocus}
            onChange={handleSearchChange}
            onResultClick={handleSearchResultClick}
          />
        </div>

        {/* Right Utility & User Profile Area */}
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
          {!isAdminVariant && (
            <>
              <span
                aria-label="Language mode: Bangla and English"
                title="Bangla & English mixed-language support"
                className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 sm:inline-flex"
              >
                <GlobeIcon className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                <span>BN / EN</span>
              </span>

              <HeaderNotifications
                containerRef={notificationsContainerRef}
                triggerRef={notificationsTriggerRef}
                notificationsId={notificationsId}
                isOpen={isNotificationsOpen}
                onToggle={handleToggleNotifications}
              />

              <span
                aria-hidden="true"
                className="h-6 w-px bg-slate-200 dark:bg-slate-800"
              />
            </>
          )}

          {/* User Profile Trigger & Dropdown Menu */}
          <HeaderUserMenu
            containerRef={userMenuContainerRef}
            triggerRef={userTriggerRef}
            cardRef={userMenuCardRef}
            userMenuId={userMenuId}
            isOpen={isUserMenuOpen}
            isAdmin={isAdminVariant}
            displayName={effectiveDisplayName}
            initials={effectiveInitials}
            roleLabel={effectiveRoleLabel}
            isSuspended={isSuspended}
            signOutAction={signOutAction}
            onToggle={handleToggleUserMenu}
            onTriggerKeyDown={handleUserTriggerKeyDown}
            onMenuKeyDown={handleMenuKeyDown}
            onClose={handleCloseUserMenu}
          />
        </div>
      </header>

      {showOffline && <OfflineBanner />}
      {showReconnected && <ReconnectedBanner />}
    </>
  );
});
