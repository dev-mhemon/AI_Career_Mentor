import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { logoutAction } from '@/lib/auth/actions';
import { getAuthenticatedShellUser } from '@/lib/auth/shell-user';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { Alert } from '@/components/ui/alert';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon, ShieldIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';

const primaryLinkClass =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-action-primary-background px-5 text-label-lg font-medium leading-none text-action-primary-foreground transition-colors hover:bg-action-primary-background-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

/**
 * Fail-closed server route guard for `/admin/**` (Screens 23–25).
 * Authorizes strictly against server-verified `EP-A13 /auth/me` (`user.role === 'ADMIN'`
 * AND `user.status === 'active'`). Never trusts JWT `app_metadata.role` claims (`PRD §50`).
 */
export default async function AdminRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const result = await getAppSessionStateResult();

  if (result.status === 'unauthenticated') {
    redirect('/login');
  }

  if (result.status === 'transient_error') {
    return (
      <>
        <AppShellSync disabled />
        <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
          <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
            <div className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
              <h1 className="text-heading-lg text-text-primary">
                Admin Console Temporarily Unavailable
              </h1>
              <Alert variant="error_retryable" role="alert">
                We could not verify administrator privileges right now. Please
                try again in a moment.
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href="/admin" className={primaryLinkClass}>
                  Try Again
                </Link>
                <form action={logoutAction}>
                  <Button type="submit" variant="secondary" size="md">
                    Sign Out
                  </Button>
                </form>
              </div>
            </div>
          </main>
        </div>
      </>
    );
  }

  const { user } = result.data;
  const isSuspended = user.status !== 'active';
  const isVerifiedAdmin = user.role === 'ADMIN' && !isSuspended;

  if (!isVerifiedAdmin) {
    return (
      <>
        <AppShellSync variant="authenticated" isSuspended={isSuspended} />
        <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
          <main
            aria-labelledby="admin-denied-heading"
            className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center"
          >
            <div className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-feedback-danger-border bg-feedback-danger-background text-feedback-danger-icon">
                  <ShieldIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-caption font-semibold uppercase tracking-wider text-feedback-danger-text">
                    403 Access Denied
                  </p>
                  <h1
                    id="admin-denied-heading"
                    className="text-heading-md text-text-primary"
                  >
                    Administrator access required
                  </h1>
                </div>
              </div>
              <Alert variant="error_retryable" role="alert">
                {isSuspended
                  ? 'Suspended accounts cannot access the Admin Console. You can still manage account settings or request account deletion.'
                  : 'Your account does not have active platform administrator privileges. This area is restricted to server-verified administrators.'}
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href={isSuspended ? '/settings' : '/dashboard'}
                  className={primaryLinkClass}
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  <span>
                    {isSuspended ? 'Go to Account Settings' : 'Back to Dashboard'}
                  </span>
                </Link>
              </div>
            </div>
          </main>
        </div>
      </>
    );
  }

  const shellUser = await getAuthenticatedShellUser(user);

  return (
    <>
      <AppShellSync variant="admin" user={shellUser} isSuspended={false} />
      {children}
    </>
  );
}
