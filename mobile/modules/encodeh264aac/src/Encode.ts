import { requireNativeModule } from 'expo-modules-core';

export type EncodeModuleType = {
  encode(src: string, out: string): Promise<boolean>;
};

const native = requireNativeModule<EncodeModuleType>('EncodeH264Aac');

export const encodeToMp4 = (src: string, out: string): Promise<boolean> =>
  native.encode(src, out);
