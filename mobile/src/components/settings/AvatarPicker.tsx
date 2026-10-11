import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Check } from 'lucide-react-native';
import tw from '../../lib/tw';
import Avatar from '../ui/Avatar';
import { presetIdOf, type AvatarCategory } from '../../lib/social/avatars';

const TILE_W = 104;

export default function AvatarPicker({
  categories,
  current,
  onPick,
  onBack,
}: {
  categories: readonly AvatarCategory[];
  current: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [tapped, setTapped] = useState<string | null>(null);
  const activeId = tapped ?? presetIdOf(current);

  const press = (id: string) => {
    setTapped(id);
    onPick(id);
  };

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
          Choose Avatar
        </Text>
        <Avatar name="" size={40} uri={current} />
      </View>

      <ScrollView
        style={tw`flex-1`}
        contentContainerStyle={tw`pb-24 pt-2`}
        showsVerticalScrollIndicator={false}
      >
        {categories.map((category) => (
          <View key={category.id} style={tw`mb-7`}>
            <Text
              style={tw`mb-3.5 ml-5 font-sans-semibold text-[17px] text-white`}
            >
              {category.title}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              overScrollMode="never"
              contentContainerStyle={tw`px-5`}
            >
              {category.avatars.map((preset, index) => {
                const active = activeId === preset.id;
                const isLast = index === category.avatars.length - 1;
                return (
                  <Pressable
                    key={preset.id}
                    onPress={() => press(preset.id)}
                    style={({ pressed }) => [
                      tw`items-center`,
                      isLast ? null : tw`mr-3`,
                      pressed ? { transform: [{ scale: 0.94 }] } : null,
                    ]}
                  >
                    <View>
                      <View
                        style={[
                          tw`rounded-2xl border-2 p-0.5`,
                          active ? tw`border-primary` : tw`border-transparent`,
                        ]}
                      >
                        <Image
                          source={preset.source}
                          style={[tw`rounded-xl`, { width: 96, height: 96 }]}
                          contentFit="cover"
                        />
                      </View>
                      {active ? (
                        <View
                          style={tw`absolute bottom-1 right-1 h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary`}
                        >
                          <Check size={13} color="#04101f" strokeWidth={3} />
                        </View>
                      ) : null}
                    </View>
                    <View style={[tw`mt-2`, { width: TILE_W, height: 32 }]}>
                      <Text
                        numberOfLines={2}
                        style={[
                          tw`text-center font-sans text-[11px] leading-4`,
                          active ? tw`text-white` : tw`text-slate-400`,
                        ]}
                      >
                        {preset.name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
