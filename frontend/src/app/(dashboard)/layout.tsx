import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/user";

/**
 * Dashboard route group layout — Server Component enforcing
 * business-level route guards.
 *
 * Route protection:
 *  - Unauthenticated → /login
 *  - Authenticated → render children
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAppUser();

  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
