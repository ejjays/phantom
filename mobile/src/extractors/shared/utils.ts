import { gatedFetch, timeoutSignal } from '../../lib/net';

// HEAD the media url for its size; referer+cookies sent because tokenized CDNs
// 403 bare requests. fail-soft: picker just shows no size.
export async function probeFileSize(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5000
): Promise<number | undefined> {
  try {
    const head = await gatedFetch(url, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
      signal: timeoutSignal(timeoutMs),
    });
    if (!head.ok) return undefined;
    const length = head.headers.get('content-length');
    return length ? parseInt(length, 10) : undefined;
  } catch {
    return undefined;
  }
}
