"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginAction, type AuthActionResult } from "@/lib/auth/actions";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { AuthAlert } from "@/components/auth/auth-alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadVerificationDraft,
  saveVerificationDraft,
  clearVerificationDraft,
} from "@/lib/auth/verification-draft";
import {
  validateIdentifier,
  validateIdentifierOnChange,
  validatePassword,
  validatePasswordLive,
} from "@/lib/validation/auth-schemas";

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
  const identifierBlurredRef = useRef(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

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

  const setFieldError = (field: string, error?: string) =>
    setClientErrors((prev) => {
      if (!error) {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }
      if (prev[field] === error) return prev;
      return { ...prev, [field]: error };
    });

  const dismissServerField = (field: string) =>
    setDismissedServer((prev) => {
      if (!state?.fieldErrors?.[field]) return prev;
      if (prev?.ref === state && prev.fields.has(field)) return prev;
      const fields = new Set(prev?.ref === state ? prev.fields : []);
      fields.add(field);
      return { ref: state, fields };
    });

  const serverFieldError = (field: string) =>
    dismissedServer?.ref === state && dismissedServer.fields.has(field)
      ? undefined
      : state?.fieldErrors?.[field];

  const identifierError = clientErrors.email ?? serverFieldError("email");
  const passwordError = clientErrors.password ?? serverFieldError("password");

  return (
    <div className="flex flex-col gap-6">
      {successMessage && <Alert variant="success">{successMessage}</Alert>}

      <form
        action={formAction}
        noValidate
        onSubmit={(e) => {
          const form = e.currentTarget;
          const idEl = form.elements.namedItem("email") as HTMLInputElement | null;
          const pwEl = form.elements.namedItem("password") as HTMLInputElement | null;
          const errors: Record<string, string> = {};
          const id = validateIdentifier(idEl?.value ?? "");
          if (!id.ok) {
            errors.email = id.error;
            if (idEl?.value?.trim()) identifierBlurredRef.current = true;
          }
          const pw = validatePassword(pwEl?.value ?? "");
          if (!pw.ok) errors.password = pw.error;
          if (Object.keys(errors).length) {
            e.preventDefault();
            setClientErrors(errors);
            return;
          }
          setClientErrors({});
          if (id.ok && idEl) idEl.value = id.value.value; // normalized (+8801…, lowercase email)
          submittedIdentifier.current = idEl?.value?.trim() ?? "";
        }}
        className="flex flex-col gap-4"
      >
        <Input
          id="email"
          name="email"
          label="Email or Phone"
          autoComplete="username"
          required
          readOnly={isPending}
          error={identifierError}
          onChange={(e) => {
            dismissServerField("email");
            const check = validateIdentifierOnChange(
              e.target.value,
              identifierBlurredRef.current,
            );
            if (check.resetBlurred) identifierBlurredRef.current = false;
            setFieldError("email", check.error);
          }}
          onBlur={(e) => {
            const raw = e.target.value;
            if (!raw.trim()) {
              identifierBlurredRef.current = false;
              return;
            }
            identifierBlurredRef.current = true;
            const id = validateIdentifier(raw);
            if (!id.ok) {
              setFieldError("email", id.error);
            } else {
              if (id.value.kind === "email") e.target.value = id.value.value;
              setFieldError("email", undefined);
            }
          }}
          placeholder="you@example.com or +8801712345678"
        />

        <div className="flex flex-col gap-1.5">
          <Input
            id="password"
            name="password"
            variant="password"
            label="Password"
            autoComplete="current-password"
            required
            readOnly={isPending}
            error={passwordError}
            onChange={(e) => {
              dismissServerField("password");
              const pw = validatePasswordLive(e.target.value);
              setFieldError("password", pw.ok ? undefined : pw.error);
            }}
            onBlur={(e) => {
              const raw = e.target.value;
              if (!raw) return;
              const pw = validatePassword(raw);
              setFieldError("password", pw.ok ? undefined : pw.error);
            }}
            placeholder="••••••••"
          />
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center self-end text-label text-text-link underline underline-offset-4 hover:text-text-link-hover"
          >
            পাসওয়ার্ড ভুলে গেছেন? (Forgot Password)
          </Link>
        </div>

        {state.redirectTo ? (
          <Alert variant="info">
            Your contact is not verified yet. Taking you to verification…
          </Alert>
        ) : (
          <AuthAlert
            result={state}
            message={
              state.status === 401
                ? "Incorrect email, phone or password. Check your details and try again."
                : undefined
            }
          />
        )}

        <Button type="submit" size="lg" fullWidth isLoading={isPending} loadingText="Signing in…">
          Sign In
        </Button>
      </form>

      <div className="relative flex items-center">
        <div className="flex-1 border-t border-border-default" />
        <span className="px-3 text-body-sm text-text-muted">or</span>
        <div className="flex-1 border-t border-border-default" />
      </div>

      <OAuthButtons />

      <p className="text-center text-body-sm text-text-secondary">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}
