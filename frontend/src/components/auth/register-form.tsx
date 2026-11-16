"use client";

import { useActionState, useState, useEffect, useRef } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [activeTab, setActiveTab] = useState<Channel>("email");
  const [submittedChannel, setSubmittedChannel] = useState<Channel | null>(
    null,
  );
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
  const [emailError, setEmailError] = useState<string | undefined>();
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(async (prevState, formData) => {
    const channel: Channel =
      formData.get("type") === "phone" ? "phone" : "email";
    const result = await registerAction(prevState, formData);
    const emailFromResult =
      result?.fieldErrors?.email ??
      (channel === "email"
        ? (result?.fieldErrors?.identifier ??
          (result?.code === "CONTACT_ALREADY_REGISTERED"
            ? "This email is already registered."
            : undefined))
        : undefined);
    const phoneFromResult =
      result?.fieldErrors?.phone ??
      (channel === "phone"
        ? (result?.fieldErrors?.identifier ??
          (result?.code === "CONTACT_ALREADY_REGISTERED"
            ? "This phone number is already registered."
            : undefined))
        : undefined);

    if (channel === "email") {
      setEmailError(emailFromResult);
      if (phoneFromResult !== undefined) {
        setPhoneError(phoneFromResult);
      }
    } else {
      setPhoneError(phoneFromResult);
      if (emailFromResult !== undefined) {
        setEmailError(emailFromResult);
      }
    }
    return result;
  }, {});

  useEffect(() => {
    if (state?.error || state?.fieldErrors) {
      clearVerificationDraft();
    }
    const form = formRef.current;
    if (!form) return;
    const hasContactFieldError = Boolean(
      state?.fieldErrors?.identifier ||
        state?.fieldErrors?.email ||
        state?.fieldErrors?.phone ||
        state?.code === "CONTACT_ALREADY_REGISTERED",
    );
    const hasAnyServerFieldError =
      hasContactFieldError ||
      Boolean(state?.fieldErrors && Object.keys(state.fieldErrors).length > 0);
    if (!hasAnyServerFieldError) return;
    const target = hasContactFieldError
      ? form.querySelector<HTMLElement>("#identifier")
      : form.querySelector<HTMLElement>(
          'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"], [data-invalid="true"]',
        );
    if (!target) return;
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
    target.focus();
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

  const handleContactChange = (channel: Channel, value: string) => {
    setIdentifier(value);
    if (channel === "email") {
      setEmailError(undefined);
    } else {
      setPhoneError(undefined);
    }
  };

  const identifierError = activeTab === "phone" ? phoneError : emailError;
  const passwordError = clientErrors.password ?? serverFieldError("password");
  const confirmError =
    clientErrors.confirmPassword ?? serverFieldError("confirmPassword");
  const {
    visibleState: visibleAlertState,
    dismiss: dismissAlert,
    onFormActivity,
  } = useDismissedActionState(state);
  const conflict = visibleAlertState?.status === 409;
  const isDuplicateContactConflict =
    state?.code === "CONTACT_ALREADY_REGISTERED";
  const stateMatchesActiveChannel =
    (submittedChannel ?? activeTab) === activeTab;
  const suppressBottomAlert =
    isDuplicateContactConflict ||
    Boolean(
      stateMatchesActiveChannel &&
        (state?.fieldErrors?.identifier || state?.fieldErrors?.[activeTab]),
    );

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
          ref={formRef}
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
            const pw = validatePassword(password);
            if (!pw.ok) errors.password = pw.error;
            const match = validatePasswordMatch(password, confirm);
            if (!match.ok) errors.confirmPassword = match.error;
            if (!acceptedPrivacyPolicy && !consentEl?.checked) {
              errors.consent = "You must agree to the privacy policy to continue.";
            }

            if (!id.ok || Object.keys(errors).length) {
              e.preventDefault();
              if (activeTab === "email") {
                setEmailError(id.ok ? undefined : id.error);
              } else {
                setPhoneError(id.ok ? undefined : id.error);
              }
              setClientErrors(errors);
              if (!id.ok) {
                form.querySelector<HTMLElement>("#identifier")?.focus();
              } else {
                focusFirstInvalidControl(form);
              }
              return;
            }
            if (activeTab === "email") {
              setEmailError(undefined);
            } else {
              setPhoneError(undefined);
            }
            setClientErrors({});
            setSubmittedChannel(activeTab);
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
              onChange={(e) => handleContactChange("email", e.target.value)}
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
              onChange={(e) => handleContactChange("phone", e.target.value)}
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
            result={suppressBottomAlert ? null : visibleAlertState}
            action={
              conflict && !suppressBottomAlert
                ? { label: "Sign in instead", href: "/login" }
                : undefined
            }
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
