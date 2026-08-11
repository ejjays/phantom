import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Share,
  useWindowDimensions,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import * as Clipboard from 'expo-clipboard';
import { Copy, Share2 } from 'lucide-react-native';
import { tapSuccess } from '../../lib/haptics';
import tw from '../../lib/tw';

const APP_URL = 'https://github.com/ejjays/phantom';

const buttonGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

export default function ShareAppSheet() {
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - 96, 260);

  const copyLink = useCallback(async () => {
    await Clipboard.setStringAsync(APP_URL);
    tapSuccess();
  }, []);

  const shareLink = useCallback(async () => {
    try {
      await Share.share({ message: APP_URL });
    // eslint-disable-next-line no-empty -- share sheet dismissed
    } catch {
    }
  }, []);

  return (
    <View style={tw`items-center px-6 pt-4 pb-6`}>
      <Text style={tw`font-sans-bold text-[20px] tracking-tight text-white`}>
        Share Phantom
      </Text>
      <Text
        style={tw`mt-2 max-w-[280px] text-center font-sans text-[14px] leading-5 text-slate-400`}
      >
        Scan the QR code to get the app
      </Text>

      <View
        style={[
          tw`mt-6 rounded-[32px] bg-white p-5`,
          {
            borderWidth: 1,
            borderColor: 'rgba(34,211,238,0.18)',
            shadowColor: '#06b6d4',
            shadowOpacity: 0.18,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 0 },
            elevation: 4,
          },
        ]}
      >
        <QRCodeStyled
          data={APP_URL}
          size={qrSize}
          padding={16}
          pieceScale={1.04}
          pieceCornerType="rounded"
          pieceBorderRadius="50%"
          gradient={{
            type: 'radial',
            options: {
              center: [0.5, 0.5],
              radius: [1, 1],
              colors: ['#22d3ee', '#0e7490'],
              locations: [0, 1],
            },
          }}
          outerEyesOptions={{
            topLeft: {
              borderRadius: ['40%', '40%', 0, '40%'],
            },
            topRight: {
              borderRadius: ['40%', '40%', '40%'],
            },
            bottomLeft: {
              borderRadius: ['40%', 0, '40%', '40%'],
            },
          }}
          innerEyesOptions={{
            borderRadius: '50%',
            scale: 0.85,
          }}
        />
      </View>

      <View style={tw`mt-6 w-full flex-row gap-3`}>
        <Pressable
          onPress={() => void copyLink()}
          accessibilityRole="button"
          accessibilityLabel="Copy link"
          style={({ pressed }) => [
            tw`flex-1 flex-row items-center justify-center gap-2 rounded-full border border-primary/40 py-3.5`,
            { backgroundColor: '#22d3ee40' },
            buttonGlow,
            pressed ? { transform: [{ scale: 0.97 }] } : null,
          ]}
        >
          <Copy size={18} color="#22d3ee" strokeWidth={2.2} />
          <Text
            style={[tw`font-sans-semibold text-[15px]`, { color: '#22d3ee' }]}
          >
            Copy
          </Text>
        </Pressable>

        <Pressable
          onPress={() => void shareLink()}
          accessibilityRole="button"
          accessibilityLabel="Share link"
          style={({ pressed }) => [
            tw`flex-1 flex-row items-center justify-center gap-2 rounded-full border border-primary/40 py-3.5`,
            { backgroundColor: '#22d3ee40' },
            buttonGlow,
            pressed ? { transform: [{ scale: 0.97 }] } : null,
          ]}
        >
          <Share2 size={18} color="#22d3ee" strokeWidth={2.2} />
          <Text
            style={[tw`font-sans-semibold text-[15px]`, { color: '#22d3ee' }]}
          >
            Share
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
