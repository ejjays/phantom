import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import tw from '../lib/tw';

export default function CyanButton({
  label,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const isDisabled = Boolean(disabled || loading);
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.45,
    transform: [{ scale: 1 + pulse.value * 0.06 }],
  }));

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', top: -28, left: -28, right: -28, bottom: -28 },
          haloStyle,
        ]}
      >
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
              <Stop offset="45%" stopColor="#0e7490" stopOpacity={0.3} />
              <Stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#halo)" />
        </Svg>
      </Animated.View>

      <Pressable
        disabled={isDisabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={({ pressed }) => [
          tw.style('rounded-3xl', isDisabled && 'opacity-50'),
          pressed && !isDisabled ? tw`opacity-90` : null,
        ]}
      >
        <LinearGradient
          colors={['#00c0b7', '#002396'] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={tw`items-center justify-center overflow-hidden rounded-3xl py-4`}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={tw`text-[15px] font-mono-bold uppercase tracking-wider text-white`}>
              {label}
            </Text>
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}
