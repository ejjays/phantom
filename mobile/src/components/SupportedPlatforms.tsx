import { useState, type ComponentType } from 'react';
import {
  View,
  Text,
  Pressable,
  Platform,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Check,
  X,
  Minus,
  Film,
  Music2,
  Image,
  MessageCircle,
  ChevronRight,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LiquidGlassView, LIQUID_GLASS_FROSTED } from '@uginy/react-native-liquid-glass';
import GlowBlob from './backgrounds/GlowBlob';
import tw from '../lib/tw';
import { tapSelection } from '../lib/haptics';
import { PlatformLogo, type PlatformName } from './logos';

type Cap = 'yes' | 'no' | 'na';

// same matrix as root README, minus web/mobile columns — mobile-only app
const ROWS: readonly {
  name: string;
  logo?: PlatformName;
  video: Cap;
  audio: Cap;
  image: Cap;
}[] = [
  { name: 'YouTube', logo: 'youtube', video: 'yes', audio: 'yes', image: 'na' },
  { name: 'Spotify', logo: 'spotify', video: 'yes', audio: 'yes', image: 'na' },
  { name: 'SoundCloud', logo: 'soundcloud', video: 'na', audio: 'yes', image: 'na' },
  { name: 'Bilibili', logo: 'bilibili', video: 'yes', audio: 'yes', image: 'na' },
  { name: 'TikTok', logo: 'tiktok', video: 'yes', audio: 'yes', image: 'yes' },
  { name: 'Instagram', logo: 'instagram', video: 'yes', audio: 'yes', image: 'yes' },
  { name: 'Facebook', logo: 'facebook', video: 'yes', audio: 'yes', image: 'yes' },
  { name: 'Threads', logo: 'threads', video: 'yes', audio: 'yes', image: 'yes' },
  { name: '/ Twitter', logo: 'x', video: 'yes', audio: 'yes', image: 'na' },
  { name: 'Bluesky', logo: 'bluesky', video: 'yes', audio: 'no', image: 'na' },
  { name: 'Vimeo', logo: 'vimeo', video: 'yes', audio: 'no', image: 'na' },
  { name: 'Dailymotion', logo: 'dailymotion', video: 'yes', audio: 'no', image: 'na' },
  { name: 'Reddit', logo: 'reddit', video: 'yes', audio: 'yes', image: 'na' },
  { name: 'Pinterest', logo: 'pinterest', video: 'yes', audio: 'yes', image: 'yes' },
  { name: 'Twitch', logo: 'twitch', video: 'yes', audio: 'no', image: 'na' },
];

const MIN_COL_W = 46;

const CAP_STATS = [
  {
    label: 'Video',
    icon: Film,
    count: ROWS.filter((row) => row.video === 'yes').length,
  },
  {
    label: 'Audio',
    icon: Music2,
    count: ROWS.filter((row) => row.audio === 'yes').length,
  },
  {
    label: 'Images',
    icon: Image,
    count: ROWS.filter((row) => row.image === 'yes').length,
  },
];

const CAP_COLORS = {
  yes: { bg: '#4ade8021', fg: '#4ade80' },
  no: { bg: '#f871711f', fg: '#f87171' },
  na: { bg: 'rgba(255,255,255,0.06)', fg: '#64748b' },
} as const;

// AGSL shader needs Android 13+; older devices fall back to a plain card
const GLASS_OK =
  Platform.OS === 'android' && Number(Platform.Version) >= 33;

