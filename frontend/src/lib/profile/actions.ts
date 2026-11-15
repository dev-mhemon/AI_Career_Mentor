'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withSingleSessionRefresh } from '@/lib/auth/actions';
import {
  getProfile,
  updateProfile,
  updateLearningSettings,
  ApiError,
  NetworkError,
  UnauthorizedError,
  type ExperienceLevel,
  type ProfileResponse,
  type UpdateProfileBody,
} from '@/lib/api/client';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation/auth-schemas';
import {
  isNonSyntheticEmail,
  isValidIanaTimezone,
  normalizeFullName,
  parseValidDailyHours,
  validateCurrentRole,
  validateDailyHours,
  validateEducation,
  validateExperienceLevel,
  validateFullName,
  validateIanaTimezone,
  validateOptionalBdPhone,
  validateOptionalEmail,
} from '@/lib/validation/profile-schemas';

/**
 * Contact prefill and verification state passed into Screen 07 Profile Setup.
 */
export interface ProfileContactInfo {
  email: string;
  emailVerified: boolean;
  phone: string;
  phoneVerified: boolean;
}

/**
 * Supported form field keys on Screen 07 (`/onboarding/profile`).
 */
export type ProfileSetupFieldKey =
  | 'full_name'
  | 'email'
  | 'phone'
  | 'current_role'
  | 'education'
  | 'experience_level'
  | 'existing_skills'
  | 'existing_skills_none'
  | 'timezone'
  | 'preferred_daily_hours';

/**
 * Supported form field keys for Screen 22 (`/settings`) Learning Settings (`EP-P04`).
 */
export type LearningSettingsFieldKey = 'timezone' | 'preferred_daily_hours';

/**
 * Preserved form input values for Screen 07 (`/onboarding/profile`).
 */
export interface ProfileSetupFormValues {
  full_name: string;
  email: string;
  phone: string;
  current_role: string;
  education: string;
  experience_level: string;
  existing_skills_none: boolean;
  timezone: string;
  preferred_daily_hours: string;
}

/**
 * Preserved form input values for Screen 22 (`/settings`) Learning Settings (`EP-P04`).
 */
export interface LearningSettingsFormValues {
  timezone: string;
  preferred_daily_hours: string;
}

/**
 * State returned by `saveProfileSetupAction` for Screen 07 (`/onboarding/profile`).
 */
export interface ProfileSetupActionState {
  success?: boolean;
  message?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  fieldErrors?: Partial<Record<ProfileSetupFieldKey, string>>;
  profile?: ProfileResponse | null;
  values?: ProfileSetupFormValues;
  redirectTo?: string;
}

/**
 * State returned by `updateLearningSettingsAction` for Screen 22 (`/settings`).
 */
export interface LearningSettingsActionState {
  success?: boolean;
  message?: string;
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  fieldErrors?: Partial<Record<LearningSettingsFieldKey, string>>;
  profile?: ProfileResponse | null;
  values?: LearningSettingsFormValues;
  redirectTo?: string;
}

function readFormString(formData: FormData, key: string): string {
  const entry = formData.get(key);
  return typeof entry === 'string' ? entry : '';
}

function extractUserProfileMeta(meta: unknown): {
  fullName?: string;
  contactEmail?: string;
  contactPhone?: string;
} {
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

  return {
    ...(rawName !== undefined ? { fullName: rawName } : {}),
    ...(contactEmail !== undefined ? { contactEmail } : {}),
    ...(contactPhone !== undefined ? { contactPhone } : {}),
  };
}

/**
 * Checks whether an error is a Next.js navigation redirect exception.
 */
function isNextRedirectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === 'NEXT_REDIRECT') return true;
  if (
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  ) {
    return true;
  }
  return false;
}

/**
 * Checks whether an error represents an HTTP 401 unauthorized response.
 */
function isUnauthorizedError(err: unknown): boolean {
  return (
    err instanceof UnauthorizedError ||
    (err instanceof ApiError && err.statusCode === 401)
  );
}

/**
 * Loads the current user's profile via EP-P01 (`GET /api/v1/profile`) without throwing on backend failure.
 * Read-only Server Component loader: on HTTP 401, returns `{ profile: null, unauthorized: true }`
 * without attempting token refresh or cookie mutation during read-only SSR rendering.
 */
