import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loginAction,
  registerAction,
  verifyOtpAction,
  resendOtpAction,
  logoutAction,
  signInWithOAuth,
} from "@/lib/auth/actions";
import { loginUser, syncUser, getMe, approveOAuthSession } from "@/lib/api/client";
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

  class MockApiError extends Error {
    constructor(
      public readonly statusCode: number = 500,
      message = "Api error",
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
  });

  describe("registerAction", () => {
    it("returns error if passwords do not match", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password456");

      const result = await registerAction({}, formData);
      expect(result).toEqual({ error: "Passwords do not match." });
    });

    it("returns error if password is too short", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "pass");
      formData.set("confirmPassword", "pass");

      const result = await registerAction({}, formData);
      expect(result).toEqual({
        error: "Password must be at least 6 characters.",
      });
    });

    it("returns 429 rate limit error handling", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("identifier", "test@example.com");
      formData.set("password", "password123");
      formData.set("confirmPassword", "password123");

      mockSignUp.mockResolvedValueOnce({
        error: { status: 429, message: "Too many requests" },
      });

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
      mockSignUp.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });
      vi.mocked(redirect).mockImplementationOnce(() => {
        throw new Error("NEXT_REDIRECT");
      });

      await expect(registerAction({}, formData)).rejects.toThrow("NEXT_REDIRECT");
      expect(redirect).toHaveBeenCalledWith("/verify?type=email");
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

    it("verifies email OTP", async () => {
      const formData = new FormData();
      formData.set("type", "email");
      formData.set("token", "123456");

      mockVerifyOtp.mockResolvedValueOnce({ error: null });
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: "token123" } },
      });
      (getMe as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: "ACTIVE",
      });

      try {
        await verifyOtpAction({}, formData);
      } catch {
        // next redirect throws
      }

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        email: "test@example.com",
        token: "123456",
        type: "email",
      });
      expect(syncUser).toHaveBeenCalledWith("token123");
      expect(getMe).toHaveBeenCalledWith("token123");
      expect(redirect).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("resendOtpAction", () => {
    it("resends email verification", async () => {
      mockResend.mockResolvedValueOnce({ error: null });

      const result = await resendOtpAction("email");
      expect(result).toEqual({ success: true });
      expect(mockResend).toHaveBeenCalledWith({
        type: "signup",
        email: "test@example.com",
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback?flow=email`,
        },
      });
    });

    it("handles rate limit", async () => {
      mockResend.mockResolvedValueOnce({
        error: { status: 429, message: "Rate limit" },
      });

      const result = await resendOtpAction("email");
      expect(result).toEqual({
        error:
          "Email delivery is temporarily rate-limited. Please try again later.",
      });
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
    it("calls signOut and redirects to login", async () => {
      await logoutAction();
      expect(mockSignOut).toHaveBeenCalled();
      expect(redirect).toHaveBeenCalledWith("/login");
    });
  });
});
