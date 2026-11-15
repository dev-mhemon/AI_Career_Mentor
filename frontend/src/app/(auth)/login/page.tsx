import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasAuthenticatedAppSession } from "@/lib/auth/user";
import {
  LOGIN_HINT_COOKIE,
  parseRememberedLoginHint,
} from "@/lib/auth/remember-login";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Screen 02: Login page — Server Component enforcing route access.
 * Authenticated users redirect immediately to /dashboard unless displaying an auth error or account deletion notice; unauthenticated or recovery-needed users display the login shell.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const awaitedSearchParams = await searchParams;
  const errorCode = awaitedSearchParams?.error;
  const hasErrorParam =
    typeof errorCode === "string"
      ? errorCode.trim().length > 0
      : Array.isArray(errorCode) &&
        errorCode.some((value) => value.trim().length > 0);
  const resetSuccess = awaitedSearchParams?.reset === "success";
  const isDeleted = awaitedSearchParams?.deleted === "true";
  const isVerified = awaitedSearchParams?.verified === "true";

  if (!hasErrorParam && !isDeleted) {
    if (await hasAuthenticatedAppSession()) {
      redirect("/dashboard");
    }
  }
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

  let initialRememberedLogin = null;
  if (!isDeleted) {
    try {
      const cookieStore = await cookies();
      initialRememberedLogin = parseRememberedLoginHint(
        cookieStore.get(LOGIN_HINT_COOKIE)?.value,
      );
    } catch {
      initialRememberedLogin = null;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-primary">Sign In</h1>
        <p className="text-body-sm text-text-secondary">
          Welcome back. Continue your learning path.
        </p>
      </div>
      <LoginForm
        initialError={initialError}
        successMessage={successMessage}
        initialRememberedLogin={initialRememberedLogin}
        clearSavedLogin={isDeleted}
      />
    </div>
  );
}
