import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getProfile, type UserResponse } from '@/lib/api/client';
import { normalizeBdPhone, normalizeEmail } from '@/lib/validation/auth-schemas';
import { isNonSyntheticEmail, normalizeFullName } from '@/lib/validation/profile-schemas';
import type { ShellUserInfo } from './user-display';

interface MetadataRecord {
  fullName?: string;
  currentRole?: string;
  contactEmail?: string;
  contactPhone?: string;
}

function parseShellMetadata(meta: unknown): MetadataRecord {
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

  const currentRole =
    typeof record.current_role === 'string' && record.current_role.trim()
      ? record.current_role.trim()
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
    ...(rawName ? { fullName: rawName } : {}),
    ...(currentRole ? { currentRole } : {}),
    ...(contactEmail ? { contactEmail } : {}),
    ...(contactPhone ? { contactPhone } : {}),
  };
}

/**
 * Best-effort server resolver for authenticated shell user metadata (fullName, currentRole, email, phone).
 * Never throws or blocks rendering if Supabase metadata or backend profile lookup fails.
 */
export async function getAuthenticatedShellUser(
  user: Pick<UserResponse, 'email' | 'phone'>,
): Promise<ShellUserInfo> {
  const baseEmail = isNonSyntheticEmail(user.email) ? normalizeEmail(user.email) : null;
  const basePhone = user.phone?.trim() || null;

  let meta: MetadataRecord = {};
  let profileRole: string | null = null;
  let liveEmail: string | null = null;
  let livePhone: string | null = null;

  try {
    const supabase = await createSupabaseServerClient({ readOnly: true });
    let accessToken: string | undefined;

    if (typeof supabase.auth.getSession === 'function') {
      try {
        const sessionRes = await supabase.auth.getSession();
        const session = sessionRes?.data?.session;
        accessToken = session?.access_token;
        if (session?.user) {
          meta = parseShellMetadata(session.user.user_metadata);
          if (isNonSyntheticEmail(session.user.email)) {
            liveEmail = normalizeEmail(session.user.email);
          }
          if (session.user.phone?.trim()) {
            livePhone = session.user.phone.trim();
          }
        }
      } catch {
        // Ignore non-fatal session metadata lookup errors
      }
    }

    const liveUserPromise =
      typeof supabase.auth.getUser === 'function'
        ? supabase.auth.getUser().catch(() => null)
        : Promise.resolve(null);
    const profilePromise = accessToken
      ? getProfile(accessToken).catch(() => null)
      : Promise.resolve(null);

    const [liveUserRes, profileRes] = await Promise.all([
      liveUserPromise,
      profilePromise,
    ]);

    const liveUser = liveUserRes?.data?.user;
    if (liveUser) {
      meta = { ...meta, ...parseShellMetadata(liveUser.user_metadata) };
      if (isNonSyntheticEmail(liveUser.email)) {
        liveEmail = normalizeEmail(liveUser.email);
      }
      if (liveUser.phone?.trim()) {
        livePhone = liveUser.phone.trim();
      }
    }

    if (profileRes?.current_role?.trim()) {
      profileRole = profileRes.current_role.trim();
    }
  } catch {
    // Graceful fallback to UserResponse email/phone
  }

  return {
    fullName: meta.fullName ?? null,
    currentRole: profileRole ?? meta.currentRole ?? null,
    email: baseEmail ?? liveEmail ?? meta.contactEmail ?? null,
    phone: basePhone ?? livePhone ?? meta.contactPhone ?? null,
  };
}

export interface AuthenticatedFastShellSession {
  unauthenticated: false;
  user: ShellUserInfo | null;
  variant: 'authenticated' | 'admin';
}

export type FastShellSessionResult =
  | { unauthenticated: true }
  | AuthenticatedFastShellSession;

/**
 * Non-blocking cookie session reader for the persistent `(app)` shell layout.
 * Never performs backend HTTP calls so Sidebar and Header mount immediately without
 * waiting on slow per-page profile/account requests.
 */
export async function getFastSessionShellUser(): Promise<FastShellSessionResult> {
  try {
    const supabase = await createSupabaseServerClient({ readOnly: true });
    if (typeof supabase.auth.getSession !== 'function') {
      return { unauthenticated: false, user: null, variant: 'authenticated' };
    }

    const sessionRes = await supabase.auth.getSession();
    const session = sessionRes?.data?.session;
    if (!session?.user) {
      return { unauthenticated: true };
    }

    const meta = parseShellMetadata(session.user.user_metadata);
    const email = isNonSyntheticEmail(session.user.email)
      ? normalizeEmail(session.user.email)
      : (meta.contactEmail ?? null);
    const phone = session.user.phone?.trim() || meta.contactPhone || null;
    const appRole = (session.user.app_metadata as Record<string, unknown> | undefined)
      ?.role;

    let profileRole: string | null = null;
    if (session.access_token) {
      const profileRes = await getProfile(session.access_token).catch(() => null);
      if (profileRes?.current_role?.trim()) {
        profileRole = profileRes.current_role.trim();
      }
    }

    return {
      unauthenticated: false,
      variant: appRole === 'ADMIN' ? 'admin' : 'authenticated',
      user: {
        fullName: meta.fullName ?? null,
        currentRole: profileRole || meta.currentRole || null,
        email,
        phone,
      },
    };
  } catch {
    return { unauthenticated: false, user: null, variant: 'authenticated' };
  }
}

/**
 * Shared fast cookie-session guard for authenticated route-group layouts (`(app)` and `(onboarding)`).
 * Redirects unauthenticated visitors to `/login` (or `/login?deleted=true` when the deletion cookie is set).
 */
export async function requireFastSessionShell(): Promise<AuthenticatedFastShellSession> {
  const fastSession = await getFastSessionShellUser();

  if (fastSession.unauthenticated) {
    let isDeleted = false;
    try {
      const cookieStore = await cookies();
      if (cookieStore?.get('account_deleted')?.value === 'true') {
        isDeleted = true;
      }
    } catch {
      // Ignore if cookies() is unavailable outside request context
    }
    if (isDeleted) {
      redirect('/login?deleted=true');
    }
    redirect('/login');
  }

  return fastSession;
}
