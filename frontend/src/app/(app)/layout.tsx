import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logoutAction } from '@/lib/auth/actions';
import { requireFastSessionShell } from '@/lib/auth/shell-user';
import { AdminWorkspaceGuard } from '@/components/admin/admin-workspace-guard';
import { AppShell } from '@/components/ui/app-shell';
import { AppShellProvider } from '@/components/ui/app-shell-context';

/**
 * Shared persistent layout for authenticated workspace routes.
 *
 * Enforces strict Admin workspace isolation: server-verified `ADMIN` sessions
 * visiting any non-`/admin` learner route redirect immediately to `/admin`.
 */
export default async function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const fastSession = await requireFastSessionShell();

  if (fastSession.isAdmin) {
    let requestPathname: string | null = null;
    try {
      const headerStore = await headers();
      requestPathname = headerStore.get('x-pathname');
    } catch {
      requestPathname = null;
    }
    if (
      requestPathname &&
      requestPathname !== '/admin' &&
      !requestPathname.startsWith('/admin/')
    ) {
      redirect('/admin');
    }
  }

  return (
    <AppShellProvider
      initialVariant={fastSession.variant}
      initialUser={fastSession.user}
    >
      <AdminWorkspaceGuard isAdmin={fastSession.isAdmin} />
      <AppShell signOutAction={logoutAction}>
        <div
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col outline-none focus:outline-none focus-visible:outline-none"
        >
          {children}
        </div>
      </AppShell>
    </AppShellProvider>
  );
}
