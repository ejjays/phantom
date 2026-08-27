import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Share,
  useWindowDimensions,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import * as Clipboard from 'expo-clipboard';
import {
  Copy,
  Share2,
  MessageCircle,
  Send,
  AtSign,
  Smartphone,
  Mail,
  MoreHorizontal,
} from 'lucide-react-native';
import { tapSuccess } from '../../lib/haptics';
import tw from '../../lib/tw';

const APP_URL = 'https://github.com/ejjays/phantom';
const SHARE_TEXT = 'Phantom — free media downloader (yt/spotify/etc), no ads, no tracking.';
const fullShareText = `${SHARE_TEXT}\n${APP_URL}`;
const encodedShare = encodeURIComponent(fullShareText);

type Target = {
  id: string;
  label: string;
  render: () => React.ReactNode;
  bg: string;
  onPress: () => void | Promise<void>;
};

export default function ShareAppSheet() {
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - 96, 260);

  const copy = useCallback(async () => {
    await Clipboard.setStringAsync(APP_URL);
    tapSuccess();
  }, []);

  const systemShare = useCallback(async () => {
    try {
      await Share.share({ message: fullShareText });
    } catch {
      // dismissed
    }
  }, []);

  const open = useCallback(async (url: string, label: string) => {
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('not_installed');
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        `${label} not available`,
        "That app isn't installed on this device. Use another share option.",
      );
    }
  }, []);

  const targets: Target[] = [
    {
      id: 'copy',
      label: 'Copy',
      bg: '#475569',
      render: () => <Copy size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => void copy(),
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      bg: '#25D366',
      render: () => <Text style={tw`text-[20px] font-sans-bold text-white`}>W</Text>,
      onPress: () => void open(`whatsapp://send?text=${encodedShare}`, 'WhatsApp'),
    },
    {
      id: 'sms',
      label: 'Text',
      bg: '#3b82f6',
      render: () => <MessageCircle size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => void open(`sms:?body=${encodedShare}`, 'Messages'),
    },
    {
      id: 'telegram',
      label: 'Telegram',
      bg: '#26A5E4',
      render: () => <Send size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => void open(`tg://msg?text=${encodedShare}`, 'Telegram'),
    },
    {
      id: 'x',
      label: 'X',
      bg: '#000000',
      render: () => <AtSign size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => void open(`https://twitter.com/intent/tweet?text=${encodedShare}`, 'X'),
    },
    {
      id: 'email',
      label: 'Email',
      bg: '#ef4444',
      render: () => <Mail size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => {
        const subject = encodeURIComponent('Phantom');
        void open(`mailto:?subject=${subject}&body=${encodedShare}`, 'Email');
      },
    },
    {
      id: 'instagram',
      label: 'Stories',
      bg: '#E1306C',
      render: () => <Smartphone size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => {
        void open('instagram-stories://share?background_asset_url=', 'Instagram').catch(() =>
          systemShare(),
        );
      },
    },
    {
      id: 'more',
      label: 'More',
      bg: '#64748b',
      render: () => <MoreHorizontal size={22} color="#fff" strokeWidth={2.2} />,
      onPress: () => void systemShare(),
    },
  ];

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
            topLeft: { borderRadius: ['40%', '40%', 0, '40%'] },
            topRight: { borderRadius: ['40%', '40%', '40%'] },
            bottomLeft: { borderRadius: ['40%', 0, '40%', '40%'] },
          }}
          innerEyesOptions={{ borderRadius: '50%', scale: 0.85 }}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={tw`mt-6 items-center gap-3 px-2`}
        style={tw`mt-6 self-stretch`}
      >
        {targets.map((t) => (
          <TargetBtn key={t.id} t={t} />
        ))}
      </ScrollView>
    </View>
  );
}

function TargetBtn({ t }: { t: Target }) {
  return (
    <Pressable
      onPress={() => void t.onPress()}
      accessibilityRole="button"
      accessibilityLabel={t.label}
      style={({ pressed }) => [
        tw`items-center gap-1.5`,
        pressed ? { opacity: 0.55, transform: [{ scale: 0.94 }] } : null,
      ]}
    >
      <View
        style={[
          tw`h-[52px] w-[52px] items-center justify-center rounded-full`,
          { backgroundColor: t.bg },
        ]}
      >
        {t.render()}
      </View>
      <Text
        numberOfLines={1}
        style={tw`max-w-[64px] text-center font-sans text-[10px] text-slate-400`}
      >
        {t.label}
      </Text>
    </Pressable>
  );
}
