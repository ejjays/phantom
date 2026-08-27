import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  Share,
  useWindowDimensions,
  Linking,
  Alert,
} from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import {
  Copy,
  Link2,
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

type Mode = 'link' | 'qr';

type Target = {
  id: string;
  label: string;
  render: () => ReactNode;
  bg: string;
  onPress: () => void | Promise<void>;
};

export default function ShareAppSheet() {
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - 152, 200);
  const [mode, setMode] = useState<Mode>('link');

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

  const open = useCallback(
    async (url: string, label: string) => {
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
    },
    [],
  );

  const targets: Target[] = useMemo(
    () => [
      {
        id: 'copy',
        label: 'Copy',
        bg: '#475569',
        render: () => <Copy size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () => void copy(),
      },
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        bg: '#25D366',
        render: () => <Text style={tw`text-[22px] font-sans-bold text-white`}>W</Text>,
        onPress: () => void open(`whatsapp://send?text=${encodedShare}`, 'WhatsApp'),
      },
      {
        id: 'sms',
        label: 'Text',
        bg: '#3b82f6',
        render: () => <MessageCircle size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () => void open(`sms:?body=${encodedShare}`, 'Messages'),
      },
      {
        id: 'telegram',
        label: 'Telegram',
        bg: '#26A5E4',
        render: () => <Send size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () => void open(`tg://msg?text=${encodedShare}`, 'Telegram'),
      },
      {
        id: 'x',
        label: 'X',
        bg: '#000000',
        render: () => <AtSign size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () =>
          void open(`https://twitter.com/intent/tweet?text=${encodedShare}`, 'X'),
      },
      {
        id: 'email',
        label: 'Email',
        bg: '#ef4444',
        render: () => <Mail size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () => {
          const subject = encodeURIComponent('Phantom');
          void open(`mailto:?subject=${subject}&body=${encodedShare}`, 'Email');
        },
      },
      {
        id: 'instagram',
        label: 'Stories',
        bg: '#E1306C',
        render: () => <Smartphone size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () => {
          void open(
            'instagram-stories://share?background_asset_url=',
            'Instagram',
          ).catch(() => systemShare());
        },
      },
      {
        id: 'more',
        label: 'More',
        bg: '#64748b',
        render: () => <MoreHorizontal size={26} color="#fff" strokeWidth={2.2} />,
        onPress: () => void systemShare(),
      },
    ],
    [copy, open, systemShare],
  );

  return (
    <View style={tw`px-4 pb-2 pt-2`}>
      <View style={tw`mb-4 self-center flex-row rounded-full bg-white/5 p-1`}>
        {(['link', 'qr'] as Mode[]).map((modeOption) => {
          const active = modeOption === mode;
          return (
            <Pressable
              key={modeOption}
              onPress={() => setMode(modeOption)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                tw`rounded-full px-5 py-1.5`,
                active ? tw`bg-white/10` : null,
                pressed && !active ? { opacity: 0.6 } : null,
              ]}
            >
              <Text
                style={[
                  tw`text-[13px] font-sans-semibold`,
                  { color: active ? '#22d3ee' : '#94a3b8' },
                ]}
              >
                {modeOption === 'link' ? 'Link' : 'QR'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View
        style={tw`rounded-3xl border border-white/5 bg-white/[0.03] px-4 py-5`}
      >
        {mode === 'link' ? (
          <Animated.View
            key="link"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(120)}
          >
            <Text style={tw`text-center font-sans-bold text-[17px] text-white`}>
              Share Phantom
            </Text>
            <Text
              style={tw`mt-1 text-center font-sans text-[12px] leading-4 text-slate-400`}
            >
              Free media downloader. No ads, no tracking.
            </Text>

            <View
              style={tw`mt-4 flex-row items-center gap-2 rounded-2xl border border-white/5 bg-black/30 px-3 py-2.5`}
            >
              <Link2 size={16} color="#22d3ee" strokeWidth={2.2} />
              <Text
                numberOfLines={1}
                style={tw`flex-1 font-mono text-[12px] text-slate-200`}
              >
                {APP_URL}
              </Text>
              <Pressable
                onPress={() => void copy()}
                hitSlop={10}
                accessibilityLabel="Copy link"
                style={({ pressed }) => [
                  tw`rounded-full bg-primary/15 px-2.5 py-1`,
                  pressed ? { opacity: 0.6 } : null,
                ]}
              >
                <Copy size={13} color="#22d3ee" strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={tw`mt-5 flex-row justify-between`}>
              {targets.slice(0, 4).map((t) => (
                <View key={t.id} style={tw`flex-1 items-center`}>
                  <TargetBtn t={t} />
                </View>
              ))}
            </View>
          </Animated.View>
        ) : (
          <Animated.View
            key="qr"
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(120)}
            style={tw`items-center`}
          >
            <Text style={tw`text-center font-sans-bold text-[17px] text-white`}>
              Scan to install
            </Text>
            <Text
              style={tw`mt-1 text-center font-sans text-[12px] leading-4 text-slate-400`}
            >
              Point your camera at the code
            </Text>

            <View
              style={[
                tw`mt-4 rounded-[28px] bg-white p-4`,
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
                padding={14}
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

            <Text
              style={tw`mt-3 text-center font-mono text-[11px] text-slate-500`}
            >
              {APP_URL}
            </Text>
          </Animated.View>
        )}
      </View>

      <View style={tw`mt-4 flex-row flex-wrap justify-between`}>
        {targets.map((t) => (
          <View key={t.id} style={tw`w-1/4 items-center pb-1`}>
            <TargetBtn t={t} />
          </View>
        ))}
      </View>
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
          tw`h-[58px] w-[58px] items-center justify-center rounded-full`,
          { backgroundColor: t.bg },
        ]}
      >
        {t.render()}
      </View>
      <Text
        numberOfLines={1}
        style={tw`max-w-[70px] text-center font-sans text-[11px] text-slate-300`}
      >
        {t.label}
      </Text>
    </Pressable>
  );
}
