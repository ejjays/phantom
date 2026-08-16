import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DownloadOptions } from 'expo-file-system';
import { downloadApk, installDownloadedApk } from '../src/lib/updater/install';

vi.mock('../src/lib/updater/sha256', () => ({ sha256Hex: vi.fn() }));
vi.mock('../src/lib/download/save', () => ({ saveApkToFolder: vi.fn() }));
vi.mock('../modules/silent-updater', () => ({
  installApk: vi.fn(),
  installViaSystem: vi.fn(),
  saveToDownloads: vi.fn(),
  hashFile: vi.fn(),
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
import { saveApkToFolder } from '../src/lib/download/save';
import {
  installApk,
  installViaSystem,
  saveToDownloads,
  hashFile,
} from '../modules/silent-updater';
import type { UpdateManifest } from '../src/lib/updater/manifest';

const downloadMock = vi.mocked(File.downloadFileAsync);
const shaMock = vi.mocked(sha256Hex);
const hashMock = vi.mocked(hashFile);
const saveMock = vi.mocked(saveApkToFolder);
const downloadsMock = vi.mocked(saveToDownloads);
const installApkMock = vi.mocked(installApk);
const installViaMock = vi.mocked(installViaSystem);

const goodDigest = 'aa'.repeat(32);
const contentUri = 'content://com.android.externalstorage.documents/123/phantom-v1-2-12.apk';

const manifest: UpdateManifest = {
  version: '1.2.12',
  apkUrl: 'https://github.com/ejjays/phantom/releases/download/v1.2.12/app-release.apk',
  sha256: goodDigest,
  notes: '',
  size: 1024,
};

describe('downloadApk', () => {
  beforeEach(() => {
    downloadMock.mockReset();
    shaMock.mockReset();
    hashMock.mockReset();
    saveMock.mockReset();
    downloadsMock.mockReset();
  });

  it('hashes natively then saves into mediastore downloads', async () => {
    hashMock.mockResolvedValue(goodDigest);
    downloadsMock.mockResolvedValue(contentUri);

    const path = await downloadApk(manifest, () => {});
    expect(hashMock).toHaveBeenCalledWith(
      '/data/cache/phantom-update.apk'
    );
    expect(downloadMock).toHaveBeenCalledWith(
      manifest.apkUrl,
      expect.anything(),
      expect.objectContaining({ idempotent: true })
    );
    expect(downloadsMock).toHaveBeenCalledWith(
      '/data/cache/phantom-update.apk',
      'phantom-v1-2-12.apk'
    );
    expect(saveMock).not.toHaveBeenCalled();
    expect(path).toBe(contentUri);
  });

  it('falls back to the js digest when native hashing is unavailable', async () => {
    hashMock.mockRejectedValue(new Error('missing'));
    shaMock.mockResolvedValue(goodDigest);
    downloadsMock.mockResolvedValue(contentUri);

    const path = await downloadApk(manifest, () => {});
    expect(shaMock).toHaveBeenCalled();
    expect(path).toBe(contentUri);
  });

  it('falls back to the save folder when mediastore is unavailable', async () => {
    hashMock.mockResolvedValue(goodDigest);
    downloadsMock.mockRejectedValue(new Error('api 29+'));
    saveMock.mockResolvedValue(contentUri);

    const path = await downloadApk(manifest, () => {});
    expect(saveMock).toHaveBeenCalled();
    expect(path).toBe(contentUri);
  });

  it('falls back to the cache file when every public save fails', async () => {
    hashMock.mockResolvedValue(goodDigest);
    downloadsMock.mockRejectedValue(new Error('no'));
    saveMock.mockResolvedValue(null);

    const path = await downloadApk(manifest, () => {});
    expect(path).toBe('/data/cache/phantom-update.apk');
  });

  it('forwards progress events', async () => {
    hashMock.mockResolvedValue(goodDigest);
    downloadsMock.mockResolvedValue(contentUri);
    saveMock.mockResolvedValue(contentUri);
    const progress = vi.fn();

    await downloadApk(manifest, progress);

    const onProgressCb = downloadMock.mock.calls[0][2]?.onProgress;
    expect(typeof onProgressCb).toBe('function');
    onProgressCb?.({ bytesWritten: 500, totalBytes: 1024 });
    expect(progress).toHaveBeenCalledWith(500, 1024);
  });

  it('deletes the file and throws when the checksum does not match', async () => {
    hashMock.mockResolvedValue('ff'.repeat(32));

    await expect(downloadApk(manifest, () => {})).rejects.toThrow(
      /checksum/iu
    );
  });
});

describe('installDownloadedApk', () => {
  beforeEach(() => {
    installApkMock.mockReset();
    installViaMock.mockReset();
  });

  it('hands content uris straight to the system installer', async () => {
    await installDownloadedApk(contentUri);
    expect(installViaMock).toHaveBeenCalledWith(contentUri);
    expect(installApkMock).not.toHaveBeenCalled();
  });

  it('tries the silent installer first for plain file paths', async () => {
    vi.useFakeTimers();
    try {
      installViaMock.mockResolvedValue('started');
      const attempt = installDownloadedApk('/data/cache/phantom-update.apk');
      await vi.advanceTimersByTimeAsync(8_000);
      await attempt;
      expect(installApkMock).toHaveBeenCalledWith(
        '/data/cache/phantom-update.apk'
      );
      expect(installViaMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});