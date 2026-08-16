import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadApk } from '../src/lib/updater/install';

vi.mock('../src/lib/download/download', () => ({ chunkedDownload: vi.fn() }));
vi.mock('../src/lib/updater/sha256', () => ({ sha256Hex: vi.fn() }));
vi.mock('../modules/silent-updater', () => ({
  installApk: vi.fn(),
  installViaSystem: vi.fn(),
}));
vi.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    uri = 'file:///data/cache/phantom-update.apk';
    delete = vi.fn();
  },
  Paths: { cache: '/data/cache' },
}));

import { chunkedDownload } from '../src/lib/download/download';
import { sha256Hex } from '../src/lib/updater/sha256';
import type { UpdateManifest } from '../src/lib/updater/manifest';

const chunkedMock = vi.mocked(chunkedDownload);
const shaMock = vi.mocked(sha256Hex);

const goodDigest = 'aa'.repeat(32);

const manifest: UpdateManifest = {
  version: '1.2.8',
  apkUrl: 'https://github.com/ejjays/phantom/releases/download/v1.2.8/app-release.apk',
  sha256: goodDigest,
  notes: '',
};

function headResponse(url: string) {
  return { url } as Response;
}

describe('downloadApk', () => {
  beforeEach(() => {
    chunkedMock.mockReset();
    shaMock.mockReset();
  });

  it('chunks from the post-redirect url, not the github one', async () => {
    const finalUrl =
      'https://release-assets.githubusercontent.com/expiring-signed/app.apk';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(headResponse(finalUrl)));
    shaMock.mockResolvedValue(goodDigest);

    const path = await downloadApk(manifest, () => {});
    expect(chunkedMock).toHaveBeenCalledTimes(1);
    expect(chunkedMock.mock.calls[0][0]).toBe(finalUrl);
    expect(path).toBe('/data/cache/phantom-update.apk');
  });

  it('keeps the original url when there is no redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(headResponse('')));
    shaMock.mockResolvedValue(goodDigest);

    await downloadApk(manifest, () => {});
    expect(chunkedMock.mock.calls[0][0]).toBe(manifest.apkUrl);
  });

  it('deletes the file and throws when the checksum does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(headResponse('')));
    shaMock.mockResolvedValue('ff'.repeat(32));

    await expect(downloadApk(manifest, () => {})).rejects.toThrow(
      /checksum/iu
    );
  });
});