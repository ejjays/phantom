import { File, Paths } from 'expo-file-system';
import { chunkedDownload } from '../download/download';
import { installApk } from '../../../modules/silent-updater';
import type { UpdateManifest } from './manifest';

const APK_NAME = 'phantom-update.apk';

export function apkPath(): string {
  return `${Paths.cache}/${APK_NAME}`;
}

// chunked downloader wants content-range support; storage serves it
export async function downloadApk(
  manifest: UpdateManifest,
  onProgress: (written: number, total: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const file = new File(Paths.cache, APK_NAME);
  if (file.exists) file.delete();
  await chunkedDownload(manifest.apkUrl, {}, file, onProgress, signal);
  return apkPath();
}

export async function installDownloadedApk(path: string): Promise<void> {
  try {
    await installApk(path);
  } finally {
    const file = new File(Paths.cache, APK_NAME);
    if (file.exists) file.delete();
  }
}