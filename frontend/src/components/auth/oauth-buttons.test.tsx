import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { signInWithOAuth } from "@/lib/auth/actions";

vi.mock("@/lib/auth/actions", () => ({
  signInWithOAuth: vi.fn(),
}));

describe("OAuthButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Google and Facebook buttons", () => {
    render(<OAuthButtons />);

    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with facebook/i }),
    ).toBeInTheDocument();
  });

  it("calls signInWithOAuth with google when Google button is clicked", async () => {
    vi.mocked(signInWithOAuth).mockResolvedValueOnce({});
    render(<OAuthButtons />);

    fireEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("google");
    });
  });

  it("calls signInWithOAuth with facebook when Facebook button is clicked", async () => {
    vi.mocked(signInWithOAuth).mockResolvedValueOnce({});
    render(<OAuthButtons />);

    fireEvent.click(
      screen.getByRole("button", { name: /continue with facebook/i }),
    );

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("facebook");
    });
  });

  it("renders error message with role='alert' when signInWithOAuth returns an error", async () => {
    vi.mocked(signInWithOAuth).mockResolvedValueOnce({
      error: "Failed to initiate OAuth login. Missing redirect URL.",
    });

    render(<OAuthButtons />);

    fireEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      "Failed to initiate OAuth login. Missing redirect URL.",
    );
  });

  it("renders fallback error message with role='alert' on unexpected exception", async () => {
    vi.mocked(signInWithOAuth).mockRejectedValueOnce(
      new Error("Network failure"),
    );

    render(<OAuthButtons />);

    fireEvent.click(
      screen.getByRole("button", { name: /continue with facebook/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      "Failed to initiate OAuth login. Please try again.",
    );
  });

  it("does not render error message when NEXT_REDIRECT is thrown", async () => {
    vi.mocked(signInWithOAuth).mockRejectedValueOnce(
      new Error("NEXT_REDIRECT"),
    );

    render(<OAuthButtons />);

    fireEvent.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );

    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("google");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
