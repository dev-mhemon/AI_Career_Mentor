import { redirect } from 'next/navigation';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminFeaturesView } from '@/components/admin/admin-features-view';

export const dynamic = 'force-dynamic';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminFeaturesPageProps = {
  searchParams?: Promise<{ userId?: string | string[] }>;
};

/**
 * Screen 25 (`/admin/features`): Admin Feature Controls (`C09` §3.5 Screen 25, `C05` EP-AD04–AD06).
 * Protected by `admin/layout.tsx` (server-verified `EP-A13 /auth/me` `ADMIN` + `active`).
 */
export default async function AdminFeaturesPage({
  searchParams,
}: AdminFeaturesPageProps) {
  const result = await getAppSessionStateResult();
  if (result.status === 'unauthenticated') {
    redirect('/login');
  }
  if (
    result.status !== 'authenticated' ||
    result.data.user.role !== 'ADMIN' ||
    result.data.user.status !== 'active'
  ) {
    return null;
  }

  const supabase = await createSupabaseServerClient({ readOnly: true });
  const sessionRes = await supabase.auth.getSession();
  const accessToken = sessionRes?.data?.session?.access_token;
  if (!accessToken) {
    redirect('/login');
  }

  const resolvedParams = searchParams ? await searchParams : undefined;
  const rawUserId =
    typeof resolvedParams?.userId === 'string'
      ? resolvedParams.userId.trim()
      : null;
  const initialUserId =
    rawUserId && UUID_PATTERN.test(rawUserId) ? rawUserId.toLowerCase() : null;

  return (
    <AdminFeaturesView
      accessToken={accessToken}
      initialUserId={initialUserId}
    />
  );
}
