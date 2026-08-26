import { Text, Pressable, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import tw from '../lib/tw';

type Button3DProps = {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  retry?: boolean;
  testID?: string;
  onPress: () => void;
};

const LIFT = 5;
const RETRY_FILL_MS = 400;

export default function Button3D({
  label,
  loading,
  disabled,
  retry,
  testID,
  onPress,
}: Button3DProps) {
  const down = useSharedValue(0);
  const fill = useSharedValue(0);

  useEffect(() => {
    fill.value = withTiming(retry ? 1 : 0, {
      duration: RETRY_FILL_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [retry, fill]);

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -LIFT + down.value * LIFT }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
  }));

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      onPressIn={() => {
        down.value = withTiming(1, { duration: 50 });
      }}
      onPressOut={() => {
        down.value = withTiming(0, { duration: 50 });
      }}
      style={[tw`mt-4 rounded-full bg-cyan-800`, disabled && tw`opacity-50`]}
    >
      <Animated.View
        style={[
          tw`w-full items-center justify-center rounded-full bg-cyan-500 py-3`,
          { overflow: 'hidden' },
          faceStyle,
        ]}
      >
        <Animated.View
          style={[tw`absolute inset-0 rounded-full bg-red-500`, fillStyle]}
        />
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text
            style={tw`text-lg font-mono-bold uppercase tracking-wider text-white`}
          >
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}
