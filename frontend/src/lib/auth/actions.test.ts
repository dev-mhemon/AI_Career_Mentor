import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loginAction,
  registerAction,
  verifyOtpAction,
  resendOtpAction,
  logoutAction,
} from "@/lib/auth/actions";
import { syncUser, getMe } from "@/lib/api/client";

import { redirect } from "next/navigation";

// Mock Supabase
const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockVerifyOtp = vi.fn();
const mockResend = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signOut: mockSignOut,
      getSession: mockGetSession,
      verifyOtp: mockVerifyOtp,
      resend: mockResend,
    },
  }),
}));

// Mock API Client
vi.mock("@/lib/api/client", () => ({
  syncUser: vi.fn(),
  getMe: vi.fn(),
  NetworkError: class extends Error {},
  ApiError: class extends Error {},
}));

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("Auth Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loginAction", () => {
    it("returns error if fields are missing", async () => {
      const formData = new FormData();
      const result = await loginAction({}, formData);
      expect(result).toEqual({ error: "Email and password are required." });
    });

    it("returns error if Supabase signIn fails", async () => {
      const formData = new FormData();
      formData.set("email", "test@example.com");
      formData.set("password", "password123");

      mockSignInWithPassword.mockResolvedValueOnce({
        error: { message: "Invalid credentials" },
      });

      const result = await loginAction({}, formData);
      expect(result).toEqual({ error: "Invalid credentials" });
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
      formData.set("identifier", "test@example.com");
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

      const result = await resendOtpAction("email", "test@example.com");
      expect(result).toEqual({ success: true });
      expect(mockResend).toHaveBeenCalledWith({
        type: "signup",
        email: "test@example.com",
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'}/auth/callback`,
        },
      });
    });

    it("handles rate limit", async () => {
      mockResend.mockResolvedValueOnce({
        error: { status: 429, message: "Rate limit" },
      });

      const result = await resendOtpAction("email", "test@example.com");
      expect(result).toEqual({
        error:
          "Email delivery is temporarily rate-limited. Please try again later.",
      });
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
