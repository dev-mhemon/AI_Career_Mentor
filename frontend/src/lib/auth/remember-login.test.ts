import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearRememberedLogin,
  loadRememberedLogin,
  parseRememberedLoginCookieHint,
  parseRememberedLoginHint,
  saveRememberedLogin,
  serializeRememberedLoginHint,
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
});
