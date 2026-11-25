"use client";

import { memo, type ReactNode, useCallback, useState } from "react";
import { signInWithOAuth } from "@/lib/auth/actions";
import { type OAuthLoginHint } from "@/lib/auth/remember-login";
import { getUserInitials } from "@/lib/auth/user-display";
import {
  markTelemetrySignInPending,
  rotateTelemetrySessionId,
} from "@/lib/telemetry/telemetry";
import { Button } from "@/components/ui/button";
import { AuthAlert } from "@/components/auth/auth-alert";

type Provider = "google" | "facebook";

const PROVIDERS_DEFAULT: readonly Provider[] = ["google", "facebook"];
const PROVIDERS_FACEBOOK_FIRST: readonly Provider[] = ["facebook", "google"];
const PERSONALIZED_CARD_CLASS =
  "h-auto min-h-[54px] justify-start px-3.5 py-2 shadow-xs [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-3";

const GOOGLE_ICON = (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const FACEBOOK_ICON = (
  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
  </svg>
);

const PROVIDER_META: Record<
  Provider,
  {
    providerName: string;
    label: string;
    loadingText: string;
    icon: ReactNode;
  }
> = {
  google: {
    providerName: "Google",
    label: "Continue with Google",
    loadingText: "Connecting to Google…",
    icon: GOOGLE_ICON,
  },
  facebook: {
    providerName: "Facebook",
    label: "Continue with Facebook",
    loadingText: "Connecting to Facebook…",
    icon: FACEBOOK_ICON,
  },
};

/**
 * OAuth buttons for Google and Facebook login.
 *
 * Uses the signInWithOAuth server action to initiate the OAuth redirect flow.
 * When a returning OAuth login hint is provided, renders that provider in a
 * compact personalized card while keeping the other provider in its standard style.
 */
export const OAuthButtons = memo(function OAuthButtons({
  oauthHint,
}: {
  oauthHint?: OAuthLoginHint | null;
}) {
  const [error, setError] = useState<{
    error: string;
    status?: number;
    code?: string;
    retryAfterSeconds?: number;
  } | null>(null);
  const [pending, setPending] = useState<Provider | null>(null);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);

  const handleOAuth = useCallback(async (provider: Provider) => {
    setError(null);
    setPending(provider);
    markTelemetrySignInPending();
    rotateTelemetrySessionId();
    try {
      const res = await signInWithOAuth(provider);
      if (res?.error) {
        setError({ ...res, error: res.error });
        setPending(null);
      }
      // No error: browser is redirecting to the provider; keep the loading state.
    } catch (err) {
      if (err instanceof Error && err.message === "NEXT_REDIRECT") {
        return;
      }
      setError({ error: "Failed to initiate OAuth login. Please try again." });
      setPending(null);
    }
  }, []);

  const handleAvatarError = useCallback(() => {
    setFailedAvatarUrl(oauthHint?.avatarUrl ?? null);
  }, [oauthHint?.avatarUrl]);

  const providers =
    oauthHint?.provider === "facebook"
      ? PROVIDERS_FACEBOOK_FIRST
      : PROVIDERS_DEFAULT;

  return (
    <div className="flex flex-col gap-3">
      <AuthAlert result={error} />
      {providers.map((provider) => {
        const meta = PROVIDER_META[provider];
        const isPersonalized = oauthHint?.provider === provider;
        const isLoading = pending === provider;

        if (isPersonalized && oauthHint) {
          const showAvatar =
            Boolean(oauthHint.avatarUrl) &&
            failedAvatarUrl !== oauthHint.avatarUrl;
          const initials = getUserInitials({
            fullName: oauthHint.displayName,
            email: oauthHint.email,
          });

          return (
            <Button
              key={provider}
              variant="oauth"
              size="lg"
              fullWidth
              isLoading={isLoading}
              loadingText={meta.loadingText}
              disabled={pending !== null}
              onClick={() => handleOAuth(provider)}
              className={isLoading ? undefined : PERSONALIZED_CARD_CLASS}
            >
              {showAvatar ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={oauthHint.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  referrerPolicy="no-referrer"
                  onError={handleAvatarError}
                  className="h-8 w-8 shrink-0 rounded-full border border-border-subtle object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-sunken text-caption font-semibold text-text-primary"
                >
                  {initials}
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="truncate text-label font-semibold text-text-primary">
                  Continue as {oauthHint.displayName}
                </span>
                {" "}
                <span className="sr-only">with {meta.providerName}</span>
                {oauthHint.email ? (
                  <>
                    {" "}
                    <span className="mt-0.5 truncate text-caption font-normal text-text-muted">
                      {oauthHint.email}
                    </span>
                  </>
                ) : null}
              </span>
              {meta.icon}
            </Button>
          );
        }

        return (
          <Button
            key={provider}
            variant="oauth"
            size="lg"
            fullWidth
            isLoading={isLoading}
            loadingText={meta.loadingText}
            disabled={pending !== null}
            onClick={() => handleOAuth(provider)}
          >
            <span className="inline-flex items-center gap-2">
              {meta.icon}
              {meta.label}
            </span>
          </Button>
        );
      })}
    </div>
  );
});
