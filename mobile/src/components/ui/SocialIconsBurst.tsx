import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { PlatformLogo, type PlatformName } from '../logos';

const FPS = 29.97;
const COMP = 500;
const POP_MS = (12 / FPS) * 1000;
const BADGE_FRAC = 79 / COMP;

type BadgeSpec = { name: PlatformName; x: number; y: number; delayF: number };

const BADGES: readonly BadgeSpec[] = [
  { name: 'facebook', x: 85, y: 146, delayF: 0 },
  { name: 'instagram', x: 198, y: 146, delayF: 4 },
  { name: 'x', x: 311, y: 146, delayF: 11 },
  { name: 'tiktok', x: 424, y: 146, delayF: 17 },
  { name: 'dailymotion', x: 85, y: 259, delayF: 25 },
  { name: 'youtube', x: 198, y: 259, delayF: 37 },
  { name: 'bluesky', x: 311, y: 259, delayF: 48 },
  { name: 'vimeo', x: 424, y: 259, delayF: 57 },
  { name: 'threads', x: 85, y: 371, delayF: 65 },
  { name: 'reddit', x: 198, y: 371, delayF: 74 },
  { name: 'soundcloud', x: 311, y: 371, delayF: 82 },
  { name: 'spotify', x: 424, y: 371, delayF: 91 },
];

function Badge({
  badge,
  size,
  elapsedMs,
}: {
  badge: BadgeSpec;
  size: number;
  elapsedMs: SharedValue<number>;
}) {
  const badgeSize = size * BADGE_FRAC;
  const left = (badge.x / COMP) * size - badgeSize / 2;
  const top = (badge.y / COMP) * size - badgeSize / 2;
  const delay = (badge.delayF / FPS) * 1000;

  const style = useAnimatedStyle(() => {
    const phase = (elapsedMs.value - delay) / POP_MS;
    return {
      opacity: interpolate(phase, [0, 0.12], [0, 1], Extrapolation.CLAMP),
      transform: [
        {
          scale: interpolate(
            phase,
            [0, 0.7, 1],
            [0, 1.06, 1],
            Extrapolation.CLAMP
          ),
        },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left,
          top,
          width: badgeSize,
          height: badgeSize,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <PlatformLogo name={badge.name} size={badgeSize} />
    </Animated.View>
  );
}

function SocialIconsBurst({ size }: { size: number }) {
  const elapsedMs = useSharedValue(0);
  const lastBadge = BADGES[BADGES.length - 1];
  const totalMs = (lastBadge.delayF / FPS) * 1000 + POP_MS;

  useEffect(() => {
    elapsedMs.value = 0;
    elapsedMs.value = withTiming(totalMs, {
      duration: totalMs,
      easing: Easing.linear,
    });
  }, [elapsedMs, totalMs]);

  return (
    <View style={{ width: size, height: size }}>
      {BADGES.map((badge) => (
        <Badge
          key={badge.name}
          badge={badge}
          size={size}
          elapsedMs={elapsedMs}
        />
      ))}
    </View>
  );
}

export default memo(SocialIconsBurst);
