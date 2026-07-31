import { useEffect, useRef, useState, type ComponentType } from 'react';
import { View, Text, Pressable, StyleSheet, AppState } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import tw from '../lib/tw';
import { tapSelection } from '../lib/haptics';
import { textOutline } from './HeroLottieCard';
import astronaut from '../../assets/astronaut.webp';

type SocialLink = {
  id: string;
  Icon: ComponentType<{ size?: number; color?: string }>;
  color: string;
  fillColor: string;
  url: string;
};

const STAR_LAYERS = [0, 1, 2] as const;
const STAR_DELAYS = [0, 400, 800];

const STAR_DESIGN_W = 546;
const STAR_DESIGN_H = 370;
const STAR_LAYOUT: readonly (readonly (readonly [number, number])[])[] = [
  [
    [220, 118],
    [280, 176],
    [40, 50],
    [60, 180],
    [120, 130],
    [180, 176],
    [220, 290],
    [520, 250],
    [400, 220],
    [50, 350],
    [10, 230],
  ],
  [
    [140, 20],
    [425, 20],
    [70, 120],
    [20, 130],
    [110, 80],
    [280, 80],
    [250, 350],
    [280, 230],
    [220, 190],
    [450, 100],
    [380, 80],
    [520, 50],
  ],
  [
    [490, 330],
    [420, 300],
    [320, 280],
    [380, 350],
    [546, 170],
    [420, 180],
    [370, 150],
    [200, 250],
    [80, 20],
    [190, 50],
    [270, 20],
    [120, 230],
    [350, 0],
    [150, 369],
  ],
];

function Streak({
  travel,
  delay,
  top,
  left,
}: {
  travel: number;
  delay: number;
  top: number;
  left: number;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 2300 })
        ),
        -1
      )
    );
  }, [progress, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.12, 0.7, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [0, -travel]) },
      { translateY: interpolate(progress.value, [0, 1], [0, travel]) },
      { rotate: '-45deg' },
    ],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', top, left, width: 80, height: 1 }, style]}
    >
      <LinearGradient
        colors={['#ffffff', 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1, borderRadius: 1 }}
      />
    </Animated.View>
  );
}

function IconButton({
  id,
  Icon,
  color,
  fillColor,
  active,
  onActivate,
}: SocialLink & {
  active: boolean;
  onActivate: () => void;
}) {
  const progress = useSharedValue(0);
  const target = id === 'instagram' ? 1.4 : 1.25;
  useEffect(() => {
    progress.value = active
      ? withTiming(1, { duration: 160, easing: Easing.out(Easing.quad) })
      : withTiming(0, { duration: 400, easing: Easing.inOut(Easing.ease) });
  }, [active, progress]);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, target]) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    zIndex: progress.value > 0.12 ? 0 : 2,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-8, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [-8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [1, 4.5]) },
    ],
  }));
  const restColorStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0]),
  }));
  return (
    <Pressable onPress={onActivate} hitSlop={8} style={tw`mr-5`}>
      <Animated.View style={[{ zIndex: 1 }, iconStyle]}>
        <Icon size={24} color={fillColor} />
        <Animated.View style={[StyleSheet.absoluteFill, restColorStyle]}>
          <Icon size={24} color={color} />
        </Animated.View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 8,
            top: 8,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#ffffff',
            boxShadow:
              '0px 0px 10px 0px rgba(233, 233, 233, 0.5), 0px 0px 10px 0px rgba(192, 192, 192, 0.5)',
          },
          glowStyle,
        ]}
      />
    </Pressable>
  );
}

