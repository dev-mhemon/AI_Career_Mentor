'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSafePathname } from '@/lib/navigation/use-safe-pathname';

export type AdminWorkspaceGuardProps = {
  isAdmin: boolean;
};

/**
 * Client-side navigation guard complementing SSR `x-pathname` enforcement in `(app)/layout.tsx`.
 * Ensures a server-verified `ADMIN` navigating to any learner route via client-side links or
 * browser history is immediately redirected to `/admin`.
 */
export function AdminWorkspaceGuard({ isAdmin }: AdminWorkspaceGuardProps) {
  const pathname = useSafePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isAdmin) return;
    if (pathname !== '/admin' && !pathname.startsWith('/admin/')) {
      router.replace('/admin');
    }
  }, [isAdmin, pathname, router]);

  return null;
}
