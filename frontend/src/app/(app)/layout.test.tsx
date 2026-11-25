import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { AuthenticatedFastShellSession } from '@/lib/auth/shell-user';

let mockPathname = '/dashboard';
let mockHeaderPathname: string | null = null;

const { mockRedirect, mockReplace, mockRequireFastSessionShell } = vi.hoisted(() => ({
  mockRedirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  mockReplace: vi.fn(),
  mockRequireFastSessionShell: vi.fn<() => Promise<AuthenticatedFastShellSession>>(),
}));

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'x-pathname' ? mockHeaderPathname : null),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}));

vi.mock('@/lib/auth/shell-user', () => ({
  requireFastSessionShell: mockRequireFastSessionShell,
}));

import AuthenticatedAppLayout from './layout';
import { AppShellSync } from '@/components/ui/app-shell-context';

describe('AuthenticatedAppLayout', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    mockHeaderPathname = null;
    vi.clearAllMocks();
  });

  it('redirects unauthenticated requests to /login via requireFastSessionShell', async () => {
    mockRequireFastSessionShell.mockImplementation(async () => {
      mockRedirect('/login');
      throw new Error('unreachable');
    });

    await expect(
      AuthenticatedAppLayout({ children: <div>Workspace Child</div> }),
    ).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('mounts persistent AppShell from fast cookie session and hides/restores chrome cleanly via AppShellSync', async () => {
    mockRequireFastSessionShell.mockResolvedValue({
      unauthenticated: false,
      variant: 'authenticated',
      role: 'USER',
      isAdmin: false,
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
    expect(within(sidebar).getByRole('link', { name: 'Profile' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Career Goals' })).toBeInTheDocument();
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

  it('preserves fullName and email from initial layout user when AppShellSync updates currentRole on /career-profile hard refresh', async () => {
    mockRequireFastSessionShell.mockResolvedValue({
      unauthenticated: false,
      variant: 'authenticated',
      role: 'USER',
      isAdmin: false,
      user: {
        fullName: 'Mosad',
        currentRole: 'Fronted developer',
        email: 'mosad@example.com',
        phone: null,
      },
    });

    const tree = await AuthenticatedAppLayout({
      children: (
        <>
          <AppShellSync
            variant="authenticated"
            user={{ currentRole: 'Fronted developer' }}
          />
          <div>Career Profile Child</div>
        </>
      ),
    });

    render(tree);

    const trigger = screen.getByRole('button', { name: /Mosad/i });
    expect(trigger).toHaveTextContent('MO');
    expect(trigger).toHaveTextContent('Fronted developer');
    expect(trigger).not.toHaveTextContent('Learner');
  });

  it('redirects verified ADMIN sessions away from learner routes directly to /admin', async () => {
    mockHeaderPathname = '/dashboard';
    mockRequireFastSessionShell.mockResolvedValue({
      unauthenticated: false,
      variant: 'admin',
      role: 'ADMIN',
      isAdmin: true,
      user: {
        fullName: 'Platform Admin',
        currentRole: null,
        email: 'admin@mentor.com',
        phone: null,
      },
    });

    await expect(
      AuthenticatedAppLayout({ children: <div>Learner Dashboard</div> }),
    ).rejects.toThrow('NEXT_REDIRECT:/admin');
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('allows verified ADMIN sessions on /admin routes and renders admin-only sidebar', async () => {
    mockPathname = '/admin';
    mockHeaderPathname = '/admin';
    mockRequireFastSessionShell.mockResolvedValue({
      unauthenticated: false,
      variant: 'admin',
      role: 'ADMIN',
      isAdmin: true,
      user: {
        fullName: 'Platform Admin',
        currentRole: null,
        email: 'admin@mentor.com',
        phone: null,
      },
    });

    const tree = await AuthenticatedAppLayout({
      children: <div>Admin Console Child</div>,
    });
    render(tree);

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin');
    expect(within(sidebar).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Feature Controls' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Audit Logs' })).toHaveAttribute(
      'href',
      '/admin/audit-logs',
    );
    expect(within(sidebar).queryByRole('link', { name: 'Daily Plan' })).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
