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

  it("renders personalized Evernote-style Google card with avatar, two-line text, and normal Facebook button", async () => {
    vi.mocked(signInWithOAuth).mockResolvedValueOnce({});
    render(
      <OAuthButtons
        oauthHint={{
          provider: "google",
          displayName: "Mehedi",
          email: "mehediemon7@gmail.com",
          avatarUrl: "https://lh3.googleusercontent.com/avatar.png",
        }}
      />,
    );

    const googleBtn = screen.getByRole("button", {
      name: /continue as mehedi with google/i,
    });
    expect(googleBtn).toBeInTheDocument();
    expect(googleBtn).toHaveTextContent("Continue as Mehedi");
    expect(googleBtn).toHaveTextContent("mehediemon7@gmail.com");

    const img = googleBtn.querySelector("img");
    expect(img).toHaveAttribute(
      "src",
      "https://lh3.googleusercontent.com/avatar.png",
    );

    expect(
      screen.getByRole("button", { name: /continue with facebook/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(googleBtn);
    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("google");
    });
  });

  it("renders personalized Facebook card with initial badge when avatar fails to load or is absent, keeping Google normal", async () => {
    vi.mocked(signInWithOAuth).mockResolvedValueOnce({});
    const { container } = render(
      <OAuthButtons
        oauthHint={{
          provider: "facebook",
          displayName: "Rahim Uddin",
          email: "rahim@example.com",
          avatarUrl: "https://graph.facebook.com/broken.jpg",
        }}
      />,
    );

    const fbBtn = screen.getByRole("button", {
      name: /continue as rahim uddin with facebook/i,
    });
    const img = fbBtn.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(fbBtn.querySelector("img")).toBeNull();
    expect(fbBtn).toHaveTextContent("RU");
    expect(fbBtn).toHaveTextContent("Continue as Rahim Uddin");
    expect(fbBtn).toHaveTextContent("rahim@example.com");

    const buttons = container.querySelectorAll("button");
    expect(buttons[0]).toBe(fbBtn);
    expect(buttons[1]).toHaveTextContent("Continue with Google");

    fireEvent.click(fbBtn);
    await waitFor(() => {
      expect(signInWithOAuth).toHaveBeenCalledWith("facebook");
    });
  });
});
