import { useCallback } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

export function usePressScale(target = 0.97) {
  const down = useSharedValue(0);
  const pressScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - down.value * (1 - target) }],
  }));
  const onPressIn = useCallback(() => {
    down.value = withTiming(1, { duration: 100, easing: Easing.out(Easing.cubic) });
  }, [down]);
  const onPressOut = useCallback(() => {
    down.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) });
  }, [down]);
  return { pressScaleStyle, onPressIn, onPressOut };
}
