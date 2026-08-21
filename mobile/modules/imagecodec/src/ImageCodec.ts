import { requireNativeModule } from 'expo-modules-core';

export type ImageCodecModuleType = {
  toWebp(src: string, out: string, quality: number, maxEdge: number): Promise<boolean>;
  toJpg(src: string, out: string, quality: number): Promise<boolean>;
};

const native = requireNativeModule<ImageCodecModuleType>('ImageCodec');

export const compressToWebp = (
  src: string,
  out: string,
  quality: number,
  maxEdge: number
): Promise<boolean> => native.toWebp(src, out, quality, maxEdge);

export const convertToJpg = (
  src: string,
  out: string,
  quality: number
): Promise<boolean> => native.toJpg(src, out, quality);
