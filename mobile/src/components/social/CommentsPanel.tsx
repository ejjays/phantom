import {
  memo,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Keyboard,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
  type ListRenderItem,
  type ScrollViewProps,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useSharedValue,
  useDerivedValue,
  scrollTo,
  runOnUI,
  withTiming,
  withSequence,
  withDelay,
  withRepeat,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import LottieView from 'lottie-react-native';
import runningCatAnim from '../../../assets/running-cat.json';
import {
  Trash2,
  Pencil,
  MoreVertical,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  X,
  Plus,
  Ghost,
} from 'lucide-react-native';
import {
  HeartIcon,
  SendIcon,
  GoogleIcon,
  CodeGlyph,
  CameraIcon,
  PhotosIcon,
  GifIcon,
  type IconProps,
} from '../icons';
import Avatar from '../Avatar';
import BottomSheet from '../sheets/BottomSheet';
import ImageFocusOverlay, { type FocusOrigin } from '../ImageFocusOverlay';
import Collapsible from '../Collapsible';
import GifPicker from './GifPicker';
import { isGiphyConfigured } from '../../lib/social/giphy';
import {
  pickCommentImage,
  captureCommentImage,
  uploadCommentImage,
  withAspect,
  readAspect,
} from '../../lib/social/commentImage';
import tw from '../../lib/tw';
import { useBlurOnKeyboardHide } from '../../hooks/useKeyboard';
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  KeyboardEvents,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapSelection, tapSuccess } from '../../lib/haptics';
import {
  listComments,
  cachedComments,
  cacheComments,
  addComment,
  deleteComment,
  editComment,
  likeComment,
  unlikeComment,
  subscribeToComments,
  validateComment,
  relativeTime,
  messageOf,
  displayName,
  isGuestName,
  type UpdateComment,
} from '../../lib/social/updates';

const THREAD = '#313847';
const PANEL_BG = '#080d1a';
const CYAN = '#22d3ee';
const META_FADE: [number, number] = [10, 56];
const TITLE_FADE: [number, number] = [44, 92];
const BANNER = {
  backgroundColor: '#1a1f3a',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.1)',
};

const INITIAL_REPLIES = 3;
const REPLY_STEP = 10;
const ROOT_BATCH = 12;
const HIGHLIGHT_MS = 1600;
const GIF_MAX_H = 280;
const BADGE = 18;

function Body({
  text,
  style,
}: {
  text: string;
  style: ComponentProps<typeof Text>['style'];
}) {
  const match = /^(@\S+)(\s)([\s\S]+)$/u.exec(text);
  if (!match) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      <Text style={tw`font-sans-semibold text-primary`}>{match[1]}</Text>
      {match[2]}
      {match[3]}
    </Text>
  );
}

function ThreadCurve({
  top,
  style,
}: {
  top: number;
  style?: ComponentProps<typeof Animated.View>['style'];
}) {
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 20,
          top,
          width: 16,
          height: 15,
          borderColor: THREAD,
          borderLeftWidth: 2,
          borderBottomWidth: 2,
          borderBottomLeftRadius: 12,
        },
        style,
      ]}
    />
  );
}

function ThreadEndDot() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
      -1,
      false
    );
  }, [pulse]);
  const pingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.45, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 2.6]) }],
  }));
  const dot = { width: 8, height: 8, borderRadius: 4, backgroundColor: CYAN };
  return (
    <View style={[tw`items-center justify-center`, { width: 8, height: 8 }]}>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute' }, dot, pingStyle]}
      />
      <View style={dot} />
    </View>
  );
}

function AttachTile({
  Icon,
  label,
  onPress,
}: {
  Icon: (props: IconProps) => ReactNode;
  label: string;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.94, { duration: 90 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 150 });
      }}
      android_ripple={null}
      style={tw`flex-1`}
    >
      <Animated.View
        style={[
          tw`items-center justify-center`,
          {
            borderRadius: 26,
            paddingVertical: 26,
            backgroundColor: '#161d33',
          },
          style,
        ]}
      >
        <Icon size={26} color="#e2e8f0" />
        <Text style={tw`mt-3 font-sans-medium text-[14px] text-slate-200`}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function NewGlow({
  active,
  top = -10,
  bottom = -10,
  children,
}: {
  active: boolean;
  top?: number;
  bottom?: number;
  children: ReactNode;
}) {
  const glow = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (!active) return;
    glow.value = withDelay(
      800,
      withTiming(0, { duration: 650, easing: Easing.in(Easing.quad) })
    );
  }, [active, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <View>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: -20,
              right: -20,
              top,
              bottom,
              backgroundColor: 'rgba(34,211,238,0.12)',
            },
            style,
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

