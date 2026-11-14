import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { resetPasswordAction, forgotPasswordAction } from "@/lib/auth/actions";
import {
  saveVerificationDraft,
  setPersistedCooldown,
} from "@/lib/auth/verification-draft";

const mockClearVerificationDraft = vi.fn();

vi.mock("@/lib/auth/actions", () => ({
  resetPasswordAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
}));

vi.mock("@/lib/auth/verification-draft", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/verification-draft")
  >("@/lib/auth/verification-draft");
  return {
    ...actual,
    clearVerificationDraft: () => {
      mockClearVerificationDraft();
      return actual.clearVerificationDraft();
    },
  };
});

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("renders identifier re-entry input when draft is absent", () => {
    render(<ResetPasswordForm />);

    expect(screen.getByLabelText(/email or phone/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/6-digit verification code/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password$/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/confirm new password/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set new password/i }),
    ).toBeInTheDocument();
  });

  it("renders masked contact and hidden identifier when active draft is present", () => {
    saveVerificationDraft({
      channel: "email",
      identifier: "testuser@example.com",
      contactMasked: "t****@example.com",
      context: "password_recovery",
    });

    render(<ResetPasswordForm />);

    expect(screen.getByText("t****@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText(/email or phone/i)).not.toBeInTheDocument();

    const hiddenInput = document.querySelector('input[name="identifier"][type="hidden"]');
    expect(hiddenInput).toBeInTheDocument();
    expect(hiddenInput).toHaveValue("testuser@example.com");
  });

  it("renders expired notice and identifier re-entry input when draft is expired", () => {
    const expiredDraft = {
      channel: "email",
      normalized_identifier: "expired@example.com",
      contact_masked: "e****@example.com",
      expires_at: new Date(Date.now() - 10000).toISOString(),
      context: "password_recovery",
    };
    window.sessionStorage.setItem(
      "mentor_verification_draft",
      JSON.stringify(expiredDraft),
    );

    render(<ResetPasswordForm />);

    expect(
      screen.getByText(/recovery session expired/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email or phone/i)).toBeInTheDocument();
  });

  it("preserves recovery draft on reset failure so user can retry", async () => {
    vi.mocked(resetPasswordAction).mockResolvedValueOnce({
      error: "Verification code is invalid",
    });

    saveVerificationDraft({
      channel: "email",
      identifier: "user@example.com",
      context: "password_recovery",
    });

    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText(/6-digit verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "NewPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "NewPassw0rd!" },
    });

    const button = screen.getByRole("button", { name: /set new password/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/verification code is invalid/i),
      ).toBeInTheDocument();
      expect(mockClearVerificationDraft).not.toHaveBeenCalled();
      expect(
        window.sessionStorage.getItem("mentor_verification_draft"),
      ).not.toBeNull();
    });
  });

  it("clears recovery draft when reset submission succeeds", async () => {
    vi.mocked(resetPasswordAction).mockResolvedValueOnce({
      success: true,
    });

    saveVerificationDraft({
      channel: "email",
      identifier: "user@example.com",
      context: "password_recovery",
    });

    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText(/6-digit verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "NewPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "NewPassw0rd!" },
    });

    const button = screen.getByRole("button", { name: /set new password/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockClearVerificationDraft).toHaveBeenCalled();
    });
  });

  it("ignores active draft if context is not password_recovery and does not clear it on submit", () => {
    saveVerificationDraft({
      channel: "email",
      identifier: "registered@example.com",
      context: "registration",
    });

    render(<ResetPasswordForm />);

    expect(screen.getByLabelText(/email or phone/i)).toBeInTheDocument();
    expect(screen.queryByText("r****@example.com")).not.toBeInTheDocument();
    expect(document.querySelector('input[name="identifier"][type="hidden"]')).toBeNull();

    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    expect(mockClearVerificationDraft).not.toHaveBeenCalled();
  });

  it("does not display recovery expired notice if stored expired draft is for registration", () => {
    const expiredRegistrationDraft = {
      channel: "email",
      normalized_identifier: "expired-reg@example.com",
      contact_masked: "e****@example.com",
      expires_at: new Date(Date.now() - 10000).toISOString(),
      context: "registration",
    };
    window.sessionStorage.setItem(
      "mentor_verification_draft",
      JSON.stringify(expiredRegistrationDraft),
    );

    render(<ResetPasswordForm />);

    expect(
      screen.queryByText(/recovery session expired/i),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email or phone/i)).toBeInTheDocument();
  });

  it("displays server action error message when reset fails", async () => {
    vi.mocked(resetPasswordAction).mockResolvedValueOnce({
      error: "Verification code has expired. Please request a new one.",
    });

    render(<ResetPasswordForm />);

    fireEvent.change(screen.getByLabelText(/email or phone/i), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/6-digit verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText(/^new password$/i), {
      target: { value: "NewPassw0rd!" },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: "NewPassw0rd!" },
    });

    const button = screen.getByRole("button", { name: /set new password/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/verification code has expired/i),
      ).toBeInTheDocument();
    });
  });

  it("renders navigation links to forgot-password and login", () => {
    render(<ResetPasswordForm />);

    const requestNewLink = screen.getByRole("link", {
      name: /^resend code$/i,
    });
    expect(requestNewLink).toBeInTheDocument();
    expect(requestNewLink).toHaveAttribute("href", "/forgot-password");

    const signInLink = screen.getByRole("link", { name: /sign in/i });
    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute("href", "/login");
  });

  it("validates identifier, 6-digit OTP, password, and confirm password live onChange without waiting for blur", () => {
    render(<ResetPasswordForm />);

    const identifierInput = screen.getByLabelText(/email or phone/i);
    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);

    fireEvent.change(identifierInput, { target: { value: "not-valid" } });
    expect(
      screen.getByText(/enter a valid email address or bangladesh mobile number/i),
    ).toBeInTheDocument();

    fireEvent.change(identifierInput, { target: { value: "user@example.com" } });
    expect(
      screen.queryByText(/enter a valid email address or bangladesh mobile number/i),
    ).not.toBeInTheDocument();

    fireEvent.change(otpInput, { target: { value: "123" } });
    expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();

    fireEvent.change(otpInput, { target: { value: "123456" } });
    expect(screen.queryByText(/enter the 6-digit code/i)).not.toBeInTheDocument();

    fireEvent.change(newPasswordInput, { target: { value: "short" } });
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();

    fireEvent.change(newPasswordInput, { target: { value: "NewPassw0rd!" } });
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();

    fireEvent.change(confirmPasswordInput, { target: { value: "Mismatch1!" } });
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();

    fireEvent.change(confirmPasswordInput, { target: { value: "NewPassw0rd!" } });
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
  });

  it("displays single inline resend cooldown, ticks down in real time, and enables Resend code at 0s", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-14T12:00:00Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft({
        channel: "email",
        identifier: "user@example.com",
        contactMasked: "u***@example.com",
        context: "password_recovery",
      });
      setPersistedCooldown("email", baseNow + 65_000, 65, baseNow, "user@example.com");

      render(<ResetPasswordForm />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByText(/resend available in/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/when the timer ends/i)).not.toBeInTheDocument();
      const cooldownBtn = screen.getByRole("button", { name: /resend code in 01:05/i });
      expect(cooldownBtn).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByRole("button", { name: /resend code in 01:00/i })).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      const readyBtn = screen.getByRole("button", { name: /^resend code$/i });
      expect(readyBtn).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resends code in place via forgotPasswordAction with mode=resend and starts 60s cooldown", async () => {
    saveVerificationDraft({
      channel: "email",
      identifier: "user@example.com",
      contactMasked: "u***@example.com",
      context: "password_recovery",
    });
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({ success: true });

    render(<ResetPasswordForm />);

    const resendBtn = await screen.findByRole("button", { name: /^resend code$/i });
    await waitFor(() => expect(resendBtn).toBeEnabled());

    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(forgotPasswordAction).toHaveBeenCalledTimes(1);
    const sentForm = vi.mocked(forgotPasswordAction).mock.calls[0]?.[1];
    expect(sentForm?.get("identifier")).toBe("user@example.com");
    expect(sentForm?.get("mode")).toBe("resend");

    expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend code in 01:00/i })).toBeDisabled();
    expect(screen.queryByText(/resend available in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/when the timer ends/i)).not.toBeInTheDocument();
  });

  it("starts cooldown from 429 retryAfterSeconds when forgotPasswordAction resend is rate limited", async () => {
    saveVerificationDraft({
      channel: "phone",
      identifier: "+8801712345678",
      contactMasked: "+88017****5678",
      context: "password_recovery",
    });
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
      error: "Too many resend attempts. Please wait.",
      retryAfterSeconds: 45,
    });

    render(<ResetPasswordForm />);

    const resendBtn = await screen.findByRole("button", { name: /^resend code$/i });
    await waitFor(() => expect(resendBtn).toBeEnabled());
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(screen.getByText(/too many resend attempts/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resend code in 00:45/i })).toBeDisabled();
    expect(screen.queryByText(/resend available in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/when the timer ends/i)).not.toBeInTheDocument();
  });

  it("unlocks in-place resend button when user enters a valid identifier without a draft", async () => {
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({ success: true });
    render(<ResetPasswordForm />);

    expect(screen.getByRole("link", { name: /^resend code$/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );

    const identifierInput = screen.getByLabelText(/email or phone/i);
    fireEvent.change(identifierInput, { target: { value: "01712345678" } });

    const resendBtn = await screen.findByRole("button", { name: /^resend code$/i });
    await waitFor(() => expect(resendBtn).toBeEnabled());
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    const sentForm = vi.mocked(forgotPasswordAction).mock.calls[0]?.[1];
    expect(sentForm?.get("identifier")).toBe("+8801712345678");
    expect(sentForm?.get("mode")).toBe("resend");
  });

  it("auto-dismisses AuthAlert on input focus or change and re-displays on new server error", async () => {
    vi.mocked(resetPasswordAction)
      .mockResolvedValueOnce({ error: "Invalid or expired reset code." })
      .mockResolvedValueOnce({ error: "Reset failed on second try." });

    render(<ResetPasswordForm />);

    const identifierInput = screen.getByLabelText(/email or phone/i);
    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);
    const form = identifierInput.closest("form")!;

    fireEvent.change(identifierInput, { target: { value: "user@example.com" } });
    fireEvent.change(otpInput, { target: { value: "123456" } });
    fireEvent.change(newPasswordInput, { target: { value: "NewPassw0rd!" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "NewPassw0rd!" } });

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/invalid or expired reset code\./i)).toBeInTheDocument();

    fireEvent.focus(newPasswordInput);
    expect(
      screen.queryByText(/invalid or expired reset code\./i),
    ).not.toBeInTheDocument();

    fireEvent.change(identifierInput, { target: { value: "user@example.com" } });
    fireEvent.change(otpInput, { target: { value: "123456" } });
    fireEvent.change(newPasswordInput, { target: { value: "NewPassw0rd!" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "NewPassw0rd!" } });

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/reset failed on second try\./i)).toBeInTheDocument();

    fireEvent.change(otpInput, { target: { value: "654321" } });
    expect(
      screen.queryByText(/reset failed on second try\./i),
    ).not.toBeInTheDocument();
  });
});
