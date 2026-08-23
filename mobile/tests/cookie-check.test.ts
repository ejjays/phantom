import { describe, it, expect } from 'vitest';

import {
  youtubeCookieShapeOk,
  bilibiliCookieShapeOk,
  checkYoutubeCookie,
  checkBilibiliCookie,
} from '../src/lib/cookieCheck';

const YT_SESSION =
  'SAPISID=x; __Secure-1PAPISID=y; __Secure-3PAPISID=z; LOGIN_INFO=w';

describe('youtubeCookieShapeOk', () => {
  it.each<[string, string[]]>([
    [
      'SAPISID=x; __Secure-1PAPISID=y; __Secure-3PAPISID=z; LOGIN_INFO=w',
      [],
    ],
  ])('accepts a youtube-session cookie: %s', (cookie, expected) => {
    expect(youtubeCookieShapeOk(cookie).missing).toEqual(expected);
    expect(youtubeCookieShapeOk(cookie).ok).toBe(true);
  });

  it.each<[string, string[]]>([
    ['SAPISID=x; LOGIN_INFO=w', ['__Secure-1PAPISID', '__Secure-3PAPISID']],
    ['SAPISID=x; __Secure-1PAPISID=y', ['__Secure-3PAPISID', 'LOGIN_INFO']],
    ['SID=x; HSID=y; LOGIN_INFO=w', ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID']],
    ['SAPISID=x', ['__Secure-1PAPISID', '__Secure-3PAPISID', 'LOGIN_INFO']],
    ['', ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID', 'LOGIN_INFO']],
  ])('rejects google.com-tab exports: %s', (cookie, expected) => {
    const shape = youtubeCookieShapeOk(cookie);
    expect(shape.ok).toBe(false);
    expect(shape.missing).toEqual(expected);
  });
});

describe('bilibiliCookieShapeOk', () => {
  it('accepts a bilibili.tv session cookie', () => {
    const shape = bilibiliCookieShapeOk('SESSDATA=x; bili_jct=y; DedeUserID=z');
    expect(shape.ok).toBe(true);
    expect(shape.missing).toEqual([]);
    expect(shape.suggested).toEqual([]);
  });

  it('flags SESSDATA as required and others as suggested', () => {
    const shape = bilibiliCookieShapeOk('bili_jct=y');
    expect(shape.ok).toBe(false);
    expect(shape.missing).toEqual(['SESSDATA']);
    expect(shape.suggested).toEqual(['DedeUserID']);
  });
});

describe('checkYoutubeCookie', () => {
  it('accepts a full youtube session shape without a live probe', () => {
    const result = checkYoutubeCookie(YT_SESSION);
    expect(result.status).toBe('valid');
    expect(result.detail).toContain('SAPISID');
  });

  it('rejects exports missing the youtube-scoped auth cookies', () => {
    const result = checkYoutubeCookie('SID=x; HSID=y');
    expect(result.status).toBe('invalid');
    expect(result.detail).toContain('SAPISID');
  });
});

describe('checkBilibiliCookie', () => {
  it('reports unverified when SESSDATA is present', () => {
    const result = checkBilibiliCookie('SESSDATA=x; bili_jct=y');
    expect(result.status).toBe('unverified');
    expect(result.detail).toContain('SESSDATA');
  });

  it('rejects cookies without the session token', () => {
    const result = checkBilibiliCookie('bili_jct=y; DedeUserID=1');
    expect(result.status).toBe('invalid');
    expect(result.detail).toContain('SESSDATA');
  });
});
