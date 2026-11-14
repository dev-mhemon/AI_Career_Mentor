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
    expect(screen.getByLabelText(/registered email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset code/i }),
    ).toBeInTheDocument();
  });

  it("switches to phone channel when phone tab is clicked", () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    expect(screen.getByLabelText(/registered phone number/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("01712-345678"),
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

    const input = screen.getByLabelText(/registered email/i);
    fireEvent.change(input, { target: { value: "user@example.com" } });

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: "email",
      identifier: "user@example.com",
      context: "password_recovery",
    });
  });

  it("strips non-digits from phone_bd input on phone tab and flags invalid prefix immediately onChange", async () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    const input = screen.getByLabelText(/registered phone number/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "017742590012dddddddd12" } });
    expect(input.value).toBe("01774259001212");
    expect(screen.getByText(/must be 11 digits/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "01712345678" } });
    expect(input.value).toBe("01712345678");
    expect(screen.queryByText(/must be 11 digits/i)).not.toBeInTheDocument();
  });

  it("keeps 01712345678 visible after blur while submitting +8801712345678 in FormData on phone tab", async () => {
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({});
    render(<ForgotPasswordForm />);

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));

    const input = screen.getByLabelText(/registered phone number/i) as HTMLInputElement;
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

  it("validates email in real time onChange without waiting for blur", () => {
    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/registered email/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "user@example.com" } });
    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();
  });

  it("saves recovery draft with phone channel when a phone number is submitted on phone tab", async () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    const input = screen.getByLabelText(/registered phone number/i) as HTMLInputElement;
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

    const input = screen.getByLabelText(/registered email/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "+8801712345678" } });

    expect(input.checkValidity()).toBe(false);
    expect(input.validity.typeMismatch).toBe(true);
  });

  it("clears verification draft and displays error on rejected submission", async () => {
    vi.mocked(forgotPasswordAction).mockResolvedValueOnce({
      error: "Too many recovery attempts. Please try again later.",
    });

    render(<ForgotPasswordForm />);

    const input = screen.getByLabelText(/registered email/i);
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

    const input = screen.getByLabelText(/registered email/i);
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

    const input = screen.getByLabelText(/registered email/i);
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

      const input = screen.getByLabelText(/registered email/i);
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
});
