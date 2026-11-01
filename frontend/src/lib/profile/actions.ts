'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getProfile,
  updateProfile,
  updateLearningSettings,
  ApiError,
  NetworkError,
  type ExperienceLevel,
  type ProfileResponse,
  type UpdateProfileBody,
  type UpdateLearningSettingsBody,
} from '@/lib/api/client';

/**
 * Supported form field keys on Screen 07 (`/onboarding/profile`).
 */
export type ProfileSetupFieldKey =
  | 'current_role'
  | 'education'
  | 'experience_level'
  | 'existing_skills'
  | 'existing_skills_none'
  | 'timezone'
  | 'preferred_daily_hours';

/**
 * Preserved form input values for Screen 07 (`/onboarding/profile`).
 */
export interface ProfileSetupFormValues {
  current_role: string;
  education: string;
  experience_level: string;
  existing_skills_none: boolean;
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
}

const VALID_EXPERIENCE_LEVELS: readonly ExperienceLevel[] = [
  'beginner',
  'junior',
  'mid',
  'senior',
];

/**
 * Checks whether a string is a valid C05 `experience_level` enum value.
 */
function isValidExperienceLevel(value: string): value is ExperienceLevel {
  return (VALID_EXPERIENCE_LEVELS as readonly string[]).includes(value);
}

/**
 * Loads the current user's profile via EP-P01 (`GET /api/v1/profile`) without throwing on backend failure.
 */
export async function loadProfileForSetup(): Promise<{
  profile: ProfileResponse | null;
  userId?: string;
  loadError?: string;
  unauthorized?: boolean;
  suspended?: boolean;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      return { profile: null, unauthorized: true };
    }

    const profile = await getProfile(session.access_token);
    const result: {
      profile: ProfileResponse | null;
      userId?: string;
      loadError?: string;
      unauthorized?: boolean;
      suspended?: boolean;
    } = { profile };
    if (session.user?.id) {
      result.userId = session.user.id;
    }
    return result;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.statusCode === 401) {
        return { profile: null, unauthorized: true };
      }
      if (err.statusCode === 403 && err.code === 'ACCOUNT_SUSPENDED') {
        return { profile: null, suspended: true };
      }
      return {
        profile: null,
        loadError: err.message || 'Unable to load saved profile details.',
      };
    }
    if (err instanceof NetworkError) {
      return {
        profile: null,
        loadError: 'Unable to reach the server. You can still enter your details below.',
      };
    }
    return {
      profile: null,
      loadError: 'Unable to load saved profile details.',
    };
  }
}

/**
 * Server action for Screen 07 (`/onboarding/profile`) that validates and saves profile background (EP-P02) and learning settings (EP-P04).
 */
export async function saveProfileSetupAction(
  _prevState: ProfileSetupActionState,
  formData: FormData,
): Promise<ProfileSetupActionState> {
  const currentRoleRaw = (formData.get('current_role') as string | null) ?? '';
  const educationRaw = (formData.get('education') as string | null) ?? '';
  const experienceLevelRaw = (formData.get('experience_level') as string | null) ?? '';
  const existingSkillsNoneRaw = (formData.get('existing_skills_none') as string | null) ?? 'false';
  const existingSkillsNoneTouched =
    (formData.get('existing_skills_none_touched') as string | null) === 'true';
  const timezoneRaw = (formData.get('timezone') as string | null) ?? '';
  const hoursRaw = (formData.get('preferred_daily_hours') as string | null) ?? '';

  const current_role = currentRoleRaw.trim();
  const education = educationRaw.trim();
  const experience_level = experienceLevelRaw.trim();
  const existing_skills_none =
    existingSkillsNoneRaw === 'true' || existingSkillsNoneRaw === 'on';
  const timezone = timezoneRaw.trim();
  const preferred_daily_hours = hoursRaw.trim();

  const values: ProfileSetupFormValues = {
    current_role,
    education,
    experience_level,
    existing_skills_none,
    timezone,
    preferred_daily_hours,
  };

  const fieldErrors: Partial<Record<ProfileSetupFieldKey, string>> = {};

  if (!current_role) {
    fieldErrors.current_role = 'Current role or profession is required.';
  } else if (current_role.length > 120) {
    fieldErrors.current_role = 'Current role must be 120 characters or fewer.';
  }

  if (education.length > 200) {
    fieldErrors.education = 'Education must be 200 characters or fewer.';
  }

  if (!experience_level || !isValidExperienceLevel(experience_level)) {
    fieldErrors.experience_level =
      'Please select your experience level (Beginner, Junior, Mid, or Senior).';
  }

  let parsedHours: number | undefined;
  if (preferred_daily_hours !== '') {
    const num = Number(preferred_daily_hours);
    if (
      !Number.isFinite(num) ||
      num < 0.5 ||
      num > 12 ||
      !Number.isInteger(num * 2)
    ) {
      fieldErrors.preferred_daily_hours =
        'Preferred daily hours must be between 0.5 and 12 in 0.5-hour increments.';
    } else {
      parsedHours = num;
    }
  }

  let committedProfile: ProfileResponse | null | undefined = _prevState.profile;

  if (Object.keys(fieldErrors).length > 0) {
    const firstMessage = Object.values(fieldErrors)[0] ?? 'Please fix the highlighted fields.';
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

    const learningBody: UpdateLearningSettingsBody = {};
    if (timezone.length > 0) {
      learningBody.timezone = timezone;
    }
    if (parsedHours !== undefined) {
      learningBody.preferred_daily_hours = parsedHours;
    }

    if (Object.keys(learningBody).length > 0) {
      committedProfile = await updateLearningSettings(
        session.access_token,
        learningBody,
      );
    }

    const profileBody: UpdateProfileBody = {
      current_role,
      experience_level: experience_level as ExperienceLevel,
    };

    if (education.length > 0) {
      profileBody.education = education;
    }

    if (existing_skills_none) {
      profileBody.existing_skills_none = true;
    } else if (existingSkillsNoneTouched) {
      profileBody.existing_skills_none = false;
    }

    const updatedProfile = await updateProfile(
      session.access_token,
      profileBody,
    );
    committedProfile = updatedProfile;

    return {
      success: true,
      message: 'প্রোফাইল সংরক্ষিত হয়েছে (Profile saved successfully).',
      profile: updatedProfile,
      values: {
        current_role: updatedProfile.current_role ?? current_role,
        education: updatedProfile.education ?? education,
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