function CommentSkeleton() {
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const block = { backgroundColor: 'rgba(255,255,255,0.08)' };
  return (
    <View style={tw`pt-2`}>
      {[0, 1, 2, 3, 4].map((row) => (
        <View key={row} style={tw`mb-7 flex-row`}>
          <Animated.View
            style={[tw`h-11 w-11 rounded-full`, block, pulseStyle]}
          />
          <View style={tw`ml-3 flex-1`}>
            <Animated.View
              style={[tw`h-3 w-24 rounded-full`, block, pulseStyle]}
            />
            <Animated.View
              style={[tw`mt-2.5 h-3 rounded-full`, block, pulseStyle]}
            />
            <Animated.View
              style={[tw`mt-1.5 h-3 w-2/3 rounded-full`, block, pulseStyle]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function LikeButton({
  liked,
  count,
  onPress,
  size,
  style,
}: {
  liked: boolean;
  count: number;
  onPress: () => void;
  size: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pop = useSharedValue(1);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    pop.value = withSequence(
      withTiming(1.15, { duration: 110, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) })
    );
  }, [liked, pop]);
  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pop.value }],
  }));
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={[tw`flex-row items-center`, style]}
    >
      <Animated.View style={heartStyle}>
        <HeartIcon size={size} color={liked ? '#ec4899' : '#64748b'} />
      </Animated.View>
      {count > 0 ? (
        <Text
          style={[
            tw`ml-1.5 font-sans-semibold text-[12px]`,
            liked ? tw`text-pink-400` : tw`text-slate-400`,
          ]}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

function CommentGif({ uri, width }: { uri: string; width: number }) {
  // gif dims arent stored, so size from the aspect fragment if present, else
  // measure from the first decoded frame.
  const [aspect, setAspect] = useState(() => readAspect(uri) ?? 1.4);
  const [playing, setPlaying] = useState(true);
  const imageRef = useRef<Image>(null);

  const toggle = () => {
    tapSelection();
    if (playing) {
      void imageRef.current?.stopAnimating();
      setPlaying(false);
    } else {
      void imageRef.current?.startAnimating();
      setPlaying(true);
    }
  };

  const natural = width / aspect;
  const boxH = Math.min(natural, GIF_MAX_H);
  const boxW = boxH < natural ? boxH * aspect : width;

  return (
    <View style={tw`mt-2 pl-2.5`}>
      <Pressable onPress={toggle} style={{ width: boxW }}>
        <Image
          ref={imageRef}
          source={{ uri }}
          onLoad={(event) => {
            const { width: imgW, height: imgH } = event.source;
            if (imgW > 0 && imgH > 0) setAspect(imgW / imgH);
          }}
          style={{
            width: '100%',
            height: boxH,
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.05)',
          }}
          contentFit="cover"
        />
        <View
          style={[
            tw`absolute flex-row items-center rounded-md px-1.5 py-0.5`,
            { left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.6)' },
          ]}
        >
          <Text style={tw`font-sans-bold text-[10px] text-white`}>GIF</Text>
          {playing ? (
            <Play
              size={10}
              color="#fff"
              fill="#fff"
              strokeWidth={0}
              style={tw`ml-1`}
            />
          ) : (
            <Pause
              size={10}
              color="#fff"
              fill="#fff"
              strokeWidth={0}
              style={tw`ml-1`}
            />
          )}
        </View>
      </Pressable>
    </View>
  );
}

function FocusOverlay({
  state,
  onClose,
}: {
  state: { uri: string; aspect: number; origin: FocusOrigin } | null;
  onClose: () => void;
}) {
  return (
    <ImageFocusOverlay
      uri={state?.uri ?? null}
      origin={state?.origin ?? null}
      aspect={state?.aspect ?? 1}
      onClose={onClose}
    />
  );
}

function CommentImage({
  uri,
  width,
  onOpen,
}: {
  uri: string;
  width: number;
  onOpen: (uri: string, aspect: number, origin: FocusOrigin) => void;
}) {
  const [aspect, setAspect] = useState(() => readAspect(uri) ?? 1.4);
  const boxRef = useRef<View>(null);
  const natural = width / aspect;
  const boxH = Math.min(natural, GIF_MAX_H);
  const boxW = boxH < natural ? boxH * aspect : width;
  const press = () => {
    boxRef.current?.measureInWindow(
      (originX, originY, measuredW, measuredH) => {
        onOpen(uri, aspect, {
          x: originX,
          y: originY,
          width: measuredW,
          height: measuredH,
        });
      }
    );
  };
  return (
    <View style={tw`mt-2 pl-2.5`}>
      <Pressable ref={boxRef} onPress={press} style={{ width: boxW }}>
        <Image
          source={{ uri }}
          onLoad={(event) => {
            const { width: imgW, height: imgH } = event.source;
            if (imgW > 0 && imgH > 0) setAspect(imgW / imgH);
          }}
          style={{
            width: '100%',
            height: boxH,
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.05)',
          }}
          contentFit="cover"
        />
      </Pressable>
    </View>
  );
}

function BadgeCircle({
  size,
  ping = false,
  pingTo = 1.8,
}: {
  size: number;
  ping?: boolean;
  pingTo?: number;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!ping) return;
    pulse.value = 0;
    pulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.bezier(0, 0, 0.2, 1) }),
      3,
      false
    );
  }, [ping, pulse]);
  const pingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 0.75, 1], [0.5, 0, 0]),
    transform: [
      { scale: interpolate(pulse.value, [0, 0.75, 1], [1, pingTo, pingTo]) },
    ],
  }));
  const circle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: CYAN,
  };
  return (
    <View
      style={[tw`items-center justify-center`, { width: size, height: size }]}
    >
      {ping ? (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute' }, circle, pingStyle]}
        />
      ) : null}
      <View style={[tw`items-center justify-center`, circle]}>
        <CodeGlyph size={Math.round(size * 0.6)} color="#04101f" />
      </View>
    </View>
  );
}

function CreatorBadge({ size = BADGE }: { size?: number }) {
  const [info, setInfo] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => {
          tapSelection();
          setInfo(true);
        }}
        hitSlop={10}
        style={tw`ml-1.5`}
      >
        <BadgeCircle size={size} ping />
      </Pressable>
      <BottomSheet
        open={info}
        onClose={() => setInfo(false)}
        restRatio={0.3}
        border="cyanTop"
      >
        <View style={tw`items-center px-6 pb-4 pt-2`}>
          <BadgeCircle size={60} ping pingTo={1.5} />
          <Text
            style={tw`mt-4 font-sans-bold text-[20px] tracking-tight text-white`}
          >
            Developer&apos;s Badge
          </Text>
          <Text
            style={tw`mt-2 text-center font-sans text-[14px] leading-5 text-slate-400`}
          >
            Just a dev at your service.
          </Text>
        </View>
      </BottomSheet>
    </>
  );
}

