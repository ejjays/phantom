import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  BackHandler,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import tw from '../lib/tw';
import CommentsPanel from '../components/social/CommentsPanel';
import ReactionBar from '../components/social/ReactionBar';
import ImageFocusOverlay, {
  type FocusOrigin,
} from '../components/ImageFocusOverlay';
import {
  relativeTime,
  type Update,
  type ReactionTally,
  type UpdateCategory,
} from '../lib/social/updates';

const SCREEN_BG = '#080d1a';
const CYAN = '#22d3ee';
const CATEGORY_LABEL: Record<UpdateCategory, string> = {
  feature: 'New feature',
  optimization: 'Optimization',
  fix: 'Fix',
};
const BODY_CLAMP = 4;
const LINE_H = 24;
const COLLAPSED_H = BODY_CLAMP * LINE_H;
const SEE_MORE_RESERVE = 16;
const EASE = Easing.out(Easing.cubic);

function DescriptionBody({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(true);
  const [measured, setMeasured] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [head, setHead] = useState('');
  const height = useSharedValue(COLLAPSED_H);
  const body = text.trimEnd();
  const bodyStyle = [
    tw`font-sans text-[15px] text-white/80`,
    { lineHeight: LINE_H },
  ];
  const linkStyle = [tw`font-sans-medium`, { color: CYAN, lineHeight: LINE_H }];

  const clamped = lineCount > BODY_CLAMP;
  const fullH = lineCount * LINE_H;
  const clipStyle = useAnimatedStyle(() => ({ height: height.value }));

  const measure = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (measured) return;
    setMeasured(true);
    const { lines } = e.nativeEvent;
    setLineCount(lines.length);
    if (lines.length > BODY_CLAMP) {
      // keep the first BODY_CLAMP-1 lines whole & trim only the last kept line,
      // so the collapsed body always renders exactly BODY_CLAMP lines — fixed
      // height means no gap before the image and no entrance flicker
      const kept = lines.slice(0, BODY_CLAMP);
      const last = kept[kept.length - 1].text;
      const trimmed = last
        .slice(0, Math.max(0, last.length - SEE_MORE_RESERVE))
        .replace(/\s+$/u, '');
      const headText =
        kept
          .slice(0, -1)
          .map((line) => line.text)
          .join('') + trimmed;
      setHead(headText);
    }
  };

  const expand = () => {
    if (open) return;
    setSettled(false);
    setOpen(true);
    height.value = withTiming(
      fullH,
      { duration: 260, easing: EASE },
      (done) => {
        if (done) runOnJS(setSettled)(true);
      }
    );
  };

  const collapse = () => {
    setSettled(false);
    setOpen(false);
    height.value = withTiming(
      COLLAPSED_H,
      { duration: 240, easing: EASE },
      (done) => {
        if (done) runOnJS(setSettled)(true);
      }
    );
  };

  if (!measured) {
    return (
      <View style={tw`mt-3`}>
        <Text style={bodyStyle} numberOfLines={BODY_CLAMP}>
          {body}
        </Text>
        <Text
          style={[bodyStyle, tw`absolute opacity-0`, { left: 0, right: 0 }]}
          onTextLayout={measure}
        >
          {body}
        </Text>
      </View>
    );
  }

  if (!clamped) {
    return <Text style={[bodyStyle, tw`mt-3`]}>{body}</Text>;
  }

  if (open && settled) {
    return (
      <View style={tw`mt-3`}>
        <Text style={bodyStyle}>
          {body}{' '}
          <Text style={linkStyle} suppressHighlighting onPress={collapse}>
            see less
          </Text>
        </Text>
      </View>
    );
  }

  return (
    <Pressable style={tw`mt-3`} onPress={open ? undefined : expand}>
      <Animated.View style={[clipStyle, tw`overflow-hidden`]}>
        {open ? (
          <Text style={bodyStyle}>
            {body}{' '}
            <Text style={linkStyle} suppressHighlighting onPress={collapse}>
              see less
            </Text>
          </Text>
        ) : (
          <Text style={bodyStyle}>
            {head}…{' '}
            <Text style={linkStyle} suppressHighlighting onPress={expand}>
              see more
            </Text>
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function PostHeader({
  update,
  tallies,
  onReact,
}: {
  update: Update;
  tallies: ReactionTally[];
  onReact: (emoji: string) => void;
}) {
  const [focusOrigin, setFocusOrigin] = useState<FocusOrigin | null>(null);
  const [imgAspect, setImgAspect] = useState(4 / 3);
  const imgRef = useRef<View>(null);

  const openFocus = () => {
    imgRef.current?.measureInWindow((x, y, boxW, boxH) => {
      setFocusOrigin({ x, y, width: boxW, height: boxH });
    });
  };

  return (
    <View style={tw`pt-1`}>
      <Text style={tw`font-sans-bold text-[24px] leading-8 text-white`}>
        {update.title}
      </Text>
      <DescriptionBody text={update.body} />
      {update.imageUrl ? (
        <Pressable ref={imgRef} onPress={openFocus} style={tw`mt-4`}>
          {/* no transition: expo-image replays crossfade on Android relayout &
          flickers black while description height animates below/above it */}
          <Image
            source={{ uri: update.imageUrl }}
            style={[tw`w-full rounded-3xl`, { aspectRatio: 4 / 3 }]}
            contentFit="cover"
            onLoad={(event) => {
              const imgW = event.source?.width;
              const imgH = event.source?.height;
              if (imgW && imgH) setImgAspect(imgW / imgH);
            }}
          />
        </Pressable>
      ) : null}
      <View style={tw`mb-1 mt-5`}>
        <ReactionBar tallies={tallies} onReact={onReact} />
      </View>
      <ImageFocusOverlay
        uri={update.imageUrl ?? null}
        origin={focusOrigin}
        aspect={imgAspect}
        onClose={() => setFocusOrigin(null)}
      />
    </View>
  );
}

export default function PostDetailScreen({
  update,
  tallies,
  myName,
  myAvatar,
  ensureIdentity,
  onReact,
  onClose,
  focusCommentId,
}: {
  update: Update;
  tallies: ReactionTally[];
  myName: string | null;
  myAvatar: string | null;
  ensureIdentity: (mode?: 'google' | 'guest' | 'auto') => Promise<boolean>;
  onReact: (emoji: string) => void;
  onClose: () => void;
  focusCommentId?: string | null;
}) {
  const insets = useSafeAreaInsets();
  const fade = useSharedValue(0);
  const closing = useSharedValue(0);

  const dismiss = useCallback(() => {
    closing.value = 1;
    fade.value = withTiming(0, { duration: 180, easing: EASE }, (done) => {
      if (done) runOnJS(onClose)();
    });
  }, [fade, closing, onClose]);

  useEffect(() => {
    fade.value = withTiming(1, { duration: 280, easing: EASE });
  }, [fade]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss]);

  const surfaceStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [
      { scale: closing.value ? 1 : interpolate(fade.value, [0, 1], [0.92, 1]) },
    ],
  }));

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: SCREEN_BG, paddingTop: insets.top },
        surfaceStyle,
      ]}
    >
      <CommentsPanel
        updateId={update.id}
        visible
        myName={myName}
        myAvatar={myAvatar}
        ensureIdentity={ensureIdentity}
        onBack={dismiss}
        focusCommentId={focusCommentId}
        barCategory={CATEGORY_LABEL[update.category]}
        barTimestamp={relativeTime(update.publishedAt)}
        barTitle={update.title}
        barVersion={update.version ?? undefined}
        header={
          <PostHeader update={update} tallies={tallies} onReact={onReact} />
        }
      />
    </Animated.View>
  );
}
