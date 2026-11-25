import { redirect } from 'next/navigation';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminUsageView } from '@/components/admin/admin-usage-view';

export const dynamic = 'force-dynamic';

/**
 * Screen 23 (`/admin`): Admin Dashboard & Usage Telemetry (`C09` §3.5 Screen 23, `C05` EP-AD07/EP-AD08).
 * Protected by `admin/layout.tsx` (server-verified `EP-A13 /auth/me` `ADMIN` + `active`).
 */
export default async function AdminDashboardPage() {
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

  return <AdminUsageView accessToken={accessToken} />;
}
