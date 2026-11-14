import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/user";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Screen 02: Login page — Server Component enforcing route access.
 * Authenticated users redirect to /dashboard; unauthenticated users display the login shell.
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
  const resetSuccess = awaitedSearchParams?.reset === "success";
  const isDeleted = awaitedSearchParams?.deleted === "true";
  const isVerified = awaitedSearchParams?.verified === "true";
  let initialError: string | undefined;

  if (errorCode === "oauth_failed") {
    initialError = "Authentication failed. Please try again.";
  } else if (errorCode === "sync_failed") {
    initialError = "Account synchronization failed. Please contact support.";
  }

  const successMessage = isDeleted
    ? "Your account has been permanently deleted."
    : resetSuccess
    ? "Password reset successfully. Please sign in with your new password."
    : isVerified
    ? "Email verified successfully. Please sign in."
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-primary">Sign In</h1>
        <p className="text-body-sm text-text-secondary">
          Welcome back. Continue your learning path.
        </p>
      </div>
      <LoginForm initialError={initialError} successMessage={successMessage} />
    </div>
  );
}
