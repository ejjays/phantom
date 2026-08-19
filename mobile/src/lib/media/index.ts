import { File } from 'expo-file-system';
import { demuxToM4a as demuxCore, hlsConcatToMp4 as hlsConcatCore, hlsMergeToMp4 as hlsMergeCore, muxVideoAudio as muxCore, remuxToMp4 as remuxCore } from './mp4';
import { tagAudio as tagCore } from './tag';
import type { TagMeta } from './tag';
import { expoIo } from './ioExpo';

// File-typed wrappers mirroring the ffmpeg mux.ts signatures so the
// pipeline can swap implementations without changing call sites.
export function muxVideoAudio(video: File, audio: File, out: File): Promise<boolean> {
  return muxCore(expoIo, video.uri, audio.uri, out.uri);
}

export function demuxToM4a(src: File, out: File): Promise<boolean> {
  return demuxCore(expoIo, src.uri, out.uri);
}

export function remuxToMp4(src: File, out: File): Promise<boolean> {
  return remuxCore(expoIo, src.uri, out.uri);
}

export function hlsConcatToMp4(src: File, out: File): Promise<boolean> {
  return hlsConcatCore(expoIo, src.uri, out.uri);
}

export function hlsMergeToMp4(video: File, audio: File, out: File): Promise<boolean> {
  return hlsMergeCore(expoIo, video.uri, audio.uri, out.uri);
}

export function tagAudio(
  audio: File,
  out: File,
  meta: TagMeta,
  cover?: File
): Promise<boolean> {
  return tagCore(expoIo, audio.uri, out.uri, meta, cover?.uri);
}
