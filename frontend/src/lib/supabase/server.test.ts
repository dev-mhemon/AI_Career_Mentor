import { describe, it, expect, vi, beforeEach } from 'vitest';

type CookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (
    cookiesToSet: Array<{
      name: string;
      value: string;
      options?: Record<string, unknown>;
    }>,
  ) => void;
};

let capturedCookiesAdapter: CookieAdapter | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url: string, _key: string, config: { cookies: CookieAdapter }) => {
    capturedCookiesAdapter = config.cookies;
    return { auth: {} };
  }),
}));

const mockCookieStore = {
  getAll: vi.fn(() => []),
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

import { createSupabaseServerClient } from '@/lib/supabase/server';

describe('createSupabaseServerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCookiesAdapter = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('overrides incoming mentor_remember_me=1 when options.rememberMe is false', async () => {
    mockCookieStore.get.mockImplementation((name: string) =>
      name === 'mentor_remember_me' ? { value: '1' } : undefined,
    );

    await createSupabaseServerClient({ rememberMe: false });
    expect(capturedCookiesAdapter).not.toBeNull();

    const expires = new Date(Date.now() + 86_400_000);
    capturedCookiesAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'token-value',
        options: {
          httpOnly: true,
          path: '/',
          maxAge: 3600,
          expires,
        },
      },
    ]);

    expect(mockCookieStore.set).toHaveBeenCalledWith('sb-access-token', 'token-value', {
      httpOnly: true,
      path: '/',
    });
  });

  it('overrides incoming mentor_remember_me=0 when options.rememberMe is true', async () => {
    mockCookieStore.get.mockImplementation((name: string) =>
      name === 'mentor_remember_me' ? { value: '0' } : undefined,
    );

    await createSupabaseServerClient({ rememberMe: true });
    expect(capturedCookiesAdapter).not.toBeNull();

    capturedCookiesAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'token-value',
        options: { httpOnly: true, path: '/', maxAge: 3600 },
      },
    ]);

    expect(mockCookieStore.set).toHaveBeenCalledWith('sb-access-token', 'token-value', {
      httpOnly: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  it('preserves original cookie options when options.rememberMe and mentor_remember_me cookie are omitted', async () => {
    mockCookieStore.get.mockReturnValue(undefined);

    await createSupabaseServerClient();
    expect(capturedCookiesAdapter).not.toBeNull();

    const expires = new Date(Date.now() + 86_400_000);
    const originalOptions = {
      httpOnly: true,
      path: '/',
      maxAge: 3600,
      expires,
    };
    capturedCookiesAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'token-value',
        options: originalOptions,
      },
    ]);

    expect(mockCookieStore.set).toHaveBeenCalledWith(
      'sb-access-token',
      'token-value',
      originalOptions,
    );
  });

  it('applies 30-day persistence when options.rememberMe is omitted and mentor_remember_me=1', async () => {
    mockCookieStore.get.mockImplementation((name: string) =>
      name === 'mentor_remember_me' ? { value: '1' } : undefined,
    );

    await createSupabaseServerClient();
    expect(capturedCookiesAdapter).not.toBeNull();

    capturedCookiesAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'token-value',
        options: { httpOnly: true, path: '/', maxAge: 3600 },
      },
    ]);

    expect(mockCookieStore.set).toHaveBeenCalledWith('sb-access-token', 'token-value', {
      httpOnly: true,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  it('preserves maxAge: 0 on cookie removal (empty value) for both rememberMe: true and rememberMe: false', async () => {
    await createSupabaseServerClient({ rememberMe: true });
    capturedCookiesAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: '',
        options: { httpOnly: true, path: '/', maxAge: 0 },
      },
    ]);
    expect(mockCookieStore.set).toHaveBeenLastCalledWith('sb-access-token', '', {
      httpOnly: true,
      path: '/',
      maxAge: 0,
    });

    await createSupabaseServerClient({ rememberMe: false });
    capturedCookiesAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: '',
        options: { httpOnly: true, path: '/', maxAge: 0 },
      },
    ]);
    expect(mockCookieStore.set).toHaveBeenLastCalledWith('sb-access-token', '', {
      httpOnly: true,
      path: '/',
      maxAge: 0,
    });
  });
});
