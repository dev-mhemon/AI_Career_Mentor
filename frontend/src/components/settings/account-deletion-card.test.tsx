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

  it('opens confirmation modal dialog when delete button is clicked', () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const openBtn = screen.getByRole('button', { name: /delete account/i });
    fireEvent.click(openBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /are you sure\?/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/type delete to confirm/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/account password/i)).toBeInTheDocument();
  });

  it('keeps submit button disabled until literal "DELETE" and password are typed', () => {
    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

    const submitBtn = screen.getByRole('button', { name: /confirm permanent deletion/i });
    expect(submitBtn).toBeDisabled();

    const confirmInput = screen.getByLabelText(/type delete to confirm/i);
    const passwordInput = screen.getByLabelText(/account password/i);
    expect(passwordInput).toHaveAttribute('placeholder', 'Password');

    // Case-sensitive check: "delete" should not enable submit
    fireEvent.change(confirmInput, { target: { value: 'delete' } });
    fireEvent.change(passwordInput, { target: { value: 'ValidPass123!' } });
    expect(submitBtn).toBeDisabled();

    // Literal uppercase "DELETE" enables submit
    fireEvent.change(confirmInput, { target: { value: 'DELETE' } });
    expect(submitBtn).not.toBeDisabled();
  });

  it('closes modal when cancel button is clicked', () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('enables submit button for non-password accounts without requiring password', () => {
    render(
      <AccountDeletionCard
        canDeleteAccount={true}
        hasPasswordAuth={false}
        linkedProviders={['google']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

    expect(screen.queryByLabelText(/account password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/active sign-in session \(google\)/i)).toBeInTheDocument();

    const confirmInput = screen.getByLabelText(/type delete to confirm/i);
    const submitBtn = screen.getByRole('button', { name: /confirm permanent deletion/i });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(confirmInput, { target: { value: 'DELETE' } });
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
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm permanent deletion/i }));
    });

    expect(screen.getByText(/processing account deletion, please wait/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/type delete to confirm/i)).toBeDisabled();

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
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm permanent deletion/i }));
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
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(screen.getByLabelText(/account password/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confirm permanent deletion/i }));
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
});