export async function loadProfileForSetup(): Promise<{
  profile: ProfileResponse | null;
  userId?: string;
  fullName?: string;
  contactEmail?: string;
  contactPhone?: string;
  loadError?: string;
  unauthorized?: boolean;
  suspended?: boolean;
}> {
  let sessionUserId: string | undefined;
  let sessionMeta: {
    fullName?: string;
    contactEmail?: string;
    contactPhone?: string;
  } = {};

  try {
    const supabase = await createSupabaseServerClient({ readOnly: true });
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { profile: null, unauthorized: true };
    }

    sessionUserId = session.user?.id;
    sessionMeta = extractUserProfileMeta(session.user?.user_metadata);

    if (typeof supabase.auth.getUser === 'function') {
      try {
        const userResult = await supabase.auth.getUser();
        const liveUser = userResult?.data?.user;
        if (liveUser) {
          sessionMeta = extractUserProfileMeta(liveUser.user_metadata);
        }
      } catch {
        // Ignore non-fatal metadata lookup failures and keep session metadata
      }
    }

    const profile = await getProfile(session.access_token);

    return {
      profile,
      ...(sessionUserId ? { userId: sessionUserId } : {}),
      ...sessionMeta,
    };
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return { profile: null, unauthorized: true };
    }
    if (err instanceof ApiError) {
      if (err.statusCode === 403 && err.code === 'ACCOUNT_SUSPENDED') {
        return { profile: null, suspended: true };
      }
      return {
        profile: null,
        ...(sessionUserId ? { userId: sessionUserId } : {}),
        ...sessionMeta,
        loadError: err.message || 'Unable to load saved profile details. Please retry before saving.',
      };
    }
    if (err instanceof NetworkError) {
      return {
        profile: null,
        ...(sessionUserId ? { userId: sessionUserId } : {}),
        ...sessionMeta,
        loadError: 'Unable to reach the server to load learning settings. Please retry before saving.',
      };
    }
    return {
      profile: null,
      ...(sessionUserId ? { userId: sessionUserId } : {}),
      ...sessionMeta,
      loadError: 'Unable to load saved profile details. Please retry before saving.',
    };
  }
}

/**
 * Server action for Screen 07 (`/onboarding/profile`) that validates and saves profile background (EP-P02), learning settings (EP-P04), and user metadata.
 */
