import { VerifyForm } from "@/components/auth/verify-form";

export const metadata = {
  title: "Verify Account",
  description: "Verify your account to continue.",
};

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-heading-lg text-text-primary">
          Verify Account
        </h1>
        <p className="text-body-sm text-text-secondary">
          Enter the verification code to activate your account.
        </p>
      </div>
      <VerifyForm />
    </div>
  );
}
