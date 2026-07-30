import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedReaction,
  scrollTo,
  withSpring,
  withTiming,
  runOnJS,
  Easing,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Send, X } from 'lucide-react-native';
import { CommentIcon } from '../icons';
import ReactionEmoji from '../social/ReactionEmoji';
import AnimatedCount from '../social/AnimatedCount';
import tw from '../../lib/tw';
import { tapSelection, tapImpact } from '../../lib/haptics';
import {
  relativeTime,
  type Update,
  type UpdateCategory,
  type ReactionTally,
} from '../../lib/social/updates';

type GradientColors = readonly [string, string, ...string[]];

const SPRING = { damping: 24, stiffness: 210, mass: 0.9 };
const BOUNCE = { damping: 15, stiffness: 220, mass: 0.6 };
const EXPAND_SPRING = { damping: 17, stiffness: 200, mass: 0.7 };
const CLOSE_MS = 300;
const FOCUS_MS = 260;
const TAIL = 140;
const OVERMAX = 100;
const HEIGHT_RATIO = 0.66;
const BLEED = 2;
const CORNER = 32;
const FOCUS_DISMISS = 130;
const FOCUS_VELOCITY = 600;

const SHEET_BG = '#0b1526';
const PRIMARY = '#06b6d4';
const SHARE_FG = '#e9eef3';

const CATEGORY_META: Record<UpdateCategory, { label: string; color: string }> =
  {
    feature: { label: 'Feature', color: '#22d3ee' },
    optimization: { label: 'Boost', color: '#a78bfa' },
    fix: { label: 'Fix', color: '#34d399' },
  };

const TRAY_SLOT = 46;
const TRAY_PAD = 8;
const TRAY_H = 58;
const DEFAULT_EMOJI = '❤️';

function ReactionTray({
  tallies,
  left,
  top,
  width,
  progress,
  onSelect,
}: {
  tallies: ReactionTally[];
  left: number;
  top: number;
  width: number;
  progress: SharedValue<number>;
  onSelect: (emoji: string) => void;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [10, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.85, 1]) },
    ],
  }));
  return (
    <Animated.View
      style={[
        tw`absolute flex-row items-center justify-center rounded-full border border-cyan-400/40`,
        {
          height: TRAY_H,
          width,
          left,
          top,
          paddingHorizontal: TRAY_PAD,
          backgroundColor: '#16203a',
          boxShadow: '0px 0px 16px 1px rgba(34, 211, 238, 0.35)',
          shadowColor: '#06b6d3',
          shadowOpacity: 0.3,
          shadowRadius: 28,
          shadowOffset: { width: 0, height: -6 },
          elevation: 20,
        },
        style,
      ]}
    >
      {tallies.map((tally) => (
        <Pressable
          key={tally.emoji}
          onPress={() => onSelect(tally.emoji)}
          hitSlop={4}
          style={[
            tw`items-center justify-center rounded-full`,
            { width: TRAY_SLOT, height: TRAY_SLOT },
            tally.mine ? tw`bg-primary/20` : null,
          ]}
        >
          <ReactionEmoji emoji={tally.emoji} size={27} />
        </Pressable>
      ))}
    </Animated.View>
  );
}

function DetailAvatar({
  pic,
  ring,
}: {
  pic: string | number;
  ring: GradientColors;
}) {
  const source = typeof pic === 'number' ? pic : { uri: pic };
  return (
    <LinearGradient
      colors={ring}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={[tw`rounded-full`, { padding: 2 }]}
    >
      <Image
        source={source}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 2,
          borderColor: SHEET_BG,
        }}
        contentFit="cover"
        transition={200}
      />
    </LinearGradient>
  );
}

