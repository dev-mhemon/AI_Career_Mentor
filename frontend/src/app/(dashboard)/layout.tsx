import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppUserResult } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';
import { Header } from '@/components/ui/header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active';

/**
 * Dashboard route group layout — Server Component enforcing
 * business-level route guards.
 *
 * Route protection:
 *  - Unauthenticated -> /login
 *  - Transient backend error -> inline service unavailable recovery shell with retry and logout
 *  - Suspended -> suspension shell with `/settings` link and working sign-out
 *  - Active -> render app header and children
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getAppUserResult();

  if (result.status === 'unauthenticated') {
    redirect('/login');
  }

  if (result.status === 'transient_error') {
    return (
      <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
          <div className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
            <h1 className="text-heading-lg text-text-primary">
              সার্ভিস সাময়িকভাবে অনুপলব্ধ (Service Temporarily Unavailable)
            </h1>
            <Alert variant="error_retryable" role="alert">
              আমরা আপনার অ্যাকাউন্টের তথ্য লোড করতে পারছি না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
            </Alert>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link href="/dashboard" className={primaryLinkClass}>
                আবার চেষ্টা করুন (Try again)
              </Link>
              <Link href="/" className={secondaryLinkClass}>
                Back to Home
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
    );
  }

  const user = result.data;

  if (user.status === 'suspended') {
    return (
      <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
          <div className="flex flex-col gap-5 rounded-xl border border-feedback-warning-border bg-surface-raised p-6 shadow-md sm:p-8">
            <h1 className="text-heading-lg text-text-primary">
              আপনার অ্যাকাউন্ট স্থগিত আছে
            </h1>
            <p className="text-body-sm text-text-secondary">
              অ্যাকাউন্ট মুছে ফেলার অধিকার বজায় আছে। আপনি সেটিংস পেজে (Danger Zone) গিয়ে অ্যাকাউন্ট স্থায়ীভাবে মুছে ফেলতে পারেন।
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/settings" className={primaryLinkClass}>
                অ্যাকাউন্ট ও সেটিংস (Account Settings)
              </Link>
              <Link href="/" className={secondaryLinkClass}>
                Back to Home
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
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-surface-canvas text-text-primary">
      <Header
        variant="authenticated"
        actions={
          <form action={logoutAction}>
            <Button type="submit" variant="secondary" size="sm">
              Sign Out
            </Button>
          </form>
        }
      />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
