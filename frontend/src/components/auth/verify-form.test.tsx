import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { VerifyForm } from '@/components/auth/verify-form';
import { verifyOtpAction, resendOtpAction } from '@/lib/auth/actions';
import { useSearchParams } from 'next/navigation';
import {
  saveVerificationDraft,
  clearVerificationDraft,
  VERIFICATION_DRAFT_STORAGE_KEY,
  getPersistedCooldown,
  setPersistedCooldown,
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    clearVerificationDraft();
  });

  it('renders invalid link message when params are missing', async () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams());
    render(<VerifyForm />);
    await act(async () => {});
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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(resendOtpAction).toHaveBeenCalledWith('email', 'candidate@example.com');
      expect(screen.getByText(/email delivery is temporarily rate-limited/i)).toBeInTheDocument();
    });
  });

  it('shows success message and starts cooldown on successful resend', async () => {
    const baseNow = 1000000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);

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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
      expect(resendButton).toBeDisabled();
      expect(resendButton).toHaveTextContent(/resend code in 01:00/i);
    });

    const persisted = getPersistedCooldown('email');
    expect(persisted).not.toBeNull();
    expect(persisted?.deadlineMs).toBe(baseNow + 60000);
    expect(persisted?.originalSeconds).toBe(60);
  });

  it('starts cooldown matching resendAvailableAt timestamp and persists deadline on successful resend', async () => {
    const baseNow = 1000000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);

    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
      contactMasked: 'c****@example.com',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );

    const availableAtIso = new Date(baseNow + 45000).toISOString();
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      success: true,
      expiresInSeconds: 600,
      contactMasked: 'c****@example.com',
      resendAvailableAt: availableAtIso,
    });

    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
    await act(async () => {
      fireEvent.click(resendButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/verification code sent successfully/i)).toBeInTheDocument();
      expect(resendButton).toBeDisabled();
      expect(resendButton).toHaveTextContent(/resend code in 00:45/i);
    });

    const persisted = getPersistedCooldown('email');
    expect(persisted).not.toBeNull();
    expect(persisted?.deadlineMs).toBe(baseNow + 45000);
    expect(persisted?.originalSeconds).toBe(45);
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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
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
    setPersistedCooldown('email', Date.now() + 60000, 60, Date.now(), 'candidate@example.com');
    expect(getPersistedCooldown('email', 'candidate@example.com')).not.toBeNull();

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
      expect(getPersistedCooldown('email', 'candidate@example.com')).toBeNull();
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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
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

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
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

  it('initializes resend countdown from valid cooldown search param and keeps resend disabled', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=45'),
    );
    render(<VerifyForm />);

    const resendButton = await screen.findByRole('button', { name: /resend code in 00:45/i });
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).toBeDisabled();
  });

  it('ignores invalid cooldown search param and leaves resend button enabled', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=invalid'),
    );
    render(<VerifyForm />);

    const resendButton = await screen.findByRole('button', { name: /^resend code$/i });
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).toBeEnabled();
  });

  it('rejects trailing-character query values like cooldown=600junk and does not start countdown', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=600junk'),
    );
    render(<VerifyForm />);

    const resendButton = await screen.findByRole('button', { name: /^resend code$/i });
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).toBeEnabled();
    expect(screen.queryByText(/resend code in/i)).not.toBeInTheDocument();
  });

  it('rejects negative, decimal, and zero cooldown values', async () => {
    for (const invalid of ['-10', '12.5', '0']) {
      vi.mocked(useSearchParams).mockReturnValue(
        new URLSearchParams(`?channel=email&cooldown=${invalid}`),
      );
      const { unmount } = render(<VerifyForm />);

      const resendButton = await screen.findByRole('button', { name: /^resend code$/i });
      expect(resendButton).toBeInTheDocument();
      expect(resendButton).toBeEnabled();
      unmount();
    }
  });

  it('caps cooldown values exceeding MAX_COOLDOWN_DURATION_SECONDS to 600s', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=601'),
    );
    render(<VerifyForm />);

    const resendButton = await screen.findByRole('button', { name: /resend code in 10:00/i });
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).toBeDisabled();
  });

  it('computes remaining cooldown on page reload after partial elapsed time instead of restarting', async () => {
    const baseNow = 1000000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);

    // Initial mount with 45s cooldown
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=45'),
    );
    const firstRender = render(<VerifyForm />);
    expect(await screen.findByRole('button', { name: /resend code in 00:45/i })).toBeInTheDocument();
    firstRender.unmount();

    // 20 seconds elapse, user reloads the same URL
    vi.spyOn(Date, 'now').mockReturnValue(baseNow + 20000);
    render(<VerifyForm />);

    // Should resume with remaining 25 seconds instead of restarting to 45s
    const reloadedButton = await screen.findByRole('button', { name: /resend code in 00:25/i });
    expect(reloadedButton).toBeInTheDocument();
    expect(reloadedButton).toBeDisabled();
  });

  it('does not restart cooldown on page reload if cooldown has fully elapsed and cleans expired url params', async () => {
    vi.useFakeTimers();
    const baseNow = 1000000;
    vi.setSystemTime(baseNow);

    // Initial mount with 60s cooldown and mock URL in history
    window.history.replaceState(null, '', '/verify?channel=email&cooldown=60');
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(window.location.search),
    );

    const firstRender = render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('button', { name: /resend code in 01:00/i })).toBeInTheDocument();

    // Fast-forward 60s so cooldown expires and timer cleanup effect runs
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }

    // Verify button transitioned to enabled and URL was cleaned
    const enabledButton = screen.getByRole('button', { name: /^resend code$/i });
    expect(enabledButton).toBeEnabled();
    expect(window.location.search).not.toContain('cooldown=');

    firstRender.unmount();

    // User reloads the page with the updated window.location.search
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(window.location.search),
    );
    render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    const reloadedButton = screen.getByRole('button', { name: /^resend code$/i });
    expect(reloadedButton).toBeInTheDocument();
    expect(reloadedButton).toBeEnabled();
  });

  it('preserves original cooldown duration across reload mount hydration so revisiting original cooldown URL after expiry is recognized as expired', async () => {
    vi.useFakeTimers();
    const baseNow = 1000000;
    vi.setSystemTime(baseNow);

    // 1. Initial mount with cooldown=60
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=60'),
    );
    const firstRender = render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('button', { name: /resend code in 01:00/i })).toBeInTheDocument();
    firstRender.unmount();

    // 2. 20s elapse: user opens the URL again while cooldown is still running (40s left)
    vi.setSystemTime(baseNow + 20000);
    const midRender = render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('button', { name: /resend code in 00:40/i })).toBeInTheDocument();

    // Persisted originalSeconds must remain 60, not overwritten with remaining (40)
    const persistedMid = getPersistedCooldown('email');
    expect(persistedMid?.originalSeconds).toBe(60);
    midRender.unmount();

    // 3. User closes page; total 70s elapse (cooldown is now fully expired)
    vi.setSystemTime(baseNow + 70000);

    // User revisits the original URL (?channel=email&cooldown=60)
    render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    // Since originalSeconds was preserved as 60, it recognizes cooldown=60 as expired and keeps button enabled
    const expiredButton = screen.getByRole('button', { name: /^resend code$/i });
    expect(expiredButton).toBeInTheDocument();
    expect(expiredButton).toBeEnabled();
  });

  it('derives countdown from direct expiry timestamp query param', async () => {
    const baseNow = 1000000;
    vi.spyOn(Date, 'now').mockReturnValue(baseNow);

    // Provide an absolute expiry timestamp 30 seconds in the future
    const expiryIso = new Date(baseNow + 30000).toISOString();
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams(`?channel=email&resendAvailableAt=${expiryIso}`),
    );
    render(<VerifyForm />);

    const resendButton = await screen.findByRole('button', { name: /resend code in 00:30/i });
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).toBeDisabled();
  });

  it('ticks countdown based on deadline and enables resend when time expires', async () => {
    vi.useFakeTimers();
    const startTime = 1000000;
    vi.setSystemTime(startTime);

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=3'),
    );

    render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByRole('button', { name: /resend code in 00:03/i })).toBeInTheDocument();

    // Advance 1 second -> 2s
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend code in 00:02/i })).toBeInTheDocument();

    // Advance 1 second -> 1s
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend code in 00:01/i })).toBeInTheDocument();

    // Advance 1 second -> 0s (enabled)
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    const resendButton = screen.getByRole('button', { name: /^resend code$/i });
    expect(resendButton).toBeInTheDocument();
    expect(resendButton).toBeEnabled();
  });

  it('clamps far-future cooldownUntil to MAX_COOLDOWN_DURATION_SECONDS even after timer ticks advance', async () => {
    vi.useFakeTimers();
    const baseNow = 1000000;
    vi.setSystemTime(baseNow);

    // Provide a far-future expiry epoch ms (e.g., year 2100 = 4102444800000)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldownUntil=4102444800000'),
    );

    render(<VerifyForm />);
    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    // Should be clamped to 600s
    expect(screen.getByRole('button', { name: /resend code in 10:00/i })).toBeInTheDocument();

    // Advance 1 second -> should tick down to 599s, NOT jump to billions of seconds
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend code in 09:59/i })).toBeInTheDocument();

    // Advance another second -> 598s
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: /resend code in 09:58/i })).toBeInTheDocument();
  });

  it('forwards draft.context via hidden input to verifyOtpAction on OTP submit (M02-04 secondary_contact)', async () => {
    saveVerificationDraft({
      channel: 'email',
      identifier: 'secondary@example.com',
      contactMasked: 's****@example.com',
      context: 'secondary_contact',
    });

    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    vi.mocked(verifyOtpAction).mockResolvedValueOnce({
      success: true,
      redirectTo: '/settings?verified=contact',
    });

    render(<VerifyForm />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    });

    const tokenInput = screen.getByLabelText(/enter the verification code/i);
    fireEvent.change(tokenInput, { target: { value: '123456' } });

    const submitBtn = screen.getByRole('button', { name: /verify code/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(verifyOtpAction).toHaveBeenCalled();
    });

    const submittedFormData = vi.mocked(verifyOtpAction).mock.calls[0]?.[1];
    expect(submittedFormData).toBeInstanceOf(FormData);
    expect(submittedFormData?.get('context')).toBe('secondary_contact');
    expect(submittedFormData?.get('identifier')).toBe('secondary@example.com');
    expect(submittedFormData?.get('token')).toBe('123456');
  });

  it('keeps local 01712345678 visible in phone re-entry while submitting +8801712345678 and validates OTP live', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=phone'),
    );
    vi.mocked(verifyOtpAction).mockResolvedValueOnce({
      success: true,
      redirectTo: '/dashboard',
    });

    render(<VerifyForm />);

    const phoneInput = await screen.findByLabelText(/phone number/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '012' } });
    expect(screen.getByText(/prefix must be 013/i)).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: '01712345678' } });
    fireEvent.blur(phoneInput);
    expect(phoneInput.value).toBe('01712345678');
    expect(screen.queryByText(/prefix must be 013/i)).not.toBeInTheDocument();

    const otpInput = screen.getByLabelText(/enter the verification code/i);
    fireEvent.change(otpInput, { target: { value: '1234' } });
    expect(screen.getByText(/enter the 6-digit code/i)).toBeInTheDocument();

    fireEvent.change(otpInput, { target: { value: '123456' } });
    expect(screen.queryByText(/enter the 6-digit code/i)).not.toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /verify code/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    const submittedFormData = vi.mocked(verifyOtpAction).mock.calls[0]?.[1];
    expect(submittedFormData?.get('identifier')).toBe('+8801712345678');
    expect(phoneInput.value).toBe('01712345678');
  });

  it('starts single inline cooldown on 429 retryAfterSeconds from resendOtpAction without duplicate timer badge', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email&cooldown=0'),
    );
    saveVerificationDraft({
      channel: 'email',
      identifier: 'user@example.com',
      contactMasked: 'u***@example.com',
      context: 'registration',
    });
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      error: 'Too many requests. Please wait before trying again.',
      retryAfterSeconds: 75,
    });

    render(<VerifyForm />);

    const resendBtn = await screen.findByRole('button', {
      name: /^resend code$/i,
    });
    await waitFor(() => expect(resendBtn).toBeEnabled());

    await act(async () => {
      fireEvent.click(resendBtn);
    });

    expect(resendOtpAction).toHaveBeenCalledWith('email', 'user@example.com');
    expect(
      screen.getByRole('button', { name: /resend code in 01:15/i }),
    ).toBeDisabled();
    expect(screen.queryByText(/resend available in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/when the timer ends/i)).not.toBeInTheDocument();
  });

  it('auto-dismisses AuthAlert on input focus or change and re-displays on new server error', async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams('?channel=email'),
    );
    saveVerificationDraft({
      channel: 'email',
      identifier: 'candidate@example.com',
      contactMasked: 'c****@example.com',
    });
    vi.mocked(verifyOtpAction)
      .mockResolvedValueOnce({ error: 'Invalid or expired code.' })
      .mockResolvedValueOnce({ error: 'Verification failed again.' });
    vi.mocked(resendOtpAction).mockResolvedValueOnce({
      error: 'Resend rate limit hit.',
    });

    render(<VerifyForm />);

    const codeInput = await screen.findByLabelText(/verification code/i);
    const form = codeInput.closest('form')!;
    fireEvent.change(codeInput, { target: { value: '123456' } });

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/invalid or expired code\./i)).toBeInTheDocument();

    fireEvent.focus(codeInput);
    expect(screen.queryByText(/invalid or expired code\./i)).not.toBeInTheDocument();

    fireEvent.change(codeInput, { target: { value: '123456' } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(/verification failed again\./i)).toBeInTheDocument();

    fireEvent.change(codeInput, { target: { value: '654321' } });
    expect(screen.queryByText(/verification failed again\./i)).not.toBeInTheDocument();

    const resendBtn = screen.getByRole('button', { name: /^resend code$/i });
    await act(async () => {
      fireEvent.click(resendBtn);
    });
    expect(screen.getByText(/resend rate limit hit\./i)).toBeInTheDocument();

    fireEvent.focus(codeInput);
    expect(screen.queryByText(/resend rate limit hit\./i)).not.toBeInTheDocument();
  });
});
