import { type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

export default function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const contentHeight = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    height: withTiming(open ? contentHeight.value : 0, { duration: 200 }),
    opacity: withTiming(open ? 1 : 0, { duration: 200 }),
  }));
  return (
    <Animated.View
      style={[style, { overflow: 'hidden', marginHorizontal: -20 }]}
    >
      <View
        style={{ position: 'absolute', left: 20, right: 20, top: 0 }}
        onLayout={(event) => {
          contentHeight.value = event.nativeEvent.layout.height;
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}
