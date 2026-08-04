import { memo, useEffect } from 'react';
import { Pressable, type GestureResponderEvent } from 'react-native';
import {
  Canvas,
  Group,
  Path,
  Oval,
  Shadow,
  LinearGradient,
  Skia,
  type SkSize,
  type Transforms3d,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

export const PHANTOM_ASPECT = 430 / 400;
const FLOAT_DURATION = 1600;
const SMILE_DELAY = 2000;
const IDLE_OPEN_MS = 10000;
const IDLE_CLOSE_MS = 1000;
const MOUTH_EASE = Easing.inOut(Easing.ease);
const GAZE_DOWN = 16;
const GAZE_X = 15;
const GAZE_START_DELAY_MS = 500;
const GAZE_MOVE_MS = 500;
const GAZE_HOLD_MS = 1600;
const GAZE_UP_MS = 500;
const GAZE_SWEEP_HOLD_MS = 300;
const GAZE_SWEEP_MOVE_MS = 900;
const GAZE_INNER = 0.3;

const NEUTRAL_MOUTH = [
  187, 218, 195.67, 222.67, 204.33, 222.67, 213, 218, 204.33, 218.67, 195.67,
  218.67, 187, 218,
] as const;
const SMILE_MOUTH = [
  186, 213, 195.33, 229, 204.67, 229, 214, 213, 204.67, 209, 195.33, 209, 186,
  213,
] as const;
const AMAZED_MOUTH = [
  193, 222, 193, 206, 207, 206, 207, 222, 207, 238, 193, 238, 193, 222,
] as const;

const idleMouthCycle = () =>
  withRepeat(
    withSequence(
      withDelay(IDLE_OPEN_MS, withTiming(1, { duration: 0 })),
      withTiming(0, { duration: 300, easing: MOUTH_EASE }),
      withDelay(IDLE_CLOSE_MS, withTiming(0, { duration: 0 })),
      withTiming(1, { duration: 300, easing: MOUTH_EASE })
    ),
    -1
  );

const BODY_PATH =
  'M 80 170 C 80 103.7, 133.7 50, 200 50 C 266.3 50, 320 103.7, 320 170 L 320 330 Q 290 352, 260 330 Q 230 352, 200 330 Q 170 352, 140 330 Q 110 352, 80 330 Z';
const BODY_SK_PATH = Skia.Path.MakeFromSVGString(BODY_PATH);
const SWEAT_PATH =
  'M28,19c0,6.62-5.38,12-12,12S4,25.62,4,19C4,12.58,14.83,1.75,15.3,1.29c0.39-0.39,1.01-0.39,1.4,0C17.17,1.75,28,12.58,28,19z';
const SWEAT_HIGHLIGHT =
  'M14,26c-3.3086,0-6-2.6914-6-6c0-0.5527,0.4478-1,1-1s1,0.4473,1,1c0,2.2061,1.7944,4,4,4c0.5522,0,1,0.4473,1,1S14.5522,26,14,26z';

export default memo(function PhantomHero({
  amazeSignal = 0,
  focusSignal = 0,
  onQuip,
}: {
  amazeSignal?: number;
  focusSignal?: number;
  onQuip?: () => void;
}) {
  const floatY = useSharedValue(0);
  const shadowScale = useSharedValue(1);
  const shadowOpacity = useSharedValue(0.2);
  const blinkScale = useSharedValue(1);
  const mouthX = useSharedValue(1);
  const mouthY = useSharedValue(1);
  const mouthAnim = useSharedValue(0);
  const pressBlend = useSharedValue(0);
  const burst = useSharedValue(1);
  const giggle = useSharedValue(0.85);
  const sweatAnim = useSharedValue(0);
  const amaze = useSharedValue(0);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);

  useEffect(() => {
    if (amazeSignal === 0) return;
    amaze.value = withSequence(
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      withDelay(1500, withTiming(1, { duration: 0 })),
      withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.ease) })
    );
  }, [amazeSignal, amaze]);

  useEffect(() => {
    if (focusSignal === 0) return;
    const cycle = focusSignal % 3;
    if (cycle === 0) return;
    if (cycle === 2) {
      const hold = withDelay(
        GAZE_SWEEP_HOLD_MS,
        withTiming(1, { duration: 0 })
      );
      gazeX.value = withSequence(
        withDelay(
          GAZE_START_DELAY_MS,
          withTiming(1, {
            duration: GAZE_MOVE_MS,
            easing: Easing.out(Easing.cubic),
          })
        ),
        hold,
        withTiming(-1, {
          duration: GAZE_SWEEP_MOVE_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
        withDelay(GAZE_SWEEP_HOLD_MS, withTiming(-1, { duration: 0 })),
        withTiming(0, {
          duration: GAZE_MOVE_MS,
          easing: Easing.inOut(Easing.cubic),
        })
      );
      gazeY.value = withSequence(
        withDelay(
          GAZE_START_DELAY_MS,
          withTiming(1, {
            duration: GAZE_MOVE_MS,
            easing: Easing.out(Easing.cubic),
          })
        ),
        withDelay(GAZE_SWEEP_HOLD_MS, withTiming(1, { duration: 0 })),
        withDelay(GAZE_SWEEP_MOVE_MS, withTiming(1, { duration: 0 })),
        withDelay(GAZE_SWEEP_HOLD_MS, withTiming(1, { duration: 0 })),
        withTiming(0, {
          duration: GAZE_MOVE_MS,
          easing: Easing.inOut(Easing.cubic),
        })
      );
      return;
    }
    gazeX.value = 0;
    gazeY.value = withSequence(
      withDelay(
        GAZE_START_DELAY_MS,
        withTiming(1, {
          duration: GAZE_MOVE_MS,
          easing: Easing.out(Easing.cubic),
        })
      ),
      withDelay(GAZE_HOLD_MS, withTiming(1, { duration: 0 })),
      withTiming(0, {
        duration: GAZE_UP_MS,
        easing: Easing.inOut(Easing.cubic),
      })
    );
  }, [focusSignal, gazeX, gazeY]);

  useEffect(() => {
    const ease = Easing.inOut(Easing.ease);
    floatY.value = withRepeat(
      withTiming(-15, { duration: FLOAT_DURATION, easing: ease }),
      -1,
      true
    );
    shadowScale.value = withRepeat(
      withTiming(0.82, { duration: FLOAT_DURATION, easing: ease }),
      -1,
      true
    );
    shadowOpacity.value = withRepeat(
      withTiming(0.1, { duration: FLOAT_DURATION, easing: ease }),
      -1,
      true
    );
    blinkScale.value = withRepeat(
      withSequence(
        withDelay(3864, withTiming(0.1, { duration: 168 })),
        withTiming(1, { duration: 168 })
      ),
      -1
    );
    mouthX.value = withRepeat(
      withTiming(1.04, { duration: FLOAT_DURATION, easing: ease }),
      -1,
      true
    );
    mouthY.value = withRepeat(
      withTiming(0.96, { duration: FLOAT_DURATION, easing: ease }),
      -1,
      true
    );
    mouthAnim.value = withSequence(
      withDelay(SMILE_DELAY, withTiming(1, { duration: 300, easing: ease })),
      idleMouthCycle()
    );
    return () => {
      cancelAnimation(floatY);
      cancelAnimation(shadowScale);
      cancelAnimation(shadowOpacity);
      cancelAnimation(blinkScale);
      cancelAnimation(mouthX);
      cancelAnimation(mouthY);
      cancelAnimation(mouthAnim);
      cancelAnimation(pressBlend);
      cancelAnimation(burst);
      cancelAnimation(giggle);
      cancelAnimation(sweatAnim);
      cancelAnimation(amaze);
      cancelAnimation(gazeX);
      cancelAnimation(gazeY);
    };
  }, []);

  const canvasSize = useSharedValue<SkSize>({ width: 0, height: 0 });
  const fitTransform = useDerivedValue<Transforms3d>(() => [
    { scale: canvasSize.value.width / 400 },
  ]);

  const laugh = (event: GestureResponderEvent) => {
    const scale = canvasSize.value.width / 400;
    const x = event.nativeEvent.locationX / scale;
    const y = event.nativeEvent.locationY / scale;
    if (!BODY_SK_PATH || !BODY_SK_PATH.contains(x, y)) return;
    pressBlend.value = withTiming(1, { duration: 120 });
    burst.value = withDelay(
      500,
      withSequence(
        withTiming(0.1, { duration: 100 }),
        withRepeat(
          withSequence(
            withDelay(1000, withTiming(0.1, { duration: 0 })),
            withTiming(1, { duration: 168 }),
            withTiming(0.1, { duration: 168 }),
            withDelay(1500, withTiming(0.1, { duration: 0 })),
            withTiming(1, { duration: 168 }),
            withTiming(0.1, { duration: 168 }),
            withTiming(1, { duration: 168 }),
            withTiming(0.1, { duration: 168 })
          ),
          -1
        )
      )
    );
    giggle.value = withRepeat(
      withSequence(
        withDelay(500, withTiming(0.7, { duration: 84 })),
        withTiming(0.85, { duration: 84 }),
        withTiming(0.7, { duration: 84 }),
        withTiming(0.85, { duration: 84 }),
        withTiming(0.7, { duration: 84 }),
        withTiming(0.85, { duration: 84 }),
        withTiming(0.7, { duration: 84 }),
        withTiming(0.85, { duration: 84 }),
        withDelay(1000, withTiming(0.85, { duration: 0 }))
      ),
      -1
    );
    sweatAnim.value = withDelay(
      4000,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 500, easing: MOUTH_EASE }),
          withDelay(3100, withTiming(1, { duration: 0 })),
          withTiming(0, { duration: 400 })
        ),
        -1
      )
    );
  };

  const relax = () => {
    pressBlend.value = withTiming(0, { duration: 180 });
    cancelAnimation(burst);
    burst.value = 1;
    cancelAnimation(giggle);
    giggle.value = 0.85;
    cancelAnimation(sweatAnim);
    sweatAnim.value = withDelay(
      SMILE_DELAY + 180,
      withTiming(0, { duration: 150 })
    );
    mouthAnim.value = withSequence(
      withTiming(0, { duration: 180 }),
      withDelay(
        SMILE_DELAY,
        withTiming(1, { duration: 300, easing: MOUTH_EASE })
      ),
      idleMouthCycle()
    );
  };

  const floatTransform = useDerivedValue<Transforms3d>(() => [
    { translateY: floatY.value },
  ]);

  const shownBlink = useDerivedValue(() => {
    const blend = pressBlend.value;
    return blend * burst.value + (1 - blend) * blinkScale.value;
  });
  const faceTransform = useDerivedValue<Transforms3d>(() => [
    { translateX: amaze.value * -20 + gazeX.value * GAZE_X },
    { translateY: amaze.value * -30 + gazeY.value * GAZE_DOWN },
  ]);
  const pupilTransform = useDerivedValue<Transforms3d>(() => [
    { translateX: amaze.value * -9 + gazeX.value * (GAZE_X * GAZE_INNER) },
    { translateY: amaze.value * -3 + gazeY.value * (GAZE_DOWN * GAZE_INNER) },
  ]);
  const sweatDropTransform = useDerivedValue<Transforms3d>(() => [
    { translateY: sweatAnim.value * 14 },
  ]);
  const mouthPath = useDerivedValue(() => {
    const blend = pressBlend.value;
    const t = blend * giggle.value + (1 - blend) * mouthAnim.value;
    const a = amaze.value;
    const cur = NEUTRAL_MOUTH.map((v, i) => v + (SMILE_MOUTH[i] - v) * t);
    const morph = cur.map((v, i) => v + (AMAZED_MOUTH[i] - v) * a);
    return `M ${morph[0]} ${morph[1]} C ${morph[2]} ${morph[3]}, ${morph[4]} ${morph[5]}, ${morph[6]} ${morph[7]} C ${morph[8]} ${morph[9]}, ${morph[10]} ${morph[11]}, ${morph[12]} ${morph[13]} Z`;
  });

  const shadowTransform = useDerivedValue<Transforms3d>(() => [
    { translateX: 200 },
    { translateY: 385 },
    { scale: shadowScale.value },
    { translateX: -200 },
    { translateY: -385 },
  ]);

  const blinkTransform = useDerivedValue<Transforms3d>(() => [
    { translateX: 200 },
    { translateY: 180 },
    { scaleY: shownBlink.value },
    { translateX: -200 },
    { translateY: -180 },
  ]);

  const mouthTransform = useDerivedValue<Transforms3d>(() => [
    { translateX: 200 },
    { translateY: 220 },
    { scaleX: mouthX.value },
    { scaleY: mouthY.value },
    { translateX: -200 },
    { translateY: -220 },
  ]);

  const bodyPath =
    'M 80 170 C 80 103.7, 133.7 50, 200 50 C 266.3 50, 320 103.7, 320 170 L 320 330 Q 290 352, 260 330 Q 230 352, 200 330 Q 170 352, 140 330 Q 110 352, 80 330 Z';
  const foldPath =
    'M 285 105 C 305 140, 320 220, 320 330 Q 290 352, 260 330 Q 250 322, 245 310 C 270 270, 280 180, 285 105 Z';

  return (
    <Pressable
      onPress={onQuip}
      onLongPress={laugh}
      onPressOut={relax}
      style={{ width: '100%', height: '100%' }}
    >
      <Canvas style={{ width: '100%', height: '100%' }} onSize={canvasSize}>
        <Group transform={fitTransform}>
          <Group transform={shadowTransform} opacity={shadowOpacity}>
            <Oval x={125} y={375} width={150} height={20} color="#083344" />
          </Group>
          <Group transform={floatTransform}>
            <Shadow dx={0} dy={8} blur={6} color="rgba(6, 182, 212, 0.3)" />
            <Path path={bodyPath}>
              <LinearGradient
                start={{ x: 0, y: 0 }}
                end={{ x: 400, y: 430 }}
                colors={['#E0F7FA', '#67E8F9', '#06B6D4']}
                positions={[0, 0.6, 1]}
              />
            </Path>
            <Path path={foldPath} color="#0891B2" opacity={0.4} />
            <Group transform={sweatDropTransform} opacity={sweatAnim}>
              <Group
                transform={[
                  { translateX: 96 },
                  { translateY: 66 },
                  { scale: 0.75 },
                ]}
              >
                <Path path={SWEAT_PATH} color="#34B0C0" />
                <Path path={SWEAT_HIGHLIGHT} color="#FFFFFF" />
              </Group>
            </Group>
            <Group transform={faceTransform}>
              <Group transform={blinkTransform}>
                <Oval x={152} y={162} width={26} height={36} color="#083344" />
                <Oval x={222} y={162} width={26} height={36} color="#083344" />
                <Group transform={pupilTransform}>
                  <Oval
                    x={163}
                    y={168}
                    width={10}
                    height={14}
                    color="#FFFFFF"
                  />
                  <Oval
                    x={233}
                    y={168}
                    width={10}
                    height={14}
                    color="#FFFFFF"
                  />
                </Group>
              </Group>
              <Oval
                x={139}
                y={192}
                width={18}
                height={10}
                color="#0891B2"
                opacity={0.6}
              />
              <Oval
                x={243}
                y={192}
                width={18}
                height={10}
                color="#0891B2"
                opacity={0.6}
              />
              <Group transform={mouthTransform}>
                <Path path={mouthPath} color="#083344" />
              </Group>
            </Group>
          </Group>
        </Group>
      </Canvas>
    </Pressable>
  );
});
