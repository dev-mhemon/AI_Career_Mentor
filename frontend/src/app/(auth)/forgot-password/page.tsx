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
    <>
      <h1 className="mb-2 text-2xl font-bold text-foreground">Reset Password</h1>
      <p className="mb-6 text-sm text-foreground/60">
        Enter your registered email or phone to receive a 6-digit verification code.
      </p>
      <ForgotPasswordForm />
    </>
  );
}
