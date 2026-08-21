import { requireNativeModule } from 'expo-modules-core';

export type MediaCopyModuleType = {
  copyRanges(src: string, dst: string, ranges: number[]): Promise<boolean>;
};

const native = requireNativeModule<MediaCopyModuleType>('MediaCopy');

// ranges = flat [dstOffset, srcOffset, length] triplets
export const copyRanges = (
  src: string,
  dst: string,
  ranges: number[]
): Promise<boolean> => native.copyRanges(src, dst, ranges);
