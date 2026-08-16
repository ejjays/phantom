import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export default function GlowBlob({
  color,
  size,
  x,
  y,
}: {
  color: string;
  size: number;
  x: number;
  y: number;
}) {
  const gradientId = `blob-${color.replace(/[^a-z0-9]/gi, '')}-${x}-${y}`;
  return (
    <Svg
      width={size}
      height={size}
      pointerEvents="none"
      style={{ position: 'absolute', left: x, top: y }}
    >
      <Defs>
        <RadialGradient
          id={gradientId}
          cx="50%"
          cy="50%"
          r="50%"
          fx="50%"
          fy="50%"
        >
          <Stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <Stop offset="40%" stopColor={color} stopOpacity="0.25" />
          <Stop offset="75%" stopColor={color} stopOpacity="0.08" />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect
        x="0"
        y="0"
        width={size}
        height={size}
        fill={`url(#${gradientId})`}
      />
    </Svg>
  );
}
