import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DownloadOptions } from 'expo-file-system';
import { downloadApk } from '../src/lib/updater/install';

vi.mock('../src/lib/updater/sha256', () => ({ sha256Hex: vi.fn() }));
vi.mock('../modules/silent-updater', () => ({
  installApk: vi.fn(),
  installViaSystem: vi.fn(),
}));
vi.mock('expo-file-system', () => {
  class FakeFile {
    static readonly downloadFileAsync = vi.fn(
      (_url: string, file: FakeFile, _options?: DownloadOptions) =>
        Promise.resolve(file)
    );
    exists = true;
    uri = 'file:///data/cache/phantom-update.apk';
    delete = vi.fn();
  }
  return { File: FakeFile, Paths: { cache: '/data/cache' } };
});

import { File } from 'expo-file-system';
import { sha256Hex } from '../src/lib/updater/sha256';
import type { UpdateManifest } from '../src/lib/updater/manifest';

const downloadMock = vi.mocked(File.downloadFileAsync);
const shaMock = vi.mocked(sha256Hex);

const goodDigest = 'aa'.repeat(32);

const manifest: UpdateManifest = {
  version: '1.2.10',
  apkUrl: 'https://github.com/ejjays/phantom/releases/download/v1.2.10/app-release.apk',
  sha256: goodDigest,
  notes: '',
  size: 1024,
};

describe('downloadApk', () => {
  beforeEach(() => {
    downloadMock.mockReset();
    shaMock.mockReset();
  });

  it('downloads natively with the manifest url', async () => {
    shaMock.mockResolvedValue(goodDigest);

    const path = await downloadApk(manifest, () => {});
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(downloadMock.mock.calls[0][0]).toBe(manifest.apkUrl);
    expect(downloadMock.mock.calls[0][2]).toMatchObject({ idempotent: true });
    expect(path).toBe('/data/cache/phantom-update.apk');
  });

  it('forwards progress events', async () => {
    shaMock.mockResolvedValue(goodDigest);
    const progress = vi.fn();

    await downloadApk(manifest, progress);

    const onProgressCb = downloadMock.mock.calls[0][2]?.onProgress;
    expect(typeof onProgressCb).toBe('function');
    onProgressCb?.({ bytesWritten: 500, totalBytes: 1024 });
    expect(progress).toHaveBeenCalledWith(500, 1024);
  });

  it('deletes the file and throws when the checksum does not match', async () => {
    shaMock.mockResolvedValue('ff'.repeat(32));

    await expect(downloadApk(manifest, () => {})).rejects.toThrow(
      /checksum/iu
    );
  });
});