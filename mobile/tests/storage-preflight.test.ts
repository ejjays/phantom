import { describe, it, expect, vi } from 'vitest';

const { mockFree, mockReject } = vi.hoisted(() => ({
  mockFree: { value: 0 },
  mockReject: { value: false },
}));

vi.mock('../modules/storage-info', () => ({
  internalFreeBytes: () =>
    mockReject.value
      ? Promise.reject(new Error('not installed'))
      : Promise.resolve(mockFree.value as number),
}));

import { checkStorageBeforeDownload } from '../src/lib/download/storagePreflight';

const MB = 1024 * 1024;

describe('checkStorageBeforeDownload', () => {
  it('passes when plenty of space', async () => {
    mockFree.value = 10 * 1024 * MB;
    const result = await checkStorageBeforeDownload(100 * MB, undefined);
    expect(result.ok).toBe(true);
  });

  it('fails hard when disk nearly full', async () => {
    mockFree.value = 100 * MB; // below HARD_MIN_FREE (150MB)
    const result = await checkStorageBeforeDownload(50 * MB, undefined);
    expect(result).toMatchObject({ ok: false, reason: 'no-space' });
  });

  it('fails when working set exceeds free space', async () => {
    mockFree.value = 800 * MB; // below working set (2x estimate)
    const result = await checkStorageBeforeDownload(600 * MB, undefined);
    expect(result).toMatchObject({ ok: false, reason: 'low-space' });
  });

  it('uses duration fallback when filesize unknown', async () => {
    mockFree.value = 300 * MB; // below WARN_FREE (500MB)
    const result = await checkStorageBeforeDownload(0, 600); // 600s of content
    expect(result.ok).toBe(false);
  });

  it('passes when no size info at all', async () => {
    mockFree.value = 300 * MB;
    const result = await checkStorageBeforeDownload(0, undefined);
    expect(result.ok).toBe(true);
  });

  it('skips the gate when the native module fails', async () => {
    mockReject.value = true;
    const result = await checkStorageBeforeDownload(999 * MB, undefined);
    expect(result.ok).toBe(true);
  });
});