import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { VerifyForm } from '@/components/auth/verify-form';
import { verifyOtpAction, resendOtpAction } from '@/lib/auth/actions';
import { useSearchParams } from 'next/navigation';
import {
  saveVerificationDraft,
  clearVerificationDraft,
  VERIFICATION_DRAFT_STORAGE_KEY,
} from '@/lib/auth/verification-draft';

const mockPush = vi.fn();

vi.mock('@/lib/auth/actions', () => ({
  verifyOtpAction: vi.fn(),
  resendOtpAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('VerifyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    clearVerificationDraft();
  });

  it('renders invalid link message when params are missing', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams());
    render(<VerifyForm />);
    expect(screen.getByText(/invalid verification link/i)).toBeInTheDocument();
  });

  it('renders form fields with identifier re-entry when draft is absent', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    render(<VerifyForm />);

    /* Draft loads asynchronously via useEffect; wait for the identifier field */
    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText(/enter the verification code sent to your email/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument();
  });

  it('restores draft from sessionStorage and displays masked contact', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
      contactMasked: 'c****@example.com',
      expiresInSeconds: 300,
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    render(<VerifyForm />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(/enter the verification code sent to c\*\*\*\*@example\.com/i),
      ).toBeInTheDocument();
    });
    // Identifier input should NOT be shown because unexpired draft exists
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
  });

  it('shows expired-draft notice and identifier re-entry when draft has expired', async () => {
    /* Save a draft that is already expired (expiresInSeconds=1, then advance time). */
    const now = Date.now();
    saveVerificationDraft({
      channel: 'email',
      identifier: 'expired@example.com',
      contactMasked: 'e****@example.com',
      expiresInSeconds: 1,
    }, now - 5000); // Saved 5s ago with 1s TTL => expired

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.getByText(/verification draft expired/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('calls resendOtpAction on resend click and shows rate limit error', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      error: 'Email delivery is temporarily rate-limited. Please try again later.',
    });

    render(<VerifyForm />);

    /* Wait for draft to load via mount effect before clicking resend */
    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(resendOtpAction).toHaveBeenCalledWith('email', 'candidate@example.com');
      expect(screen.getByText(/email delivery is temporarily rate-limited/i)).toBeInTheDocument();
    });
  });

  it('shows success message and starts cooldown on successful resend', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 600,
      contactMasked: 'c****@example.com',
    });

    render(<VerifyForm />);

    /* Wait for draft to load */
    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
      expect(resendButton).toBeDisabled();
      expect(resendButton).toHaveTextContent(/resend code in 60s/i);
    });
  });

  it('creates replacement draft on successful resend when original draft was expired', async () => {
    /* Start with no draft (simulating an expired/cleared draft or fresh tab). */
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 600,
      contactMasked: 'r****@example.com',
    });

    render(<VerifyForm />);

    /* Wait for initial render to settle (no draft, shows identifier field) */
    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    /* User re-enters identifier */
    const identifierInput = screen.getByLabelText(/email address/i);
    fireEvent.change(identifierInput, { target: { value: 'reentered@example.com' } });

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    });

    /* Replacement draft should now exist in sessionStorage */
    const rawStored = window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY);
    expect(rawStored).not.toBeNull();
    const parsed = JSON.parse(rawStored!);
    expect(parsed.normalized_identifier).toBe('reentered@example.com');
    expect(parsed.contact_masked).toBe('r****@example.com');
  });

  it('falls back to saving fresh draft on resend when stored draft expired in sessionStorage, preserving context', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'context-user@example.com',
      context: 'unverified_login',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 600,
      contactMasked: 'c****@example.com',
    });

    render(<VerifyForm />);

    /* Wait for draft to load into state */
    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    /* Simulate sessionStorage expiring while the user remains on the page */
    window.sessionStorage.clear();

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    });

    /* Fallback save should have stored a fresh draft preserving the original context */
    const stored = JSON.parse(
      window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY)!,
    );
    expect(stored).not.toBeNull();
    expect(stored.normalized_identifier).toBe('context-user@example.com');
    expect(stored.context).toBe('unverified_login');
  });

  it('does not overwrite newer live draft from another flow when resend completes in an older form', async () => {
    /* Form initializes with older draft */
    saveVerificationDraft({
      channel: 'email',
      identifier: 'older-candidate@example.com',
      context: 'registration',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 600,
      contactMasked: 'o****@example.com',
    });

    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    /* While user was in this form, another flow saved a NEWER live draft in sessionStorage */
    saveVerificationDraft({
      channel: 'email',
      identifier: 'newer-candidate@example.com',
      contactMasked: 'n****@example.com',
      expiresInSeconds: 600,
      context: 'registration',
    });

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    });

    /* Newer draft in sessionStorage must remain completely untouched */
    const stored = JSON.parse(
      window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY)!,
    );
    expect(stored.normalized_identifier).toBe('newer-candidate@example.com');
    expect(stored.contact_masked).toBe('n****@example.com');
  });

  it('does not clear verification draft on failed verification submit (draft preserved for failed attempts)', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(verifyOtpAction).mockResolvedValueOnce({
      error: 'Invalid verification code',
    });

    render(<VerifyForm />);

    /* Wait for draft to load */
    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const tokenInput = screen.getByLabelText(/enter the verification code/i);
    fireEvent.change(tokenInput, { target: { value: '123456' } });

    /* Submit the form */
    const submitButton = screen.getByRole('button', { name: /verify code/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    expect(verifyOtpAction).toHaveBeenCalled();

    /* Draft should still exist in sessionStorage (not cleared prematurely) */
    expect(
      window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
    ).not.toBeNull();
  });

  it('clears draft and navigates on successful verification submit', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(verifyOtpAction).mockResolvedValueOnce({
      success: true,
      redirectTo: '/onboarding/profile',
    });

    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const tokenInput = screen.getByLabelText(/enter the verification code/i);
    fireEvent.change(tokenInput, { target: { value: '123456' } });

    const submitButton = screen.getByRole('button', { name: /verify code/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
      ).toBeNull();
      expect(mockPush).toHaveBeenCalledWith('/onboarding/profile');
    });
  });

  it('handles rejected resendOtpAction promise gracefully and resets isResending', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(resendOtpAction).mockRejectedValueOnce(new Error('Network crash'));

    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/failed to resend verification code\. please try again\./i),
      ).toBeInTheDocument();
      expect(resendButton).not.toBeDisabled();
    });
  });

  it('uses SMS channel text with phone channel', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=phone'),
    );
    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.getByLabelText(/sent to your phone via SMS/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/SMS instead/i)).not.toBeInTheDocument();
  });

  it('does not apply a stored email draft when resending in phone verification channel', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
      contactMasked: 'c****@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=phone'),
    );
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 600,
      contactMasked: '+88017****89',
    });

    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.getByLabelText(/phone number/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/phone number/i), {
      target: { value: '01712345689' },
    });

    const resendButton = screen.getByRole('button', { name: /resend verification code/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
    });

    const stored = JSON.parse(
      window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY)!,
    );
    expect(stored.channel).toBe('email');
    expect(stored.normalized_identifier).toBe('candidate@example.com');
  });
});
