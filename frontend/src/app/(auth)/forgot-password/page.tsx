import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/user";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

/**
 * Screen 05: Password Recovery page — Server Component enforcing route access.
 * Unauthenticated users request a recovery challenge; authenticated users redirect to dashboard.
 */
export default async function ForgotPasswordPage() {
  const user = await getAppUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-primary">Reset Password</h1>
        <p className="text-body-sm text-text-secondary">
          Enter your email or phone number and, if an account matches, we&apos;ll
          send a 6-digit verification code to reset your password.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
