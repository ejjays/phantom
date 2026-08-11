import { useEffect, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../../lib/tw';
import TwinkleStars from '../backgrounds/TwinkleStars';

const OPEN_SPRING = { damping: 24, stiffness: 210, mass: 0.9 };
const BOUNCE_SPRING = { damping: 15, stiffness: 220, mass: 0.6 };
const CLOSE_DURATION = 300;
const BACKDROP = 0.62;
const TAIL = 60;
const OVERMAX = TAIL;
const FULL_RATIO = 1.0;
const REST_RATIO = 0.5;

export default function BottomSheet({
  open,
  onClose,
  children,
  footer,
  keyboardMode = 'lift',
  restRatio = REST_RATIO,
  stars = false,
  border = 'cyanTop',
  radius = 60,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  keyboardMode?: 'lift' | 'expand';
  restRatio?: number;
  stars?: boolean;
  border?: 'cyan' | 'subtle' | 'cyanTop';
  radius?: number;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const [mounted, setMounted] = useState(open);
  const [ready, setReady] = useState(false);

  const progress = useSharedValue(0);
  const overdrag = useSharedValue(0);
  const sheetH = useSharedValue(screenH);
  const keyboard = useSharedValue(0);
  const grow = useSharedValue(0);
  const reveal = useSharedValue(0);

  const isExpand = keyboardMode === 'expand';
  const hidden = screenH * (FULL_RATIO - restRatio);

  // sheet lifts in lockstep with the keyboard's own motion, no didShow lag
  useGenericKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        keyboard.value = event.height;
        grow.value = event.progress;
      },
      onEnd: (event) => {
        'worklet';
        keyboard.value = event.height;
        grow.value = event.progress;
      },
    },
    []
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-event-handler, react-you-might-not-need-an-effect/no-derived-state -- keep mounted through exit anim
    if (open) setMounted(true);
  }, [open]);

  const finish = () => {
    reveal.value = 0;
    setMounted(false);
    onClose();
  };

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- open/close anim gated on mount
    if (!mounted) return;
    if (open) {
      // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- spring waits for layout-ready gate
      if (ready) {
        reveal.value = 1;
        progress.value = withSpring(1, OPEN_SPRING);
      }
    } else {
      progress.value = withTiming(
        0,
        { duration: CLOSE_DURATION, easing: Easing.out(Easing.cubic) },
        (done) => {
          if (done) {
            reveal.value = 0;
            runOnJS(setMounted)(false);
          }
        }
      );
    }
  }, [open, mounted, ready, progress, reveal]);

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    if (height > 0) {
      sheetH.value = height;
      setReady(true);
    }
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      if (e.translationY >= 0) {
        overdrag.value = 0;
        const visible = sheetH.value - TAIL;
        progress.value = Math.max(0, 1 - e.translationY / visible);
      } else {
        progress.value = 1;
        const pull = -e.translationY;
        overdrag.value = (pull * OVERMAX) / (pull + OVERMAX);
      }
    })
    .onEnd((e) => {
      overdrag.value = withSpring(0, BOUNCE_SPRING);
      const visible = sheetH.value - TAIL;
      const closing = e.translationY > visible * 0.3 || e.velocityY > 800;
      if (e.translationY > 0 && closing) {
        progress.value = withTiming(
          0,
          { duration: CLOSE_DURATION, easing: Easing.out(Easing.cubic) },
          (done) => {
            if (done) runOnJS(finish)();
          }
        );
      } else {
        progress.value = withSpring(1, OPEN_SPRING);
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * BACKDROP,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [
      {
        translateY:
          TAIL +
          (1 - progress.value) * (sheetH.value - TAIL) -
          overdrag.value +
          (isExpand ? (1 - grow.value) * hidden : 0) -
          (isExpand ? 0 : keyboard.value),
      },
    ],
  }));

  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -((1 - grow.value) * hidden) - keyboard.value }],
  }));

  const expandStyle = isExpand ? { height: screenH * FULL_RATIO + TAIL } : null;

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={tw`flex-1`}>
        <View style={tw`flex-1 justify-end`}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              style={tw`flex-1 bg-black`}
              onPress={onClose}
              accessibilityLabel="Close"
            />
          </Animated.View>

          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={onSheetLayout}
              style={[
                tw`overflow-hidden px-4 pt-2`,
                {
                  borderTopLeftRadius: radius,
                  borderTopRightRadius: radius,
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                },
                {
                  alignSelf: 'center',
                  width: screenW + 4,
                  marginHorizontal: -2,
                },
                border === 'subtle'
                  ? tw`border border-white/10`
                  : border === 'cyanTop'
                    ? {
                        borderWidth: 1,
                        borderColor: 'rgba(34,211,238,0.4)',
                        boxShadow: '0px 0px 12px 2px rgba(34,211,238,0.55)',
                        shadowColor: '#06b6d4',
                        shadowOpacity: 0.5,
                        shadowRadius: 16,
                        shadowOffset: { width: 0, height: -2 },
                        elevation: 20,
                      }
                    : tw`border border-primary/40`,
                {
                  backgroundColor: '#0b1526',
                  paddingBottom: insets.bottom + 20 + TAIL,
                  maxHeight: screenH + TAIL,
                  maxWidth: 560,
                },
                expandStyle,
                sheetStyle,
              ]}
            >
              {stars ? (
                <TwinkleStars width={Math.min(screenW, 560)} height={screenH} />
              ) : null}
              <View
                style={tw`mb-3 h-1.5 w-10 self-center rounded-full bg-white/20`}
              />
              {children}
              {footer ? (
                <Animated.View style={[tw`bg-[#0b1526] pt-2`, footerStyle]}>
                  {footer}
                </Animated.View>
              ) : null}
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