export default function SocialCard({
  width,
  height,
  links,
  onOpen,
  onInteraction,
}: {
  width: number;
  height: number;
  links: readonly SocialLink[];
  onOpen: (url: string) => void;
  onInteraction?: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (openTimer.current) clearTimeout(openTimer.current);
  };
  const activate = (link: SocialLink) => {
    if (!link.url) return;
    tapSelection();
    clearTimers();
    setActiveId(link.id);
    openTimer.current = setTimeout(() => onOpen(link.url), 450);
    dismissTimer.current = setTimeout(() => setActiveId(null), 15000);
  };
  const dismiss = () => {
    clearTimers();
    setActiveId(null);
  };
  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') dismiss();
    });
    return () => sub.remove();
  }, []);

  const float = useSharedValue(0);
  const t0 = useSharedValue(0);
  const t1 = useSharedValue(0);
  const t2 = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
      -1,
      false
    );
    const spin = { duration: 500, easing: Easing.linear };
    t0.value = withRepeat(withTiming(1, spin), -1, true);
    t1.value = withDelay(
      STAR_DELAYS[1],
      withRepeat(withTiming(1, spin), -1, true)
    );
    t2.value = withDelay(
      STAR_DELAYS[2],
      withRepeat(withTiming(1, spin), -1, true)
    );
  }, [float, t0, t1, t2]);

  const astroStyle = useAnimatedStyle(() => {
    const a = float.value * 2 * Math.PI;
    return {
      transform: [
        { translateX: Math.sin(a) * 14 },
        { translateY: Math.sin(2 * a) * 8 },
        { rotate: `${Math.sin(a) * 8}deg` },
      ],
    };
  });
  const layer0 = useAnimatedStyle(() => ({ opacity: t0.value }));
  const layer1 = useAnimatedStyle(() => ({ opacity: t1.value }));
  const layer2 = useAnimatedStyle(() => ({ opacity: t2.value }));
  const layerStyles = [layer0, layer1, layer2];

  return (
    <Pressable
      onPress={dismiss}
      onPressIn={onInteraction}
      style={[
        tw`overflow-hidden rounded-3xl border border-white/10`,
        { width, height, backgroundColor: '#171717' },
      ]}
    >
      {STAR_LAYERS.map((layer) => (
        <Animated.View
          key={layer}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, layerStyles[layer]]}
        >
          {STAR_LAYOUT[layer].map(([sx, sy]) => (
            <View
              key={`${sx}-${sy}`}
              style={{
                position: 'absolute',
                left: (sx / STAR_DESIGN_W) * width,
                top: (sy / STAR_DESIGN_H) * height,
                width: 2,
                height: 2,
                borderRadius: 1,
                backgroundColor: '#fff',
              }}
            />
          ))}
        </Animated.View>
      ))}

      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -32,
          left: -24,
          width: 100,
          height: 100,
          borderRadius: 50,
          backgroundColor: '#f9f9fb',
          boxShadow:
            '0px 0px 70px 0px rgba(193, 119, 241, 0.85), 0px 0px 70px 0px rgba(135, 42, 211, 0.85), inset 0px 0px 34px -10px #9b40fc',
        }}
      />

      <Streak travel={height + 70} delay={300} top={-20} left={width * 0.9} />
      <Streak travel={height + 70} delay={1600} top={-20} left={width * 0.6} />
      <Streak travel={height + 70} delay={3000} top={-30} left={width * 0.35} />

      <View style={tw`flex-1 flex-row items-center p-5`}>
        <View style={[tw`flex-1`, { transform: [{ translateY: 16 }] }]}>
          <Text
            style={[
              tw`font-sans-bold text-[20px] leading-7 text-white`,
              textOutline,
            ]}
          >
            Follow on{'\n'}social media
          </Text>
          <View style={tw`mt-4 flex-row items-center`}>
            {links.map((link) => (
              <IconButton
                key={link.id}
                {...link}
                active={activeId === link.id}
                onActivate={() => activate(link)}
              />
            ))}
          </View>
        </View>
        <Animated.View style={[tw`mr-1`, astroStyle]}>
          <Image
            source={astronaut}
            style={{ width: 104, height: 125 }}
            contentFit="contain"
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}
