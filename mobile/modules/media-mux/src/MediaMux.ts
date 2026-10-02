import { requireNativeModule } from 'expo-modules-core';

export type MuxStats = {
  bytes: number;
  videoSamples: number;
  audioSamples: number;
};

type MediaMuxModuleType = {
  muxAv(videoPath: string, audioPath: string, outPath: string): Promise<MuxStats>;
  remuxParts(inputs: string[], outPath: string): Promise<MuxStats>;
  concatFiles(inputs: string[], outPath: string): Promise<{ bytes: number }>;
  remuxWebm(
    videoPath: string | null,
    audioPath: string | null,
    outPath: string
  ): Promise<{ bytes: number }>;
  cloneFragmentedMp4(inPath: string, outPath: string): Promise<{ bytes: number }>;
  demuxAudio(inPath: string, outPath: string): Promise<MuxStats>;
  extractFrame(inPath: string, outPath: string, positionUs: number): Promise<{ bytes: number }>;
  convertImage(
    inPath: string,
    outPath: string,
    format: string,
    maxEdge: number,
    quality: number
  ): Promise<{ bytes: number; width: number; height: number }>;
  tagAudioFile(
    srcPath: string,
    outPath: string,
    title: string | null,
    artist: string | null,
    album: string | null,
    coverPath: string | null
  ): Promise<{ bytes: number }>;
};

const native = requireNativeModule<MediaMuxModuleType>('MediaMux');

export function muxAv(
  videoPath: string,
  audioPath: string,
  outPath: string
): Promise<MuxStats> {
  return native.muxAv(videoPath, audioPath, outPath);
}

export function remuxParts(inputs: string[], outPath: string): Promise<MuxStats> {
  return native.remuxParts(inputs, outPath);
}

export function concatFiles(inputs: string[], outPath: string): Promise<{ bytes: number }> {
  return native.concatFiles(inputs, outPath);
}

export function remuxWebm(
  videoPath: string | null,
  audioPath: string | null,
  outPath: string
): Promise<{ bytes: number }> {
  return native.remuxWebm(videoPath, audioPath, outPath);
}

export function cloneFragmentedMp4(inPath: string, outPath: string): Promise<{ bytes: number }> {
  return native.cloneFragmentedMp4(inPath, outPath);
}

export function demuxAudio(inPath: string, outPath: string): Promise<MuxStats> {
  return native.demuxAudio(inPath, outPath);
}

export function extractFrame(
  inPath: string,
  outPath: string,
  positionUs: number
): Promise<{ bytes: number }> {
  return native.extractFrame(inPath, outPath, positionUs);
}

export function convertImage(
  inPath: string,
  outPath: string,
  format: string,
  maxEdge: number,
  quality: number
): Promise<{ bytes: number; width: number; height: number }> {
  return native.convertImage(inPath, outPath, format, maxEdge, quality);
}

export function tagAudioFile(
  srcPath: string,
  outPath: string,
  title: string | null,
  artist: string | null,
  album: string | null,
  coverPath: string | null
): Promise<{ bytes: number }> {
  return native.tagAudioFile(srcPath, outPath, title, artist, album, coverPath);
}
