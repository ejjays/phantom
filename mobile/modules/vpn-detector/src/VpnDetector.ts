import { requireNativeModule } from 'expo-modules-core';

type VpnDetectorModuleType = {
  isVpnActive(): Promise<boolean>;
};

const native = requireNativeModule<VpnDetectorModuleType>('VpnDetector');

export const isVpnActive = (): Promise<boolean> => native.isVpnActive();