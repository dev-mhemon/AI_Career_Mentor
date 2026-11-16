'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ShellUserInfo } from '@/lib/auth/user-display';
import { syncOAuthLoginHintFromDocumentCookie } from '@/lib/auth/remember-login';

export interface AppShellStateValue {
  variant: 'authenticated' | 'admin';
  user: ShellUserInfo | null;
  isSuspended: boolean;
  disabled: boolean;
}

interface AppShellContextValue extends AppShellStateValue {
  syncState: (next: Partial<AppShellStateValue>) => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export interface AppShellProviderProps {
  children: ReactNode;
  initialVariant?: 'authenticated' | 'admin';
  initialUser?: ShellUserInfo | null;
  initialIsSuspended?: boolean;
}

/**
 * Holds persistent authenticated shell metadata across client-side route
 * transitions inside `(app)` without remounting Sidebar or Header.
 */
export function AppShellProvider({
  children,
  initialVariant = 'authenticated',
  initialUser = null,
  initialIsSuspended = false,
}: AppShellProviderProps) {
  const [state, setState] = useState<AppShellStateValue>({
    variant: initialVariant,
    user: initialUser,
    isSuspended: initialIsSuspended,
    disabled: false,
  });

  useEffect(() => {
    syncOAuthLoginHintFromDocumentCookie();
  }, []);

  const syncState = useCallback((next: Partial<AppShellStateValue>) => {
    setState((prev) => {
      const variant = next.variant ?? prev.variant;
      const user = next.user !== undefined ? next.user : prev.user;
      const isSuspended =
        next.isSuspended !== undefined ? next.isSuspended : prev.isSuspended;
      const disabled =
        next.disabled !== undefined ? next.disabled : prev.disabled;

      const sameUser =
        prev.user === user ||
        (prev.user?.fullName === user?.fullName &&
          prev.user?.currentRole === user?.currentRole &&
          prev.user?.email === user?.email &&
          prev.user?.phone === user?.phone);

      if (
        prev.variant === variant &&
        prev.isSuspended === isSuspended &&
        prev.disabled === disabled &&
        sameUser
      ) {
        return prev;
      }

      return { variant, user, isSuspended, disabled };
    });
  }, []);

  const contextValue = useMemo<AppShellContextValue>(
    () => ({
      ...state,
      syncState,
    }),
    [state, syncState],
  );

  return (
    <AppShellContext.Provider value={contextValue}>
      {children}
    </AppShellContext.Provider>
  );
}

export function useOptionalAppShellContext() {
  return useContext(AppShellContext);
}

export interface AppShellSyncProps {
  variant?: 'authenticated' | 'admin';
  user?: ShellUserInfo | null;
  isSuspended?: boolean;
  disabled?: boolean;
}

/**
 * Client sync bridge rendered by Server Component pages inside `(app)`
 * to refine shell metadata or hide workspace chrome on recovery views.
 */
export function AppShellSync({
  variant,
  user,
  isSuspended = false,
  disabled = false,
}: AppShellSyncProps) {
  const ctx = useContext(AppShellContext);
  const syncState = ctx?.syncState;
  const hasUserProp = user !== undefined;
  const hasUserValue = user !== null && user !== undefined;
  const fullName = user?.fullName ?? null;
  const currentRole = user?.currentRole ?? null;
  const email = user?.email ?? null;
  const phone = user?.phone ?? null;

  useEffect(() => {
    if (!syncState) return;

    syncState({
      ...(variant ? { variant } : {}),
      ...(hasUserProp
        ? { user: hasUserValue ? { fullName, currentRole, email, phone } : null }
        : {}),
      isSuspended,
      disabled,
    });

    return () => {
      if (disabled) {
        syncState({ disabled: false });
      }
    };
  }, [
    syncState,
    variant,
    hasUserProp,
    hasUserValue,
    fullName,
    currentRole,
    email,
    phone,
    isSuspended,
    disabled,
  ]);

  return null;
}
