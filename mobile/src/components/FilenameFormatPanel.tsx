import { View, Text, Pressable } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LottieView from 'lottie-react-native';
import { ChevronLeft, Check } from 'lucide-react-native';
import tw from '../lib/tw';
import { formatName, type FilenameFormat } from '../lib/settings';
import filenameAnim from '../../assets/filename.json';

const CYAN = '#22d3ee';
const buttonGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

const FORMAT_ORDER: FilenameFormat[] = [
  'artist-title',
  'title',
  'title-platform',
];
const FORMAT_LABELS: Record<FilenameFormat, string> = {
  'artist-title': 'Artist – Title',
  title: 'Title only',
  'title-platform': 'Title (platform)',
};

export default function FilenameFormatPanel({
  format,
  onChoose,
  onBack,
}: {
  format: FilenameFormat;
  onChoose: (f: FilenameFormat) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={tw`flex-1`}>
      <View
        style={[
          tw`flex-row items-center px-5 pb-3`,
          { paddingTop: insets.top + 12 },
        ]}
      >
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={tw`h-10 w-10 items-center justify-center rounded-full bg-white/10`}
        >
          <ChevronLeft size={22} color="#e2e8f0" strokeWidth={2.2} />
        </Pressable>
        <Text style={tw`ml-3 flex-1 font-sans-bold text-[22px] text-white`}>
          Filename format
        </Text>
        <View style={tw`h-10 w-10`} />
      </View>

      <ScrollView
        style={tw`flex-1`}
        contentContainerStyle={tw`px-5 pb-24 pt-2`}
        showsVerticalScrollIndicator={false}
      >
        <View style={tw`items-center`}>
          <LottieView
            source={filenameAnim}
            autoPlay
            loop
            style={tw`h-32 w-32`}
          />
          <Text style={tw`mt-1 font-sans text-[13px] text-slate-400`}>
            How your saved files are named
          </Text>
        </View>
        <View style={tw`mt-5`}>
          {FORMAT_ORDER.map((f, i) => {
            const active = f === format;
            const last = i === FORMAT_ORDER.length - 1;
            return (
              <Pressable
                key={f}
                onPress={() => onChoose(f)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  tw`flex-row items-center rounded-full border px-5 py-3.5`,
                  last ? null : tw`mb-2.5`,
                  active
                    ? [
                        tw`border-primary/40`,
                        { backgroundColor: '#22d3ee40' },
                        buttonGlow,
                      ]
                    : tw`border-white/10 bg-[#131d36]`,
                  pressed ? { transform: [{ scale: 0.985 }] } : null,
                ]}
              >
                <View style={tw`flex-1`}>
                  <View
                    style={[
                      tw`self-start rounded-full px-2 py-0.5`,
                      { backgroundColor: active ? CYAN : `${CYAN}1a` },
                    ]}
                  >
                    <Text
                      style={[
                        tw`font-sans-semibold text-[11px]`,
                        { color: active ? '#030014' : CYAN },
                      ]}
                    >
                      {FORMAT_LABELS[f]}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      tw`mt-1.5 ml-1 font-mono text-[11px]`,
                      active ? tw`text-white/80` : tw`text-slate-400`,
                    ]}
                  >
                    {formatName(f, 'Best video', 'MrBeast', 'youtube')}.mp4
                  </Text>
                </View>
                <View
                  style={[
                    tw`ml-3 h-6 w-6 items-center justify-center rounded-full`,
                    active ? tw`bg-primary` : tw`border-2 border-white/20`,
                  ]}
                >
                  {active ? (
                    <Check size={14} color="#030014" strokeWidth={3} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}