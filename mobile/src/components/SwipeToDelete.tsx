import { type ReactNode, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  runOnJS,
  Easing,
  LinearTransition,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import LottieView from 'lottie-react-native';
import tw from '../lib/tw';
import trashBin from '../../assets/trash-bin.json';

const COMMIT = -0.28;
const FLING = -700;

export default function SwipeToDelete({
  onDelete,
  children,
  animate = true,
  capsule = false,
}: {
  onDelete: () => void;
  children: ReactNode;
  animate?: boolean;
  capsule?: boolean;
}) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);
  const fade = useSharedValue(1);
  const [playing, setPlaying] = useState(false);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => {
      runOnJS(setPlaying)(true);
    })
    .onUpdate((e) => {
      tx.value = Math.min(0, Math.max(-width, e.translationX));
    })
    .onEnd((e) => {
      const pull = e.translationX + e.velocityX * 0.15;
      if (e.velocityX < FLING || pull < width * COMMIT) {
        tx.value = withSequence(
          withTiming(
            -Math.max(width * 0.6, Math.abs(tx.value)),
            { duration: 110, easing: Easing.out(Easing.cubic) }
          ),
          withTiming(-width, { duration: 80, easing: Easing.in(Easing.cubic) },
            (finished) => {
              if (finished) runOnJS(onDelete)();
            }
          )
        );
        fade.value = withTiming(0, {
          duration: 170,
          easing: Easing.out(Easing.cubic),
        });
      } else {
        tx.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    opacity: fade.value,
  }));

  const revealStyle = useAnimatedStyle(() => ({
    width: Math.max(96, Math.abs(tx.value)),
    opacity: Math.min(1, Math.abs(tx.value) / 40) * fade.value,
  }));

  return (
    <Animated.View
      style={tw`overflow-hidden`}
      layout={animate ? LinearTransition.duration(200) : undefined}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          tw`absolute inset-y-0 right-0 items-center justify-center bg-red-500/90 ${capsule ? 'rounded-full' : ''}`,
          revealStyle,
        ]}
      >
        <LottieView
          key={playing ? 'play' : 'idle'}
          source={trashBin}
          autoPlay={playing}
          loop={false}
          onAnimationFinish={() => setPlaying(false)}
          style={{ width: 24, height: 24 }}
        />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[rowStyle, tw`bg-background`]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
