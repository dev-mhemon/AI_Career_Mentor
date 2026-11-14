import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type BrowserCookieAdapter = {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (
    cookiesToSet: Array<{
      name: string;
      value: string;
      options?: Record<string, unknown>;
    }>,
  ) => void;
};

let capturedBrowserAdapter: BrowserCookieAdapter | null = null;

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn((_url: string, _key: string, config: { cookies: BrowserCookieAdapter }) => {
    capturedBrowserAdapter = config.cookies;
    return { auth: {} };
  }),
}));

import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

describe('createSupabaseBrowserClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedBrowserAdapter = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses canonical mentor_remember_me=0 even when legacy auth_remember=1 appears first', () => {
    const writtenCookies: string[] = [];
    const cookieJar = 'auth_remember=1; mentor_remember_me=0';
    vi.stubGlobal('document', {
      get cookie() {
        return cookieJar;
      },
      set cookie(value: string) {
        writtenCookies.push(value);
      },
    });

    createSupabaseBrowserClient();
    expect(capturedBrowserAdapter).not.toBeNull();

    capturedBrowserAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'tok',
        options: {
          path: '/',
          maxAge: 3600,
          expires: new Date(Date.now() + 86_400_000),
          sameSite: 'lax',
        },
      },
    ]);

    expect(writtenCookies).toHaveLength(1);
    expect(writtenCookies[0]).not.toContain('Max-Age=');
    expect(writtenCookies[0]).not.toContain('Expires=');
    expect(writtenCookies[0]).toContain('sb-access-token=tok');
  });

  it('applies 30-day Max-Age=2592000 when mentor_remember_me=1 is present', () => {
    const writtenCookies: string[] = [];
    const cookieJar = 'mentor_remember_me=1';
    vi.stubGlobal('document', {
      get cookie() {
        return cookieJar;
      },
      set cookie(value: string) {
        writtenCookies.push(value);
      },
    });

    createSupabaseBrowserClient();
    expect(capturedBrowserAdapter).not.toBeNull();

    capturedBrowserAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'tok',
        options: {
          path: '/',
          maxAge: 3600,
          sameSite: 'lax',
        },
      },
    ]);

    expect(writtenCookies).toHaveLength(1);
    expect(writtenCookies[0]).toContain('Max-Age=2592000');
    expect(writtenCookies[0]).toContain('sb-access-token=tok');
  });

  it('preserves original Max-Age when mentor_remember_me cookie is absent', () => {
    const writtenCookies: string[] = [];
    const cookieJar = 'other_cookie=abc';
    vi.stubGlobal('document', {
      get cookie() {
        return cookieJar;
      },
      set cookie(value: string) {
        writtenCookies.push(value);
      },
    });

    createSupabaseBrowserClient();
    expect(capturedBrowserAdapter).not.toBeNull();

    capturedBrowserAdapter!.setAll([
      {
        name: 'sb-access-token',
        value: 'tok',
        options: {
          path: '/',
          maxAge: 3600,
          sameSite: 'lax',
        },
      },
    ]);

    expect(writtenCookies).toHaveLength(1);
    expect(writtenCookies[0]).toContain('Max-Age=3600');
    expect(writtenCookies[0]).toContain('sb-access-token=tok');
  });
});
