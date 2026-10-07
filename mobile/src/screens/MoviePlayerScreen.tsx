import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
  Animated as RNAnimated,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { VideoView, type VideoPlayer } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  ArrowLeft,
  Play,
  Pause,
  Settings,
  RotateCcw,
  RotateCw,
  Check,
  Download,
  Maximize,
  Minimize,
  Captions,
} from 'lucide-react-native';
import tw from '../lib/tw';
import { Play3Icon } from '../components/icons';
import { useBackHandler } from '../lib/back';
import { useMoviePlayer } from '../hooks/useMoviePlayer';
import { useFullscreenLock } from '../hooks/useFullscreenLock';
import { useBrightnessSwipe } from '../hooks/useBrightnessSwipe';
import { useSeekPreview, type SeekMedia } from '../hooks/useSeekPreview';
import { useSubtitles } from '../hooks/useSubtitles';
import { useDownload } from '../hooks/useDownload';
import { formatLabel, formatClock, formatSize } from '../lib/format';
import { tapImpact, tapSelection } from '../lib/haptics';
import { usePressScale } from '../hooks/usePressScale';
import { log } from '../lib/log';
import type { Format, VideoInfo } from '@phantom/extractors';
import type { MovieItem } from '../extractors/movies/browse';
import type { MovieRef } from '../extractors/movies/parse';

type Props = {
  visible: boolean;
  item: MovieItem | null;
  upNext: MovieItem[];
  onSelect: (item: MovieItem) => void;
  onClose: () => void;
};

