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
import { useRouter } from "next/navigation";
import { loginAction, type AuthActionResult } from "@/lib/auth/actions";
import {
  rotateTelemetrySessionId,
  trackEvent,
} from "@/lib/telemetry/telemetry";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import {
  AuthAlert,
  useDismissedActionState,
} from "@/components/auth/auth-alert";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Toast } from "@/components/ui/toast";
import {
  loadVerificationDraft,
  saveVerificationDraft,
  clearVerificationDraft,
} from "@/lib/auth/verification-draft";
import {
  clearOAuthLoginHint,
  clearOAuthLoginHintCookie,
  clearRememberedLogin,
  clearRememberedLoginCookie,
  getOAuthLoginHintClearedSnapshot,
  getOAuthLoginHintServerSnapshot,
  getOAuthLoginHintSnapshot,
  getRememberedLoginServerSnapshot,
  getRememberedLoginSnapshot,
  isOAuthLoginHintCleared,
  loadOAuthLoginHint,
  loadRememberedLogin,
  parseOAuthLoginHint,
  parseRememberedLoginHint,
  saveOAuthLoginHint,
  saveRememberedLogin,
  subscribeOAuthLoginHint,
  subscribeRememberedLogin,
  type OAuthLoginHint,
  type RememberedLoginHint,
} from "@/lib/auth/remember-login";
import {
  sanitizeBdPhoneDisplay,
  validateBdPhone,
  validateEmail,
  validateLoginPassword,
} from "@/lib/validation/auth-schemas";

type Channel = "email" | "phone";

const LOGIN_TAB_ITEMS = [
  { id: "email", label: "Email", panel: null },
  { id: "phone", label: "Phone", panel: null },
];

const MemoizedTabs = memo(Tabs);
const MemoizedInput = memo(Input);
const MemoizedCheckbox = memo(Checkbox);

const LOGIN_DIVIDER = (
  <div className="relative flex items-center">
    <div className="flex-1 border-t border-border-default" />
    <span className="px-3 text-body-sm text-text-muted">or</span>
    <div className="flex-1 border-t border-border-default" />
  </div>
);

const SIGNUP_FOOTER = (
  <p className="text-center text-body-sm text-text-secondary">
    Don&apos;t have an account?{" "}
    <Link
      href="/register"
      className="font-medium text-text-link underline underline-offset-4 hover:text-text-link-hover"
    >
      Sign up
    </Link>
  </p>
);

/**
 * Screen 02: Login form component using useActionState for pending and error states.
 * Supports Email and Bangladesh Phone (+880) tabs, preserves email/phone inputs across tab
 * switches and failed logins, clears only password on error, restores remembered identifier/
 * channel preference across logout when "Keep Signed In" was selected, and handles recovery.
 */
