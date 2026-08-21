import { File, FileMode, Paths } from 'expo-file-system';
import ReactNativeBlobUtil from 'react-native-blob-util';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import {
  requestPermissionsAsync,
  saveToLibraryAsync,
} from 'expo-media-library/legacy';
import { supabase } from './supabase';
import { log, warn as logWarn } from '../log';
import { compressToWebp as nativeToWebp, convertToJpg } from '../../../modules/imagecodec';

function fsPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

// cap longest edge & webp q80 — visually lossless, ~10x smaller than the original
const MAX_EDGE = 1080;
const WEBP_QUALITY = 80;

/**
 * aspect (w/h) is carried as a URL fragment — client-only, never sent to R2 or
 * giphy, so the row can reserve its exact height & not reflow when the image
 * decodes (which caused scroll flicker). old media without it falls back to
 * measuring on load.
 */
export function withAspect(url: string, aspect: number): string {
  return aspect > 0 && Number.isFinite(aspect)
    ? `${url}#ar=${aspect.toFixed(4)}`
    : url;
}

export function readAspect(uri: string): number | undefined {
  const match = /#ar=([\d.]+)/u.exec(uri);
  const value = match ? Number.parseFloat(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function pickCommentImage(): Promise<{
  uri: string;
  aspect: number;
} | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 1,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) return null;
  const aspect =
    asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 0;
  return { uri: asset.uri, aspect };
}

export async function captureCommentImage(): Promise<{
  uri: string;
  aspect: number;
} | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.uri) return null;
  const aspect =
    asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 0;
  return { uri: asset.uri, aspect };
}

// min() guards prevent upscaling small images; decrease preserves aspect.
async function compressToWebp(srcUri: string): Promise<File> {
  const out = new File(Paths.cache, `cimg-${Crypto.randomUUID()}.webp`);
  const started = Date.now();
  try {
    const ok = await nativeToWebp(
      fsPath(srcUri),
      fsPath(out.uri),
      WEBP_QUALITY,
      MAX_EDGE
    );
    if (ok && out.exists) {
      log(
        'commentImage',
        `[webp] ${(out.size / 1024).toFixed(0)}KB in ${Date.now() - started}ms`
      );
      return out;
    }
  } catch (err: unknown) {
    logWarn(
      'commentImage',
      `[webp] ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (out.exists) out.delete();
  throw new Error('Could not process image');
}

// stream via blob-util wrap so a big webp doesn't OOM the JS heap.
async function uploadToR2(webp: File): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.functions.invoke('r2-upload-url', {
    body: {},
  });
  if (error) throw error;
  const { uploadUrl, publicUrl } = data as {
    uploadUrl: string;
    publicUrl: string;
  };
  const res = await ReactNativeBlobUtil.fetch(
    'PUT',
    uploadUrl,
    { 'Content-Type': 'image/webp' },
    ReactNativeBlobUtil.wrap(fsPath(webp.uri))
  );
  const status = res.info().status;
  if (status < 200 || status >= 300)
    throw new Error(`upload failed (${status})`);
  return publicUrl;
}

export async function uploadCommentImage(
  localUri: string,
  aspect = 0
): Promise<string> {
  const webp = await compressToWebp(localUri);
  try {
    return withAspect(await uploadToR2(webp), aspect);
  } finally {
    if (webp.exists) webp.delete();
  }
}

// q95 is visually lossless for gallery saves
async function webpToJpg(src: File, out: File): Promise<void> {
  const ok = await convertToJpg(fsPath(src.uri), fsPath(out.uri), 95);
  if (ok && out.exists) return;
  logWarn('commentImage', '[jpg] conversion failed');
  throw new Error('Could not convert image');
}

// download → convert → save to gallery → clean temps (even on failure).
// url fragment is stripped (never sent) but blob-util keeps it in file name.
export async function downloadCommentImageAsJpg(url: string): Promise<void> {
  const perm = await requestPermissionsAsync();
  if (!perm.granted) throw new Error('Gallery permission denied');
  const clean = url.split('#')[0];
  const stem = `phantom-${Crypto.randomUUID()}`;
  const webp = new File(Paths.cache, `${stem}.webp`);
  const jpg = new File(Paths.cache, `${stem}.jpg`);
  try {
    const res = await fetch(clean);
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (webp.exists) webp.delete();
    webp.create();
    const handle = webp.open(FileMode.WriteOnly);
    try {
      handle.writeBytes(bytes);
    } finally {
      handle.close();
    }
    await webpToJpg(webp, jpg);
    await saveToLibraryAsync(jpg.uri);
  } finally {
    if (webp.exists) webp.delete();
    if (jpg.exists) jpg.delete();
  }
}
