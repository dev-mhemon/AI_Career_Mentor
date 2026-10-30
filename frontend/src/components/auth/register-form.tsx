"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { registerAction, type AuthActionResult } from "@/lib/auth/actions";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export function RegisterForm() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(registerAction, {});

  const [activeTab, setActiveTab] = useState<"email" | "phone">("email");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-full rounded-lg bg-foreground/5 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("email")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            activeTab === "email"
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground"
          }`}
        >
          Email
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("phone")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            activeTab === "phone"
              ? "bg-background text-foreground shadow-sm"
              : "text-foreground/60 hover:text-foreground"
          }`}
        >
          Phone
        </button>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="type" value={activeTab} />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="identifier"
            className="text-sm font-medium text-foreground"
          >
            {activeTab === "email" ? "Email" : "Phone Number"}
          </label>
          <input
            id="identifier"
            name="identifier"
            type={activeTab === "email" ? "email" : "tel"}
            autoComplete={activeTab === "email" ? "email" : "tel"}
            required
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder={
              activeTab === "email" ? "you@example.com" : "+1234567890"
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="text-sm font-medium text-foreground"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="••••••••"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="confirmPassword"
            className="text-sm font-medium text-foreground"
          >
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={isPending}
            className="h-11 w-full rounded-lg border border-foreground/20 bg-background px-3 text-base text-foreground placeholder:text-foreground/40 focus:border-foreground focus:outline-none disabled:opacity-50"
            placeholder="••••••••"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="privacy_consent"
            name="privacy_consent"
            type="checkbox"
            required
            disabled={isPending}
            className="h-4 w-4 rounded border-foreground/20 text-foreground focus:ring-foreground"
          />
          <label
            htmlFor="privacy_consent"
            className="text-sm text-foreground/80"
          >
            I agree to the privacy policy
          </label>
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
          {isPending ? "Creating account..." : "Create Account"}
        </button>
      </form>

      <div className="relative flex items-center">
        <div className="flex-1 border-t border-foreground/10" />
        <span className="px-3 text-sm text-foreground/50">or</span>
        <div className="flex-1 border-t border-foreground/10" />
      </div>

      <OAuthButtons />

      <p className="text-center text-sm text-foreground/60">
        Already have an account?{" "}
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
