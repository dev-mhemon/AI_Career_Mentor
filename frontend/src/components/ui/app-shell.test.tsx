import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

let mockPathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
}));

import { AppShell } from './app-shell';
import {
  AppShellProvider,
  AppShellSync,
  useOptionalAppShellContext,
} from './app-shell-context';
import { Header } from './header';
import { resolveShellUserDisplay } from '@/lib/auth/user-display';

function dispatchOutsidePointerDown(target: Element = document.body) {
  const EventCtor = window.PointerEvent ?? window.MouseEvent;
  fireEvent(target, new EventCtor('pointerdown', { bubbles: true }));
}

describe('AppShell, Sidebar, and Header', () => {
  beforeEach(() => {
    mockPathname = '/dashboard';
    vi.clearAllMocks();
  });

  it('renders light-theme sidebar with categorized navigation without sidebar Sign Out button', () => {
    render(
      <AppShell
        user={{
          fullName: 'Mehedi Hasan',
          currentRole: 'Backend Developer',
          email: 'mehedi@example.com',
        }}
      >
        <main>Workspace content</main>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    expect(sidebar.className).toContain('bg-white');
    expect(sidebar.className).toContain('border-r');
    expect(sidebar.className).toContain('lg:w-64');
    expect(sidebar.className).not.toMatch(/(^|\s)bg-slate-900(\s|$)/);

    const brandLink = within(sidebar).getByRole('link', {
      name: /AI Career Mentor/i,
    });
    expect(brandLink).toHaveAttribute('href', '/');
    expect(within(sidebar).getByText('MAIN')).toBeInTheDocument();
    expect(within(sidebar).getByText('ACCOUNT & WORKSPACE')).toBeInTheDocument();

    const dashboardLink = within(sidebar).getByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    expect(dashboardLink).toHaveAttribute('aria-current', 'page');
    expect(dashboardLink.className).toContain('bg-teal-50');
    expect(dashboardLink.className).toContain('text-teal-700');
    expect(dashboardLink.className).toContain('border-teal-600');
    expect(dashboardLink.className).toContain('px-5');

    expect(
      within(sidebar).queryByRole('link', { name: 'Today' }),
    ).not.toBeInTheDocument();

    const dailyPlanLink = within(sidebar).getByRole('link', {
      name: 'Daily Plan',
    });
    expect(dailyPlanLink).toHaveAttribute('href', '/daily-plan');
    expect(dailyPlanLink.className).toContain('mx-2');
    expect(dailyPlanLink.className).toContain('px-3');

    const progressLink = within(sidebar).getByRole('link', {
      name: 'Progress',
    });
    expect(progressLink).toHaveAttribute('href', '/progress');
    expect(progressLink).not.toHaveAttribute('aria-current');

    const profileLink = within(sidebar).getByRole('link', { name: 'Profile' });
    expect(profileLink).toHaveAttribute('href', '/profile');
    expect(profileLink).not.toHaveAttribute('aria-current');

    const careerGoalsLink = within(sidebar).getByRole('link', { name: 'Career Goals' });
    expect(careerGoalsLink).toHaveAttribute('href', '/career-profile');

    expect(
      within(sidebar).queryByRole('link', { name: 'Home' }),
    ).not.toBeInTheDocument();

    const settingsLink = within(sidebar).getByRole('link', { name: 'Settings' });
    expect(settingsLink).toHaveAttribute('href', '/settings');

    expect(
      within(sidebar).queryByRole('button', { name: 'Sign Out' }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).getByText('© 2026 AI Career Mentor'),
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace content')).toBeInTheDocument();
  });

  it('highlights Settings when pathname matches /settings', () => {
    mockPathname = '/settings';
    render(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Settings body</div>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    const settingsLink = within(sidebar).getByRole('link', { name: 'Settings' });
    const dashboardLink = within(sidebar).getByRole('link', { name: 'Dashboard' });

    expect(settingsLink).toHaveAttribute('aria-current', 'page');
    expect(settingsLink.className).toContain('bg-teal-50');
    expect(dashboardLink).not.toHaveAttribute('aria-current');
  });

  it('visually highlights Daily Plan on /today without setting aria-current="page", and sets aria-current="page" on /daily-plan', () => {
    mockPathname = '/today';
    const { rerender } = render(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Today body</div>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    expect(
      within(sidebar).queryByRole('link', { name: 'Today' }),
    ).not.toBeInTheDocument();

    const dailyPlanLink = within(sidebar).getByRole('link', {
      name: 'Daily Plan',
    });
    expect(dailyPlanLink).toHaveAttribute('href', '/daily-plan');
    expect(dailyPlanLink).not.toHaveAttribute('aria-current');
    expect(dailyPlanLink.className).toContain('bg-teal-50');
    expect(dailyPlanLink.className).toContain('px-5');

    mockPathname = '/daily-plan';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Daily plan body</div>
      </AppShell>,
    );
    expect(
      within(sidebar).getByRole('link', { name: 'Daily Plan' }),
    ).toHaveAttribute('aria-current', 'page');

    mockPathname = '/quiz/att-1';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Quiz body</div>
      </AppShell>,
    );
    const quizDailyPlanLink = within(sidebar).getByRole('link', {
      name: 'Daily Plan',
    });
    expect(quizDailyPlanLink).not.toHaveAttribute('aria-current');
    expect(quizDailyPlanLink.className).toContain('bg-teal-50');

    mockPathname = '/progress';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Progress body</div>
      </AppShell>,
    );
    expect(
      within(sidebar).getByRole('link', { name: 'Progress' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('toggles desktop sidebar collapsed rail width and aria-expanded state', () => {
    render(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Content</div>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    const toggleBtn = screen.getByRole('button', { name: 'Toggle sidebar' });

    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar.className).toContain('lg:w-64');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar.className).toContain('lg:w-[72px]');
    expect(within(sidebar).getByText('© 26')).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar.className).toContain('lg:w-64');
    expect(
      within(sidebar).getByText('© 2026 AI Career Mentor'),
    ).toBeInTheDocument();
  });

  it('opens mobile sidebar drawer and closes on backdrop, Escape with focus restoration, and pathname change', () => {
    const { rerender } = render(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Content</div>
      </AppShell>,
    );

    const mobileTrigger = screen.getByRole('button', { name: 'Open sidebar' });
    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    const firstDrawerControl = within(sidebar).getByRole('link', {
      name: /AI Career Mentor/i,
    });
    const lastDrawerControl = within(sidebar).getByRole('link', {
      name: 'Settings',
    });

    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(sidebar.className).toContain('-translate-x-full');

    // Open -> moves focus into drawer, traps Tab/Shift+Tab, and backdrop click restores focus to trigger
    fireEvent.click(mobileTrigger);
    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(sidebar.className).toContain('translate-x-0');
    expect(document.activeElement).toBe(firstDrawerControl);

    // Shift+Tab on first focusable control wraps to last control inside drawer
    fireEvent.keyDown(firstDrawerControl, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastDrawerControl);

    // Tab on last focusable control wraps back to first control inside drawer
    fireEvent.keyDown(lastDrawerControl, { key: 'Tab' });
    expect(document.activeElement).toBe(firstDrawerControl);

    const backdrop = screen.getByTestId('sidebar-backdrop');
    fireEvent.click(backdrop);
    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(mobileTrigger);

    // Open and close via drawer Close sidebar button restoring focus to trigger
    fireEvent.click(mobileTrigger);
    expect(document.activeElement).toBe(firstDrawerControl);
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Close sidebar' }));
    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(mobileTrigger);

    // Open and close via Escape key returning focus to trigger
    fireEvent.click(mobileTrigger);
    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(firstDrawerControl);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(mobileTrigger);

    // Open on /dashboard -> navigate to /settings -> return to /dashboard (stays closed)
    fireEvent.click(mobileTrigger);
    expect(mobileTrigger).toHaveAttribute('aria-expanded', 'true');
    mockPathname = '/settings';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Content</div>
      </AppShell>,
    );
    expect(
      screen.getByRole('button', { name: 'Open sidebar' }),
    ).toHaveAttribute('aria-expanded', 'false');

    mockPathname = '/dashboard';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Content</div>
      </AppShell>,
    );
    expect(
      screen.getByRole('button', { name: 'Open sidebar' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('complementary', { name: 'Primary sidebar' }).className,
    ).toContain('-translate-x-full');
  });

  it('renders user trigger with initials, name/role fallbacks, dropdown items, and Sign Out action', () => {
    const signOutMock = vi.fn();

    const { rerender } = render(
      <AppShell
        user={{
          fullName: 'Mehedi Hasan',
          currentRole: 'Backend Developer',
          email: 'mehedi@example.com',
        }}
        signOutAction={signOutMock}
      >
        <div>Body</div>
      </AppShell>,
    );

    const trigger = screen.getByRole('button', { name: /Mehedi Hasan/i });
    expect(trigger).toHaveAttribute('aria-label', 'User menu (Mehedi Hasan)');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('MH');
    expect(trigger).toHaveTextContent('Backend Developer');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = screen.getByRole('menu', { name: 'User profile menu' });
    expect(within(menu).getByText('Welcome back 👋!')).toBeInTheDocument();

    const profileMenuItem = within(menu).getByRole('menuitem', { name: 'Profile' });
    expect(profileMenuItem).toHaveAttribute('href', '/profile');

    const settingsMenuItem = within(menu).getByRole('menuitem', {
      name: 'Account Settings',
    });
    expect(settingsMenuItem).toHaveAttribute('href', '/settings');

    const signOutMenuItem = within(menu).getByRole('menuitem', { name: 'Sign Out' });
    fireEvent.submit(signOutMenuItem.closest('form')!);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    // Fallback user without fullName / currentRole displays email username and Learner
    rerender(
      <AppShell
        user={{
          fullName: null,
          currentRole: null,
          email: 'sarah.khan@example.com',
          phone: null,
        }}
        signOutAction={signOutMock}
      >
        <div>Body</div>
      </AppShell>,
    );

    const fallbackTrigger = screen.getByRole('button', { name: /sarah\.khan/i });
    expect(fallbackTrigger).toHaveTextContent('SK');
    expect(fallbackTrigger).toHaveTextContent('Learner');

    // Phone-only user with explicit null email/fullName/currentRole formats phone and defaults initials/role
    rerender(
      <AppShell
        user={{
          fullName: null,
          currentRole: null,
          email: null,
          phone: '+8801712345678',
        }}
        signOutAction={signOutMock}
      >
        <div>Body</div>
      </AppShell>,
    );

    const phoneTrigger = screen.getByRole('button', {
      name: /\+880 1712-345678/i,
    });
    expect(phoneTrigger).toHaveTextContent('U');
    expect(phoneTrigger).toHaveTextContent('Learner');

    expect(
      resolveShellUserDisplay({
        fullName: null,
        currentRole: null,
        email: 'sarah.khan@example.com',
        phone: null,
      }),
    ).toEqual({
      displayName: 'sarah.khan',
      initials: 'SK',
      roleLabel: 'Learner',
    });

    expect(
      resolveShellUserDisplay({
        fullName: null,
        currentRole: null,
        email: null,
        phone: '+8801712345678',
      }),
    ).toEqual({
      displayName: '+880 1712-345678',
      initials: 'U',
      roleLabel: 'Learner',
    });
  });

  it('closes user dropdown on outside pointerdown, Escape returning focus, pathname change, and supports arrow key navigation', () => {
    const { rerender } = render(
      <AppShell
        user={{
          fullName: 'Mehedi Hasan',
          currentRole: 'Engineer',
        }}
      >
        <div>Outside area</div>
      </AppShell>,
    );

    const trigger = screen.getByRole('button', { name: /Mehedi Hasan/i });

    // Outside click closes dropdown
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'User profile menu' })).toBeInTheDocument();
    dispatchOutsidePointerDown(screen.getByText('Outside area'));
    expect(screen.queryByRole('menu', { name: 'User profile menu' })).not.toBeInTheDocument();

    // Opening menu via trigger transfers focus immediately into first menuitem
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'User profile menu' });
    const profileItem = within(menu).getByRole('menuitem', { name: 'Profile' });
    const settingsItem = within(menu).getByRole('menuitem', {
      name: 'Account Settings',
    });
    expect(document.activeElement).toBe(profileItem);

    // Arrow key navigation from active menu item + Escape returns focus to trigger
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(settingsItem);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(profileItem);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('menu', { name: 'User profile menu' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);

    // Pressing ArrowDown directly on trigger opens menu and focuses first menu item
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const reopenedMenu = screen.getByRole('menu', { name: 'User profile menu' });
    expect(document.activeElement).toBe(
      within(reopenedMenu).getByRole('menuitem', { name: 'Profile' }),
    );

    // Navigating away (/dashboard -> /settings) and returning (/dashboard) keeps dropdown closed
    mockPathname = '/settings';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan', currentRole: 'Engineer' }}>
        <div>Outside area</div>
      </AppShell>,
    );
    expect(
      screen.queryByRole('menu', { name: 'User profile menu' }),
    ).not.toBeInTheDocument();

    mockPathname = '/dashboard';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan', currentRole: 'Engineer' }}>
        <div>Outside area</div>
      </AppShell>,
    );
    expect(
      screen.queryByRole('menu', { name: 'User profile menu' }),
    ).not.toBeInTheDocument();
  });

  it('filters Quick Search results, toggles notifications dialog, and omits quick settings shortcut icon', () => {
    const { rerender } = render(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Workspace</div>
      </AppShell>,
    );

    expect(
      screen.queryByRole('link', { name: 'Quick settings' }),
    ).not.toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', { name: 'Quick Search' });
    expect(searchInput).toHaveAttribute('placeholder', 'Quick Search...');

    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'sett' } });
    const searchRegion = screen.getByRole('region', { name: 'Quick search results' });
    const resultLink = within(searchRegion).getByRole('link', {
      name: /Account Settings/i,
    });
    expect(resultLink).toHaveAttribute('href', '/settings');

    // Escape from a result link closes the popup and restores focus without reopening it
    resultLink.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('region', { name: 'Quick search results' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(searchInput);

    // Re-focusing and typing shows the empty-state message cleanly, and Escape closes again
    fireEvent.change(searchInput, { target: { value: 'zzzzz' } });
    expect(screen.getByText('No matching workspace pages.')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.queryByRole('region', { name: 'Quick search results' }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(searchInput);

    // Notifications bell dialog
    const bellBtn = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(bellBtn);
    expect(
      screen.getByRole('dialog', { name: 'Notifications' }),
    ).toBeInTheDocument();
    dispatchOutsidePointerDown(screen.getByText('Workspace'));
    expect(
      screen.queryByRole('dialog', { name: 'Notifications' }),
    ).not.toBeInTheDocument();

    // Open search and notifications on /dashboard -> navigate away -> return to /dashboard (remain closed)
    fireEvent.change(searchInput, { target: { value: 'sett' } });
    expect(
      screen.getByRole('region', { name: 'Quick search results' }),
    ).toBeInTheDocument();
    fireEvent.click(bellBtn);
    expect(
      screen.getByRole('dialog', { name: 'Notifications' }),
    ).toBeInTheDocument();

    mockPathname = '/settings';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Workspace</div>
      </AppShell>,
    );
    expect(
      screen.queryByRole('dialog', { name: 'Notifications' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Quick search results' }),
    ).not.toBeInTheDocument();

    mockPathname = '/dashboard';
    rerender(
      <AppShell user={{ fullName: 'Mehedi Hasan' }}>
        <div>Workspace</div>
      </AppShell>,
    );
    expect(
      screen.queryByRole('dialog', { name: 'Notifications' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Quick search results' }),
    ).not.toBeInTheDocument();
  });

  it('locks learner navigation when suspended, renders offline banner, and keeps Settings accessible', () => {
    render(
      <AppShell
        variant="authenticated"
        isSuspended={true}
        offline={true}
        user={{ fullName: 'Suspended Learner' }}
      >
        <div>Suspended workspace</div>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    expect(within(sidebar).getByRole('link', { name: /AI Career Mentor/i })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(sidebar).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Today' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Daily Plan' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Career Goals' })).not.toBeInTheDocument();
    expect(within(sidebar).getByText('Dashboard').closest('[aria-disabled="true"]')).toBeInTheDocument();
    expect(within(sidebar).getByText('Daily Plan').closest('[aria-disabled="true"]')).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Settings' })).toBeInTheDocument();

    // User dropdown omits Profile item when suspended
    fireEvent.click(screen.getByRole('button', { name: /Suspended Learner/i }));
    const menu = screen.getByRole('menu', { name: 'User profile menu' });
    expect(within(menu).queryByRole('menuitem', { name: 'Profile' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Account Settings' })).toBeInTheDocument();

    expect(screen.getByRole('status')).toHaveTextContent(
      'You are offline. Reconnect to continue learning.',
    );
  });

  it('renders strict Admin-only Sidebar and Header when variant="admin" with zero learner navigation or cross-workspace links', () => {
    mockPathname = '/admin';
    const signOutMock = vi.fn();

    render(
      <AppShell
        variant="admin"
        user={{
          fullName: 'Platform Admin',
          currentRole: 'Frontend Developer',
          email: 'admin@mentor.com',
        }}
        signOutAction={signOutMock}
      >
        <div>Admin Console Body</div>
      </AppShell>,
    );

    const sidebar = screen.getByRole('complementary', { name: 'Primary sidebar' });
    const brandLink = within(sidebar).getByRole('link', {
      name: /AI Career Mentor/i,
    });
    expect(brandLink).toHaveAttribute('href', '/admin');
    // No truncated Admin pill badge next to brand title
    expect(brandLink).toHaveTextContent('AI Career Mentor');
    expect(brandLink).not.toHaveTextContent('Admin');
    expect(within(sidebar).getByText('ADMINISTRATION')).toBeInTheDocument();

    // Only the 4 admin routes exist in sidebar (Dashboard -> /admin, Users, Feature Controls, Audit Logs)
    expect(within(sidebar).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/admin',
    );
    expect(within(sidebar).getByRole('link', { name: 'Users' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    expect(within(sidebar).getByRole('link', { name: 'Feature Controls' })).toHaveAttribute(
      'href',
      '/admin/features',
    );
    expect(within(sidebar).getByRole('link', { name: 'Audit Logs' })).toHaveAttribute(
      'href',
      '/admin/audit-logs',
    );

    // Zero learner sections or links
    expect(within(sidebar).queryByText('MAIN')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('ACCOUNT & WORKSPACE')).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Daily Plan' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Progress' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Roadmaps' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'AI Mentor' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Tech Updates' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Career Goals' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    // Header: NO Learner Workspace switcher, NO Notifications bell, Quick Search restricted to admin routes
    expect(screen.queryByRole('link', { name: /Learner Workspace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Admin Console/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument();

    const searchInput = screen.getByRole('searchbox', { name: 'Quick Search' });
    fireEvent.focus(searchInput);
    fireEvent.change(searchInput, { target: { value: 'dashboard' } });
    const searchRegion = screen.getByRole('region', {
      name: 'Quick search results',
    });
    expect(
      within(searchRegion).getByRole('link', { name: /Admin Dashboard/i }),
    ).toHaveAttribute('href', '/admin');
    expect(
      within(searchRegion).queryByRole('link', { name: /^Dashboard/i }),
    ).not.toBeInTheDocument();

    // Admin account chip shows AD + Admin ONLY (no personal name or Platform Admin subtitle) and ONLY Sign Out in dropdown
    const trigger = screen.getByRole('button', { name: 'User menu (Admin)' });
    expect(trigger).toHaveTextContent('AD');
    expect(trigger).toHaveTextContent('Admin');
    expect(trigger).not.toHaveTextContent('Platform Admin');
    expect(trigger).not.toHaveTextContent('Frontend Developer');

    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'User profile menu' });
    expect(within(menu).getByText('Admin')).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Profile' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Account Settings' })).not.toBeInTheDocument();
    const signOutBtn = within(menu).getByRole('menuitem', { name: 'Sign Out' });
    fireEvent.submit(signOutBtn.closest('form')!);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it('keeps Sidebar and Header persistently mounted and preserves collapsed state across route changes', () => {
    const { rerender } = render(
      <AppShellProvider
        initialUser={{
          fullName: 'Mehedi Hasan',
          currentRole: 'Learner',
        }}
      >
        <AppShell>
          <AppShellSync
            user={{
              fullName: 'Mehedi Hasan',
              currentRole: 'Backend Developer',
            }}
          />
          <div>Dashboard Screen</div>
        </AppShell>
      </AppShellProvider>,
    );

    const sidebarEl = screen.getByRole('complementary', { name: 'Primary sidebar' });
    const headerEl = screen.getByRole('banner');

    fireEvent.click(within(sidebarEl).getByRole('button', { name: 'Toggle sidebar' }));
    expect(sidebarEl.className).toContain('lg:w-[72px]');

    mockPathname = '/profile';
    rerender(
      <AppShellProvider
        initialUser={{
          fullName: 'Mehedi Hasan',
          currentRole: 'Learner',
        }}
      >
        <AppShell>
          <AppShellSync
            user={{
              fullName: 'Mehedi Hasan',
              currentRole: 'Backend Developer',
            }}
          />
          <div>Profile Screen</div>
        </AppShell>
      </AppShellProvider>,
    );

    expect(
      screen.getByRole('complementary', { name: 'Primary sidebar' }),
    ).toBe(sidebarEl);
    expect(screen.getByRole('banner')).toBe(headerEl);
    expect(sidebarEl.className).toContain('lg:w-[72px]');
    expect(
      within(sidebarEl).getByRole('link', { name: 'Profile' }),
    ).toHaveAttribute('aria-current', 'page');

    // Syncing disabled hides shell chrome and restores cleanly on return
    mockPathname = '/settings';
    rerender(
      <AppShellProvider>
        <AppShell>
          <AppShellSync disabled />
          <div>Transient Error Screen</div>
        </AppShell>
      </AppShellProvider>,
    );
    expect(
      screen.queryByRole('complementary', { name: 'Primary sidebar' }),
    ).not.toBeInTheDocument();
  });

  it('preserves explicit null field updates in AppShellSync while retaining omitted fields', () => {
    const seen: Array<ReturnType<typeof useOptionalAppShellContext>> = [];
    function ContextProbe() {
      const ctx = useOptionalAppShellContext();
      seen.push(ctx);
      return (
        <div data-testid="shell-user-probe">
          {JSON.stringify(ctx?.user ?? null)}
        </div>
      );
    }

    render(
      <AppShellProvider
        initialUser={{
          fullName: 'Mehedi Hasan',
          currentRole: 'Backend Developer',
          email: 'mehedi@example.com',
          phone: '+8801712345678',
        }}
      >
        <AppShell>
          <AppShellSync user={{ email: null }} />
          <ContextProbe />
        </AppShell>
      </AppShellProvider>,
    );

    expect(JSON.parse(screen.getByTestId('shell-user-probe').textContent ?? 'null')).toEqual({
      fullName: 'Mehedi Hasan',
      currentRole: 'Backend Developer',
      email: null,
      phone: '+8801712345678',
    });
    expect(seen.at(-1)?.user?.email).toBeNull();
  });

  it('keeps Header variant="public" compatible for public nav usage', () => {
    render(<Header variant="public" />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(
      within(nav).getByRole('link', { name: 'Create account' }),
    ).toHaveAttribute('href', '/register');
  });

  it('keeps public Sign in / Create account labels when authenticated and routes to /dashboard', () => {
    render(<Header variant="public" authenticated />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(
      within(nav).getByRole('link', { name: 'Create account' }),
    ).toHaveAttribute('href', '/dashboard');
    expect(
      within(nav).queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument();
  });
});
