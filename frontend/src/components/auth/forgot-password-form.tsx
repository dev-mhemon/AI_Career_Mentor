"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { forgotPasswordAction, type AuthActionResult } from "@/lib/auth/actions";
import { AuthAlert, useDismissedActionState } from "@/components/auth/auth-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  saveVerificationDraft,
  loadVerificationDraft,
  clearVerificationDraft,
  setPersistedCooldown,
  clearPersistedCooldown,
  MAX_COOLDOWN_DURATION_SECONDS,
  type VerificationChannel,
  type VerificationDraft,
} from "@/lib/auth/verification-draft";
import {
  validateBdPhone,
  validateBdPhoneOnChange,
  validateEmail,
  validateEmailLive,
} from "@/lib/validation/auth-schemas";

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
  const [identifier, setIdentifier] = useState("");
  const [clientError, setClientError] = useState<string | undefined>();
  const {
    visibleState: visibleAlertState,
    isDismissed,
    dismiss: dismissAlert,
    onFormActivity,
  } = useDismissedActionState(state);
  const previousDraftRef = useRef<VerificationDraft | null>(null);
  const submittedCooldownTargetRef = useRef<{
    channel: VerificationChannel;
    identifier: string;
  } | null>(null);
  const phoneBlurredRef = useRef(false);

  useEffect(() => {
    if (state?.error) {
      const target = submittedCooldownTargetRef.current;
      if (target) {
        if (typeof state.retryAfterSeconds === "number" && state.retryAfterSeconds > 0) {
          const secs = Math.min(state.retryAfterSeconds, MAX_COOLDOWN_DURATION_SECONDS);
          const now = Date.now();
          setPersistedCooldown(
            target.channel,
            now + secs * 1000,
            secs,
            now,
            target.identifier,
          );
        } else {
          clearPersistedCooldown(target.channel, target.identifier);
        }
        submittedCooldownTargetRef.current = null;
      }
      if (previousDraftRef.current) {
        const originalExpiresAtMs = new Date(
          previousDraftRef.current.expires_at,
        ).getTime();
        if (!Number.isFinite(originalExpiresAtMs) || originalExpiresAtMs <= Date.now()) {
          clearVerificationDraft();
          previousDraftRef.current = null;
          return;
        }
        const remainingSeconds = Math.max(
          1,
          Math.floor((originalExpiresAtMs - Date.now()) / 1000),
        );
        saveVerificationDraft({
          channel: previousDraftRef.current.channel,
          identifier: previousDraftRef.current.normalized_identifier,
          contactMasked: previousDraftRef.current.contact_masked,
          expiresInSeconds: remainingSeconds,
          context: previousDraftRef.current.context,
        });
        previousDraftRef.current = null;
      } else {
        const { draft: loaded } = loadVerificationDraft(
          null,
          Date.now(),
          "password_recovery",
        );
        if (loaded?.context === "password_recovery") {
          clearVerificationDraft();
        }
      }
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        aria-label="Recovery method"
        variant="segmented_pill"
        idPrefix="forgot"
        hidePanels
        disabled={isPending}
        value={channel}
        onValueChange={(id) => {
          setChannel(id as VerificationChannel);
          setIdentifier("");
          setClientError(undefined);
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
        id="forgot-panel"
        aria-label={channel === "email" ? "Recover via Email" : "Recover via Phone"}
      >
        <form
          action={formAction}
          noValidate
          onFocusCapture={onFormActivity}
          onChangeCapture={onFormActivity}
          onSubmit={(e) => {
            const form = e.currentTarget;
            const check =
              channel === "email" ? validateEmail(identifier) : validateBdPhone(identifier);
            if (!check.ok) {
              e.preventDefault();
              if (channel === "phone" && identifier.trim()) {
                phoneBlurredRef.current = true;
              }
              setClientError(check.error);
              return;
            }
            const normalized = check.value;
            setClientError(undefined);
            if (channel === "email") {
              const el = form.elements.namedItem("identifier") as HTMLInputElement | null;
              if (el) el.value = normalized;
            }
            const { draft: existing } = loadVerificationDraft(null, Date.now());
            if (existing) {
              previousDraftRef.current = existing;
            }
            saveVerificationDraft({
              channel,
              identifier: normalized,
              context: "password_recovery",
            });
            submittedCooldownTargetRef.current = { channel, identifier: normalized };
            const nowMs = Date.now();
            setPersistedCooldown(channel, nowMs + 60 * 1000, 60, nowMs, normalized);
          }}
          className="flex flex-col gap-4"
        >
          {channel === "email" ? (
            <Input
              key="email"
              id="identifier"
              name="identifier"
              variant="email"
              label="Registered Email"
              required
              readOnly={isPending}
              value={identifier}
              error={
                clientError ??
                (isDismissed ? undefined : state?.fieldErrors?.identifier)
              }
              onChange={(e) => {
                const v = e.target.value;
                setIdentifier(v);
                if (state?.fieldErrors?.identifier) dismissAlert();
                const res = validateEmailLive(v);
                setClientError(res.ok ? undefined : res.error);
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) return;
                const res = validateEmail(e.target.value);
                if (!res.ok) setClientError(res.error);
                else {
                  setIdentifier(res.value);
                  setClientError(undefined);
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
              label="Registered Phone Number"
              required
              readOnly={isPending}
              value={identifier}
              error={
                clientError ??
                (isDismissed ? undefined : state?.fieldErrors?.identifier)
              }
              onChange={(e) => {
                const v = e.target.value;
                setIdentifier(v);
                if (state?.fieldErrors?.identifier) dismissAlert();
                const check = validateBdPhoneOnChange(v, phoneBlurredRef.current);
                if (check.resetBlurred) phoneBlurredRef.current = false;
                setClientError(check.error);
              }}
              onBlur={(e) => {
                if (!e.target.value.trim()) {
                  phoneBlurredRef.current = false;
                  return;
                }
                phoneBlurredRef.current = true;
                const res = validateBdPhone(e.target.value);
                setClientError(res.ok ? undefined : res.error);
              }}
              placeholder="01712-345678"
            />
          )}

          <AuthAlert result={visibleAlertState} />

          <Button type="submit" size="lg" fullWidth isLoading={isPending} loadingText="Sending code…">
            Send Reset Code
          </Button>
        </form>
      </div>

      <p className="text-center text-body-sm text-text-secondary">
        Remember your password?{" "}
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
