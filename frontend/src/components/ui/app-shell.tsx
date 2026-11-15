'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { useOptionalAppShellContext } from './app-shell-context';
import { logoutAction } from '@/lib/auth/actions';
import type { ShellUserInfo } from '@/lib/auth/user-display';
import { useSafePathname } from '@/lib/navigation/use-safe-pathname';

export interface AppShellProps {
  children: ReactNode;
  variant?: 'authenticated' | 'admin';
  user?: ShellUserInfo | null;
  isSuspended?: boolean;
  offline?: boolean;
  signOutAction?: () => Promise<void> | void;
}

/**
 * Authenticated workspace shell composing the collapsible light left sidebar,
 * sticky top header bar, quick search, user profile menu, and main content area.
 */
export function AppShell({
  children,
  variant,
  user,
  isSuspended,
  offline,
  signOutAction = logoutAction,
}: AppShellProps) {
  const ctx = useOptionalAppShellContext();
  const effectiveVariant = variant ?? ctx?.variant ?? 'authenticated';
  const effectiveUser = user !== undefined ? user : (ctx?.user ?? null);
  const effectiveSuspended = isSuspended ?? ctx?.isSuspended ?? false;

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

  useEffect(() => {
    if (!isMobileOpen) return;

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
        mobileTriggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileOpen]);

  const hideChrome = Boolean(ctx?.disabled);

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
          onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
          isMobileOpen={isMobileOpen}
          onCloseMobile={() => setIsMobileOpen(false)}
          isSuspended={effectiveSuspended}
          variant={effectiveVariant}
          sidebarRef={sidebarRef}
          pathname={pathname}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!hideChrome && (
          <Header
            variant={effectiveVariant}
            user={effectiveUser}
            signOutAction={signOutAction}
            isSuspended={effectiveSuspended}
            offline={offline}
            onOpenMobileMenu={() => setIsMobileOpen((prev) => !prev)}
            isMobileMenuOpen={isMobileOpen}
            sidebarId={sidebarId}
            mobileTriggerRef={mobileTriggerRef}
          />
        )}

        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
