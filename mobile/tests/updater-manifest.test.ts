import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compareVersions,
  parseManifest,
  latestManifestUrl,
  checkForUpdate,
} from '../src/lib/updater/manifest';

vi.mock('../src/lib/net', () => ({ gatedFetch: vi.fn() }));
import { gatedFetch } from '../src/lib/net';

const fetchMock = vi.mocked(gatedFetch);

function jsonResponse(body: unknown) {
  return {
    status: 200,
    ok: true,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('parseManifest', () => {
  it('parses a full manifest', () => {
    expect(
      parseManifest(
        JSON.stringify({
          version: '1.2.2',
          apkUrl: 'https://x/storage/v1/object/public/apk/phantom-v1.2.2.apk',
          notes: 'fixes',
          sha256: 'abc',
        })
      )
    ).toEqual({
      version: '1.2.2',
      apkUrl: 'https://x/storage/v1/object/public/apk/phantom-v1.2.2.apk',
      notes: 'fixes',
      sha256: 'abc',
    });
  });

  it.each(['{"version":1}', '{}', 'not json'])('rejects bad input %s', (text) => {
    expect(() => parseManifest(text)).toThrow();
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.2.1', '1.2.1', 0],
    ['1.2.1', '1.3.0', -1],
    ['1.3.0', '1.2.1', 1],
    ['1.2', '1.2.1', -1],
    ['1.2.1', '1.2', 1],
    ['2.0.0', '1.9.9', 1],
    ['1.2.1', '1.2.1.extra', 0],
    ['1.2.1-rc.5', '1.2.1', 1],
    ['abc', '1.0.0', -1],
  ])('%s vs %s -> %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });
});

describe('latestManifestUrl', () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  });

  it('points at the public apk bucket', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    expect(latestManifestUrl()).toBe(
      'https://proj.supabase.co/storage/v1/object/public/apk/latest.json'
    );
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
    fetchMock.mockReset();
  });

  it('returns available when remote is newer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ version: '1.2.2', apkUrl: 'https://x/a.apk' })
    );
    const update = await checkForUpdate('1.2.1');
    expect(update?.status).toBe('available');
    expect(update?.manifest.version).toBe('1.2.2');
  });

  it('returns null when installed is current or newer', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ version: '1.2.1', apkUrl: 'https://x/a.apk' })
    );
    expect(await checkForUpdate('1.2.1')).toBeNull();
    expect(await checkForUpdate('1.2.2')).toBeNull();
  });

  it('treats 404 as no release', async () => {
    fetchMock.mockResolvedValue({ status: 404, ok: false } as Response);
    expect(await checkForUpdate('1.0.0')).toBeNull();
  });

  it('soft-fails on network errors and malformed payloads', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await checkForUpdate('1.0.0')).toBeNull();

    fetchMock.mockResolvedValue(jsonResponse({ version: 'x' }));
    expect(await checkForUpdate('1.0.0')).toBeNull();
  });
});