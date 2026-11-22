import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  afterEach(() => {
    cleanup();
  });

  it('stays sr-only by default and reveals only on keyboard focus-visible (never bare focus)', () => {
    render(<SkipLink />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link).toHaveAttribute('href', '#main-content');
    expect(link).toHaveClass(
      'sr-only',
      'focus-visible:not-sr-only',
      'focus-visible:fixed',
      'focus-visible:left-4',
      'focus-visible:top-4',
    );
    expect(link).not.toHaveClass('focus:not-sr-only');
  });
});
