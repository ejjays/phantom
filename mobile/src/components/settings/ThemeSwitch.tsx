import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const EM = 16.2;

const WIDTH = 5.625 * EM;
const HEIGHT = 2.5 * EM;
const CIRCLE = 3.375 * EM;
const SUN = 2.125 * EM;
const OFF = (CIRCLE - HEIGHT) / 2;
const TRAVEL = WIDTH - CIRCLE + 2 * OFF;
const STARS_H = Math.round((2.75 * EM * 55) / 144);

const LIGHT_BG = '#3D7EAE';
const NIGHT_BG = '#1D1F2C';
const SUN_BG = '#ECCA2F';
const MOON_BG = '#C4C9D1';
const SPOT = '#959DB1';
const CLOUD = '#F3FDFF';
const CLOUD_BACK = '#AACADF';

const BOUNCE = Easing.bezier(0, -0.02, 0.4, 1.25);
const CIRCLE_BOUNCE = Easing.bezier(0, -0.02, 0.35, 1.17);

const PUFFS: { dx: number; dy: number; back?: boolean; spread?: number }[] = [
  { dx: 0, dy: 0 },
  { dx: 0.937, dy: 0.312 },
  { dx: -0.312, dy: -0.312, back: true },
  { dx: 1.437, dy: 0.375 },
  { dx: 0.5, dy: -0.125, back: true },
  { dx: 2.187, dy: 0 },
  { dx: 1.25, dy: -0.062, back: true },
  { dx: 2.937, dy: 0.312 },
  { dx: 2, dy: -0.312, back: true },
  { dx: 3.625, dy: -0.062 },
  { dx: 2.625, dy: 0, back: true },
  { dx: 4.5, dy: -0.312 },
  { dx: 3.375, dy: -0.437, back: true },
  { dx: 4.625, dy: -1.75, spread: 0.437 },
  { dx: 4, dy: -0.625, back: true },
  { dx: 4.125, dy: -2.125, back: true, spread: 0.437 },
];

const SPARKS =
  'M135.831 3.00688C135.055 3.85027 134.111 4.29946 133 4.35447C134.111 4.40947 135.055 4.85867 135.831 5.71123C136.607 6.55462 136.996 7.56303 136.996 8.72727C136.996 7.95722 137.172 7.25134 137.525 6.59129C137.886 5.93124 138.372 5.39954 138.98 5.00535C139.598 4.60199 140.268 4.39114 141 4.35447C139.88 4.2903 138.936 3.85027 138.16 3.00688C137.384 2.16348 136.996 1.16425 136.996 0C136.996 1.16425 136.607 2.16348 135.831 3.00688ZM31 23.3545C32.1114 23.2995 33.0551 22.8503 33.8313 22.0069C34.6075 21.1635 34.9956 20.1642 34.9956 19C34.9956 20.1642 35.3837 21.1635 36.1599 22.0069C36.9361 22.8503 37.8798 23.2903 39 23.3545C38.2679 23.3911 37.5976 23.602 36.9802 24.0053C36.3716 24.3995 35.8864 24.9312 35.5248 25.5913C35.172 26.2513 34.9956 26.9572 34.9956 27.7273C34.9956 26.563 34.6075 25.5546 33.8313 24.7112C33.0551 23.8587 32.1114 23.4095 31 23.3545ZM0 36.3545C1.11136 36.2995 2.05513 35.8503 2.83131 35.0069C3.6075 34.1635 3.99559 33.1642 3.99559 32C3.99559 33.1642 4.38368 34.1635 5.15987 35.0069C5.93605 35.8503 6.87982 36.2903 8 36.3545C7.26792 36.3911 6.59757 36.602 5.98015 37.0053C5.37155 37.3995 4.88644 37.9312 4.52481 38.5913C4.172 39.2513 3.99559 39.9572 3.99559 40.7273C3.99559 39.563 3.6075 38.5546 2.83131 37.7112C2.05513 36.8587 1.11136 36.4095 0 36.3545ZM56.8313 24.0069C56.0551 24.8503 55.1114 25.2995 54 25.3545C55.1114 25.4095 56.0551 25.8587 56.8313 26.7112C57.6075 27.5546 57.9956 28.563 57.9956 29.7273C57.9956 28.9572 58.172 28.2513 58.5248 27.5913C58.8864 26.9312 59.3716 26.3995 59.9802 26.0053C60.5976 25.602 61.2679 25.3911 62 25.3545C60.8798 25.2903 59.9361 24.8503 59.1599 24.0069C58.3837 23.1635 57.9956 22.1642 57.9956 21C57.9956 22.1642 57.6075 23.1635 56.8313 24.0069ZM81 25.3545C82.1114 25.2995 83.0551 24.8503 83.8313 24.0069C84.6075 23.1635 84.9956 22.1642 84.9956 21C84.9956 22.1642 85.3837 23.1635 86.1599 24.0069C86.9361 24.8503 87.8798 25.2903 89 25.3545C88.2679 25.3911 87.5976 25.602 86.9802 26.0053C86.3716 26.3995 85.8864 26.9312 85.5248 27.5913C85.172 28.2513 84.9956 28.9572 84.9956 29.7273C84.9956 28.563 84.6075 27.5546 83.8313 26.7112C83.0551 25.8587 82.1114 25.4095 81 25.3545ZM136 36.3545C137.111 36.2995 138.055 35.8503 138.831 35.0069C139.607 34.1635 139.996 33.1642 139.996 32C139.996 33.1642 140.384 34.1635 141.16 35.0069C141.936 35.8503 142.88 36.2903 144 36.3545C143.268 36.3911 142.598 36.602 141.98 37.0053C141.372 37.3995 140.886 37.9312 140.525 38.5913C140.172 39.2513 139.996 39.9572 139.996 40.7273C139.996 39.563 139.607 38.5546 138.831 37.7112C138.055 36.8587 137.111 36.4095 136 36.3545ZM101.831 49.0069C101.055 49.8503 100.111 50.2995 99 50.3545C100.111 50.4095 101.055 50.8587 101.831 51.7112C102.607 52.5546 102.996 53.563 102.996 54.7273C102.996 53.9572 103.172 53.2513 103.525 52.5913C103.886 51.9312 104.372 51.3995 104.98 51.0053C105.598 50.602 106.268 50.3911 107 50.3545C105.88 50.2903 104.936 49.8503 104.16 49.0069C103.384 48.1635 102.996 47.1642 102.996 46C102.996 47.1642 102.607 48.1635 101.831 49.0069Z';

