"use client";

import {
  memo,
  type ChangeEvent,
  type SyntheticEvent,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  resetPasswordAction,
  forgotPasswordAction,
  type AuthActionResult,
} from "@/lib/auth/actions";
import {
  AuthAlert,
  isCooldownWaitResult,
  useDismissedActionState,
} from "@/components/auth/auth-alert";
import { PasswordStrengthHint } from "@/components/auth/password-strength-hint";
import { Alert, formatCountdown } from "@/components/ui/alert";
import { Toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ClockIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import type { ActionErrorLike } from "@/lib/api/error-mapper";
import {
  getRawVerificationDraft,
  loadVerificationDraft,
  clearVerificationDraft,
  updateVerificationDraftExpiry,
  saveVerificationDraft,
  MAX_VERIFICATION_DRAFT_TTL_SECONDS,
  type VerificationChannel,
  type VerificationDraft,
} from "@/lib/auth/verification-draft";
import { useResendCooldown } from "@/lib/auth/use-resend-cooldown";
import {
  PASSWORD_MAX,
  validateOtp,
  validatePassword,
  validatePasswordMatch,
} from "@/lib/validation/auth-schemas";

const MemoizedInput = memo(Input);

type ResetSessionStatus = "checking" | "active" | "expired";

interface ResetSessionState {
  status: "active" | "expired";
  draft: VerificationDraft | null;
}

const subscribeNoop = () => () => {};
const getClientTrue = () => true;
const getServerFalse = () => false;

const ALLOWED_RECOVERY_DRAFT_KEYS = new Set([
  "channel",
  "normalized_identifier",
  "contact_masked",
  "expires_at",
  "context",
]);

/**
 * Pure, read-only snapshot of any existing `password_recovery` draft in `sessionStorage`.
 * Never mutates storage so React 19 StrictMode double-initialization stays idempotent;
 * storage cleanup of expired/malformed drafts runs in a mount effect without calling setState.
 */
function readInitialResetSession(): ResetSessionState {
  if (typeof window === "undefined") {
    return { status: "expired", draft: null };
  }
  const raw = getRawVerificationDraft();
  if (!raw) {
    return { status: "expired", draft: null };
  }
  const keys = Object.keys(raw);
  if (
    keys.length !== ALLOWED_RECOVERY_DRAFT_KEYS.size ||
    keys.some((key) => !ALLOWED_RECOVERY_DRAFT_KEYS.has(key)) ||
    typeof raw.contact_masked !== "string" ||
    !raw.contact_masked.trim() ||
    typeof raw.expires_at !== "string" ||
    raw.context !== "password_recovery"
  ) {
    return { status: "expired", draft: null };
  }

  const nowMs = Date.now();
  const expiresAtMs = Date.parse(raw.expires_at);
  const isExpired =
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= nowMs ||
    expiresAtMs - nowMs > MAX_VERIFICATION_DRAFT_TTL_SECONDS * 1000;

  if (isExpired) {
    return { status: "expired", draft: null };
  }

  return {
    status: "active",
    draft: raw,
  };
}

/**
 * Screen 06: Password Reset Form component.
 * Clean 3-state session flow (`checking` -> `active` | `expired`):
 * - `checking`: compact skeleton preventing SSR/hydration flicker on refresh.
 * - `active`: masked contact banner + controlled 6-digit OTP + new/confirm password (EP-A09).
 * - `expired`: focused recovery-expired / code-required view with primary CTA to `/forgot-password`.
 */
export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    AuthActionResult,
    FormData
  >(resetPasswordAction, {});

  const isClient = useSyncExternalStore(
    subscribeNoop,
    getClientTrue,
    getServerFalse,
  );
  const [session, setSession] = useState<ResetSessionState>(
    readInitialResetSession,
  );
  const sessionStatus: ResetSessionStatus = isClient
    ? session.status
    : "checking";
  const draft = isClient ? session.draft : null;
  const [expiredDuringSubmit, setExpiredDuringSubmit] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [resendError, setResendError] = useState<ActionErrorLike | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const { visibleState: visibleAlertState, onFormActivity } =
    useDismissedActionState(state);
  const [dismissedServer, setDismissedServer] = useState<{
    ref: AuthActionResult;
    fields: Set<string>;
  } | null>(null);

  const stateRef = useRef(state);
  const isPendingRef = useRef(isPending);
  const resendErrorRef = useRef(resendError);
  const confirmRef = useRef(confirm);
  const handledSuccessStateRef = useRef<AuthActionResult | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    isPendingRef.current = isPending;
  }, [isPending]);
  useEffect(() => {
    resendErrorRef.current = resendError;
  }, [resendError]);
  useEffect(() => {
    confirmRef.current = confirm;
  }, [confirm]);

  const handleFormActivity = useCallback(
    (e: SyntheticEvent<HTMLFormElement>) => {
      onFormActivity(e);
      if (
        resendErrorRef.current &&
        (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement)
      ) {
        setResendError(null);
      }
    },
    [onFormActivity],
  );

  const resolvedContact = useMemo(() => {
    if (!draft?.normalized_identifier) return null;
    return {
      channel: draft.channel as VerificationChannel,
      identifier: draft.normalized_identifier,
    };
  }, [draft]);

  const activeContactKey = resolvedContact
    ? `${resolvedContact.channel}:${resolvedContact.identifier}`
    : null;
  const activeContactRef = useRef<string | null>(activeContactKey);
  useEffect(() => {
    activeContactRef.current = activeContactKey;
  }, [activeContactKey]);

  const {
    cooldown,
    isCooldownHydrated,
    startCooldown,
    clearCooldown,
  } = useResendCooldown({
    channel: resolvedContact?.channel ?? null,
    identifier: resolvedContact?.identifier ?? null,
  });

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Clean up any expired or malformed draft entries in sessionStorage on mount without calling setState.
  useEffect(() => {
    loadVerificationDraft(null, Date.now(), "password_recovery");
  }, []);

  // Transition cleanly to `'expired'` if the active session expires while the user is on the page.
  // If a reset submission is currently in flight, keep the form mounted so the action result
  // (e.g. password policy error or partial-completion notice) remains visible, while blocking new submits.
  useEffect(() => {
    if (sessionStatus !== "active" || !draft?.expires_at || state?.success) {
      return;
    }
    const expiresMs = Date.parse(draft.expires_at);
    if (!Number.isFinite(expiresMs)) return;

    const expireNow = () => {
      clearVerificationDraft();
      if (isPendingRef.current) {
        setExpiredDuringSubmit(true);
        return;
      }
      setSession({ status: "expired", draft: null });
    };

    const remainingMs = Math.max(0, expiresMs - Date.now());
    const timer = setTimeout(expireNow, remainingMs);
    return () => clearTimeout(timer);
  }, [sessionStatus, draft?.expires_at, state?.success]);

  useEffect(() => {
    if (state?.success && handledSuccessStateRef.current !== state) {
      handledSuccessStateRef.current = state;
      clearCooldown(draft?.normalized_identifier ?? resolvedContact?.identifier);
      if (draft?.context === "password_recovery") {
        clearVerificationDraft();
      }
    }
  }, [state, draft, clearCooldown, resolvedContact?.identifier]);

  const setFieldError = useCallback(
    (field: string, error?: string) =>
      setClientErrors((prev) => {
        if (!error) {
          if (!prev[field]) return prev;
          const next = { ...prev };
          delete next[field];
          return next;
        }
        if (prev[field] === error) return prev;
        return { ...prev, [field]: error };
      }),
    [],
  );

  const dismissServerField = useCallback(
    (field: string) =>
      setDismissedServer((prev) => {
        const currentState = stateRef.current;
        if (!currentState?.fieldErrors?.[field]) return prev;
        if (prev?.ref === currentState && prev.fields.has(field)) return prev;
        const fields = new Set(
          prev?.ref === currentState ? prev.fields : [],
        );
        fields.add(field);
        return { ref: currentState, fields };
      }),
    [],
  );

  const handleResend = useCallback(async () => {
    if (!resolvedContact || cooldown > 0 || isResending || isPending) return;

    const requestContact = resolvedContact;
    const requestContactMasked = draft?.contact_masked;
    const requestKey = `${requestContact.channel}:${requestContact.identifier}`;

    setIsResending(true);
    setResendError(null);
    setResendSuccess(null);

    try {
      const formData = new FormData();
      formData.set("identifier", requestContact.identifier);
      formData.set("mode", "resend");
      const result = await forgotPasswordAction({}, formData);

      // Discard if user left the flow or switched to a different active contact.
      // Allow null activeContactRef (old draft expired while resend was in flight) to renew on success.
      if (!isMountedRef.current) {
        return;
      }
      const currentContactKey = activeContactRef.current;
      if (currentContactKey !== null && currentContactKey !== requestKey) {
        return;
      }

      if (result?.error) {
        // If the old draft already expired while resend failed, stay in `'expired'` state.
        if (currentContactKey === null) {
          return;
        }
        if (isCooldownWaitResult(result)) {
          setResendError(null);
          startCooldown(
            typeof result.retryAfterSeconds === "number" &&
              result.retryAfterSeconds > 0
              ? result.retryAfterSeconds
              : 60,
            undefined,
            requestContact.identifier,
          );
        } else {
          setResendError(result);
          if (
            typeof result.retryAfterSeconds === "number" &&
            result.retryAfterSeconds > 0
          ) {
            startCooldown(
              result.retryAfterSeconds,
              undefined,
              requestContact.identifier,
            );
          }
        }
      } else {
        setCode("");
        setFieldError("code", undefined);
        dismissServerField("code");
        setResendSuccess("Verification code sent.");
        startCooldown(60, undefined, requestContact.identifier);
        const candidate = updateVerificationDraftExpiry(
          600,
          requestContactMasked,
          Date.now(),
          requestContact.channel,
          requestContact.identifier,
        );
        const updated =
          candidate?.context === "password_recovery"
            ? candidate
            : saveVerificationDraft({
                channel: requestContact.channel,
                identifier: requestContact.identifier,
                contactMasked: requestContactMasked,
                context: "password_recovery",
              });
        if (updated) {
          setExpiredDuringSubmit(false);
          setSession({ status: "active", draft: updated });
        }
      }
    } catch {
      if (isMountedRef.current && activeContactRef.current === requestKey) {
        setResendError({
          error: "Failed to resend verification code. Please try again.",
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsResending(false);
      }
    }
  }, [
    cooldown,
    dismissServerField,
    draft,
    isPending,
    isResending,
    resolvedContact,
    setFieldError,
    startCooldown,
  ]);

  const handleDismissResendSuccess = useCallback(() => {
    setResendSuccess(null);
  }, []);

  const handleCodeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setCode(e.target.value);
      dismissServerField("code");
      setFieldError("code", undefined);
    },
    [dismissServerField, setFieldError],
  );

  const handlePasswordChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value;
      setPassword(v);
      dismissServerField("new_password");
      setFieldError("new_password", undefined);
      const currentConfirm = confirmRef.current;
      if (currentConfirm && validatePasswordMatch(v, currentConfirm).ok) {
        setFieldError("confirm_new_password", undefined);
      }
    },
    [dismissServerField, setFieldError],
  );

  const handleConfirmChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setConfirm(e.target.value);
      dismissServerField("confirm_new_password");
      setFieldError("confirm_new_password", undefined);
    },
    [dismissServerField, setFieldError],
  );

  const resendAlertResult = useMemo(
    () =>
      resendError ? { ...resendError, retryAfterSeconds: undefined } : null,
    [resendError],
  );

  const serverFieldError = (field: string) =>
    dismissedServer?.ref === state && dismissedServer.fields.has(field)
      ? undefined
      : state?.fieldErrors?.[field];

  const isChecking = sessionStatus === "checking";

  if (!isChecking && (sessionStatus === "expired" || !draft?.normalized_identifier)) {
    return (
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200/80 bg-amber-50 text-amber-600 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-400">
          <ClockIcon className="h-6 w-6" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-heading-lg text-text-primary">
            Reset session expired
          </h1>
          <p className="text-body-sm leading-relaxed text-text-secondary">
            Request a new verification code to continue.
          </p>
        </div>

        <Link
          href="/forgot-password"
          className="inline-flex h-12 w-full items-center justify-center rounded-md bg-action-primary-background px-6 text-label-lg leading-none font-medium text-action-primary-foreground transition-colors duration-(--duration-fast) ease-standard hover:bg-action-primary-background-hover active:bg-action-primary-background-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Request a new code
        </Link>

        <p className="text-body-sm text-text-secondary">
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-heading-lg text-text-primary">Set New Password</h1>
        <p className="text-body-sm text-text-secondary">
          Enter the 6-digit verification code you received and choose a new
          password.
        </p>
      </div>

      {isChecking ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Checking reset session"
          className="flex items-center gap-3 rounded-lg border border-transparent bg-slate-100 p-4 animate-pulse dark:bg-surface-subtle"
        >
          <span className="h-5 w-5 shrink-0 rounded-full bg-slate-200/80 dark:bg-surface-muted" />
          <span className="h-5 w-48 rounded bg-slate-200/80 dark:bg-surface-muted" />
        </div>
      ) : expiredDuringSubmit ? (
        <Alert variant="warning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Your reset session expired. Request a new code to try again.
            </span>
            <Link
              href="/forgot-password"
              className="text-caption font-semibold text-text-link underline underline-offset-4 hover:text-text-link-hover"
            >
              Request a new code
            </Link>
          </div>
        </Alert>
      ) : (
        <Alert variant="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Reset code sent to:{" "}
              <span className="font-semibold">{draft?.contact_masked}</span>
            </span>
            <Link
              href="/forgot-password"
              className="text-caption font-semibold text-text-link underline underline-offset-4 hover:text-text-link-hover"
            >
              Change
            </Link>
          </div>
        </Alert>
      )}

      <form
        action={formAction}
        noValidate
        onFocusCapture={handleFormActivity}
        onChangeCapture={handleFormActivity}
        onSubmit={(e) => {
          if (isChecking || expiredDuringSubmit) {
            e.preventDefault();
            return;
          }
          const form = e.currentTarget;
          const errors: Record<string, string> = {};
          const otpCheck = validateOtp(
            (form.elements.namedItem("code") as HTMLInputElement).value,
          );
          if (!otpCheck.ok) errors.code = otpCheck.error;
          const pw = validatePassword(password);
          if (!pw.ok) errors.new_password = pw.error;
          const match = validatePasswordMatch(password, confirm);
          if (!match.ok) errors.confirm_new_password = match.error;
          if (Object.keys(errors).length) {
            e.preventDefault();
            setClientErrors(errors);
            const firstField = (
              ["code", "new_password", "confirm_new_password"] as const
            ).find((key) => Boolean(errors[key]));
            if (firstField) {
              form
                .querySelector<HTMLElement>(
                  `#${firstField}, [name="${firstField}"]:not([type="hidden"])`,
                )
                ?.focus();
            }
            return;
          }
          setClientErrors({});
        }}
        className="flex flex-col gap-4"
      >
        <input
          type="hidden"
          name="identifier"
          value={draft?.normalized_identifier ?? ""}
        />

        <div className="flex flex-col gap-2">
          <MemoizedInput
            id="code"
            name="code"
            variant="otp_6"
            label="6-Digit Verification Code"
            required
            readOnly={isPending}
            value={code}
            error={clientErrors.code ?? serverFieldError("code")}
            onChange={handleCodeChange}
          />

          <div className="flex flex-col gap-2 text-body-sm text-text-secondary">
            <div className="flex flex-wrap items-center gap-1.5">
              <span>Didn&apos;t receive a code?</span>
              <Button
                type="button"
                variant="link"
                isLoading={isResending}
                loadingText="Sending…"
                disabled={
                  isChecking ||
                  !isCooldownHydrated ||
                  cooldown > 0 ||
                  isResending ||
                  isPending
                }
                onClick={handleResend}
                className={
                  cooldown > 0
                    ? "no-underline tabular-nums"
                    : "underline-offset-4"
                }
              >
                {cooldown > 0
                  ? `Resend code in ${formatCountdown(cooldown)}`
                  : "Resend code"}
              </Button>
              <div
                role="region"
                aria-live="polite"
                aria-label="Resend code cooldown status"
                className="sr-only"
              >
                {isCooldownHydrated && cooldown > 0
                  ? "Verification code cooldown started. You must wait until the timer finishes before resending a code."
                  : isCooldownHydrated && cooldown === 0
                    ? "You can now resend the verification code."
                    : ""}
              </div>
            </div>
            <AuthAlert result={resendAlertResult} />
            {resendSuccess && (
              <Toast
                variant="success"
                role="status"
                ariaLive="polite"
                autoDismissMs={4000}
                onDismiss={handleDismissResendSuccess}
              >
                {resendSuccess}
              </Toast>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <MemoizedInput
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
            onChange={handlePasswordChange}
            placeholder="New password"
          />
          <PasswordStrengthHint password={password} />
        </div>

        <MemoizedInput
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
            serverFieldError("confirm_new_password")
          }
          onChange={handleConfirmChange}
          placeholder="Confirm new password"
        />

        <AuthAlert result={visibleAlertState} />

        <Button
          type="submit"
          size="lg"
          fullWidth
          disabled={isChecking || expiredDuringSubmit}
          isLoading={isPending}
          loadingText="Resetting password…"
        >
          Set New Password
        </Button>
      </form>

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
