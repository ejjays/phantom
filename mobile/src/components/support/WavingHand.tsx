import { useEffect } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export default function WavingHand({
  style,
}: {
  style?: StyleProp<TextStyle>;
}) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withSequence(
        withTiming(14, { duration: 250 }),
        withTiming(-8, { duration: 250 }),
        withTiming(14, { duration: 250 }),
        withTiming(-4, { duration: 250 }),
        withTiming(10, { duration: 250 }),
        withTiming(0, { duration: 250 }),
        withTiming(0, { duration: 1000 })
      ),
      -1
    );
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.Text
      style={[style, { transformOrigin: '70% 70%' }, animatedStyle]}
    >
      👋
    </Animated.Text>
  );
}
