import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "@/components/auth/login-form";

// Mock the auth actions module
vi.mock("@/lib/auth/actions", () => ({
  loginAction: vi.fn(),
}));

// Mock the OAuthButtons component to isolate LoginForm testing
vi.mock("@/components/auth/oauth-buttons", () => ({
  OAuthButtons: () => <div data-testid="oauth-buttons">OAuth Buttons</div>,
}));

describe("LoginForm", () => {
  it("renders email and password fields", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
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

  it("has required attributes on email and password inputs", () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    expect(emailInput).toHaveAttribute("type", "email");
    expect(emailInput).toBeRequired();
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput).toBeRequired();
  });
});
