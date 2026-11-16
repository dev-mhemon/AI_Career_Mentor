import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';
import { resolveWorkspaceProfile } from '@/lib/auth/workspace-profile';
import { EXPERIENCE_LEVEL_LABELS } from '@/lib/profile/metadata';
import { AddContactForm } from '@/components/settings/add-contact-form';
import { VerifiedContactPrompt } from '@/components/settings/verified-contact-prompt';
import { LearningSettingsForm } from '@/components/settings/learning-settings-form';
import { AccountDeletionCard } from '@/components/settings/account-deletion-card';
import { AppShellSync } from '@/components/ui/app-shell-context';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { CheckCircleIcon, MinusIcon } from '@/components/ui/icons';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active';

const FEATURE_ACCESS_LABELS: Record<string, string> = {
  roadmap_generator: 'Roadmap Generation',
  roadmap_generation: 'Roadmap Generation',
  daily_plan: 'Daily Plan',
  quiz_practice: 'Quiz Practice',
  ai_practice_review: 'AI Practice Review',
  progress_tracking: 'Progress Tracking',
  ai_mentor: 'AI Mentor',
  technology_update: 'Technology Updates',
};

/**
 * Formats a snake_case feature flag key into a readable pill label.
 */
function formatFeatureLabel(key: string): string {
  if (FEATURE_ACCESS_LABELS[key]) {
    return FEATURE_ACCESS_LABELS[key];
  }
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function StatusBadge({
  tone,
  children,
  showCheck = false,
}: {
  tone: 'success' | 'warning';
  children: React.ReactNode;
  showCheck?: boolean;
}) {
  const toneClass =
    tone === 'success'
      ? 'border-feedback-success-border bg-feedback-success-background text-feedback-success-text'
      : 'border-feedback-warning-border bg-feedback-warning-background text-feedback-warning-text';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-medium ${toneClass}`}
    >
      {showCheck && (
        <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-feedback-success-icon" />
      )}
      <span>{children}</span>
    </span>
  );
}

/**
 * Screen 22 (`/settings`) — Account & Settings page for active and suspended users.
 * Supports adding/verifying contacts (EP-A12), verified contact prompting (PRD §11),
 * learning preferences management (EP-P04), live Account Overview sync, and account deletion (EP-X01).
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
      <>
        <AppShellSync disabled />
        <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
          <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center">
            <div className="flex flex-col gap-5 rounded-xl border border-border-default bg-surface-raised p-6 shadow-md sm:p-8">
              <h1 className="text-heading-lg text-text-primary">
                Service Temporarily Unavailable
              </h1>
              <Alert variant="error_retryable" role="alert">
                We could not load your account and settings right now. Please try again in a moment.
              </Alert>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link href="/settings" className={primaryLinkClass}>
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

  const state = result.data;
  const { user, effective_access, can_delete_account } = state;
  const workspace = await resolveWorkspaceProfile(state);

  if (workspace.unauthorized) {
    redirect('/login');
  }

  const awaitedParams = await searchParams;
  const contactVerified = awaitedParams?.verified === 'contact';

  const {
    isSuspended,
    fullName,
    displayedEmail,
    showVerifiedEmailBadge,
    displayedPhone,
    showVerifiedPhoneBadge,
    currentRole: mergedCurrentRole,
    education: mergedEducation,
    experienceLevel: mergedExperienceLevel,
    isProfileComplete,
    mergedProfileForForm,
    profileLoadError,
  } = workspace;

  return (
    <>
      <AppShellSync
        variant={user.role === 'ADMIN' ? 'admin' : 'authenticated'}
        user={{
          fullName,
          currentRole: mergedCurrentRole,
          email: displayedEmail,
          phone: displayedPhone,
        }}
        isSuspended={isSuspended}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-xl text-text-primary">
            Account &amp; Settings
          </h1>
          <p className="text-body-sm text-text-secondary">
            Manage your account overview, contact verification, learning preferences, and security settings.
          </p>
        </div>

        {isSuspended && (
          <Alert
            variant="warning"
            role="alert"
            title="Your account is suspended"
            className="mt-6"
          >
            Learning features are currently disabled, but you can review your account details, sign out, or permanently delete your account.
          </Alert>
        )}

        {contactVerified && Boolean(user.verified_contact) && (
          <Alert variant="success" role="status" className="mt-6">
            Your contact method has been verified successfully.
          </Alert>
        )}

        <div className="mt-6 flex flex-col gap-6">
          <VerifiedContactPrompt
            verifiedContact={user.verified_contact}
            isSuspended={isSuspended}
          />

          {!isSuspended && (
            <AddContactForm
              isSuspended={isSuspended}
              alreadyVerified={user.verified_contact}
              verifiedEmail={showVerifiedEmailBadge ? displayedEmail : null}
              verifiedPhone={showVerifiedPhoneBadge ? displayedPhone : null}
            />
          )}

          <LearningSettingsForm
            initialProfile={mergedProfileForForm}
            loadError={profileLoadError}
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
              Account Overview
            </h2>

            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 text-body-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">Full Name</dt>
                <dd className="mt-1 text-label-lg text-text-primary">
                  {fullName ?? <span className="text-text-muted">Not set</span>}
                </dd>
              </div>

              <div>
                <dt className="text-text-muted">Profile Completeness</dt>
                <dd className="mt-1">
                  <StatusBadge
                    tone={isProfileComplete ? 'success' : 'warning'}
                    showCheck={isProfileComplete}
                  >
                    {isProfileComplete ? 'Complete' : 'Incomplete'}
                  </StatusBadge>
                </dd>
              </div>

              <div>
                <dt className="text-text-muted">Email</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2 text-label-lg text-text-primary">
                  <span className="break-all">
                    {displayedEmail ?? (
                      <span className="text-text-muted">Not set</span>
                    )}
                  </span>
                  {showVerifiedEmailBadge && (
                    <StatusBadge tone="success" showCheck={true}>
                      Verified
                    </StatusBadge>
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-text-muted">Phone</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2 text-label-lg text-text-primary">
                  <span className="tabular-nums">
                    {displayedPhone ?? (
                      <span className="text-text-muted">Not set</span>
                    )}
                  </span>
                  {showVerifiedPhoneBadge && (
                    <StatusBadge tone="success" showCheck={true}>
                      Verified
                    </StatusBadge>
                  )}
                </dd>
              </div>

              {mergedCurrentRole && (
                <div>
                  <dt className="text-text-muted">Current Role</dt>
                  <dd className="mt-1 text-label-lg text-text-primary">
                    {mergedCurrentRole}
                  </dd>
                </div>
              )}

              {mergedExperienceLevel && (
                <div>
                  <dt className="text-text-muted">Experience Level</dt>
                  <dd className="mt-1 text-label-lg text-text-primary">
                    {EXPERIENCE_LEVEL_LABELS[mergedExperienceLevel]}
                  </dd>
                </div>
              )}

              {mergedEducation && (
                <div>
                  <dt className="text-text-muted">Education</dt>
                  <dd className="mt-1 text-label-lg text-text-primary">
                    {mergedEducation}
                  </dd>
                </div>
              )}

              <div>
                <dt className="text-text-muted">Account Status</dt>
                <dd className="mt-1">
                  <StatusBadge
                    tone={isSuspended ? 'warning' : 'success'}
                    showCheck={!isSuspended}
                  >
                    {isSuspended ? 'Suspended' : 'Active'}
                  </StatusBadge>
                </dd>
              </div>

              <div>
                <dt className="text-text-muted">Deletion Eligibility</dt>
                <dd className="mt-1 text-label-lg text-text-primary">
                  {can_delete_account ? 'Eligible' : 'Unavailable'}
                </dd>
              </div>
            </dl>

            {Object.keys(effective_access).length > 0 && (
              <div className="mt-5 border-t border-border-subtle pt-4">
                <p className="text-caption font-medium text-text-muted">
                  Feature Access
                </p>
                <ul className="mt-2.5 flex flex-wrap gap-2 text-caption">
                  {Object.entries(effective_access).map(([key, enabled]) => {
                    const label = formatFeatureLabel(key);
                    return (
                      <li
                        key={key}
                        aria-label={`${label}: ${enabled ? 'Enabled' : 'Disabled'}`}
                        className={
                          enabled
                            ? 'inline-flex items-center gap-1.5 rounded-full border border-feedback-success-border bg-feedback-success-background px-3 py-1 font-medium text-feedback-success-text'
                            : 'inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-subtle px-3 py-1 font-medium text-text-muted'
                        }
                      >
                        {enabled ? (
                          <CheckCircleIcon className="h-3.5 w-3.5 shrink-0 text-feedback-success-icon" />
                        ) : (
                          <MinusIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        )}
                        <span>{label}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {!isSuspended && (
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
                <Link href="/onboarding/profile" className={secondaryLinkClass}>
                  Edit Profile
                </Link>
              </div>
            )}
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
    </>
  );
}
