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
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("renders Email/Phone tabs, default Email field, and Password field", () => {
    render(<LoginForm />);

    expect(screen.getByRole("tab", { name: /^email$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^phone$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it("renders the forgot password link pointing to /forgot-password", () => {
    render(<LoginForm />);

    const forgotLink = screen.getByRole("link", {
      name: /^forgot password\?$/i,
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

  it("supports Phone tab with +88 prefix, local 017... display, and canonical +8801... FormData payload", async () => {
    vi.mocked(loginAction).mockResolvedValueOnce({});

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(emailInput).toBeRequired();
    expect(passwordInput).toBeRequired();
    expect(passwordInput).toHaveAttribute("placeholder", "Password");

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));

    const phoneInput = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    expect(phoneInput).toBeRequired();
    expect(screen.getByText("+88")).toBeInTheDocument();
    expect(screen.queryByText("+880")).not.toBeInTheDocument();
    expect(phoneInput).toHaveAttribute("placeholder", "01XXXXXXXXX");

    fireEvent.change(phoneInput, { target: { value: "01712345678" } });
    fireEvent.change(passwordInput, { target: { value: "secret123" } });

    const form = phoneInput.closest("form")!;
    const formDataBeforeSubmit = new FormData(form);
    expect(formDataBeforeSubmit.get("identifier")).toBe("+8801712345678");
    expect(phoneInput.value).toBe("01712345678");

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(loginAction).toHaveBeenCalledTimes(1);
    const submittedFormData = vi.mocked(loginAction).mock.calls[0]?.[1];
    expect(submittedFormData?.get("identifier")).toBe("+8801712345678");
    expect(phoneInput.value).toBe("01712345678");
  });

  it("captures normalized phone in onSubmit and saves unverified_login draft on redirect", async () => {
    vi.mocked(loginAction).mockImplementation(async () => ({
      error: "Please verify your contact before logging in.",
      redirectTo: "/verify?channel=phone",
    }));

    render(<LoginForm />);

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const form = phoneInput.closest("form")!;

    fireEvent.change(phoneInput, { target: { value: "01712345678" } });
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

  it("preserves typed email/phone and clears ONLY password when sign-in fails", async () => {
    vi.mocked(loginAction).mockResolvedValueOnce({
      error: "Invalid credentials. Please try again.",
      status: 401,
      code: "AUTH_INVALID_CREDENTIALS",
    });

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const rememberCheckbox = screen.getByRole("checkbox", {
      name: /^Keep Signed In$/,
    }) as HTMLInputElement;
    expect(rememberCheckbox.checked).toBe(false);

    const form = emailInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "wrongpass123" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(emailInput.value).toBe("user@example.com");
    expect(passwordInput.value).toBe("");
    expect(
      screen.getByText(/invalid credentials\. please try again\./i),
    ).toBeInTheDocument();
  });

  it("validates email, phone, and password in real time onChange without waiting for blur", () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);

    fireEvent.change(emailInput, { target: { value: "invalid@" } });
    expect(
      screen.getByText(/enter a valid email address/i),
    ).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    expect(
      screen.queryByText(/enter a valid email address/i),
    ).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "1234567" } });
    expect(
      screen.queryByText(/password must be at least 8 characters/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/enter your password/i),
    ).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "" } });
    expect(
      screen.getByText(/enter your password/i),
    ).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "1" } });
    expect(
      screen.queryByText(/enter your password/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i);

    fireEvent.change(phoneInput, { target: { value: "012" } });
    expect(screen.getByText(/prefix must be 013/i)).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: "01712345678" } });
    expect(screen.queryByText(/prefix must be 013/i)).not.toBeInTheDocument();
  });

  it("auto-dismisses AuthAlert on input focus or change and re-displays on subsequent error", async () => {
    vi.mocked(loginAction)
      .mockResolvedValueOnce({
        error: "No account found with this email address.",
        status: 404,
        code: "AUTH_USER_NOT_FOUND",
      })
      .mockResolvedValueOnce({
        error: "Invalid credentials. Please try again.",
        status: 401,
        code: "AUTH_INVALID_CREDENTIALS",
      });

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const form = emailInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "missing@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "123" } });

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(
      screen.getByText(/no account found with this email address\./i),
    ).toBeInTheDocument();

    fireEvent.focus(emailInput);
    expect(
      screen.queryByText(/no account found with this email address\./i),
    ).not.toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "wrongpass" } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(
      screen.getByText(/invalid credentials\. please try again\./i),
    ).toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "1234" } });
    expect(
      screen.queryByText(/invalid credentials/i),
    ).not.toBeInTheDocument();
  });

  it("includes rememberMe='on' in submitted FormData and stays checked while pending or after reset", async () => {
    let resolveLogin!: (val: Record<string, unknown>) => void;
    let submittedFormData: FormData | null = null;
    vi.mocked(loginAction).mockImplementationOnce(
      (_prev, formData) =>
        new Promise((resolve) => {
          submittedFormData = formData;
          resolveLogin = resolve;
        }),
    );

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const rememberCheckbox = screen.getByRole("checkbox", {
      name: /^Keep Signed In$/,
    }) as HTMLInputElement;
    const form = emailInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "validpass123" } });
    fireEvent.click(rememberCheckbox);
    expect(rememberCheckbox).toBeChecked();

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(submittedFormData).not.toBeNull();
    expect(submittedFormData!.get("rememberMe")).toBe("on");
    expect(rememberCheckbox).toBeChecked();
    expect(rememberCheckbox).not.toBeDisabled();

    await act(async () => {
      resolveLogin({});
    });

    expect(rememberCheckbox).toBeChecked();
    expect(emailInput).toHaveValue("user@example.com");
  });

  it("preserves both typed and remembered email and phone values and Keep Signed In across tab switches", () => {
    const { unmount } = render(
      <LoginForm
        initialRememberedLogin={{
          channel: "email",
          identifier: "saved@example.com",
          rememberMe: true,
        }}
      />,
    );

    expect(screen.getByLabelText(/^email$/i)).toHaveValue("saved@example.com");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i);
    fireEvent.change(phoneInput, { target: { value: "01712345678" } });

    fireEvent.click(screen.getByRole("tab", { name: /^email$/i }));
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("saved@example.com");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    expect(screen.getByLabelText(/^phone number$/i)).toHaveValue("01712345678");

    unmount();

    window.localStorage.clear();
    render(<LoginForm />);
    const freshEmail = screen.getByLabelText(/^email$/i);
    fireEvent.change(freshEmail, { target: { value: "typed@example.com" } });
    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    fireEvent.click(screen.getByRole("tab", { name: /^email$/i }));
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("typed@example.com");
  });

  it("restores saved Phone channel, identifier, and Keep Signed In checked across remount without storing password", async () => {
    vi.mocked(loginAction).mockResolvedValueOnce({});

    const { unmount } = render(<LoginForm />);

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i) as HTMLInputElement;
    expect(phoneInput).toHaveAttribute("autoComplete", "username");
    const passwordInput = screen.getByLabelText(/^password$/i);
    const rememberCheckbox = screen.getByRole("checkbox", {
      name: /^Keep Signed In$/,
    }) as HTMLInputElement;

    fireEvent.change(phoneInput, { target: { value: "01629795421" } });
    fireEvent.change(passwordInput, { target: { value: "supersecret99" } });
    fireEvent.click(rememberCheckbox);

    await act(async () => {
      fireEvent.submit(phoneInput.closest("form")!);
    });

    expect(window.localStorage.getItem("mentor_remembered_login")).not.toContain(
      "supersecret99",
    );

    unmount();
    render(<LoginForm />);

    const restoredPhoneInput = screen.getByLabelText(
      /^phone number$/i,
    ) as HTMLInputElement;
    const restoredRemember = screen.getByRole("checkbox", {
      name: /^Keep Signed In$/,
    }) as HTMLInputElement;
    expect(restoredPhoneInput.value).toBe("01629795421");
    expect(restoredRemember).toBeChecked();

    fireEvent.click(restoredRemember);
    expect(restoredRemember).not.toBeChecked();
    expect(window.localStorage.getItem("mentor_remembered_login")).toBeNull();
  });

  it("clears remembered login state when clearSavedLogin is true", () => {
    window.localStorage.setItem(
      "mentor_remembered_login",
      JSON.stringify({
        channel: "phone",
        identifier: "01629795421",
        rememberMe: true,
      }),
    );

    render(<LoginForm clearSavedLogin />);

    expect(window.localStorage.getItem("mentor_remembered_login")).toBeNull();
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).not.toBeChecked();
  });

  it("clears empty-password error on blur outside wrapper while preserving eye-toggle blur and submit validation", () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const showPasswordBtn = screen.getByRole("button", { name: /show password/i });
    const form = passwordInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "abc" } });
    fireEvent.change(passwordInput, { target: { value: "" } });
    expect(screen.getByText(/enter your password\./i)).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute("aria-invalid", "true");

    // Clicking the visibility toggle moves focus inside the wrapper and keeps validation state.
    fireEvent.blur(passwordInput, { relatedTarget: showPasswordBtn });
    expect(screen.getByText(/enter your password\./i)).toBeInTheDocument();

    // Moving focus from the visibility toggle outside the wrapper clears the empty-password error.
    fireEvent.blur(showPasswordBtn);
    expect(screen.queryByText(/enter your password\./i)).not.toBeInTheDocument();
    expect(passwordInput).not.toHaveAttribute("aria-invalid", "true");

    // Re-trigger via empty input edit, then blur directly outside the wrapper.
    fireEvent.change(passwordInput, { target: { value: "abc" } });
    fireEvent.change(passwordInput, { target: { value: "" } });
    expect(screen.getByText(/enter your password\./i)).toBeInTheDocument();
    fireEvent.blur(passwordInput);
    expect(screen.queryByText(/enter your password\./i)).not.toBeInTheDocument();
    expect(passwordInput).not.toHaveAttribute("aria-invalid", "true");

    // Submitting with an empty password still shows the required error.
    fireEvent.submit(form);
    expect(screen.getByText(/enter your password\./i)).toBeInTheDocument();
  });

  it("prefers newer client localStorage hint over initialRememberedLogin cookie and does not overwrite it", () => {
    const storedHint = {
      channel: "email",
      identifier: "stored@example.com",
      rememberMe: true,
    };
    window.localStorage.setItem(
      "mentor_remembered_login",
      JSON.stringify(storedHint),
    );

    render(
      <LoginForm
        initialRememberedLogin={{
          channel: "email",
          identifier: "cookie@example.com",
          rememberMe: true,
        }}
      />,
    );

    expect(screen.getByLabelText(/^email$/i)).toHaveValue("stored@example.com");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).toBeChecked();
    expect(
      JSON.parse(window.localStorage.getItem("mentor_remembered_login") ?? "{}"),
    ).toEqual(storedHint);
  });

  it("clears remembered state on storage-clear event without falling back to initialRememberedLogin", () => {
    render(
      <LoginForm
        initialRememberedLogin={{
          channel: "email",
          identifier: "cookie@example.com",
          rememberMe: true,
        }}
      />,
    );
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("cookie@example.com");

    act(() => {
      window.localStorage.removeItem("mentor_remembered_login");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "mentor_remembered_login",
          newValue: null,
        }),
      );
    });

    expect(screen.getByLabelText(/^email$/i)).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).not.toBeChecked();
  });

  it("keeps previously dismissed server fieldErrors.email dismissed when switching to Phone tab and back", async () => {
    vi.mocked(loginAction).mockResolvedValueOnce({
      error: "Validation failed.",
      fieldErrors: { email: "This email address cannot be used." },
      status: 400,
    });

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const form = emailInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "validpass123" } });

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(
      screen.getByText(/this email address cannot be used\./i),
    ).toBeInTheDocument();

    // Editing email dismisses server fieldErrors.email
    fireEvent.change(emailInput, { target: { value: "other@example.com" } });
    expect(
      screen.queryByText(/this email address cannot be used\./i),
    ).not.toBeInTheDocument();

    // Switching to Phone tab must NOT re-expose the obsolete server email error
    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    expect(
      screen.queryByText(/this email address cannot be used\./i),
    ).not.toBeInTheDocument();

    // Switching back to Email tab keeps it dismissed as well
    fireEvent.click(screen.getByRole("tab", { name: /^email$/i }));
    expect(
      screen.queryByText(/this email address cannot be used\./i),
    ).not.toBeInTheDocument();
  });
});
