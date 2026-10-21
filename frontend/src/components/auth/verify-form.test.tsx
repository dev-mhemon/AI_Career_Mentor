import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VerifyForm } from "@/components/auth/verify-form";
import { resendOtpAction } from "@/lib/auth/actions";
import { useSearchParams } from "next/navigation";

vi.mock("@/lib/auth/actions", () => ({
  verifyOtpAction: vi.fn(),
  resendOtpAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

describe("VerifyForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders invalid link message when params are missing", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams());
    render(<VerifyForm />);
    expect(screen.getByText(/invalid verification link/i)).toBeInTheDocument();
  });

  it("renders form fields correctly with email type", () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("?type=email&identifier=test@example.com"));
    render(<VerifyForm />);
    expect(screen.getByLabelText(/enter the verification code sent to your email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verify code/i })).toBeInTheDocument();
  });

  it("calls resendOtpAction on resend click and shows rate limit error", async () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("?type=email&identifier=test@example.com"));
    vi.mocked(resendOtpAction).mockResolvedValueOnce({ error: "Email delivery is temporarily rate-limited. Please try again later." });

    render(<VerifyForm />);
    
    const resendButton = screen.getByRole("button", { name: /resend verification code/i });
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(resendOtpAction).toHaveBeenCalledWith("email", "test@example.com");
      expect(screen.getByText(/email delivery is temporarily rate-limited/i)).toBeInTheDocument();
    });
  });

  it("shows success message and starts cooldown on successful resend", async () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams("?type=email&identifier=test@example.com"));
    vi.mocked(resendOtpAction).mockResolvedValueOnce({ success: true });

    render(<VerifyForm />);
    
    const resendButton = screen.getByRole("button", { name: /resend verification code/i });
    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
      expect(resendButton).toBeDisabled();
      expect(resendButton).toHaveTextContent(/resend code in 60s/i);
    });
  });
});
