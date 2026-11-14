"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginAction, type AuthActionResult } from "@/lib/auth/actions";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { AuthAlert, useDismissedActionState } from "@/components/auth/auth-alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  loadVerificationDraft,
  saveVerificationDraft,
  clearVerificationDraft,
} from "@/lib/auth/verification-draft";
import {
  validateBdPhone,
  validateBdPhoneOnChange,
  validateEmail,
  validateEmailLive,
  validateLoginPassword,
} from "@/lib/validation/auth-schemas";

type Channel = "email" | "phone";

/**
 * Screen 02: Login form component using useActionState for pending and error states.
 * Supports Email and Bangladesh Phone (+880) tabs, preserves identifier on failure,
 * clears only password on error, and handles password recovery navigation.
 */
export function LoginForm({
  initialError,
  successMessage,
}: {
  initialError?: string;
  successMessage?: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Channel>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const identifierRef = useRef(identifier);
  useEffect(() => {
    identifierRef.current = identifier;
  }, [identifier]);
  const submittedIdentifier = useRef("");
  const phoneBlurredRef = useRef(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(
    async (prevState, formData) => {
      const result = await loginAction(prevState, formData);
      if (result?.error && !result?.redirectTo) {
        setPassword("");
      }
      return result;
    },
    { error: initialError },
  );

  const {
    visibleState: visibleAlertState,
    dismiss: dismissAlert,
    onFormActivity,
  } = useDismissedActionState(state);

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
      let resolved = submittedIdentifier.current;
      const currentIdentifier = identifierRef.current;
      if (!resolved && currentIdentifier.trim()) {
        if (channel === "phone") {
          const check = validateBdPhone(currentIdentifier);
          resolved = check.ok ? check.value : currentIdentifier.trim();
        } else {
          const check = validateEmail(currentIdentifier);
          resolved = check.ok ? check.value : currentIdentifier.trim().toLowerCase();
        }
      }
      if (resolved) {
        saveVerificationDraft({
          channel,
          identifier: resolved,
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

  const identifierError =
    clientErrors.identifier ??
    serverFieldError("identifier") ??
    serverFieldError("email");
  const passwordError = clientErrors.password ?? serverFieldError("password");

  return (
    <div className="flex flex-col gap-6">
      {successMessage && <Alert variant="success">{successMessage}</Alert>}

      <Tabs
        aria-label="Sign-in method"
        variant="segmented_pill"
        idPrefix="login"
        hidePanels
        disabled={isPending}
        value={activeTab}
        onValueChange={(id) => {
          setActiveTab(id as Channel);
          setIdentifier("");
          setClientErrors({});
          phoneBlurredRef.current = false;
          dismissAlert();
        }}
        items={[
          { id: "email", label: "Email", panel: null },
          { id: "phone", label: "Phone", panel: null },
        ]}
      />

      <div
        role="tabpanel"
        id="login-panel"
        aria-label={activeTab === "email" ? "Sign in with Email" : "Sign in with Phone"}
      >
        <form
          action={formAction}
          noValidate
          onFocusCapture={onFormActivity}
          onChangeCapture={onFormActivity}
          onSubmit={(e) => {
            const form = e.currentTarget;
            const errors: Record<string, string> = {};
            const id =
              activeTab === "email"
                ? validateEmail(identifier)
                : validateBdPhone(identifier);
            if (!id.ok) {
              errors.identifier = id.error;
              if (activeTab === "phone" && identifier.trim()) {
                phoneBlurredRef.current = true;
              }
            }
            const pw = validateLoginPassword(password);
            if (!pw.ok) errors.password = pw.error;
            if (Object.keys(errors).length) {
              e.preventDefault();
              setClientErrors(errors);
              return;
            }
            setClientErrors({});
            if (id.ok) {
              if (activeTab === "email") {
                const emailEl = form.elements.namedItem(
                  "identifier",
                ) as HTMLInputElement | null;
                if (emailEl) emailEl.value = id.value;
              }
              submittedIdentifier.current = id.value;
            }
          }}
          className="flex flex-col gap-4"
        >
          {activeTab === "email" ? (
            <Input
              key="email"
              id="email"
              name="identifier"
              variant="email"
              label="Email"
              autoComplete="username"
              required
              readOnly={isPending}
              value={identifier}
              error={identifierError}
              onChange={(e) => {
                const v = e.target.value;
                setIdentifier(v);
                dismissServerField("email");
                dismissServerField("identifier");
                const res = validateEmailLive(v);
                setFieldError("identifier", res.ok ? undefined : res.error);
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) return;
                const res = validateEmail(e.target.value);
                if (!res.ok) setFieldError("identifier", res.error);
                else {
                  setIdentifier(res.value);
                  setFieldError("identifier", undefined);
                }
              }}
              placeholder="you@example.com"
            />
          ) : (
            <Input
              key="phone"
              id="phone"
              name="identifier"
              variant="phone_bd"
              label="Phone Number"
              autoComplete="tel"
              required
              readOnly={isPending}
              value={identifier}
              error={identifierError}
              onChange={(e) => {
                const v = e.target.value;
                setIdentifier(v);
                dismissServerField("email");
                dismissServerField("identifier");
                const check = validateBdPhoneOnChange(
                  v,
                  phoneBlurredRef.current,
                );
                if (check.resetBlurred) phoneBlurredRef.current = false;
                setFieldError("identifier", check.error);
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  phoneBlurredRef.current = false;
                  return;
                }
                phoneBlurredRef.current = true;
                const res = validateBdPhone(e.target.value);
                setFieldError("identifier", res.ok ? undefined : res.error);
              }}
              hint="Bangladesh mobile, e.g. 01712-345678"
              placeholder="01712-345678"
            />
          )}

          <div className="flex flex-col gap-1.5">
            <Input
              id="password"
              name="password"
              variant="password"
              label="Password"
              autoComplete="current-password"
              required
              readOnly={isPending}
              value={password}
              error={passwordError}
              onChange={(e) => {
                const v = e.target.value;
                setPassword(v);
                dismissServerField("password");
                const pw = validateLoginPassword(v);
                setFieldError("password", pw.ok ? undefined : pw.error);
              }}
              onBlur={(e) => {
                const raw = e.target.value;
                if (!raw) return;
                const pw = validateLoginPassword(raw);
                setFieldError("password", pw.ok ? undefined : pw.error);
              }}
              placeholder="••••••••"
            />
            <div className="flex items-center justify-between gap-4">
              <Checkbox
                name="rememberMe"
                label="Keep me signed in"
                defaultChecked={false}
                disabled={isPending}
              />
              <Link
                href="/forgot-password"
                className="inline-flex min-h-11 items-center text-label text-text-link underline underline-offset-4 hover:text-text-link-hover"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {state.redirectTo ? (
            <Alert variant="info">
              Your contact is not verified yet. Taking you to verification…
            </Alert>
          ) : (
            <AuthAlert
              result={visibleAlertState}
              message={
                visibleAlertState?.status === 401
                  ? "Invalid credentials. Please try again."
                  : undefined
              }
            />
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            isLoading={isPending}
            loadingText="Signing in…"
          >
            Sign In
          </Button>
        </form>
      </div>

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
