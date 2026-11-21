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

  return <ResetPasswordForm />;
}
