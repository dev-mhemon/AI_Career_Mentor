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
    <>
      <h1 className="mb-6 text-2xl font-bold text-foreground">
        Create Account
      </h1>
      <RegisterForm />
    </>
  );
}