export async function saveProfileSetupAction(
  _prevState: ProfileSetupActionState,
  formData: FormData,
): Promise<ProfileSetupActionState> {
  const fullNameRaw = readFormString(formData, 'full_name');
  const emailRaw = readFormString(formData, 'email');
  const phoneRaw = readFormString(formData, 'phone');
  const currentRoleRaw = readFormString(formData, 'current_role');
  const educationRaw =
    readFormString(formData, 'education') ||
    readFormString(formData, 'education_level');
  const experienceLevelRaw = readFormString(formData, 'experience_level');
  const existingSkillsNoneRaw =
    readFormString(formData, 'existing_skills_none') || 'false';
  const existingSkillsNoneTouched =
    readFormString(formData, 'existing_skills_none_touched') === 'true';
  const timezoneRaw = readFormString(formData, 'timezone');
  const hoursRaw = readFormString(formData, 'preferred_daily_hours');

  const full_name = normalizeFullName(fullNameRaw);
  const emailCheck = validateOptionalEmail(emailRaw);
  const phoneCheck = validateOptionalBdPhone(phoneRaw);
  const email = emailCheck.ok ? emailCheck.value : normalizeEmail(emailRaw);
  const phone = phoneCheck.ok ? phoneCheck.value : phoneRaw.trim();
  const current_role = currentRoleRaw.trim();
  const education = educationRaw.trim();
  const educationTouched = formData.has('education_touched')
    ? readFormString(formData, 'education_touched') === 'true'
    : education.length > 0;
  const experience_level = experienceLevelRaw.trim();
  const existing_skills_none =
    existingSkillsNoneRaw === 'true' || existingSkillsNoneRaw === 'on';
  const timezone = timezoneRaw.trim();
  const preferred_daily_hours = hoursRaw.trim();

  const values: ProfileSetupFormValues = {
    full_name,
    email,
    phone,
    current_role,
    education,
    experience_level,
    existing_skills_none,
    timezone,
    preferred_daily_hours,
  };

  const fieldErrors: Partial<Record<ProfileSetupFieldKey, string>> = {};

  const fullNameRes = validateFullName(fullNameRaw);
  if (!fullNameRes.ok) {
    fieldErrors.full_name = fullNameRes.error;
  }

  if (!emailCheck.ok) {
    fieldErrors.email = emailCheck.error;
  }
  if (!phoneCheck.ok) {
    fieldErrors.phone = phoneCheck.error;
  }
  if (emailCheck.ok && phoneCheck.ok && !email && !phone) {
    fieldErrors.email = 'Enter a valid email address or phone number.';
  }

  const currentRoleRes = validateCurrentRole(currentRoleRaw);
  if (!currentRoleRes.ok) {
    fieldErrors.current_role = currentRoleRes.error;
  }

  const educationRes = validateEducation(educationRaw);
  if (!educationRes.ok) {
    fieldErrors.education = educationRes.error;
  }

  const experienceRes = validateExperienceLevel(experienceLevelRaw);
  if (!experienceRes.ok) {
    fieldErrors.experience_level = experienceRes.error;
  } else if (existing_skills_none && experienceRes.value !== 'beginner') {
    fieldErrors.existing_skills_none =
      'Complete Beginner mode is only available when Experience Level is Beginner.';
  }

  const timezoneRes = validateIanaTimezone(timezoneRaw);
  if (!timezoneRes.ok) {
    fieldErrors.timezone = timezoneRes.error;
  }

  const dailyHoursRes = validateDailyHours(hoursRaw);
  if (!dailyHoursRes.ok) {
    fieldErrors.preferred_daily_hours = dailyHoursRes.error;
  }

  let committedProfile: ProfileResponse | null | undefined = _prevState.profile;

  if (Object.keys(fieldErrors).length > 0) {
    const firstMessage =
      Object.values(fieldErrors)[0] ?? 'Please fix the highlighted fields.';
    return {
      error: firstMessage,
      code: 'VALIDATION_FAILED',
      fieldErrors,
      values,
      ...(committedProfile !== undefined ? { profile: committedProfile } : {}),
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return {
        error: 'Authentication session is required. Please sign in again.',
        code: 'AUTH_REQUIRED',
        values,
        ...(committedProfile !== undefined ? { profile: committedProfile } : {}),
      };
    }

    if (timezoneRes.ok && dailyHoursRes.ok) {
      committedProfile = await withSingleSessionRefresh(
        supabase,
        session,
        (accessToken) =>
          updateLearningSettings(accessToken, {
            timezone: timezoneRes.value,
            preferred_daily_hours: dailyHoursRes.value,
          }),
      );
    }

    const profileBody: UpdateProfileBody = {
      current_role: currentRoleRes.ok ? currentRoleRes.value : current_role,
      experience_level: (experienceRes.ok
        ? experienceRes.value
        : experience_level) as ExperienceLevel,
    };

    if (educationTouched) {
      profileBody.education = educationRes.ok ? educationRes.value : education;
      profileBody.education_level = profileBody.education;
    }

    if (existing_skills_none) {
      profileBody.existing_skills_none = true;
    } else if (existingSkillsNoneTouched) {
      profileBody.existing_skills_none = false;
    }

    const updatedProfile = await withSingleSessionRefresh(
      supabase,
      session,
      (accessToken) => updateProfile(accessToken, profileBody),
    );
    committedProfile = updatedProfile;

    if (typeof supabase.auth.updateUser === 'function') {
      const primaryEmail = isNonSyntheticEmail(session.user?.email)
        ? normalizeEmail(session.user!.email!)
        : '';
      const primaryPhone = session.user?.phone
        ? (normalizeBdPhone(session.user.phone) ?? session.user.phone.trim())
        : '';

      const { error: metaError } = await supabase.auth.updateUser({
        data: {
          full_name: fullNameRes.ok ? fullNameRes.value : full_name,
          contact_email: email && email !== primaryEmail ? email : null,
          contact_phone: phone && phone !== primaryPhone ? phone : null,
        },
      });
      if (metaError) {
        return {
          error:
            'Your role and study schedule were saved, but we could not save your name or contact details. Please try again.',
          retryable: true,
          profile: updatedProfile,
          values,
        };
      }
    }

    return {
      success: true,
      message: 'Profile saved successfully.',
      profile: updatedProfile,
      values: {
        full_name: fullNameRes.ok ? fullNameRes.value : full_name,
        email,
        phone,
        current_role: updatedProfile.current_role ?? current_role,
        education: updatedProfile.education ?? '',
        experience_level: updatedProfile.experience_level ?? experience_level,
        existing_skills_none: updatedProfile.existing_skills_none,
        timezone: updatedProfile.timezone ?? timezone,
        preferred_daily_hours:
          updatedProfile.preferred_daily_hours !== null &&
          updatedProfile.preferred_daily_hours !== undefined
            ? String(updatedProfile.preferred_daily_hours)
            : preferred_daily_hours,
      },
    };
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    if (err instanceof NetworkError) {
      return {
        error: 'Unable to reach the server. Please try again.',
        retryable: true,
        values,
        ...(committedProfile !== undefined ? { profile: committedProfile } : {}),
      };
    }
    if (err instanceof ApiError) {
      const apiFieldErrors: Partial<Record<ProfileSetupFieldKey, string>> = {};
      if (err.code === 'INVALID_TIMEZONE') {
        apiFieldErrors.timezone = err.message;
      }
      for (const detail of err.details) {
        const rootField = detail.field.split('.')[0] as ProfileSetupFieldKey;
        if (rootField && !apiFieldErrors[rootField]) {
          apiFieldErrors[rootField] = detail.message;
        }
      }
      return {
        error: err.message,
        code: err.code,
        retryable: err.retryable,
        retryAfterSeconds: err.retryAfterSeconds,
        fieldErrors:
          Object.keys(apiFieldErrors).length > 0 ? apiFieldErrors : undefined,
        values,
        ...(committedProfile !== undefined ? { profile: committedProfile } : {}),
      };
    }
    return {
      error: 'An unexpected error occurred while saving your profile.',
      retryable: true,
      values,
      ...(committedProfile !== undefined ? { profile: committedProfile } : {}),
    };
  }
}

