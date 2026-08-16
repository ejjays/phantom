import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export default function VinylGrooves({ size = 96 }: { size?: number }) {
  const center = size / 2;
  const rings = [];
  for (let radius = 3; radius < center - 1; radius += 3) {
    rings.push(
      <Circle
        key={radius}
        cx={center}
        cy={center}
        r={radius}
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={1}
        fill="none"
      />
    );
  }
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: 0.3,
      }}
    >
      <Svg width={size} height={size}>
        {rings}
      </Svg>
    </View>
  );
}