export default function UpdateDetailSheet({
  update,
  tallies,
  authorName,
  authorPic,
  ringColors,
  onReact,
  onOpenComments,
  onClose,
}: {
  update: Update | null;
  tallies: ReactionTally[];
  authorName: string;
  authorPic: string | number;
  ringColors: GradientColors;
  onReact: (emoji: string) => void;
  onOpenComments: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenH, width: screenW } = useWindowDimensions();
  const open = update !== null;
  const [mounted, setMounted] = useState(open);
  const [focusMounted, setFocusMounted] = useState(false);
  const [atFull, setAtFull] = useState(false);
  const [imgAspect, setImgAspect] = useState(4 / 5);
  const [tray, setTray] = useState<{
    x: number;
    y: number;
    width: number;
  } | null>(null);
  const [snap, setSnap] = useState<{
    update: Update;
    tallies: ReactionTally[];
  } | null>(update ? { update, tallies } : null);

  const heartRef = useRef<View>(null);
  const progress = useSharedValue(0);
  const overdrag = useSharedValue(0);
  const focus = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const trayV = useSharedValue(0);
  const pull = useSharedValue(0);
  const expand = useSharedValue(0);
  const startExpand = useSharedValue(0);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const startScrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  useAnimatedReaction(
    () => expand.value,
    (v, prev) => {
      const full = v > 0.985;
      const wasFull = (prev ?? 0) > 0.985;
      if (full !== wasFull) runOnJS(setAtFull)(full);
      if (!full && wasFull) scrollTo(scrollRef, 0, 0, false);
    }
  );

  const visibleH = Math.round(screenH * HEIGHT_RATIO);
  const totalH = visibleH + TAIL;
  const fullTotalH = screenH - insets.top + TAIL;
  const maxLift = fullTotalH - totalH;
  const heroH = screenH - visibleH;
  const heroCenterY = heroH / 2;
  const naturalH = screenW / imgAspect;

  const focusBox =
    imgAspect >= screenW / screenH
      ? { width: screenW, height: screenW / imgAspect }
      : { width: screenH * imgAspect, height: screenH };

  useEffect(() => {
    if (update) setSnap({ update, tallies });
  }, [update, tallies]);

  useEffect(() => {
    if (!open) return;
    setMounted(true);
    expand.value = 0;
  }, [open, expand]);

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      progress.value = withSpring(1, SPRING);
    } else {
      progress.value = withTiming(
        0,
        { duration: CLOSE_MS, easing: Easing.out(Easing.cubic) },
        (done) => {
          if (done) runOnJS(setMounted)(false);
        }
      );
    }
  }, [open, mounted, progress]);

  const finish = () => {
    setMounted(false);
    onClose();
  };

  const openFocus = () => {
    tapSelection();
    dragX.value = 0;
    dragY.value = 0;
    setFocusMounted(true);
    focus.value = withTiming(1, {
      duration: FOCUS_MS,
      easing: Easing.out(Easing.cubic),
    });
  };

  const closeFocus = () => {
    focus.value = withTiming(
      0,
      { duration: FOCUS_MS, easing: Easing.out(Easing.cubic) },
      (done) => {
        if (done) runOnJS(setFocusMounted)(false);
      }
    );
  };

  const closeTray = () => {
    trayV.value = withTiming(0, { duration: 140 }, (done) => {
      if (done) runOnJS(setTray)(null);
    });
  };

  const openTray = () => {
    tapImpact();
    heartRef.current?.measureInWindow((x, y, width) => {
      setTray({ x, y, width });
      trayV.value = 0;
      trayV.value = withSpring(1, { damping: 16, stiffness: 240, mass: 0.7 });
    });
  };

  const selectReaction = (emoji: string) => {
    tapSelection();
    onReact(emoji);
    closeTray();
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onBegin(() => {
      startExpand.value = expand.value;
    })
    .onUpdate((e) => {
      const lift = startExpand.value * maxLift - e.translationY;
      if (lift >= 0) {
        expand.value = Math.min(lift / maxLift, 1);
        pull.value = 0;
        progress.value = 1;
        const over = lift - maxLift;
        overdrag.value = over > 0 ? (over * OVERMAX) / (over + OVERMAX) : 0;
      } else {
        expand.value = 0;
        overdrag.value = 0;
        const down = -lift;
        pull.value = down;
        progress.value = Math.max(0, 1 - down / visibleH);
      }
    })
    .onEnd((e) => {
      overdrag.value = withSpring(0, BOUNCE);
      const lift = startExpand.value * maxLift - e.translationY;
      if (lift >= 0) {
        const projected = lift - e.velocityY * 0.1;
        expand.value = withSpring(
          projected > maxLift * 0.5 ? 1 : 0,
          EXPAND_SPRING
        );
        pull.value = withSpring(0, BOUNCE);
      } else {
        pull.value = withSpring(0, BOUNCE);
        const down = -lift;
        const closing = down > visibleH * 0.3 || e.velocityY > 800;
        if (closing) {
          progress.value = withTiming(
            0,
            { duration: CLOSE_MS, easing: Easing.out(Easing.cubic) },
            (done) => {
              if (done) runOnJS(finish)();
            }
          );
        } else {
          progress.value = withSpring(1, SPRING);
        }
      }
    });

  const descPan = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onBegin(() => {
      startExpand.value = expand.value;
      startScrollY.value = scrollY.value;
    })
    .onUpdate((e) => {
      const startedFull = startExpand.value > 0.985;
      if (startedFull && (startScrollY.value > 0 || e.translationY <= 0)) {
        return;
      }
      const base = startedFull ? maxLift : startExpand.value * maxLift;
      const lift = base - e.translationY;
      if (lift >= 0) {
        expand.value = Math.min(lift / maxLift, 1);
        pull.value = 0;
        progress.value = 1;
        const over = lift - maxLift;
        overdrag.value = over > 0 ? (over * OVERMAX) / (over + OVERMAX) : 0;
      } else {
        expand.value = 0;
        overdrag.value = 0;
        const down = -lift;
        pull.value = down;
        progress.value = Math.max(0, 1 - down / visibleH);
      }
    })
    .onEnd((e) => {
      overdrag.value = withSpring(0, BOUNCE);
      const startedFull = startExpand.value > 0.985;
      if (startedFull && (startScrollY.value > 0 || e.translationY <= 0)) {
        return;
      }
      const base = startedFull ? maxLift : startExpand.value * maxLift;
      const lift = base - e.translationY;
      if (lift >= 0) {
        const projected = lift - e.velocityY * 0.1;
        expand.value = withSpring(
          projected > maxLift * 0.5 ? 1 : 0,
          EXPAND_SPRING
        );
        pull.value = withSpring(0, BOUNCE);
      } else {
        pull.value = withSpring(0, BOUNCE);
        const down = -lift;
        const closing = down > visibleH * 0.3 || e.velocityY > 800;
        if (closing) {
          progress.value = withTiming(
            0,
            { duration: CLOSE_MS, easing: Easing.out(Easing.cubic) },
            (done) => {
              if (done) runOnJS(finish)();
            }
          );
        } else {
          progress.value = withSpring(1, SPRING);
        }
      }
    });
  const descGesture = Gesture.Simultaneous(Gesture.Native(), descPan);

  const focusPan = Gesture.Pan()
    .onUpdate((e) => {
      dragX.value = e.translationX;
      dragY.value = e.translationY;
    })
    .onEnd((e) => {
      const dist = Math.sqrt(
        e.translationX * e.translationX + e.translationY * e.translationY
      );
      const speed = Math.sqrt(
        e.velocityX * e.velocityX + e.velocityY * e.velocityY
      );
      if (dist > FOCUS_DISMISS || speed > FOCUS_VELOCITY) {
        dragX.value = withSpring(0, SPRING);
        dragY.value = withSpring(0, SPRING);
        focus.value = withTiming(
          0,
          { duration: FOCUS_MS, easing: Easing.out(Easing.cubic) },
          (done) => {
            if (done) runOnJS(setFocusMounted)(false);
          }
        );
      } else {
        dragX.value = withSpring(0, BOUNCE);
        dragY.value = withSpring(0, BOUNCE);
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1]),
  }));

  const heroContainerStyle = useAnimatedStyle(() => ({
    height: heroH + Math.min(pull.value, visibleH) + CORNER,
    opacity: progress.value * (1 - focus.value),
  }));

  const heroImageStyle = useAnimatedStyle(() => {
    const pulled = Math.min(pull.value, visibleH);
    const pullScale = Math.max(1, (heroH + pulled + CORNER) / naturalH);
    const openScale = interpolate(
      progress.value,
      [0, 1],
      [1.7, 1],
      Extrapolation.CLAMP
    );
    const upSquish = interpolate(
      overdrag.value,
      [0, OVERMAX],
      [1, 0.9],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale: pullScale * openScale * upSquish }],
    };
  });

  const sheetStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6, 1], [0, 1, 1]),
    transform: [
      {
        translateY:
          TAIL +
          (1 - expand.value) * maxLift +
          (1 - progress.value) * visibleH -
          overdrag.value,
      },
    ],
  }));

  const focusBackdropStyle = useAnimatedStyle(() => {
    const dist = Math.min(
      Math.sqrt(dragX.value * dragX.value + dragY.value * dragY.value),
      300
    );
    return { opacity: focus.value * (1 - (dist / 300) * 0.85) };
  });

  const focusImgStyle = useAnimatedStyle(() => {
    const dist = Math.min(
      Math.sqrt(dragX.value * dragX.value + dragY.value * dragY.value),
      360
    );
    const dragScale = 1 - (dist / 360) * 0.12;
    return {
      opacity: focus.value,
      transform: [
        { translateX: dragX.value },
        {
          translateY:
            interpolate(focus.value, [0, 1], [heroCenterY - screenH / 2, 0]) +
            dragY.value,
        },
        { scale: interpolate(focus.value, [0, 1], [0.72, 1]) * dragScale },
      ],
    };
  });

  if (!mounted || !snap) return null;

  const meta = CATEGORY_META[snap.update.category];
  const reactionTotal = snap.tallies.reduce((sum, t) => sum + t.count, 0);
  const myTally = snap.tallies.find((t) => t.mine) ?? null;
  const trayWidth = snap.tallies.length * TRAY_SLOT + TRAY_PAD * 2;
  const trayLeft = tray
    ? Math.min(
        Math.max(tray.x + tray.width / 2 - trayWidth / 2, 8),
        screenW - trayWidth - 8
      )
    : 0;
  const trayTop = tray ? tray.y - TRAY_H - 10 : 0;

  return (
    // skipcq: JS-0415
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={tw`flex-1`}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            style={tw`flex-1 bg-black`}
            onPress={onClose}
            accessibilityLabel="Close"
          />
        </Animated.View>

        {snap.update.imageUrl ? (
          <Animated.View
            pointerEvents="box-none"
            style={[
              tw`absolute inset-x-0 top-0 overflow-hidden bg-black`,
              heroContainerStyle,
            ]}
          >
            <Animated.View
              style={[
                tw`w-full`,
                { height: naturalH, transformOrigin: '50% 0%' },
                heroImageStyle,
              ]}
            >
              <Pressable onPress={openFocus} style={tw`flex-1`}>
                {/* no transition: expo-image replays crossfade on Android
                    relayout & flickers black as hero scales during expand */}
                <Image
                  source={{ uri: snap.update.imageUrl }}
                  style={tw`h-full w-full`}
                  contentFit="cover"
                  onLoad={(e) => {
                    const width = e.source?.width;
                    const height = e.source?.height;
                    if (width && height) setImgAspect(width / height);
                  }}
                />
              </Pressable>
            </Animated.View>
          </Animated.View>
        ) : null}

        <View style={tw`flex-1 justify-end`} pointerEvents="box-none">
          <Animated.View
            style={[
              tw`overflow-hidden rounded-t-[30px] border border-cyan-400/40`,
              {
                marginHorizontal: -BLEED,
                height: fullTotalH,
                backgroundColor: SHEET_BG,
                boxShadow: '0px 0px 16px 1px rgba(34, 211, 238, 0.35)',
                shadowColor: '#06b6d3',
                shadowOpacity: 0.3,
                shadowRadius: 28,
                shadowOffset: { width: 0, height: -6 },
                elevation: 20,
              },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={tw`px-6 pb-5 pt-3`}>
                <View
                  style={tw`mb-6 h-1.5 w-10 self-center rounded-full bg-white/25`}
                />
                <Text
                  style={tw`font-sans-bold text-[30px] leading-9 tracking-tight text-white`}
                >
                  {snap.update.title}
                </Text>

                <View style={tw`mt-9 flex-row items-center`}>
                  <DetailAvatar pic={authorPic} ring={ringColors} />
                  <View style={tw`ml-3`}>
                    <Text style={tw`font-sans-semibold text-[15px] text-white`}>
                      {authorName}
                    </Text>
                    <Text
                      style={tw`mt-0.5 font-sans text-[13px] text-white/40`}
                    >
                      {relativeTime(snap.update.publishedAt)}
                    </Text>
                  </View>
                </View>

                <View style={tw`mt-5 flex-row items-center`}>
                  <View
                    style={[
                      tw`mr-2 rounded-full px-3 py-2`,
                      { backgroundColor: `${meta.color}1f` },
                    ]}
                  >
                    <Text
                      style={[
                        tw`font-sans-semibold text-[12px]`,
                        { color: meta.color },
                      ]}
                    >
                      {meta.label}
                    </Text>
                  </View>
                  <Pressable
                    ref={heartRef}
                    onPress={() =>
                      onReact(myTally ? myTally.emoji : DEFAULT_EMOJI)
                    }
                    onLongPress={openTray}
                    delayLongPress={220}
                    style={tw`mr-3 h-9 flex-row items-center`}
                  >
                    <Heart
                      size={22}
                      color={myTally ? PRIMARY : '#94a3b8'}
                      fill={myTally ? PRIMARY : 'transparent'}
                      strokeWidth={2}
                    />
                    <AnimatedCount
                      value={reactionTotal}
                      style={[
                        tw`ml-1.5 font-sans-semibold text-[12px]`,
                        myTally ? tw`text-primary` : tw`text-slate-400`,
                      ]}
                    />
                  </Pressable>
                  <Pressable
                    onPress={onOpenComments}
                    style={tw`h-9 w-9 items-center justify-center`}
                  >
                    <CommentIcon size={22} color="#94a3b8" />
                  </Pressable>
                  <View style={tw`flex-1`} />
                  <Pressable
                    onPress={tapSelection}
                    style={[
                      tw`h-9 flex-row items-center rounded-full px-4`,
                      { backgroundColor: PRIMARY },
                    ]}
                  >
                    <Send size={16} color={SHARE_FG} strokeWidth={2.2} />
                    <Text
                      style={[
                        tw`ml-1.5 font-sans-semibold text-[13px]`,
                        { color: SHARE_FG },
                      ]}
                    >
                      Share
                    </Text>
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            <View style={tw`flex-1`}>
              <GestureDetector gesture={descGesture}>
                <Animated.ScrollView
                  ref={scrollRef}
                  style={tw`flex-1`}
                  contentContainerStyle={tw`flex-grow`}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  overScrollMode="never"
                  scrollEnabled={atFull}
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                >
                  <View
                    style={[
                      tw`flex-grow px-6 pt-4`,
                      { paddingBottom: insets.bottom + TAIL + 24 },
                    ]}
                  >
                    <Text
                      style={tw`font-sans text-[15px] leading-6 text-white`}
                    >
                      {snap.update.body}
                    </Text>
                  </View>
                </Animated.ScrollView>
              </GestureDetector>
              <LinearGradient
                colors={[SHEET_BG, 'transparent']}
                style={[tw`absolute inset-x-0 top-0`, { height: 22 }]}
                pointerEvents="none"
              />
            </View>
          </Animated.View>
        </View>

        {focusMounted && snap.update.imageUrl ? (
          <View style={StyleSheet.absoluteFill}>
            <Animated.View
              style={[StyleSheet.absoluteFill, focusBackdropStyle]}
            >
              <Pressable
                style={tw`flex-1 bg-black`}
                onPress={closeFocus}
                accessibilityLabel="Close image"
              />
            </Animated.View>
            <View
              style={[StyleSheet.absoluteFill, tw`items-center justify-center`]}
              pointerEvents="box-none"
            >
              <GestureDetector gesture={focusPan}>
                <Animated.View style={[focusBox, focusImgStyle]}>
                  <Image
                    source={{ uri: snap.update.imageUrl }}
                    style={tw`h-full w-full`}
                    contentFit="cover"
                    transition={150}
                  />
                </Animated.View>
              </GestureDetector>
            </View>
            <Pressable
              onPress={closeFocus}
              style={[
                tw`absolute right-4 h-10 w-10 items-center justify-center rounded-full bg-white/10`,
                { top: insets.top + 8 },
              ]}
            >
              <X size={22} color="#fff" />
            </Pressable>
          </View>
        ) : null}

        {tray ? (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeTray}
              accessibilityLabel="Dismiss reactions"
            />
            <ReactionTray
              tallies={snap.tallies}
              left={trayLeft}
              top={trayTop}
              width={trayWidth}
              progress={trayV}
              onSelect={selectReaction}
            />
          </>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
