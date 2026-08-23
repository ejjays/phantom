import { type ComponentProps } from 'react';
import { ScrollView } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {
  useGenericKeyboardHandler,
  useReanimatedFocusedInput,
} from 'react-native-keyboard-controller';
import { useScreenSize } from '../hooks/useScreenSize';
import tw from '../lib/tw';

type Props = ComponentProps<typeof ScrollView> & {
  gap?: number;
};

export default function KeyboardAvoidingForm({
  children,
  gap = 24,
  ...rest
}: Props) {
  const { height } = useScreenSize();
  const kb = useSharedValue(0);
  const { input } = useReanimatedFocusedInput();

  useGenericKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        kb.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        kb.value = event.height;
      },
    },
    []
  );

  const lift = useAnimatedStyle(() => {
    const layout = input.value?.layout;
    if (!layout || kb.value === 0) return { transform: [{ translateY: 0 }] };
    const overlap =
      layout.absoluteY + layout.height + gap - (height - kb.value);
    return { transform: [{ translateY: -Math.max(0, overlap) }] };
  });

  return (
    <ScrollView
      style={tw`flex-1`}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      {...rest}
    >
      <Animated.View style={lift}>{children}</Animated.View>
    </ScrollView>
  );
}