export function LoginForm({
  initialError,
  successMessage,
  toastMessage,
  initialRememberedLogin,
  initialOAuthHint,
  clearSavedLogin = false,
}: {
  initialError?: string;
  successMessage?: string;
  toastMessage?: string;
  initialRememberedLogin?: RememberedLoginHint | null;
  initialOAuthHint?: OAuthLoginHint | null;
  clearSavedLogin?: boolean;
}) {
  const router = useRouter();
  const [urlDeletionState] = useState<{
    toast?: string;
    hasDeletionParam: boolean;
  }>(() => {
    if (typeof window === "undefined") return { hasDeletionParam: false };
    try {
      const params = new URLSearchParams(window.location.search);
      const deletedParam = params.get("deleted");
      const hasDeletionParam =
        deletedParam === "true" ||
        deletedParam === "1" ||
        params.get("notice") === "account_deleted";
      return {
        hasDeletionParam,
        toast: hasDeletionParam
          ? "Your account has been permanently deleted."
          : undefined,
      };
    } catch {
      // Ignore URL search parsing errors
      return { hasDeletionParam: false };
    }
  });
  const urlDeletionToast = urlDeletionState.toast;
  const normalizedSuccessToast =
    successMessage && /password reset/i.test(successMessage)
      ? "Password updated."
      : successMessage;
  const effectiveToastSource =
    toastMessage ?? urlDeletionToast ?? normalizedSuccessToast;
  const [dismissedToastFor, setDismissedToastFor] = useState<
    string | undefined
  >(undefined);
  const visibleToastMessage =
    effectiveToastSource && dismissedToastFor !== effectiveToastSource
      ? effectiveToastSource
      : undefined;
  const dismissToast = useCallback(
    () => setDismissedToastFor(effectiveToastSource),
    [effectiveToastSource],
  );

  const [storageCleared, setStorageCleared] = useState(false);
  const [oauthStorageCleared, setOAuthStorageCleared] = useState(false);
  const storedHintRaw = useSyncExternalStore(
    subscribeRememberedLogin,
    getRememberedLoginSnapshot,
    getRememberedLoginServerSnapshot,
  );
  const storedOAuthHintRaw = useSyncExternalStore(
    subscribeOAuthLoginHint,
    getOAuthLoginHintSnapshot,
    getOAuthLoginHintServerSnapshot,
  );
  const storedOAuthClearedRaw = useSyncExternalStore(
    subscribeOAuthLoginHint,
    getOAuthLoginHintClearedSnapshot,
    getOAuthLoginHintServerSnapshot,
  );
  const shouldClearSavedLogin =
    clearSavedLogin ||
    initialRememberedLogin === null ||
    initialOAuthHint === null ||
    urlDeletionState.hasDeletionParam;
  const effectiveHint = useMemo(() => {
    if (shouldClearSavedLogin || storageCleared) return null;
    return parseRememberedLoginHint(storedHintRaw) ?? initialRememberedLogin;
  }, [initialRememberedLogin, shouldClearSavedLogin, storageCleared, storedHintRaw]);
  const effectiveOAuthHint = useMemo(() => {
    if (
      shouldClearSavedLogin ||
      oauthStorageCleared ||
      storedOAuthClearedRaw !== null
    ) {
      return null;
    }
    return parseOAuthLoginHint(storedOAuthHintRaw) ?? initialOAuthHint;
  }, [
    initialOAuthHint,
    oauthStorageCleared,
    shouldClearSavedLogin,
    storedOAuthClearedRaw,
    storedOAuthHintRaw,
  ]);

  const [tabOverride, setTabOverride] = useState<Channel | null>(null);
  const [emailOverride, setEmailOverride] = useState<string | null>(null);
  const [phoneOverride, setPhoneOverride] = useState<string | null>(null);
  const [keepSignedInOverride, setKeepSignedInOverride] = useState<
    boolean | null
  >(null);
  const [password, setPassword] = useState("");

  const activeTab = tabOverride ?? effectiveHint?.channel ?? "email";
  const emailValue =
    emailOverride ??
    (effectiveHint?.channel === "email" ? effectiveHint.identifier : "");
  const phoneValue =
    phoneOverride ??
    (effectiveHint?.channel === "phone" ? effectiveHint.identifier : "");
  const identifier = activeTab === "email" ? emailValue : phoneValue;
  const keepSignedIn =
    keepSignedInOverride ?? Boolean(effectiveHint?.rememberMe);

  const identifierRef = useRef(identifier);
  useEffect(() => {
    identifierRef.current = identifier;
  }, [identifier]);
  const submittedIdentifier = useRef("");
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
      rotateTelemetrySessionId();
      trackEvent({
        event_name: "auth_login_submitted",
        feature_key: "auth",
        screen_name: "login",
      });
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

  const didInitialSeedRef = useRef(false);
  useEffect(() => {
    const hasDeletionSignal =
      clearSavedLogin || Boolean(toastMessage) || Boolean(urlDeletionToast);
    if (hasDeletionSignal) {
      if (typeof document !== "undefined") {
        document.cookie =
          "account_deleted=; path=/; max-age=0; samesite=lax";
      }
      if (typeof window !== "undefined") {
        try {
          const url = new URL(window.location.href);
          if (
            url.searchParams.has("deleted") ||
            url.searchParams.get("notice") === "account_deleted"
          ) {
            url.searchParams.delete("deleted");
            if (url.searchParams.get("notice") === "account_deleted") {
              url.searchParams.delete("notice");
            }
            const cleaned = `${url.pathname}${url.search}${url.hash}`;
            window.history.replaceState(window.history.state, "", cleaned);
          }
        } catch {
          // Ignore URL cleanup errors
        }
      }
    }
    if (shouldClearSavedLogin) {
      clearRememberedLogin();
      clearOAuthLoginHint();
      return;
    }
    if (!didInitialSeedRef.current) {
      didInitialSeedRef.current = true;
      if (initialRememberedLogin && !loadRememberedLogin()) {
        saveRememberedLogin(
          initialRememberedLogin.channel,
          initialRememberedLogin.identifier,
        );
      }
      if (isOAuthLoginHintCleared()) {
        clearOAuthLoginHintCookie();
      } else if (initialOAuthHint && !loadOAuthLoginHint()) {
        saveOAuthLoginHint(initialOAuthHint);
      }
    }
  }, [
    clearSavedLogin,
    initialOAuthHint,
    initialRememberedLogin,
    shouldClearSavedLogin,
    toastMessage,
    urlDeletionToast,
  ]);

  useEffect(() => {
    const syncClearState = () => {
      // Read live localStorage directly via getRememberedLoginSnapshot rather than trusting stale StorageEvent.newValue
      const cleared = !parseRememberedLoginHint(getRememberedLoginSnapshot());
      setStorageCleared(cleared);
      if (cleared) {
        setKeepSignedInOverride(false);
        clearRememberedLoginCookie();
      }
    };
    const unsubscribeRemember = subscribeRememberedLogin(syncClearState);
    const syncOAuthClearState = () => {
      const cleared =
        !parseOAuthLoginHint(getOAuthLoginHintSnapshot()) ||
        isOAuthLoginHintCleared();
      setOAuthStorageCleared(cleared);
      if (cleared) {
        clearOAuthLoginHintCookie();
      }
    };
    const unsubscribeOAuth = subscribeOAuthLoginHint(syncOAuthClearState);
    return () => {
      unsubscribeRemember();
      unsubscribeOAuth();
    };
  }, []);

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

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const activeTabRef = useRef(activeTab);
  const emailValueRef = useRef(emailValue);
  const phoneValueRef = useRef(phoneValue);
  useEffect(() => {
    activeTabRef.current = activeTab;
    emailValueRef.current = emailValue;
    phoneValueRef.current = phoneValue;
  }, [activeTab, emailValue, phoneValue]);

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

  const handleTabChange = useCallback(
    (id: string) => {
      setTabOverride(id as Channel);
      setClientErrors({});
      const currentState = stateRef.current;
      if (currentState?.fieldErrors) {
        setDismissedServer({
          ref: currentState,
          fields: new Set(Object.keys(currentState.fieldErrors)),
        });
      }
      dismissAlert();
    },
    [dismissAlert],
  );

  const handleFormReset = useCallback((e: SyntheticEvent<HTMLFormElement>) => {
    // Prevent React 19 form transitions from wiping controlled login state or unchecking Keep Signed In
    e.preventDefault();
  }, []);

  const handleEmailChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setEmailOverride(e.target.value);
      dismissServerField("email");
      dismissServerField("phone");
      dismissServerField("identifier");
      setFieldError("identifier", undefined);
    },
    [dismissServerField, setFieldError],
  );

  const handlePhoneChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPhoneOverride(e.target.value);
      dismissServerField("email");
      dismissServerField("phone");
      dismissServerField("identifier");
      setFieldError("identifier", undefined);
    },
    [dismissServerField, setFieldError],
  );

  const handlePasswordChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPassword(e.target.value);
      dismissServerField("password");
      setFieldError("password", undefined);
    },
    [dismissServerField, setFieldError],
  );

  const handleKeepSignedInChange = useCallback((checked: boolean) => {
    setKeepSignedInOverride(checked);
    if (!checked) {
      setTabOverride(activeTabRef.current);
      setEmailOverride(emailValueRef.current);
      setPhoneOverride(phoneValueRef.current);
      clearRememberedLogin();
    }
  }, []);

  const serverFieldError = (field: string) =>
    dismissedServer?.ref === state && dismissedServer.fields.has(field)
      ? undefined
      : state?.fieldErrors?.[field];

  const identifierError =
    clientErrors.identifier ??
    serverFieldError("identifier") ??
    serverFieldError("email") ??
    serverFieldError("phone");
  const passwordError = clientErrors.password ?? serverFieldError("password");

  const isAccountNotFound401 =
    visibleAlertState?.status === 401 &&
    (visibleAlertState.code === "ACCOUNT_DELETED" ||
      visibleAlertState.code === "AUTH_USER_NOT_FOUND" ||
      visibleAlertState.code === "ACCOUNT_NOT_FOUND" ||
      visibleAlertState.code === "USER_NOT_FOUND" ||
      (visibleAlertState.code === "AUTH_REQUIRED" &&
        /account.*not found|user.*not found|deleted/i.test(
          visibleAlertState.error ?? "",
        )) ||
      /no account found|account not found|user not found|account.*deleted/i.test(
        visibleAlertState.error ?? "",
      ));

  return (
    <div className="flex flex-col gap-6">
      {visibleToastMessage && (
        <Toast
          variant="success"
          position="top-right"
          role="status"
          ariaLive="polite"
          autoDismissMs={4500}
          onDismiss={dismissToast}
        >
          {visibleToastMessage}
        </Toast>
      )}

      <MemoizedTabs
        aria-label="Sign-in method"
        variant="segmented_pill"
        idPrefix="login"
        hidePanels
        disabled={isPending}
        value={activeTab}
        onValueChange={handleTabChange}
        items={LOGIN_TAB_ITEMS}
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
          onReset={handleFormReset}
          onSubmit={(e) => {
            const form = e.currentTarget;
            const errors: Record<string, string> = {};
            const id =
              activeTab === "email"
                ? validateEmail(identifier)
                : validateBdPhone(identifier);
            if (!id.ok) {
              errors.identifier = id.error;
            }
            const pw = validateLoginPassword(password);
            if (!pw.ok) errors.password = pw.error;
            if (Object.keys(errors).length) {
              e.preventDefault();
              setClientErrors(errors);
              return;
            }
            setClientErrors({});
            setTabOverride(activeTab);
            setEmailOverride(emailValue);
            setPhoneOverride(phoneValue);
            setKeepSignedInOverride(keepSignedIn);
            if (id.ok) {
              if (activeTab === "email") {
                const emailEl = form.elements.namedItem(
                  "identifier",
                ) as HTMLInputElement | null;
                if (emailEl) emailEl.value = id.value;
              }
              submittedIdentifier.current = id.value;
              if (keepSignedIn) {
                saveRememberedLogin(
                  activeTab,
                  activeTab === "phone"
                    ? sanitizeBdPhoneDisplay(phoneValue)
                    : id.value,
                );
              } else {
                clearRememberedLogin();
              }
            }
          }}
          className="flex flex-col gap-4"
        >
          {activeTab === "email" ? (
            <MemoizedInput
              key="email"
              id="email"
              name="identifier"
              variant="email"
              label="Email"
              autoComplete="username"
              required
              readOnly={isPending}
              value={emailValue}
              error={identifierError}
              onChange={handleEmailChange}
              placeholder="Enter your email"
            />
          ) : (
            <MemoizedInput
              key="phone"
              id="phone"
              name="identifier"
              variant="phone_bd"
              label="Phone Number"
              autoComplete="username"
              required
              readOnly={isPending}
              value={phoneValue}
              error={identifierError}
              onChange={handlePhoneChange}
              hint="Bangladesh mobile, e.g. 01XXXXXXXXX"
              placeholder="01XXXXXXXXX"
            />
          )}

          <div className="flex flex-col gap-1.5">
            <MemoizedInput
              id="password"
              name="password"
              variant="password"
              label="Password"
              autoComplete="current-password"
              required
              readOnly={isPending}
              value={password}
              error={passwordError}
              onChange={handlePasswordChange}
              placeholder="Password"
            />
            <div className="flex items-center justify-between gap-4">
              <MemoizedCheckbox
                name="rememberMe"
                label="Keep Signed In"
                checked={keepSignedIn}
                onChange={handleKeepSignedInChange}
                readOnly={isPending}
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
                visibleAlertState?.status === 401 && !isAccountNotFound401
                  ? "Please verify your credentials. The password entered is incorrect."
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

      {LOGIN_DIVIDER}

      <OAuthButtons oauthHint={effectiveOAuthHint} />

      {SIGNUP_FOOTER}
    </div>
  );
}