function StatCard({
  icon: Icon,
  label,
  count,
  spaced,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  label: string;
  count: number;
  spaced: boolean;
}) {
  const content = (
    <>
      <View
        style={tw`h-8 w-8 items-center justify-center rounded-full bg-primary/15`}
      >
        <Icon size={15} color="#22d3ee" />
      </View>
      <Text style={tw`mt-2 font-sans-bold text-[22px] leading-6 text-white`}>
        {count}
      </Text>
      <Text
        style={tw`mt-0.5 font-sans-semibold text-[10.5px] uppercase tracking-wide text-slate-400`}
      >
        {label}
      </Text>
    </>
  );
  const gap = spaced ? tw`mr-2.5` : null;
  if (GLASS_OK) {
    return (
      <View style={[tw`flex-1`, gap]}>
        <View style={StyleSheet.absoluteFill}>
          <LiquidGlassView
            {...LIQUID_GLASS_FROSTED}
            blurRadius={60}
            noiseIntensity={0.08}
            saturation={1.2}
            cornerRadius={16}
            style={tw`flex-1`}
          />
        </View>
        <View style={tw`items-center py-3.5`}>{content}</View>
      </View>
    );
  }
  return (
    <View
      style={[
        tw`flex-1 items-center rounded-2xl border border-white/10 bg-white/5 py-3.5`,
        gap,
      ]}
    >
      {content}
    </View>
  );
}

function CapChip({ cap, width }: { cap: Cap; width: number }) {
  const colors = CAP_COLORS[cap];
  const icon =
    cap === 'yes' ? (
      <Check size={14} color={colors.fg} strokeWidth={3} />
    ) : cap === 'no' ? (
      <X size={14} color={colors.fg} strokeWidth={3} />
    ) : (
      <Minus size={14} color={colors.fg} strokeWidth={3} />
    );
  return (
    <View style={[tw`items-center justify-center`, { width }]}>
      <View
        style={[
          tw`h-[26px] w-[26px] items-center justify-center rounded-full`,
          { backgroundColor: colors.bg },
        ]}
      >
        {icon}
      </View>
    </View>
  );
}

function LegendPill({ cap, label }: { cap: Cap; label: string }) {
  const colors = CAP_COLORS[cap];
  const icon =
    cap === 'yes' ? (
      <Check size={10} color={colors.fg} strokeWidth={3} />
    ) : cap === 'no' ? (
      <X size={10} color={colors.fg} strokeWidth={3} />
    ) : (
      <Minus size={10} color={colors.fg} strokeWidth={3} />
    );
  return (
    <View
      style={tw`flex-row items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5`}
    >
      <View
        style={[
          tw`h-[16px] w-[16px] items-center justify-center rounded-full`,
          { backgroundColor: colors.bg },
        ]}
      >
        {icon}
      </View>
      <Text style={tw`ml-1.5 font-sans text-[11px] text-slate-400`}>
        {label}
      </Text>
    </View>
  );
}

