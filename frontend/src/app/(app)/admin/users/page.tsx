import { redirect } from 'next/navigation';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminUsersView } from '@/components/admin/admin-users-view';

export const dynamic = 'force-dynamic';

/**
 * Screen 24 (`/admin/users`): Admin User Management (`C09` §3.5 Screen 24, `C05` EP-AD01–AD03).
 * Protected by `admin/layout.tsx` (server-verified `EP-A13 /auth/me` `ADMIN` + `active`).
 */
export default async function AdminUsersPage() {
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

  return <AdminUsersView accessToken={accessToken} />;
}
