import { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Share,
  Linking,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import * as Clipboard from 'expo-clipboard';
import { Link, Mail, MoreHorizontal } from 'lucide-react-native';
import { PlatformLogo } from '../logos';
import { tapSuccess } from '../../lib/haptics';
import tw from '../../lib/tw';

const APP_URL = 'https://c-phantom.pages.dev';
const SHARE_TEXT = 'Phantom — free media downloader (yt/spotify/etc), no ads, no tracking.';
const fullShareText = `${SHARE_TEXT}\n${APP_URL}`;

type Target = {
  id: string;
  label: string;
  bg: string;
  iconSize?: number;
  onPress: () => void | Promise<void>;
  render: (size: number) => React.ReactNode;
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

  const emailShare = useCallback(async () => {
    try {
      await Share.share(
        {
          message: fullShareText,
          title: 'Phantom',
        },
        { dialogTitle: 'Share Phantom via email' },
      );
    } catch {
      // dismissed
    }
  }, []);

  const openXShare = useCallback(async () => {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(fullShareText)}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
      } else {
        await systemShare();
      }
    } catch {
      await systemShare();
    }
  }, [fullShareText, systemShare]);

  const openInstagramShare = useCallback(async () => {
    const scheme = `instagram://sharesheet?text=${APP_URL}`;
    try {
      if (await Linking.canOpenURL(scheme)) {
        await Linking.openURL(scheme);
      } else {
        await Clipboard.setStringAsync(APP_URL);
        tapSuccess();
        if (await Linking.canOpenURL('instagram://app')) {
          await Linking.openURL('instagram://app');
        } else {
          await Linking.openURL('https://instagram.com');
        }
      }
    } catch {
      await systemShare();
    }
  }, [APP_URL, systemShare]);

  const openMessengerShare = useCallback(async () => {
    const scheme = `fb-messenger://share?link=${encodeURIComponent(APP_URL)}`;
    try {
      if (await Linking.canOpenURL(scheme)) {
        await Linking.openURL(scheme);
      } else {
        await systemShare();
      }
    } catch {
      await systemShare();
    }
  }, [APP_URL, systemShare]);

  const openWhatsAppShare = useCallback(async () => {
    const url = `https://wa.me/?text=${encodeURIComponent(fullShareText)}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
      } else {
        await systemShare();
      }
    } catch {
      await systemShare();
    }
  }, [fullShareText, systemShare]);

  const openTelegramShare = useCallback(async () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(APP_URL)}&text=${encodeURIComponent(
      SHARE_TEXT,
    )}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
      } else {
        await systemShare();
      }
    } catch {
      await systemShare();
    }
  }, [APP_URL, SHARE_TEXT, systemShare]);

  const openFacebookShare = useCallback(async () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_URL)}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
      } else {
        await systemShare();
      }
    } catch {
      await systemShare();
    }
  }, [APP_URL, systemShare]);

  const targets: Target[] = [
    {
      id: 'copy',
      label: 'Copy',
      bg: '#475569',
      onPress: () => void copy(),
      render: (size) => <Link size={size} color="#fff" strokeWidth={2.2} />,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      bg: 'transparent',
      onPress: () => void openWhatsAppShare(),
      render: (size) => <PlatformLogo name="whatsapp" size={size} />,
    },
    {
      id: 'messenger',
      label: 'Messenger',
      bg: 'transparent',
      onPress: () => void openMessengerShare(),
      render: (size) => <PlatformLogo name="messenger" size={size} />,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      bg: 'transparent',
      onPress: () => void openTelegramShare(),
      render: (size) => <PlatformLogo name="telegram" size={size} />,
    },
    {
      id: 'instagram',
      label: 'Instagram',
      bg: 'transparent',
      onPress: () => void openInstagramShare(),
      render: (size) => <PlatformLogo name="instagram" size={size} />,
    },
    {
      id: 'facebook',
      label: 'Facebook',
      bg: 'transparent',
      onPress: () => void openFacebookShare(),
      render: (size) => <PlatformLogo name="facebook" size={size} />,
    },
    {
      id: 'x',
      label: 'X',
      bg: '#000000',
      onPress: () => void openXShare(),
      render: (size) => <PlatformLogo name="x" size={size} />,
    },
    {
      id: 'email',
      label: 'Email',
      bg: '#ef4444',
      onPress: () => void emailShare(),
      render: (size) => <Mail size={size} color="#fff" strokeWidth={2.2} />,
    },
    {
      id: 'more',
      label: 'More',
      bg: '#64748b',
      onPress: () => void systemShare(),
      render: (size) => <MoreHorizontal size={size} color="#fff" strokeWidth={2.2} />,
    },
  ];

  return (
    <View style={tw`items-center pb-2`}>
      <Text style={tw`mt-4 font-sans-bold text-[20px] tracking-tight text-white`}>
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

      <View
        style={[
          tw`mt-6 h-px self-stretch`,
          { backgroundColor: 'rgba(255,255,255,0.08)' },
        ]}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={tw`mt-3 items-center gap-3 pl-5 pr-5`}
        style={[tw`mt-3 self-stretch`, { marginHorizontal: -16 }]}
      >
        {targets.map((t) => (
          <TargetBtn key={t.id} t={t} />
        ))}
      </ScrollView>
    </View>
  );
}

function TargetBtn({ t }: { t: Target }) {
  const isBrand =
    t.id === 'instagram' ||
    t.id === 'x' ||
    t.id === 'messenger' ||
    t.id === 'whatsapp' ||
    t.id === 'telegram' ||
    t.id === 'facebook';
  const iconPx = isBrand ? (t.id === 'x' ? 36 : 52) : t.iconSize ?? 22;
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
          tw`h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full`,
          isBrand
            ? t.id === 'x'
              ? { backgroundColor: '#000000' }
              : null
            : { backgroundColor: t.bg },
        ]}
      >
        {t.render(iconPx)}
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
