import { type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Trash2 } from 'lucide-react-native';
import tw from '../lib/tw';

const COMMIT = -0.28;
const FLING = -700;

export default function SwipeToDelete({
  onDelete,
  children,
}: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      tx.value = Math.min(0, Math.max(-width, e.translationX));
    })
    .onEnd((e) => {
      const pull = e.translationX + e.velocityX * 0.15;
      if (e.velocityX < FLING || pull < width * COMMIT) {
        tx.value = withSequence(
          withTiming(
            -Math.max(width * 0.6, Math.abs(tx.value)),
            { duration: 120, easing: Easing.out(Easing.cubic) }
          ),
          withTiming(
            -width,
            { duration: 90, easing: Easing.in(Easing.cubic) },
            () => runOnJS(onDelete)()
          )
        );
      } else {
        tx.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  const revealStyle = useAnimatedStyle(() => ({
    width: Math.max(96, Math.abs(tx.value)),
    opacity: Math.min(1, Math.abs(tx.value) / 40),
  }));

  return (
    <View style={tw`overflow-hidden`}>
      <Animated.View
        pointerEvents="none"
        style={[
          tw`absolute inset-y-0 right-0 items-center justify-center bg-red-500/90`,
          revealStyle,
        ]}
      >
        <Trash2 size={20} color="#fff" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, tw`bg-background`]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}