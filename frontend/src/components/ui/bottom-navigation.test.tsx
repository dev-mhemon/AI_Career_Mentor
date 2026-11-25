import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomNavigation } from './bottom-navigation';

vi.mock('next/navigation', () => ({
  usePathname: () => '/today',
}));

describe('BottomNavigation (Component 03, C09 §2.1)', () => {
  it('renders 5 canonical learner tabs with >=44x44px hit targets, aria-label, and active aria-current="page"', () => {
    render(<BottomNavigation pathname="/roadmaps/rm-1" />);

    const nav = screen.getByRole('navigation', {
      name: 'Primary Mobile Navigation',
    });
    expect(nav.className).toContain('md:hidden');
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');

    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(5);

    const expected: Array<[string, string]> = [
      ['Today', '/today'],
      ['Roadmap', '/roadmaps'],
      ['Daily Plan', '/daily-plan'],
      ['Progress', '/progress'],
      ['Mentor', '/mentor'],
    ];

    for (const [label, href] of expected) {
      const link = within(nav).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
      expect(link.className).toContain('min-h-11');
      expect(link.className).toContain('min-w-11');
      expect(link.className).toContain('focus-visible:outline-2');
    }

    expect(
      within(nav).getByRole('link', { name: 'Roadmap' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(nav).getByRole('link', { name: 'Today' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('renders todayReadyDot with non-color-only screen-reader label and feature-locked indicators', () => {
    render(
      <BottomNavigation
        pathname="/today"
        todayReadyDot={true}
        effectiveAccess={{ ai_mentor: false }}
      />,
    );

    const nav = screen.getByRole('navigation', {
      name: 'Primary Mobile Navigation',
    });
    expect(
      within(nav).getByTestId('bottom-nav-today-ready-dot'),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole('link', { name: 'Today (ready)' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(nav).getByRole('link', { name: 'Mentor (feature restricted)' }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByTestId('bottom-nav-lock-mentor'),
    ).toBeInTheDocument();
  });
});
