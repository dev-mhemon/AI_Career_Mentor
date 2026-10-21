import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/user";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Login page — Server Component enforcing business-level route guards.
 *
 * Route protection:
 *  - Authenticated → /dashboard
 *  - Unauthenticated → show login form
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getAppUser();

  if (user) {
    redirect("/dashboard");
  }

  const awaitedSearchParams = await searchParams;
  const errorCode = awaitedSearchParams?.error;
  let initialError: string | undefined;

  if (errorCode === "oauth_failed") {
    initialError = "Authentication failed. Please try again.";
  } else if (errorCode === "sync_failed") {
    initialError = "Account synchronization failed. Please contact support.";
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Sign In</h1>
      <LoginForm initialError={initialError} />
    </>
  );
}
