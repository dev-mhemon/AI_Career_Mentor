"use client";

import { useActionState, useState, useEffect } from "react";
import Link from "next/link";
import { forgotPasswordAction, type AuthActionResult } from "@/lib/auth/actions";
import {
  saveVerificationDraft,
  loadVerificationDraft,
  clearVerificationDraft,
  type VerificationChannel,
} from "@/lib/auth/verification-draft";

/**
 * Screen 05: Password Recovery Form component.
 * Dispatches password recovery challenge (EP-A08) and persists R18 recovery draft.
 */
export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(forgotPasswordAction, {});

  const [channel, setChannel] = useState<VerificationChannel>("email");

  useEffect(() => {
    if (state?.error) {
      const { draft: loaded } = loadVerificationDraft(
        null,
        Date.now(),
        "password_recovery",
      );
      if (loaded?.context === "password_recovery") {
        clearVerificationDraft();
      }
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-full rounded-lg bg-foreground/5 p-1">
        <button
          type="button"
          onClick={() => setChannel("email")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            channel === "email"
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground"
          }`}
        >
          Email
        </button>
        <button
          type="button"
          onClick={() => setChannel("phone")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            channel === "phone"
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground"
          }`}
        >
          Phone
        </button>
      </div>

      <form
        action={formAction}
        onSubmit={(e) => {
          const form = e.currentTarget;
          const identifier = (
            form.elements.namedItem("identifier") as HTMLInputElement
          )?.value;
          if (identifier) {
            saveVerificationDraft({
              channel,
              identifier,
              context: "password_recovery",
            });
          }
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="identifier"
            className="text-sm font-medium text-foreground"
          >
            {channel === "email" ? "Registered Email" : "Registered Phone Number"}
          </label>
          <input
            id="identifier"
            name="identifier"
            type={channel === "email" ? "email" : "tel"}
            autoComplete={channel === "email" ? "email" : "tel"}
            required
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder={
              channel === "email" ? "you@example.com" : "+8801712345678"
            }
          />
        </div>

        {state?.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="mt-2 h-11 w-full rounded-lg bg-foreground font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
        >
          {isPending ? "Sending code…" : "Send Reset Code"}
        </button>
      </form>

      <p className="text-center text-sm text-foreground/60">
        Remember your password?{" "}
        <Link
          href="/login"
          className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