const CommentRow = memo(function CommentRow({
  comment,
  onToggleLike,
  onReply,
  onOptions,
  onImageOpen,
  hasLine,
  expanded,
  highlighted,
}: {
  comment: UpdateComment;
  onToggleLike: (comment: UpdateComment) => void;
  onReply: (comment: UpdateComment, rowScreenBottom?: number) => void;
  onOptions: (comment: UpdateComment) => void;
  onImageOpen: (uri: string, aspect: number, origin: FocusOrigin) => void;
  hasLine: boolean;
  expanded: boolean;
  highlighted: boolean;
}) {
  const handle = comment.username.startsWith('@')
    ? comment.username
    : `@${comment.username}`;
  // guests display "Anonymous 30584"; their raw handle stays for mentions
  const label = isGuestName(comment.username)
    ? displayName(comment.username)
    : handle;
  const rowRef = useRef<View>(null);
  const ringStyle = useAnimatedStyle(() => ({
    opacity: withTiming(expanded ? 1 : 0, { duration: 220 }),
  }));
  return (
    <View ref={rowRef} style={tw`flex-row`}>
      <View style={tw`items-center`}>
        <View>
          <Avatar
            name={displayName(comment.username)}
            size={42}
            uri={comment.avatarUrl}
          />
          {expanded ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: -5,
                  left: -5,
                  right: -5,
                  bottom: -5,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: '#22d3ee',
                },
                ringStyle,
              ]}
            />
          ) : null}
        </View>
        {hasLine && !highlighted ? (
          <View
            style={[
              tw`mt-1.5 flex-1 rounded-full`,
              { width: 2, backgroundColor: THREAD },
            ]}
          />
        ) : null}
      </View>
      <View style={tw`ml-3 flex-1`}>
        <View style={tw`flex-row items-center`}>
          <Text style={tw`font-sans-semibold text-[15px] text-white`}>
            {label}
          </Text>
          {comment.creator ? <CreatorBadge /> : null}
          <Text style={tw`ml-2 font-sans text-[13px] text-slate-500`}>
            {relativeTime(comment.createdAt, Date.now(), true)}
          </Text>
          <LikeButton
            liked={comment.liked}
            count={comment.likeCount}
            onPress={() => onToggleLike(comment)}
            size={18}
            style={tw`ml-auto`}
          />
          {comment.mine ? (
            <Pressable
              onPress={() => onOptions(comment)}
              hitSlop={10}
              style={tw`ml-3 pl-1`}
            >
              <MoreVertical size={18} color="#64748b" strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
        {comment.body ? (
          <Body
            text={comment.body}
            style={tw`mt-1.5 pl-2.5 font-sans text-[15px] leading-[22px] text-slate-200`}
          />
        ) : null}
        {comment.gifUrl ? (
          <CommentGif uri={comment.gifUrl} width={220} />
        ) : null}
        {comment.imageUrl ? (
          <CommentImage
            uri={comment.imageUrl}
            width={220}
            onOpen={onImageOpen}
          />
        ) : null}
        <Pressable
          onPress={() =>
            rowRef.current?.measureInWindow((_x, screenY, _w, height) =>
              onReply(comment, screenY + height)
            )
          }
          hitSlop={8}
          style={tw`mt-2.5 self-start pl-2.5`}
        >
          <Text style={tw`font-sans-semibold text-[13px] text-slate-400`}>
            Reply
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

const ReplyRow = memo(function ReplyRow({
  comment,
  isLast,
  onToggleLike,
  onReply,
  onOptions,
  onImageOpen,
  highlighted,
}: {
  comment: UpdateComment;
  isLast: boolean;
  onToggleLike: (comment: UpdateComment) => void;
  onReply: (comment: UpdateComment, rowScreenBottom?: number) => void;
  onOptions: (comment: UpdateComment) => void;
  onImageOpen: (uri: string, aspect: number, origin: FocusOrigin) => void;
  highlighted: boolean;
}) {
  const rowRef = useRef<View>(null);
  const handle = comment.username.startsWith('@')
    ? comment.username
    : `@${comment.username}`;
  const label = isGuestName(comment.username)
    ? displayName(comment.username)
    : handle;
  const lineGrow = useSharedValue(highlighted ? 0 : 1);
  useEffect(() => {
    if (!highlighted) return;
    lineGrow.value = withDelay(800, withTiming(1, { duration: 500 }));
  }, [highlighted, lineGrow]);
  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: lineGrow.value }],
  }));
  const curveStyle = useAnimatedStyle(() => ({ opacity: lineGrow.value }));
  return (
    <View ref={rowRef} style={tw`flex-row`}>
      <View style={tw`w-9`}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 20,
              top: 0,
              bottom: isLast ? undefined : 0,
              height: isLast ? 30 : undefined,
              width: 2,
              backgroundColor: THREAD,
              transformOrigin: ['50%', 0, 0],
            },
            lineStyle,
          ]}
        />
        <ThreadCurve top={24} style={curveStyle} />
      </View>
      <View style={tw`flex-1 flex-row pt-6`}>
        <Avatar
          name={displayName(comment.username)}
          size={30}
          uri={comment.avatarUrl}
        />
        <View style={tw`ml-2.5 flex-1`}>
          <View style={tw`flex-row items-center`}>
            <Text style={tw`font-sans-semibold text-[14px] text-white`}>
              {label}
            </Text>
            {comment.creator ? <CreatorBadge /> : null}
            <Text style={tw`ml-2 font-sans text-[12px] text-slate-500`}>
              {relativeTime(comment.createdAt, Date.now(), true)}
            </Text>
            <LikeButton
              liked={comment.liked}
              count={comment.likeCount}
              onPress={() => onToggleLike(comment)}
              size={16}
              style={tw`ml-auto`}
            />
            {comment.mine && !highlighted ? (
              <Pressable
                onPress={() => onOptions(comment)}
                hitSlop={10}
                style={tw`ml-3 pl-1`}
              >
                <MoreVertical size={16} color="#64748b" strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
          {comment.body ? (
            <Body
              text={comment.body}
              style={tw`mt-2 pl-2.5 font-sans text-[14px] leading-5 text-slate-200`}
            />
          ) : null}
          {comment.gifUrl ? (
            <CommentGif uri={comment.gifUrl} width={180} />
          ) : null}
          {comment.imageUrl ? (
            <CommentImage
              uri={comment.imageUrl}
              width={180}
              onOpen={onImageOpen}
            />
          ) : null}
          <Pressable
            onPress={() =>
              rowRef.current?.measureInWindow((_x, screenY, _w, height) =>
                onReply(comment, screenY + height)
              )
            }
            hitSlop={8}
            style={tw`mt-2 self-start pl-2.5`}
          >
            <Text style={tw`font-sans-semibold text-[12px] text-slate-400`}>
              Reply
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
});

