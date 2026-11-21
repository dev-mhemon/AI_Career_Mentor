import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { forgotPasswordAction } from "@/lib/auth/actions";

const mockClearVerificationDraft = vi.fn();
const mockSaveVerificationDraft = vi.fn();

vi.mock("@/lib/auth/actions", () => ({
  forgotPasswordAction: vi.fn(),
}));

vi.mock("@/lib/auth/verification-draft", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/verification-draft")
  >("@/lib/auth/verification-draft");
  return {
    ...actual,
    saveVerificationDraft: (...args: unknown[]) => {
      mockSaveVerificationDraft(...args);
      return actual.saveVerificationDraft(
        ...(args as Parameters<typeof actual.saveVerificationDraft>),
      );
    },
    clearVerificationDraft: () => {
      mockClearVerificationDraft();
      return actual.clearVerificationDraft();
    },
  };
});

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("renders email and phone tabs and default email input", () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByRole("tab", { name: /^email$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^phone$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/registered/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset code/i }),
    ).toBeInTheDocument();
  });

  it("switches to phone channel when phone tab is clicked", () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    expect(screen.getByLabelText(/^phone number$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/registered/i)).not.toBeInTheDocument();
    expect(screen.getByText("+88")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("01XXXXXXXXX"),
    ).toBeInTheDocument();
  });

  it("renders a link to the sign-in page", () => {
    render(<ForgotPasswordForm />);

    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/login");
  });

  it("saves recovery draft on form submission with password_recovery context", async () => {
    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: "email",
      identifier: "user@example.com",
      context: "password_recovery",
    });
  });

  it("strips non-digits from phone_bd input onChange, validates on submit, and clears error onChange", async () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    const input = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "017742590012dddddddd12" } });
    expect(input.value).toBe("01774259001212");
    expect(
      screen.queryByText(/enter a valid bangladesh mobile number/i),
    ).not.toBeInTheDocument();

    fireEvent.submit(input.closest("form")!);
    expect(
      screen.getByText(/enter a valid bangladesh mobile number/i),
    ).toBeInTheDocument();
    expect(forgotPasswordAction).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "01712345678" } });
    expect(input.value).toBe("01712345678");
    expect(
      screen.queryByText(/enter a valid bangladesh mobile number/i),
    ).not.toBeInTheDocument();
  });

  it("keeps 01712345678 visible after blur while submitting +8801712345678 in FormData on phone tab", async () => {
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({});
    render(<ForgotPasswordForm />);

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));

    const input = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "01712345678" } });
    fireEvent.blur(input);

    expect(input.value).toBe("01712345678");

    const form = input.closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: "phone",
      identifier: "+8801712345678",
      context: "password_recovery",
    });
    const submittedFormData = vi.mocked(forgotPasswordAction).mock.calls[0]?.[1];
    expect(submittedFormData?.get("identifier")).toBe("+8801712345678");
  });

  it("does not validate email while typing or blurring before submit, validates on submit, and clears on change", () => {
    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    expect(input).toHaveAttribute("placeholder", "Enter your email");

    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.blur(input);
    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();

    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(forgotPasswordAction).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "u" } });
    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();
  });

  it("saves recovery draft with phone channel when a phone number is submitted on phone tab", async () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    const input = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "+8801712345678" } });
    expect(input.checkValidity()).toBe(true);

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: "phone",
      identifier: "+8801712345678",
      context: "password_recovery",
    });
  });

  it("fails browser constraint validation when a phone number is entered on email tab", () => {
    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "+8801712345678" } });

    expect(input.checkValidity()).toBe(false);
    expect(input.validity.typeMismatch).toBe(true);
  });

  it("clears verification draft and displays error on rejected submission", async () => {
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
      error: "Too many recovery attempts. Please try again later.",
    });

    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    const button = screen.getByRole("button", { name: /send reset code/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockClearVerificationDraft).toHaveBeenCalled();
      expect(
        screen.getByText(/too many recovery attempts/i),
      ).toBeInTheDocument();
    });
  });

  it("preserves active registration draft when recovery submission fails", async () => {
    const { saveVerificationDraft: actualSave, loadVerificationDraft: actualLoad } =
      await vi.importActual<typeof import("@/lib/auth/verification-draft")>(
        "@/lib/auth/verification-draft",
      );

    actualSave({
      channel: "email",
      identifier: "registering@example.com",
      context: "registration",
      expiresInSeconds: 300,
    });

    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
      error: "Service unavailable",
    });

    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    fireEvent.change(input, { target: { value: "other@example.com" } });

    const button = screen.getByRole("button", { name: /send reset code/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByText(/service unavailable/i)).toBeInTheDocument();
      const restored = actualLoad(null, Date.now(), "registration");
      expect(restored.draft).not.toBeNull();
      expect(restored.draft?.normalized_identifier).toBe("registering@example.com");
      expect(restored.draft?.context).toBe("registration");
    });
  });

  it("preserves existing recovery draft when a subsequent recovery request fails", async () => {
    const { saveVerificationDraft: actualSave, loadVerificationDraft: actualLoad } =
      await vi.importActual<typeof import("@/lib/auth/verification-draft")>(
        "@/lib/auth/verification-draft",
      );

    actualSave({
      channel: "email",
      identifier: "existing-recovery@example.com",
      context: "password_recovery",
      expiresInSeconds: 300,
    });

    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
      error: "Rate limit exceeded. Please wait 60 seconds.",
    });

    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    fireEvent.change(input, { target: { value: "new-attempt@example.com" } });

    const button = screen.getByRole("button", { name: /send reset code/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/rate limit exceeded/i),
      ).toBeInTheDocument();
      const restored = actualLoad(null, Date.now(), "password_recovery");
      expect(restored.draft).not.toBeNull();
      expect(restored.draft?.normalized_identifier).toBe("existing-recovery@example.com");
      expect(restored.draft?.context).toBe("password_recovery");
    });
  });

  it("clears storage and does not restore previously captured draft if its original expiry has passed during request", async () => {
    const { saveVerificationDraft: actualSave, loadVerificationDraft: actualLoad } =
      await vi.importActual<typeof import("@/lib/auth/verification-draft")>(
        "@/lib/auth/verification-draft",
      );

    let currentTime = 1700000000000;
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => currentTime);

    try {
      actualSave(
        {
          channel: "email",
          identifier: "almost-expired@example.com",
          context: "password_recovery",
          expiresInSeconds: 60,
        },
        currentTime,
      );

      // Verify draft is active before and at start of submission
      const activeBeforeSubmit = actualLoad(null, currentTime, "password_recovery");
      expect(activeBeforeSubmit.draft).not.toBeNull();
      expect(activeBeforeSubmit.expired).toBe(false);

      vi.mocked(forgotPasswordAction).mockImplementationOnce(async () => {
        // While request is pending, advance clock past the draft's 60s expiry
        currentTime += 75 * 1000;
        return { error: "Submission rejected" };
      });

      render(<ForgotPasswordForm />);

      const input = screen.getByLabelText(/^email$/i);
      fireEvent.change(input, { target: { value: "retry@example.com" } });

      const button = screen.getByRole("button", { name: /send reset code/i });
      await act(async () => {
        fireEvent.click(button);
      });

      await waitFor(() => {
        expect(screen.getByText(/submission rejected/i)).toBeInTheDocument();
        expect(mockClearVerificationDraft).toHaveBeenCalled();
        const check = actualLoad(null, currentTime);
        expect(check.draft).toBeNull();
      });
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("auto-dismisses channel-specific 404 AuthAlert on input focus or change and re-displays on resubmit", async () => {
    vi.mocked(forgotPasswordAction)
      .mockResolvedValueOnce({
        error: "No account found with this email address.",
        status: 404,
      })
      .mockResolvedValueOnce({
        error: "No account found with this phone number.",
        status: 404,
      });

    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    const button = screen.getByRole("button", { name: /send reset code/i });
    fireEvent.change(input, { target: { value: "missing@example.com" } });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(
      screen.getByText(/no account found with this email address\./i),
    ).toBeInTheDocument();

    fireEvent.focus(input);
    expect(
      screen.queryByText(/no account found with this email address\./i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i);
    fireEvent.change(phoneInput, { target: { value: "01712345678" } });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(
      screen.getByText(/no account found with this phone number\./i),
    ).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: "01712345679" } });
    expect(
      screen.queryByText(/no account found with this phone number\./i),
    ).not.toBeInTheDocument();
  });

  it("validates empty email on submit without validating blur and clears error onChange", () => {
    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    const form = input.closest("form")!;

    fireEvent.blur(input);
    expect(screen.queryByText(/enter your email address\./i)).not.toBeInTheDocument();

    fireEvent.submit(form);
    expect(screen.getByText(/enter your email address\./i)).toBeInTheDocument();

    fireEvent.blur(input);
    expect(screen.getByText(/enter your email address\./i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "a" } });
    expect(screen.queryByText(/enter your email address\./i)).not.toBeInTheDocument();
  });

  it("focuses the invalid input when submit-time validation blocks recovery", async () => {
    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/^email$/i);
    const form = input.closest("form")!;

    fireEvent.submit(form);
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(document.activeElement).toBe(input);
    });
  });

  it("keeps Send Reset Code button visible (disabled) with inline timer on 429 RESEND_COOLDOWN_ACTIVE and removes timer at 00:00", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-16T17:00:00.000Z"));
      vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
        error: "Wait before requesting another code",
        status: 429,
        code: "RESEND_COOLDOWN_ACTIVE",
        retryAfterSeconds: 19,
      });

      render(<ForgotPasswordForm />);

      const input = screen.getByLabelText(/^email$/i);
      fireEvent.change(input, { target: { value: "mhemon.dev7@gmail.com" } });

      const button = screen.getByRole("button", { name: /^send reset code$/i });
      await act(async () => {
        fireEvent.click(button);
      });

      expect(
        screen.queryByText(/wait before requesting another code/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/try again in/i)).not.toBeInTheDocument();

      const disabledBtn = screen.getByRole("button", {
        name: /^send reset code$/i,
      });
      expect(disabledBtn).toBeInTheDocument();
      expect(disabledBtn).toBeDisabled();

      const timerEl = screen.getByTestId("forgot-password-cooldown");
      expect(timerEl).toHaveTextContent(/resend available in 00:19/i);
      expect(timerEl).toHaveAttribute("aria-live", "off");

      const liveRegion = screen.getByRole("region", {
        name: /reset code cooldown status/i,
      });
      expect(liveRegion).toHaveAttribute("aria-live", "polite");
      expect(liveRegion).toHaveTextContent(
        /reset code cooldown started\. you must wait until the timer finishes before requesting a new code\./i,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(liveRegion).toHaveTextContent(
        /reset code cooldown started\. you must wait until the timer finishes before requesting a new code\./i,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(18_000);
      });

      expect(
        screen.queryByTestId("forgot-password-cooldown"),
      ).not.toBeInTheDocument();
      expect(liveRegion).toHaveTextContent(
        /you can now request a password reset code\./i,
      );
      const readyBtn = screen.getByRole("button", { name: /^send reset code$/i });
      expect(readyBtn).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks submission with an actionable error when sessionStorage is unavailable so users do not dead-end on /reset-password", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage disabled", "SecurityError");
      });
    try {
      render(<ForgotPasswordForm />);
      const input = screen.getByLabelText(/^email$/i);
      fireEvent.change(input, { target: { value: "user@example.com" } });
      fireEvent.submit(input.closest("form")!);

      expect(forgotPasswordAction).not.toHaveBeenCalled();
      expect(
        screen.getByText(/browser session storage is unavailable/i),
      ).toBeInTheDocument();
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
