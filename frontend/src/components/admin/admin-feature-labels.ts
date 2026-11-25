import type { AdminFeatureKey } from '@/lib/api/client';

export type AdminFeatureMeta = {
  key: AdminFeatureKey;
  label: string;
  description: string;
  defaultUserEnabled: boolean;
};

export const ADMIN_FEATURE_META_LIST: readonly AdminFeatureMeta[] = [
  {
    key: 'roadmap_generator',
    label: 'Roadmap Generator',
    description:
      'Generate, revise, and propose merges for personalized career roadmaps.',
    defaultUserEnabled: true,
  },
  {
    key: 'daily_plan',
    label: 'Daily Plan',
    description: 'Create, rebuild, and prepare sequential Daily Plans.',
    defaultUserEnabled: true,
  },
  {
    key: 'quiz_practice',
    label: 'Quiz Practice',
    description: 'Generate and submit topic quizzes (MCQ + free-response).',
    defaultUserEnabled: true,
  },
  {
    key: 'ai_practice_review',
    label: 'AI Practice Review',
    description:
      'Automated formative rubric review for submitted short free-response answers.',
    defaultUserEnabled: true,
  },
  {
    key: 'progress_tracking',
    label: 'Progress Tracking',
    description:
      'Record learning evidence and career-level skill state transitions.',
    defaultUserEnabled: true,
  },
  {
    key: 'ai_mentor',
    label: 'AI Mentor',
    description: 'Contextual career mentorship chat sessions.',
    defaultUserEnabled: true,
  },
  {
    key: 'technology_update',
    label: 'Daily Technology Updates',
    description:
      'Personalized daily technology intelligence (OFF by default per user until enabled).',
    defaultUserEnabled: false,
  },
] as const;

export const ADMIN_FEATURE_META_BY_KEY: Readonly<
  Record<AdminFeatureKey, AdminFeatureMeta>
> = Object.fromEntries(
  ADMIN_FEATURE_META_LIST.map((item) => [item.key, item]),
) as Record<AdminFeatureKey, AdminFeatureMeta>;

export function formatAdminUtcTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${parsed.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/**
 * Formats a verified admin's contact display using full email/phone when present,
 * falling back to `contact_masked` only if both are null/empty.
 */
export function formatAdminUserContact(user: {
  email: string | null;
  phone: string | null;
  contact_masked: string;
}): string {
  const email = user.email?.trim() || null;
  const phone = user.phone?.trim() || null;
  if (email && phone) return `${email} / ${phone}`;
  return email ?? phone ?? user.contact_masked;
}
