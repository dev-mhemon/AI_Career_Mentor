import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FastShellSessionResult } from '@/lib/auth/shell-user';

let mockPathname = '/dashboard';

const { mockRedirect, mockGetFastSessionShellUser } = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockGetFastSessionShellUser: vi.fn<() => Promise<FastShellSessionResult>>(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}));

vi.mock('@/lib/auth/shell-user', () => ({
  getFastSessionShellUser: mockGetFastSessionShellUser,
}));

import AuthenticatedAppLayout from './layout';
import { AppShellSync } from '@/components/ui/app-shell-context';

describe('AuthenticatedAppLayout', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    vi.clearAllMocks();
  });

  it('redirects unauthenticated requests to /login', async () => {
    mockGetFastSessionShellUser.mockResolvedValue({ unauthenticated: true });

    await expect(
      AuthenticatedAppLayout({ children: <div>Workspace Child</div> }),
    ).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('mounts persistent AppShell from fast cookie session and hides/restores chrome cleanly via AppShellSync', async () => {
    mockGetFastSessionShellUser.mockResolvedValue({
      unauthenticated: false,
      variant: 'authenticated',
      user: {
        fullName: 'Mehedi Hasan',
        currentRole: null,
        email: 'mehedi@example.com',
        phone: null,
      },
    });

    const tree = await AuthenticatedAppLayout({
      children: (
        <>
          <AppShellSync
            variant="authenticated"
            user={{
              fullName: 'Mehedi Hasan',
              currentRole: 'Backend Developer',
              email: 'mehedi@example.com',
              phone: null,
            }}
          />
          <div>Workspace Child</div>
        </>
      ),
    });

    const { rerender } = render(tree);

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    const header = screen.getByRole('banner');
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar).getByRole('link', { name: 'Profile Setup' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Quick settings' })).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: /Mehedi Hasan/i });
    expect(trigger).toHaveTextContent('MH');
    expect(trigger).toHaveTextContent('Backend Developer');

    // Collapse sidebar and navigate to /settings without remounting outer shell
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Toggle sidebar' }));
    expect(sidebar.className).toContain('lg:w-[72px]');

    mockPathname = '/settings';
    const nextTree = await AuthenticatedAppLayout({
      children: (
        <>
          <AppShellSync
            variant="authenticated"
            user={{
              fullName: 'Mehedi Hasan',
              currentRole: 'Backend Developer',
              email: 'mehedi@example.com',
              phone: null,
            }}
          />
          <div>Settings Child</div>
        </>
      ),
    });
    rerender(nextTree);

    expect(
      screen.getByRole('complementary', { name: 'Primary sidebar' }),
    ).toBe(sidebar);
    expect(screen.getByRole('banner')).toBe(header);
    expect(sidebar.className).toContain('lg:w-[72px]');
    expect(within(sidebar).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Settings Child')).toBeInTheDocument();
  });
});
