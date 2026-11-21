import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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

function seedActiveRecoveryDraft(
  identifier = "user@example.com",
  contactMasked = "u****@example.com",
  channel: "email" | "phone" = "email",
) {
  saveVerificationDraft({
    channel,
    identifier,
    contactMasked,
    context: "password_recovery",
  });
}

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("renders targeted banner-slot skeleton during SSR checking state while keeping OTP/password inputs rendered and submit disabled", () => {
    const html = renderToStaticMarkup(<ResetPasswordForm />);
    const container = document.createElement("div");
    container.innerHTML = html;

    const bannerSkeleton = container.querySelector(
      '[role="status"][aria-busy="true"][aria-label="Checking reset session"]',
    );
    expect(bannerSkeleton).not.toBeNull();
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    expect(container.querySelector('input[name="new_password"]')).not.toBeNull();
    expect(
      container.querySelector('input[name="confirm_new_password"]'),
    ).not.toBeNull();
    const submitButton = container.querySelector('button[type="submit"]');
    expect(submitButton).not.toBeNull();
    expect(submitButton).toBeDisabled();
    expect(container.textContent).not.toMatch(/email or phone/i);
  });

  it("renders clean missing-session state with Request a new code CTA when no active draft exists (no mixed email/OTP form)", () => {
    render(<ResetPasswordForm />);

    expect(
      screen.getByRole("heading", { name: /reset session expired/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /set new password/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/enter the 6-digit verification code you received/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/request a new verification code to continue\./i),
    ).toBeInTheDocument();

    const requestNewLink = screen.getByRole("link", {
      name: /request a new code/i,
    });
    expect(requestNewLink).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );

    expect(screen.queryByLabelText(/email or phone/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/6-digit verification code/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^new password$/i)).not.toBeInTheDocument();
  });

  it("renders clean Reset session expired state with Request a new code CTA when recovery draft is expired", () => {
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
      screen.getByRole("heading", { name: /reset session expired/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /set new password/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/enter the 6-digit verification code you received/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /request a new code/i }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText(/email or phone/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/6-digit verification code/i),
    ).not.toBeInTheDocument();
  });

  it("renders masked contact banner, Change link, hidden identifier, and OTP/password fields with NO email/phone input when active draft exists", () => {
    seedActiveRecoveryDraft("testuser@example.com", "t****@example.com");

    render(<ResetPasswordForm />);

    expect(
      screen.getByRole("heading", { name: /set new password/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/enter the 6-digit verification code you received/i),
    ).toBeInTheDocument();
    expect(screen.getByText("t****@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^change$/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText(/email or phone/i)).not.toBeInTheDocument();

    const hiddenInput = document.querySelector(
      'input[name="identifier"][type="hidden"]',
    );
    expect(hiddenInput).toBeInTheDocument();
    expect(hiddenInput).toHaveValue("testuser@example.com");

    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const resendPrompt = screen.getByText(/didn't receive a code\?/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    expect(otpInput).toBeInTheDocument();
    // Resend row sits directly underneath the 6-digit OTP field and before New Password
    expect(
      otpInput.compareDocumentPosition(resendPrompt) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      resendPrompt.compareDocumentPosition(newPasswordInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(newPasswordInput).toHaveAttribute(
      "placeholder",
      "New password",
    );
    expect(screen.getByLabelText(/confirm new password/i)).toHaveAttribute(
      "placeholder",
      "Confirm new password",
    );
    expect(
      screen.getByRole("button", { name: /set new password/i }),
    ).toBeInTheDocument();
  });

  it("transitions live from active form to Reset session expired when session expires while user is on the page", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-21T12:00:00Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft(
        {
          channel: "email",
          identifier: "expiring@example.com",
          contactMasked: "e****@example.com",
          expiresInSeconds: 30,
          context: "password_recovery",
        },
        baseNow,
      );

      render(<ResetPasswordForm />);

      expect(screen.getByText("e****@example.com")).toBeInTheDocument();
      expect(
        screen.getByLabelText(/6-digit verification code/i),
      ).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(
        screen.getByRole("heading", { name: /reset session expired/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText(/6-digit verification code/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText(/email or phone/i),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores non-recovery draft (registration context) and shows clean Reset session expired state", () => {
    saveVerificationDraft({
      channel: "email",
      identifier: "registered@example.com",
      context: "registration",
    });

    render(<ResetPasswordForm />);

    expect(
      screen.getByRole("heading", { name: /reset session expired/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("r****@example.com")).not.toBeInTheDocument();
    expect(
      document.querySelector('input[name="identifier"][type="hidden"]'),
    ).toBeNull();
    expect(mockClearVerificationDraft).not.toHaveBeenCalled();
  });

  it("preserves recovery draft on reset failure so user can retry", async () => {
    vi.mocked(resetPasswordAction).mockResolvedValueOnce({
      error: "Verification code is invalid",
    });
    seedActiveRecoveryDraft();

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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
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
    seedActiveRecoveryDraft();

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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    });

    await waitFor(() => {
      expect(mockClearVerificationDraft).toHaveBeenCalled();
    });
  });

  it("does not validate while typing or blurring before submit, validates all fields on submit, clears errors onChange, and shows color-coded strength", () => {
    seedActiveRecoveryDraft();
    render(<ResetPasswordForm />);

    expect(
      screen.getByText(
        /must be at least 8 characters\. mixed with uppercase, lowercase, numbers, and symbols is stronger\./i,
      ),
    ).toBeInTheDocument();

    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);
    const form = otpInput.closest("form")!;

    fireEvent.change(otpInput, { target: { value: "123" } });
    fireEvent.blur(otpInput);
    fireEvent.change(newPasswordInput, { target: { value: "short" } });
    fireEvent.blur(newPasswordInput);
    fireEvent.change(confirmPasswordInput, { target: { value: "Mismatch1!" } });
    fireEvent.blur(confirmPasswordInput);

    expect(screen.queryByText(/enter the 6-digit code/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();

    fireEvent.submit(form);
    expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(resetPasswordAction).not.toHaveBeenCalled();

    fireEvent.change(otpInput, { target: { value: "1234" } });
    expect(screen.queryByText(/enter the 6-digit code/i)).not.toBeInTheDocument();

    fireEvent.change(newPasswordInput, { target: { value: "Abcdef1!" } });
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Good")).toHaveClass(
      "font-semibold",
      "tracking-wide",
      "text-teal-600",
    );

    fireEvent.change(confirmPasswordInput, { target: { value: "A" } });
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
  });

  it("displays single inline resend cooldown, ticks down in real time, and enables Resend code at 0s", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-14T12:00:00Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft(
        {
          channel: "email",
          identifier: "user@example.com",
          contactMasked: "u***@example.com",
          context: "password_recovery",
        },
        baseNow,
      );
      setPersistedCooldown(
        "email",
        baseNow + 65_000,
        65,
        baseNow,
        "user@example.com",
      );

      render(<ResetPasswordForm />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByText(/resend available in/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/when the timer ends/i)).not.toBeInTheDocument();
      const cooldownBtn = screen.getByRole("button", {
        name: /resend code in 01:05/i,
      });
      expect(cooldownBtn).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(
        screen.getByRole("button", { name: /resend code in 01:00/i }),
      ).toBeDisabled();

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
    seedActiveRecoveryDraft("user@example.com", "u***@example.com");
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({ success: true });

    render(<ResetPasswordForm />);

    const resendBtn = await screen.findByRole("button", {
      name: /^resend code$/i,
    });
    await waitFor(() => expect(resendBtn).toBeEnabled());

    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(forgotPasswordAction).toHaveBeenCalledTimes(1);
    const sentForm = vi.mocked(forgotPasswordAction).mock.calls[0]?.[1];
    expect(sentForm?.get("identifier")).toBe("user@example.com");
    expect(sentForm?.get("mode")).toBe("resend");

    expect(screen.getByText("Verification code sent.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend code in 01:00/i }),
    ).toBeDisabled();
    expect(screen.queryByText(/try again in/i)).not.toBeInTheDocument();
  });

  it("starts cooldown from 429 retryAfterSeconds when forgotPasswordAction resend is rate limited", async () => {
    seedActiveRecoveryDraft("+8801712345678", "+88017****5678", "phone");
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
      error: "Too many resend attempts. Please wait.",
      retryAfterSeconds: 45,
    });

    render(<ResetPasswordForm />);

    const resendBtn = await screen.findByRole("button", {
      name: /^resend code$/i,
    });
    await waitFor(() => expect(resendBtn).toBeEnabled());
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(screen.getByText(/too many resend attempts/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend code in 00:45/i }),
    ).toBeDisabled();
    expect(screen.queryByText(/try again in/i)).not.toBeInTheDocument();
  });

  it("auto-dismisses AuthAlert on input focus or change and re-displays on new server error", async () => {
    seedActiveRecoveryDraft();
    vi.mocked(resetPasswordAction)
      .mockResolvedValueOnce({ error: "Invalid or expired reset code." })
      .mockResolvedValueOnce({ error: "Reset failed on second try." });

    render(<ResetPasswordForm />);

    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);
    const form = otpInput.closest("form")!;

    fireEvent.change(otpInput, { target: { value: "123456" } });
    fireEvent.change(newPasswordInput, { target: { value: "NewPassw0rd!" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "NewPassw0rd!" } });

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(
      screen.getByText(/invalid or expired reset code\./i),
    ).toBeInTheDocument();

    fireEvent.focus(newPasswordInput);
    expect(
      screen.queryByText(/invalid or expired reset code\./i),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/reset failed on second try\./i)).toBeInTheDocument();

    fireEvent.change(otpInput, { target: { value: "654321" } });
    expect(
      screen.queryByText(/reset failed on second try\./i),
    ).not.toBeInTheDocument();
  });

  it("validates empty password on submit, preserves error across blur/toggle focus, and clears onChange", () => {
    seedActiveRecoveryDraft();
    render(<ResetPasswordForm />);

    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const showPasswordBtns = screen.getAllByRole("button", {
      name: /show password/i,
    });
    const form = newPasswordInput.closest("form")!;

    fireEvent.blur(newPasswordInput);
    expect(
      screen.queryByText(/password must be at least 8 characters\./i),
    ).not.toBeInTheDocument();

    fireEvent.submit(form);
    expect(
      screen.getByText(/password must be at least 8 characters\./i),
    ).toBeInTheDocument();

    fireEvent.blur(newPasswordInput, { relatedTarget: showPasswordBtns[0] });
    fireEvent.blur(newPasswordInput);
    expect(
      screen.getByText(/password must be at least 8 characters\./i),
    ).toBeInTheDocument();

    fireEvent.change(newPasswordInput, { target: { value: "a" } });
    expect(
      screen.queryByText(/password must be at least 8 characters\./i),
    ).not.toBeInTheDocument();
  });

  it("uses sleek inline button countdown without bulky alert on RESEND_COOLDOWN_ACTIVE and never shows Try again timer on 5xx errors", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-16T17:00:00.000Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft(
        {
          channel: "email",
          identifier: "mhemon.dev7@gmail.com",
          contactMasked: "m****@gmail.com",
          context: "password_recovery",
        },
        baseNow,
      );
      vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
        error: "Wait before requesting another code",
        status: 429,
        code: "RESEND_COOLDOWN_ACTIVE",
        retryAfterSeconds: 19,
      });
      vi.mocked(resetPasswordAction).mockResolvedValueOnce({
        error: "Service temporarily unavailable. Please try again.",
        status: 500,
        code: "INTERNAL_ERROR",
        retryAfterSeconds: 1,
      });

      render(<ResetPasswordForm />);

      await act(async () => {
        await Promise.resolve();
      });

      const resendBtn = screen.getByRole("button", { name: /^resend code$/i });
      expect(resendBtn).toBeEnabled();

      await act(async () => {
        fireEvent.click(resendBtn);
      });

      expect(
        screen.queryByText(/wait before requesting another code/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/try again in/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /resend code in 00:19/i }),
      ).toBeDisabled();
      const liveRegion = screen.getByRole("region", {
        name: /resend code cooldown status/i,
      });
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveTextContent(
        /verification code cooldown started\. you must wait until the timer finishes before resending a code\./i,
      );

      fireEvent.change(screen.getByLabelText(/6-digit verification code/i), {
        target: { value: "123456" },
      });
      fireEvent.change(screen.getByLabelText(/^new password$/i), {
        target: { value: "NewPassw0rd!" },
      });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), {
        target: { value: "NewPassw0rd!" },
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: /set new password/i }),
        );
      });

      expect(
        screen.getByText(/service temporarily unavailable\. please try again\./i),
      ).toBeInTheDocument();
      expect(screen.queryByText(/try again in/i)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(19_000);
      });
      expect(
        screen.getByRole("button", { name: /^resend code$/i }),
      ).toBeEnabled();
      expect(liveRegion).toHaveTextContent(
        /you can now resend the verification code\./i,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the 6-digit OTP input when resetPasswordAction returns 503 SERVICE_UNAVAILABLE and clears it only on explicit resend", async () => {
    seedActiveRecoveryDraft("user@example.com", "u***@example.com");
    vi.mocked(resetPasswordAction).mockResolvedValueOnce({
      error: "Service temporarily unavailable. Please try again.",
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      retryAfterSeconds: 5,
    });
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({ success: true });

    render(<ResetPasswordForm />);

    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i);

    fireEvent.change(otpInput, { target: { value: "847291" } });
    fireEvent.change(newPasswordInput, { target: { value: "NewPassw0rd!" } });
    fireEvent.change(confirmPasswordInput, { target: { value: "NewPassw0rd!" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    });

    await waitFor(() => {
      expect(
        screen.getByText(/service temporarily unavailable\. please try again\./i),
      ).toBeInTheDocument();
    });

    expect(otpInput).toHaveValue("847291");
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("8");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("1");

    const resendBtn = await screen.findByRole("button", {
      name: /^resend code$/i,
    });
    await waitFor(() => expect(resendBtn).toBeEnabled());
    await act(async () => {
      fireEvent.click(resendBtn);
    });

    await waitFor(() => {
      expect(otpInput).toHaveValue("");
      expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("");
    });
  });

  it("clears OTP field error on successful resend while preserving password errors, and keeps OTP error on failed resend", async () => {
    seedActiveRecoveryDraft("user@example.com", "u***@example.com");
    vi.mocked(forgotPasswordAction)
      .mockResolvedValueOnce({ error: "Resend temporarily failed." })
      .mockResolvedValueOnce({ success: true });

    render(<ResetPasswordForm />);

    const otpInput = screen.getByLabelText(/6-digit verification code/i);
    const newPasswordInput = screen.getByLabelText(/^new password$/i);
    const form = otpInput.closest("form")!;

    fireEvent.change(otpInput, { target: { value: "123" } });
    fireEvent.change(newPasswordInput, { target: { value: "short" } });
    fireEvent.submit(form);

    expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();

    const resendBtn = await screen.findByRole("button", {
      name: /^resend code$/i,
    });
    await waitFor(() => expect(resendBtn).toBeEnabled());

    // Failed resend leaves existing OTP and password errors untouched
    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();

    // Successful resend clears OTP value + OTP error, while preserving password error
    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(otpInput).toHaveValue("");
    expect(screen.queryByText(/enter the 6-digit code/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
  });

  it("accepts an in-flight resend success even if the old draft expires while pending, and stays expired on failure", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-21T12:00:00Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft(
        {
          channel: "email",
          identifier: "renew@example.com",
          contactMasked: "r****@example.com",
          expiresInSeconds: 10,
          context: "password_recovery",
        },
        baseNow,
      );

      let resolveResend!: (val: { success?: boolean; error?: string }) => void;
      vi.mocked(forgotPasswordAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveResend = resolve;
          }),
      );

      render(<ResetPasswordForm />);
      await act(async () => {
        await Promise.resolve();
      });

      const resendBtn = screen.getByRole("button", { name: /^resend code$/i });
      expect(resendBtn).toBeEnabled();
      fireEvent.click(resendBtn);

      // Old draft expires while resend request is still in flight
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(
        screen.getByRole("heading", { name: /reset session expired/i }),
      ).toBeInTheDocument();

      // Resend succeeds -> renews session for same contact and returns to active form
      await act(async () => {
        resolveResend({ success: true });
        await Promise.resolve();
      });
      expect(screen.getByText("r****@example.com")).toBeInTheDocument();
      expect(
        screen.getByLabelText(/6-digit verification code/i),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays in Reset session expired state when a deferred resend fails after draft expiry", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-21T12:00:00Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft(
        {
          channel: "email",
          identifier: "failrenew@example.com",
          contactMasked: "f****@example.com",
          expiresInSeconds: 10,
          context: "password_recovery",
        },
        baseNow,
      );

      let resolveResend!: (val: { success?: boolean; error?: string }) => void;
      vi.mocked(forgotPasswordAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveResend = resolve;
          }),
      );

      render(<ResetPasswordForm />);
      await act(async () => {
        await Promise.resolve();
      });

      const resendBtn = screen.getByRole("button", { name: /^resend code$/i });
      fireEvent.click(resendBtn);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(
        screen.getByRole("heading", { name: /reset session expired/i }),
      ).toBeInTheDocument();

      // Deferred resend fails after expiry with 429 cooldown -> stays expired, persists cooldown for original contact
      await act(async () => {
        resolveResend({
          error: "Too many attempts",
          code: "RESEND_COOLDOWN_ACTIVE",
          retryAfterSeconds: 45,
        } as { success?: boolean; error?: string });
        await Promise.resolve();
      });
      expect(
        screen.getByRole("heading", { name: /reset session expired/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText(/6-digit verification code/i),
      ).not.toBeInTheDocument();
      const rawCooldown = window.sessionStorage.getItem(
        "mentor_resend_cooldown_email_failrenew@example.com",
      );
      expect(rawCooldown).not.toBeNull();
      expect(JSON.parse(rawCooldown!)).toMatchObject({
        originalSeconds: 45,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables Set New Password while resend is in flight and preserves entered OTP if resend fails", async () => {
    seedActiveRecoveryDraft();
    let resolveResend!: (val: { error?: string }) => void;
    vi.mocked(forgotPasswordAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResend = resolve;
        }),
    );

    render(<ResetPasswordForm />);
    const otpInput = screen.getByLabelText(
      /6-digit verification code/i,
    ) as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: "654321" } });

    const resendBtn = await screen.findByRole("button", {
      name: /^resend code$/i,
    });
    await waitFor(() => expect(resendBtn).toBeEnabled());
    fireEvent.click(resendBtn);

    const submitBtn = screen.getByRole("button", { name: /set new password/i });
    expect(submitBtn).toBeDisabled();

    await act(async () => {
      resolveResend({ error: "Resend failed" });
      await Promise.resolve();
    });

    expect(submitBtn).toBeEnabled();
    expect(otpInput.value).toBe("654321");
  });

  it("displays backend pending message and blocks OTP resubmission when accountReadyForSignin is false", async () => {
    seedActiveRecoveryDraft();
    vi.mocked(resetPasswordAction).mockResolvedValueOnce({
      success: true,
      accountReadyForSignin: false,
      cleanupStatus: "pending_account_sync",
      otpConsumed: true,
      error:
        "Password was updated, but required sign-in provider mapping sync did not finish yet. Do not resubmit the reset code.",
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    });

    expect(
      screen.getByText(/required sign-in provider mapping sync did not finish yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /set new password/i }),
    ).toBeDisabled();
    expect(mockClearVerificationDraft).toHaveBeenCalled();
  });

  it("keeps the reset action result visible when draft expires during an in-flight submission and blocks resubmission", async () => {
    vi.useFakeTimers();
    try {
      const baseNow = new Date("2026-11-21T12:00:00Z").getTime();
      vi.setSystemTime(baseNow);
      saveVerificationDraft(
        {
          channel: "email",
          identifier: "inflight@example.com",
          contactMasked: "i****@example.com",
          expiresInSeconds: 10,
          context: "password_recovery",
        },
        baseNow,
      );

      let resolveReset!: (val: {
        error?: string;
        code?: string;
        status?: number;
      }) => void;
      vi.mocked(resetPasswordAction).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReset = resolve;
          }),
      );

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

      // Start submission (enters isPending = true)
      fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

      // Draft expires while reset action is still pending -> do NOT unmount form before result arrives
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      await act(async () => {
        resolveReset({
          error: "New password must be different from your current password.",
          code: "PASSWORD_POLICY_FAILED",
          status: 422,
        });
        await Promise.resolve();
      });

      expect(
        screen.getByText(
          /new password must be different from your current password\./i,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /set new password/i }),
      ).toBeDisabled();
      expect(
        screen.getByRole("link", { name: /request a new code/i }),
      ).toHaveAttribute("href", "/forgot-password");
    } finally {
      vi.useRealTimers();
    }
  });
});
