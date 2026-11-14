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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-primary">Set New Password</h1>
        <p className="text-body-sm text-text-secondary">
          Enter the 6-digit verification code you received and choose a new password.
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
