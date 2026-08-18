import { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import { ChevronLeft, Check, Heart, Wallet } from 'lucide-react-native';
import tw from '../lib/tw';
import KeyboardAvoidingForm from './KeyboardAvoidingForm';
import { tapSelection } from '../lib/haptics';
import heroBg from '../../assets/support/hero-bg.json';
import HeroLottieCard, { textOutline } from './HeroLottieCard';
import WavingHand from './WavingHand';
import tipBg from '../../assets/support/tip-bg.json';
import { PayPalIcon, GCashIcon, GoTymeIcon } from './icons';
import PayMongoCheckoutModal from './PayMongoCheckoutModal';

const CYAN = '#22d3ee';
const ctaGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

export type SupportMethod =
  | {
      id: string;
      label: string;
      kind: 'qr';
      source: number;
      amountQrs?: Record<number, number>;
    }
  | { id: string; label: string; kind: 'paypal'; url: string };

// hosted checkout stays off the settings method list — extra options here
// would break SettingsScreen's kind narrowing
type HostedMethod = { id: string; label: string; kind: 'paymongo' };

const PAYMONGO_METHOD: HostedMethod = {
  id: 'qrph',
  label: 'QR Ph',
  kind: 'paymongo',
};

type Tip = { amount: number; note: string };
const TIPS: readonly Tip[] = [
  { amount: 50, note: 'Buys a coffee' },
  { amount: 100, note: 'Fuels a late-night build' },
  { amount: 250, note: 'Keeps it ad-free' },
  { amount: 500, note: 'Legend status' },
];

const TIP_W = 140;
const TIP_H = 152;

export default function SupportPage({
  methods,
  onPay,
  onBack,
}: {
  methods: readonly SupportMethod[];
  onPay: (method: SupportMethod, amount: number | null) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [preset, setPreset] = useState<number | null>(TIPS[0]?.amount ?? null);
  const [custom, setCustom] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const allMethods: readonly (SupportMethod | HostedMethod)[] = [
    ...methods,
    PAYMONGO_METHOD,
  ];
  const [methodId, setMethodId] = useState(allMethods[0]?.id ?? '');

  const customNum = Number(custom.replace(/\D/gu, ''));
  const activePreset = custom.trim().length > 0 ? null : preset;
  const amount = customNum > 0 ? customNum : preset;
  const method = allMethods.find((entry) => entry.id === methodId) ?? null;

  const pickPreset = (value: number) => {
    tapSelection();
    setPreset(value);
    setCustom('');
  };

  const pickMethod = (id: string) => {
    tapSelection();
    setMethodId(id);
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
          onPress={onBack}
          hitSlop={8}
          style={tw`h-10 w-10 items-center justify-center rounded-full bg-white/10`}
        >
          <ChevronLeft size={22} color="#e2e8f0" strokeWidth={2.2} />
        </Pressable>
        <Text
          style={tw`flex-1 text-center font-sans-semibold text-[18px] text-white`}
        >
          Support
        </Text>
        <View style={tw`h-10 w-10`} />
      </View>

      <KeyboardAvoidingForm
        contentContainerStyle={[
          tw`px-5 pt-2`,
          { paddingBottom: insets.bottom + 28 },
        ]}
      >
        <View style={[tw`w-full self-center`, { maxWidth: 600 }]}>
          <HeroLottieCard source={heroBg} speed={0.6} glow glowStrength={0.7}>
            <View style={tw`flex-row items-center`}>
              <Text
                style={[
                  tw`font-sans-bold text-[22px] leading-7 text-white`,
                  textOutline,
                ]}
              >
                Hi, I&apos;m <Text style={tw`text-primary`}>EJ!</Text>
              </Text>
              <WavingHand style={tw`ml-1.5 text-[22px] leading-7`} />
            </View>
            <Text
              style={[
                tw`mt-3.5 font-sans-medium text-[13px] leading-6 text-white`,
                textOutline,
              ]}
            >
              I built Phantom with one clear goal:{' '}
              <Text style={tw`font-sans-bold text-primary underline`}>
                to make high-quality tools completely free for everyone
              </Text>
              . I believe everyone deserves access to great media tools without
              being hidden behind paywalls or cluttered with annoying ads.
            </Text>
            <Text
              style={[
                tw`mt-3 font-sans-medium text-[13px] leading-6 text-white`,
                textOutline,
              ]}
            >
              To be honest, I built this entire application using only my mobile
              phone through Termux and Acode, as I don&apos;t have a computer
              yet.
            </Text>
            <Text
              style={[
                tw`mt-3 font-sans-medium text-[13px] leading-6 text-white`,
                textOutline,
              ]}
            >
              Your support will mean the world to me. It will help me stay
              focused on continue developing the next generation of open-source
              media tools for the community. Thank you for support and being
              part of my journey,{' '}
              <Text style={tw`font-sans-bold text-primary underline`}>
                Godbless!
              </Text>
            </Text>
          </HeroLottieCard>

          <Text
            style={tw`mb-3.5 ml-1 mt-7 font-sans-bold text-[18px] text-white`}
          >
            Choose your tip
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
          >
            {TIPS.map((tip, i) => {
              const active = tip.amount === activePreset;
              const last = i === TIPS.length - 1;
              return (
                <Pressable
                  key={tip.amount}
                  onPress={() => pickPreset(tip.amount)}
                  style={({ pressed }) => [
                    { width: TIP_W },
                    last ? null : tw`mr-3`,
                    pressed ? { transform: [{ scale: 0.97 }] } : null,
                  ]}
                >
                  <View
                    style={[
                      tw`overflow-hidden rounded-3xl border bg-[#1b1332] p-4`,
                      { height: TIP_H },
                      active
                        ? [tw`border-primary/70`, ctaGlow]
                        : tw`border-white/5`,
                    ]}
                  >
                    <LottieView
                      source={tipBg}
                      autoPlay={false}
                      progress={0}
                      resizeMode="cover"
                      style={tw`absolute inset-0`}
                    />
                    {active ? (
                      <View
                        style={[
                          tw`absolute inset-0`,
                          { backgroundColor: '#22d3ee22' },
                        ]}
                      />
                    ) : null}
                    <View style={tw`flex-row items-center justify-between`}>
                      {active ? (
                        <View style={tw`flex-row items-center`}>
                          <Check size={15} color={CYAN} strokeWidth={3} />
                          <Text
                            style={tw`ml-1 font-sans-semibold text-[12px] text-primary`}
                          >
                            Selected
                          </Text>
                        </View>
                      ) : (
                        <View />
                      )}
                      <Heart
                        size={16}
                        color={CYAN}
                        fill={active ? CYAN : 'transparent'}
                      />
                    </View>
                    <View style={tw`flex-1`} />
                    <Text
                      style={[
                        tw`font-sans-bold text-[30px] text-white`,
                        textOutline,
                      ]}
                    >
                      ₱{tip.amount}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        tw`mt-1 font-sans text-[12px] leading-4 text-white/80`,
                        textOutline,
                      ]}
                    >
                      {tip.note}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={tw`my-6 flex-row items-center`}>
            <View style={tw`h-px flex-1 bg-white/10`} />
            <Text style={tw`mx-3 font-sans text-[13px] text-slate-500`}>
              or
            </Text>
            <View style={tw`h-px flex-1 bg-white/10`} />
          </View>

          <View
            style={[
              tw`flex-row items-center rounded-full border bg-white/5 px-5`,
              custom.trim().length > 0
                ? tw`border-primary/40`
                : tw`border-white/10`,
            ]}
          >
            <Text style={tw`font-sans-bold text-[17px] text-slate-400`}>₱</Text>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Enter custom amount"
              placeholderTextColor="#5b6472"
              keyboardType="number-pad"
              selectionColor={CYAN}
              style={tw`ml-2 flex-1 py-4 font-sans-medium text-[15px] text-white`}
            />
          </View>

          <Text
            style={tw`mb-3.5 ml-1 mt-8 font-sans-bold text-[18px] text-white`}
          >
            Select payment
          </Text>
          {allMethods.map((entry, i) => {
            const active = entry.id === methodId;
            const last = i === allMethods.length - 1;
            return (
              <Pressable
                key={entry.id}
                onPress={() => pickMethod(entry.id)}
                android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
                style={[
                  tw`flex-row items-center rounded-full border py-3 pl-4 pr-3`,
                  last ? null : tw`mb-3`,
                  active
                    ? tw`border-primary/50 bg-primary/10`
                    : tw`border-white/10 bg-white/5`,
                ]}
              >
                <View
                  style={[
                    tw`h-6 w-6 items-center justify-center rounded-full border-2`,
                    active ? tw`border-primary` : tw`border-white/25`,
                  ]}
                >
                  {active ? (
                    <View style={tw`h-3 w-3 rounded-full bg-primary`} />
                  ) : null}
                </View>
                <Text
                  style={tw`ml-3.5 flex-1 font-sans-semibold text-[16px] text-white`}
                >
                  {entry.label}
                </Text>
                {entry.kind === 'paymongo' ? (
                  <View
                    style={tw`h-[42px] w-[42px] items-center justify-center`}
                  >
                    <View
                      style={[
                        tw`h-[35px] w-[35px] items-center justify-center rounded-full`,
                        { backgroundColor: '#0070BA' },
                      ]}
                    >
                      <Wallet size={19} color="#ffffff" strokeWidth={2.4} />
                    </View>
                  </View>
                ) : entry.kind === 'qr' ? (
                  entry.id === 'gcash' ? (
                    <View
                      style={tw`h-[42px] w-[42px] items-center justify-center`}
                    >
                      <View
                        style={[
                          tw`h-[35px] w-[35px] items-center justify-center rounded-full`,
                          { backgroundColor: '#0070BA' },
                        ]}
                      >
                        <GCashIcon size={25} />
                      </View>
                    </View>
                  ) : (
                    <View
                      style={tw`h-[42px] w-[42px] items-center justify-center`}
                    >
                      <View
                        style={[
                          tw`h-[35px] w-[35px] items-center justify-center rounded-full`,
                          { backgroundColor: '#0070BA' },
                        ]}
                      >
                        <GoTymeIcon size={24} />
                      </View>
                    </View>
                  )
                ) : (
                  <PayPalIcon size={42} />
                )}
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => {
              if (!method) return;
              if (method.kind === 'paymongo') {
                setPayOpen(true);
                return;
              }
              onPay(method, amount);
            }}
            disabled={!method}
            style={({ pressed }) => [
              tw`mt-8`,
              pressed && method ? { transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            <LinearGradient
              colors={method ? ['#22d3ee', '#06b6d4'] : ['#1e293b', '#1e293b']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                tw`items-center rounded-full py-4`,
                method ? ctaGlow : null,
              ]}
            >
              <Text
                style={[
                  tw`font-sans-bold text-[16px]`,
                  { color: method ? '#04101f' : '#64748b' },
                ]}
              >
                {method ? `Support via ${method.label}` : 'Choose a method'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingForm>
      {payOpen ? (
        <PayMongoCheckoutModal
          amount={amount ?? TIPS[0]?.amount ?? 50}
          onExit={() => setPayOpen(false)}
        />
      ) : null}
    </View>
  );
}
