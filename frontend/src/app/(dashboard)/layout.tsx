import { redirect } from 'next/navigation';
import { getAppUser } from '@/lib/auth/user';

/**
 * Dashboard route group layout — Server Component enforcing
 * business-level route guards.
 *
 * Route protection:
 *  - Unauthenticated → /login
 *  - Authenticated → render children
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getAppUser();

  if (!user) {
    redirect('/login');
  }

  if (user.status === 'suspended') {
    return (
      <main>
        <h1>আপনার অ্যাকাউন্ট স্থগিত আছে</h1>
        <p>
          অ্যাকাউন্ট মুছে ফেলার অধিকার বজায় আছে। এই foundation-এ deletion screen এখনো বাস্তবায়িত
          হয়নি।
        </p>
      </main>
    );
  }
  return <>{children}</>;
}
