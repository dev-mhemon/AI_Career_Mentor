import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppUserResult } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';

/**
 * Dashboard route group layout — Server Component enforcing
 * business-level route guards.
 *
 * Route protection:
 *  - Unauthenticated -> /login
 *  - Transient backend error -> inline service unavailable recovery shell with retry and logout
 *  - Suspended -> suspension shell with `/settings` link and working sign-out
 *  - Active -> render children
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
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <div role="alert" className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-foreground">
            সার্ভিস সাময়িকভাবে অনুপলব্ধ (Service Temporarily Unavailable)
          </h1>
          <p className="text-sm text-foreground/70">
            আমরা আপনার অ্যাকাউন্টের তথ্য লোড করতে পারছি না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              আবার চেষ্টা করুন (Try again)
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="h-11 rounded-lg border border-foreground/20 px-6 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const user = result.data;

  if (user.status === 'suspended') {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          আপনার অ্যাকাউন্ট স্থগিত আছে
        </h1>
        <p className="mb-6 text-sm text-foreground/70">
          অ্যাকাউন্ট মুছে ফেলার অধিকার বজায় আছে। এই foundation-এ deletion screen এখনো বাস্তবায়িত
          হয়নি।
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/settings"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            অ্যাকাউন্ট ও সেটিংস (Account Settings)
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="h-11 rounded-lg border border-foreground/20 px-6 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              Sign Out
            </button>
          </form>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
