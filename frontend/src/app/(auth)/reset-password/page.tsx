import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/user";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

/**
 * Screen 06: Password Reset page — Server Component enforcing route access.
 * Unauthenticated users submit code and set a new password; authenticated users redirect to dashboard.
 */
export default async function ResetPasswordPage() {
  const user = await getAppUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <>
      <h1 className="mb-2 text-2xl font-bold text-foreground">Set New Password</h1>
      <p className="mb-6 text-sm text-foreground/60">
        Enter the 6-digit verification code you received and choose a new password.
      </p>
      <ResetPasswordForm />
    </>
  );
}
