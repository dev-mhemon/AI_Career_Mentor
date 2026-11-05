import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loginAction,
  registerAction,
  verifyOtpAction,
  resendOtpAction,
  logoutAction,
  signInWithOAuth,
  forgotPasswordAction,
  resetPasswordAction,
  linkIdentityAction,
  addContactAction,
} from "@/lib/auth/actions";
import { loginUser, approveOAuthSession, registerUser, resendVerification, verifyEmail, verifyPhone, logoutUser, forgotPassword, resetPassword, linkSocialIdentity, addContact, ApiError } from "@/lib/api/client";
import { GET as authCallbackGet } from "@/app/auth/callback/route";

import { redirect } from "next/navigation";

// Mock Supabase
const mockSignUp = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockSetSession = vi.fn();
const mockGetSession = vi.fn();
const mockVerifyOtp = vi.fn();
const mockResend = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockLinkIdentity = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const verificationContext = Buffer.from(
  JSON.stringify({ type: "email", identifier: "test@example.com" }),
).toString("base64url");
const mockCookieStore = {
  get: vi.fn(() => ({ value: verificationContext })),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signUp: mockSignUp,
      signOut: mockSignOut,
      setSession: mockSetSession,
      getSession: mockGetSession,
      verifyOtp: mockVerifyOtp,
      resend: mockResend,
      signInWithOAuth: mockSignInWithOAuth,
      linkIdentity: mockLinkIdentity,
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
}));