const STARS_HIDDEN = -(HEIGHT + STARS_H) / 2 - STARS_H / 2;
const STARS_VISIBLE = HEIGHT / 2 - STARS_H / 2;

export default memo(function ThemeSwitch({
  dark,
  darkDelay = 0,
  visible,
  onToggle,
  onOrigin,
  instant = false,
}: {
  dark: boolean;
  darkDelay?: number;
  visible?: boolean;
  onToggle: () => void;
  onOrigin?: (p: { x: number; y: number }) => void;
  instant?: boolean;
}) {
  const wrapRef = useRef<View>(null);
  const reportOrigin = useCallback(() => {
    wrapRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0)
        onOrigin?.({ x: x + width / 2, y: y + height / 2 });
    });
  }, [onOrigin]);
  useEffect(() => {
    reportOrigin();
  }, [reportOrigin]);
  useEffect(() => {
    if (visible) reportOrigin();
  }, [visible, reportOrigin]);
  const t = useSharedValue(dark ? 1 : 0);
  const slide = useSharedValue(dark ? 1 : 0);
  useEffect(() => {
    if (instant) {
      t.value = dark ? 1 : 0;
      slide.value = dark ? 1 : 0;
      return;
    }
    t.value = withDelay(
      darkDelay,
      withTiming(dark ? 1 : 0, { duration: 500, easing: BOUNCE })
    );
    slide.value = withDelay(
      darkDelay,
      withTiming(dark ? 1 : 0, {
        duration: 300,
        easing: CIRCLE_BOUNCE,
      })
    );
  }, [dark, t, slide, darkDelay, instant]);

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(t.value, [0, 1], [LIGHT_BG, NIGHT_BG]),
  }));
  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value * TRAVEL }],
  }));
  const moonStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - t.value) * SUN }],
  }));
  const cloudStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * (4.062 - 0.625) * EM }],
  }));
  const starsStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          (1 - t.value) * STARS_HIDDEN + t.value * STARS_VISIBLE,
      },
    ],
  }));

  return (
    <Pressable
      onLayout={reportOrigin}
      onPress={onToggle}
      style={{
        width: WIDTH,
        height: HEIGHT,
        borderRadius: HEIGHT / 2,
        overflow: 'hidden',
        boxShadow: [
          { offsetX: 0, offsetY: -(0.062 * EM), blurRadius: 0.062 * EM, color: 'rgba(0,0,0,0.25)' },
          { offsetX: 0, offsetY: 0.062 * EM, blurRadius: 0.125 * EM, color: 'rgba(255,255,255,0.94)' },
          {
            offsetX: 0,
            offsetY: 0.05 * EM,
            blurRadius: 0.187 * EM,
            inset: true,
            color: 'rgba(0,0,0,0.25)',
          },
        ],
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, bgStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: CIRCLE,
              height: CIRCLE,
              left: -OFF,
              top: -OFF,
              borderRadius: CIRCLE / 2,
              backgroundColor: 'rgba(255,255,255,0.1)',
              boxShadow: [
                {
                  inset: true,
                  offsetX: 0,
                  offsetY: 0,
                  blurRadius: 0,
                  spreadDistance: CIRCLE,
                  color: 'rgba(255,255,255,0.1)',
                },
                {
                  offsetX: 0,
                  offsetY: 0,
                  blurRadius: 0,
                  spreadDistance: 0.625 * EM,
                  color: 'rgba(255,255,255,0.1)',
                },
                {
                  offsetX: 0,
                  offsetY: 0,
                  blurRadius: 0,
                  spreadDistance: 1.25 * EM,
                  color: 'rgba(255,255,255,0.1)',
                },
              ],
            },
            circleStyle,
          ]}
        >
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: SUN,
                height: SUN,
                borderRadius: SUN / 2,
                backgroundColor: SUN_BG,
                overflow: 'hidden',
                boxShadow: [
                  {
                    offsetX: 0.062 * EM,
                    offsetY: 0.062 * EM,
                    blurRadius: 0.062 * EM,
                    inset: true,
                    color: 'rgba(254,255,239,0.61)',
                  },
                  {
                    offsetX: 0,
                    offsetY: -(0.062 * EM),
                    blurRadius: 0.062 * EM,
                    inset: true,
                    color: '#a1872a',
                  },
                ],
              }}
            >
              <Animated.View
                style={[
                  {
                    width: SUN,
                    height: SUN,
                    borderRadius: SUN / 2,
                    backgroundColor: MOON_BG,
                    boxShadow: [
                      {
                        offsetX: 0.062 * EM,
                        offsetY: 0.062 * EM,
                        blurRadius: 0.062 * EM,
                        inset: true,
                        color: 'rgba(254,255,239,0.61)',
                      },
                      {
                        offsetX: 0,
                        offsetY: -(0.062 * EM),
                        blurRadius: 0.062 * EM,
                        inset: true,
                        color: '#969696',
                      },
                    ],
                  },
                  moonStyle,
                ]}
              >
                <View
                  style={{
                    position: 'absolute',
                    top: 0.75 * EM,
                    left: 0.312 * EM,
                    width: 0.75 * EM,
                    height: 0.75 * EM,
                    borderRadius: 0.75 * EM,
                    backgroundColor: SPOT,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    top: 0.937 * EM,
                    left: 1.375 * EM,
                    width: 0.375 * EM,
                    height: 0.375 * EM,
                    borderRadius: 0.375 * EM,
                    backgroundColor: SPOT,
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    top: 0.312 * EM,
                    left: 0.812 * EM,
                    width: 0.25 * EM,
                    height: 0.25 * EM,
                    borderRadius: 0.25 * EM,
                    backgroundColor: SPOT,
                  }}
                />
              </Animated.View>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0.312 * EM,
              bottom: -0.625 * EM,
            },
            cloudStyle,
          ]}
        >
          {[...PUFFS.slice(0, 1), ...PUFFS.slice(1).reverse()].map((puff) => {
            const key = `${puff.dx}-${puff.dy}-${puff.back ?? ''}`;
            const d = 1.25 * EM + (puff.spread ? puff.spread * 2 * EM : 0);
            return (
              <View
                key={key}
                style={{
                  position: 'absolute',
                  left: puff.dx * EM - d / 2,
                  top: puff.dy * EM - d / 2,
                  width: d,
                  height: d,
                  borderRadius: d / 2,
                  backgroundColor: puff.back ? CLOUD_BACK : CLOUD,
                }}
              />
            );
          })}
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0.312 * EM,
              top: 0,
              width: 2.75 * EM,
              height: STARS_H,
            },
            starsStyle,
          ]}
        >
          {/* eslint-disable-next-line phantom/no-inline-svg */}
          <Svg width={2.75 * EM} height={STARS_H} viewBox="0 0 144 55">
            <Path d={SPARKS} fill="#fff" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
});