import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth/user";
import { RegisterForm } from "@/components/auth/register-form";

/**
 * Registration page — Server Component with route guard.
 *
 * Route protection:
 *  - Authenticated → /dashboard
 *  - Unauthenticated → show registration form
 */
export default async function RegisterPage() {
  const user = await getAppUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-primary">Create Account</h1>
        <p className="text-body-sm text-text-secondary">
          Start with your email or Bangladesh mobile number.
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
