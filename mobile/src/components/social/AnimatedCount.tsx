import { type TextStyle, type StyleProp } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

export default function AnimatedCount({
  value,
  style,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
}) {
  if (value <= 0) return null;
  return (
    <Animated.Text
      key={value}
      entering={FadeInDown.duration(200)}
      style={style}
    >
      {value}
    </Animated.Text>
  );
}
