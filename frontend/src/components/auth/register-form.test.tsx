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

    const phoneTab = screen.getByRole("button", { name: /^phone$/i });
    fireEvent.click(phoneTab);

    expect(screen.getByLabelText(/^phone number$/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("+8801712345678")).toBeInTheDocument();

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
});
