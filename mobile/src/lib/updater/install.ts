import { File, Paths } from 'expo-file-system';
import { installApk, installViaSystem } from '../../../modules/silent-updater';
import { saveApkToFolder } from '../download/save';
import { sha256Hex } from './sha256';
import type { UpdateManifest } from './manifest';

const APK_NAME = 'phantom-update.apk';
const SILENT_GRACE_MS = 8_000;

// java File() treats 'file://' uris as literal paths; strip the scheme first
const toFsPath = (uri: string): string =>
  decodeURIComponent(uri.replace(/^file:\/\//u, ''));

export async function downloadApk(
  manifest: UpdateManifest,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const file = new File(Paths.cache, APK_NAME);
  if (file.exists) file.delete();
  // native downloader replaces the js chunk fetcher: streams to disk and
  // follows the release redirect natively — ranged chunking on rn fetch
  // was corrupting files intermittently
  await File.downloadFileAsync(manifest.apkUrl, file, {
    idempotent: true,
    signal,
    onProgress: (data) => onProgress(data.bytesWritten, data.totalBytes),
  });
  const digest = await sha256Hex(file);
  if (manifest.sha256 && digest !== manifest.sha256.toLowerCase()) {
    if (file.exists) file.delete();
    throw new Error('update: downloaded apk failed checksum, try again');
  }
  // oem roms choke on app-private cache files, so drop the apk into the
  // user's visible save folder — the same public path browser downloads take
  const saved = await saveApkToFolder(
    file,
    `phantom-v${manifest.version.replaceAll('.', '-')}.apk`,
    (pct) => {
      const total = manifest.size ?? 0;
      if (total > 0) onProgress(Math.round((pct / 100) * total), total);
    }
  );
  if (saved) return saved;
  // Paths.cache is a Directory object; template-stringing it yields '[object Object]' — pass the File's real uri instead
  return toFsPath(file.uri);
}

export async function installDownloadedApk(path: string): Promise<void> {
  try {
    if (path.startsWith('content://')) {
      // public folder files are staged by the system without ceremony
      await installViaSystem(path);
      return;
    }
    await installApk(path);
    // silent success kills this process; surviving the grace window means the
    // system declined it (oem roms) — hand off to the visible installer
    await new Promise((resolve) => setTimeout(resolve, SILENT_GRACE_MS));
    await installViaSystem(path);
  } finally {
    const file = new File(Paths.cache, APK_NAME);
    if (file.exists) file.delete();
  }
}