import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { VerifyForm } from '@/components/auth/verify-form';
import { resendOtpAction } from '@/lib/auth/actions';
import { useSearchParams } from 'next/navigation';
import {
  saveVerificationDraft,
  clearVerificationDraft,
  VERIFICATION_DRAFT_STORAGE_KEY,
} from '@/lib/auth/verification-draft';

vi.mock('@/lib/auth/actions', () => ({
  verifyOtpAction: vi.fn(),
  resendOtpAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
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

  it('does not clear verification draft on form submit (draft preserved for failed attempts)', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );

    render(<VerifyForm />);

    /* Wait for draft to load */
    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    /* Submit the form */
    const submitButton = screen.getByRole('button', { name: /verify code/i });
    fireEvent.click(submitButton);

    /* Draft should still exist in sessionStorage (not cleared prematurely) */
    expect(
      window.sessionStorage.getItem(VERIFICATION_DRAFT_STORAGE_KEY),
    ).not.toBeNull();
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
});
