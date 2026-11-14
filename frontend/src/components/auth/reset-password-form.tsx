"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { resetPasswordAction, type AuthActionResult } from "@/lib/auth/actions";
import { AuthAlert } from "@/components/auth/auth-alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  loadVerificationDraft,
  clearVerificationDraft,
  type VerificationDraft,
} from "@/lib/auth/verification-draft";
import {
  PASSWORD_MAX,
  passwordStrength,
  validateIdentifier,
  validateIdentifierOnChange,
  validateOtp,
  validateOtpLive,
  validatePassword,
  validatePasswordLive,
  validatePasswordMatch,
} from "@/lib/validation/auth-schemas";

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
  const identifierBlurredRef = useRef(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

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

  useEffect(() => {
    if (state?.success) {
      if (draft?.context === "password_recovery") {
        clearVerificationDraft();
      }
    }
  }, [state, draft]);

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

  return (
    <div className="flex flex-col gap-6">
      {draft?.contact_masked ? (
        <Alert variant="info">
          Reset code sent to: <span className="font-semibold">{draft.contact_masked}</span>
        </Alert>
      ) : isDraftExpired ? (
        <Alert variant="warning">
          Recovery session expired. Please re-enter your email or phone below.
        </Alert>
      ) : null}

      <form
        action={formAction}
        noValidate
        onSubmit={(e) => {
          const form = e.currentTarget;
          const errors: Record<string, string> = {};
          const idEl = form.elements.namedItem("identifier") as HTMLInputElement | null;
          if (idEl && idEl.type !== "hidden") {
            const id = validateIdentifier(idEl.value);
            if (!id.ok) {
              errors.identifier = id.error;
              if (idEl.value.trim()) identifierBlurredRef.current = true;
            } else {
              idEl.value = id.value.value;
            }
          }
          const code = validateOtp(
            (form.elements.namedItem("code") as HTMLInputElement).value,
          );
          if (!code.ok) errors.code = code.error;
          const pw = validatePassword(password);
          if (!pw.ok) errors.new_password = pw.error;
          const match = validatePasswordMatch(password, confirm);
          if (!match.ok) errors.confirm_new_password = match.error;
          if (Object.keys(errors).length) {
            e.preventDefault();
            setClientErrors(errors);
            return;
          }
          setClientErrors({});
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
          <Input
            id="identifier"
            name="identifier"
            label="Email or Phone"
            required
            readOnly={isPending}
            error={clientErrors.identifier ?? serverFieldError("identifier")}
            onChange={(e) => {
              dismissServerField("identifier");
              const check = validateIdentifierOnChange(
                e.target.value,
                identifierBlurredRef.current,
              );
              if (check.resetBlurred) identifierBlurredRef.current = false;
              setFieldError("identifier", check.error);
            }}
            onBlur={(e) => {
              if (!e.target.value.trim()) {
                identifierBlurredRef.current = false;
                return;
              }
              identifierBlurredRef.current = true;
              const res = validateIdentifier(e.target.value);
              if (!res.ok) setFieldError("identifier", res.error);
              else {
                if (res.value.kind === "email") e.target.value = res.value.value;
                setFieldError("identifier", undefined);
              }
            }}
            placeholder="you@example.com or +8801712345678"
          />
        )}

        <Input
          id="code"
          name="code"
          variant="otp_6"
          label="6-Digit Verification Code"
          required
          readOnly={isPending}
          error={clientErrors.code ?? serverFieldError("code")}
          onChange={(e) => {
            dismissServerField("code");
            const res = validateOtpLive(e.target.value);
            setFieldError("code", res.ok ? undefined : res.error);
          }}
          onBlur={(e) => {
            if (!e.target.value.trim()) return;
            const res = validateOtp(e.target.value);
            setFieldError("code", res.ok ? undefined : res.error);
          }}
        />

        <div className="flex flex-col gap-2">
          <Input
            id="new_password"
            name="new_password"
            variant="password"
            label="New Password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={PASSWORD_MAX}
            readOnly={isPending}
            value={password}
            error={clientErrors.new_password ?? serverFieldError("new_password")}
            onChange={(e) => {
              const v = e.target.value;
              setPassword(v);
              dismissServerField("new_password");
              const pw = validatePasswordLive(v);
              setFieldError("new_password", pw.ok ? undefined : pw.error);
              if (!confirm || validatePasswordMatch(v, confirm).ok) {
                setFieldError("confirm_new_password", undefined);
              }
            }}
            onBlur={(e) => {
              if (!e.target.value) return;
              const pw = validatePassword(e.target.value);
              setFieldError("new_password", pw.ok ? undefined : pw.error);
            }}
            placeholder="At least 8 characters"
          />
          {password && (
            <p aria-live="polite" className="text-caption text-text-secondary">
              Strength: <strong className="text-text-primary">{strength.label}</strong> ({strength.score}/4)
            </p>
          )}
        </div>

        <Input
          id="confirm_new_password"
          name="confirm_new_password"
          variant="password"
          label="Confirm New Password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={PASSWORD_MAX}
          readOnly={isPending}
          value={confirm}
          error={
            clientErrors.confirm_new_password ??
            serverFieldError("confirm_new_password") ??
            mismatch
          }
          onChange={(e) => {
            setConfirm(e.target.value);
            dismissServerField("confirm_new_password");
            setFieldError("confirm_new_password", undefined);
          }}
          placeholder="Repeat new password"
        />

        <AuthAlert result={state} />

        <Button type="submit" size="lg" fullWidth isLoading={isPending} loadingText="Resetting password…">
          Set New Password
        </Button>
      </form>

      <div className="flex flex-col items-center gap-1 text-body-sm text-text-secondary">
        <p>
          Didn&apos;t receive a code?{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
          >
            Request a new code
          </Link>
        </p>
        <p>
          Remember your password?{" "}
          <Link
            href="/login"
            className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
