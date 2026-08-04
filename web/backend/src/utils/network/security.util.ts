import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { URL } from 'node:url';
import { fetch as undiciFetch, Agent } from 'undici';

const PRIVATE_IP_RANGES = [
  /^127\./, // localhost
  /^10\./, // class a
  /^192\.168\./, // class c
  /^172\.(?:1[6-9]|2\d|3[0-1])\./, // class b
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
  /^100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // nat prefix
  /^255\.255\.255\.255$/, // broadcast
  /^(?:22[4-9]|23\d)\./, // multicast IPv4
  /^::1$/, // ipv6 local
  /^[fF][cCdD]/, // ipv6 unique
  /^[fF][eE][8-9a-bA-B]/, // ipv6 link-local
  /^::$/, // ipv6 unspecified
  /^[fF][fF]/, // ipv6 multicast
  /^::ffff:(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|169\.254\.|0\.|100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.|255\.255\.255\.255|22[4-9]\.|23\d\.)/, // ipv4 private
];

export function isSafeIp(ip: string): boolean {
  if (!isIP(ip)) return false;
  return !PRIVATE_IP_RANGES.some((regex) => regex.test(ip));
}

export async function resolveAndValidateHost(
  hostname: string
): Promise<string> {
  if (isIP(hostname)) {
    if (!isSafeIp(hostname)) {
      throw new Error(
        `SSRF Blocked: Attempted to access private IP (${hostname})`
      );
    }
    return hostname;
  }

  try {
    const { address } = await lookup(hostname, { family: 0 });
    if (!isSafeIp(address)) {
      throw new Error(
        `SSRF Blocked: Hostname ${hostname} resolved to private IP (${address})`
      );
    }
    return address;
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('SSRF')) throw error;
    throw new Error(`DNS Lookup failed for hostname: ${hostname}`, {
      cause: error,
    });
  }
}

const ssrfSafeAgent = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      return dnsLookup(hostname, options, (error, address, family) => {
        if (error) {
          callback(error, address as unknown as string, family);
          return;
        }

        const isArray = Array.isArray(address);
        const addrsToCheck = isArray
          ? (address as LookupAddress[])
          : [{ address: address as unknown as string }];

        for (const addr of addrsToCheck) {
          if (!isSafeIp(addr.address)) {
            callback(
              new Error(
                `[SSRF BLOCK] Resolution to internal IP blocked: ${addr.address}`
              ),
              address as unknown as string,
              family
            );
            return;
          }
        }

        callback(null, address as unknown as string, family);
      });
    },
  },
});

export async function secureFetch(
  targetUrl: string | URL,
  options: RequestInit = {}
): Promise<globalThis.Response> {
  const parsedUrl =
    typeof targetUrl === 'string' ? new URL(targetUrl) : targetUrl;
  const normalizedHeaders = new Headers(options.headers as HeadersInit);

  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    const response = await fetch(parsedUrl.toString(), {
      ...options,
      headers: normalizedHeaders,
      redirect: 'follow',
    });
    return response as globalThis.Response;
  }

  const response = await undiciFetch(parsedUrl.toString(), {
    ...(options as unknown as Record<string, unknown>),
    headers: normalizedHeaders,
    dispatcher: ssrfSafeAgent,
    redirect: 'follow',
  });

  return response as unknown as globalThis.Response;
}

export function resolveWithin(
  base: string,
  ...segments: string[]
): string | null {
  const root = path.resolve(base);
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
