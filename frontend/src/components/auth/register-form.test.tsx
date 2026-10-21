import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegisterForm } from "@/components/auth/register-form";

vi.mock("@/lib/auth/actions", () => ({
  registerAction: vi.fn(),
}));

vi.mock("@/components/auth/oauth-buttons", () => ({
  OAuthButtons: () => <div data-testid="oauth-buttons">OAuth Buttons</div>,
}));

describe("RegisterForm", () => {
  it("renders email, password, and confirm password fields", () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
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

    expect(passwordInput).toHaveAttribute("minLength", "6");
    expect(confirmInput).toHaveAttribute("minLength", "6");
  });
});
