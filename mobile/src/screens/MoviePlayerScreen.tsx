import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  StatusBar,
  Animated as RNAnimated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import {
  VideoView,
  type VideoPlayer,
  type SubtitleTrack as NativeSubtitleTrack,
} from 'expo-video';
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
  SlidersHorizontal,
  ChevronRight,
  Gauge,
  Minus,
  Plus,
  Sparkles,
} from 'lucide-react-native';
import tw from '../lib/tw';
import { Play3Icon, CcOutlineIcon, CcFilledIcon } from '../components/icons';
import { useBackHandler } from '../lib/back';
import { useMoviePlayer } from '../hooks/useMoviePlayer';
import { useFullscreenLock } from '../hooks/useFullscreenLock';
import { useBrightnessSwipe } from '../hooks/useBrightnessSwipe';
import { useSeekPreview, type SeekMedia } from '../hooks/useSeekPreview';
import { useSubtitles } from '../hooks/useSubtitles';
import { useDownload } from '../hooks/useDownload';
import { formatLabel, formatClock, formatSize } from '../lib/format';
import {
  pickTrack,
  alignCuesToSpeech,
  speechOfWords,
  splitLongCues,
  splitLongText,
  wordsToCues,
  type SubtitleTrack,
  type SubtitleCue,
} from '../lib/subtitles';
import { extractAudioSample } from '../lib/download/mux';
import { translateLines } from '../lib/translate';
import {
  transcribeFile as transcribeDeepgram,
  type TranscriptResult,
} from '../lib/deepgram';
import { transcribeFile as transcribeGroq } from '../lib/groq';
import {
  getDeepgramKey,
  getGroqKey,
  getTranscriber,
  setTranscriber,
  getTranscribeLang,
  setTranscribeLang,
  getSubLang,
  setSubLang,
  type TranscriberChoice,
  type TranscribeLang,
  type SubLang,
} from '../lib/settings';
import { File, Paths } from 'expo-file-system';
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
  requestedAt: number;
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
  subsOn,
  canSubs,
  onToggleSubs,
}: {
  title: string;
  quality: string;
  canQuality: boolean;
  fullscreen: boolean;
  onBack: () => void;
  onQuality: () => void;
  onFullscreen: () => void;
  top: number;
  subsOn: boolean;
  canSubs: boolean;
  onToggleSubs: () => void;
}) {
  return (
    <View>
      <View
        style={[tw`flex-row items-center gap-3 px-4`, { paddingTop: top + 8 }]}
      >
        <Pressable
          onPress={onBack}
          style={tw`p-2.5`}
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
        <Pressable
          onPress={onToggleSubs}
          disabled={!canSubs}
          style={tw`p-2.5 ${canSubs ? '' : 'opacity-40'}`}
          accessibilityLabel={
            subsOn ? 'Turn subtitles off' : 'Turn subtitles on'
          }
        >
          {subsOn ? (
            <CcFilledIcon size={20} color="#ffffff" />
          ) : (
            <CcOutlineIcon size={20} color="#ffffff" />
          )}
        </Pressable>
        {canQuality && (
          <Pressable
            onPress={onQuality}
            style={tw`p-2.5`}
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

function formatDelay(delay: number): string {
  if (delay === 0) return '0s';
  return `${delay > 0 ? '+' : ''}${delay.toFixed(1)}s`;
}

function formatRate(rate: number): string {
  return `${rate.toFixed(2).replace(/0$/, '')}x`;
}

const SPEED_MIN = 0.25;
const SPEED_MAX = 2;

function SpeedSlider({
  value,
  onScrub,
  onCommit,
}: {
  value: number;
  onScrub: (rate: number) => void;
  onCommit: (rate: number) => void;
}) {
  const trackW = useRef(0);
  const scrubVal = useRef<number | null>(null);
  const frac =
    (Math.min(SPEED_MAX, Math.max(SPEED_MIN, value)) - SPEED_MIN) /
    (SPEED_MAX - SPEED_MIN);
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((event) => {
      if (trackW.current <= 0) return;
      const at = Math.max(0, Math.min(1, event.x / trackW.current));
      const next =
        Math.round((SPEED_MIN + at * (SPEED_MAX - SPEED_MIN)) * 20) / 20;
      scrubVal.current = next;
      onScrub(next);
    })
    .onEnd(() => {
      const done = scrubVal.current;
      scrubVal.current = null;
      if (done !== null) onCommit(done);
    });
  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={(event) => {
          trackW.current = event.nativeEvent.layout.width;
        }}
        style={tw`h-8 flex-1 justify-center`}
      >
        <View style={tw`h-1 overflow-hidden rounded-full bg-white/25`}>
          <View
            style={[
              tw`absolute inset-y-0 left-0 bg-white`,
              { width: `${frac * 100}%` },
            ]}
          />
        </View>
        <View
          style={[
            tw`absolute h-4 w-4 rounded-full bg-white`,
            { left: `${frac * 100}%`, marginLeft: -8, top: 8 },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

function MenuBack({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={tw`flex-row items-center`}>
      <Pressable
        onPress={onBack}
        style={tw`flex-1 flex-row items-center gap-2 px-3 py-3`}
        accessibilityLabel="Back to settings"
      >
        <ArrowLeft size={18} color="#ffffff" />
        <Text style={tw`font-sans-bold text-[15px] text-white`}>{title}</Text>
      </Pressable>
      {right !== undefined && <View style={tw`pr-3`}>{right}</View>}
    </View>
  );
}

function MenuRow({
  icon,
  label,
  value,
  disabled,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={tw`flex-row items-center gap-3 px-3 py-3 ${disabled ? 'opacity-40' : ''}`}
      accessibilityLabel={label}
    >
      {icon}
      <Text style={tw`flex-1 font-sans-medium text-[15px] text-white`}>
        {label}
      </Text>
      {value !== '' && (
        <Text style={tw`font-mono text-[13px] text-slate-400`}>{value}</Text>
      )}
      <ChevronRight size={18} color="#94a3b8" />
    </Pressable>
  );
}

function QualityMenu({
  open,
  formats,
  currentId,
  subsOn,
  subsLabel,
  subTracks,
  embedTracks,
  embedSel,
  rate,
  subDelay,
  transcriber,
  transLang,
  onPick,
  onPickSub,
  onPickEmbed,
  onPickRate,
  onDelay,
  onAutoSync,
  onTranscriber,
  onTransLang,
  subLang,
  onSubLang,
  full,
  onStopFull,
  onClose,
}: {
  open: boolean;
  formats: Format[];
  currentId: string | null;
  subsOn: boolean;
  subsLabel: string | null;
  subTracks: SubtitleTrack[];
  embedTracks: NativeSubtitleTrack[];
  embedSel: NativeSubtitleTrack | null;
  rate: number;
  subDelay: number;
  transcriber: TranscriberChoice;
  transLang: TranscribeLang;
  subLang: SubLang;
  full: { done: number; total: number } | null;
  onPick: (format: Format) => void;
  onPickSub: (track: SubtitleTrack | null) => void;
  onPickEmbed: (track: NativeSubtitleTrack) => void;
  onPickRate: (rate: number) => void;
  onDelay: (delay: number) => void;
  onAutoSync: (
    onPhase?: (phase: 'listen' | 'cloud') => void
  ) => Promise<number | null>;
  onTranscriber: (value: TranscriberChoice) => void;
  onTransLang: (value: TranscribeLang) => void;
  onSubLang: (value: SubLang) => void;
  onStopFull: () => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<'main' | 'quality' | 'subs' | 'speed'>(
    'main'
  );
  const [preview, setPreview] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncPhase, setSyncPhase] = useState<'listen' | 'cloud'>('listen');
  const [syncError, setSyncError] = useState<string | null>(null);
  const current = formats.find((format) => format.formatId === currentId);
  const qualityLabel = current ? formatLabel(current) : '';
  const activeSubLabel = subsOn
    ? (subsLabel ??
      pickTrack(subTracks, 'en')?.label ??
      subTracks[0]?.label ??
      null)
    : null;
  const speedNormal = Math.abs(rate - 1) < 0.001;
  const shownRate = preview ?? rate;
  const sheetY = useRef(new RNAnimated.Value(height)).current;
  const bgOpacity = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!open) return;
    sheetY.setValue(height);
    bgOpacity.setValue(0);
    RNAnimated.parallel([
      RNAnimated.timing(sheetY, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      RNAnimated.timing(bgOpacity, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, bgOpacity, height, sheetY]);

  const closeSheet = useCallback(() => {
    RNAnimated.parallel([
      RNAnimated.timing(sheetY, {
        toValue: height,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      RNAnimated.timing(bgOpacity, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setView('main');
      setPreview(null);
      onClose();
    });
  }, [bgOpacity, height, onClose, sheetY]);

  return (
    <View pointerEvents={open ? 'auto' : 'none'} style={tw`absolute inset-0`}>
      <View
        style={[
          tw`flex-1 justify-end px-4`,
          { paddingBottom: 20 + insets.bottom },
        ]}
      >
        <Pressable style={tw`absolute inset-0`} onPress={closeSheet}>
          <RNAnimated.View
            style={[tw`flex-1 bg-black/60`, { opacity: bgOpacity }]}
          />
        </Pressable>
        <RNAnimated.View
          pointerEvents="box-none"
          style={[tw`justify-end`, { transform: [{ translateY: sheetY }] }]}
        >
          <Animated.View
            style={[
              tw`justify-end overflow-hidden rounded-[28px] bg-[#1E1E1E]`,
              { alignSelf: 'center', width: '100%', maxWidth: 480 },
            ]}
          >
            <View style={tw`px-4 pb-4 pt-3`}>
              <View
                style={tw`mx-auto mb-3 h-1 w-10 rounded-full bg-white/15`}
              />
              {view === 'main' ? (
                <>
                  <MenuRow
                    icon={<SlidersHorizontal size={20} color="#ffffff" />}
                    label="Quality"
                    value={qualityLabel}
                    onPress={() => {
                      tapSelection();
                      setView('quality');
                    }}
                  />
                  <MenuRow
                    icon={<Captions size={20} color="#ffffff" />}
                    label="Subtitles"
                    value={
                      embedSel
                        ? embedSel.label
                        : subsOn
                          ? (activeSubLabel ?? 'On')
                          : 'Off'
                    }
                    onPress={() => {
                      tapSelection();
                      setView('subs');
                    }}
                  />
                  <MenuRow
                    icon={<Gauge size={20} color="#ffffff" />}
                    label="Playback speed"
                    value={formatRate(rate)}
                    onPress={() => {
                      tapSelection();
                      setView('speed');
                    }}
                  />
                </>
              ) : view === 'quality' ? (
                <>
                  <MenuBack title="Quality" onBack={() => setView('main')} />
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
                </>
              ) : view === 'subs' ? (
                <>
                  <MenuBack title="Subtitles" onBack={() => setView('main')} />
                  {embedTracks.length > 0 && (
                    <Text
                      style={tw`px-3 pb-1 pt-2 font-mono text-[11px] text-slate-500`}
                    >
                      On this video
                    </Text>
                  )}
                  {embedTracks.map((track) => {
                    const active =
                      embedSel !== null &&
                      (embedSel.id ?? embedSel.label) ===
                        (track.id ?? track.label);
                    return (
                      <Pressable
                        key={track.id ?? track.label}
                        onPress={() => {
                          tapSelection();
                          onPickEmbed(track);
                          closeSheet();
                        }}
                        style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
                      >
                        <Text
                          style={tw`font-mono-semibold text-[14px] ${active ? 'text-white' : 'text-slate-300'}`}
                        >
                          {track.label}
                        </Text>
                        {active && <Check size={18} color="#22d3ee" />}
                      </Pressable>
                    );
                  })}
                  {embedTracks.length > 0 && (
                    <Text
                      style={tw`px-3 pb-1 pt-2 font-mono text-[11px] text-slate-500`}
                    >
                      More subtitles
                    </Text>
                  )}
                  <Pressable
                    onPress={() => {
                      tapSelection();
                      onPickSub(null);
                      closeSheet();
                    }}
                    style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${!subsOn ? 'bg-white/10' : ''}`}
                  >
                    <Text
                      style={tw`font-mono-semibold text-[14px] ${!subsOn ? 'text-white' : 'text-slate-300'}`}
                    >
                      Off
                    </Text>
                    {!subsOn && <Check size={18} color="#22d3ee" />}
                  </Pressable>
                  {subTracks.map((track) => {
                    const active = subsOn && track.label === activeSubLabel;
                    return (
                      <Pressable
                        key={track.url}
                        onPress={() => {
                          tapSelection();
                          onPickSub(track);
                          closeSheet();
                        }}
                        style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
                      >
                        <Text
                          style={tw`font-mono-semibold text-[14px] ${active ? 'text-white' : 'text-slate-300'}`}
                        >
                          {track.label}
                        </Text>
                        {active && <Check size={18} color="#22d3ee" />}
                      </Pressable>
                    );
                  })}
                  <Text
                    style={tw`px-3 pb-1 pt-2 font-mono text-[11px] text-slate-500`}
                  >
                    AI voice
                  </Text>
                  {(['deepgram', 'groq'] as const).map((choice) => {
                    const active = transcriber === choice;
                    return (
                      <Pressable
                        key={choice}
                        onPress={() => {
                          tapSelection();
                          onTranscriber(choice);
                        }}
                        style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
                      >
                        <Text
                          style={tw`font-mono-semibold text-[14px] capitalize ${active ? 'text-white' : 'text-slate-300'}`}
                        >
                          {choice}
                        </Text>
                        {active && <Check size={18} color="#22d3ee" />}
                      </Pressable>
                    );
                  })}
                  <Text
                    style={tw`px-3 pb-1 pt-2 font-mono text-[11px] text-slate-500`}
                  >
                    AI language
                  </Text>
                  {(
                    [
                      ['auto', 'Auto'],
                      ['en', 'English'],
                      ['ko', 'Korean'],
                      ['ja', 'Japanese'],
                    ] as const
                  ).map(([choice, title]) => {
                    const active = transLang === choice;
                    return (
                      <Pressable
                        key={choice}
                        onPress={() => {
                          tapSelection();
                          onTransLang(choice);
                        }}
                        style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
                      >
                        <Text
                          style={tw`font-mono-semibold text-[14px] ${active ? 'text-white' : 'text-slate-300'}`}
                        >
                          {title}
                        </Text>
                        {active && <Check size={18} color="#22d3ee" />}
                      </Pressable>
                    );
                  })}
                  <Text
                    style={tw`px-3 pb-1 pt-2 font-mono text-[11px] text-slate-500`}
                  >
                    Subtitles in
                  </Text>
                  {(['same', 'en'] as const).map((choice) => {
                    const active = subLang === choice;
                    return (
                      <Pressable
                        key={choice}
                        onPress={() => {
                          tapSelection();
                          onSubLang(choice);
                        }}
                        style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
                      >
                        <Text
                          style={tw`font-mono-semibold text-[14px] ${active ? 'text-white' : 'text-slate-300'}`}
                        >
                          {choice === 'en' ? 'English' : 'Same as audio'}
                        </Text>
                        {active && <Check size={18} color="#22d3ee" />}
                      </Pressable>
                    );
                  })}
                  <View
                    style={tw`flex-row items-center justify-between px-3 py-2`}
                  >
                    <Text
                      style={tw`font-mono-semibold text-[14px] text-slate-300`}
                    >
                      Sync
                    </Text>
                    <View style={tw`flex-row items-center gap-2`}>
                      <Pressable
                        onPress={() => {
                          tapSelection();
                          onDelay(
                            Math.max(
                              -10,
                              Math.round((subDelay - 0.5) * 10) / 10
                            )
                          );
                        }}
                        style={tw`h-9 w-9 items-center justify-center rounded-full bg-white/10`}
                        accessibilityLabel="Delay subtitles"
                      >
                        <Minus size={16} color="#ffffff" />
                      </Pressable>
                      <Text
                        style={tw`w-12 text-center font-mono text-[13px] text-white`}
                      >
                        {formatDelay(subDelay)}
                      </Text>
                      <Pressable
                        onPress={() => {
                          tapSelection();
                          onDelay(
                            Math.min(10, Math.round((subDelay + 0.5) * 10) / 10)
                          );
                        }}
                        style={tw`h-9 w-9 items-center justify-center rounded-full bg-white/10`}
                        accessibilityLabel="Advance subtitles"
                      >
                        <Plus size={16} color="#ffffff" />
                      </Pressable>
                    </View>
                  </View>
                  {syncing ? (
                    <View
                      style={tw`mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-3`}
                    >
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={tw`font-sans-medium text-[14px] text-white`}>
                        {syncPhase === 'cloud' ? 'Transcribing…' : 'Listening…'}
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        tapSelection();
                        setSyncPhase('listen');
                        setSyncing(true);
                        setSyncError(null);
                        void onAutoSync(setSyncPhase).then((offset) => {
                          setSyncing(false);
                          if (offset === null) {
                            setSyncError('Could not sync — try manual');
                            return;
                          }
                          onDelay(offset);
                          closeSheet();
                        });
                      }}
                      style={tw`mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-3`}
                      accessibilityLabel="Auto-sync subtitles"
                    >
                      <Sparkles size={16} color="#ffffff" />
                      <Text style={tw`font-sans-medium text-[14px] text-white`}>
                        Auto-sync
                      </Text>
                    </Pressable>
                  )}
                  {syncError && (
                    <Text
                      style={tw`px-3 pb-1 text-center font-mono text-[11px] text-red-400`}
                    >
                      {syncError}
                    </Text>
                  )}
                  {full && (
                    <View
                      style={tw`mt-1 flex-row items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-3`}
                    >
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={tw`font-sans-medium text-[14px] text-white`}>
                        {`Transcribing ${full.done}/${full.total}…`}
                      </Text>
                      <Pressable
                        onPress={() => {
                          tapSelection();
                          onStopFull();
                        }}
                        style={tw`ml-2 rounded-full bg-white/10 px-3 py-1.5`}
                        accessibilityLabel="Cancel full transcription"
                      >
                        <Text style={tw`font-sans-semibold text-[13px] text-white`}>
                          Stop
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <MenuBack
                    title="Playback speed"
                    onBack={() => {
                      setPreview(null);
                      setView('main');
                    }}
                    right={
                      <Pressable
                        onPress={() => {
                          tapSelection();
                          onPickRate(1);
                        }}
                        disabled={speedNormal}
                        style={tw`${speedNormal ? 'opacity-30' : ''}`}
                        accessibilityLabel="Reset speed to normal"
                      >
                        <RotateCcw size={18} color="#ffffff" />
                      </Pressable>
                    }
                  />
                  <Text
                    style={tw`text-center font-sans-bold text-[22px] text-white`}
                  >
                    {formatRate(shownRate)}
                  </Text>
                  <View style={tw`flex-row items-center gap-3 px-1 py-1`}>
                    <Pressable
                      onPress={() => {
                        tapSelection();
                        onPickRate(rate - 0.25);
                      }}
                      style={tw`h-11 w-11 items-center justify-center rounded-full bg-white/10`}
                      accessibilityLabel="Slower"
                    >
                      <Minus size={20} color="#ffffff" />
                    </Pressable>
                    <SpeedSlider
                      value={shownRate}
                      onScrub={setPreview}
                      onCommit={(done) => {
                        setPreview(null);
                        onPickRate(done);
                      }}
                    />
                    <Pressable
                      onPress={() => {
                        tapSelection();
                        onPickRate(rate + 0.25);
                      }}
                      style={tw`h-11 w-11 items-center justify-center rounded-full bg-white/10`}
                      accessibilityLabel="Faster"
                    >
                      <Plus size={20} color="#ffffff" />
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </Animated.View>
        </RNAnimated.View>
      </View>
    </View>
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
      <View style={tw`absolute inset-0 bg-black/40`} pointerEvents="none" />
      <PlayerTopBar
        title={title}
        quality={quality}
        canQuality={canQuality}
        fullscreen={fullscreen}
        top={top}
        onBack={onBack}
        onQuality={onQuality}
        onFullscreen={onFullscreen}
        subsOn={subsOn}
        canSubs={canSubs}
        onToggleSubs={onToggleSubs}
      />
      <CenterButton
        isPlaying={isPlaying}
        loading={loading}
        onToggle={onToggle}
      />
      <View style={tw`absolute inset-x-0 bottom-0`}>
        <View style={tw`px-4 pb-2`}>
          <View style={tw`mb-1 flex-row items-center justify-between`}>
            <Text style={tw`font-mono text-[11px] text-slate-200`}>
              {formatClock(position)} / {formatClock(duration)}
            </Text>
            <View style={tw`flex-row items-center gap-2`}>
              <Pressable
                onPress={onFullscreen}
                style={tw`p-2.5`}
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

function useTapToPlay(
  visible: boolean,
  isPlaying: boolean,
  requestedAt: number,
  itemKey: string
): void {
  const state = useRef({ key: '', logged: false });
  useEffect(() => {
    const key = `${visible}-${itemKey}`;
    if (key !== state.current.key) {
      state.current = { key, logged: false };
    }
    if (visible && isPlaying && requestedAt > 0 && !state.current.logged) {
      state.current.logged = true;
      log(
        'Player',
        `tap to playing ${((Date.now() - requestedAt) / 1000).toFixed(1)}s (${itemKey})`
      );
    }
  }, [visible, isPlaying, requestedAt, itemKey]);
}

function itemKeyOf(item: MovieItem | null): string {
  const kind = item?.kind ?? 'movie';
  const id = item?.id ?? 'none';
  const season = item?.season ?? '1';
  const episode = item?.episode ?? '1';
  return `${kind}/${id}/${season}/${episode}`;
}

function embedList(
  event: { availableSubtitleTracks?: NativeSubtitleTrack[] | null } | null
): NativeSubtitleTrack[] {
  return event?.availableSubtitleTracks ?? [];
}

type TranscribeFn = (
  fsPath: string,
  mime: string,
  apiKey: string,
  lang: TranscribeLang
) => Promise<TranscriptResult>;

function shiftTimes(result: TranscriptResult, offsetSec: number): TranscriptResult {
  if (offsetSec <= 0) return result;
  const shift = <T extends { start: number; end: number }>(entry: T): T => ({
    ...entry,
    start: entry.start + offsetSec,
    end: entry.end + offsetSec,
  });
  return { words: result.words.map(shift), cues: result.cues.map(shift), lang: result.lang };
}

async function resolveTranscriber(): Promise<{
  provider: TranscriberChoice;
  apiKey: string;
  transcribe: TranscribeFn;
  lang: TranscribeLang;
} | null> {
  const choice = await getTranscriber().catch(
    (): TranscriberChoice => 'deepgram'
  );
  const stored: Record<TranscriberChoice, string> = {
    deepgram: await getDeepgramKey().catch(() => ''),
    groq: await getGroqKey().catch(() => ''),
  };
  const apiKey = stored[choice];
  if (!apiKey) {
    log('Player', `cc skipped (save your ${choice} key in settings)`);
    return null;
  }
  return {
    provider: choice,
    apiKey,
    transcribe: choice === 'groq' ? transcribeGroq : transcribeDeepgram,
    lang: await getTranscribeLang().catch((): TranscribeLang => 'auto'),
  };
}

function generatedLabel(provider: TranscriberChoice): string {
  return provider === 'groq' ? 'AI subs (Groq)' : 'AI subs (Deepgram)';
}

function shapeTranscript(transcript: TranscriptResult): SubtitleCue[] {
  const base =
    transcript.cues.length > 0 ? transcript.cues : wordsToCues(transcript.words);
  return shiftEarly(splitLongCues(base, transcript.words));
}

function shiftEarly(cues: SubtitleCue[]): SubtitleCue[] {
  // temp dev: show lines a beat early, whisper starts lag speech
  return cues.map((cue) => {
    const start = Math.max(0, Math.round((cue.start - 0.5) * 10) / 10);
    return { ...cue, start, end: Math.max(cue.end - 0.5, start + 0.1) };
  });
}

async function shapeFinal(
  transcript: TranscriptResult,
  provider: TranscriberChoice,
  subLang: SubLang
): Promise<{ cues: SubtitleCue[]; label: string }> {
  const base =
    transcript.cues.length > 0 ? transcript.cues : wordsToCues(transcript.words);
  if (subLang === 'en' && transcript.lang !== 'en') {
    const key = await getGroqKey().catch(() => '');
    if (!key) {
      log('Player', 'cc translate skipped (no groq key)');
    } else {
      const lines = await translateLines(
        base.map((cue) => cue.text),
        transcript.lang || 'auto',
        key
      );
      if (lines) {
        const translated = base.map((cue, i) => ({ ...cue, text: lines[i] ?? cue.text }));
        log('Player', `cc translated to english lines=${lines.length}`);
        return {
          cues: shiftEarly(translated.flatMap((cue) => splitLongText(cue))),
          label: 'AI subs EN',
        };
      }
    }
  }
  return { cues: shapeTranscript(transcript), label: generatedLabel(provider) };
}

async function transcribeSample(
  url: string,
  headers: Record<string, string>,
  windowSec: number,
  apiKey: string,
  transcribe: TranscribeFn,
  provider: TranscriberChoice,
  lang: TranscribeLang,
  offsetSec = 0
): Promise<TranscriptResult | null> {
  const audio = new File(Paths.cache, `sync-${Date.now()}.mp3`);
  try {
    const path = await extractAudioSample(url, headers, audio, windowSec, offsetSec);
    const bytes = audio.size ?? 0;
    log('Player', `cloud-sync via ${provider}: sample bytes=${bytes} offset=${offsetSec}s`);
    if (!path || bytes < 50_000) {
      log('Player', `cloud-sync via ${provider}: extract failed`);
      return null;
    }
    try {
      const head = (audio as unknown as { bytesSync(): Uint8Array }).bytesSync().slice(0, 16);
      log(
        'Player',
        `cloud-sync head=${Array.from(head, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
      );
    } catch (err) {
      log('Player', `cloud-sync head unreadable: ${String(err)}`);
    }
    const result = await transcribe(audio.uri, 'audio/mpeg', apiKey, lang);
    if (result.words.length < 5 && lang !== 'auto') {
      log('Player', `cloud-sync via ${provider}: only ${result.words.length} words, retrying auto-detect`);
      const retry = await transcribe(audio.uri, 'audio/mpeg', apiKey, 'auto').catch(
        (): TranscriptResult | null => null
      );
      if (retry && retry.words.length > result.words.length) {
        log('Player', `cloud-sync via ${provider}: auto-detect heard ${retry.words.length} words`);
        return shiftTimes(retry, offsetSec);
      }
    }
    if (offsetSec <= 0) return result;
    return shiftTimes(result, offsetSec);
  } finally {
    try {
      await audio.delete();
    } catch {
      /* best effort cleanup */
    }
  }
}

async function cloudSyncOffset(
  url: string,
  headers: Record<string, string>,
  windowSec: number,
  apiKey: string,
  transcribe: TranscribeFn,
  provider: TranscriberChoice,
  lang: TranscribeLang,
  cues: SubtitleCue[]
): Promise<number | null> {
  const transcript = await transcribeSample(
    url,
    headers,
    windowSec,
    apiKey,
    transcribe,
    provider,
    lang
  );
  if (!transcript || (transcript.words.length === 0 && transcript.cues.length === 0)) return null;
  {
    const segs = speechOfWords(transcript.words);
    const horizon = windowSec + 60;
    const range = cues.filter((cue) => cue.start < horizon);
    log(
      'Player',
      `cloud-sync via ${provider}: segs=${segs.length} cuesInRange=${range.length}`
    );
    const result = alignCuesToSpeech(range, segs, horizon, (dbg) => {
      const peaks = dbg.top
        .map((peak) => `${peak.offset}s:${peak.score.toFixed(3)}`)
        .join(' ');
      log(
        'Player',
        `cloud-sync best=${dbg.best}s score=${dbg.bestScore.toFixed(3)} zero=${dbg.zero.toFixed(3)} top=${peaks}`
      );
    });
    if (!result) {
      log('Player', 'cloud-sync align found no offset');
      return null;
    }
    log(
      'Player',
      `cloud-sync offset ${result.offset}s confidence ${result.confidence.toFixed(2)}`
    );
    return result.offset;
  }
}

function captionState(
  subsOn: boolean,
  embedOn: boolean,
  _downloaded: number,
  _embedded: number
): { icon: boolean; overlay: boolean; can: boolean } {
  return {
    icon: subsOn || embedOn,
    overlay: subsOn && !embedOn,
    // temp dev: cc always enabled, deepgram generates when providers give nothing
    can: true,
  };
}

function hashableMediaUrl(
  info: VideoInfo | null,
  currentId: string | null
): string | null {
  const current = info?.formats.find((format) => format.formatId === currentId);
  if (!current || current.isHls || !current.url) return null;
  return current.url;
}

function previewKey(item: MovieItem | null, currentId: string | null): string {
  const kind = item?.kind ?? 'movie';
  const id = item?.id ?? 'none';
  const ep =
    item?.kind === 'tv' ? `/s${item.season ?? '1'}e${item.episode ?? '1'}` : '';
  return `${kind}/${id}${ep}/${currentId ?? 'none'}`;
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
    ? {
        kind: 'tv',
        tmdbId: item.id,
        season: item.season ?? '1',
        episode: item.episode ?? '1',
      }
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

function portraitTopPad(top: number): number {
  return Math.max(top, StatusBar.currentHeight ?? 0);
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
  requestedAt,
  onSelect,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const itemKey = itemKeyOf(item);
  const {
    player,
    phase,
    info,
    currentId,
    fault,
    rate,
    setRate,
    isPlaying,
    position,
    open,
    close,
    switchQuality,
  } = useMoviePlayer();
  const subsAvailEvent = useEvent(
    player,
    'availableSubtitleTracksChange',
    null
  );
  const embedTracks = embedList(subsAvailEvent);
  useTapToPlay(visible, isPlaying, requestedAt, itemKey);
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
  const [transcriber, setTranscriberChoice] =
    useState<TranscriberChoice>('deepgram');
  const [transLang, setTransLang] = useState<TranscribeLang>('auto');
  const [subLang, setSubLangChoice] = useState<SubLang>('same');
  const [fullProg, setFullProg] = useState<{ done: number; total: number } | null>(null);
  const fullAbort = useRef<AbortController | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const [embedSel, setEmbedSel] = useState<NativeSubtitleTrack | null>(null);
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
    if (qualityOpen) {
      setQualityOpen(false);
      return true;
    }
    if (fullscreen) {
      void exit();
      return true;
    }
    onClose();
    return true;
  }, 20);

  useEffect(() => {
    if (!visible || !item) return;
    setSubDelay(0);
    setEmbedSel(null);
    getTranscriber()
      .then(setTranscriberChoice)
      .catch(() => undefined);
    getTranscribeLang()
      .then(setTransLang)
      .catch(() => undefined);
    getSubLang()
      .then(setSubLangChoice)
      .catch(() => undefined);
    void open(item.kind, item.id, item.season, item.episode);
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

  const pickSub = useCallback(
    (track: SubtitleTrack | null) => {
      tapSelection();
      setEmbedSel(null);
      setSubsOn(track !== null);
      poke();
    },
    [poke]
  );

  const duration = player.duration || info?.duration || 0;
  const buffered = player.bufferedPosition || 0;
  const thumbMedia = seekMedia(info, currentId);
  const subRef = useMemo(() => subRefOf(item), [item]);
  const subs = useSubtitles(
    subRef,
    duration,
    subsOn,
    hashableMediaUrl(info, currentId)
  );
  const caps = captionState(
    subsOn,
    embedSel !== null,
    subs.tracks.length,
    embedTracks.length
  );
  useEffect(() => {
    if (visible && subsOn && !embedSel && subs.tracks.length > 0) {
      silenceNativeCaptions(player);
    }
  }, [visible, subsOn, subs.tracks.length, player, currentId, phase, embedSel]);
  useEffect(() => {
    if (!visible) return;
    try {
      player.subtitleTrack = embedSel;
    } catch {
      /* builds without the subtitle api */
    }
  }, [visible, player, embedSel]);
  const tickSubs = subs.tick;
  const autoSyncSubs = useCallback(
    async (
      onPhase?: (phase: 'listen' | 'cloud') => void
    ): Promise<number | null> => {
      const cues = subs.getCues();
      const current = info?.formats.find(
        (format) => format.formatId === currentId
      );
      const url = current?.url;
      if (!url) return null;
      const headers = info?.downloadHeaders ?? {};
      const window = Math.min(600, Math.max(60, Math.floor(duration)));
      // temp dev: chosen cloud transcriber only, providers off. restore before ship
      const resolved = await resolveTranscriber();
      if (!resolved) return null;
      const { provider, apiKey, transcribe, lang } = resolved;
      onPhase?.('cloud');
      const cloudWindow = Math.min(300, window);
      if (cues.length > 0) {
        return cloudSyncOffset(
          url,
          headers,
          cloudWindow,
          apiKey,
          transcribe,
          provider,
          lang,
          cues
        ).catch(() => null);
      }
      const transcript = await transcribeSample(
        url,
        headers,
        cloudWindow,
        apiKey,
        transcribe,
        provider,
        lang
      );
      if (!transcript || (transcript.words.length === 0 && transcript.cues.length === 0)) {
        log('Player', `cc generate via ${provider} failed`);
        return null;
      }
      log('Player', `cc cues via ${provider}: utterances=${transcript.cues.length}`);
      const subLang = await getSubLang().catch((): SubLang => 'same');
      const shaped = await shapeFinal(transcript, provider, subLang);
      subs.setGeneratedCues(shaped.cues, shaped.label);
      setSubsOn(true);
      log('Player', `cc generated via ${provider} cues=${shaped.cues.length}`);
      return 0;
    },
    [subs, info, currentId, duration]
  );
  const transcribeFull = useCallback(
    async (
      onTick?: (done: number, total: number) => void,
      signal?: AbortSignal
    ): Promise<boolean> => {
      const current = info?.formats.find(
        (format) => format.formatId === currentId
      );
      const url = current?.url;
      if (!url || duration <= 0) return false;
      const resolved = await resolveTranscriber();
      if (!resolved) return false;
      const { provider, apiKey, transcribe, lang } = resolved;
      const subLang = await getSubLang().catch((): SubLang => 'same');
      const headers = info?.downloadHeaders ?? {};
      const chunk = 300;
      const total = Math.ceil(duration / chunk);
      log(
        'Player',
        `full transcribe via ${provider}/${lang}: ${total} chunks ~${Math.round(duration / 60)}min audio`
      );
      let all: SubtitleCue[] = [];
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) {
          log('Player', `full transcribe cancelled at ${i}/${total}`);
          return false;
        }
        const offset = i * chunk;
        const transcript = await transcribeSample(
          url,
          headers,
          chunk,
          apiKey,
          transcribe,
          provider,
          lang,
          offset
        ).catch(() => null);
        if (transcript && (transcript.words.length > 0 || transcript.cues.length > 0)) {
          const shaped = await shapeFinal(transcript, provider, subLang);
          all = [...all, ...shaped.cues].sort(
            (lhs, rhs) => lhs.start - rhs.start
          );
          subs.setGeneratedCues(all, shaped.label);
          setSubsOn(true);
        } else {
          log('Player', `full transcribe chunk ${i + 1}/${total} failed`);
        }
        onTick?.(i + 1, total);
      }
      log('Player', `full transcribe done cues=${all.length}`);
      return true;
    },
    [subs, info, currentId, duration]
  );
  const startFull = useCallback((): void => {
    if (fullAbort.current) {
      log('Player', 'full transcribe already running');
      return;
    }
    const controller = new AbortController();
    fullAbort.current = controller;
    setFullProg({ done: 0, total: 0 });
    void transcribeFull(
      (done, total) => setFullProg({ done, total }),
      controller.signal
    ).then(() => {
      setFullProg(null);
      fullAbort.current = null;
    });
  }, [transcribeFull]);
  const stopFull = useCallback((): void => {
    fullAbort.current?.abort();
  }, []);
  useEffect(() => {
    tickSubs(position - subDelay);
  }, [position, tickSubs, subDelay]);
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
  const expanded = fullscreen;
  const portraitH = (Math.min(width, height) * 9) / 16;
  const portraitTop = portraitTopPad(insets.top);

  return (
    <View
      style={[
        tw`absolute inset-0 bg-black`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      <View
        style={
          expanded ? tw`flex-1` : [tw`flex-1`, { paddingTop: portraitTop }]
        }
      >
        <GestureDetector gesture={brightGesture}>
          <View style={expanded ? tw`flex-1` : { height: portraitH }}>
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
              top={expanded ? insets.top : 0}
              onOpen={() => {
                if (item)
                  void open(item.kind, item.id, item.season, item.episode);
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
              subsOn={caps.icon}
              canSubs={caps.can}
              onToggleSubs={() => {
                tapSelection();
                if (embedSel) setEmbedSel(null);
                setSubsOn(true);
                poke();
                // temp dev: cc tap = full cloud transcribe. restore toggle before ship
                startFull();
              }}
            />
            <StallSpinner show={stalled && phase === 'ready'} />
            <CaptionLayer
              show={caps.overlay}
              line={subs.line}
              bottom={captionBottom(expanded, controls)}
            />
          </View>
        </GestureDetector>

        <View style={expanded ? { display: 'none' } : tw`flex-1`}>
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
        </View>
      </View>

      <QualityMenu
        open={qualityOpen}
        formats={info?.formats ?? []}
        currentId={currentId}
        subsOn={subsOn}
        subsLabel={subs.label}
        subTracks={subs.tracks}
        embedTracks={embedTracks}
        embedSel={embedSel}
        rate={rate}
        subDelay={subDelay}
        transcriber={transcriber}
        transLang={transLang}
        subLang={subLang}
        onPick={(format) => void switchQuality(format)}
        onPickSub={pickSub}
        onPickEmbed={setEmbedSel}
        onPickRate={setRate}
        onDelay={setSubDelay}
        onAutoSync={autoSyncSubs}
        onTranscriber={(value) => {
          tapSelection();
          setTranscriberChoice(value);
          void setTranscriber(value).catch(() => undefined);
        }}
        onTransLang={(value) => {
          tapSelection();
          setTransLang(value);
          void setTranscribeLang(value).catch(() => undefined);
        }}
        onSubLang={(value) => {
          tapSelection();
          setSubLangChoice(value);
          void setSubLang(value).catch(() => undefined);
        }}
        full={fullProg}
        onStopFull={stopFull}
        onClose={() => setQualityOpen(false)}
      />
    </View>
  );
}