export default function CommentsPanel({
  updateId,
  visible,
  myName,
  myAvatar,
  ensureIdentity,
  onBack,
  focusCommentId,
  header,
  barCategory,
  barTimestamp,
  barTitle,
  barVersion,
}: {
  updateId: string | null;
  visible: boolean;
  myName: string | null;
  myAvatar: string | null;
  ensureIdentity: (mode?: 'google' | 'guest' | 'auto') => Promise<boolean>;
  onBack: () => void;
  focusCommentId?: string | null;
  header?: ReactNode;
  barCategory?: string;
  barTimestamp?: string;
  barTitle?: string;
  barVersion?: string;
}) {
  const [comments, setComments] = useState<UpdateComment[]>(() =>
    cachedComments(updateId ?? '')
  );
  const [loaded, setLoaded] = useState(
    () => cachedComments(updateId ?? '').length > 0
  );
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [replyShown, setReplyShown] = useState<Record<string, number>>({});
  const [replyTarget, setReplyTarget] = useState<{
    id: string;
    handle: string;
  } | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string } | null>(null);
  const [options, setOptions] = useState<UpdateComment | null>(null);
  const [rootLimit, setRootLimit] = useState(ROOT_BATCH);
  const [ready, setReady] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [focusImage, setFocusImage] = useState<{
    uri: string;
    aspect: number;
    origin: FocusOrigin;
  } | null>(null);
  const [pendingGif, setPendingGif] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const pendingImageAspect = useRef(0);
  const scrollRef = useAnimatedRef<Animated.FlatList<UpdateComment>>();
  const svWrapRef = useRef<View>(null);
  const rootRefs = useRef<Record<string, View | null>>({});
  const commentsRef = useRef<UpdateComment[]>(comments);
  const scrollH = useRef(0);
  const commentsTop = useRef(0);
  const svTop = useRef(0);
  const scrollTop = useSharedValue(0);
  const kbHeight = useRef(0);
  const pendingReplyBottom = useRef<number | null>(null);

  // keyboardChatScrollView lifts content via native contentInset sim, layout
  // stays static — avoids per-frame layout/composite cost on the heavy list.
  // composerExtra = live composer height, so content clears it.
  const composerExtra = useSharedValue(0);
  const { progress: kbProgress } = useReanimatedKeyboardAnimation();
  // only reserve composer clearance while the keyboard is up — keeps a tight
  // bottom (no huge gap after the last comment) when it's down.
  const extraPadding = useDerivedValue(
    () => composerExtra.value * kbProgress.value
  );
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <KeyboardChatScrollView
        {...props}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardLiftBehavior="never"
        offset={insets.bottom}
        extraContentPadding={extraPadding}
      />
    ),
    [insets.bottom, extraPadding]
  );

  const barMetaStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollTop.value,
      META_FADE,
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));
  const barTitleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollTop.value,
      TITLE_FADE,
      [0, 1],
      Extrapolation.CLAMP
    ),
    transform: [
      {
        translateY: interpolate(
          scrollTop.value,
          TITLE_FADE,
          [9, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollTop.value = event.contentOffset.y;
  });

  useEffect(() => {
    if (!visible || !updateId) return;
    setError(null);
    setInput('');
    setExpanded({});
    setReplyShown({});
    setRootLimit(ROOT_BATCH);
    setReplyTarget(null);
    setEditTarget(null);
    setOptions(null);
    setPendingGif(null);
    setPendingImage(null);
    listComments(updateId)
      .then((list) => {
        setComments(list);
        setLoaded(true);
      })
      .catch((err) => {
        setError(messageOf(err));
        setLoaded(true);
      });
  }, [visible, updateId]);

  useEffect(() => {
    if (updateId) cacheComments(updateId, comments);
    commentsRef.current = comments;
  }, [comments, updateId]);

  // defer the (heavy) comment render until just after the entrance animation so
  // a cached thread doesnt render synchronously on mount & stall the transition
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible || !updateId) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        listComments(updateId)
          .then(setComments)
          .catch(() => undefined);
      }, 250);
    };
    const unsubscribe = subscribeToComments(updateId, refresh);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [visible, updateId]);

  useBlurOnKeyboardHide(inputRef);

  const smoothScrollTo = useCallback(
    (y: number) => {
      runOnUI((to: number) => {
        'worklet';
        scrollTo(scrollRef, 0, to, true);
      })(y);
    },
    [scrollRef]
  );

  /* place the pending reply target's bottom just above the composer, using the ..real keyboard height. only scroll down so comment never drops off-top. */
  const flushReplyScroll = useCallback(
    (kb: number) => {
      const contentBottom = pendingReplyBottom.current;
      if (contentBottom == null || scrollH.current === 0) return;
      pendingReplyBottom.current = null;
      const visibleAbove = scrollH.current - kb;
      const target = Math.max(0, contentBottom - visibleAbove - 25);
      if (target > scrollTop.value) smoothScrollTo(target);
    },
    [smoothScrollTo, scrollTop]
  );

  useEffect(() => {
    const onShow = (event: { height: number }) => {
      kbHeight.current = event.height;
      flushReplyScroll(event.height);
    };
    const willShow = KeyboardEvents.addListener('keyboardWillShow', onShow);
    const didShow = KeyboardEvents.addListener('keyboardDidShow', onShow);
    const willHide = KeyboardEvents.addListener('keyboardWillHide', () => {
      kbHeight.current = 0;
    });
    return () => {
      willShow.remove();
      didShow.remove();
      willHide.remove();
    };
  }, [flushReplyScroll]);

  useEffect(() => {
    if (!focusCommentId) {
      setFocusId(null);
      return undefined;
    }
    setFocusId(focusCommentId);
    const scrollTimer = setTimeout(() => {
      const target = commentsRef.current.find(
        (item) => item.id === focusCommentId
      );
      if (!target) return;
      const rootId = target.parentId ?? target.id;
      if (target.parentId) {
        setExpanded((prev) => ({ ...prev, [rootId]: true }));
        setReplyShown((prev) => ({
          ...prev,
          [rootId]: Number.MAX_SAFE_INTEGER,
        }));
      }
      rootRefs.current[rootId]?.measureInWindow((_x, screenY, _w, height) => {
        if (scrollH.current === 0) return;
        const contentBottom =
          screenY + height - svTop.current + scrollTop.value;
        const targetY = Math.max(0, contentBottom - scrollH.current * 0.6);
        smoothScrollTo(targetY);
      });
    }, 500);
    const clearTimer = setTimeout(() => setFocusId(null), 2800);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [focusCommentId, smoothScrollTo]);

  const reload = async () => {
    if (updateId) setComments(await listComments(updateId));
  };

  const send = async () => {
    if (!updateId) return;
    const hasAttachment = !editTarget && (!!pendingGif || !!pendingImage);
    const check = validateComment(input, hasAttachment);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (!(await ensureIdentity())) return;
    setError(null);
    tapSuccess();
    Keyboard.dismiss();

    if (editTarget) {
      const { id } = editTarget;
      const nextBody = check.value;
      setComments((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, body: nextBody } : item
        )
      );
      setInput('');
      setEditTarget(null);
      try {
        await editComment(id, nextBody);
      } catch (err) {
        setError(messageOf(err));
        await reload();
      }
      return;
    }

    const body = check.value;
    const parentId = replyTarget?.id ?? null;
    const gifUrl = pendingGif;
    const localImage = pendingImage;
    const id = Crypto.randomUUID();
    const optimistic: UpdateComment = {
      id,
      updateId,
      body,
      username: myName ?? '',
      avatarUrl: myAvatar,
      createdAt: new Date().toISOString(),
      mine: true,
      parentId,
      likeCount: 0,
      liked: false,
      gifUrl,
      imageUrl: localImage,
      creator: false,
    };
    setComments((prev) => [optimistic, ...prev]);
    if (parentId) {
      setExpanded((prev) => ({ ...prev, [parentId]: true }));
      setReplyShown((prev) => ({
        ...prev,
        [parentId]: Number.MAX_SAFE_INTEGER,
      }));
    }
    setInput('');
    setReplyTarget(null);
    setPendingGif(null);
    setPendingImage(null);
    if (parentId) {
      const rootId = parentId;
      setTimeout(() => {
        rootRefs.current[rootId]?.measureInWindow((_x, screenY, _w, height) => {
          if (scrollH.current === 0) return;
          const contentBottom =
            screenY + height - svTop.current + scrollTop.value;
          const target = Math.max(0, contentBottom - scrollH.current * 0.5);
          smoothScrollTo(target);
        });
      }, 260);
    } else {
      // land on the comments section (new comment is now first), not the post top
      requestAnimationFrame(() =>
        smoothScrollTo(Math.max(0, commentsTop.current - 12))
      );
    }
    try {
      const imageUrl = localImage
        ? await uploadCommentImage(localImage, pendingImageAspect.current)
        : null;
      await addComment(updateId, body, parentId, id, gifUrl, imageUrl);
      await reload();
    } catch (err) {
      setComments((prev) => prev.filter((item) => item.id !== id));
      setInput(check.value);
      setPendingGif(gifUrl);
      setPendingImage(localImage);
      setError(messageOf(err));
    }
  };

  const remove = async (commentId: string) => {
    setOptions(null);
    setComments((prev) =>
      prev.filter(
        (item) => item.id !== commentId && item.parentId !== commentId
      )
    );
    try {
      await deleteComment(commentId);
    } catch (err) {
      setError(messageOf(err));
      await reload();
    }
  };

  const toggleLike = useCallback(
    async (comment: UpdateComment) => {
      if (!(await ensureIdentity())) return;
      tapSelection();
      const next = !comment.liked;
      setComments((prev) =>
        prev.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                liked: next,
                likeCount: Math.max(0, item.likeCount + (next ? 1 : -1)),
              }
            : item
        )
      );
      (next ? likeComment : unlikeComment)(comment.id).catch((err) => {
        setComments((prev) =>
          prev.map((item) =>
            item.id === comment.id
              ? { ...item, liked: comment.liked, likeCount: comment.likeCount }
              : item
          )
        );
        setError(messageOf(err));
      });
    },
    [ensureIdentity]
  );

  const toggleReplies = useCallback((rootId: string) => {
    tapSelection();
    setExpanded((prev) => ({ ...prev, [rootId]: !prev[rootId] }));
  }, []);

  const loadMoreReplies = useCallback((rootId: string) => {
    tapSelection();
    setReplyShown((prev) => ({
      ...prev,
      [rootId]: (prev[rootId] ?? INITIAL_REPLIES) + REPLY_STEP,
    }));
  }, []);

  const openImageFocus = useCallback(
    (uri: string, aspect: number, origin: FocusOrigin) => {
      tapSelection();
      setFocusImage({ uri, aspect, origin });
    },
    []
  );

  const startReply = useCallback(
    (comment: UpdateComment, rowScreenBottom = -1) => {
      setEditTarget(null);
      const handle = comment.username.startsWith('@')
        ? comment.username
        : `@${comment.username}`;
      const rootId = comment.parentId ?? comment.id;
      setReplyTarget({ id: rootId, handle });
      setInput(`${handle} `);
      requestAnimationFrame(() => inputRef.current?.focus());
      // sit the tapped comment's row (incl. its Reply button, not its replies)
      // just above the composer once the keyboard is up.
      if (rowScreenBottom < 0 || scrollH.current === 0) return;
      pendingReplyBottom.current =
        rowScreenBottom - svTop.current + scrollTop.value;
      if (kbHeight.current > 0) flushReplyScroll(kbHeight.current);
    },
    [flushReplyScroll, scrollTop]
  );

  const startEdit = (comment: UpdateComment) => {
    setOptions(null);
    setReplyTarget(null);
    setEditTarget({ id: comment.id });
    setInput(comment.body);
    setTimeout(() => inputRef.current?.focus(), 180);
  };

  const cancelEdit = () => {
    setEditTarget(null);
    setInput('');
  };

  const attachImage = async () => {
    setPendingGif(null);
    const picked = await pickCommentImage();
    if (picked) {
      pendingImageAspect.current = picked.aspect;
      setPendingImage(picked.uri);
    }
  };

  const attachCamera = async () => {
    setPendingGif(null);
    const captured = await captureCommentImage();
    if (captured) {
      pendingImageAspect.current = captured.aspect;
      setPendingImage(captured.uri);
    }
  };

  const canSend = input.trim().length > 0 || !!pendingGif || !!pendingImage;
  const composerPlaceholder = replyTarget
    ? ''
    : editTarget
      ? 'Edit your comment…'
      : 'Add a comment…';
  const mentionPrefix =
    replyTarget && input.startsWith(`${replyTarget.handle} `)
      ? replyTarget.handle
      : '';
  const inputRest = input.slice(mentionPrefix.length);
  // stable ref so keyboard re-renders don't re-render every visible list row
  const roots = useMemo(
    () => comments.filter((comment) => !comment.parentId),
    [comments]
  );
  const listData = useMemo(
    () => (ready ? roots.slice(0, rootLimit) : []),
    [ready, roots, rootLimit]
  );
  const repliesFor = (rootId: string) =>
    comments
      .filter((comment) => comment.parentId === rootId)
      .sort(
        (first, second) =>
          new Date(first.createdAt).getTime() -
          new Date(second.createdAt).getTime()
      );

  // batch-mount roots per frame so a big thread opens instantly, not in one
  // blocking commit
  useEffect(() => {
    if (rootLimit >= roots.length) return undefined;
    const id = requestAnimationFrame(() =>
      setRootLimit((limit) => Math.min(limit + ROOT_BATCH, roots.length))
    );
    return () => cancelAnimationFrame(id);
  }, [rootLimit, roots.length]);

  const renderRoot = useCallback<ListRenderItem<UpdateComment>>(
    ({ item: root }) => {
      const replies = repliesFor(root.id);
      const hasReplies = replies.length > 0;
      const isOpen = !!expanded[root.id];
      /**
       * once a thread is toggled its key exists here; keep that thread's reply
       * Collapsible mounted so expand & collapse both animate, while
       * never-opened threads still skip mounting reply rows.
       */
      const everOpened = root.id in expanded;
      const shown = replyShown[root.id] ?? INITIAL_REPLIES;
      const visibleReplies = replies.slice(0, shown);
      const moreCount = replies.length - visibleReplies.length;
      const rootNew =
        root.mine &&
        Date.now() - new Date(root.createdAt).getTime() < HIGHLIGHT_MS;
      const rootFocused = focusId === root.id;
      return (
        <Animated.View
          ref={(node: View | null) => {
            rootRefs.current[root.id] = node;
          }}
          style={tw`mb-9`}
        >
          <>
            <NewGlow active={rootNew || rootFocused}>
              <CommentRow
                comment={root}
                onToggleLike={toggleLike}
                onReply={startReply}
                onOptions={setOptions}
                onImageOpen={openImageFocus}
                hasLine={hasReplies}
                expanded={isOpen}
                highlighted={rootNew}
              />
            </NewGlow>
            {hasReplies && everOpened ? (
              <Collapsible open={isOpen}>
                <Pressable
                  onPress={() => toggleReplies(root.id)}
                  hitSlop={6}
                  style={tw`flex-row`}
                >
                  <View style={tw`w-9`}>
                    <View
                      style={{
                        position: 'absolute',
                        left: 20,
                        top: 0,
                        bottom: 0,
                        width: 2,
                        backgroundColor: THREAD,
                      }}
                    />
                  </View>
                  <View style={tw`flex-row items-center pt-4`}>
                    <ChevronUp size={16} color="#64748b" strokeWidth={2.5} />
                    <Text
                      style={tw`ml-2 font-sans-medium text-[13px] text-slate-400`}
                    >
                      Hide replies
                    </Text>
                  </View>
                </Pressable>
                {visibleReplies.map((reply, replyIndex) => {
                  const replyNew =
                    reply.mine &&
                    Date.now() - new Date(reply.createdAt).getTime() <
                      HIGHLIGHT_MS;
                  return (
                    <NewGlow
                      key={reply.id}
                      active={replyNew || focusId === reply.id}
                      top={12}
                      bottom={-12}
                    >
                      <ReplyRow
                        comment={reply}
                        isLast={
                          replyIndex === visibleReplies.length - 1 &&
                          moreCount <= 0
                        }
                        onToggleLike={toggleLike}
                        onReply={startReply}
                        onOptions={setOptions}
                        onImageOpen={openImageFocus}
                        highlighted={replyNew}
                      />
                    </NewGlow>
                  );
                })}
                {moreCount > 0 ? (
                  <Pressable
                    onPress={() => loadMoreReplies(root.id)}
                    hitSlop={6}
                    style={tw`flex-row`}
                  >
                    <View style={tw`w-9`}>
                      <View
                        style={{
                          position: 'absolute',
                          left: 20,
                          top: 0,
                          height: 28,
                          width: 2,
                          backgroundColor: THREAD,
                        }}
                      />
                      <View style={{ position: 'absolute', left: 17, top: 24 }}>
                        <ThreadEndDot />
                      </View>
                    </View>
                    <View style={tw`flex-row items-center pt-5`}>
                      <ChevronDown
                        size={16}
                        color="#94a3b8"
                        strokeWidth={2.5}
                      />
                      <Text
                        style={tw`ml-2 font-sans-medium text-[13px] text-slate-300`}
                      >
                        View {moreCount} more{' '}
                        {moreCount === 1 ? 'reply' : 'replies'}
                      </Text>
                    </View>
                  </Pressable>
                ) : null}
                <View style={tw`h-3.5`} />
              </Collapsible>
            ) : null}
            {hasReplies && !isOpen ? (
              <View style={tw`flex-row`}>
                <View style={tw`w-9`}>
                  <View
                    style={{
                      position: 'absolute',
                      left: 20,
                      top: 0,
                      height: 20,
                      width: 2,
                      backgroundColor: THREAD,
                    }}
                  />
                  <ThreadCurve top={16} />
                </View>
                <View style={tw`flex-row items-center pt-4`}>
                  <View style={tw`flex-row`}>
                    {replies.slice(0, 3).map((reply, avatarIndex) => (
                      <View
                        key={reply.id}
                        style={[
                          {
                            borderRadius: 999,
                            borderWidth: 2.5,
                            borderColor: PANEL_BG,
                          },
                          avatarIndex > 0 ? { marginLeft: -10 } : null,
                        ]}
                      >
                        <Avatar
                          name={reply.username}
                          size={22}
                          uri={reply.avatarUrl}
                        />
                      </View>
                    ))}
                  </View>
                  <Pressable
                    onPress={() => toggleReplies(root.id)}
                    hitSlop={6}
                    style={tw`ml-1.5 flex-row items-center`}
                  >
                    <ChevronDown size={16} color="#94a3b8" strokeWidth={2.5} />
                    <Text
                      style={tw`ml-2 font-sans-medium text-[13px] text-slate-400`}
                    >
                      Show {replies.length}{' '}
                      {replies.length === 1 ? 'reply' : 'replies'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        </Animated.View>
      );
    },
    [
      comments,
      expanded,
      replyShown,
      replyTarget,
      focusId,
      toggleLike,
      startReply,
      toggleReplies,
      loadMoreReplies,
      openImageFocus,
    ]
  );

  const ListHeader = header ? (
    <View
      onLayout={(event) => {
        commentsTop.current = event.nativeEvent.layout.height;
      }}
    >
      {header}
      <View style={tw`mb-4 mt-7 flex-row items-center`}>
        <Text
          style={tw`font-sans-bold text-[20px] tracking-tight text-white mb-2`}
        >
          Comments{' '}
          <Text style={tw`font-sans text-[14px] text-white/70`}>
            ({comments.length})
          </Text>
        </Text>
      </View>
    </View>
  ) : null;

  const { width: screenW } = useWindowDimensions();
  const catSize = Math.min(screenW * 0.35, 160);
  const ListEmpty = !ready ? (
    <CommentSkeleton />
  ) : loaded ? (
    <View style={tw`items-center`}>
      <LottieView
        source={runningCatAnim}
        autoPlay
        loop
        style={{ width: catSize, height: catSize }}
      />
      <Text style={tw`mt-0 font-sans text-[13px] text-slate-500`}>
        No comments yet — start the chat.
      </Text>
    </View>
  ) : (
    <CommentSkeleton />
  );

  return (
    <View style={tw`flex-1`}>
      <View style={tw`flex-row items-center px-3 pb-2 pt-2`}>
        <Pressable onPress={onBack} hitSlop={8} style={tw`p-1`}>
          <ChevronLeft size={26} color="#cbd5e1" strokeWidth={2} />
        </Pressable>
        {barTitle || barCategory ? (
          <View style={tw`ml-1 flex-1 justify-center`} pointerEvents="none">
            <Animated.View style={[tw`flex-row items-center`, barMetaStyle]}>
              {barCategory ? (
                <View
                  style={[
                    tw`rounded-full px-2.5 py-1`,
                    { backgroundColor: 'rgba(34,211,238,0.15)' },
                  ]}
                >
                  <Text
                    style={[
                      tw`font-sans-semibold text-[12px]`,
                      { color: CYAN },
                    ]}
                    numberOfLines={1}
                  >
                    {barCategory}
                  </Text>
                </View>
              ) : null}
              {barTimestamp ? (
                <Text
                  style={tw`ml-2 font-sans text-[12.5px] text-slate-500`}
                  numberOfLines={1}
                >
                  {barTimestamp}
                </Text>
              ) : null}
            </Animated.View>
            {barTitle ? (
              <Animated.View
                style={[
                  tw`absolute inset-0 flex-row items-center`,
                  barTitleStyle,
                ]}
              >
                <Text
                  style={tw`font-sans-bold text-[16px] tracking-tight text-white`}
                  numberOfLines={1}
                >
                  {barTitle}
                </Text>
              </Animated.View>
            ) : null}
          </View>
        ) : null}
        {barVersion ? (
          <Animated.View style={barMetaStyle}>
            <Text style={tw`ml-2 font-sans text-[12.5px] text-white/35`}>
              v{barVersion}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      {!myName ? (
        <View style={tw`bg-cyan-500 px-5 py-1.5`}>
          <Text style={tw`font-sans text-[12px] leading-4 text-white`}>
            <Text style={tw`font-sans-bold`}>Note: </Text>
            Sign-in is only for reactions and comments here — it&apos;s not used
            in the actual downloads.
          </Text>
        </View>
      ) : null}

      <View ref={svWrapRef} style={tw`flex-1`}>
        <Animated.FlatList
          ref={scrollRef}
          style={tw`flex-1`}
          data={listData}
          keyExtractor={(item) => item.id}
          renderItem={renderRoot}
          renderScrollComponent={renderScrollComponent}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={[tw`px-5`, { paddingBottom: 16 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={ROOT_BATCH}
          windowSize={7}
          maxToRenderPerBatch={6}
          onLayout={(event) => {
            scrollH.current = event.nativeEvent.layout.height;
            svWrapRef.current?.measureInWindow((_x, screenTop) => {
              svTop.current = screenTop;
            });
          }}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
        />
      </View>

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
        <View
          onLayout={(event) => {
            composerExtra.value = event.nativeEvent.layout.height;
          }}
          style={[
            tw`px-4 pt-2`,
            { paddingBottom: insets.bottom + 12, backgroundColor: PANEL_BG },
          ]}
        >
          {error ? (
            <Text style={tw`mb-2 px-1 font-sans text-[12px] text-red-400`}>
              {error}
            </Text>
          ) : null}
          {myName ? (
            <>
              {editTarget ? (
                <View
                  style={[
                    tw`mb-2 flex-row items-center justify-between rounded-2xl px-3.5 py-2.5`,
                    BANNER,
                  ]}
                >
                  <View style={tw`flex-row items-center`}>
                    <Pencil size={14} color="#06b6d4" strokeWidth={2} />
                    <Text style={tw`ml-2 font-sans text-[13px] text-slate-300`}>
                      Editing your comment
                    </Text>
                  </View>
                  <Pressable onPress={cancelEdit} hitSlop={8} style={tw`ml-2`}>
                    <X size={16} color="#94a3b8" strokeWidth={2} />
                  </Pressable>
                </View>
              ) : null}
              {pendingGif ? (
                <View style={tw`mb-2 flex-row`}>
                  <View>
                    <Image
                      source={{ uri: pendingGif }}
                      style={{ width: 92, height: 92, borderRadius: 14 }}
                      contentFit="cover"
                    />
                    <Pressable
                      onPress={() => setPendingGif(null)}
                      hitSlop={8}
                      style={[
                        tw`absolute h-6 w-6 items-center justify-center rounded-full`,
                        {
                          top: 4,
                          right: 4,
                          backgroundColor: 'rgba(0,0,0,0.65)',
                        },
                      ]}
                    >
                      <X size={14} color="#fff" strokeWidth={2.5} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
              {pendingImage ? (
                <View style={tw`mb-2 flex-row`}>
                  <View>
                    <Image
                      source={{ uri: pendingImage }}
                      style={{ width: 92, height: 92, borderRadius: 14 }}
                      contentFit="cover"
                    />
                    <Pressable
                      onPress={() => setPendingImage(null)}
                      hitSlop={8}
                      style={[
                        tw`absolute h-6 w-6 items-center justify-center rounded-full`,
                        {
                          top: 4,
                          right: 4,
                          backgroundColor: 'rgba(0,0,0,0.65)',
                        },
                      ]}
                    >
                      <X size={14} color="#fff" strokeWidth={2.5} />
                    </Pressable>
                  </View>
                </View>
              ) : null}
              <LinearGradient
                colors={['#182843', '#201d3e']}
                start={{ x: 1, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[
                  tw`flex-row items-center rounded-full px-3 py-2`,
                  {
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.18)',
                  },
                ]}
              >
                <Avatar name={displayName(myName)} size={34} uri={myAvatar} />
                <View style={tw`mx-3 flex-1`}>
                  <TextInput
                    ref={inputRef}
                    onChangeText={setInput}
                    onKeyPress={(event) => {
                      if (
                        event.nativeEvent.key === 'Backspace' &&
                        input.length === 0 &&
                        replyTarget
                      ) {
                        setReplyTarget(null);
                      }
                    }}
                    placeholder={composerPlaceholder}
                    placeholderTextColor="#828ea4"
                    multiline
                    style={[
                      tw`max-h-24 font-sans text-[16px] text-white`,
                      {
                        includeFontPadding: false,
                        paddingTop: 0,
                        paddingBottom: 0,
                      },
                    ]}
                  >
                    <Text style={tw`text-white`}>
                      {mentionPrefix ? (
                        <Text style={tw`font-sans-semibold text-primary`}>
                          {mentionPrefix}
                        </Text>
                      ) : null}
                      {inputRest}
                    </Text>
                  </TextInput>
                </View>
                {!editTarget ? (
                  <Pressable
                    onPress={() => {
                      tapSelection();
                      if (isGiphyConfigured) setAttachOpen(true);
                      else void attachImage();
                    }}
                    hitSlop={8}
                    style={tw`mr-2`}
                  >
                    <Plus
                      size={24}
                      color="rgba(255,255,255,0.7)"
                      strokeWidth={2}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void send()}
                  disabled={!canSend}
                  hitSlop={8}
                  style={tw`pr-1.5`}
                >
                  <SendIcon size={28} color={canSend ? '#3b9eff' : '#475569'} />
                </Pressable>
              </LinearGradient>
            </>
          ) : (
            <View style={tw`mb-1`}>
              <Text
                style={tw`mb-3 text-center font-sans text-[13px] text-slate-400`}
              >
                Choose option to join conversation
              </Text>
              <Pressable
                onPress={() => void ensureIdentity('guest')}
                style={({ pressed }) => [
                  tw`flex-row items-center justify-center rounded-full border border-white/15 bg-white/5 py-4`,
                  pressed ? { transform: [{ scale: 0.98 }] } : null,
                ]}
              >
                <Ghost size={16} color="#cbd5e1" strokeWidth={2} />
                <Text
                  numberOfLines={1}
                  style={tw`ml-2 font-sans-semibold text-[13px] text-slate-100`}
                >
                  Continue as Anonymous
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void ensureIdentity('google')}
                style={({ pressed }) => [
                  tw`mt-2 flex-row items-center justify-center rounded-full bg-white py-4`,
                  pressed ? { transform: [{ scale: 0.98 }] } : null,
                ]}
              >
                <GoogleIcon size={16} />
                <Text
                  numberOfLines={1}
                  style={tw`ml-2 font-sans-bold text-[13px] text-[#1f1f1f]`}
                >
                  Sign in with Google
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardStickyView>

      <BottomSheet
        open={!!options}
        onClose={() => setOptions(null)}
        restRatio={0.32}
        border="subtle"
      >
        {options ? (
          <View style={tw`pt-1`}>
            <Pressable
              onPress={() => startEdit(options)}
              android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
              style={tw`flex-row items-center rounded-2xl px-3 py-4`}
            >
              <Pencil size={20} color="#cbd5e1" strokeWidth={2} />
              <Text
                style={tw`ml-3.5 font-sans-medium text-[16px] text-slate-100`}
              >
                Edit
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void remove(options.id)}
              android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
              style={tw`flex-row items-center rounded-2xl px-3 py-4`}
            >
              <Trash2 size={20} color="#f87171" strokeWidth={2} />
              <Text
                style={tw`ml-3.5 font-sans-medium text-[16px] text-red-400`}
              >
                Delete
              </Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        restRatio={0.3}
        stars
        border="subtle"
      >
        <View style={[tw`flex-row pt-1`, { gap: 10 }]}>
          <AttachTile
            Icon={PhotosIcon}
            label="Photos"
            onPress={() => {
              setAttachOpen(false);
              void attachImage();
            }}
          />
          <AttachTile
            Icon={CameraIcon}
            label="Camera"
            onPress={() => {
              setAttachOpen(false);
              void attachCamera();
            }}
          />
          <AttachTile
            Icon={GifIcon}
            label="GIF"
            onPress={() => {
              setAttachOpen(false);
              setGifOpen(true);
            }}
          />
        </View>
      </BottomSheet>

      <GifPicker
        open={gifOpen}
        onClose={() => setGifOpen(false)}
        onSelect={(url, aspect) => {
          setPendingImage(null);
          setPendingGif(withAspect(url, aspect));
        }}
      />

      <FocusOverlay state={focusImage} onClose={() => setFocusImage(null)} />
    </View>
  );
}
