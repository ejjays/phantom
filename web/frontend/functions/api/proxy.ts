interface Env {
  // Reserved for future per-instance allowlist binding
  PROXY_ALLOWLIST?: string;
}

const DEFAULT_ALLOWLIST = [
  'youtube.com',
  'youtu.be',
  'googlevideo.com',
  'ytimg.com',
  'i.ytimg.com',
  'i.scdn.co',
  'open.spotify.com',
  'api.spotify.com',
  'spotify.com',
  'api.song.link',
  'oembed.song.link',
  'song.link',
  'fbcdn.net',
  'cdninstagram.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'cdn.syndication.twitter.com',
  'abs.twimg.com',
  'video.twimg.com',
  'tiktokcdn.com',
  'tiktokv.com',
  'tiktok.com',
  'cdnx.co',
];

// media hosts stream byte-ranges (many requests per download) — lenient cap
const MEDIA_HOSTS = [
  'googlevideo.com',
  'ytimg.com',
  'twimg.com',
  'fbcdn.net',
  'cdninstagram.com',
  'scdn.co',
  'tiktokcdn.com',
];

const API_RATE_PER_MIN = 30;
const MEDIA_RATE_PER_MIN = 600;

// per-IP sliding window; in-memory per isolate (best-effort abuse dampening)
const windows = new Map<string, number[]>();

function windowAllowed(key: string, limit: number, now: number): boolean {
  const cut = now - 60_000;
  const seen = (windows.get(key) ?? []).filter((t) => t > cut);
  if (seen.length >= limit) {
    windows.set(key, seen);
    return false;
  }
  seen.push(now);
  windows.set(key, seen);
  if (windows.size > 10_000) {
    const stale = now - 120_000;
    for (const [k, times] of windows) {
      if (times.length === 0 || times[times.length - 1] < stale) {
        windows.delete(k);
      }
    }
  }
  return true;
}

function hostIsAllowed(host: string): boolean {
  const hostLower = host.toLowerCase();
  return DEFAULT_ALLOWLIST.some(
    (d) => hostLower === d || hostLower.endsWith(`.${d}`)
  );
}

function isMediaHost(host: string): boolean {
  const hostLower = host.toLowerCase();
  return MEDIA_HOSTS.some(
    (d) => hostLower === d || hostLower.endsWith(`.${d}`)
  );
}

function platformHeaders(host: string): Record<string, string> {
  if (/^(.+\.)?youtube\.com$/u.test(host) || host === 'youtu.be') {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
    };
  }
  if (/^(.+\.)?googlevideo\.com$/u.test(host)) {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    };
  }
  if (
    host === 'x.com' ||
    host === 'twitter.com' ||
    host.endsWith('.twitter.com') ||
    host.endsWith('twimg.com') ||
    host === 'cdn.syndication.twitter.com'
  ) {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };
  }
  if (/spotify\.com/u.test(host) || /scdn\.co/u.test(host)) {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    };
  }
  if (/song\.link/u.test(host)) {
    return { 'User-Agent': 'Mozilla/5.0' };
  }
  if (host.includes('instagram.com') || host.includes('fbcdn.net')) {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-IG-App-ID': '93663367723',
    };
  }
  if (
    host.includes('tiktok.com') ||
    host.includes('tiktokv.com') ||
    host.includes('cdnx.co')
  ) {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    };
  }
  // generic fallback
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  };
}

// echo the validated origin back, not '*': stops cross-site relay abuse
function corsHeadersFor(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

export const onRequestOptions: PagesFunction<Env> = (ctx) => {
  const origin = ctx.request.headers.get('Origin');
  const own = new URL(ctx.request.url).origin;
  if (origin && origin !== own) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: corsHeadersFor(origin ?? own),
  });
};

export const onRequest: PagesFunction<Env> = (ctx) => {
  const { request } = ctx;
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const own = url.origin;
  // browser CORS relay only for the app's own origin; non-browser callers (no Origin) stay usable
  if (origin && origin !== own) {
    return new Response('Forbidden: cross-origin relay', { status: 403 });
  }

  const target = url.searchParams.get('u');
  const customMethod = url.searchParams.get('m') || request.method;

  if (!target) {
    return new Response('Bad Request: missing ?u=', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Bad Request: invalid target URL', { status: 400 });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new Response('Forbidden: only http/https allowed', { status: 403 });
  }

  if (!hostIsAllowed(parsed.hostname)) {
    return new Response('Forbidden: host not allowlisted', { status: 403 });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const limit = isMediaHost(parsed.hostname)
    ? MEDIA_RATE_PER_MIN
    : API_RATE_PER_MIN;
  if (!windowAllowed(`${ip}:${parsed.hostname}`, limit, Date.now())) {
    return new Response('Too Many Requests', { status: 429 });
  }

  // build outgoing headers from the incoming request, then layer platform defaults
  const outHeaders: Record<string, string> = {
    ...platformHeaders(parsed.hostname),
  };

  // force identity encoding: runtimes diverge on auto-decompression (CF decodes br,
  // undici does not), which corrupts streamed responses — plain bytes always match
  outHeaders['Accept-Encoding'] = 'identity';

  // forward custom headers copied from the incoming request
  const range = request.headers.get('Range');
  if (range) outHeaders['Range'] = range;
  const accept = request.headers.get('Accept');
  if (accept) outHeaders['Accept'] = accept;
  const acceptLang = request.headers.get('Accept-Language');
  if (acceptLang) outHeaders['Accept-Language'] = acceptLang;
  // deliberately NOT forwarding Accept-Encoding: Cloudflare + our bridge re-encode,
  // and mismatched content-encoding headers break streaming proxies
  const contentType = request.headers.get('Content-Type');
  if (contentType) outHeaders['Content-Type'] = contentType;

  // for POST (youtubei), pipe the request body stream through
  let body: BodyInit | undefined;
  if (customMethod !== 'GET' && customMethod !== 'HEAD') {
    body = request.body ?? undefined;
  }

  const corsHeaders = corsHeadersFor(origin ?? own);

  const upstream = fetch(parsed.toString(), {
    method: customMethod,
    headers: outHeaders,
    body,
    // don't forward cookies
    credentials: 'omit',
    // stream the incoming body through (required for ReadableStream bodies)
    duplex: 'half',
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Upstream error: ${msg}`, { status: 502 });
  });

  // stream the upstream body through
  return upstream.then((upstreamRes: Response) => {
    const respHeaders = new Headers(upstreamRes.headers);
    for (const [k, v] of Object.entries(corsHeaders)) {
      respHeaders.set(k, v);
    }
    // don't leak set-cookie
    respHeaders.delete('set-cookie');
    // belt-and-braces: body must match headers (identity) for streamed responses
    respHeaders.delete('content-encoding');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: respHeaders,
    });
  });
};
