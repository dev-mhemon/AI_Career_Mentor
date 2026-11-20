import { redirect } from 'next/navigation';
import { getAppUserResult } from '@/lib/auth/user';
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

export const dynamic = 'force-dynamic';

/**
 * Dedicated standalone Profile page (`/profile`) under the authenticated `(app)` shell.
 * Reuses `ProfileSetupForm` in `mode="standalone"` (no onboarding stepper, saves in place).
 */
export default async function ProfilePage() {
  const userResult = await getAppUserResult();
  if (userResult.status === 'unauthenticated') {
    redirect('/login');
  }
  const user = userResult.data;
  if (user?.status === 'suspended') {
    redirect('/settings');
  }

  const [profileSnapshot, liveAuthUser] = await Promise.all([
    loadProfileForSetup(),
    readLiveAuthUser(),
  ]);

  if (profileSnapshot.unauthorized) {
    redirect('/login');
  }
  if (profileSnapshot.suspended) {
    redirect('/settings');
  }

  const meta = extractMetadataProfile(liveAuthUser?.user_metadata);
  const resolvedFullName = meta.fullName ?? profileSnapshot.fullName ?? '';
  const resolvedCurrentRole =
    profileSnapshot.profile?.current_role ?? meta.currentRole ?? null;
  const resolvedExperienceLevel =
    profileSnapshot.profile?.experience_level ?? meta.experienceLevel ?? null;
  const initialProfile = profileSnapshot.profile
    ? {
        ...profileSnapshot.profile,
        current_role: resolvedCurrentRole,
        experience_level: resolvedExperienceLevel,
      }
    : null;
  const contactChannels = resolveContactChannels({
    user: (user ?? {}) as ChannelConfirmationUser,
    liveAuthUser,
    profileContactEmail: meta.contactEmail ?? profileSnapshot.contactEmail,
    profileContactPhone: meta.contactPhone ?? profileSnapshot.contactPhone,
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
        variant={user?.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={{
          fullName: resolvedFullName || null,
          currentRole: resolvedCurrentRole,
          email: contactChannels.displayedEmail,
          phone: contactChannels.displayedPhone,
        }}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <header className="mb-6 flex flex-col gap-1">
          <h1 className="text-heading-xl font-semibold tracking-tight text-text-primary">
            Profile
          </h1>
          <p className="text-body-sm text-text-secondary">
            Manage your personal information, background, and experience level.
          </p>
        </header>

        <div className="rounded-xl border border-border-default bg-surface-raised p-6 shadow-xs sm:p-8">
          <ProfileSetupForm
            mode="standalone"
            initialProfile={initialProfile}
            initialContact={initialContact}
            initialFullName={resolvedFullName}
            loadError={profileSnapshot.loadError}
            userId={profileSnapshot.userId ?? user?.id}
          />
        </div>
      </main>
    </>
  );
}
