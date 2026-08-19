import { useState } from 'react';
import { View, Text, Pressable, type LayoutChangeEvent } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Check, X, Minus } from 'lucide-react-native';
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

function CapMark({ cap }: { cap: Cap }) {
  if (cap === 'yes') return <Check size={17} color="#4ade80" strokeWidth={3} />;
  if (cap === 'no') return <X size={17} color="#f87171" strokeWidth={3} />;
  return <Minus size={17} color="#475569" strokeWidth={3} />;
}

function CapCell({ cap, width }: { cap: Cap; width: number }) {
  return (
    <View style={[tw`items-center justify-center`, { width }]}>
      <CapMark cap={cap} />
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
          <Text style={tw`mx-1 font-sans text-[13px] leading-5 text-slate-400`}>
            Everything is downloaded fully on your device. Here&apos;s what you
            can save from each site.
          </Text>

          <View style={tw`mt-4 flex-row items-center px-4 pb-2`}>
            <View style={tw`flex-1`} />
            {(['Video', 'Audio', 'Images'] as const).map((label, i) => (
              <Text
                key={label}
                onLayout={measureCol(i)}
                style={[
                  tw`text-center font-sans-semibold text-[12px] uppercase text-slate-500`,
                  { width: colWs[i] },
                ]}
              >
                {label}
              </Text>
            ))}
          </View>

          <View style={tw`overflow-hidden rounded-3xl border border-white/10 bg-white/5`}>
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
                <CapCell cap={row.video} width={colWs[0]} />
                <CapCell cap={row.audio} width={colWs[1]} />
                <CapCell cap={row.image} width={colWs[2]} />
              </Pressable>
            ))}
          </View>

          <View style={tw`mx-1 mt-5 flex-row items-center`}>
            <Check size={15} color="#4ade80" strokeWidth={3} />
            <Text style={tw`ml-1.5 font-sans text-[12px] text-slate-500`}>
              supported
            </Text>
            <Minus size={15} color="#475569" strokeWidth={3} style={tw`ml-4`} />
            <Text style={tw`ml-1.5 font-sans text-[12px] text-slate-500`}>
              not applicable
            </Text>
            <X size={15} color="#f87171" strokeWidth={3} style={tw`ml-4`} />
            <Text style={tw`ml-1.5 font-sans text-[12px] text-slate-500`}>
              no
            </Text>
          </View>

          <Text style={tw`mx-1 mt-6 font-sans text-[12px] leading-5 text-slate-500`}>
            Want a platform added? Drop a comment in the Updates tab — I do read
            them.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}