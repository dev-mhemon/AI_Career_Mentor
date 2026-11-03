import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { resetPasswordAction } from "@/lib/auth/actions";
import { saveVerificationDraft } from "@/lib/auth/verification-draft";

const mockClearVerificationDraft = vi.fn();

vi.mock("@/lib/auth/actions", () => ({
  resetPasswordAction: vi.fn(),
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
      name: /request a new code/i,
    });
    expect(requestNewLink).toBeInTheDocument();
    expect(requestNewLink).toHaveAttribute("href", "/forgot-password");

    const signInLink = screen.getByRole("link", { name: /sign in/i });
    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute("href", "/login");
  });
});
