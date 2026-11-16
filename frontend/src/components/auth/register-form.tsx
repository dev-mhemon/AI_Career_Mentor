"use client";

import { useActionState, useState, useEffect } from "react";
import Link from "next/link";
import { registerAction, type AuthActionResult } from "@/lib/auth/actions";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import {
  AuthAlert,
  focusFirstInvalidControl,
  useDismissedActionState,
} from "@/components/auth/auth-alert";
import { PasswordStrengthHint } from "@/components/auth/password-strength-hint";
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
  validateBdPhone,
  validateEmail,
  validatePassword,
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
  const [emailValue, setEmailValue] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const identifier = activeTab === "email" ? emailValue : phoneValue;
  const setIdentifier = (value: string) => {
    if (activeTab === "email") {
      setEmailValue(value);
    } else {
      setPhoneValue(value);
    }
  };
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

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

  const identifierError = clientErrors.identifier ?? serverFieldError("identifier");
  const passwordError = clientErrors.password ?? serverFieldError("password");
  const confirmError =
    clientErrors.confirmPassword ?? serverFieldError("confirmPassword");
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
          setClientErrors({});
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
            }
            const pw = validatePassword(password);
            if (!pw.ok) errors.password = pw.error;
            const match = validatePasswordMatch(password, confirm);
            if (!match.ok) errors.confirmPassword = match.error;
            if (!acceptedPrivacyPolicy && !consentEl?.checked) {
              errors.consent = "You must agree to the privacy policy to continue.";
            }

            if (Object.keys(errors).length) {
              e.preventDefault();
              setClientErrors(errors);
              focusFirstInvalidControl(form);
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
                setIdentifier(e.target.value);
                dismissServerField("identifier");
                setFieldError("identifier", undefined);
              }}
              placeholder="Enter your email"
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
                setIdentifier(e.target.value);
                dismissServerField("identifier");
                setFieldError("identifier", undefined);
              }}
              hint="Bangladesh mobile, e.g. 01XXXXXXXXX"
              placeholder="01XXXXXXXXX"
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
                setFieldError("password", undefined);
                if (confirm && validatePasswordMatch(v, confirm).ok) {
                  setFieldError("confirmPassword", undefined);
                }
              }}
              placeholder="Password"
            />
            <PasswordStrengthHint password={password} />
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
            placeholder="Confirm password"
          />

          <Checkbox
            id="privacy_consent"
            name="privacy_consent"
            label="I agree to the privacy policy"
            required
            checked={acceptedPrivacyPolicy}
            readOnly={isPending}
            error={clientErrors.consent}
            onChange={(checked) => {
              setAcceptedPrivacyPolicy(checked);
              setFieldError("consent", undefined);
            }}
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
