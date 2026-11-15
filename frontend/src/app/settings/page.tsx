import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { logoutAction } from '@/lib/auth/actions';
import { loadProfileForSetup } from '@/lib/profile/actions';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ExperienceLevel, ProfileResponse } from '@/lib/api/client';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation/auth-schemas';
import {
  isNonSyntheticEmail,
  isValidExperienceLevel,
  isValidIanaTimezone,
  normalizeFullName,
  parseValidDailyHours,
} from '@/lib/validation/profile-schemas';
import { AddContactForm } from '@/components/settings/add-contact-form';
import { VerifiedContactPrompt } from '@/components/settings/verified-contact-prompt';
import { LearningSettingsForm } from '@/components/settings/learning-settings-form';
import { AccountDeletionCard } from '@/components/settings/account-deletion-card';
import { Header } from '@/components/ui/header';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { CheckCircleIcon, MinusIcon } from '@/components/ui/icons';

const primaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md bg-action-primary-background px-5 text-label-lg font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active';

const secondaryLinkClass =
  'inline-flex h-10 min-h-11 items-center justify-center rounded-md border border-action-secondary-border bg-action-secondary-background px-5 text-label-lg font-medium text-action-secondary-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-action-secondary-border-hover hover:bg-action-secondary-background-hover active:bg-action-secondary-background-active';

const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Beginner',
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

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

interface ExtractedUserMetadata {
  fullName?: string;
  contactEmail?: string;
  contactPhone?: string;
  currentRole?: string;
  education?: string;
  experienceLevel?: ExperienceLevel;
  preferredDailyHours?: number;
  timezone?: string;
}

/**
 * Extracts and validates known profile and contact fields from Supabase `user_metadata`.
 */
