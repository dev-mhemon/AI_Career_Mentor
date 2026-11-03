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
    clearVerificationDraft: () => mockClearVerificationDraft(),
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

    expect(screen.getByRole("button", { name: /^email$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^phone$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/registered email/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send reset code/i }),
    ).toBeInTheDocument();
  });

  it("switches to phone channel when phone tab is clicked", () => {
    render(<ForgotPasswordForm />);

    const phoneTab = screen.getByRole("button", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    expect(screen.getByLabelText(/registered phone number/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("+8801712345678"),
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
});
