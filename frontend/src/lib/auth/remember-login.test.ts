import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearOAuthLoginHint,
  clearRememberedLogin,
  extractOAuthLoginHintFromUser,
  isOAuthLoginHintCleared,
  loadOAuthLoginHint,
  loadRememberedLogin,
  LOGIN_HINT_COOKIE,
  OAUTH_HINT_CLEARED_STORAGE_KEY,
  OAUTH_HINT_COOKIE,
  OAUTH_HINT_STORAGE_KEY,
  parseOAuthLoginCookieHint,
  parseOAuthLoginHint,
  parseRememberedLoginCookieHint,
  parseRememberedLoginHint,
  REMEMBERED_LOGIN_STORAGE_KEY,
  saveOAuthLoginHint,
  saveRememberedLogin,
  serializeOAuthLoginHint,
  serializeRememberedLoginHint,
  subscribeOAuthLoginHint,
  subscribeRememberedLogin,
  syncOAuthLoginHintFromDocumentCookie,
} from './remember-login';

describe('remember-login helper', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('serializes and parses phone hint in local 01... display format', () => {
    const raw = serializeRememberedLoginHint('phone', '+8801629795421');
    expect(parseRememberedLoginHint(raw)).toEqual({
      channel: 'phone',
      identifier: '01629795421',
      rememberMe: true,
    });
    expect(parseRememberedLoginHint(encodeURIComponent(raw))).toEqual({
      channel: 'phone',
      identifier: '01629795421',
      rememberMe: true,
    });
  });

  it('preserves literal percent sequences like %41 in email across raw JSON and URI-encoded JSON round-trips', () => {
    const email = 'sales%41@example.com';
    const raw = serializeRememberedLoginHint('email', email);
    const expected = {
      channel: 'email',
      identifier: email,
      rememberMe: true,
    };

    expect(parseRememberedLoginHint(raw)).toEqual(expected);
    expect(parseRememberedLoginHint(encodeURIComponent(raw))).toEqual(expected);

    const quotedEmail = 'sales%22quoted@example.com';
    const quotedRaw = serializeRememberedLoginHint('email', quotedEmail);
    expect(parseRememberedLoginHint(quotedRaw)).toEqual({
      channel: 'email',
      identifier: quotedEmail,
      rememberMe: true,
    });
    expect(parseRememberedLoginHint(encodeURIComponent(quotedRaw))).toEqual({
      channel: 'email',
      identifier: quotedEmail,
      rememberMe: true,
    });
  });

  it('rejects payloads containing unexpected secret fields such as password or token', () => {
    const unsafe = JSON.stringify({
      channel: 'email',
      identifier: 'user@example.com',
      rememberMe: true,
      password: 'never-store-passwords',
    });
    expect(parseRememberedLoginHint(unsafe)).toBeNull();
  });

  it('saves, loads, and clears remembered login in localStorage', () => {
    saveRememberedLogin('email', 'User@Example.com');
    expect(loadRememberedLogin()).toEqual({
      channel: 'email',
      identifier: 'user@example.com',
      rememberMe: true,
    });

    clearRememberedLogin();
    expect(loadRememberedLogin()).toBeNull();
  });

  it('parseRememberedLoginCookieHint returns undefined on absent or invalid cookie values', () => {
    expect(parseRememberedLoginCookieHint(undefined)).toBeUndefined();
    expect(parseRememberedLoginCookieHint(null)).toBeUndefined();
    expect(parseRememberedLoginCookieHint('')).toBeUndefined();
    expect(parseRememberedLoginCookieHint('not-json')).toBeUndefined();

    const valid = serializeRememberedLoginHint('email', 'user@example.com');
    expect(parseRememberedLoginCookieHint(valid)).toEqual({
      channel: 'email',
      identifier: 'user@example.com',
      rememberMe: true,
    });
  });

  it('extracts, serializes, parses, saves, syncs, and clears Google and Facebook OAuth login hints', () => {
    const googleHint = extractOAuthLoginHintFromUser('google', {
      email: 'Mehedi@Example.com',
      user_metadata: {
        full_name: 'Mehedi Hasan',
        avatar_url: 'https://lh3.googleusercontent.com/avatar.png',
      },
    });
    expect(googleHint).toEqual({
      provider: 'google',
      displayName: 'Mehedi Hasan',
      email: 'mehedi@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/avatar.png',
    });

    const fbHint = extractOAuthLoginHintFromUser('facebook', {
      email: 'fbuser@example.com',
      user_metadata: {
        picture: { data: { url: 'https://graph.facebook.com/me/picture.jpg' } },
      },
    });
    expect(fbHint).toEqual({
      provider: 'facebook',
      displayName: 'fbuser',
      email: 'fbuser@example.com',
      avatarUrl: 'https://graph.facebook.com/me/picture.jpg',
    });

    // Drops unsafe avatar schemes while preserving hint
    const unsafeAvatar = extractOAuthLoginHintFromUser('google', {
      email: 'safe@example.com',
      user_metadata: {
        name: 'Safe User',
        avatar_url: 'javascript:alert(1)',
      },
    });
    expect(unsafeAvatar).toEqual({
      provider: 'google',
      displayName: 'Safe User',
      email: 'safe@example.com',
    });

    const raw = serializeOAuthLoginHint(googleHint!);
    expect(raw).not.toBeNull();
    expect(parseOAuthLoginHint(raw)).toEqual(googleHint);
    expect(parseOAuthLoginCookieHint(encodeURIComponent(raw!))).toEqual(
      googleHint,
    );
    expect(parseOAuthLoginCookieHint('bad-json')).toBeUndefined();

    // Rejects unexpected secret fields
    expect(
      parseOAuthLoginHint(
        JSON.stringify({
          provider: 'google',
          displayName: 'Mehedi',
          email: 'a@b.com',
          access_token: 'secret',
        }),
      ),
    ).toBeNull();

    saveOAuthLoginHint(fbHint!);
    expect(loadOAuthLoginHint()).toEqual(fbHint);
    expect(isOAuthLoginHintCleared()).toBe(false);
    clearOAuthLoginHint();
    expect(loadOAuthLoginHint()).toBeNull();
    expect(isOAuthLoginHintCleared()).toBe(true);
    expect(window.localStorage.getItem(OAUTH_HINT_CLEARED_STORAGE_KEY)).toBe('1');

    // Syncing without a valid OAuth cookie must not wipe the cleared marker
    syncOAuthLoginHintFromDocumentCookie();
    expect(isOAuthLoginHintCleared()).toBe(true);
    expect(loadOAuthLoginHint()).toBeNull();

    document.cookie = `mentor_oauth_hint=${encodeURIComponent(raw!)}; path=/`;
    syncOAuthLoginHintFromDocumentCookie();
    expect(loadOAuthLoginHint()).toEqual(googleHint);
    expect(isOAuthLoginHintCleared()).toBe(false);

    document.cookie = 'account_deleted=true; path=/';
    syncOAuthLoginHintFromDocumentCookie();
    expect(loadOAuthLoginHint()).toBeNull();
    expect(isOAuthLoginHintCleared()).toBe(true);
    document.cookie = 'account_deleted=; Max-Age=0; path=/';
  });

  it('catches storage, cookie, and listener errors locally inside clearOAuthLoginHint and clearRememberedLogin without short-circuiting remaining cleanup', () => {
    const removeSpy = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    const setSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const ownCookieDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'cookie',
    );
    const cookieSetterSpy = vi.fn(() => {
      throw new Error('CookieBlocked');
    });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: cookieSetterSpy,
    });
    const throwingOAuthListener = vi.fn(() => {
      throw new Error('ListenerFailed');
    });
    const healthyOAuthListener = vi.fn();
    const throwingRememberedListener = vi.fn(() => {
      throw new Error('RememberListenerFailed');
    });
    const healthyRememberedListener = vi.fn();
    const unsubOAuthThrowing = subscribeOAuthLoginHint(throwingOAuthListener);
    const unsubOAuthHealthy = subscribeOAuthLoginHint(healthyOAuthListener);
    const unsubRememberThrowing = subscribeRememberedLogin(
      throwingRememberedListener,
    );
    const unsubRememberHealthy = subscribeRememberedLogin(
      healthyRememberedListener,
    );

    try {
      expect(() => clearOAuthLoginHint()).not.toThrow();
      expect(removeSpy).toHaveBeenCalledWith(OAUTH_HINT_STORAGE_KEY);
      expect(setSpy).toHaveBeenCalledWith(OAUTH_HINT_CLEARED_STORAGE_KEY, '1');
      expect(cookieSetterSpy).toHaveBeenCalledWith(
        `${OAUTH_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`,
      );
      expect(throwingOAuthListener).toHaveBeenCalledTimes(1);
      expect(healthyOAuthListener).toHaveBeenCalledTimes(1);

      expect(() => clearRememberedLogin()).not.toThrow();
      expect(removeSpy).toHaveBeenCalledWith(REMEMBERED_LOGIN_STORAGE_KEY);
      expect(cookieSetterSpy).toHaveBeenCalledWith(
        `${LOGIN_HINT_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`,
      );
      expect(throwingRememberedListener).toHaveBeenCalledTimes(1);
      expect(healthyRememberedListener).toHaveBeenCalledTimes(1);
    } finally {
      unsubOAuthThrowing();
      unsubOAuthHealthy();
      unsubRememberThrowing();
      unsubRememberHealthy();
      removeSpy.mockRestore();
      setSpy.mockRestore();
      if (ownCookieDescriptor) {
        Object.defineProperty(document, 'cookie', ownCookieDescriptor);
      } else {
        delete (document as unknown as Record<string, unknown>).cookie;
      }
    }
  });
});
