import { VerifyForm } from "@/components/auth/verify-form";

export const metadata = {
  title: "Verify Account",
  description: "Verify your account to continue.",
};

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Verify Account
        </h1>
        <p className="text-sm text-foreground/60">
          Enter the verification code to activate your account.
        </p>
      </div>
      <VerifyForm />
    </div>
  );
}
