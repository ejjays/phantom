import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import tw from '../lib/tw';

export default function QrView({
  source,
  value,
  label,
  note,
  onClose,
}: {
  source?: number;
  value?: string;
  label: string;
  note?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - 96, 320);
  return (
    <View style={tw`flex-1`}>
      <View
        style={[
          tw`flex-1 items-center justify-center`,
          label === 'GoTyme' ? tw`px-5` : null,
          { paddingTop: insets.top + 56 },
        ]}
      >
        {value ? (
          <View style={tw`rounded-3xl bg-white p-6`}>
            <QRCodeStyled
              data={value}
              size={qrSize}
              padding={25}
              pieceBorderRadius={[0, '75%', 0, '75%']}
              isPiecesGlued
              gradient={{
                type: 'linear',
                options: {
                  start: [0, 0],
                  end: [1, 1],
                  colors: ['#22d3ee', '#0e7490'],
                  locations: [0, 1],
                },
              }}
            />
          </View>
        ) : source ? (
          <Image
            source={source}
            style={tw`h-full w-full`}
            contentFit="contain"
            transition={150}
          />
        ) : null}
      </View>
      <View style={[tw`items-center px-8`, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={tw`font-sans-bold text-[22px] tracking-tight text-white`}>
          {label}
        </Text>
        {note ? (
          <Text
            style={tw`mt-2 max-w-[320px] text-center font-sans text-[14px] leading-5 text-slate-400`}
          >
            {note}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={10}
        style={[
          tw`absolute right-5 h-10 w-10 items-center justify-center rounded-full bg-white/10`,
          { top: insets.top + 12 },
        ]}
      >
        <X size={22} color="#e2e8f0" strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
