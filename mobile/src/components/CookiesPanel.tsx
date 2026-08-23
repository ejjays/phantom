import { View, Text, Pressable } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import tw from '../lib/tw';
import KeyboardAvoidingForm from './KeyboardAvoidingForm';

function PlatformRow({
  name,
  set,
  onPress,
  last,
}: {
  name: string;
  set: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
    >
      <View
        style={[
          tw`flex-row items-center px-5 py-4`,
          last ? null : tw`border-b border-white/5`,
        ]}
      >
        <View style={tw`flex-1`}>
          <Text style={tw`font-sans-medium text-[15px] text-white`}>
            {name}
          </Text>
        </View>
        {set ? (
          <View style={tw`mr-2 rounded-full bg-green-500/15 px-2.5 py-1`}>
            <Text style={tw`font-sans-semibold text-[12px] text-green-400`}>
              Set
            </Text>
          </View>
        ) : null}
        <ChevronRight size={18} color="#475569" />
      </View>
    </Pressable>
  );
}

export default function CookiesPanel({
  youtubeSet,
  bilibiliSet,
  onOpen,
  onBack,
}: {
  youtubeSet: boolean;
  bilibiliSet: boolean;
  onOpen: (platform: 'youtube' | 'bilibili') => void;
  onBack: () => void;
}) {
  return (
    <KeyboardAvoidingForm contentContainerStyle={tw`px-5 pb-36 pt-14`}>
      <View style={[tw`w-full self-center`, { maxWidth: 600 }]}>
        <View style={tw`h-10 flex-row items-center justify-center`}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={tw`absolute left-0 h-10 w-10 items-center justify-center rounded-full bg-white/10`}
          >
            <ChevronLeft size={22} color="#e2e8f0" strokeWidth={2.2} />
          </Pressable>
          <Text style={tw`font-sans-semibold text-[18px] text-white`}>
            Cookies
          </Text>
        </View>

        <View style={tw`mt-8 overflow-hidden rounded-3xl bg-white/5`}>
          <PlatformRow
            name="YouTube"
            set={youtubeSet}
            onPress={() => onOpen('youtube')}
          />
          <PlatformRow
            name="Bilibili"
            set={bilibiliSet}
            onPress={() => onOpen('bilibili')}
            last
          />
        </View>
      </View>
    </KeyboardAvoidingForm>
  );
}