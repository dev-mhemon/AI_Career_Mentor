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
    : undefined;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Sign In</h1>
      <LoginForm initialError={initialError} successMessage={successMessage} />
    </>
  );
}
