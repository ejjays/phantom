import { File, Paths } from 'expo-file-system';
import { chunkedDownload } from '../download/download';
import { installApk, installViaSystem } from '../../../modules/silent-updater';
import { sha256Hex } from './sha256';
import type { UpdateManifest } from './manifest';

const APK_NAME = 'phantom-update.apk';
const SILENT_GRACE_MS = 8_000;

// java File() treats 'file://' uris as literal paths; strip the scheme first
const toFsPath = (uri: string): string =>
  decodeURIComponent(uri.replace(/^file:\/\//u, ''));

// github release urls 302 to a signed cdn; rn fetch drops the Range header on
// that redirect, so resolve the final host first and chunk from there
async function resolveFinalUrl(
  url: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });
  return res.url || url;
}

// chunked downloader wants content-range support; storage serves it
export async function downloadApk(
  manifest: UpdateManifest,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const file = new File(Paths.cache, APK_NAME);
  if (file.exists) file.delete();
  await chunkedDownload(
    await resolveFinalUrl(manifest.apkUrl, signal),
    {},
    file,
    onProgress,
    signal
  );
  const digest = await sha256Hex(file);
  if (manifest.sha256 && digest !== manifest.sha256.toLowerCase()) {
    if (file.exists) file.delete();
    throw new Error('update: downloaded apk failed checksum, try again');
  }
  // Paths.cache is a Directory object; template-stringing it yields '[object Object]' — pass the File's real uri instead
  return toFsPath(file.uri);
}

export async function installDownloadedApk(path: string): Promise<void> {
  try {
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