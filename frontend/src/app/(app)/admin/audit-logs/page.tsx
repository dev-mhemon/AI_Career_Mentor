import { redirect } from 'next/navigation';
import { getAppSessionStateResult } from '@/lib/auth/user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminAuditLogsView } from '@/components/admin/admin-audit-logs-view';

export const dynamic = 'force-dynamic';

/**
 * Dedicated Admin Audit Logs route (`/admin/audit-logs`, `EP-AD07`).
 * Protected by `admin/layout.tsx` (server-verified `EP-A13 /auth/me` `ADMIN` + `active`).
 */
export default async function AdminAuditLogsPage() {
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

  return <AdminAuditLogsView accessToken={accessToken} />;
}
