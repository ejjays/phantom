import { useState, useEffect, useMemo } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { BackHandler } from 'react-native';
import { tapSelection } from '../lib/haptics';

// slide-right sub-screen pattern used by SettingsScreen overlays
export function useSubScreen(parentVisible: boolean) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-chain-state-updates -- mounted gates delayed-unmount animation
      setMounted(true);
      progress.value = withTiming(1, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      progress.value = withTiming(
        0,
        { duration: 220, easing: Easing.in(Easing.cubic) },
        (done) => {
          if (done) runOnJS(setMounted)(false);
        }
      );
    }
  }, [open, progress]);

  // back button closes the sub-screen
  useEffect(() => {
    if (!parentVisible || !open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      tapSelection();
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [parentVisible, open]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * 80 }],
  }));

  return useMemo(
    () => ({ open, setOpen, mounted, style }),
    [open, mounted, style]
  );
}
