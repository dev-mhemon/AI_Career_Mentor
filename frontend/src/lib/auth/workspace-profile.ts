import type {
  CurrentUserStateResponse,
  ExperienceLevel,
  ProfileResponse,
} from '@/lib/api/client';
import { loadProfileForSetup } from '@/lib/profile/actions';
import {
  extractMetadataProfile,
  formatPhoneDisplay,
  normalizeComparablePhone,
} from '@/lib/profile/metadata';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { normalizeEmail } from '@/lib/validation/auth-schemas';
import {
  isNonSyntheticEmail,
  isValidIanaTimezone,
} from '@/lib/validation/profile-schemas';

export interface ChannelConfirmationUser {
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  email_verified?: boolean | null;
  phone_verified?: boolean | null;
}

export interface LiveAuthUser {
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  email_verified?: boolean | null;
  phone_verified?: boolean | null;
  user_metadata?: Record<string, unknown>;
}

/**
 * Resolves the normalized email address explicitly confirmed on this account, or empty string.
 */
function resolveConfirmedEmail(
  user: ChannelConfirmationUser,
  liveAuthUser: ChannelConfirmationUser | null,
): string {
  if (liveAuthUser) {
    return (Boolean(liveAuthUser.email_confirmed_at) ||
      liveAuthUser.email_verified === true) &&
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
 * Resolves the normalized phone number explicitly confirmed on this account, or empty string.
 */
function resolveConfirmedPhone(
  user: ChannelConfirmationUser,
  liveAuthUser: ChannelConfirmationUser | null,
): string {
  if (liveAuthUser) {
    const livePhone = normalizeComparablePhone(liveAuthUser.phone);
    return (Boolean(liveAuthUser.phone_confirmed_at) ||
      liveAuthUser.phone_verified === true) &&
      livePhone
      ? livePhone
      : '';
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
 * Reads the live Supabase Auth user in read-only Server Components, falling back safely to null.
 */
export async function readLiveAuthUser(): Promise<LiveAuthUser | null> {
  let liveAuthUser: LiveAuthUser | null = null;

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

  return liveAuthUser;
}

export interface ContactChannelResolution {
  displayedEmail: string | null;
  emailVerified: boolean;
  rawDisplayedPhone: string | null;
  displayedPhone: string | null;
  phoneVerified: boolean;
}

/**
 * Resolves per-channel email and phone display values plus independent confirmation status.
 * Never promotes account-wide `verified_contact` or `linked_providers` onto unconfirmed channels.
 */
export function resolveContactChannels({
  user,
  liveAuthUser,
  profileContactEmail,
  profileContactPhone,
}: {
  user: ChannelConfirmationUser;
  liveAuthUser: LiveAuthUser | null;
  profileContactEmail?: string | null;
  profileContactPhone?: string | null;
}): ContactChannelResolution {
  const meta = extractMetadataProfile(liveAuthUser?.user_metadata);

  const primaryAuthEmail = isNonSyntheticEmail(user.email)
    ? normalizeEmail(user.email)
    : isNonSyntheticEmail(liveAuthUser?.email)
      ? normalizeEmail(liveAuthUser.email)
      : '';
  const fallbackContactEmail =
    meta.contactEmail ??
    (isNonSyntheticEmail(profileContactEmail)
      ? normalizeEmail(profileContactEmail)
      : '');
  const displayedEmail = primaryAuthEmail || fallbackContactEmail || null;
  const confirmedEmail = resolveConfirmedEmail(user, liveAuthUser);
  const emailVerified = Boolean(
    displayedEmail &&
      confirmedEmail &&
      normalizeEmail(displayedEmail) === confirmedEmail,
  );

  const primaryAuthPhoneRaw =
    user.phone?.trim() || liveAuthUser?.phone?.trim() || '';
  const fallbackContactPhoneRaw =
    meta.contactPhone ?? profileContactPhone?.trim() ?? '';
  const rawDisplayedPhone =
    primaryAuthPhoneRaw || fallbackContactPhoneRaw || null;
  const displayedPhone = rawDisplayedPhone
    ? formatPhoneDisplay(rawDisplayedPhone)
    : null;
  const normalizedDisplayedPhone = normalizeComparablePhone(rawDisplayedPhone);
  const confirmedPhone = resolveConfirmedPhone(user, liveAuthUser);
  const phoneVerified = Boolean(
    normalizedDisplayedPhone &&
      confirmedPhone &&
      normalizedDisplayedPhone === confirmedPhone,
  );

  return {
    displayedEmail,
    emailVerified,
    rawDisplayedPhone,
    displayedPhone,
    phoneVerified,
  };
}

export type ResolvedWorkspaceProfile =
  | { unauthorized: true }
  | {
      unauthorized: false;
      isSuspended: boolean;
      fullName: string | null;
      displayedEmail: string | null;
      showVerifiedEmailBadge: boolean;
      displayedPhone: string | null;
      showVerifiedPhoneBadge: boolean;
      currentRole: string | null;
      education: string | null;
      experienceLevel: ExperienceLevel | null;
      timezone: string | null;
      preferredDailyHours: number | null;
      isProfileComplete: boolean;
      mergedProfileForForm: ProfileResponse | null;
      profileLoadError?: string;
    };

/**
 * Shared authoritative workspace user + profile resolver consumed by `/dashboard` and `/settings`.
 * Merges EP-A13 state, EP-P01 profile snapshot, and live Supabase `user_metadata` fallbacks.
 */
export async function resolveWorkspaceProfile(
  state: CurrentUserStateResponse,
): Promise<ResolvedWorkspaceProfile> {
  const { user, profile_complete } = state;
  const isUserSuspended = user.status === 'suspended';

  const profileSnapshot = !isUserSuspended
    ? await loadProfileForSetup()
    : { profile: null };

  if (!isUserSuspended && profileSnapshot.unauthorized) {
    return { unauthorized: true };
  }

  const liveAuthUser = await readLiveAuthUser();
  const meta = extractMetadataProfile(liveAuthUser?.user_metadata);
  const isSuspended = isUserSuspended || Boolean(profileSnapshot.suspended);
  const fullName = meta.fullName ?? profileSnapshot.fullName ?? null;

  const {
    displayedEmail,
    emailVerified: showVerifiedEmailBadge,
    displayedPhone,
    phoneVerified: showVerifiedPhoneBadge,
  } = resolveContactChannels({
    user: user as ChannelConfirmationUser,
    liveAuthUser,
    profileContactEmail: profileSnapshot.contactEmail,
    profileContactPhone: profileSnapshot.contactPhone,
  });

  const backendProfile = profileSnapshot.profile;
  const currentRole =
    backendProfile?.current_role?.trim() || meta.currentRole || null;
  const education =
    backendProfile?.education?.trim() ||
    backendProfile?.education_level?.trim() ||
    meta.education ||
    null;
  const experienceLevel =
    backendProfile?.experience_level || meta.experienceLevel || null;
  const timezone =
    (backendProfile?.timezone && isValidIanaTimezone(backendProfile.timezone)
      ? backendProfile.timezone.trim()
      : null) ||
    meta.timezone ||
    null;
  const preferredDailyHours =
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
        current_role: currentRole,
        education,
        experience_level: experienceLevel,
        timezone,
        preferred_daily_hours: preferredDailyHours,
      }
    : !profileSnapshot.loadError &&
        (timezone ||
          preferredDailyHours !== null ||
          currentRole ||
          experienceLevel)
      ? {
          current_role: currentRole,
          education,
          experience_level: experienceLevel,
          existing_skills: [],
          existing_skills_none: false,
          learning_preference: null,
          preferred_daily_hours: preferredDailyHours,
          timezone,
          timezone_detected: Boolean(timezone),
          active_career_goal_ids: [],
          profile_complete: isProfileComplete,
          missing_fields: [],
          updated_at: '',
        }
      : null;

  return {
    unauthorized: false,
    isSuspended,
    fullName,
    displayedEmail,
    showVerifiedEmailBadge,
    displayedPhone,
    showVerifiedPhoneBadge,
    currentRole,
    education,
    experienceLevel,
    timezone,
    preferredDailyHours,
    isProfileComplete,
    mergedProfileForForm,
    profileLoadError: profileSnapshot.loadError,
  };
}
