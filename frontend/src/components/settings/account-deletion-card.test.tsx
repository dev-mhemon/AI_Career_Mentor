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
    expect(screen.getByRole('heading', { name: /অ্যাকাউন্ট মুছে ফেলা/i })).toBeInTheDocument();
    expect(
      screen.getByText(/৯০-দিনের ধারণসীমা এবং এআই অপারেশনাল লগ ৩০ দিনের মধ্যে/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i })).toBeInTheDocument();
  });

  it('renders AZ-SUSP notice when user account is suspended', () => {
    render(<AccountDeletionCard canDeleteAccount={true} isSuspended={true} />);

    expect(
      screen.getByText(
        /স্থগিত অ্যাকাউন্টের ক্ষেত্রেও অ্যাকাউন্ট মুছে ফেলার পূর্ণ অধিকার প্রযোজ্য \(AZ-SUSP\)/i,
      ),
    ).toBeInTheDocument();
  });

  it('disables deletion button when canDeleteAccount is false', () => {
    render(<AccountDeletionCard canDeleteAccount={false} />);

    expect(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i })).toBeDisabled();
  });

  it('opens confirmation modal dialog when delete button is clicked', () => {
    render(<AccountDeletionCard canDeleteAccount={true} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const openBtn = screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i });
    fireEvent.click(openBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /আপনি কি নিশ্চিত\?/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/কনফার্মেশন কোড/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/পাসওয়ার্ড/i)).toBeInTheDocument();
  });

  it('keeps submit button disabled until literal "DELETE" and password are typed', () => {
    render(<AccountDeletionCard canDeleteAccount={true} hasPasswordAuth={true} />);

    fireEvent.click(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }));

    const submitBtn = screen.getByRole('button', { name: /স্থায়ীভাবে মুছে ফেলুন/i });
    expect(submitBtn).toBeDisabled();

    const confirmInput = screen.getByLabelText(/কনফার্মেশন কোড/i);
    const passwordInput = screen.getByLabelText(/পাসওয়ার্ড/i);

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

    fireEvent.click(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /বাতিল/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('enables submit button for social-only accounts without requiring password', () => {
    render(
      <AccountDeletionCard
        canDeleteAccount={true}
        hasPasswordAuth={false}
        linkedProviders={['google']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }));

    expect(screen.queryByLabelText(/পাসওয়ার্ড/i)).not.toBeInTheDocument();
    expect(screen.getByText(/সংযুক্ত প্রোভাইডার \(google\)/i)).toBeInTheDocument();

    const confirmInput = screen.getByLabelText(/কনফার্মেশন কোড/i);
    const submitBtn = screen.getByRole('button', { name: /স্থায়ীভাবে মুছে ফেলুন/i });
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

    fireEvent.click(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }));
    fireEvent.change(screen.getByLabelText(/কনফার্মেশন কোড/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(screen.getByLabelText(/পাসওয়ার্ড/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /স্থায়ীভাবে মুছে ফেলুন/i }));
    });

    expect(screen.getByText(/অ্যাকাউন্ট ডিলিট প্রক্রিয়া সম্পন্ন হচ্ছে/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/কনফার্মেশন কোড/i)).toBeDisabled();

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

    fireEvent.click(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }));
    fireEvent.change(screen.getByLabelText(/কনফার্মেশন কোড/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(screen.getByLabelText(/পাসওয়ার্ড/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /স্থায়ীভাবে মুছে ফেলুন/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /অ্যাকাউন্ট মুছে ফেলুন/i }));
    fireEvent.change(screen.getByLabelText(/কনফার্মেশন কোড/i), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(screen.getByLabelText(/পাসওয়ার্ড/i), {
      target: { value: 'ValidPass123!' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /স্থায়ীভাবে মুছে ফেলুন/i }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Failed to verify deletion status with provider/i,
    );

    const cancelBtn = screen.getByRole('button', { name: /বাতিল/i });
    expect(cancelBtn).not.toBeDisabled();
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
