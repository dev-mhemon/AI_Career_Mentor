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
    expect(screen.getByText("+88")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("01XXXXXXXXX")).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
      "placeholder",
      "Password",
    );
    expect(screen.getByLabelText(/confirm password/i)).toHaveAttribute(
      "placeholder",
      "Confirm password",
    );

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

  it("does not validate while typing or blurring before submit, validates on submit, clears errors onChange, and shows updated helper & color-coded strength", () => {
    render(<RegisterForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    expect(emailInput).toHaveAttribute("placeholder", "Enter your email");
    expect(
      screen.getByText(
        /must be at least 8 characters\. mixed with uppercase, lowercase, numbers, and symbols is stronger\./i,
      ),
    ).toBeInTheDocument();

    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const form = emailInput.closest("form")!;

    // Typing partial/mismatched values before submit triggers zero errors
    fireEvent.change(emailInput, { target: { value: "bad-email" } });
    fireEvent.blur(emailInput);
    fireEvent.change(passwordInput, { target: { value: "short" } });
    fireEvent.blur(passwordInput);
    fireEvent.change(confirmInput, { target: { value: "different" } });
    fireEvent.blur(confirmInput);

    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();

    // Submit displays all validation errors
    fireEvent.submit(form);
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(
      screen.getByText(/you must agree to the privacy policy to continue\./i),
    ).toBeInTheDocument();
    expect(registerAction).not.toHaveBeenCalled();

    // Editing fields clears their errors immediately and shows color-coded strength labels
    fireEvent.change(emailInput, { target: { value: "v" } });
    expect(screen.queryByText(/enter a valid email address/i)).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "lowercase1" } });
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();
    const weakLabel = screen.getByText("Weak");
    expect(weakLabel).toHaveClass("font-semibold", "tracking-wide", "text-red-600");

    fireEvent.change(passwordInput, { target: { value: "Abcd1234" } });
    const fairLabel = screen.getByText("Fair");
    expect(fairLabel).toHaveClass("font-semibold", "tracking-wide", "text-amber-600");

    fireEvent.change(passwordInput, { target: { value: "Abcd1234!xyz" } });
    const strongLabel = screen.getByText("Strong");
    expect(strongLabel).toHaveClass(
      "font-semibold",
      "tracking-wide",
      "text-emerald-600",
    );

    fireEvent.change(confirmInput, { target: { value: "A" } });
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();

    // Phone tab validates on submit and clears on change
    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "012" } });
    fireEvent.blur(phoneInput);
    expect(
      screen.queryByText(/enter a valid bangladesh mobile number/i),
    ).not.toBeInTheDocument();

    fireEvent.submit(phoneInput.closest("form")!);
    expect(
      screen.getByText(/enter a valid bangladesh mobile number/i),
    ).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: "017" } });
    expect(
      screen.queryByText(/enter a valid bangladesh mobile number/i),
    ).not.toBeInTheDocument();
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

  it("validates empty password on submit, preserves error across blur/toggle focus, and clears onChange", () => {
    render(<RegisterForm />);

    const passwordInput = screen.getByLabelText(/^password$/i);
    const showPasswordBtns = screen.getAllByRole("button", { name: /show password/i });
    const form = passwordInput.closest("form")!;

    fireEvent.blur(passwordInput);
    expect(
      screen.queryByText(/password must be at least 8 characters\./i),
    ).not.toBeInTheDocument();

    fireEvent.submit(form);
    expect(
      screen.getByText(/password must be at least 8 characters\./i),
    ).toBeInTheDocument();

    fireEvent.blur(passwordInput, { relatedTarget: showPasswordBtns[0] });
    fireEvent.blur(passwordInput);
    expect(
      screen.getByText(/password must be at least 8 characters\./i),
    ).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "a" } });
    expect(
      screen.queryByText(/password must be at least 8 characters\./i),
    ).not.toBeInTheDocument();
  });

  it("keeps privacy policy checkbox checked across form submission, native reset, and server error responses", async () => {
    vi.mocked(registerAction).mockResolvedValueOnce({
      error: "Email delivery is temporarily rate-limited. Please try again later.",
      status: 429,
      code: "OTP_LIMIT_EXCEEDED",
      retryAfterSeconds: 60,
    });

    render(<RegisterForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const consentCheckbox = screen.getByLabelText(/agree to the privacy policy/i) as HTMLInputElement;
    const submitBtn = screen.getByRole("button", { name: /create account/i });

    fireEvent.change(emailInput, { target: { value: "mehediemon7@gmail.com" } });
    fireEvent.change(passwordInput, { target: { value: "Password123!" } });
    fireEvent.change(confirmInput, { target: { value: "Password123!" } });
    fireEvent.click(consentCheckbox);
    expect(consentCheckbox).toBeChecked();

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(vi.mocked(registerAction)).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/01:00/i)).toBeInTheDocument();
    });
    expect(consentCheckbox).toBeChecked();
    expect(consentCheckbox.checked).toBe(true);
  });

  it("preserves typed email and phone independently when switching between Email and Phone tabs", () => {
    render(<RegisterForm />);

    const emailInput = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    fireEvent.change(emailInput, { target: { value: "mehediemon7@gmail.com" } });

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    expect(phoneInput.value).toBe("");
    fireEvent.change(phoneInput, { target: { value: "01629795421" } });

    fireEvent.click(screen.getByRole("tab", { name: /^email$/i }));
    expect((screen.getByLabelText(/^email$/i) as HTMLInputElement).value).toBe(
      "mehediemon7@gmail.com",
    );

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    expect((screen.getByLabelText(/^phone number$/i) as HTMLInputElement).value).toBe(
      "01629795421",
    );
  });
});
