import type { ExperienceLevel } from '@/lib/api/client';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation/auth-schemas';
import {
  isNonSyntheticEmail,
  isValidExperienceLevel,
  isValidIanaTimezone,
  normalizeFullName,
  parseValidDailyHours,
} from '@/lib/validation/profile-schemas';

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  beginner: 'Beginner',
  junior: 'Junior',
  mid: 'Mid-Level',
  senior: 'Senior',
};

export interface ExtractedUserMetadata {
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
export function extractMetadataProfile(meta: unknown): ExtractedUserMetadata {
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
      : typeof record.education_level === 'string' &&
          record.education_level.trim()
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

/**
 * Normalizes a Bangladesh/E.164 phone number so stored and auth values compare consistently.
 */
export function normalizeComparablePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return normalizeBdPhone(trimmed) ?? trimmed;
}

/**
 * Formats a canonical `+8801XXXXXXXXX` phone number as `+880 1XXX-XXXXXX` for clean display.
 */
export function formatPhoneDisplay(raw: string): string {
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
