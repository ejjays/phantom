import { internalFreeBytes } from '../../../modules/storage-info';

// kick a download before it OOMs the disk: warn above this threshold,
// hard-fail above it. cache holds temp + muxed output, so the working
// set of one download is ~2x the final file
const WARN_FREE = 500 * 1024 * 1024;
const HARD_MIN_FREE = 150 * 1024 * 1024;

export type StorageCheckResult =
  | { ok: true }
  | { ok: false; reason: 'no-space' | 'low-space'; message: string };

const fmt = (mb: number): string => `${Math.round(mb)}MB`;

export async function checkStorageBeforeDownload(
  bytesNeeded: number,
  knownBytes: number | undefined
): Promise<StorageCheckResult> {
  let free: number;
  try {
    free = await internalFreeBytes();
  } catch {
    // native module absent (dev without rebuild): skip the gate
    return { ok: true };
  }
  const estimate =
    bytesNeeded > 0 ? bytesNeeded : Math.max(knownBytes ?? 0, 0);
  if (estimate <= 0) return { ok: true };
  const working = estimate * 2;
  if (free < HARD_MIN_FREE) {
    return {
      ok: false,
      reason: 'no-space',
      message: `Disk nearly full (${fmt(free / 1048576)} free). Clear space and retry.`,
    };
  }
  if (free < working || free < WARN_FREE) {
    return {
      ok: false,
      reason: 'low-space',
      message: `Download needs ~${fmt(working / 1048576)} (${fmt(free / 1048576)} free). Low storage may fail halfway.`,
    };
  }
  return { ok: true };
}