export default function SupportedPlatforms({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  // col widths measured from header text so nothing wraps at any font scale
  const [colWs, setColWs] = useState<readonly [number, number, number]>([
    MIN_COL_W,
    MIN_COL_W,
    MIN_COL_W,
  ]);

  const measureCol =
    (i: number) =>
    (e: LayoutChangeEvent) => {
      const width = Math.max(MIN_COL_W, Math.ceil(e.nativeEvent.layout.width));
      setColWs((prev) => {
        if (prev[i] === width) return prev;
        const next = [...prev] as [number, number, number];
        next[i] = width;
        return next;
      });
    };

  return (
    <View style={tw`flex-1`}>
      <View
        style={[
          tw`flex-row items-center px-5 pb-2`,
          { paddingTop: insets.top + 12 },
        ]}
      >
        <Pressable
          onPress={() => {
            tapSelection();
            onBack();
          }}
          hitSlop={8}
          style={tw`h-10 w-10 items-center justify-center rounded-full bg-white/10`}
        >
          <ChevronLeft size={22} color="#e2e8f0" strokeWidth={2.2} />
        </Pressable>
        <Text
          style={tw`flex-1 text-center font-sans-semibold text-[18px] text-white`}
        >
          Supported platforms
        </Text>
        <View style={tw`h-10 w-10`} />
      </View>

      <ScrollView
        contentContainerStyle={[
          tw`px-5 pt-2`,
          { paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[tw`w-full self-center`, { maxWidth: 600 }]}>
          <View style={tw`flex-row`}>
            {/* glass blurs a snapshot of the biggest bg view — flat bg renders
                nothing, and smooth gradient alone shows no frost; blobs give
                the shader soft color edges to blur */}
            <LinearGradient
              colors={['#0f3b57', '#2b1f6b', '#5b1e6b']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={tw`absolute inset-0 rounded-2xl`}
            />
            <View pointerEvents="none" style={tw`absolute inset-0`}>
              <GlowBlob color="#22d3ee" size={150} x={-25} y={-35} />
            </View>
            <View
              pointerEvents="none"
              style={tw`absolute inset-0 items-end justify-end`}
            >
              <GlowBlob color="#a78bfa" size={170} x={-30} y={-25} />
            </View>
            {CAP_STATS.map((stat, i) => (
              <StatCard
                key={stat.label}
                icon={stat.icon}
                label={stat.label}
                count={stat.count}
                spaced={i < CAP_STATS.length - 1}
              />
            ))}
          </View>

          <Text
            style={tw`mx-1 mt-3 text-center font-sans text-[12px] text-slate-500`}
          >
            Everything is downloaded straight to your device
          </Text>

          <View style={tw`mt-6 flex-row items-center px-4 pb-2`}>
            <Text
              style={tw`flex-1 font-sans-semibold text-[11.5px] uppercase text-slate-400`}
            >
              Platform
            </Text>
            {(['Video', 'Audio', 'Images'] as const).map((label, i) => (
              <Text
                key={label}
                onLayout={measureCol(i)}
                style={[
                  tw`text-center font-sans-semibold text-[11.5px] uppercase text-slate-400`,
                  { width: colWs[i] },
                ]}
              >
                {label}
              </Text>
            ))}
          </View>

          <View
            style={tw`overflow-hidden rounded-3xl border border-white/10 bg-white/5`}
          >
            {ROWS.map((row, i) => (
              <Pressable
                key={row.name}
                android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
                style={[
                  tw`flex-row items-center px-4 py-3`,
                  i < ROWS.length - 1 && tw`border-b border-white/5`,
                ]}
              >
                <View style={tw`flex-1 flex-row items-center pr-2`}>
                  {row.logo ? (
                    <View style={tw`mr-2`}>
                      <PlatformLogo name={row.logo} size={18} />
                    </View>
                  ) : null}
                  <Text
                    numberOfLines={1}
                    style={tw`font-sans-semibold text-[14px] text-white`}
                  >
                    {row.name}
                  </Text>
                </View>
                <CapChip cap={row.video} width={colWs[0]} />
                <CapChip cap={row.audio} width={colWs[1]} />
                <CapChip cap={row.image} width={colWs[2]} />
              </Pressable>
            ))}
          </View>

          <View style={tw`mt-4 flex-row items-center justify-center`}>
            <LegendPill cap="yes" label="Yes" />
            <View style={tw`w-2`} />
            <LegendPill cap="na" label="N/A" />
            <View style={tw`w-2`} />
            <LegendPill cap="no" label="No" />
          </View>

          <View
            style={tw`mt-6 flex-row items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5`}
          >
            <View
              style={tw`h-8 w-8 items-center justify-center rounded-full bg-primary/15`}
            >
              <MessageCircle size={16} color="#22d3ee" />
            </View>
            <View style={tw`ml-3 flex-1`}>
              <Text
                style={tw`font-sans-semibold text-[13px] text-white`}
              >
                Want a platform added?
              </Text>
              <Text
                style={tw`mt-0.5 font-sans text-[11.5px] leading-4 text-slate-400`}
              >
                Drop a comment in the Updates tab — I do read them.
              </Text>
            </View>
            <ChevronRight size={16} color="#64748b" />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}