"use client";

import { useActionState, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { registerAction, type AuthActionResult } from "@/lib/auth/actions";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { AuthAlert, useDismissedActionState } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  saveVerificationDraft,
  clearVerificationDraft,
} from "@/lib/auth/verification-draft";
import {
  PASSWORD_MAX,
  passwordStrength,
  validateBdPhone,
  validateBdPhoneOnChange,
  validateEmail,
  validateEmailLive,
  validatePassword,
  validatePasswordLive,
  validatePasswordMatch,
} from "@/lib/validation/auth-schemas";

type Channel = "email" | "phone";

/**
 * Registration form component for email and phone account creation.
 * Saves sanitized R18 verification draft in sessionStorage before navigation.
 */
export function RegisterForm() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(registerAction, {});

  const [activeTab, setActiveTab] = useState<Channel>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);
  const phoneBlurredRef = useRef(false);

  useEffect(() => {
    if (state?.error || state?.fieldErrors) {
      clearVerificationDraft();
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

  const strength = passwordStrength(password);
  const mismatch =
    confirm.length > 0 && !validatePasswordMatch(password, confirm).ok
      ? "Passwords do not match."
      : undefined;

  const identifierError = clientErrors.identifier ?? serverFieldError("identifier");
  const passwordError = clientErrors.password ?? serverFieldError("password");
  const confirmError = clientErrors.confirmPassword ?? mismatch;
  const {
    visibleState: visibleAlertState,
    dismiss: dismissAlert,
    onFormActivity,
  } = useDismissedActionState(state);
  const conflict = visibleAlertState?.status === 409;

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        aria-label="Sign-up method"
        variant="segmented_pill"
        idPrefix="register"
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
        id="register-panel"
        aria-label={activeTab === "email" ? "Register with Email" : "Register with Phone"}
      >
        <form
          action={formAction}
          noValidate
          onFocusCapture={onFormActivity}
          onChangeCapture={onFormActivity}
          onSubmit={(e) => {
            const form = e.currentTarget;
            const consentEl = form.elements.namedItem("privacy_consent") as HTMLInputElement;
            const errors: Record<string, string> = {};

            const id =
              activeTab === "email" ? validateEmail(identifier) : validateBdPhone(identifier);
            if (!id.ok) {
              errors.identifier = id.error;
              if (activeTab === "phone" && identifier.trim()) {
                phoneBlurredRef.current = true;
              }
            }
            const pw = validatePassword(password);
            if (!pw.ok) errors.password = pw.error;
            const match = validatePasswordMatch(password, confirm);
            if (!match.ok) errors.confirmPassword = match.error;
            if (!consentEl.checked) errors.consent = "You must agree to the privacy policy to continue.";

            if (Object.keys(errors).length) {
              e.preventDefault();
              setClientErrors(errors);
              return;
            }
            setClientErrors({});
            if (id.ok) {
              if (activeTab === "email") {
                const emailEl = form.elements.namedItem("identifier") as HTMLInputElement | null;
                if (emailEl) emailEl.value = id.value;
              }
              saveVerificationDraft({
                channel: activeTab,
                identifier: id.value,
                context: "registration",
              });
            }
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="type" value={activeTab} />

          {activeTab === "email" ? (
            <Input
              key="email"
              id="identifier"
              name="identifier"
              variant="email"
              label="Email"
              required
              readOnly={isPending}
              value={identifier}
              error={identifierError}
              onChange={(e) => {
                const v = e.target.value;
                setIdentifier(v);
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
              id="identifier"
              name="identifier"
              variant="phone_bd"
              label="Phone Number"
              required
              readOnly={isPending}
              value={identifier}
              error={identifierError}
              onChange={(e) => {
                const v = e.target.value;
                setIdentifier(v);
                dismissServerField("identifier");
                const check = validateBdPhoneOnChange(v, phoneBlurredRef.current);
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

          <div className="flex flex-col gap-2">
            <Input
              id="password"
              name="password"
              variant="password"
              label="Password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={PASSWORD_MAX}
              readOnly={isPending}
              value={password}
              error={passwordError}
              onChange={(e) => {
                const v = e.target.value;
                setPassword(v);
                dismissServerField("password");
                const pw = validatePasswordLive(v);
                setFieldError("password", pw.ok ? undefined : pw.error);
                if (!confirm || validatePasswordMatch(v, confirm).ok) {
                  setFieldError("confirmPassword", undefined);
                }
              }}
              onBlur={(e) => {
                if (!e.target.value) return;
                const pw = validatePassword(e.target.value);
                setFieldError("password", pw.ok ? undefined : pw.error);
              }}
              placeholder="••••••••"
            />
            <p aria-live="polite" className="text-caption text-text-secondary">
              Use 8–128 characters; longer with mixed case, numbers and symbols is stronger.
              {password && (
                <>
                  {" "}
                  Strength: <strong className="text-text-primary">{strength.label}</strong> ({strength.score}/4)
                </>
              )}
            </p>
          </div>

          <Input
            id="confirmPassword"
            name="confirmPassword"
            variant="password"
            label="Confirm Password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={PASSWORD_MAX}
            readOnly={isPending}
            value={confirm}
            error={confirmError}
            onChange={(e) => {
              setConfirm(e.target.value);
              dismissServerField("confirmPassword");
              setFieldError("confirmPassword", undefined);
            }}
            placeholder="••••••••"
          />

          <Checkbox
            id="privacy_consent"
            name="privacy_consent"
            label="I agree to the privacy policy"
            required
            readOnly={isPending}
            error={clientErrors.consent}
            onChange={() => setFieldError("consent", undefined)}
          />

          <AuthAlert
            result={visibleAlertState}
            action={conflict ? { label: "Sign in instead", href: "/login" } : undefined}
          />

          <Button type="submit" size="lg" fullWidth isLoading={isPending} loadingText="Creating account…">
            Create Account
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
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