// Mock API Client
vi.mock("@/lib/api/client", () => {
  class MockNetworkError extends Error {
    constructor(message = "Network error") {
      super(message);
      this.name = "NetworkError";
    }
  }

  /**
   * Mock API error mimicking backend ApiError structure.
   */
  class MockApiError extends Error {
    /**
     * Initializes mock API error with status code, message, and error code.
     */
    constructor(
      public readonly statusCode: number = 500,
      message = "Api error",
      public readonly code?: string,
      public readonly requestId?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }

  return {
    loginUser: vi.fn(),
    syncUser: vi.fn(),
    getMe: vi.fn(),
    approveOAuthSession: vi.fn(),
    registerUser: vi.fn(),
    resendVerification: vi.fn(),
    verifyEmail: vi.fn(),
    verifyPhone: vi.fn(),
    logoutUser: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    linkSocialIdentity: vi.fn(),
    addContact: vi.fn(),
    NetworkError: MockNetworkError,
    ApiError: MockApiError,
  };
});

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

describe("Auth Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue({ value: verificationContext });
  });

  describe("loginAction", () => {
    it("returns error if fields are missing", async () => {
      const formData = new FormData();
      const result = await loginAction({}, formData);
      expect(result).toEqual({ error: "Email and password are required." });
    });

    it("uses backend EP-A05 and persists only the approved session", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("password", "password123");

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        access_token: "approved-access",
        refresh_token: "approved-refresh",
        user: { status: "active" },
        next_step: "app_home",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });
      await loginAction({}, formData);
      expect(loginUser).toHaveBeenCalledWith("test@example.com", "password123");
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: "approved-access",
        refresh_token: "approved-refresh",
      });
      expect(redirect).toHaveBeenCalledWith("/dashboard");
    });

    it("redirects active user to /onboarding/profile when next_step is profile_setup", async () => {
      const formData = new FormData();
      formData.set("email", "newuser@example.com");
      formData.set("password", "password123");

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        access_token: "approved-access",
        refresh_token: "approved-refresh",
        user: { status: "active" },
        next_step: "profile_setup",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      await loginAction({}, formData);
      expect(redirect).toHaveBeenCalledWith("/onboarding/profile");
    });

    it("redirects suspended user to /settings shell regardless of next_step", async () => {
      const formData = new FormData();
      formData.set("email", "suspended@example.com");
      formData.set("password", "password123");

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        access_token: "approved-access",
        refresh_token: "approved-refresh",
        user: { status: "suspended" },
        next_step: "profile_setup",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      await loginAction({}, formData);
      expect(redirect).toHaveBeenCalledWith("/settings");
    });

    it("returns error for unverified phone identifier instead of unserviced SMS redirect", async () => {
      const formData = new FormData();
      formData.set("identifier", "+8801712345678");
      formData.set("password", "password123");

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(
          403,
          "Account unapproved; contact confirmation required",
          "UNVERIFIED_ACCOUNT",
        ),
      );

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error:
          "Phone verification is temporarily unavailable. Please sign in with email or contact support.",
      });
      expect(resendVerification).not.toHaveBeenCalled();
      expect(mockCookieStore.set).not.toHaveBeenCalled();
    });

    it("catches 403 UNVERIFIED_ACCOUNT and returns error with redirectTo /verify for email identifier", async () => {
      const formData = new FormData();
      formData.set("email", "candidate@example.com");
      formData.set("password", "password123");

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(
          403,
          "Account unapproved; contact confirmation required",
          "UNVERIFIED_ACCOUNT",
        ),
      );
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: "email",
        contact_masked: "c***@example.com",
        expires_in_seconds: 600,
        resend_available_at: "2026-01-01T00:00:00Z",
      });

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: "Please verify your contact before logging in.",
        redirectTo: "/verify?channel=email",
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: "email",
        contact: "candidate@example.com",
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_verification_context",
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: "/verify" }),
      );
    });

    it("catches 403 ACCOUNT_NOT_VERIFIED and proceeds to /verify even if resendVerification rate limits", async () => {
      const formData = new FormData();
      formData.set("email", "candidate@example.com");
      formData.set("password", "password123");

      (loginUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(
          403,
          "Contact confirmation required",
          "ACCOUNT_NOT_VERIFIED",
        ),
      );
      vi.mocked(resendVerification).mockRejectedValueOnce(
        new ApiError(429, "Rate limit"),
      );

      const result = await loginAction({}, formData);
      expect(result).toEqual({
        error: "Please verify your contact before logging in.",
        redirectTo: "/verify?channel=email",
      });
      expect(mockCookieStore.set).toHaveBeenCalled();
    });
  });

  describe("registerAction", () => {
    it("returns error if privacy consent is missing", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      const result = await registerAction({}, formData);
      expect(result).toEqual({ error: "Privacy consent is required." });
    });

    it("returns error if passwords do not match", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password456");
      formData.set("privacy_consent", "on");

      const result = await registerAction({}, formData);
      expect(result).toEqual({ error: "Passwords do not match." });
    });

    it("returns error if password is too short", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "pass");
      formData.set("confirmPassword", "pass");
      formData.set("privacy_consent", "true");

      const result = await registerAction({}, formData);
      expect(result).toEqual({
        error: "Password must be at least 8 characters.",
      });
    });

    it("returns 429 rate limit error handling", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");
      formData.set("privacy_consent", "on");

      vi.mocked(registerUser).mockRejectedValueOnce(new ApiError(429, "Too many requests"));

      const result = await registerAction({}, formData);
      expect(result).toEqual({
        error:
          "Email delivery is temporarily rate-limited. Please try again later.",
      });
    });

    it("keeps the verification contact out of the redirect URL", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");
      formData.set("privacy_consent", "on");
      vi.mocked(registerUser).mockResolvedValueOnce({
        verification_channel: "email",
        contact_masked: "t***@example.com",
        expires_in_seconds: 600,
        resend_available_at: "2026-01-01T00:00:00Z",
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error("NEXT_REDIRECT");
      });

      await expect(registerAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(registerUser).toHaveBeenCalledWith({
        email: "test@example.com",
        phone: null,
        password: "password123",
        confirm_password: "password123",
        privacy_consent: true,
      });
      expect(redirect).toHaveBeenCalledWith("/verify?channel=email");
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_verification_context",
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: "/verify" }),
      );
    });
  });

  describe("verifyOtpAction", () => {
    it("returns error if missing fields", async () => {
      const formData = new FormData();
      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({ error: "Invalid verification request." });
    });

    it("returns error if verification context is missing", async () => {
      mockCookieStore.get.mockReturnValueOnce(undefined);
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("token", "123456");

      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({ error: "Invalid verification request." });
    });

    it("verifies email via backend EP-A02 and returns redirectTo /onboarding/profile on profile_setup", async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        user: {
          id: "test-user-id",
          email: "test@example.com",
          phone: null,
          role: "USER",
          status: "active",
          linked_providers: ["email"],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: "profile_setup",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set("type", "email");
      formData.set("token", "123456");

      const result = await verifyOtpAction({}, formData);

      expect(verifyEmail).toHaveBeenCalledWith({
        email: "test@example.com",
        code: "123456",
      });
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_verification_context",
        "",
        expect.objectContaining({ path: "/verify", maxAge: 0 }),
      );
      expect(result).toEqual({
        success: true,
        redirectTo: "/onboarding/profile",
      });
    });

    it("verifies email using identifier from formData when cookie is missing", async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        user: {
          id: "test-user-id",
          email: "reentered@example.com",
          phone: null,
          role: "USER",
          status: "active",
          linked_providers: ["email"],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: "profile_setup",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set("channel", "email");
      formData.set("identifier", "reentered@example.com");
      formData.set("token", "123456");

      const result = await verifyOtpAction({}, formData);

      expect(verifyEmail).toHaveBeenCalledWith({
        email: "reentered@example.com",
        code: "123456",
      });
      expect(result).toEqual({
        success: true,
        redirectTo: "/onboarding/profile",
      });
    });

    it("verifies email via backend EP-A02 and redirects to /dashboard on app_home", async () => {
      vi.mocked(verifyEmail).mockResolvedValueOnce({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        user: {
          id: "test-user-id",
          email: "test@example.com",
          phone: null,
          role: "USER",
          status: "active",
          linked_providers: ["email"],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: "app_home",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set("type", "email");
      formData.set("token", "123456");

      const result = await verifyOtpAction({}, formData);

      expect(result).toEqual({
        success: true,
        redirectTo: "/dashboard",
      });
    });

    it("returns error message when verifyEmail throws ApiError", async () => {
      vi.mocked(verifyEmail).mockRejectedValueOnce(
        new ApiError(
          422,
          "Verification code is invalid",
          "VERIFICATION_CODE_INVALID",
        ),
      );

      const formData = new FormData();
      formData.set("type", "email");
      formData.set("token", "000000");

      const result = await verifyOtpAction({}, formData);
      expect(result).toEqual({ error: "Verification code is invalid" });
    });

    it("verifies phone via backend EP-A03 and redirects to /onboarding/profile", async () => {
      const phoneContext = Buffer.from(
        JSON.stringify({ type: "phone", identifier: "+8801712345678" }),
      ).toString("base64url");
      mockCookieStore.get.mockReturnValueOnce({ value: phoneContext });

      vi.mocked(verifyPhone).mockResolvedValueOnce({
        access_token: "phone-access-token",
        refresh_token: "phone-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        user: {
          id: "test-user-id",
          email: null,
          phone: "+8801712345678",
          role: "USER",
          status: "active",
          linked_providers: ["phone"],
          verified_contact: true,
        },
        profile_complete: false,
        next_step: "profile_setup",
      });
      mockSetSession.mockResolvedValueOnce({ error: null });

      const formData = new FormData();
      formData.set("type", "phone");
      formData.set("token", "123456");

      const result = await verifyOtpAction({}, formData);

      expect(verifyPhone).toHaveBeenCalledWith({
        phone: "+8801712345678",
        code: "123456",
      });
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: "phone-access-token",
        refresh_token: "phone-refresh-token",
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_verification_context",
        "",
        expect.objectContaining({ path: "/verify", maxAge: 0 }),
      );
      expect(result).toEqual({
        success: true,
        redirectTo: "/onboarding/profile",
      });
    });
  });

  describe("resendOtpAction", () => {
    it("resends email verification via backend EP-A04", async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: "email",
        contact_masked: "t***@example.com",
        expires_in_seconds: 600,
        resend_available_at: "2026-01-01T00:00:00Z",
      });

      const result = await resendOtpAction("email");
      expect(result).toEqual({
        success: true,
        expiresInSeconds: 600,
        contactMasked: "t***@example.com",
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: "email",
        contact: "test@example.com",
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_verification_context",
        expect.any(String),
        expect.objectContaining({ httpOnly: true, maxAge: 600, path: "/verify" }),
      );
    });

    it("handles rate limit", async () => {
      vi.mocked(resendVerification).mockRejectedValueOnce(
        new ApiError(429, "Rate limit"),
      );

      const result = await resendOtpAction("email");
      expect(result).toEqual({
        error:
          "Email delivery is temporarily rate-limited. Please try again later.",
      });
    });
    it("resends verification using reentered identifier when context cookie is absent", async () => {
      vi.mocked(resendVerification).mockResolvedValueOnce({
        verification_channel: "email",
        contact_masked: "r****@example.com",
        expires_in_seconds: 600,
        resend_available_at: "2026-01-01T00:00:00Z",
      });

      const result = await resendOtpAction("email", "reentered@example.com");
      expect(result).toEqual({
        success: true,
        expiresInSeconds: 600,
        contactMasked: "r****@example.com",
      });
      expect(resendVerification).toHaveBeenCalledWith({
        channel: "email",
        contact: "reentered@example.com",
      });
    });

    it("returns error on invalid channel", async () => {
      const result = await resendOtpAction("sms" as unknown as "phone");
      expect(result).toEqual({ error: "Invalid verification channel." });
    });

    it("returns error when phone channel is requested while SMS is unavailable", async () => {
      const result = await resendOtpAction("phone", "+8801712345678");
      expect(result).toEqual({
        error:
          "SMS verification is temporarily unavailable. Please verify with email or contact support.",
      });
      expect(resendVerification).not.toHaveBeenCalled();
    });
  });

  describe("signInWithOAuth", () => {
    it("initiates OAuth redirect with provider in callback URL", async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: "https://accounts.google.com/o/oauth2/auth" },
        error: null,
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error("NEXT_REDIRECT");
      });

      await expect(signInWithOAuth("google")).rejects.toThrow("NEXT_REDIRECT");
      expect(mockSignInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"}/auth/callback?provider=google`,
        },
      });
      expect(redirect).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/auth");
    });

    it("returns error message when OAuth initiation fails", async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: null,
        error: { message: "OAuth service error" },
      });

      const result = await signInWithOAuth("facebook");
      expect(result).toEqual({ error: "OAuth service error" });
    });

    it("returns error message when redirect URL is missing", async () => {
      mockSignInWithOAuth.mockResolvedValueOnce({
        data: { url: null },
        error: null,
      });

      const result = await signInWithOAuth("google");
      expect(result).toEqual({
        error: "Failed to initiate OAuth login. Missing redirect URL.",
      });
    });
  });

  describe("OAuth callback route handler", () => {
    it("rejects request without code to /login?error=oauth_failed without exchanging code", async () => {
      const request = new Request(
        "http://localhost:3001/auth/callback?provider=google",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/login?error=oauth_failed",
      );
    });

    it("rejects request with invalid provider to /login?error=oauth_failed without exchanging code", async () => {
      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=github",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/login?error=oauth_failed",
      );
    });

    it("handles transitional email confirmation callback with flow=email without oauth_failed", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&flow=email",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("mock-code");
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/login?verified=true",
      );
    });

    it("handles transitional email confirmation callback without provider query param without oauth_failed", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("mock-code");
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/login?verified=true",
      );
    });

    it("approves OAuth session for a user with primary app_metadata.provider = email and linked google identity", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "mock-oauth-access-token",
            user: {
              id: "user-123",
              app_metadata: { provider: "email" },
              identities: [
                { provider: "email", id: "email-id" },
                { provider: "google", id: "google-sub-123" },
              ],
            },
          },
        },
      });
      (approveOAuthSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { id: "user-123", status: "active", verified_contact: true },
        next_step: "app_home",
        profile_complete: true,
      });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("mock-code");
      expect(approveOAuthSession).toHaveBeenCalledWith(
        "mock-oauth-access-token",
        "google",
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3001/dashboard");
    });

    it("redirects OAuth user to /onboarding/profile when next_step is profile_setup", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "mock-oauth-access-token",
            user: {
              id: "user-123",
              identities: [{ provider: "google", id: "google-sub-123" }],
            },
          },
        },
      });
      (approveOAuthSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        user: { id: "user-123", status: "active", verified_contact: true },
        next_step: "profile_setup",
        profile_complete: false,
      });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google",
      );
      const response = await authCallbackGet(request);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/onboarding/profile",
      );
    });

    it("signs out with scope: 'local' and redirects to /login?error=oauth_failed if user lacks matching identity", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "mock-oauth-access-token",
            user: {
              id: "user-123",
              app_metadata: { provider: "email" },
              identities: [{ provider: "facebook", id: "fb-123" }],
            },
          },
        },
      });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google",
      );
      const response = await authCallbackGet(request);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
      expect(approveOAuthSession).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3001/login?error=oauth_failed");
    });

    it("handles flow=link by calling approveOAuthSession and linkSocialIdentity and redirecting to /settings?linked=${provider}", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "mock-link-access-token",
            user: {
              id: "user-123",
              identities: [{ provider: "google", id: "google-123" }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockResolvedValueOnce({
        user: { id: "user-123", email: "user@example.com", phone: null, status: "active", verified_contact: true, role: "USER", linked_providers: ["email"] },
        profile_complete: true,
        verified_contact_required: false,
        next_step: "app_home",
      });
      vi.mocked(linkSocialIdentity).mockResolvedValueOnce({
        linked_providers: ["email", "google"],
      });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("mock-code");
      expect(approveOAuthSession).toHaveBeenCalledWith(
        "mock-link-access-token",
        "google",
      );
      expect(linkSocialIdentity).toHaveBeenCalledWith(
        "mock-link-access-token",
        "google",
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/settings?linked=google",
      );
    });

    it("preserves session (no signOut) and redirects to /settings?error=link_failed when approveOAuthSession throws during flow=link", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "mock-link-access-token",
            user: {
              id: "user-123",
              identities: [{ provider: "google", id: "google-123" }],
            },
          },
        },
      });
      vi.mocked(approveOAuthSession).mockRejectedValueOnce(new Error("Approval failed"));

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link",
      );
      const response = await authCallbackGet(request);
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(linkSocialIdentity).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/settings?error=link_failed",
      );
    });

    it("preserves session (no signOut) and redirects to /settings?error=link_failed when exchangeCodeForSession returns error during flow=link", async () => {
      mockExchangeCodeForSession.mockResolvedValueOnce({
        error: new Error("Exchange error"),
      });

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("mock-code");
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/settings?error=link_failed",
      );
    });

    it("preserves session (no signOut) and redirects to /settings?error=link_failed when exchangeCodeForSession throws during flow=link", async () => {
      mockExchangeCodeForSession.mockRejectedValueOnce(
        new Error("Unexpected exchange failure"),
      );

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google&flow=link",
      );
      const response = await authCallbackGet(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("mock-code");
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3001/settings?error=link_failed",
      );
    });

    it("signs out with scope: 'local' and redirects to /login?error=sync_failed if approveOAuthSession throws ApiError", async () => {
      const { ApiError } = await import("@/lib/api/client");
      mockExchangeCodeForSession.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "mock-oauth-access-token",
            user: {
              id: "user-123",
              app_metadata: { provider: "google" },
              identities: [{ provider: "google", id: "google-123" }],
            },
          },
        },
      });
      (approveOAuthSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new ApiError(500, "Backend sync error"),
      );

      const request = new Request(
        "http://localhost:3001/auth/callback?code=mock-code&provider=google",
      );
      const response = await authCallbackGet(request);
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3001/login?error=sync_failed");
    });
  });

  describe("logoutAction", () => {
    it("calls backend logoutUser with access token before signOut and redirects to login", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: "active-token" } },
      });
      vi.mocked(logoutUser).mockResolvedValueOnce({ logged_out: true });

      await logoutAction();

      expect(logoutUser).toHaveBeenCalledWith("active-token");
      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith("/login");
    });

    it("proceeds with signOut and redirect even if backend logoutUser throws", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: "expired-token" } },
      });
      vi.mocked(logoutUser).mockRejectedValueOnce(new Error("Network failed"));

      await logoutAction();

      expect(logoutUser).toHaveBeenCalledWith("expired-token");
      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith("/login");
    });

    it("proceeds with signOut and redirect when no active session exists", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      await logoutAction();

      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith("/login");
    });
  });
  describe("forgotPasswordAction", () => {
    it("returns error when identifier is missing", async () => {
      const formData = new FormData();
      formData.set("identifier", "");

      const result = await forgotPasswordAction({}, formData);
      expect(result).toEqual({ error: "Email or phone is required." });
      expect(forgotPassword).not.toHaveBeenCalled();
    });

    it("calls forgotPassword, sets recovery context cookie, and redirects to /reset-password", async () => {
      const formData = new FormData();
      formData.set("identifier", "user@example.com");
      vi.mocked(forgotPassword).mockResolvedValueOnce({
        message: "If the account exists, a code was sent.",
      });

      await forgotPasswordAction({}, formData);

      expect(forgotPassword).toHaveBeenCalledWith("user@example.com");
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_recovery_context",
        expect.any(String),
        expect.objectContaining({ path: "/reset-password" })
      );
      expect(redirect).toHaveBeenCalledWith("/reset-password");
    });
  });

  describe("resetPasswordAction", () => {
    it("validates code and password mismatch", async () => {
      const formData = new FormData();
      formData.set("identifier", "user@example.com");
      formData.set("code", "123");
      formData.set("new_password", "Passw0rd1!");
      formData.set("confirm_new_password", "Passw0rd1!");

      const badCode = await resetPasswordAction({}, formData);
      expect(badCode.error).toContain("six-digit");

      formData.set("code", "123456");
      formData.set("confirm_new_password", "Mismatch!");
      const mismatch = await resetPasswordAction({}, formData);
      expect(mismatch.error).toContain("Passwords do not match");
    });

    it("calls resetPassword, clears recovery cookie, and redirects to /login?reset=success", async () => {
      const formData = new FormData();
      formData.set("identifier", "user@example.com");
      formData.set("code", "123456");
      formData.set("new_password", "N3w!Passw0rd");
      formData.set("confirm_new_password", "N3w!Passw0rd");

      vi.mocked(resetPassword).mockResolvedValueOnce({ password_reset: true });

      await resetPasswordAction({}, formData);

      expect(resetPassword).toHaveBeenCalledWith(
        "user@example.com",
        "123456",
        "N3w!Passw0rd",
        "N3w!Passw0rd"
      );
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_recovery_context",
        "",
        expect.objectContaining({ maxAge: 0 })
      );
      expect(redirect).toHaveBeenCalledWith("/login?reset=success");
    });
  });

  describe("linkIdentityAction (EP-A11)", () => {
    it("links social identity directly when already linked in Supabase", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "active-token",
            user: { identities: [{ provider: "google" }] },
          },
        },
      });
      vi.mocked(linkSocialIdentity).mockResolvedValueOnce({
        linked_providers: ["email", "google"],
      });

      const result = await linkIdentityAction("google");
      expect(result).toEqual({
        success: true,
        linked_providers: ["email", "google"],
      });
      expect(linkSocialIdentity).toHaveBeenCalledWith("active-token", "google");
    });

    it("initiates Supabase OAuth identity linking redirect when not yet linked", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: "active-token",
            user: { identities: [{ provider: "email" }] },
          },
        },
      });
      mockLinkIdentity.mockResolvedValueOnce({
        data: { url: "https://accounts.google.com/o/oauth2/auth" },
        error: null,
      });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error("NEXT_REDIRECT");
      });

      await expect(linkIdentityAction("google")).rejects.toThrow("NEXT_REDIRECT");
      expect(mockLinkIdentity).toHaveBeenCalledWith({
        provider: "google",
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"}/auth/callback?flow=link&provider=google`,
        },
      });
      expect(redirect).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/auth");
    });

    it("returns error when session is missing", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
      });

      const result = await linkIdentityAction("facebook");
      expect(result).toEqual({
        error: "Authentication session is required to link an identity.",
      });
      expect(linkSocialIdentity).not.toHaveBeenCalled();
    });
  });

  describe("addContactAction (EP-A12)", () => {
    it("stages contact, sets verification context cookie, and redirects to /verify?type=email", async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: "active-token" } },
      });
      vi.mocked(addContact).mockResolvedValueOnce({
        verification_channel: "email",
        contact_masked: "c****@example.com",
        expires_in_seconds: 600,
        resend_available_at: "2026-01-01T00:01:00.000Z",
      });

      const formData = new FormData();
      formData.set("channel", "email");
      formData.set("contact", "candidate@example.com");

      await addContactAction({}, formData);

      expect(addContact).toHaveBeenCalledWith("active-token", {
        channel: "email",
        contact: "candidate@example.com",
      });
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "mentor_verification_context",
        expect.any(String),
        expect.objectContaining({ path: "/verify", maxAge: 600 })
      );
      expect(redirect).toHaveBeenCalledWith("/verify?channel=email");
    });

    it("returns error when contact is empty", async () => {
      const formData = new FormData();
      formData.set("channel", "email");
      formData.set("contact", "   ");

      const result = await addContactAction({}, formData);
      expect(result).toEqual({ error: "Email is required." });
      expect(addContact).not.toHaveBeenCalled();
    });
  });
});
