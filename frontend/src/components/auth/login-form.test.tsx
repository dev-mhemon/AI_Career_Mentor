import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LoginForm } from "@/components/auth/login-form";
import {
  saveVerificationDraft,
  loadVerificationDraft,
} from "@/lib/auth/verification-draft";
import { loginAction } from "@/lib/auth/actions";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock the auth actions module
vi.mock("@/lib/auth/actions", () => ({
  loginAction: vi.fn(),
}));

// Mock the OAuthButtons component to isolate LoginForm testing
vi.mock("@/components/auth/oauth-buttons", () => ({
  OAuthButtons: () => <div data-testid="oauth-buttons">OAuth Buttons</div>,
}));

const mockClearVerificationDraft = vi.fn();
vi.mock("@/lib/auth/verification-draft", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/auth/verification-draft")
  >("@/lib/auth/verification-draft");
  return {
    ...actual,
    clearVerificationDraft: () => mockClearVerificationDraft(),
  };
});

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("renders email/phone and password fields", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email or phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("renders the forgot password link pointing to /forgot-password", () => {
    render(<LoginForm />);

    const forgotLink = screen.getByRole("link", {
      name: /forgot password/i,
    });
    expect(forgotLink).toBeInTheDocument();
    expect(forgotLink).toHaveAttribute("href", "/forgot-password");
  });

  it("renders the sign in button", () => {
    render(<LoginForm />);

    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("renders OAuth buttons", () => {
    render(<LoginForm />);

    expect(screen.getByTestId("oauth-buttons")).toBeInTheDocument();
  });

  it("renders a link to the registration page", () => {
    render(<LoginForm />);

    const link = screen.getByRole("link", { name: /sign up/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/register");
  });

  it("renders initial error alert when initialError is passed", () => {
    render(<LoginForm initialError="Authentication failed. Please try again." />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("Authentication failed. Please try again.");
  });

  it("renders success alert and clears verification draft when successMessage is passed", () => {
    saveVerificationDraft({
      channel: "email",
      identifier: "user@example.com",
      context: "password_recovery",
    });

    render(
      <LoginForm successMessage="Password reset successfully. Please sign in with your new password." />,
    );

    expect(
      screen.getByText(/password reset successfully/i),
    ).toBeInTheDocument();
    expect(mockClearVerificationDraft).toHaveBeenCalled();
  });

  it("does not clear draft on successMessage if draft context is registration", () => {
    saveVerificationDraft({
      channel: "email",
      identifier: "user@example.com",
      context: "registration",
    });

    render(
      <LoginForm successMessage="Password reset successfully. Please sign in with your new password." />,
    );

    expect(
      screen.getByText(/password reset successfully/i),
    ).toBeInTheDocument();
    expect(mockClearVerificationDraft).not.toHaveBeenCalled();
  });

  it("has required attributes on identifier and password inputs and accepts Bangladesh phone format", () => {
    render(<LoginForm />);

    const identifierInput = screen.getByLabelText(/email or phone/i);
    const passwordInput = screen.getByLabelText(/^password$/i);

    expect(identifierInput).toBeRequired();
    expect(identifierInput).toHaveAttribute(
      "placeholder",
      "you@example.com or +8801712345678",
    );
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toBeRequired();
  });

  it("captures identifier in onSubmit and saves unverified_login draft even if uncontrolled inputs reset", async () => {
    vi.mocked(loginAction).mockImplementation(async () => {
      // Simulate React 19 uncontrolled form input reset committing before effect
      const input = document.getElementById("email") as HTMLInputElement | null;
      if (input) input.value = "";
      return {
        error: "Please verify your contact before logging in.",
        redirectTo: "/verify?channel=phone",
      };
    });

    render(<LoginForm />);

    const identifierInput = screen.getByLabelText(/email or phone/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const form = identifierInput.closest("form")!;

    fireEvent.change(identifierInput, { target: { value: "+8801712345678" } });
    fireEvent.change(passwordInput, { target: { value: "secret123" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    const { draft } = loadVerificationDraft("phone", Date.now(), ["unverified_login"]);
    expect(draft).not.toBeNull();
    expect(draft?.normalized_identifier).toBe("+8801712345678");
    expect(draft?.context).toBe("unverified_login");
    expect(mockPush).toHaveBeenCalledWith("/verify?channel=phone");
  });

  it("validates email/phone and password in real time onChange without waiting for blur", () => {
    render(<LoginForm />);

    const identifierInput = screen.getByLabelText(/email or phone/i);
    const passwordInput = screen.getByLabelText(/^password$/i);

    fireEvent.change(identifierInput, { target: { value: "invalid@" } });
    expect(
      screen.getByText(/enter a valid email address or bangladesh mobile number/i),
    ).toBeInTheDocument();

    fireEvent.change(identifierInput, { target: { value: "012" } });
    expect(screen.getByText(/prefix must be 013/i)).toBeInTheDocument();

    fireEvent.change(identifierInput, { target: { value: "01712345678" } });
    expect(screen.queryByText(/prefix must be 013/i)).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "1234567" } });
    expect(
      screen.getByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "12345678" } });
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();
  });
});
