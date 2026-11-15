import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VerifiedContactPrompt } from '@/components/settings/verified-contact-prompt';

describe('VerifiedContactPrompt Component', () => {
  it('renders prompt alert when verifiedContact is false', () => {
    render(<VerifiedContactPrompt verifiedContact={false} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Verified Contact Required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add contact/i })).toHaveAttribute(
      'href',
      '#add-contact-heading',
    );
  });

  it('renders nothing when verifiedContact is true', () => {
    const { container } = render(<VerifiedContactPrompt verifiedContact={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('invokes onAddContactClick callback when button is clicked', () => {
    const onClick = vi.fn();
    render(<VerifiedContactPrompt verifiedContact={false} onAddContactClick={onClick} />);

    const button = screen.getByRole('button', { name: /add contact/i });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not render action button or link when isSuspended is true', () => {
    render(<VerifiedContactPrompt verifiedContact={false} isSuspended={true} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /add contact/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add contact/i })).not.toBeInTheDocument();
  });
});
