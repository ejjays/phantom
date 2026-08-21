import { File, Paths } from 'expo-file-system';
import {
  installApk,
  installViaSystem,
  saveToDownloads,
  hashFile,
} from '../../../modules/silent-updater';
import { saveApkToFolder } from '../download/save';
import { sha256Hex } from './sha256';
import type { UpdateManifest } from './manifest';

const APK_NAME = 'phantom-update.apk';
const SILENT_GRACE_MS = 8_000;

// java File() treats 'file://' uris as literal paths; strip scheme first
const toFsPath = (uri: string): string =>
  decodeURIComponent(uri.replace(/^file:\/\//u, ''));

const apkDisplayName = (version: string): string =>
  `phantom-v${version.replaceAll('.', '-')}.apk`;

export async function downloadApk(
  manifest: UpdateManifest,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const file = new File(Paths.cache, APK_NAME);
  if (file.exists) file.delete();
  // native downloader streams to disk; rn fetch ranged chunking corrupted files intermittently
  await File.downloadFileAsync(manifest.apkUrl, file, {
    idempotent: true,
    signal,
    onProgress: (data) => onProgress(data.bytesWritten, data.totalBytes),
  });
  let digest: string;
  try {
    digest = await hashFile(toFsPath(file.uri));
  } catch {
    digest = await sha256Hex(file);
  }
  if (manifest.sha256 && digest !== manifest.sha256.toLowerCase()) {
    if (file.exists) file.delete();
    throw new Error('update: downloaded apk failed checksum, try again');
  }
  const name = apkDisplayName(manifest.version);
  const saved = await saveToDownloads(toFsPath(file.uri), name).catch(
    () => null
  );
  if (saved) return saved;
  const safe = await saveApkToFolder(file, name, (pct) => {
    const total = manifest.size ?? 0;
    if (total > 0) onProgress(Math.round((pct / 100) * total), total);
  });
  if (safe) return safe;
  // Paths.cache stringifies as '[object Object]' — pass file.uri instead
  return toFsPath(file.uri);
}

export async function installDownloadedApk(path: string): Promise<void> {
  try {
    if (path.startsWith('content://')) {
      await installViaSystem(path);
      return;
    }
    await installApk(path);
    // silent install kills the process; surviving grace window = system declined (oem roms)
    await new Promise((resolve) => setTimeout(resolve, SILENT_GRACE_MS));
    await installViaSystem(path);
  } finally {
    const file = new File(Paths.cache, APK_NAME);
    if (file.exists) file.delete();
  }
}