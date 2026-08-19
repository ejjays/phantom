import { View, Text, Pressable } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Check, X, Minus } from 'lucide-react-native';
import tw from '../lib/tw';
import { tapSelection } from '../lib/haptics';

type Cap = 'yes' | 'no' | 'na';

const ROWS: readonly {
  name: string;
  video: Cap;
  audio: Cap;
  image: Cap;
  note?: string;
}[] = [
  { name: 'YouTube', video: 'yes', audio: 'yes', image: 'na', note: 'playlists, shorts, 4K' },
  { name: 'Spotify', video: 'yes', audio: 'yes', image: 'na', note: 'tracks & albums' },
  { name: 'SoundCloud', video: 'na', audio: 'yes', image: 'na', note: 'audio-only' },
  { name: 'Bilibili', video: 'yes', audio: 'yes', image: 'na', note: 'some videos need a cookie' },
  { name: 'TikTok', video: 'yes', audio: 'yes', image: 'yes', note: 'videos + photo carousels' },
  { name: 'Instagram', video: 'yes', audio: 'yes', image: 'yes', note: 'reels, posts, multi-image' },
  { name: 'Facebook', video: 'yes', audio: 'yes', image: 'yes', note: 'public posts only' },
  { name: 'Threads', video: 'yes', audio: 'yes', image: 'yes' },
  { name: 'X / Twitter', video: 'yes', audio: 'yes', image: 'na', note: 'videos & gifs only' },
  { name: 'Bluesky', video: 'yes', audio: 'no', image: 'na', note: 'hls only, no audio' },
  { name: 'Vimeo', video: 'yes', audio: 'no', image: 'na', note: 'hls only, no audio' },
  { name: 'Dailymotion', video: 'yes', audio: 'no', image: 'na', note: 'hls only, no audio' },
  { name: 'Reddit', video: 'yes', audio: 'yes', image: 'na' },
  { name: 'Pinterest', video: 'yes', audio: 'yes', image: 'yes', note: 'video pins + photos' },
  { name: 'Twitch', video: 'yes', audio: 'no', image: 'na', note: 'clips, hls only' },
];

const COL_W = 46;

function CapMark({ cap }: { cap: Cap }) {
  if (cap === 'yes') return <Check size={17} color="#4ade80" strokeWidth={3} />;
  if (cap === 'no') return <X size={17} color="#f87171" strokeWidth={3} />;
  return <Minus size={17} color="#475569" strokeWidth={3} />;
}

function CapCell({ cap }: { cap: Cap }) {
  return (
    <View style={[tw`items-center justify-center`, { width: COL_W }]}>
      <CapMark cap={cap} />
    </View>
  );
}

export default function SupportedPlatforms({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
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
            {(['Video', 'Audio', 'Images'] as const).map((label) => (
              <Text
                key={label}
                style={[
                  tw`text-center font-sans-semibold text-[12px] uppercase text-slate-500`,
                  { width: COL_W },
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
                <View style={tw`flex-1 pr-2`}>
                  <Text
                    numberOfLines={1}
                    style={tw`font-sans-semibold text-[14px] text-white`}
                  >
                    {row.name}
                  </Text>
                  {row.note ? (
                    <Text
                      numberOfLines={1}
                      style={tw`mt-0.5 font-sans text-[11px] text-slate-500`}
                    >
                      {row.note}
                    </Text>
                  ) : null}
                </View>
                <CapCell cap={row.video} />
                <CapCell cap={row.audio} />
                <CapCell cap={row.image} />
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