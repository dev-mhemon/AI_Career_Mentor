import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AddContactForm } from '@/components/settings/add-contact-form';
import { addContactAction } from '@/lib/auth/actions';

const mockClearVerificationDraft = vi.fn();
const mockSaveVerificationDraft = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/auth/actions', () => ({
  addContactAction: vi.fn(),
}));

vi.mock('@/lib/auth/verification-draft', () => ({
  saveVerificationDraft: (...args: unknown[]) => mockSaveVerificationDraft(...args),
  clearVerificationDraft: () => mockClearVerificationDraft(),
}));

describe('AddContactForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders email and phone tabs and allows switching between them', () => {
    render(<AddContactForm alreadyVerified={false} />);

    const emailTab = screen.getByRole('button', { name: /ইমেইল \(Email\)/i });
    const phoneTab = screen.getByRole('button', { name: /ফোন নম্বর \(Phone\)/i });

    expect(emailTab).toBeInTheDocument();
    expect(phoneTab).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/ইমেইল ঠিকানা/i);
    expect(emailInput).toHaveAttribute('type', 'email');

    fireEvent.click(phoneTab);

    const phoneInput = screen.getByLabelText(/বাংলাদেশি মোবাইল নম্বর/i);
    expect(phoneInput).toHaveAttribute('type', 'tel');
  });

  it('renders suspended notice and hides form when isSuspended is true', () => {
    render(<AddContactForm isSuspended={true} />);

    expect(
      screen.getByText('স্থগিত অ্যাকাউন্ট থেকে নতুন যোগাযোগ মাধ্যম যোগ করা সম্ভব নয়।'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).not.toBeInTheDocument();
  });

  it('renders verified contact status card and hides submission form when alreadyVerified is true', () => {
    render(<AddContactForm alreadyVerified={true} />);

    expect(
      screen.getByText(/যোগাযোগের মাধ্যম যাচাইকৃত \(Verified Contact Method\)/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /যাচাইকরণ কোড পাঠান/i }),
    ).not.toBeInTheDocument();
  });

  it('pre-saves R18 verification draft with context secondary_contact on form submit', () => {
    render(<AddContactForm alreadyVerified={false} />);

    const input = screen.getByLabelText(/ইমেইল ঠিকানা/i);
    fireEvent.change(input, { target: { value: 'secondary@example.com' } });

    const form = input.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: 'email',
      identifier: 'secondary@example.com',
      context: 'secondary_contact',
    });
  });

  it('clears verification draft when submission is rejected with state error', async () => {
    vi.mocked(addContactAction).mockResolvedValueOnce({
      error: 'Contact already registered to another account.',
    });

    render(<AddContactForm alreadyVerified={false} />);

    const input = screen.getByLabelText(/ইমেইল ঠিকানা/i);
    fireEvent.change(input, { target: { value: 'taken@example.com' } });

    const button = screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockClearVerificationDraft).toHaveBeenCalled();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Contact already registered to another account.');
    });
  });

  it('displays temporary 503 SMS unavailability error properly in alert', async () => {
    vi.mocked(addContactAction).mockResolvedValueOnce({
      error: 'Phone contact verification is temporarily unavailable.',
    });

    render(<AddContactForm alreadyVerified={false} />);

    const phoneTab = screen.getByRole('button', { name: /ফোন নম্বর \(Phone\)/i });
    fireEvent.click(phoneTab);

    const input = screen.getByLabelText(/বাংলাদেশি মোবাইল নম্বর/i);
    fireEvent.change(input, { target: { value: '+8801712345678' } });

    const button = screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('Phone contact verification is temporarily unavailable.');
    });
  });

  it('clears verification draft and pushes redirectTo when addContactAction returns redirectTo', async () => {
    vi.mocked(addContactAction).mockResolvedValueOnce({
      error: 'Account already has a verified contact.',
      redirectTo: '/settings?verified=contact',
    });

    render(<AddContactForm alreadyVerified={false} />);

    const input = screen.getByLabelText(/ইমেইল ঠিকানা/i);
    fireEvent.change(input, { target: { value: 'verified@example.com' } });

    const button = screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockClearVerificationDraft).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/settings?verified=contact');
    });
  });

  it('preserves verification draft and pushes redirectTo when action returns verification redirect', async () => {
    vi.mocked(addContactAction).mockResolvedValueOnce({
      redirectTo: '/verify?channel=email',
    });

    const { rerender } = render(<AddContactForm alreadyVerified={false} />);

    const input = screen.getByLabelText(/ইমেইল ঠিকানা/i);
    fireEvent.change(input, { target: { value: 'test@example.com' } });

    const button = screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/verify?channel=email');
      expect(mockClearVerificationDraft).not.toHaveBeenCalled();
    });

    // Re-render component without action state transition does not re-push or clear draft
    rerender(<AddContactForm alreadyVerified={false} />);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockClearVerificationDraft).not.toHaveBeenCalled();
  });

  it('keeps 01712345678 visible after blur, submits +8801712345678 in FormData, and validates live onChange', async () => {
    vi.mocked(addContactAction).mockResolvedValueOnce({
      redirectTo: '/verify?channel=phone',
    });

    render(<AddContactForm alreadyVerified={false} />);

    const emailInput = screen.getByLabelText(/ইমেইল ঠিকানা/i);
    fireEvent.change(emailInput, { target: { value: 'bad' } });
    expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();

    const phoneTab = screen.getByRole('button', { name: /ফোন নম্বর \(Phone\)/i });
    fireEvent.click(phoneTab);

    const phoneInput = screen.getByLabelText(/বাংলাদেশি মোবাইল নম্বর/i) as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: '012' } });
    expect(screen.getByText(/prefix must be 013/i)).toBeInTheDocument();

    fireEvent.change(phoneInput, { target: { value: '01712345678' } });
    fireEvent.blur(phoneInput);
    expect(phoneInput.value).toBe('01712345678');
    expect(screen.queryByText(/prefix must be 013/i)).not.toBeInTheDocument();

    const button = screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i });
    await act(async () => {
      fireEvent.click(button);
    });

    const submittedFormData = vi.mocked(addContactAction).mock.calls[0]?.[1];
    expect(submittedFormData?.get('contact')).toBe('+8801712345678');
    expect(mockSaveVerificationDraft).toHaveBeenCalledWith({
      channel: 'phone',
      identifier: '+8801712345678',
      context: 'secondary_contact',
    });
  });
});
