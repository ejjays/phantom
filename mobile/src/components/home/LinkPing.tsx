import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Link as LinkIcon } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';

const styles = StyleSheet.create({
  wrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ping: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#22d3ee',
  },
});

export default function LinkPing() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.bezier(0, 0, 0.2, 1) }),
      -1,
      false
    );
  }, [progress]);

  const pingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.75, 1], [0.5, 0, 0]),
    transform: [
      { scale: interpolate(progress.value, [0, 0.75, 1], [1, 2, 2]) },
    ],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View pointerEvents="none" style={[styles.ping, pingStyle]} />
      <LinkIcon size={20} color="#22d3ee" />
    </View>
  );
}
