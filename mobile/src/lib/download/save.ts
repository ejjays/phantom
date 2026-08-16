import type { File } from 'expo-file-system';
import {
  requestPermissionsAsync,
  saveToLibraryAsync,
} from 'expo-media-library/legacy';
import {
  StorageAccessFramework,
  readAsStringAsync,
  writeAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBlobUtil, { type Mediatype } from 'react-native-blob-util';
import { error as logError, log, warn as logWarn } from '../log';

const DIR_KEY = 'phantom.saf.dir';
const MEDIA_SUBFOLDER = 'Phantom';
export const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
// bigger slices = fewer saf round-trips
const CHUNK = 12 * 1024 * 1024;

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a' || ext === 'aac') return 'audio/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'video/mp4';
}

function readSaveDir(): Promise<string | null> {
  return AsyncStorage.getItem(DIR_KEY).catch(() => null);
}

async function pickSaveDir(): Promise<string | null> {
  const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perm.granted) return null;
  await AsyncStorage.setItem(DIR_KEY, perm.directoryUri).catch(() => undefined);
  return perm.directoryUri;
}

async function getSaveDir(): Promise<string | null> {
  const saved = await readSaveDir();
  return saved ?? (await pickSaveDir());
}

/*
 * streams in small slices to prevent OOM crashes on large files (e.g., 80MB video).
 * required cuz copyAsync cannot write directly to SAF content:// URIs.
 * uses read-slice + append; CHUNK size must be a multiple of 3 so base64
 * pieces lack padding & concatenate seamlessly.
 */
async function streamToSaf(
  source: File,
  destUri: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const size = source.size ?? 0;
  let offset = 0;
  while (offset < size) {
    const length = Math.min(CHUNK, size - offset);
    const chunk = await readAsStringAsync(source.uri, {
      encoding: EncodingType.Base64,
      position: offset,
      length,
    });
    await writeAsStringAsync(destUri, chunk, {
      encoding: EncodingType.Base64,
      append: offset > 0,
    });
    offset += length;
    onProgress?.(Math.round((offset / size) * 100));
  }
}

async function saveToFolder(
  source: File,
  onProgress?: (pct: number) => void
): Promise<boolean> {
  const dir = await getSaveDir();
  if (!dir) return false;
  let created = false;
  try {
    const stem = source.name.replace(/\.[^.]+$/u, '');
    const target = await StorageAccessFramework.createFileAsync(
      dir,
      stem,
      mimeFor(source.name)
    );
    created = true;
    await streamToSaf(source, target, onProgress);
    log('save', `[save] folder: ${source.name}`);
    return true;
  } catch (error) {
    // forget only when the dir itself failed (permission/removed); mid-stream
    // write errors are transient and the user's choice should survive
    if (!created) await AsyncStorage.removeItem(DIR_KEY).catch(() => undefined);
    logError(
      'save',
      `[save] folder save failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

// native mediastore copy; no base64, no bridge -> gallery speed
async function saveViaMediaStore(source: File): Promise<string> {
  const ext = source.name.split('.').pop()?.toLowerCase() ?? '';
  const collection: Mediatype = AUDIO_EXT.has(ext)
    ? 'Audio'
    : IMAGE_EXT.has(ext)
      ? 'Image'
      : 'Video';
  // blob-util .d.ts says path but native reads name
  const fd = {
    name: source.name,
    parentFolder: MEDIA_SUBFOLDER,
    mimeType: mimeFor(source.name),
  } as unknown as Parameters<
    typeof ReactNativeBlobUtil.MediaCollection.copyToMediaStore
  >[0];
  // decode %20 etc.; blob-util wants raw path not uri
  const srcPath = decodeURIComponent(source.uri.replace(/^file:\/\//u, ''));
  const uri = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
    fd,
    collection,
    srcPath
  );
  return uri;
}

export type SaveResult = { ok: boolean; uri?: string };

export async function saveToDevice(
  source: File,
  onProgress?: (pct: number) => void
): Promise<SaveResult> {
  try {
    const uri = await saveViaMediaStore(source);
    onProgress?.(100);
    log('save', `[save] mediastore: ${source.name}`);
    return { ok: true, uri };
  } catch (error) {
    logWarn(
      'save',
      `[save] mediastore failed, falling back: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const ok = await saveLegacy(source, onProgress);
  return { ok };
}

/*
 * fallback only; mediastore is primary.
 * Expo MediaLibrary only reliably supports images, not general files.
 * rejects audio outright, and some Android builds reject video with
 * "MIME type... expected image/*" errors.
 * solution: audio goes straight to SAF. video tries MediaLibrary first,
 * falling back to SAF if it fails.
 */
async function saveLegacy(
  source: File,
  onProgress?: (pct: number) => void
): Promise<boolean> {
  const ext = source.name.split('.').pop()?.toLowerCase() ?? '';

  /* gallery rejects audio; saf folder instead */
  if (AUDIO_EXT.has(ext)) return saveToFolder(source, onProgress);

  if (await readSaveDir()) return saveToFolder(source, onProgress);

  try {
    const perm = await requestPermissionsAsync();
    if (perm.granted) {
      await saveToLibraryAsync(source.uri);
      log('save', `[save] gallery: ${source.name}`);
      return true;
    }
    logWarn('save', `[save] permission denied (status=${perm.status})`);
  } catch (error) {
    logWarn(
      'save',
      `[save] gallery failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return saveToFolder(source, onProgress);
}
