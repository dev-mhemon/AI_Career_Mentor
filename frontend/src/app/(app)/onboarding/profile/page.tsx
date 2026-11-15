import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAppUser } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';
import {
  readLiveAuthUser,
  resolveContactChannels,
  type ChannelConfirmationUser,
} from '@/lib/auth/workspace-profile';
import {
  loadProfileForSetup,
  type ProfileContactInfo,
} from '@/lib/profile/actions';
import { extractMetadataProfile } from '@/lib/profile/metadata';
import { ProfileSetupForm } from '@/components/onboarding/profile-setup-form';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active';

function SuspendedAccountShell() {
  return (
    <>
      <AppShellSync disabled />
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
              অ্যাকাউন্ট ও সেটিংস (Settings)
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
    </>
  );
}

/**
 * Screen 07 (`/onboarding/profile`) — Server Component for initial profile setup.
 * Consumes EP-P01 (`GET /api/v1/profile`), EP-P02 (`PATCH /api/v1/profile`), and EP-P04 (`PATCH /api/v1/profile/learning-settings`).
 */
export default async function OnboardingProfilePage() {
  const user = await getAppUser();

  if (!user) {
    redirect('/login');
    return null;
  }

  if (user.status === 'suspended') {
    return <SuspendedAccountShell />;
  }

  const {
    profile,
    loadError,
    unauthorized,
    suspended,
    userId,
    fullName,
    contactEmail,
    contactPhone,
  } = await loadProfileForSetup();

  if (unauthorized) {
    redirect('/login');
  }

  if (suspended) {
    return <SuspendedAccountShell />;
  }

  const liveAuthUser = await readLiveAuthUser();
  const meta = extractMetadataProfile(liveAuthUser?.user_metadata);
  const resolvedFullName = meta.fullName ?? fullName ?? null;
  const contactChannels = resolveContactChannels({
    user: user as ChannelConfirmationUser,
    liveAuthUser,
    profileContactEmail: meta.contactEmail ?? contactEmail,
    profileContactPhone: meta.contactPhone ?? contactPhone,
  });

  const initialContact: ProfileContactInfo = {
    email: contactChannels.displayedEmail ?? '',
    emailVerified: contactChannels.emailVerified,
    phone: contactChannels.rawDisplayedPhone ?? '',
    phoneVerified: contactChannels.phoneVerified,
  };

  return (
    <>
      <AppShellSync
        variant={user.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={{
          fullName: resolvedFullName,
          currentRole: profile?.current_role ?? null,
          email: contactChannels.displayedEmail,
          phone: contactChannels.displayedPhone,
        }}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="mb-6">
          <h1 className="text-heading-xl text-text-primary">
            Complete Your Profile
          </h1>
          <p className="mt-2 text-body-sm text-text-secondary">
            Tell us who you are, your current experience level, and your daily study schedule. Fields marked with <span aria-hidden="true" className="font-medium text-text-danger">*</span><span className="sr-only">an asterisk</span> are required.
          </p>
        </div>

        <div className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
          <ProfileSetupForm
            initialProfile={profile}
            initialContact={initialContact}
            initialFullName={resolvedFullName ?? ''}
            loadError={loadError}
            userId={userId ?? user.id}
          />
        </div>
      </main>
    </>
  );
}
