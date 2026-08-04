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

function hostIsAllowed(host: string): boolean {
  const hostLower = host.toLowerCase();
  return DEFAULT_ALLOWLIST.some(
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export const onRequestOptions: ExportedHandler<Env>['OPTIONS'] = () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequest: ExportedHandler<Env>['fetch'] = async (req) => {
  const url = new URL(req.url);
  const target = url.searchParams.get('u');
  const customMethod = url.searchParams.get('m') || req.method;

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

  // build outgoing headers from the incoming request, then layer platform defaults
  const outHeaders: Record<string, string> = {
    ...platformHeaders(parsed.hostname),
  };

  // forward custom headers copied from the incoming request
  const range = req.headers.get('Range');
  if (range) outHeaders['Range'] = range;
  const accept = req.headers.get('Accept');
  if (accept) outHeaders['Accept'] = accept;
  const acceptLang = req.headers.get('Accept-Language');
  if (acceptLang) outHeaders['Accept-Language'] = acceptLang;
  const acceptEnc = req.headers.get('Accept-Encoding');
  if (acceptEnc) outHeaders['Accept-Encoding'] = acceptEnc;

  // for POST (youtubei), pipe the body through
  let body: BodyInit | undefined;
  if (customMethod !== 'GET' && customMethod !== 'HEAD') {
    body = req;
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      method: customMethod,
      headers: outHeaders,
      body,
      // don't forward cookies
      credentials: 'omit',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Upstream error: ${msg}`, { status: 502 });
  }

  // copy upstream headers, then inject CORS
  const respHeaders = new Headers(upstream.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    respHeaders.set(k, v);
  }
  // don't leak set-cookie
  respHeaders.delete('set-cookie');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
};
