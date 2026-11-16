"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { forgotPasswordAction, type AuthActionResult } from "@/lib/auth/actions";
import {
  AuthAlert,
  focusFirstInvalidControl,
  isCooldownWaitResult,
  useDismissedActionState,
} from "@/components/auth/auth-alert";
import { formatCountdown } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import {
  saveVerificationDraft,
  loadVerificationDraft,
  clearVerificationDraft,
  setPersistedCooldown,
  MAX_COOLDOWN_DURATION_SECONDS,
  type VerificationChannel,
  type VerificationDraft,
} from "@/lib/auth/verification-draft";
import { useResendCooldown } from "@/lib/auth/use-resend-cooldown";
import {
  validateBdPhone,
  validateEmail,
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
  const normalizedCandidate = (() => {
    if (!identifier.trim()) return null;
    const check =
      channel === "email"
        ? validateEmail(identifier)
        : validateBdPhone(identifier);
    return check.ok ? check.value : null;
  })();

  const {
    cooldown,
    isCooldownHydrated,
    startCooldown,
    clearCooldown,
  } = useResendCooldown({
    channel,
    identifier: normalizedCandidate,
  });
  const cooldownActionsRef = useRef({ startCooldown, clearCooldown });
  useEffect(() => {
    cooldownActionsRef.current = { startCooldown, clearCooldown };
  }, [startCooldown, clearCooldown]);

  const previousDraftRef = useRef<VerificationDraft | null>(null);
  const submittedCooldownTargetRef = useRef<{
    channel: VerificationChannel;
    identifier: string;
  } | null>(null);

  useEffect(() => {
    if (state?.error) {
      const target = submittedCooldownTargetRef.current;
      const isCooldown = isCooldownWaitResult(state);
      if (isCooldown) {
        const secs = Math.min(
          typeof state.retryAfterSeconds === "number" &&
            state.retryAfterSeconds > 0
            ? state.retryAfterSeconds
            : 60,
          MAX_COOLDOWN_DURATION_SECONDS,
        );
        cooldownActionsRef.current.startCooldown(
          secs,
          undefined,
          target?.identifier,
        );
      } else if (target) {
        cooldownActionsRef.current.clearCooldown(target.identifier);
      }
      submittedCooldownTargetRef.current = null;
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
            if (cooldown > 0) {
              e.preventDefault();
              return;
            }
            const form = e.currentTarget;
            const check =
              channel === "email" ? validateEmail(identifier) : validateBdPhone(identifier);
            if (!check.ok) {
              e.preventDefault();
              setClientError(check.error);
              focusFirstInvalidControl(form);
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
              label="Email"
              required
              readOnly={isPending}
              value={identifier}
              error={
                clientError ??
                (isDismissed ? undefined : state?.fieldErrors?.identifier)
              }
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (state?.fieldErrors?.identifier) dismissAlert();
                setClientError(undefined);
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
              error={
                clientError ??
                (isDismissed ? undefined : state?.fieldErrors?.identifier)
              }
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (state?.fieldErrors?.identifier) dismissAlert();
                setClientError(undefined);
              }}
              placeholder="01XXXXXXXXX"
            />
          )}

          <AuthAlert
            result={
              isCooldownWaitResult(visibleAlertState) ? null : visibleAlertState
            }
          />

          <Button
            type="submit"
            size="lg"
            fullWidth
            isLoading={isPending}
            loadingText="Sending code…"
            disabled={cooldown > 0 || isPending}
          >
            Send Reset Code
          </Button>
          {cooldown > 0 && (
            <p
              className="text-center text-body-sm text-text-secondary tabular-nums"
              aria-live="off"
              data-testid="forgot-password-cooldown"
            >
              Resend available in{" "}
              <span className="font-mono font-medium">
                {formatCountdown(cooldown)}
              </span>
            </p>
          )}
          <div
            role="region"
            aria-live="polite"
            aria-label="Reset code cooldown status"
            className="sr-only"
          >
            {isCooldownHydrated && cooldown > 0
              ? "Reset code cooldown started. You must wait until the timer finishes before requesting a new code."
              : isCooldownHydrated && cooldown === 0
                ? "You can now request a password reset code."
                : ""}
          </div>
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
