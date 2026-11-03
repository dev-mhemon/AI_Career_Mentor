import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "@/components/auth/login-form";
import { saveVerificationDraft } from "@/lib/auth/verification-draft";

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

  it("has required attributes on identifier and password inputs", () => {
    render(<LoginForm />);

    const identifierInput = screen.getByLabelText(/email or phone/i);
    const passwordInput = screen.getByLabelText(/^password$/i);

    expect(identifierInput).toBeRequired();
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toBeRequired();
  });
});
