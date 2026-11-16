import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AccountDeletionCard } from './account-deletion-card';
import { requestAccountDeletionAction, pollAccountDeletionStatusAction } from '@/lib/auth/actions';

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/lib/auth/actions', () => ({
  requestAccountDeletionAction: vi.fn(),
  pollAccountDeletionStatusAction: vi.fn(),
}));

describe('AccountDeletionCard Component (Screen 22 / EP-X01 / EP-X02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Danger Zone heading and deletion explanatory text', () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    expect(screen.getByRole('status')).toHaveTextContent('Danger Zone');
    expect(screen.getByRole('heading', { name: /account deletion/i })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Permanently delete your account, profile, learning roadmaps, and practice history\. Raw text and messages are retained for up to 90 days for safety compliance, and AI operational logs are automatically purged within 30 days\. This action cannot be undone\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/PRD\s*\u00A7\s*52/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument();
  });

  it('renders suspended deletion notice when user account is suspended', () => {
    render(<AccountDeletionCard canDeleteAccount={true} isSuspended={true} />);

    expect(
      screen.getByText(/Account deletion remains available while your account is suspended/i),
    ).toBeInTheDocument();
  });

  it('disables deletion button when canDeleteAccount is false', () => {
    render(<AccountDeletionCard canDeleteAccount={false} />);

    expect(screen.getByRole('button', { name: /delete account/i })).toBeDisabled();
  });

  it('opens confirmation modal dialog without Type DELETE input when delete button is clicked', () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const openBtn = screen.getByRole('button', { name: /delete account/i });
    fireEvent.click(openBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /are you sure\?/i })).toBeInTheDocument();
    expect(
      screen.getByText(
        /this action cannot be undone\. enter your account password below to confirm deletion\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/type delete to confirm/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
  });

  it('keeps submit button disabled until account password is entered', () => {
    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

    const submitBtn = screen.getByRole('button', { name: /confirm deletion/i });
    expect(submitBtn).toBeDisabled();

    const passwordInput = screen.getByLabelText(/account password/i);
    expect(passwordInput).toHaveAttribute('placeholder', 'Password');

    fireEvent.change(passwordInput, { target: { value: 'ValidPass123!' } });
    expect(submitBtn).not.toBeDisabled();

    fireEvent.change(passwordInput, { target: { value: '   ' } });
    expect(submitBtn).toBeDisabled();
  });

  it('closes modal when cancel button is clicked', () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('enables submit button immediately for non-password accounts without requiring password', () => {
    render(
      <AccountDeletionCard
        canDeleteAccount={true}
        hasPasswordAuth={false}
        linkedProviders={['google']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

    expect(screen.queryByLabelText(/account password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/type delete to confirm/i)).not.toBeInTheDocument();
    expect(screen.getByText(/active sign-in session \(google\)/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /confirm deletion/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('starts 2-second polling loop and disables controls when submit returns in_progress with deletionReceipt', async () => {
    vi.useFakeTimers();
    vi.mocked(requestAccountDeletionAction).mockResolvedValueOnce({
      success: true,
      status: 'in_progress',
      deletionReceipt: 'receipt-123',
    });

    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }));
    });

    expect(screen.getByText(/processing account deletion, please wait/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/account password/i)).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(pollAccountDeletionStatusAction).toHaveBeenCalledWith('receipt-123');
  });

  it('redirects to /login?deleted=true when status polling completes', async () => {
    vi.useFakeTimers();
    vi.mocked(requestAccountDeletionAction).mockResolvedValueOnce({
      success: true,
      status: 'scheduled',
      deletionReceipt: 'receipt-456',
    });
    vi.mocked(pollAccountDeletionStatusAction).mockResolvedValueOnce({
      status: 'completed',
      completedAt: '2026-11-10T12:00:00.000Z',
    });

    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(mockRouter.push).toHaveBeenCalledWith('/login?deleted=true');
  });

  it('displays pollError, stops polling, and re-enables modal close when polling returns an error', async () => {
    vi.useFakeTimers();
    vi.mocked(requestAccountDeletionAction).mockResolvedValueOnce({
      success: true,
      status: 'in_progress',
      deletionReceipt: 'receipt-789',
    });
    vi.mocked(pollAccountDeletionStatusAction).mockResolvedValueOnce({
      error: 'Failed to verify deletion status with provider',
    });

    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Failed to verify deletion status with provider/i,
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    expect(cancelBtn).not.toBeDisabled();
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears mentor_remembered_login from localStorage and mentor_login_hint cookie when submitting account deletion', async () => {
    window.localStorage.setItem(
      'mentor_remembered_login',
      JSON.stringify({
        channel: 'phone',
        identifier: '01629795421',
        rememberMe: true,
      }),
    );
    document.cookie = 'mentor_login_hint=stale; path=/';

    vi.mocked(requestAccountDeletionAction).mockResolvedValueOnce({
      success: true,
      status: 'completed',
      deletionReceipt: 'receipt-del-clear',
    });

    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }));
    });

    expect(window.localStorage.getItem('mentor_remembered_login')).toBeNull();
    expect(document.cookie).not.toContain('mentor_login_hint=');
    expect(mockRouter.push).toHaveBeenCalledWith('/login?deleted=true');
  });

  it('closes modal when clicking outside the modal box, stays open on inside clicks, and ignores outside clicks while polling', async () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;

    // Clicking inside modal box keeps dialog open
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Drag starting inside dialog and releasing on backdrop keeps dialog open
    fireEvent.mouseDown(dialog);
    fireEvent.click(backdrop, { detail: 1 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Direct click outside on backdrop closes dialog
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop, { detail: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Outside click does not close dialog while deletion polling is in flight
    vi.useFakeTimers();
    vi.mocked(requestAccountDeletionAction).mockResolvedValueOnce({
      success: true,
      status: 'in_progress',
      deletionReceipt: 'receipt-backdrop-busy',
    });

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm deletion/i }));
    });

    const busyBackdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(busyBackdrop);
    fireEvent.click(busyBackdrop, { detail: 1 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
