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
import { Header } from '@/components/ui/header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active';

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
      <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center outline-none"
        >
          <div className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
            <h1 className="text-heading-lg text-text-primary">
              সার্ভিস সাময়িকভাবে অনুপলব্ধ (Service Temporarily Unavailable)
            </h1>
            <Alert variant="error_retryable" role="alert">
              আমরা আপনার সেটিংস ও অ্যাকাউন্টের তথ্য লোড করতে পারছি না। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।
            </Alert>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link href="/settings" className={primaryLinkClass}>
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
    <div className="flex flex-1 flex-col bg-surface-canvas text-text-primary">
      <Header
        variant="authenticated"
        nav={
          isSuspended
            ? [
                { href: '/', label: 'Home' },
                { href: '/settings', label: 'Settings' },
              ]
            : undefined
        }
        actions={
          <form action={logoutAction}>
            <Button type="submit" variant="secondary" size="sm">
              Sign Out
            </Button>
          </form>
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl px-4 py-8 outline-none sm:py-12"
      >
        <h1 className="text-heading-xl text-text-primary">
          অ্যাকাউন্ট ও সেটিংস (Account &amp; Settings)
        </h1>

        {isSuspended && (
          <Alert
            variant="warning"
            role="alert"
            title="আপনার অ্যাকাউন্ট স্থগিত আছে (Your account is suspended)"
            className="mt-6"
          >
            সাধারণ ফিচারগুলো বর্তমানে নিষ্ক্রিয় রয়েছে, তবে আপনি আপনার অ্যাকাউন্টের তথ্য দেখতে এবং সাইন আউট করতে পারবেন। অ্যাকাউন্ট মুছে ফেলার অধিকার সক্রিয় আছে (Account deletion is active)।
          </Alert>
        )}

        {contactVerified && Boolean(user.verified_contact) && (
          <Alert variant="success" role="status" className="mt-6">
            আপনার যোগাযোগের তথ্য সফলভাবে যাচাই করা হয়েছে (Your contact method has been verified successfully).
          </Alert>
        )}

        <div className="mt-6 flex flex-col gap-6">
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
            className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs"
          >
            <h2
              id="account-overview-heading"
              className="text-heading-sm text-text-primary"
            >
              অ্যাকাউন্টের তথ্য (Account Overview)
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 text-body-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Email</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">
                  {user.email ?? 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Phone</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">
                  {user.phone ?? 'Not set'}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Account Status</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">{user.status}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Profile Completeness</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">
                  {profile_complete ? 'Complete' : 'Incomplete'}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Linked Providers</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">
                  {user.linked_providers.length > 0
                    ? user.linked_providers.join(', ')
                    : 'None'}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Verified Primary Contact</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">
                  {user.verified_contact ? 'Verified' : 'Unverified'}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Deletion Eligibility</dt>
                <dd className="mt-0.5 text-label-lg text-text-primary">
                  {can_delete_account ? 'Eligible' : 'Unavailable'}
                </dd>
              </div>
            </dl>

            {Object.keys(effective_access).length > 0 && (
              <div className="mt-4 border-t border-border-subtle pt-4">
                <p className="text-caption font-medium text-text-muted">
                  Effective Feature Access
                </p>
                <ul className="mt-2 flex flex-wrap gap-2 text-caption">
                  {Object.entries(effective_access).map(([key, enabled]) => (
                    <li
                      key={key}
                      className="rounded-full border border-border-default bg-surface-subtle px-2.5 py-0.5 text-text-secondary"
                    >
                      {key}: {enabled ? 'enabled' : 'disabled'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
              <form action={logoutAction}>
                <Button type="submit" variant="primary" size="md">
                  Sign Out
                </Button>
              </form>
              {!isSuspended && (
                <Link href="/onboarding/profile" className={secondaryLinkClass}>
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
