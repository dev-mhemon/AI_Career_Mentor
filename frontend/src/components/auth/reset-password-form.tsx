"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { resetPasswordAction, type AuthActionResult } from "@/lib/auth/actions";
import {
  loadVerificationDraft,
  clearVerificationDraft,
  type VerificationDraft,
} from "@/lib/auth/verification-draft";

/**
 * Screen 06: Password Reset Form component.
 * Verifies OTP code, validates password confirmation, and updates password (EP-A09).
 */
export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(resetPasswordAction, {});

  const [draft, setDraft] = useState<VerificationDraft | null>(null);
  const [isDraftExpired, setIsDraftExpired] = useState<boolean>(false);
  const draftLoaded = useRef(false);

  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    const { draft: loaded, expired } = loadVerificationDraft(
      null,
      Date.now(),
      "password_recovery",
    );
    setDraft(loaded?.context === "password_recovery" ? loaded : null);
    setIsDraftExpired(expired);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {draft?.contact_masked ? (
        <div className="rounded-lg border border-foreground/10 bg-foreground/5 p-3 text-sm text-foreground/80">
          Reset code sent to: <span className="font-semibold text-foreground">{draft.contact_masked}</span>
        </div>
      ) : isDraftExpired ? (
        <div role="status" className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          Recovery session expired. Please re-enter your email or phone below.
        </div>
      ) : null}

      <form
        action={formAction}
        onSubmit={() => {
          // Clean up draft upon submitting valid reset request
          if (draft?.context === "password_recovery") {
            clearVerificationDraft();
          }
        }}
        className="flex flex-col gap-4"
      >
        {draft?.normalized_identifier ? (
          <input
            type="hidden"
            name="identifier"
            value={draft.normalized_identifier}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="identifier"
              className="text-sm font-medium text-foreground"
            >
              Email or Phone
            </label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              required
              disabled={isPending}
              className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
              placeholder="you@example.com or +8801712345678"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="code"
            className="text-sm font-medium text-foreground"
          >
            6-Digit Verification Code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            disabled={isPending}
            autoComplete="one-time-code"
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-center text-lg font-mono tracking-widest text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="••••••"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="new_password"
            className="text-sm font-medium text-foreground"
          >
            New Password
          </label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            minLength={8}
            maxLength={128}
            required
            disabled={isPending}
            autoComplete="new-password"
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="At least 8 characters"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="confirm_new_password"
            className="text-sm font-medium text-foreground"
          >
            Confirm New Password
          </label>
          <input
            id="confirm_new_password"
            name="confirm_new_password"
            type="password"
            minLength={8}
            maxLength={128}
            required
            disabled={isPending}
            autoComplete="new-password"
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="Repeat new password"
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
          {isPending ? "Resetting password…" : "Set New Password"}
        </button>
      </form>

      <div className="flex flex-col items-center gap-2 text-sm text-foreground/60">
        <p>
          Didn&apos;t receive a code?{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
          >
            Request a new code
          </Link>
        </p>
        <p>
          Remember your password?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
