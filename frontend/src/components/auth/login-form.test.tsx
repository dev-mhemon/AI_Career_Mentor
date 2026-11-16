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

  it("does not validate while typing or blurring before submit, validates email/phone/password on submit, and clears field errors on change", () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    expect(emailInput).toHaveAttribute("placeholder", "Enter your email");
    const passwordInput = screen.getByLabelText(/^password$/i);
    const form = emailInput.closest("form")!;

    // Typing and blurring partial values before submit does not show errors
    fireEvent.change(emailInput, { target: { value: "ss" } });
    fireEvent.blur(emailInput);
    expect(
      screen.queryByText(/enter a valid email address/i),
    ).not.toBeInTheDocument();

    // Submit runs full validation
    fireEvent.submit(form);
    expect(
      screen.getByText(/enter a valid email address/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(loginAction).not.toHaveBeenCalled();

    // Editing errored fields clears each field's error immediately
    fireEvent.change(emailInput, { target: { value: "u" } });
    expect(
      screen.queryByText(/enter a valid email address/i),
    ).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: "1" } });
    expect(
      screen.queryByText(/enter your password/i),
    ).not.toBeInTheDocument();

    // Same pattern on Phone tab
    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i);

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

  it("clears localStorage remembered hint, resets email/phone inputs, and unchecks Keep Signed In when landing on /login after account deletion (clearSavedLogin or initialRememberedLogin=null)", () => {
    window.localStorage.setItem(
      "mentor_remembered_login",
      JSON.stringify({
        channel: "phone",
        identifier: "01629795421",
        rememberMe: true,
      }),
    );
    document.cookie = "mentor_login_hint=stale; path=/";

    render(<LoginForm initialRememberedLogin={null} clearSavedLogin={false} />);

    expect(window.localStorage.getItem("mentor_remembered_login")).toBeNull();
    expect(document.cookie).not.toContain("mentor_login_hint=");
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    expect(screen.getByLabelText(/^phone number$/i)).toHaveValue("");
  });

  it("triggers empty-password validation only on submit, preserves state on blur/toggle, and clears error onChange", () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const showPasswordBtn = screen.getByRole("button", { name: /show password/i });
    const form = passwordInput.closest("form")!;

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "abc" } });
    fireEvent.change(passwordInput, { target: { value: "" } });
    expect(screen.queryByText(/enter your password\./i)).not.toBeInTheDocument();

    fireEvent.blur(passwordInput);
    expect(screen.queryByText(/enter your password\./i)).not.toBeInTheDocument();

    fireEvent.submit(form);
    expect(screen.getByText(/enter your password\./i)).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute("aria-invalid", "true");

    // Moving focus to the visibility toggle or outside does not trigger or hide submit errors
    fireEvent.blur(passwordInput, { relatedTarget: showPasswordBtn });
    fireEvent.blur(showPasswordBtn);
    expect(screen.getByText(/enter your password\./i)).toBeInTheDocument();

    // Typing clears the password error immediately
    fireEvent.change(passwordInput, { target: { value: "a" } });
    expect(screen.queryByText(/enter your password\./i)).not.toBeInTheDocument();
    expect(passwordInput).not.toHaveAttribute("aria-invalid", "true");
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

  it("clears remembered state and expires hint cookie on storage-clear event without falling back to initialRememberedLogin", () => {
    document.cookie = "mentor_login_hint=stale; path=/";
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
    expect(document.cookie).not.toContain("mentor_login_hint=");
  });

  it("unchecks Keep Signed In override and expires cookie on external removal after failed submit while preserving typed email", async () => {
    vi.mocked(loginAction).mockResolvedValueOnce({
      error: "Invalid credentials.",
      status: 401,
    });
    document.cookie = "mentor_login_hint=stale; path=/";

    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/^email$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const checkbox = screen.getByRole("checkbox", { name: /^Keep Signed In$/ });

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "WrongPass1!" } });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    await act(async () => {
      fireEvent.submit(emailInput.closest("form")!);
    });
    expect(checkbox).toBeChecked();

    act(() => {
      window.localStorage.removeItem("mentor_remembered_login");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "mentor_remembered_login",
          newValue: null,
        }),
      );
    });

    expect(checkbox).not.toBeChecked();
    expect(emailInput).toHaveValue("user@example.com");
    expect(document.cookie).not.toContain("mentor_login_hint=");
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

  it("shows channel-specific not-found messages for deleted/missing phone or email instead of overwriting 401 with generic credentials copy", async () => {
    vi.mocked(loginAction).mockResolvedValueOnce({
      error: "No account found with this phone number.",
      status: 401,
      code: "AUTH_REQUIRED",
    });

    render(<LoginForm />);

    fireEvent.click(screen.getByRole("tab", { name: /^phone$/i }));
    const phoneInput = screen.getByLabelText(/^phone number$/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    fireEvent.change(phoneInput, { target: { value: "01629795421" } });
    fireEvent.change(passwordInput, { target: { value: "ValidPass1!" } });

    await act(async () => {
      fireEvent.submit(phoneInput.closest("form")!);
    });

    expect(
      screen.getByText("No account found with this phone number."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Invalid credentials. Please try again."),
    ).not.toBeInTheDocument();

    vi.mocked(loginAction).mockResolvedValueOnce({
      error: "No account found with this email address.",
      status: 404,
      code: "ACCOUNT_DELETED",
    });

    fireEvent.click(screen.getByRole("tab", { name: /^email$/i }));
    const emailInput = screen.getByLabelText(/^email$/i);
    fireEvent.change(emailInput, { target: { value: "deleted@example.com" } });
    fireEvent.change(passwordInput, { target: { value: "ValidPass1!" } });

    await act(async () => {
      fireEvent.submit(emailInput.closest("form")!);
    });

    expect(
      screen.getByText("No account found with this email address."),
    ).toBeInTheDocument();
  });

  it("renders floating auto-dismissing account deletion Toast instead of inline banner and cleans URL query params", () => {
    vi.useFakeTimers();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({}, "", "/login?deleted=1");

    render(
      <LoginForm
        toastMessage="Your account has been permanently deleted."
        clearSavedLogin
        initialRememberedLogin={null}
      />,
    );

    const toast = screen.getByRole("status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(toast).toHaveTextContent("Your account has been permanently deleted.");
    expect(toast.closest(".fixed")).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).not.toBeChecked();
    expect(replaceStateSpy).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/login",
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(
      screen.getByText("Your account has been permanently deleted."),
    ).toBeInTheDocument();

    // Typing while Toast is visible must not reset the 4500ms auto-dismiss timer
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "typing@example.com" },
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(
      screen.queryByText("Your account has been permanently deleted."),
    ).not.toBeInTheDocument();

    window.history.replaceState({}, "", "/");
    replaceStateSpy.mockRestore();
    vi.useRealTimers();
  });

  it("renders deletion Toast from notice=account_deleted URL query param and allows closing manually", () => {
    window.history.replaceState({}, "", "/login?notice=account_deleted");

    render(<LoginForm clearSavedLogin initialRememberedLogin={null} />);

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Your account has been permanently deleted.");
    expect(window.location.search).toBe("");

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss notification/i }),
    );
    expect(
      screen.queryByText("Your account has been permanently deleted."),
    ).not.toBeInTheDocument();
    window.history.replaceState({}, "", "/");
  });

  it("reads live localStorage snapshot instead of stale StorageEvent.newValue on external storage events", () => {
    const validHint = JSON.stringify({
      channel: "email",
      identifier: "live@example.com",
      rememberMe: true,
    });
    window.localStorage.setItem("mentor_remembered_login", validHint);
    document.cookie = "mentor_login_hint=active; path=/";

    render(<LoginForm />);
    expect(screen.getByLabelText(/^email$/i)).toHaveValue("live@example.com");
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).toBeChecked();

    // Stale StorageEvent claims newValue=null even though current localStorage holds validHint
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "mentor_remembered_login",
          newValue: null,
        }),
      );
    });
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).toBeChecked();
    expect(document.cookie).toContain("mentor_login_hint=active");

    // Genuine removal in localStorage clears even if StorageEvent carries stale non-null newValue
    act(() => {
      window.localStorage.removeItem("mentor_remembered_login");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "mentor_remembered_login",
          newValue: validHint,
        }),
      );
    });
    expect(
      screen.getByRole("checkbox", { name: /^Keep Signed In$/ }),
    ).not.toBeChecked();
    expect(document.cookie).not.toContain("mentor_login_hint=");
  });
});
