import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { RegisterForm } from "@/components/auth/register-form";
import { registerAction } from "@/lib/auth/actions";

const mockClearVerificationDraft = vi.fn();
const mockSaveVerificationDraft = vi.fn();

vi.mock("@/lib/auth/actions", () => ({
  registerAction: vi.fn(),
}));

vi.mock("@/lib/auth/verification-draft", () => ({
  saveVerificationDraft: (...args: unknown[]) => mockSaveVerificationDraft(...args),
  clearVerificationDraft: () => mockClearVerificationDraft(),
}));

vi.mock("@/components/auth/oauth-buttons", () => ({
  OAuthButtons: () => <div data-testid="oauth-buttons">OAuth Buttons</div>,
}));

describe("RegisterForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(registerAction).mockResolvedValue({});
  });

  it("renders email, password, and confirm password fields", () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("renders privacy consent checkbox", () => {
    render(<RegisterForm />);

    expect(
      screen.getByLabelText(/agree to the privacy policy/i),
    ).toBeInTheDocument();
  });

  it("renders the create account button", () => {
    render(<RegisterForm />);

    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
  });

  it("renders OAuth buttons", () => {
    render(<RegisterForm />);

    expect(screen.getByTestId("oauth-buttons")).toBeInTheDocument();
  });

  it("renders a link to the login page", () => {
    render(<RegisterForm />);

    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/login");
  });

  it("has minimum length on password fields", () => {
    render(<RegisterForm />);

    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    expect(passwordInput).toHaveAttribute("minLength", "8");
    expect(confirmInput).toHaveAttribute("minLength", "8");
  });

  it("clears verification draft on rejected submission with state error", async () => {
    vi.mocked(registerAction).mockResolvedValueOnce({
      error: "Registration failed. User already exists.",
    });

    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByLabelText(/agree to the privacy policy/i));

    const button = screen.getByRole("button", { name: /create account/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockClearVerificationDraft).toHaveBeenCalled();
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument();
    });
  });

  it("switches to phone tab and saves phone verification draft on submit", async () => {
    render(<RegisterForm />);

    const phoneTab = screen.getByRole("tab", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    expect(screen.getByLabelText(/^phone number$/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("01712-345678")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^phone number$/i), {
      target: { value: "+8801712345678" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByLabelText(/agree to the privacy policy/i));

    const form = screen.getByRole("button", { name: /create account/i }).closest("form");
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: "phone",
      identifier: "+8801712345678",
      context: "registration",
    });
  });

  it("keeps 01712345678 visible after blur while submitting +8801712345678 in FormData", async () => {
    render(<RegisterForm />);

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));

    const phoneInput = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "01712345678" } });
    fireEvent.blur(phoneInput);

    expect(phoneInput.value).toBe("01712345678");

    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "password123" },
    });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByLabelText(/agree to the privacy policy/i));

    const form = phoneInput.closest("form")!;
    const formDataBeforeSubmit = new FormData(form);
    expect(formDataBeforeSubmit.get("identifier")).toBe("+8801712345678");

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(registerAction).toHaveBeenCalled();
    const submittedFormData = vi.mocked(registerAction).mock.calls[0]?.[1];
    expect(submittedFormData?.get("identifier")).toBe("+8801712345678");
    expect(phoneInput.value).toBe("01712345678");
  });

  it("validates email, BD phone, password, and confirm password live onChange without waiting for blur", () => {
    render(<RegisterForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    fireEvent.change(emailInput, { target: { value: "bad-email" } });
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: "valid@example.com" } });
    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();

    const passwordInput = screen.getByLabelText(/^password$/i);
    fireEvent.change(passwordInput, { target: { value: "short" } });
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "longenough8" } });
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();

    const confirmInput = screen.getByLabelText(/confirm password/i);
    fireEvent.change(confirmInput, { target: { value: "longenough9" } });
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();

    fireEvent.change(confirmInput, { target: { value: "longenough8" } });
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "012" } });
    expect(screen.getByText(/prefix must be 013/i)).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: "01712345678" } });
    expect(screen.queryByText(/prefix must be 013/i)).not.toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: "017123456789" } });
    expect(screen.getByText(/must be 11 digits/i)).toBeInTheDocument();
  });

  it("auto-dismisses AuthAlert on input focus or change and re-displays on new server error", async () => {
    vi.mocked(registerAction)
      .mockResolvedValueOnce({
        error: "Registration failed first time.",
        status: 400,
      })
      .mockResolvedValueOnce({
        error: "An account already exists with this contact.",
        status: 409,
      });

    render(<RegisterForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const consentCheckbox = screen.getByLabelText(/agree to the privacy policy/i);
    const form = emailInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.change(confirmInput, { target: { value: "password123" } });
    fireEvent.click(consentCheckbox);

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/registration failed first time\./i)).toBeInTheDocument();

    fireEvent.focus(passwordInput);
    expect(screen.queryByText(/registration failed first time\./i)).not.toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: "test@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "password123" } });
    fireEvent.change(confirmInput, { target: { value: "password123" } });
    if (!consentCheckbox.hasAttribute("checked") && !(consentCheckbox as HTMLInputElement).checked) {
      fireEvent.click(consentCheckbox);
    }

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(
      screen.getByText(/an account already exists with this contact\./i),
    ).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: "other@example.com" } });
    expect(
      screen.queryByText(/an account already exists with this contact\./i),
    ).not.toBeInTheDocument();
  });
});
