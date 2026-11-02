import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { getAppUserResult } from "@/lib/auth/user";

/**
 * Dashboard page — MVP placeholder for authenticated + ACTIVE users.
 *
 * The layout already enforces the ACTIVE status guard.
 * Profile completion is never required to access the dashboard (C01 §7);
 * users can navigate to `/onboarding/profile` or `/settings` at any time.
 */
export default async function DashboardPage() {
  const result = await getAppUserResult();
  const user = result.data;

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg text-center">
        <h1 className="mb-2 text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="mb-6 text-foreground/60">
          Welcome{user?.email ? `, ${user.email}` : ""}! Your account is active.
        </p>
        <p className="mb-8 text-sm text-foreground/40">
          Career guidance features will be available in upcoming phases.
        </p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/onboarding/profile"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            প্রোফাইল সেটআপ (Profile Setup)
          </Link>
          <Link
            href="/settings"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-foreground/20 px-6 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            অ্যাকাউন্ট ও সেটিংস (Settings)
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="h-11 rounded-lg border border-foreground/20 px-6 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
