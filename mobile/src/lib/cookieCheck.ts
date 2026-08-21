export type CookieCheckResult =
  | { status: 'valid'; detail: string }
  | { status: 'invalid'; detail: string }
  | { status: 'unreachable'; detail: string }
  | { status: 'unverified'; detail: string };

// yt-dlp auth refactor: SAPISID family signs the requests. LOGIN_INFO is
// youtube.com-scoped — google.com-tab exports carry SAPISID but youtube
// treats them as logged out, so require both.
const YT_AUTH_COOKIES = ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID'];

function cookieNames(cookie: string): Set<string> {
  return new Set(
    cookie.split(';').map((part) => part.split('=')[0].trim().toLowerCase())
  );
}

export function youtubeCookieShapeOk(
  cookie: string
): { ok: boolean; missing: string[] } {
  const names = cookieNames(cookie);
  const missing = YT_AUTH_COOKIES.filter(
    (name) => !names.has(name.toLowerCase())
  );
  if (!names.has('login_info')) missing.push('LOGIN_INFO');
  return { ok: missing.length === 0, missing };
}

// live login probes (innertube accounts_list) answer from node but not from
// RN's http stack on the same device/IP, so the check stays format-only;
// real validity shows when downloads unlock member/age-gated content
export function checkYoutubeCookie(cookie: string): CookieCheckResult {
  const shape = youtubeCookieShapeOk(cookie);
  if (!shape.ok) {
    return {
      status: 'invalid',
      detail: `Missing ${shape.missing.join(', ')} — re-export the cookie from a youtube.com tab`,
    };
  }
  return {
    status: 'valid',
    detail: 'All required session fields present (SAPISID family + LOGIN_INFO)',
  };
}

// no public login-state endpoint exists on the bilibili.tv intl gateway
// (yt-dlp probes playurl error codes instead); SESSDATA is the session token
const BILI_REQUIRED = ['SESSDATA'];
const BILI_RECOMMENDED = ['bili_jct', 'DedeUserID'];

export function bilibiliCookieShapeOk(
  cookie: string
): { ok: boolean; missing: string[]; suggested: string[] } {
  const names = cookieNames(cookie);
  const missing = BILI_REQUIRED.filter(
    (name) => !names.has(name.toLowerCase())
  );
  const suggested = BILI_RECOMMENDED.filter(
    (name) => !names.has(name.toLowerCase())
  );
  return { ok: missing.length === 0, missing, suggested };
}

export function checkBilibiliCookie(cookie: string): CookieCheckResult {
  const shape = bilibiliCookieShapeOk(cookie);
  if (!shape.ok) {
    return {
      status: 'invalid',
      detail: `Missing ${shape.missing.join(', ')} — the session token. Copy the full Cookie header from a logged-in bilibili.tv tab`,
    };
  }
  const extra =
    shape.suggested.length > 0
      ? ` (also useful: ${shape.suggested.join(', ')})`
      : '';
  return {
    status: 'unverified',
    detail: `SESSDATA found${extra} — bilibili.tv offers no public login check, so this is a format check only; real validity shows when downloads unlock higher quality`,
  };
}
