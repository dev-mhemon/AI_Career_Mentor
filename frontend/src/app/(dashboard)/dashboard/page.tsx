import { logoutAction } from "@/lib/auth/actions";
import { getAppUser } from "@/lib/auth/user";

/**
 * Dashboard page — MVP placeholder for authenticated + ACTIVE users.
 *
 * The layout already enforces the ACTIVE status guard.
 * This page shows a simple welcome state with a logout button.
 *
 * Future phases will add: tasks, roadmap, progress, AI mentor.
 */
export default async function DashboardPage() {
  const user = await getAppUser();

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
  );
}
