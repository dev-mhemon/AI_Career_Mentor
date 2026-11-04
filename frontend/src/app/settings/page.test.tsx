import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsPage from './page';
import { getAppSessionStateResult } from '@/lib/auth/user';

vi.mock('@/lib/auth/user', () => ({
  getAppSessionStateResult: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({
  logoutAction: vi.fn(),
  linkIdentityAction: vi.fn(),
  addContactAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Creates mock AppSessionState for testing settings page.
 */
function createMockSessionState(overrides: Record<string, unknown> = {}) {
  return {
    status: 'authenticated' as const,
    data: {
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'user@example.com',
        phone: null,
        status: 'active',
        role: 'USER',
        verified_contact: false,
        linked_providers: ['google'],
      },
      profile_complete: true,
      effective_access: {},
      focus_roadmap_id: null,
      can_delete_account: false,
      ...overrides,
    },
  };
}

describe('SettingsPage Server Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unvalidated ?linked= URL parameters and does not show false success', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'malicious-string' }),
    });
    render(page);

    expect(screen.queryByText(/অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে/i)).not.toBeInTheDocument();
  });

  it('shows success message only when ?linked= matches an allowed and actually linked provider', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'google' }),
    });
    render(page);

    expect(
      screen.getByText(/Google অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে/i),
    ).toBeInTheDocument();
  });

  it('does not show success message when ?linked=facebook but user only has google linked', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(createMockSessionState());

    const page = await SettingsPage({
      searchParams: Promise.resolve({ linked: 'facebook' }),
    });
    render(page);

    expect(screen.queryByText(/Facebook অ্যাকাউন্ট সফলভাবে যুক্ত করা হয়েছে/i)).not.toBeInTheDocument();
  });

  it('renders AddContactForm when user has unverified contact and is not suspended', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: null,
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: false,
          linked_providers: ['facebook'],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).toBeInTheDocument();
  });

  it('renders AddContactForm for verified users with alreadyVerified=true', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'verified@example.com',
          phone: null,
          status: 'active',
          role: 'USER',
          verified_contact: true,
          linked_providers: ['email'],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(screen.getByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).toBeInTheDocument();
    expect(
      screen.getByText(/আপনার অ্যাকাউন্টে একটি দ্বিতীয় যোগাযোগের তথ্য যোগ করুন/i),
    ).toBeInTheDocument();
  });

  it('does not render AddContactForm when user is suspended', async () => {
    vi.mocked(getAppSessionStateResult).mockResolvedValueOnce(
      createMockSessionState({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'suspended@example.com',
          phone: null,
          status: 'suspended',
          role: 'USER',
          verified_contact: false,
          linked_providers: [],
        },
      }),
    );

    const page = await SettingsPage({});
    render(page);

    expect(screen.queryByRole('button', { name: /যাচাইকরণ কোড পাঠান/i })).not.toBeInTheDocument();
  });
});
