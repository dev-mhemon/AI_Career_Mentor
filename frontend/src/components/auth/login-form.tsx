"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginAction, type AuthActionResult } from "@/lib/auth/actions";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import {
  loadVerificationDraft,
  saveVerificationDraft,
  clearVerificationDraft,
} from "@/lib/auth/verification-draft";

/**
 * Screen 02: Login form component using useActionState for pending and error states.
 * Supports email/phone credentials, password recovery navigation, and reset success alerts.
 */
export function LoginForm({
  initialError,
  successMessage,
}: {
  initialError?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(loginAction, { error: initialError });
  const submittedIdentifier = useRef("");

  useEffect(() => {
    if (successMessage) {
      const { draft: loaded } = loadVerificationDraft(
        null,
        Date.now(),
        "password_recovery",
      );
      if (loaded?.context === "password_recovery") {
        clearVerificationDraft();
      }
    }
  }, [successMessage]);

  useEffect(() => {
    if (state?.redirectTo) {
      const channel = state.redirectTo.includes("channel=phone")
        ? "phone"
        : "email";
      const identifier =
        submittedIdentifier.current ||
        (document.getElementById("email") as HTMLInputElement | null)?.value?.trim() ||
        "";
      if (identifier) {
        saveVerificationDraft({
          channel,
          identifier,
          context: "unverified_login",
        });
      }
      router.push(state.redirectTo);
    }
  }, [state, router]);

  useEffect(() => {
    if (state?.error && !state?.redirectTo) {
      submittedIdentifier.current = "";
      const { draft: loaded } = loadVerificationDraft(
        null,
        Date.now(),
        ["unverified_login"],
      );
      if (loaded?.context === "unverified_login") {
        clearVerificationDraft();
      }
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      {successMessage && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {successMessage}
        </div>
      )}

      <form
        action={formAction}
        onSubmit={(e) => {
          const el = e.currentTarget.elements.namedItem(
            "email",
          ) as HTMLInputElement | null;
          submittedIdentifier.current = el?.value?.trim() ?? "";
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="text-sm font-medium text-foreground"
          >
            Email or Phone
          </label>
          <input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            required
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="you@example.com or +8801712345678"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="text-sm font-medium text-foreground"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-foreground/60 underline underline-offset-4 hover:text-foreground"
            >
              পাসওয়ার্ড ভুলে গেছেন? (Forgot Password)
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="••••••••"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="mt-2 h-11 w-full rounded-lg bg-foreground font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
        >
          {isPending ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <div className="relative flex items-center">
        <div className="flex-1 border-t border-foreground/10" />
        <span className="px-3 text-sm text-foreground/50">or</span>
        <div className="flex-1 border-t border-foreground/10" />
      </div>

      <OAuthButtons />

      <p className="text-center text-sm text-foreground/60">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