function SeekBar({
  player,
  cacheKey,
  position,
  duration,
  buffered,
  onSeek,
  onInteract,
  media,
}: {
  player: VideoPlayer | null;
  cacheKey: string;
  media: SeekMedia;
  position: number;
  duration: number;
  buffered: number;
  onSeek: (fraction: number) => void;
  onInteract: () => void;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubVal = useRef<number | null>(null);
  const trackW = useRef(0);
  const shown = scrub ?? (duration > 0 ? position / duration : 0);
  const bufferedFrac = duration > 0 ? Math.min(1, buffered / duration) : 0;
  const { thumb, request, clear } = useSeekPreview(player, cacheKey, media);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((event) => {
      if (trackW.current <= 0) return;
      const frac = Math.max(0, Math.min(1, event.x / trackW.current));
      scrubVal.current = frac;
      setScrub(frac);
      onInteract();
      if (duration > 0) request(frac * duration);
    })
    .onEnd(() => {
      const active = scrubVal.current;
      scrubVal.current = null;
      clear();
      onInteract();
      if (active !== null) onSeek(active);
    });

  useEffect(() => {
    if (scrub === null || duration <= 0) return;
    if (Math.abs(position - scrub * duration) < 1.5) setScrub(null);
  }, [position, scrub, duration]);

  return (
    <View>
      {scrub !== null && duration > 0 && (
        <View style={tw`items-center`}>
          {thumb && (
            <Image
              source={thumb}
              style={tw`h-24 w-40 rounded-xl border border-white/20`}
              contentFit="cover"
            />
          )}
          <Text style={tw`mt-1 text-center font-mono text-[12px] text-white`}>
            {formatClock(scrub * duration)}
          </Text>
        </View>
      )}
      <GestureDetector gesture={pan}>
        <View
          hitSlop={{ top: 12, bottom: 12 }}
          onLayout={(event) => {
            trackW.current = event.nativeEvent.layout.width;
          }}
          style={tw`h-6 justify-center`}
        >
          <View style={tw`h-1 overflow-hidden rounded-full bg-white/25`}>
            <View
              style={[
                tw`absolute inset-y-0 left-0 bg-white/40`,
                { width: `${bufferedFrac * 100}%` },
              ]}
            />
            <View
              style={[
                tw`absolute inset-y-0 left-0 bg-cyan-400`,
                { width: `${shown * 100}%` },
              ]}
            />
          </View>
          <View
            style={[
              tw`absolute h-3.5 w-3.5 rounded-full bg-cyan-400`,
              { left: `${shown * 100}%`, marginLeft: -7, top: 5 },
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

function PlayerTopBar({
  title,
  quality,
  canQuality,
  onBack,
  onQuality,
  top,
}: {
  title: string;
  quality: string;
  canQuality: boolean;
  fullscreen: boolean;
  onBack: () => void;
  onQuality: () => void;
  onFullscreen: () => void;
  top: number;
}) {
  return (
    <View>
      <LinearGradient
        colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0)']}
        style={[tw`absolute inset-x-0 top-0 h-24`, { paddingTop: top }]}
        pointerEvents="none"
      />
      <View
        style={[tw`flex-row items-center gap-3 px-4`, { paddingTop: top + 8 }]}
      >
        <Pressable
          onPress={onBack}
          style={tw`rounded-full bg-black/60 p-2.5`}
          accessibilityLabel="Close player"
        >
          <ArrowLeft size={22} color="#ffffff" />
        </Pressable>
        <View style={tw`flex-1`}>
          <Text
            style={tw`font-sans-bold text-[15px] text-white`}
            numberOfLines={1}
          >
            {title}
          </Text>
          {quality !== '' && (
            <Text style={tw`font-mono text-[11px] text-slate-300`}>
              {quality}
            </Text>
          )}
        </View>
        {canQuality && (
          <Pressable
            onPress={onQuality}
            style={tw`rounded-full bg-black/60 p-2.5`}
            accessibilityLabel="Playback quality"
          >
            <Settings size={20} color="#ffffff" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function CenterButton({
  isPlaying,
  loading,
  onToggle,
}: {
  isPlaying: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <View
      style={tw`absolute inset-0 items-center justify-center`}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onToggle}
        style={tw`h-14 w-14 items-center justify-center rounded-full bg-black/60`}
        accessibilityLabel={loading ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#22d3ee" />
        ) : isPlaying ? (
          <Pause size={26} color="#ffffff" />
        ) : (
          <Play3Icon size={26} color="#ffffff" />
        )}
      </Pressable>
    </View>
  );
}

function QualityMenu({
  open,
  formats,
  currentId,
  onPick,
  onClose,
}: {
  open: boolean;
  formats: Format[];
  currentId: string | null;
  onPick: (format: Format) => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const sheetY = useRef(new RNAnimated.Value(height)).current;
  const bgOpacity = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    sheetY.setValue(height);
    bgOpacity.setValue(0);
    RNAnimated.parallel([
      RNAnimated.timing(sheetY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      RNAnimated.timing(bgOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, bgOpacity, height, sheetY]);

  const closeSheet = useCallback(() => {
    RNAnimated.parallel([
      RNAnimated.timing(sheetY, {
        toValue: height,
        duration: 180,
        useNativeDriver: true,
      }),
      RNAnimated.timing(bgOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [bgOpacity, height, onClose, sheetY]);

  return (
    <Modal
      transparent
      visible={open}
      animationType="none"
      onRequestClose={closeSheet}
    >
      <View style={tw`flex-1 justify-end`}>
        <Pressable style={tw`absolute inset-0`} onPress={closeSheet}>
          <RNAnimated.View
            style={[tw`flex-1 bg-black/60`, { opacity: bgOpacity }]}
          />
        </Pressable>
        <RNAnimated.View style={{ transform: [{ translateY: sheetY }] }}>
          <View
            style={tw`rounded-t-[32px] border-t border-white/10 bg-[#1E1E1E] px-4 pb-8 pt-3`}
          >
            <View style={tw`mx-auto mb-3 h-1 w-10 rounded-full bg-white/15`} />
            <Text
              style={tw`mb-2 text-center font-sans-bold text-[15px] text-white`}
            >
              Quality
            </Text>
            {formats.map((format) => {
              const active = format.formatId === currentId;
              return (
                <Pressable
                  key={format.formatId}
                  onPress={() => {
                    tapSelection();
                    onPick(format);
                    closeSheet();
                  }}
                  style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
                >
                  <Text
                    style={tw`font-mono-semibold text-[14px] ${active ? 'text-white' : 'text-slate-300'}`}
                  >
                    {formatLabel(format)}
                  </Text>
                  {active && <Check size={18} color="#22d3ee" />}
                </Pressable>
              );
            })}
          </View>
        </RNAnimated.View>
      </View>
    </Modal>
  );
}

function PortraitPanel({
  info,
  item,
  currentId,
  upNext,
  onDownload,
  onSelect,
  downloading,
}: {
  info: VideoInfo | null;
  item: MovieItem | null;
  currentId: string | null;
  upNext: MovieItem[];
  onDownload: () => void;
  onSelect: (entry: MovieItem) => void;
  downloading: boolean;
}) {
  const current = info?.formats.find((format) => format.formatId === currentId);
  const size = current?.filesize ? formatSize(current.filesize) : '';
  const dlPress = usePressScale();
  return (
    <ScrollView style={tw`flex-1`} contentContainerStyle={tw`gap-6 px-5 py-5`}>
      <View>
        <Text
          style={tw`font-sans-bold text-[20px] leading-7 text-white`}
          numberOfLines={2}
        >
          {info?.title ?? item?.title ?? ''}
        </Text>
        <View style={tw`mt-2 flex-row items-center gap-2`}>
          <View style={tw`flex-1 flex-row items-center gap-2`}>
            {[item?.year, current ? formatLabel(current) : '', size]
              .filter(Boolean)
              .map((part, i, arr) => (
                <Text
                  key={part}
                  style={tw`font-mono text-[12px] text-slate-500`}
                >
                  {part}
                  {i < arr.length - 1 ? '  ·' : ''}
                </Text>
              ))}
          </View>
          <Pressable
            onPress={onDownload}
            disabled={!current || downloading}
            testID="movie-player-download"
            accessibilityLabel="Download this title"
            style={tw`h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white/10 ${!current ? 'opacity-50' : ''}`}
            onPressIn={dlPress.onPressIn}
            onPressOut={dlPress.onPressOut}
          >
            <Animated.View style={dlPress.pressScaleStyle}>
              {downloading ? (
                <ActivityIndicator size="small" color="#e2e8f0" />
              ) : (
                <Download size={20} color="#e2e8f0" strokeWidth={2.5} />
              )}
            </Animated.View>
          </Pressable>
        </View>
      </View>
      {upNext.length > 0 && (
        <View style={tw`gap-3`}>
          <Text style={tw`font-sans-bold text-[16px] text-slate-200`}>
            Up next
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={tw`gap-4`}
          >
            {upNext.map((entry, index) => (
              <Pressable
                key={`${entry.kind}-${entry.id}`}
                testID={`movie-upnext-${index}`}
                onPress={() => {
                  tapSelection();
                  onSelect(entry);
                }}
                style={{ width: 116 }}
              >
                <View style={tw`overflow-hidden rounded-[26px] bg-white/5`}>
                  {entry.poster ? (
                    <Image
                      source={{ uri: entry.poster }}
                      style={{ width: '100%', height: 170 }}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View
                      style={tw`h-[170px] w-full items-center justify-center bg-white/5`}
                    >
                      <Play size={22} color="#64748b" />
                    </View>
                  )}
                </View>
                <Text
                  style={tw`mt-2 font-sans-medium uppercase text-[12px] text-slate-100`}
                  numberOfLines={1}
                >
                  {entry.title}
                </Text>
                {entry.year && (
                  <Text style={tw`mt-0.5 font-mono text-[11px] text-slate-500`}>
                    {entry.year}
                  </Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

function ControlsOverlay({
  title,
  quality,
  canQuality,
  fullscreen,
  isPlaying,
  position,
  duration,
  buffered,
  player,
  cacheKey,
  top,
  onBack,
  onQuality,
  onFullscreen,
  onToggle,
  onSeek,
  onInteract,
  media,
  loading,
  subsOn,
  canSubs,
  onToggleSubs,
}: {
  title: string;
  quality: string;
  canQuality: boolean;
  fullscreen: boolean;
  isPlaying: boolean;
  position: number;
  duration: number;
  buffered: number;
  loading: boolean;
  player: VideoPlayer | null;
  cacheKey: string;
  media: SeekMedia;
  top: number;
  onBack: () => void;
  onQuality: () => void;
  onFullscreen: () => void;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  onInteract: () => void;
  subsOn: boolean;
  canSubs: boolean;
  onToggleSubs: () => void;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={tw`absolute inset-0`}
      pointerEvents="box-none"
    >
      <PlayerTopBar
        title={title}
        quality={quality}
        canQuality={canQuality}
        fullscreen={fullscreen}
        top={top}
        onBack={onBack}
        onQuality={onQuality}
        onFullscreen={onFullscreen}
      />
      <CenterButton
        isPlaying={isPlaying}
        loading={loading}
        onToggle={onToggle}
      />
      <View style={tw`absolute inset-x-0 bottom-0`}>
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)']}
          style={tw`absolute inset-x-0 bottom-0 h-20`}
          pointerEvents="none"
        />
        <View style={tw`px-4 pb-2`}>
          <View style={tw`mb-1 flex-row items-center justify-between`}>
            <Text style={tw`font-mono text-[11px] text-slate-200`}>
              {formatClock(position)} / {formatClock(duration)}
            </Text>
            <View style={tw`flex-row items-center gap-2`}>
              <Pressable
                onPress={onToggleSubs}
                disabled={!canSubs}
                style={tw`rounded-full bg-black/60 p-2.5 ${canSubs ? '' : 'opacity-40'}`}
                accessibilityLabel={subsOn ? 'Turn subtitles off' : 'Turn subtitles on'}
              >
                <Captions
                  size={20}
                  color={subsOn ? '#22d3ee' : '#ffffff'}
                  strokeWidth={subsOn ? 2.5 : 2}
                />
              </Pressable>
              <Pressable
                onPress={onFullscreen}
                style={tw`rounded-full bg-black/60 p-2.5`}
                accessibilityLabel={
                  fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
                }
              >
                {fullscreen ? (
                  <Minimize size={20} color="#ffffff" />
                ) : (
                  <Maximize size={20} color="#ffffff" />
                )}
              </Pressable>
            </View>
          </View>
          <SeekBar
            player={player}
            cacheKey={cacheKey}
            position={position}
            duration={duration}
            buffered={buffered}
            onSeek={onSeek}
            onInteract={onInteract}
            media={media}
          />
        </View>
      </View>
    </Animated.View>
  );
}

function StageState({
  phase,
  poster,
  fault,
  onRetry,
}: {
  phase: string;
  poster: string | undefined;
  fault: string | null;
  onRetry: () => void;
}) {
  if (phase === 'loading') {
    return (
      <View
        style={tw`absolute inset-0 items-center justify-center bg-black/60`}
      >
        {poster && (
          <Image
            source={{ uri: poster }}
            style={tw`absolute inset-0 opacity-30`}
            contentFit="cover"
          />
        )}
        <ActivityIndicator size="large" color="#22d3ee" />
      </View>
    );
  }
  if (phase === 'error') {
    return (
      <View
        style={tw`absolute inset-0 items-center justify-center bg-black/80 px-8`}
      >
        <Text style={tw`text-center font-sans-bold text-[17px] text-white`}>
          Could not play this
        </Text>
        <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
          {fault ?? 'Unknown player error'}
        </Text>
        <Pressable
          onPress={onRetry}
          style={tw`mt-4 flex-row items-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3`}
        >
          <RotateCcw size={18} color="#083344" />
          <Text style={tw`font-sans-bold text-[15px] text-slate-950`}>
            Retry
          </Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

type TapSide = 'left' | 'center' | 'right';

const TAP_SIDES: TapSide[] = ['left', 'center', 'right'];

function previewKey(item: MovieItem | null, currentId: string | null): string {
  const kind = item?.kind ?? 'movie';
  const id = item?.id ?? 'none';
  return `${kind}/${id}/${currentId ?? 'none'}`;
}

function silenceNativeCaptions(player: VideoPlayer): void {
  try {
    player.subtitleTrack = null;
  } catch {
    /* builds without the subtitle api */
  }
}

function subRefOf(item: MovieItem | null): MovieRef | null {
  if (!item) return null;
  return item.kind === 'tv'
    ? { kind: 'tv', tmdbId: item.id, season: '1', episode: '1' }
    : { kind: 'movie', tmdbId: item.id };
}

function seekMedia(
  info: VideoInfo | null,
  currentId: string | null
): SeekMedia {
  if (!info) return null;
  return {
    formats: info.formats,
    currentId,
    headers: info.downloadHeaders ?? {},
  };
}

function SeekMark({
  mark,
}: {
  mark: { side: 'left' | 'right'; total: number } | null;
}) {
  if (!mark) return null;
  return (
    <View
      style={[
        tw`absolute inset-y-0 items-center justify-center`,
        mark.side === 'left' ? { left: 28 } : { right: 28 },
      ]}
      pointerEvents="none"
    >
      <View
        style={tw`flex-row items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5`}
      >
        {mark.side === 'left' ? (
          <RotateCcw size={16} color="#ffffff" />
        ) : (
          <RotateCw size={16} color="#ffffff" />
        )}
        <Text style={tw`font-sans-bold text-[16px] text-white`}>
          {mark.side === 'left' ? `-${mark.total}s` : `+${mark.total}s`}
        </Text>
      </View>
    </View>
  );
}

function VideoStage({
  player,
  phase,
  poster,
  fault,
  title,
  quality,
  canQuality,
  fullscreen,
  isPlaying,
  position,
  duration,
  buffered,
  flash,
  seekMark,
  controls,
  top,
  cacheKey,
  onOpen,
  onBack,
  onQuality,
  onFullscreen,
  onToggle,
  onSeek,
  onInteract,
  media,
  loading,
  onZoneTap,
  subsOn,
  canSubs,
  onToggleSubs,
}: {
  player: VideoPlayer;
  phase: string;
  poster: string | undefined;
  fault: string | null;
  title: string;
  quality: string;
  canQuality: boolean;
  fullscreen: boolean;
  isPlaying: boolean;
  position: number;
  duration: number;
  buffered: number;
  loading: boolean;
  flash: string | null;
  seekMark: { side: 'left' | 'right'; total: number } | null;
  controls: boolean;
  top: number;
  cacheKey: string;
  media: SeekMedia;
  onOpen: () => void;
  onBack: () => void;
  onQuality: () => void;
  onFullscreen: () => void;
  onToggle: () => void;
  onSeek: (fraction: number) => void;
  onInteract: () => void;
  onZoneTap: (side: TapSide) => void;
  subsOn: boolean;
  canSubs: boolean;
  onToggleSubs: () => void;
}) {
  return (
    <>
      <VideoView
        player={player}
        style={tw`h-full w-full`}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        fullscreenOptions={{ enable: false }}
      />
      <StageState
        phase={phase}
        poster={poster}
        fault={fault}
        onRetry={onOpen}
      />
      {phase !== 'loading' && (
        <View style={tw`absolute inset-0 flex-row`}>
          {TAP_SIDES.map((side) => (
            <Pressable
              key={side}
              style={tw`flex-1`}
              onPress={() => onZoneTap(side)}
              accessibilityLabel={`${side} tap zone`}
            />
          ))}
        </View>
      )}
      {controls && phase !== 'loading' && (
        <ControlsOverlay
          title={title}
          quality={quality}
          canQuality={canQuality}
          fullscreen={fullscreen}
          isPlaying={isPlaying}
          position={position}
          duration={duration}
          buffered={buffered}
          player={player}
          cacheKey={cacheKey}
          media={media}
          loading={loading}
          top={top}
          onBack={onBack}
          onQuality={onQuality}
          onFullscreen={onFullscreen}
          onToggle={onToggle}
          onSeek={onSeek}
          onInteract={onInteract}
          subsOn={subsOn}
          canSubs={canSubs}
          onToggleSubs={onToggleSubs}
        />
      )}
      {flash && phase === 'ready' && (
        <View
          style={tw`absolute inset-x-0 top-1/3 items-center`}
          pointerEvents="none"
        >
          <Text
            style={tw`rounded-full bg-black/70 px-3 py-1.5 font-sans-bold text-[16px] text-white`}
          >
            {flash}
          </Text>
        </View>
      )}
      <SeekMark mark={seekMark} />
    </>
  );
}

function captionBottom(landscape: boolean, controls: boolean): number {
  if (!landscape) return 8;
  return controls ? 80 : 24;
}

function CaptionLayer({
  show,
  line,
  bottom,
}: {
  show: boolean;
  line: string | null;
  bottom: number;
}) {
  if (!show || !line) return null;
  return (
    <View
      style={[tw`absolute inset-x-0 items-center px-8`, { bottom }]}
      pointerEvents="none"
    >
      <Text
        style={tw`rounded-lg bg-black/70 px-3 py-1.5 text-center font-sans text-[15px] leading-5 text-white`}
      >
        {line}
      </Text>
    </View>
  );
}

function StallSpinner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <View
      style={tw`absolute inset-0 items-center justify-center`}
      pointerEvents="none"
    >
      <View style={tw`rounded-full bg-black/60 p-4`}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    </View>
  );
}

export default function MoviePlayerScreen({
  visible,
  item,
  upNext,
  onSelect,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const {
    player,
    phase,
    info,
    currentId,
    fault,
    isPlaying,
    position,
    open,
    close,
    switchQuality,
  } = useMoviePlayer();
  const { downloads, startDownload } = useDownload(info);
  const [controls, setControls] = useState(true);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [seekMark, setSeekMark] = useState<{
    side: 'left' | 'right';
    total: number;
  } | null>(null);
  const [stalled, setStalled] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [subsOn, setSubsOn] = useState(false);
  const seekTarget = useRef(0);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAdvance = useRef(Date.now());
  const live = useRef({ pos: 0, buf: 0, playing: false });
  const { fullscreen, enter, exit } = useFullscreenLock();

  const handleClose = useCallback(() => {
    if (fullscreen) void exit();
    onClose();
  }, [fullscreen, exit, onClose]);

  useBackHandler(() => {
    if (!visible) return false;
    if (fullscreen) {
      void exit();
      return true;
    }
    onClose();
    return true;
  }, 20);

  useEffect(() => {
    if (!visible || !item) return;
    void open(item.kind, item.id);
  }, [visible, item, open]);

  useEffect(() => {
    if (!visible) {
      close();
      if (fullscreen) void exit();
    }
  }, [visible, close, fullscreen, exit]);

  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 5000);
  }, []);

  const brightGesture = useBrightnessSwipe((level) => {
    setFlash(`${Math.round(level * 100)}%`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 800);
    poke();
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-arm autohide when playback resumes
    if (visible && isPlaying) poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible, isPlaying, poke]);

  const lastTap = useRef({ at: 0, side: '' as TapSide | '' });
  const tapId = useRef(0);
  const acc = useRef({ side: '' as TapSide | '', total: 0, at: 0 });
  const accTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accSeek = (side: 'left' | 'right') => {
    const dir = side === 'left' ? -10 : 10;
    const now = Date.now();
    const total =
      acc.current.side === side && now - acc.current.at < 1000
        ? acc.current.total + 10
        : 10;
    acc.current = { side, total, at: now };
    if (accTimer.current) clearTimeout(accTimer.current);
    accTimer.current = setTimeout(() => {
      acc.current = { side: '', total: 0, at: 0 };
      setSeekMark(null);
    }, 1000);
    tapSelection();
    player.seekBy(dir);
    setSeekMark({ side, total });
    poke();
  };

  const singleTap = () => {
    if (controls) setControls(false);
    else poke();
  };

  const toggle = () => {
    tapImpact();
    if (isPlaying) player.pause();
    else player.play();
    poke();
  };

  const handleTap = (side: TapSide) => {
    const now = Date.now();
    const prev = lastTap.current;
    if (side === 'center') {
      lastTap.current = { at: now, side };
      if (prev.side === 'center' && now - prev.at < 320) toggle();
      else singleTap();
      return;
    }
    if (prev.side === side && now - prev.at < 320) {
      tapId.current += 1;
      lastTap.current = { at: now, side };
      accSeek(side);
      return;
    }
    const id = ++tapId.current;
    lastTap.current = { at: now, side };
    setTimeout(() => {
      if (tapId.current === id) singleTap();
    }, 330);
  };

  const dlState = currentId ? downloads[currentId] : undefined;
  const downloading =
    dlState?.status === 'downloading' ||
    dlState?.status === 'muxing' ||
    dlState?.status === 'saving';

  const downloadCurrent = () => {
    const current =
      info?.formats.find((format) => format.formatId === currentId) ??
      info?.formats[0];
    if (!current || downloading) return;
    tapImpact();
    log('Player', `download tap ${current.formatId}`);
    void startDownload(current);
  };

  const toggleFullscreen = () => {
    tapSelection();
    poke();
    void (fullscreen ? exit() : enter());
  };

  const duration = player.duration || info?.duration || 0;
  const buffered = player.bufferedPosition || 0;
  const thumbMedia = seekMedia(info, currentId);
  const subRef = useMemo(() => subRefOf(item), [item]);
  const subs = useSubtitles(subRef, duration, subsOn);
  useEffect(() => {
    if (visible && subsOn && subs.tracks.length > 0) {
      silenceNativeCaptions(player);
    }
  }, [visible, subsOn, subs.tracks.length, player, currentId, phase]);
  const tickSubs = subs.tick;
  useEffect(() => {
    tickSubs(position);
  }, [position, tickSubs]);
  live.current = { pos: position, buf: buffered, playing: isPlaying };

  useEffect(() => {
    lastAdvance.current = Date.now();
  }, [position]);

  useEffect(() => {
    if (!seeking) return;
    if (Math.abs(position - seekTarget.current) < 2.5) {
      setSeeking(false);
    }
  }, [position, seeking]);

  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      const snap = live.current;
      const hungry = snap.buf - snap.pos < 3;
      const stuck =
        snap.playing && Date.now() - lastAdvance.current > 1500 && hungry;
      setStalled((prev) => {
        if (prev !== stuck) {
          if (stuck)
            log(
              'Player',
              `stall at ${Math.round(snap.pos)}s (buffered ${Math.round(snap.buf)}s)`
            );
          else log('Player', `stall cleared at ${Math.round(snap.pos)}s`);
        }
        return stuck;
      });
    }, 500);
    return () => clearInterval(timer);
  }, [visible]);
  const videoH = landscape ? height : (width * 9) / 16;

  return (
    <View
      style={[
        tw`absolute inset-0 bg-black`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      <View
        style={
          landscape ? tw`flex-1` : [tw`flex-1`, { paddingTop: insets.top }]
        }
      >
        <GestureDetector gesture={brightGesture}>
          <View style={{ height: videoH }}>
            <VideoStage
              player={player}
              phase={phase}
              poster={item?.poster}
              fault={fault}
              title={info?.title ?? item?.title ?? ''}
              quality={
                info?.formats.find((format) => format.formatId === currentId)
                  ?.quality ?? ''
              }
              canQuality={(info?.formats.length ?? 0) > 1}
              fullscreen={fullscreen}
              isPlaying={isPlaying}
              position={position}
              duration={duration}
              buffered={buffered}
              flash={flash}
              seekMark={seekMark}
              controls={controls}
              loading={seeking}
              cacheKey={previewKey(item, currentId)}
              media={thumbMedia}
              top={landscape ? insets.top : 0}
              onOpen={() => {
                if (item) void open(item.kind, item.id);
              }}
              onBack={() => {
                tapSelection();
                handleClose();
              }}
              onQuality={() => {
                tapSelection();
                setQualityOpen(true);
              }}
              onFullscreen={toggleFullscreen}
              onToggle={toggle}
              onSeek={(fraction) => {
                player.currentTime = fraction * duration;
                seekTarget.current = fraction * duration;
                setSeeking(true);
                if (seekTimer.current) clearTimeout(seekTimer.current);
                seekTimer.current = setTimeout(() => setSeeking(false), 10000);
                poke();
              }}
            onInteract={poke}
            onZoneTap={handleTap}
            subsOn={subsOn}
            canSubs={subs.tracks.length > 0}
            onToggleSubs={() => {
              tapSelection();
              setSubsOn((on) => !on);
              poke();
            }}
          />
          <StallSpinner show={stalled && phase === 'ready'} />
          <CaptionLayer
            show={subsOn}
            line={subs.line}
            bottom={captionBottom(landscape, controls)}
          />
          </View>
        </GestureDetector>

        {!landscape && (
          <PortraitPanel
            info={info}
            item={item}
            currentId={currentId}
            upNext={upNext.filter(
              (entry) =>
                !item || entry.id !== item.id || entry.kind !== item.kind
            )}
            onDownload={downloadCurrent}
            onSelect={onSelect}
            downloading={downloading}
          />
        )}
      </View>

      <QualityMenu
        open={qualityOpen}
        formats={info?.formats ?? []}
        currentId={currentId}
        onPick={(format) => void switchQuality(format)}
        onClose={() => setQualityOpen(false)}
      />
    </View>
  );
}
