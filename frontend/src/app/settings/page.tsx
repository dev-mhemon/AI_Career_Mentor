import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppSessionState } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';

/**
 * Screen 22 (`/settings`) — Account & Settings shell for active and suspended users.
 * Preserves `effective_access`, `profile_complete`, `focus_roadmap_id`, and `can_delete_account` metadata with working sign-out.
 */
export default async function SettingsPage() {
  const state = await getAppSessionState();

  if (!state) {
    redirect('/login');
  }

  const { user, profile_complete, effective_access, can_delete_account } = state;
  const isSuspended = user.status === 'suspended';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-foreground/10">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <span className="text-base font-semibold">AI Career Mentor</span>
          <div className="flex items-center gap-3">
            {!isSuspended && (
              <>
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-foreground/80 underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                >
                  ড্যাশবোর্ড (Dashboard)
                </Link>
                <Link
                  href="/onboarding/profile"
                  className="text-sm font-medium text-foreground/80 underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                >
                  প্রোফাইল সেটআপ (Profile Setup)
                </Link>
              </>
            )}
            <form action={logoutAction}>
              <button
                type="submit"
                className="h-9 rounded-md border border-foreground/20 px-3 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
          অ্যাকাউন্ট ও সেটিংস (Account &amp; Settings)
        </h1>

        {isSuspended && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4 text-sm text-amber-900 dark:text-amber-200"
          >
            <h2 className="font-semibold">
              আপনার অ্যাকাউন্ট স্থগিত আছে (Your account is suspended)
            </h2>
            <p className="mt-1">
              সাধারণ ফিচারগুলো বর্তমানে নিষ্ক্রিয় রয়েছে, তবে আপনি আপনার অ্যাকাউন্টের তথ্য দেখতে এবং সাইন আউট করতে পারবেন। অ্যাকাউন্ট মুছে ফেলার অধিকার বজায় আছে (Milestone M03-এ বাস্তবায়িত হবে)।
            </p>
          </div>
        )}

        <section
          aria-labelledby="account-overview-heading"
          className="mt-6 rounded-lg border border-foreground/15 bg-background p-5"
        >
          <h2
            id="account-overview-heading"
            className="text-base font-semibold text-foreground"
          >
            অ্যাকাউন্টের তথ্য (Account Overview)
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-foreground/60">Email</dt>
              <dd className="font-medium text-foreground">
                {user.email ?? 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-foreground/60">Phone</dt>
              <dd className="font-medium text-foreground">
                {user.phone ?? 'Not set'}
              </dd>
            </div>
            <div>
              <dt className="text-foreground/60">Account Status</dt>
              <dd className="font-medium text-foreground">{user.status}</dd>
            </div>
            <div>
              <dt className="text-foreground/60">Profile Completeness</dt>
              <dd className="font-medium text-foreground">
                {profile_complete ? 'Complete' : 'Incomplete'}
              </dd>
            </div>
            <div>
              <dt className="text-foreground/60">Linked Providers</dt>
              <dd className="font-medium text-foreground">
                {user.linked_providers.length > 0
                  ? user.linked_providers.join(', ')
                  : 'None'}
              </dd>
            </div>
            <div>
              <dt className="text-foreground/60">Deletion Eligibility</dt>
              <dd className="font-medium text-foreground">
                {can_delete_account
                  ? 'Eligible (Milestone M03)'
                  : 'Unavailable'}
              </dd>
            </div>
          </dl>

          {Object.keys(effective_access).length > 0 && (
            <div className="mt-4 border-t border-foreground/10 pt-4">
              <p className="text-xs font-medium text-foreground/60">
                Effective Feature Access
              </p>
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {Object.entries(effective_access).map(([key, enabled]) => (
                  <li
                    key={key}
                    className="rounded border border-foreground/15 px-2 py-1 text-foreground/80"
                  >
                    {key}: {enabled ? 'enabled' : 'disabled'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-4">
            <form action={logoutAction}>
              <button
                type="submit"
                className="h-11 rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                Sign Out
              </button>
            </form>
            {!isSuspended && (
              <Link
                href="/onboarding/profile"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-foreground/20 px-5 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                প্রোফাইল সম্পাদনা করুন (Edit Profile)
              </Link>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
