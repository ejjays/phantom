import { useState, useEffect, useMemo } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { tapSelection } from '../lib/haptics';
import { useBackHandler } from '../lib/back';

export function useSubScreen(parentVisible: boolean, priority = 10) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mounted gates delayed-unmount animation
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

  // back button closes the sub-screen (higher priority than app go-home)
  useBackHandler(() => {
    if (!parentVisible || !open) return false;
    tapSelection();
    setOpen(false);
    return true;
  }, priority);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * 80 }],
  }));

  return useMemo(
    () => ({ open, setOpen, mounted, style }),
    [open, mounted, style]
  );
}
