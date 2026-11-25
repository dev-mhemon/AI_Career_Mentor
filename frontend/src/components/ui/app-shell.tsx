'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import {
  BottomNavigation,
  type BottomNavFeatureKey,
} from './bottom-navigation';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { useOptionalAppShellContext } from './app-shell-context';
import { logoutAction } from '@/lib/auth/actions';
import type { ShellUserInfo } from '@/lib/auth/user-display';
import { useSafePathname } from '@/lib/navigation/use-safe-pathname';
import { consumePendingTelemetryRotation } from '@/lib/telemetry/telemetry';

const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableDrawerElements(
  container: HTMLElement | null,
): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR),
  ).filter((el) => {
    if (
      el.hasAttribute('disabled') ||
      el.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.getComputedStyle === 'function'
    ) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
    }
    return true;
  });
}

export type AppShellProps = {
  children: ReactNode;
  variant?: 'authenticated' | 'learner' | 'admin';
  user?: ShellUserInfo | null;
  isSuspended?: boolean;
  accountStatus?: 'active' | 'suspended';
  offline?: boolean;
  todayReadyDot?: boolean;
  effectiveAccess?: Partial<Record<BottomNavFeatureKey, boolean>>;
  signOutAction?: () => Promise<void> | void;
};

/**
 * Authenticated workspace shell composing the collapsible light left sidebar,
 * sticky top header bar, quick search, user profile menu, mobile learner bottom nav,
 * and main content area.
 */
export function AppShell({
  children,
  variant,
  user,
  isSuspended,
  accountStatus,
  offline,
  todayReadyDot = false,
  effectiveAccess,
  signOutAction = logoutAction,
}: AppShellProps) {
  const ctx = useOptionalAppShellContext();
  const effectiveVariant = variant ?? ctx?.variant ?? 'authenticated';
  const chromeVariant: 'authenticated' | 'admin' =
    effectiveVariant === 'admin' ? 'admin' : 'authenticated';
  const effectiveUser = user !== undefined ? user : (ctx?.user ?? null);
  const effectiveSuspended =
    isSuspended ??
    (accountStatus !== undefined ? accountStatus === 'suspended' : undefined) ??
    ctx?.isSuspended ??
    false;

  const sidebarId = useId();
  const pathname = useSafePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (isMobileOpen) {
      setIsMobileOpen(false);
    }
  }

  const sidebarRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const wasMobileOpenRef = useRef(false);

  useEffect(() => {
    consumePendingTelemetryRotation();
  }, []);

  useEffect(() => {
    const wasOpen = wasMobileOpenRef.current;
    wasMobileOpenRef.current = isMobileOpen;

    if (!isMobileOpen) {
      if (wasOpen) {
        mobileTriggerRef.current?.focus();
      }
      return;
    }

    const initialFocusable = getFocusableDrawerElements(sidebarRef.current);
    initialFocusable[0]?.focus();

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      const inSidebar = sidebarRef.current?.contains(target);
      const inTrigger = mobileTriggerRef.current?.contains(target);
      if (!inSidebar && !inTrigger) {
        setIsMobileOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsMobileOpen(false);
        return;
      }

      if (event.key === 'Tab') {
        const items = getFocusableDrawerElements(sidebarRef.current);
        if (items.length === 0) {
          event.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (
            !active ||
            active === first ||
            !sidebarRef.current?.contains(active)
          ) {
            event.preventDefault();
            last.focus();
          }
        } else if (
          !active ||
          active === last ||
          !sidebarRef.current?.contains(active)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileOpen]);

  const handleToggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  const handleCloseMobile = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  const handleToggleMobile = useCallback(() => {
    setIsMobileOpen((prev) => !prev);
  }, []);

  const hideChrome = Boolean(ctx?.disabled);
  const showBottomNav =
    !hideChrome && chromeVariant !== 'admin' && !effectiveSuspended;

  return (
    <div
      className={
        hideChrome
          ? 'flex flex-1 flex-col'
          : 'flex min-h-screen flex-1 bg-surface-canvas text-text-primary'
      }
    >
      {!hideChrome && (
        <Sidebar
          id={sidebarId}
          isCollapsed={isCollapsed}
          onToggleCollapse={handleToggleCollapse}
          isMobileOpen={isMobileOpen}
          onCloseMobile={handleCloseMobile}
          isSuspended={effectiveSuspended}
          variant={chromeVariant}
          sidebarRef={sidebarRef}
          pathname={pathname}
        />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding-left] duration-200 ease-standard',
          !hideChrome && (isCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'),
        )}
      >
        {!hideChrome && (
          <Header
            variant={chromeVariant}
            user={effectiveUser}
            signOutAction={signOutAction}
            isSuspended={effectiveSuspended}
            offline={offline}
            onOpenMobileMenu={handleToggleMobile}
            isMobileMenuOpen={isMobileOpen}
            sidebarId={sidebarId}
            mobileTriggerRef={mobileTriggerRef}
          />
        )}

        <div
          className={cn(
            'flex flex-1 flex-col',
            showBottomNav && 'pb-24 md:pb-8',
          )}
        >
          {children}
        </div>
      </div>

      {showBottomNav && (
        <BottomNavigation
          pathname={pathname}
          todayReadyDot={todayReadyDot}
          effectiveAccess={effectiveAccess}
        />
      )}
    </div>
  );
}
