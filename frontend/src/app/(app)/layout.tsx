import { redirect } from 'next/navigation';
import { logoutAction } from '@/lib/auth/actions';
import { getFastSessionShellUser } from '@/lib/auth/shell-user';
import { AppShell } from '@/components/ui/app-shell';
import { AppShellProvider } from '@/components/ui/app-shell-context';

/**
 * Shared persistent layout for authenticated workspace routes:
 * `/dashboard`, `/onboarding/*`, and `/settings`.
 *
 * Uses only a fast local cookie session read so Sidebar and Top Header stay
 * persistently mounted and immediately interactive without blocking on slow
 * per-page profile/account fetches during route transitions.
 */
export default async function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fastSession = await getFastSessionShellUser();

  if (fastSession.unauthenticated) {
    redirect('/login');
  }

  return (
    <AppShellProvider
      initialVariant={fastSession.variant}
      initialUser={fastSession.user}
    >
      <AppShell signOutAction={logoutAction}>
        <div
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col outline-none"
        >
          {children}
        </div>
      </AppShell>
    </AppShellProvider>
  );
}
