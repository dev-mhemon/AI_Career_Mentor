import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IdentityLinkingCards } from '@/components/settings/identity-linking-cards';
import { linkIdentityAction } from '@/lib/auth/actions';

vi.mock('@/lib/auth/actions', () => ({
  linkIdentityAction: vi.fn(),
}));

describe('IdentityLinkingCards Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Google and Facebook cards with proper names and status', () => {
    render(
      <IdentityLinkingCards
        linkedProviders={['email', 'google']}
        verifiedContact={true}
      />,
    );

    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /connect facebook account/i })).toBeInTheDocument();
  });

  it('disables linking buttons and displays requirement notice when verifiedContact is false', () => {
    render(
      <IdentityLinkingCards
        linkedProviders={['facebook']}
        verifiedContact={false}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /connect google account/i });
    expect(googleBtn).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Your account must have a verified contact method (email or phone) to link a social account.',
    );
  });

  it('disables linking buttons when user is suspended', () => {
    render(
      <IdentityLinkingCards
        linkedProviders={[]}
        verifiedContact={true}
        isSuspended={true}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /connect google account/i });
    const fbBtn = screen.getByRole('button', { name: /connect facebook account/i });
    expect(googleBtn).toBeDisabled();
    expect(fbBtn).toBeDisabled();
  });

  it('calls linkIdentityAction with google when Google link button is clicked', async () => {
    vi.mocked(linkIdentityAction).mockResolvedValueOnce({
      success: true,
      linked_providers: ['email', 'google'],
    });

    render(
      <IdentityLinkingCards
        linkedProviders={['email']}
        verifiedContact={true}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /connect google account/i });
    fireEvent.click(googleBtn);

    await waitFor(() => {
      expect(linkIdentityAction).toHaveBeenCalledWith('google');
    });
    expect(
      await screen.findByText('Google account linked.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect google account/i })).not.toBeInTheDocument();
  });

  it('calls linkIdentityAction with facebook when Facebook link button is clicked', async () => {
    vi.mocked(linkIdentityAction).mockResolvedValueOnce({
      success: true,
      linked_providers: ['phone', 'facebook'],
    });

    render(
      <IdentityLinkingCards
        linkedProviders={['phone']}
        verifiedContact={true}
      />,
    );

    const fbBtn = screen.getByRole('button', { name: /connect facebook account/i });
    fireEvent.click(fbBtn);

    await waitFor(() => {
      expect(linkIdentityAction).toHaveBeenCalledWith('facebook');
    });
    expect(
      await screen.findByText('Facebook account linked.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect facebook account/i })).not.toBeInTheDocument();
  });

  it('displays error alert when linkIdentityAction returns error', async () => {
    vi.mocked(linkIdentityAction).mockResolvedValueOnce({
      error: 'Identity belongs to another application account.',
    });

    render(
      <IdentityLinkingCards
        linkedProviders={['phone']}
        verifiedContact={true}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /connect google account/i });
    fireEvent.click(googleBtn);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Identity belongs to another application account.');
  });

  it('renders initialSuccess and initialError from props when provided', () => {
    render(
      <IdentityLinkingCards
        linkedProviders={['google']}
        verifiedContact={true}
        initialSuccess="Google account linked."
        initialError="Previous action failed."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Google account linked.');
    expect(screen.getByRole('alert')).toHaveTextContent('Previous action failed.');
  });

  it('resets linked override when linkedProviders prop updates', async () => {
    vi.mocked(linkIdentityAction).mockResolvedValueOnce({
      success: true,
      linked_providers: ['email', 'google'],
    });

    const { rerender } = render(
      <IdentityLinkingCards
        linkedProviders={['email']}
        verifiedContact={true}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /connect google account/i });
    fireEvent.click(googleBtn);

    expect(await screen.findByText('Google account linked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect google account/i })).not.toBeInTheDocument();

    rerender(
      <IdentityLinkingCards
        linkedProviders={['email', 'facebook']}
        verifiedContact={true}
      />,
    );

    expect(screen.getByRole('button', { name: /connect google account/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect facebook account/i })).not.toBeInTheDocument();
  });

  it('preserves linkedOverride when parent passes newly allocated array with same provider contents', async () => {
    vi.mocked(linkIdentityAction).mockResolvedValueOnce({
      success: true,
      linked_providers: ['email', 'google'],
    });

    const { rerender } = render(
      <IdentityLinkingCards
        linkedProviders={['email']}
        verifiedContact={true}
      />,
    );

    const googleBtn = screen.getByRole('button', { name: /connect google account/i });
    fireEvent.click(googleBtn);

    expect(await screen.findByText('Google account linked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect google account/i })).not.toBeInTheDocument();

    rerender(
      <IdentityLinkingCards
        linkedProviders={['email'].slice()}
        verifiedContact={true}
      />,
    );

    expect(screen.queryByRole('button', { name: /connect google account/i })).not.toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
  });
});