/**
 * Server action for Screen 22 (`/settings`) that validates and updates learning settings via EP-P04 (`PATCH /api/v1/profile/learning-settings`).
 * Wraps the backend request with `withSingleSessionRefresh` to attempt at most one token refresh on HTTP 401.
 */
export async function updateLearningSettingsAction(
  _prevState: LearningSettingsActionState,
  formData: FormData,
): Promise<LearningSettingsActionState> {
  const timezoneEntry = formData.get('timezone');
  const hoursEntry = formData.get('preferred_daily_hours');

  const timezoneRaw = typeof timezoneEntry === 'string' ? timezoneEntry : '';
  const hoursRaw = typeof hoursEntry === 'string' ? hoursEntry : '';

  const timezone = timezoneRaw.trim();
  const preferred_daily_hours = hoursRaw.trim();

  const values: LearningSettingsFormValues = {
    timezone,
    preferred_daily_hours,
  };

  const fieldErrors: Partial<Record<LearningSettingsFieldKey, string>> = {};

  if (!timezone) {
    fieldErrors.timezone = 'Timezone is required.';
  } else if (!isValidIanaTimezone(timezone)) {
    fieldErrors.timezone =
      'Please enter a valid IANA timezone (e.g. Asia/Dhaka, UTC).';
  }

  let parsedHours = NaN;
  const parsedValid = parseValidDailyHours(preferred_daily_hours);
  if (parsedValid === null) {
    fieldErrors.preferred_daily_hours =
      'Preferred daily hours must be between 0.5 and 12 in 0.5-hour increments.';
  } else {
    parsedHours = parsedValid;
  }

  if (Object.keys(fieldErrors).length > 0) {
    const firstMessage =
      Object.values(fieldErrors)[0] ?? 'Please fix the highlighted fields.';
    return {
      error: firstMessage,
      code: 'VALIDATION_FAILED',
      fieldErrors,
      values,
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return {
        error: 'Authentication session is required. Please sign in again.',
        code: 'AUTH_REQUIRED',
        values,
      };
    }

    const updatedProfile = await withSingleSessionRefresh(
      supabase,
      session,
      (accessToken) =>
        updateLearningSettings(accessToken, {
          timezone,
          preferred_daily_hours: parsedHours,
        }),
    );

    if (!updatedProfile) {
      return {
        error: 'Authentication session expired. Please sign in again.',
        code: 'AUTH_REQUIRED',
        redirectTo: '/login',
        values,
      };
    }

    return {
      success: true,
      message:
        'শেখার সেটিংস সংরক্ষিত হয়েছে (Learning settings saved successfully).',
      profile: updatedProfile,
      values: {
        timezone: updatedProfile.timezone ?? timezone,
        preferred_daily_hours:
          updatedProfile.preferred_daily_hours !== null &&
          updatedProfile.preferred_daily_hours !== undefined
            ? String(updatedProfile.preferred_daily_hours)
            : String(parsedHours),
      },
    };
  } catch (err) {
    if (isNextRedirectError(err)) {
      throw err;
    }
    if (err instanceof NetworkError) {
      return {
        error: 'Unable to reach the server. Please try again.',
        retryable: true,
        values,
      };
    }
    if (err instanceof ApiError) {
      const apiFieldErrors: Partial<Record<LearningSettingsFieldKey, string>> = {};
      if (err.code === 'INVALID_TIMEZONE') {
        apiFieldErrors.timezone = err.message;
      }
      for (const detail of err.details) {
        const rootField = detail.field.split('.')[0] as LearningSettingsFieldKey;
        if (
          (rootField === 'timezone' || rootField === 'preferred_daily_hours') &&
          !apiFieldErrors[rootField]
        ) {
          apiFieldErrors[rootField] = detail.message;
        }
      }
      return {
        error: err.message,
        code: err.code,
        retryable: err.retryable,
        retryAfterSeconds: err.retryAfterSeconds,
        fieldErrors:
          Object.keys(apiFieldErrors).length > 0 ? apiFieldErrors : undefined,
        values,
      };
    }
    return {
      error: 'An unexpected error occurred while saving your learning settings.',
      retryable: true,
      values,
    };
  }
}
