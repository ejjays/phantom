import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { VideoView } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  ArrowLeft,
  Play,
  Pause,
  Settings,
  RotateCcw,
  Check,
} from 'lucide-react-native';
import tw from '../lib/tw';
import { useBackHandler } from '../lib/back';
import { useMoviePlayer } from '../hooks/useMoviePlayer';
import { formatLabel, formatClock } from '../lib/format';
import { tapImpact, tapSelection } from '../lib/haptics';
import type { Format } from '@phantom/extractors';
import type { LunaItem } from '../extractors/watchluna/browse';

type Props = {
  visible: boolean;
  item: LunaItem | null;
  onClose: () => void;
};

function SeekBar({
  position,
  duration,
  buffered,
  onSeek,
}: {
  position: number;
  duration: number;
  buffered: number;
  onSeek: (fraction: number) => void;
}) {
  const [scrub, setScrub] = useState<number | null>(null);
  const trackW = useRef(0);
  const shown = scrub ?? (duration > 0 ? position / duration : 0);
  const bufferedFrac = duration > 0 ? Math.min(1, buffered / duration) : 0;

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((event) => {
      if (trackW.current <= 0) return;
      const frac = Math.max(0, Math.min(1, event.x / trackW.current));
      setScrub(frac);
    })
    .onEnd(() => {
      setScrub((active) => {
        if (active !== null) onSeek(active);
        return null;
      });
    });

  return (
    <View>
      {scrub !== null && duration > 0 && (
        <Text style={tw`mb-1 text-center font-mono text-[12px] text-white`}>
          {formatClock(scrub * duration)}
        </Text>
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
            <View style={[tw`absolute inset-y-0 left-0 bg-white/40`, { width: `${bufferedFrac * 100}%` }]} />
            <View style={[tw`absolute inset-y-0 left-0 bg-red-500`, { width: `${shown * 100}%` }]} />
          </View>
          <View
            style={[
              tw`absolute h-3.5 w-3.5 rounded-full bg-red-500`,
              { left: `${shown * 100}%`, marginLeft: -7, top: 5 },
            ]}
          />
        </View>
      </GestureDetector>
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
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable style={tw`flex-1 justify-end bg-black/60`} onPress={onClose}>
        <Pressable style={tw`rounded-t-3xl border-t border-white/10 bg-[#15152c] px-4 pb-8 pt-3`}>
          <Text style={tw`mb-2 text-center font-sans-bold text-[15px] text-white`}>Quality</Text>
          {formats.map((format) => {
            const active = format.formatId === currentId;
            return (
              <Pressable
                key={format.formatId}
                onPress={() => {
                  tapSelection();
                  onPick(format);
                  onClose();
                }}
                style={tw`flex-row items-center justify-between rounded-xl px-3 py-3 ${active ? 'bg-white/10' : ''}`}
              >
                <Text style={tw`font-mono-semibold text-[14px] ${active ? 'text-white' : 'text-slate-300'}`}>
                  {formatLabel(format)}
                </Text>
                {active && <Check size={18} color="#22d3ee" />}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
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
  onBack: () => void;
  onQuality: () => void;
  top: number;
}) {
  return (
    <View style={[tw`absolute inset-x-0 top-0 flex-row items-center gap-3 px-4`, { paddingTop: top + 8 }]}>
      <Pressable
        onPress={onBack}
        style={tw`rounded-full bg-black/60 p-2.5`}
        accessibilityLabel="Close player"
      >
        <ArrowLeft size={22} color="#ffffff" />
      </Pressable>
      <View style={tw`flex-1`}>
        <Text style={tw`font-sans-bold text-[15px] text-white`} numberOfLines={1}>
          {title}
        </Text>
        {quality !== '' && (
          <Text style={tw`font-mono text-[11px] text-slate-300`}>{quality}</Text>
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
  );
}

function TransportRow({
  isPlaying,
  onSkip,
  onToggle,
}: {
  isPlaying: boolean;
  onSkip: (seconds: number) => void;
  onToggle: () => void;
}) {
  return (
    <View style={tw`absolute inset-0 flex-row items-center justify-between px-6`} pointerEvents="box-none">
      <Pressable
        onPress={() => onSkip(-10)}
        style={tw`h-24 w-24 items-center justify-center rounded-full`}
        accessibilityLabel="Back 10 seconds"
      >
        <Text style={tw`font-sans-bold text-[15px] text-white/90`}>−10</Text>
      </Pressable>
      <Pressable
        onPress={onToggle}
        style={tw`h-16 w-16 items-center justify-center rounded-full bg-black/60`}
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <Pause size={30} color="#ffffff" />
        ) : (
          <Play size={30} color="#ffffff" />
        )}
      </Pressable>
      <Pressable
        onPress={() => onSkip(10)}
        style={tw`h-24 w-24 items-center justify-center rounded-full`}
        accessibilityLabel="Forward 10 seconds"
      >
        <Text style={tw`font-sans-bold text-[15px] text-white/90`}>+10</Text>
      </Pressable>
    </View>
  );
}

export default function MoviePlayerScreen({ visible, item, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const { player, phase, info, currentId, fault, isPlaying, position, open, close, switchQuality } =
    useMoviePlayer();
  const [controls, setControls] = useState(true);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useBackHandler(() => {
    if (!visible) return false;
    onClose();
    return true;
  }, 20);

  useEffect(() => {
    if (!visible || !item) return;
    void open(item.kind, item.id);
  }, [visible, item, open]);

  useEffect(() => {
    if (!visible) close();
  }, [visible, close]);

  const poke = useCallback(() => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), 3000);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-arm autohide when playback resumes
    if (visible && isPlaying) poke();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible, isPlaying, poke]);

  const skip = (seconds: number) => {
    tapSelection();
    player.seekBy(seconds);
    setFlash(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 700);
    poke();
  };

  const toggle = () => {
    tapImpact();
    if (isPlaying) player.pause();
    else player.play();
    poke();
  };

  const duration = player.duration || info?.duration || 0;
  const buffered = player.bufferedPosition || 0;

  return (
    <View
      style={[
        tw`absolute inset-0 bg-black`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      {landscape ? (
        <View style={tw`flex-1`}>
          <VideoView
            player={player}
            style={tw`flex-1`}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
            fullscreenOptions={{ enable: false }}
          />
        </View>
      ) : (
        <View style={{ paddingTop: insets.top }}>
          <VideoView
            player={player}
            style={{ width, height: (width * 9) / 16 }}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
            fullscreenOptions={{ enable: false }}
          />
        </View>
      )}

      {phase === 'loading' && (
        <View style={tw`absolute inset-0 items-center justify-center bg-black/60`}>
          {item?.poster && (
            <Image source={{ uri: item.poster }} style={tw`absolute inset-0 opacity-30`} contentFit="cover" />
          )}
          <ActivityIndicator size="large" color="#22d3ee" />
          <Text style={tw`mt-3 font-mono text-[12px] text-slate-300`}>Loading stream…</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={tw`absolute inset-0 items-center justify-center bg-black/80 px-8`}>
          <Text style={tw`text-center font-sans-bold text-[17px] text-white`}>Could not play this</Text>
          <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
            {fault ?? 'Unknown player error'}
          </Text>
          <Pressable
            onPress={() => {
              if (item) void open(item.kind, item.id);
            }}
            style={tw`mt-4 flex-row items-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3`}
          >
            <RotateCcw size={18} color="#083344" />
            <Text style={tw`font-sans-bold text-[15px] text-slate-950`}>Retry</Text>
          </Pressable>
        </View>
      )}

      {controls && phase !== 'loading' && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={tw`absolute inset-0`}>
          <Pressable style={tw`absolute inset-0`} onPress={() => setControls(false)} />
          <PlayerTopBar
            title={info?.title ?? item?.title ?? ''}
            quality={info?.formats.find((format) => format.formatId === currentId)?.quality ?? ''}
            canQuality={(info?.formats.length ?? 0) > 1}
            top={insets.top}
            onBack={() => {
              tapSelection();
              onClose();
            }}
            onQuality={() => {
              tapSelection();
              setQualityOpen(true);
            }}
          />

          <TransportRow isPlaying={isPlaying} onSkip={skip} onToggle={toggle} />
          {flash && (
            <View style={tw`absolute inset-x-0 top-1/3 items-center`}>
              <Text style={tw`rounded-full bg-black/70 px-3 py-1.5 font-sans-bold text-[16px] text-white`}>
                {flash}
              </Text>
            </View>
          )}

          <View style={[tw`absolute inset-x-0 bottom-0 px-4`, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
            <Text style={tw`mb-1 font-mono text-[11px] text-slate-200`}>
              {formatClock(position)} / {formatClock(duration)}
            </Text>
            <SeekBar
              position={position}
              duration={duration}
              buffered={buffered}
              onSeek={(fraction) => {
                player.currentTime = fraction * duration;
                poke();
              }}
            />
          </View>
        </Animated.View>
      )}

      {!controls && phase === 'ready' && (
        <Pressable style={tw`absolute inset-0`} onPress={poke} accessibilityLabel="Show controls" />
      )}

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
