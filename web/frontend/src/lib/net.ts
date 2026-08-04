import { PROXY_BASE } from './config';

// allowlist: external hosts routed through same-origin CORS proxy
const PROXIED_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'i.ytimg.com',
  'ytimg.com',
  'www.gstatic.com',
  'gvt1.com',
  'googlevideo.com',
  'cdn.syndication.twitter.com',
  'twimg.com',
  'abs.twimg.com',
  'video.twimg.com',
  'fbcdn.net',
  'cdninstagram.com',
  'api.instagram.com',
  'www.instagram.com',
  'instagram.com',
  'www.facebook.com',
  'facebook.com',
  'fb.watch',
  'l.tiktok.com',
  'vm.tiktok.com',
  'www.tiktok.com',
  'tiktok.com',
  'www.reddit.com',
  'reddit.com',
  'vimeo.com',
  'player.vimeo.com',
  'www.dailymotion.com',
  'dailymotion.com',
  'open.spotify.com',
  'api-partner.spotify.com',
  'www.twitch.tv',
  'twitch.tv',
];

// proxy external API/media fetches through same-origin Pages Function
export function proxyFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : String(input);
  let target: string;
  try {
    const { hostname } = new URL(url);
    if (
      PROXIED_HOSTS.some(
        (host) => host === hostname || hostname.endsWith(`.${host}`)
      )
    ) {
      target = `${PROXY_BASE}/proxy?u=${encodeURIComponent(url)}`;
    } else {
      target = url;
    }
  } catch {
    target = url;
  }
  const merged = {
    ...init,
    headers: {
      'ngrok-skip-browser-warning': 'true',
      'bypass-tunnel-reminder': 'true',
      ...(init?.headers || {}),
    },
  };
  return gatedFetch(target, merged);
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i], i).then((result) => {
      results[i] = result;
    });
    executing.push(promise);
    if (executing.length >= limit) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((pr) => pr === promise),
        1
      );
    }
  }
  await Promise.all(executing);
  return results;
}

// per-host concurrency gate with 429 backoff — mirrors mobile lib/net.ts
const MAX_PER_HOST = 3;
const MIN_GAP_MS = 300;
const JITTER_MS = 250;
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8000;

type Waiter = () => void;
interface HostState {
  active: number;
  nextAt: number;
  queue: Waiter[];
  backoffUntil: number;
}

const hosts = new Map<string, HostState>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

function stateFor(host: string): HostState {
  const existing = hosts.get(host);
  if (existing) return existing;
  const fresh: HostState = {
    active: 0,
    nextAt: 0,
    queue: [],
    backoffUntil: 0,
  };
  hosts.set(host, fresh);
  return fresh;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const asNum = Number(value);
  if (!Number.isNaN(asNum)) return asNum * 1000;
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? 0 : Math.max(0, dateMs - now);
}

export async function gatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : String(input);
  const host = hostOf(url);
  const state = stateFor(host);

  if (Date.now() < state.backoffUntil) {
    await sleep(state.backoffUntil - Date.now());
  }

  await acquireSlot(host, state);
  try {
    return await attemptFetch(url, init, host, state);
  } finally {
    releaseSlot(host, state);
  }
}

function acquireSlot(host: string, state: HostState): Promise<void> {
  return new Promise<void>((resolve) => {
    const grant = () => {
      const now = Date.now();
      const earliest = Math.max(now, state.nextAt);
      state.nextAt = earliest + MIN_GAP_MS + Math.random() * JITTER_MS;
      const wait = earliest - now;
      if (wait > 0) {
        sleep(wait).then(resolve);
      } else {
        resolve();
      }
    };
    if (state.active < MAX_PER_HOST) {
      state.active += 1;
      grant();
    } else {
      state.queue.push(grant);
    }
  });
}

function releaseSlot(host: string, state: HostState): void {
  void host;
  const next = state.queue.shift();
  if (next) next();
  else state.active = Math.max(0, state.active - 1);
}

async function attemptFetch(
  url: string,
  init: RequestInit | undefined,
  host: string,
  state: HostState
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, { ...init, credentials: 'omit' });
      if (res.status === 429) {
        const retryAfter = parseRetryAfter(
          res.headers.get('retry-after'),
          Date.now()
        );
        const backoff = Math.min(
          retryAfter || 1000 * 2 ** attempt,
          MAX_BACKOFF_MS
        );
        state.backoffUntil = Date.now() + backoff;
        lastErr = new Error(`429 on ${host}`);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('network failure');
}
