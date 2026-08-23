// per-host request gate; backs off on 429

type Waiter = () => void;
type HostState = { active: number; nextAt: number; queue: Waiter[] };

const MAX_PER_HOST = 3;
const MIN_GAP_MS = 300;
const JITTER_MS = 250;
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8000;

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
  const fresh: HostState = { active: 0, nextAt: 0, queue: [] };
  hosts.set(host, fresh);
  return fresh;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function acquire(host: string): Promise<void> {
  const state = stateFor(host);
  if (state.active >= MAX_PER_HOST) {
    // release hands the slot off; active stays
    await new Promise<void>((resolve) => state.queue.push(resolve));
  } else {
    state.active += 1;
  }
  // stagger starts so bursts look human
  const now = Date.now();
  const earliest = Math.max(now, state.nextAt);
  state.nextAt = earliest + MIN_GAP_MS + Math.random() * JITTER_MS;
  const wait = earliest - now;
  if (wait > 0) await sleep(wait);
}

function release(host: string): void {
  const state = stateFor(host);
  const next = state.queue.shift();
  if (next) next();
  else state.active = Math.max(0, state.active - 1);
}

// parse Retry-After (delta-seconds or HTTP-date) to ms
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now()
): number {
  if (!value) return 0;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return 0;
}

export function backoffMs(attempt: number, retryAfterMs: number): number {
  const base = retryAfterMs > 0 ? retryAfterMs : 500 * 2 ** attempt;
  return Math.min(base + Math.random() * JITTER_MS, MAX_BACKOFF_MS);
}

export async function gatedFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const host = hostOf(input);
  let attempt = 0;
  for (;;) {
    await acquire(host);
    let res: Response;
    try {
      res = await fetch(input, init);
    } finally {
      release(host);
    }
    const limited = res.status === 429 || res.status === 503;
    if (limited && attempt < MAX_RETRIES) {
      const delay = backoffMs(
        attempt,
        parseRetryAfter(res.headers.get('retry-after'))
      );
      attempt += 1;
      await sleep(delay);
      continue;
    }
    return res;
  }
}

export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

// bounded-concurrency map; avoids Promise.all CDN sprays
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };
  const size = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}
