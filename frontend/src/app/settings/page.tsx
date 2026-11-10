import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';
import { loadProfileForSetup } from '@/lib/profile/actions';
import { IdentityLinkingCards } from '@/components/settings/identity-linking-cards';
import { AddContactForm } from '@/components/settings/add-contact-form';
import { VerifiedContactPrompt } from '@/components/settings/verified-contact-prompt';
import { LearningSettingsForm } from '@/components/settings/learning-settings-form';
import { AccountDeletionCard } from '@/components/settings/account-deletion-card';

/**
 * Screen 22 (`/settings`) — Account & Settings page for active and suspended users.
 * Supports identity linking (EP-A11), adding contacts (EP-A12), verified contact prompting (PRD §11),
 * and learning settings management (EP-P04).
 * Preserves effective_access, profile_complete, focus_roadmap_id, and can_delete_account metadata.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const result = await getAppSessionStateResult();

  if (result.status === 'unauthenticated') {
    let isDeleted = false;
    try {
      const cookieStore = await cookies();
      if (cookieStore?.get('account_deleted')?.value === 'true') {
        isDeleted = true;
        try {
          cookieStore.delete('account_deleted');
        } catch {
          // Best effort delete
        }
      }
    } catch {
      // In case cookies() cannot be read or is not mocked in tests
    }
    if (isDeleted) {
      redirect('/login?deleted=true');
    }
    redirect('/login');
  }

  if (result.status === 'transient_error') {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-12">
          <div role="alert" className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold text-foreground">
              সার্ভিস সাময়িকভাবে অনুপলব্ধ (Service Temporarily Unavailable)
            </h1>
            <p className="text-sm text-foreground/70">
              আমরা আপনার সেটিংস ও অ্যাকাউন্টের তথ্য লোড করতে পারছি না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/settings"
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
      </div>
    );
  }

  const state = result.data;
  const { user, profile_complete, effective_access, can_delete_account } = state;
  const isUserSuspended = user.status === 'suspended';

  const profileSnapshot = !isUserSuspended
    ? await loadProfileForSetup()
    : { profile: null };

  if (!isUserSuspended && profileSnapshot.unauthorized) {
    redirect('/login');
  }

  const isSuspended = isUserSuspended || Boolean(profileSnapshot.suspended);

  const awaitedParams = await searchParams;
  const rawLinked =
    typeof awaitedParams?.linked === 'string' ? awaitedParams.linked : undefined;
  const linkedProvider =
    (rawLinked === 'google' || rawLinked === 'facebook') &&
    user.linked_providers.includes(rawLinked)
      ? rawLinked
      : undefined;
  const linkError = awaitedParams?.error === 'link_failed';
  const contactVerified = awaitedParams?.verified === 'contact';

  const initialSuccess = linkedProvider
    ? `${linkedProvider === 'google' ? 'Google' : 'Facebook'} অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে (Social account linked successfully).`
    : undefined;
  const initialError = linkError
    ? 'সোশ্যাল অ্যাকাউন্ট যুক্ত করা সম্ভব হয়নি (Failed to link identity. Please try again).'
    : undefined;

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
              সাধারণ ফিচারগুলো বর্তমানে নিষ্ক্রিয় রয়েছে, তবে আপনি আপনার অ্যাকাউন্টের তথ্য দেখতে এবং সাইন আউট করতে পারবেন। অ্যাকাউন্ট মুছে ফেলার অধিকার সক্রিয় আছে (Account deletion is active)।
            </p>
          </div>
        )}

        {contactVerified && Boolean(user.verified_contact) && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200"
          >
            আপনার যোগাযোগের তথ্য সফলভাবে যাচাই করা হয়েছে (Your contact method has been verified successfully).
          </div>
        )}

        <div className="mt-6 flex flex-col gap-8">
          <VerifiedContactPrompt
            verifiedContact={user.verified_contact}
            isSuspended={isSuspended}
          />

          <IdentityLinkingCards
            linkedProviders={user.linked_providers}
            verifiedContact={user.verified_contact}
            isSuspended={isSuspended}
            initialSuccess={initialSuccess}
            initialError={initialError}
          />

          {!isSuspended && (
            <AddContactForm
              isSuspended={isSuspended}
              alreadyVerified={user.verified_contact}
            />
          )}

          <LearningSettingsForm
            initialProfile={profileSnapshot.profile}
            loadError={profileSnapshot.loadError}
            isSuspended={isSuspended}
          />

          <section
            aria-labelledby="account-overview-heading"
            className="rounded-lg border border-foreground/15 bg-background p-5"
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
                <dt className="text-foreground/60">Verified Primary Contact</dt>
                <dd className="font-medium text-foreground">
                  {user.verified_contact ? 'Verified' : 'Unverified'}
                </dd>
              </div>
              <div>
                <dt className="text-foreground/60">Deletion Eligibility</dt>
                <dd className="font-medium text-foreground">
                  {can_delete_account ? 'Eligible' : 'Unavailable'}
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

          <AccountDeletionCard
            canDeleteAccount={can_delete_account}
            isSuspended={isSuspended}
            hasPasswordAuth={
              Array.isArray(user.linked_providers) &&
              (user.linked_providers.includes('email') ||
                user.linked_providers.includes('phone'))
            }
            linkedProviders={user.linked_providers}
          />
        </div>
      </main>
    </div>
  );
}