function extractMetadataProfile(meta: unknown): ExtractedUserMetadata {
  if (!meta || typeof meta !== 'object') {
    return {};
  }
  const record = meta as Record<string, unknown>;

  const rawName =
    typeof record.full_name === 'string' && record.full_name.trim()
      ? normalizeFullName(record.full_name)
      : typeof record.name === 'string' && record.name.trim()
        ? normalizeFullName(record.name)
        : undefined;

  const contactEmail =
    typeof record.contact_email === 'string' &&
    isNonSyntheticEmail(record.contact_email)
      ? normalizeEmail(record.contact_email)
      : undefined;

  const contactPhone =
    typeof record.contact_phone === 'string' && record.contact_phone.trim()
      ? (normalizeBdPhone(record.contact_phone) ?? record.contact_phone.trim())
      : undefined;

  const currentRole =
    typeof record.current_role === 'string' && record.current_role.trim()
      ? record.current_role.trim()
      : undefined;

  const rawEducation =
    typeof record.education === 'string' && record.education.trim()
      ? record.education.trim()
      : typeof record.education_level === 'string' && record.education_level.trim()
        ? record.education_level.trim()
        : undefined;

  const rawExperience =
    typeof record.experience_level === 'string'
      ? record.experience_level.trim()
      : '';
  const experienceLevel = isValidExperienceLevel(rawExperience)
    ? rawExperience
    : undefined;

  const parsedHours =
    typeof record.preferred_daily_hours === 'number'
      ? parseValidDailyHours(String(record.preferred_daily_hours))
      : typeof record.preferred_daily_hours === 'string'
        ? parseValidDailyHours(record.preferred_daily_hours)
        : null;

  const timezone =
    typeof record.timezone === 'string' && isValidIanaTimezone(record.timezone)
      ? record.timezone.trim()
      : undefined;

  return {
    ...(rawName ? { fullName: rawName } : {}),
    ...(contactEmail ? { contactEmail } : {}),
    ...(contactPhone ? { contactPhone } : {}),
    ...(currentRole ? { currentRole } : {}),
    ...(rawEducation ? { education: rawEducation } : {}),
    ...(experienceLevel ? { experienceLevel } : {}),
    ...(parsedHours !== null ? { preferredDailyHours: parsedHours } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

interface ChannelConfirmationUser {
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  email_verified?: boolean | null;
  phone_verified?: boolean | null;
}

/**
 * Normalizes a Bangladesh/E.164 phone number so stored and auth values compare consistently.
 */
function normalizeComparablePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return normalizeBdPhone(trimmed) ?? trimmed;
}

/**
 * Resolves the normalized email address explicitly confirmed for this account, or empty string.
 */
function resolveConfirmedEmail(
  user: ChannelConfirmationUser,
  liveAuthUser: ChannelConfirmationUser | null,
): string {
  if (liveAuthUser) {
    return liveAuthUser.email_confirmed_at &&
      isNonSyntheticEmail(liveAuthUser.email)
      ? normalizeEmail(liveAuthUser.email)
      : '';
  }
  const userEmail = isNonSyntheticEmail(user.email)
    ? normalizeEmail(user.email)
    : '';
  if (
    userEmail &&
    (user.email_verified === true || Boolean(user.email_confirmed_at))
  ) {
    return userEmail;
  }
  return '';
}

/**
 * Resolves the normalized phone number explicitly confirmed for this account, or empty string.
 */
function resolveConfirmedPhone(
  user: ChannelConfirmationUser,
  liveAuthUser: ChannelConfirmationUser | null,
): string {
  if (liveAuthUser) {
    const livePhone = normalizeComparablePhone(liveAuthUser.phone);
    return liveAuthUser.phone_confirmed_at && livePhone ? livePhone : '';
  }
  const userPhone = normalizeComparablePhone(user.phone);
  if (
    userPhone &&
    (user.phone_verified === true || Boolean(user.phone_confirmed_at))
  ) {
    return userPhone;
  }
  return '';
}

/**
 * Formats a canonical `+8801XXXXXXXXX` phone number as `+880 1XXX-XXXXXX` for clean display.
 */
function formatPhoneDisplay(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized) {
    const match = /^\+880(1[3-9]\d{2})(\d{6})$/.exec(normalized);
    if (match) {
      return `+880 ${match[1]}-${match[2]}`;
    }
    return normalized;
  }
  return raw.trim();
}

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
      <div className="flex flex-1 flex-col bg-surface-canvas px-4 py-12 text-text-primary">
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center outline-none"
        >
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

  let liveAuthUser: {
    email?: string | null;
    phone?: string | null;
    email_confirmed_at?: string | null;
    phone_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
  } | null = null;

  try {
    const supabase = await createSupabaseServerClient({ readOnly: true });
    if (typeof supabase.auth.getUser === 'function') {
      try {
        const userResult = await supabase.auth.getUser();
        if (userResult?.data?.user) {
          liveAuthUser = userResult.data.user;
        }
      } catch {
        // Fall back to session user only if live lookup fails
      }
    }
    if (!liveAuthUser && typeof supabase.auth.getSession === 'function') {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult?.data?.session?.user) {
        liveAuthUser = sessionResult.data.session.user;
      }
    }
  } catch {
    // Graceful fallback when request cookies or Supabase client are unavailable
  }

  const meta = extractMetadataProfile(liveAuthUser?.user_metadata);

  const isSuspended = isUserSuspended || Boolean(profileSnapshot.suspended);
  const awaitedParams = await searchParams;
  const contactVerified = awaitedParams?.verified === 'contact';

  const fullName = meta.fullName ?? profileSnapshot.fullName ?? null;

  const primaryAuthEmail = isNonSyntheticEmail(user.email)
    ? normalizeEmail(user.email)
    : isNonSyntheticEmail(liveAuthUser?.email)
      ? normalizeEmail(liveAuthUser.email)
      : '';
  const profileContactEmail =
    meta.contactEmail ??
    (isNonSyntheticEmail(profileSnapshot.contactEmail)
      ? normalizeEmail(profileSnapshot.contactEmail)
      : '');
  const displayedEmail = primaryAuthEmail || profileContactEmail || null;
  const confirmedEmail = resolveConfirmedEmail(
    user as ChannelConfirmationUser,
    liveAuthUser,
  );
  const hasVerifiedEmail = Boolean(
    displayedEmail &&
      confirmedEmail &&
      normalizeEmail(displayedEmail) === confirmedEmail,
  );
  const showVerifiedEmailBadge = hasVerifiedEmail;

  const primaryAuthPhoneRaw =
    user.phone?.trim() || liveAuthUser?.phone?.trim() || '';
  const profileContactPhoneRaw =
    meta.contactPhone ?? profileSnapshot.contactPhone?.trim() ?? '';
  const rawDisplayedPhone = primaryAuthPhoneRaw || profileContactPhoneRaw;
  const displayedPhone = rawDisplayedPhone
    ? formatPhoneDisplay(rawDisplayedPhone)
    : null;
  const normalizedDisplayedPhone = normalizeComparablePhone(rawDisplayedPhone);
  const confirmedPhone = resolveConfirmedPhone(
    user as ChannelConfirmationUser,
    liveAuthUser,
  );
  const hasVerifiedPhone = Boolean(
    normalizedDisplayedPhone &&
      confirmedPhone &&
      normalizedDisplayedPhone === confirmedPhone,
  );
  const showVerifiedPhoneBadge = hasVerifiedPhone;

  const backendProfile = profileSnapshot.profile;
  const mergedCurrentRole =
    backendProfile?.current_role?.trim() || meta.currentRole || null;
  const mergedEducation =
    backendProfile?.education?.trim() ||
    backendProfile?.education_level?.trim() ||
    meta.education ||
    null;
  const mergedExperienceLevel =
    backendProfile?.experience_level || meta.experienceLevel || null;
  const mergedTimezone =
    (backendProfile?.timezone && isValidIanaTimezone(backendProfile.timezone)
      ? backendProfile.timezone.trim()
      : null) ||
    meta.timezone ||
    null;
  const mergedDailyHours =
    (typeof backendProfile?.preferred_daily_hours === 'number' &&
    Number.isFinite(backendProfile.preferred_daily_hours) &&
    backendProfile.preferred_daily_hours > 0
      ? backendProfile.preferred_daily_hours
      : null) ??
    meta.preferredDailyHours ??
    null;

  const backendProfileComplete =
    typeof backendProfile?.profile_complete === 'boolean'
      ? backendProfile.profile_complete
      : typeof (backendProfile as { profileComplete?: unknown } | null)
            ?.profileComplete === 'boolean'
        ? Boolean(
            (backendProfile as { profileComplete?: unknown }).profileComplete,
          )
        : null;

  const isProfileComplete =
    backendProfileComplete !== null
      ? backendProfileComplete
      : profile_complete === true;

  const mergedProfileForForm: ProfileResponse | null = backendProfile
    ? {
        ...backendProfile,
        current_role: mergedCurrentRole,
        education: mergedEducation,
        experience_level: mergedExperienceLevel,
        timezone: mergedTimezone,
        preferred_daily_hours: mergedDailyHours,
      }
    : !profileSnapshot.loadError &&
        (mergedTimezone ||
          mergedDailyHours !== null ||
          mergedCurrentRole ||
          mergedExperienceLevel)
      ? {
          current_role: mergedCurrentRole,
          education: mergedEducation,
          experience_level: mergedExperienceLevel,
          existing_skills: [],
          existing_skills_none: false,
          learning_preference: null,
          preferred_daily_hours: mergedDailyHours,
          timezone: mergedTimezone,
          timezone_detected: Boolean(mergedTimezone),
          active_career_goal_ids: [],
          profile_complete: isProfileComplete,
          missing_fields: [],
          updated_at: '',
        }
      : null;

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
              verifiedEmail={hasVerifiedEmail ? displayedEmail : null}
              verifiedPhone={
                hasVerifiedPhone && rawDisplayedPhone
                  ? formatPhoneDisplay(rawDisplayedPhone)
                  : null
              }
            />
          )}

          <LearningSettingsForm
            initialProfile={mergedProfileForForm}
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

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
              <form action={logoutAction}>
                <Button type="submit" variant="primary" size="md">
                  Sign Out
                </Button>
              </form>
              {!isSuspended && (
                <Link href="/onboarding/profile" className={secondaryLinkClass}>
                  Edit Profile
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
