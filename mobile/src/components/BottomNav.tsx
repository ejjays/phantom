import { useState, useEffect, memo, type ComponentType } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withSpring,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import Svg, {
  Path,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
} from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../lib/tw';
import {
  HomeIcon,
  SettingsIcon,
  UpdatesIcon,
  DownloadsIcon,
  type IconProps,
} from './icons';

type Tab = 'home' | 'downloads' | 'updates' | 'settings';

const TABS: { id: Tab; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'downloads', label: 'History', Icon: DownloadsIcon },
  { id: 'updates', label: 'Updates', Icon: UpdatesIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

const BAR_H = 62;
const OVERHANG = 36;
const CANOPY_H = BAR_H + OVERHANG;
const Y_TOP = OVERHANG;
const BUBBLE_R = 28;
const NOTCH_HALF = BUBBLE_R * 2;
const NOTCH_DEPTH = 34;
const BUBBLE_D = BUBBLE_R * 2;
const BUBBLE_TOP = Y_TOP - 1 - BUBBLE_R;
const NOTCH_CP_OFF = Math.round(BUBBLE_R * 0.67);
const NOTCH_CTR_OFF = Math.round(BUBBLE_R * 0.81);
const ACCENT = '#22d3ee';
const INACTIVE = '#cbd5e1';

const AnimatedPath = Animated.createAnimatedComponent(Path);

function buildPath(cx: number, width: number, height: number): string {
  'worklet';
  const t = Y_TOP;
  const d = t + NOTCH_DEPTH;
  const lh = cx - NOTCH_HALF;
  const rh = cx + NOTCH_HALF;
  return `M0,${t} L${lh},${t} C${lh + NOTCH_CP_OFF},${t} ${cx - NOTCH_CTR_OFF},${d} ${cx},${d} C${cx + NOTCH_CTR_OFF},${d} ${rh - NOTCH_CP_OFF},${t} ${rh},${t} L${width},${t} L${width},${height} L0,${height} Z`;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  canvas: {
    width: '100%',
  },
  svg: {
    ...StyleSheet.absoluteFill,
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: Y_TOP,
    height: BAR_H,
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 3,
  },
  bubble: {
    position: 'absolute',
    top: BUBBLE_TOP,
    left: 0,
    width: BUBBLE_D,
    height: BUBBLE_D,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleFace: {
    ...StyleSheet.absoluteFill,
    borderRadius: BUBBLE_R,
    borderWidth: 1,
    borderColor: '#3b466b',
  },
});
function BottomNav({
  onChange,
  hidden = false,
}: {
  onChange?: (tab: Tab) => void;
  hidden?: boolean;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const totalH = CANOPY_H + insets.bottom;
  const tabW = width / TABS.length;
  const centerOf = (i: number) => tabW * (i + 0.5);

  const [active, setActive] = useState(0);
  const cx = useSharedValue(centerOf(0));
  const lift = useSharedValue(1);
  const hide = useSharedValue(0);

  useEffect(() => {
    cx.value = centerOf(active);
  }, [width]);

  useEffect(() => {
    hide.value = withTiming(hidden ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [hidden, hide]);

  const select = (index: number) => {
    if (index === active) return;
    const dist = Math.abs(index - active);
    setActive(index);
    onChange?.(TABS[index].id);
    cx.value = withSpring(centerOf(index), {
      damping: 20,
      stiffness: 260,
      mass: 0.6,
    });
    const squashTarget = Math.max(0.9, 1.0 - dist * 0.04);
    const squashDur = 60 + dist * 10;
    lift.value = withSequence(
      withTiming(squashTarget, {
        duration: squashDur,
        easing: Easing.out(Easing.cubic),
      }),
      withSpring(1, { damping: 14, stiffness: 300 })
    );
  };

  const pathProps = useAnimatedProps(() => ({
    d: buildPath(cx.value, width, totalH),
  }));

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: cx.value - BUBBLE_R },
      { translateY: (1 - lift.value) * 18 },
      { scale: lift.value },
    ],
  }));

  const hideStyle = useAnimatedStyle(() => ({
    opacity: 1 - hide.value,
    transform: [{ translateY: hide.value * (totalH + 20) }],
  }));

  const ActiveIcon = TABS[active].Icon;

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.wrap, hideStyle]}
    >
      <View
        style={[styles.canvas, { height: totalH }]}
        pointerEvents="box-none"
      >
        {/* eslint-disable-next-line phantom/no-inline-svg */}
        <Svg height={totalH} style={styles.svg} pointerEvents="none">
          <Defs>
            <SvgGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#111c40" />
              <Stop offset="1" stopColor="#080f28" />
            </SvgGradient>
          </Defs>
          <AnimatedPath animatedProps={pathProps} fill="url(#barFill)" />
        </Svg>

        <Animated.View
          style={[styles.bubble, bubbleStyle]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={['#1b2a5e', '#0d1738'] as const}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.bubbleFace}
          />
          <ActiveIcon size={25} color={ACCENT} />
        </Animated.View>

        <View style={styles.row} pointerEvents="box-none">
          {TABS.map(({ id, label, Icon }, index) => {
            const isActive = index === active;
            return (
              <Pressable
                key={id}
                onPress={() => select(index)}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: isActive }}
              >
                {!isActive && (
                  <>
                    <Icon size={22} color={INACTIVE} />
                    <Text
                      style={[
                        tw`text-[10px] font-mono-semibold`,
                        styles.label,
                        { color: INACTIVE },
                      ]}
                    >
                      {label}
                    </Text>
                  </>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

export default memo(BottomNav);
