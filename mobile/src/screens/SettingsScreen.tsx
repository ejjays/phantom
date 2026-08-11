import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Linking,
  AppState,
  StatusBar,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { ChevronRight, Check, Ghost } from 'lucide-react-native';
import { tapSelection, tapSuccess, setHapticsEnabled } from '../lib/haptics';
import { cacheSize, clearCache, formatBytes } from '../lib/diskcache';
import tw from '../lib/tw';
import BottomSheet from '../components/sheets/BottomSheet';
import ShareAppSheet from '../components/sheets/ShareAppSheet';
import AvatarPicker from '../components/AvatarPicker';
import Avatar from '../components/Avatar';
import ThemeSwitch from '../components/ThemeSwitch';
import switchTheme from 'react-native-theme-switch-animation';
import SupportPage, { type SupportMethod } from '../components/SupportPage';
import PayMongoCheckoutModal, {
  type CheckoutResult,
} from '../components/PayMongoCheckoutModal';
import SupportCarousel from '../components/SupportCarousel';
import Card from '../components/Card';
import AccountPanel, { AccountSkeleton } from '../components/AccountPanel';
import LottieView from 'lottie-react-native';
import filenameAnim from '../../assets/filename.json';
import {
  FolderIcon,
  FileIcon,
  PasteIcon,
  NotificationIcon,
  SocialIcon,
  HapticsIcon,
  BatteryIcon,
  ClearCacheIcon,
  PrivacyIcon,
  VersionIcon,
  GoogleIcon,
  ShareAppIcon,
} from '../components/icons';
import {
  getFilenameFormat,
  setFilenameFormat,
  getAutoPaste,
  setAutoPaste,
  getNotify,
  setNotify,
  getHaptics,
  setHaptics,
  getDarkTheme,
  setDarkTheme,
  formatName,
  type FilenameFormat,
} from '../lib/settings';
import { enableNotifications } from '../lib/notify';
import {
  isBatteryRestricted,
  requestIgnoreBatteryOptimization,
} from '../lib/fgservice';
import {
  isSupabaseConfigured,
  getAccount,
  changeUsername,
  onAuthChange,
  validateUsername,
  suggestUsernameFrom,
  syncProfileAvatar,
  setPresetAvatar,
  getSocialNotify,
  setSocialNotify,
  signInAsGuest,
  displayName,
  messageOf,
  type Account,
} from '../lib/social/updates';
import { signInWithGoogle, signOutGoogle } from '../lib/social/googleAuth';
import { AVATAR_CATEGORIES, presetMarker } from '../lib/avatars';
import { useSubScreen } from '../hooks/useSubScreen';

const CYAN = '#22d3ee';
const DARK_BG = '#030014';
const LIGHT_BG = '#eef2f8';

const PALETTE = (light: boolean) => ({
  text: light ? '#0f172a' : '#ffffff',
  hint: light ? '#64748b' : '#94a3b8',
  label: light ? '#475569' : '#64748b',
  rowBorder: light ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.05)',
  toggleOff: light ? '#cbd5e1' : '#334155',
  ghostBg: light ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.05)',
  ghostBorder: light ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.15)',
  ghostText: light ? '#334155' : '#e2e8f0',
  chevron: light ? '#94a3b8' : '#475569',
  good: light ? '#059669' : '#4ade80',
  warn: light ? '#d97706' : '#fbbf24',
  error: light ? '#dc2626' : '#f87171',
});
const buttonGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

const SUPPORT_METHODS: readonly SupportMethod[] = [
  {
    id: 'gcash',
    label: 'E-Wallet & QR Ph',
    kind: 'paymongo',
  },
  {
    id: 'paypal',
    label: 'PayPal',
    kind: 'paypal',
    url: 'https://www.paypal.me/christson021',
  },
];

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

type IconType = ComponentType<{ size?: number; color?: string }>;

function Toggle({ value, light }: { value: boolean; light?: boolean }) {
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(value ? 20 : 0, { duration: 170 }) }],
  }));
  return (
    <View
      style={[
        tw`h-7 w-12 justify-center rounded-full px-0.5`,
        value
          ? tw`bg-primary`
          : { backgroundColor: PALETTE(!!light).toggleOff },
      ]}
    >
      <Animated.View style={[tw`h-6 w-6 rounded-full bg-white`, knobStyle]} />
    </View>
  );
}

function SectionLabel({
  children,
  center,
  light,
}: {
  children: string;
  center?: boolean;
  light?: boolean;
}) {
  return (
    <Text
      style={[
        tw`mb-3 mt-8 font-sans-semibold text-[13px]`,
        center ? tw`text-center` : tw`ml-1`,
        { color: PALETTE(!!light).label },
      ]}
    >
      {children}
    </Text>
  );
}

function SettingsSupport({
  isWide,
  visible,
  light,
  onOpenSupport,
  onOpenSource,
  onOpenSocial,
}: {
  isWide: boolean;
  visible: boolean;
  light?: boolean;
  onOpenSupport: () => void;
  onOpenSource: () => void;
  onOpenSocial: (url: string) => void;
}) {
  return (
    <View style={isWide ? { width: 380 } : tw`w-full`}>
      <SectionLabel center={isWide} light={light}>Support</SectionLabel>
      <SupportCarousel
        visible={visible}
        layout={isWide ? 'stack' : 'carousel'}
        width={isWide ? 380 : undefined}
        onOpenSupport={onOpenSupport}
        onOpenSource={onOpenSource}
        onOpenSocial={onOpenSocial}
      />
    </View>
  );
}

function SettingsBody({
  isWide,
  support,
  note,
  children,
  themeSwitch,
  light,
}: {
  isWide: boolean;
  support: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  themeSwitch?: ReactNode;
  light?: boolean;
}) {
  return (
    <View style={[tw`w-full`, { maxWidth: isWide ? 1060 : 600 }]}>
      <View
        style={tw`mb-1 flex-row items-center justify-between`}
      >
        <Text
          style={[
            tw`font-sans-bold text-[32px] tracking-tight`,
            { color: PALETTE(!!light).text },
          ]}
        >
          Settings
        </Text>
        {themeSwitch}
      </View>
      {note}
      <View
        style={isWide ? [tw`flex-row items-start`, { gap: 72 }] : tw`w-full`}
      >
        <View style={isWide ? [tw`flex-1`, { maxWidth: 600 }] : tw`w-full`}>
          {children}
        </View>
        {support}
      </View>
    </View>
  );
}

function RowShell({
  Icon,
  label,
  hint,
  last,
  tile = true,
  iconSize,
  children,
  light,
}: {
  Icon: IconType;
  label: string;
  hint?: string;
  last?: boolean;
  tile?: boolean;
  iconSize?: number;
  children: React.ReactNode;
  light?: boolean;
}) {
  const palette = PALETTE(!!light);
  return (
    <View style={tw`flex-row items-center pl-4`}>
      <View
        style={[
          tw`h-10 w-10 items-center justify-center rounded-2xl`,
          tile && tw`bg-primary/15`,
        ]}
      >
        <Icon size={iconSize ?? (tile ? 19 : 28)} color={CYAN} />
      </View>
      <View
        style={[
          tw`ml-3.5 flex-1 flex-row items-center py-4 pr-4`,
          !last && { borderBottomWidth: 1, borderBottomColor: palette.rowBorder },
        ]}
      >
        <View style={tw`flex-1`}>
          <Text style={[tw`font-sans-semibold text-[15px]`, { color: palette.text }]}>
            {label}
          </Text>
          {hint ? (
            <Text style={[tw`mt-0.5 font-sans text-[12px]`, { color: palette.hint }]}>
              {hint}
            </Text>
          ) : null}
        </View>
        {children}
      </View>
    </View>
  );
}

function ToggleRow(props: {
  Icon: IconType;
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  last?: boolean;
  tile?: boolean;
  iconSize?: number;
  light?: boolean;
}) {
  const { value, onValueChange, light, ...rest } = props;
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
    >
      <RowShell {...rest} light={light}>
        <Toggle value={value} light={light} />
      </RowShell>
    </Pressable>
  );
}

function ValueLabel({
  value,
  tone,
  light,
}: {
  value: string;
  tone?: 'good' | 'warn';
  light?: boolean;
}) {
  if (!tone) {
    return (
      <Text
        numberOfLines={1}
        style={[
          tw`mr-2 max-w-[150px] font-sans-medium text-[13px]`,
          { color: PALETTE(!!light).hint },
        ]}
      >
        {value}
      </Text>
    );
  }
  return (
    <View
      style={[
        tw`mr-2 rounded-full px-2.5 py-1`,
        tone === 'good' ? tw`bg-green-500/15` : tw`bg-amber-500/15`,
      ]}
    >
      <Text
        style={[
          tw`font-sans-semibold text-[12px]`,
          { color: PALETTE(!!light)[tone === 'good' ? 'good' : 'warn'] },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function LinkRow(props: {
  Icon: IconType;
  label: string;
  hint?: string;
  value?: string;
  tone?: 'good' | 'warn';
  last?: boolean;
  onPress?: () => void;
  tile?: boolean;
  iconSize?: number;
  light?: boolean;
}) {
  const { value, onPress, tone, light, ...rest } = props;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
    >
      <RowShell {...rest} light={light}>
        {value ? <ValueLabel value={value} tone={tone} light={light} /> : null}
        <ChevronRight size={18} color={PALETTE(!!light).chevron} />
      </RowShell>
    </Pressable>
  );
}

function AccountCard({
  account,
  onPress,
  light,
}: {
  account: Account;
  onPress: () => void;
  light?: boolean;
}) {
  const palette = PALETTE(!!light);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Manage account"
      android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
    >
      <Card light={light}>
        <View style={tw`flex-row items-center p-4`}>
          <View>
            <Avatar
              name={displayName(account.username ?? account.name ?? 'G')}
              uri={account.avatarUrl}
              size={52}
            />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: -4,
                left: -4,
                right: -4,
                bottom: -4,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: CYAN,
              }}
            />
          </View>
          <View style={tw`ml-3.5 flex-1`}>
            <Text
              numberOfLines={1}
              style={[tw`font-sans-semibold text-[16px]`, { color: palette.text }]}
            >
              {account.isGuest
                ? displayName(account.username)
                : account.username
                  ? `@${account.username}`
                  : 'Finish setup'}
            </Text>
            <Text
              numberOfLines={1}
              style={[tw`mt-0.5 font-sans text-[12px]`, { color: palette.hint }]}
            >
              {account.isGuest
                ? 'Guest — link Google to keep your reactions'
                : (account.email ?? 'Tap to manage your account')}
            </Text>
          </View>
          <ChevronRight size={20} color={palette.chevron} />
        </View>
      </Card>
    </Pressable>
  );
}

function SignInCard({
  signingIn,
  onGoogle,
  onGuest,
  light,
}: {
  signingIn: boolean;
  onGoogle: () => void;
  onGuest: () => void;
  light?: boolean;
}) {
  const palette = PALETTE(!!light);
  return (
    <View>
      <Pressable
        onPress={onGuest}
        disabled={signingIn}
        accessibilityRole="button"
        accessibilityLabel="Continue as Anonymous"
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: palette.ghostBorder,
            backgroundColor: palette.ghostBg,
            paddingVertical: 14,
          },
          pressed ? { transform: [{ scale: 0.98 }] } : null,
        ]}
      >
        {signingIn ? (
          <ActivityIndicator color={CYAN} />
        ) : (
          <Ghost size={18} color={palette.ghostText} strokeWidth={2} />
        )}
        <Text
          style={[tw`ml-3 font-sans-semibold text-[15px]`, { color: palette.ghostText }]}
        >
          Continue as Anonymous
        </Text>
      </Pressable>
      <Pressable
        onPress={onGoogle}
        disabled={signingIn}
        accessibilityRole="button"
        accessibilityLabel="Sign in with Google"
        style={({ pressed }) => [
          tw`mt-2 flex-row items-center justify-center rounded-full bg-white py-3.5`,
          pressed ? { transform: [{ scale: 0.98 }] } : null,
        ]}
      >
        {signingIn ? (
          <ActivityIndicator color={CYAN} />
        ) : (
          <GoogleIcon size={18} />
        )}
        <Text style={tw`ml-3 font-sans-semibold text-[15px] text-[#1f1f1f]`}>
          Sign in with Google
        </Text>
      </Pressable>
    </View>
  );
}

function SettingsScreen({
  visible,
  onFullScreen,
}: {
  visible: boolean;
  onFullScreen?: (open: boolean) => void;
}) {
  const progress = useSharedValue(0);
  const scrollRef = useRef<ScrollView>(null);
  const switchOrigin = useRef({ x: 0, y: 0 });
  const toggling = useRef(false);
  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: 160 });
  }, [visible, progress]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const [format, setFormat] = useState<FilenameFormat>('artist-title');
  const [autopaste, setAutopaste] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notifs, setNotifs] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [darkOn, setDarkOn] = useState(false);
  const [cacheBytes, setCacheBytes] = useState(() => cacheSize());
  const [batteryRestricted, setBatteryRestricted] = useState<boolean | null>(
    null
  );
  const [account, setAccount] = useState<Account | null>(null);
  const [socialNotify, setSocialNotifyState] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState<number | null>(null);

  // sub-screen hooks cut animation boilerplate
  const accountScreen = useSubScreen(visible);
  const avatarScreen = useSubScreen(visible);
  const supportScreen = useSubScreen(visible);

  // qr slide-up vs slide-right
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 768;

  // reset scroll on tab exit
  useEffect(() => {
      if (visible) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    accountScreen.setOpen(false);
    avatarScreen.setOpen(false);
    supportScreen.setOpen(false);
        setPickerOpen(false);
        setSignOutOpen(false);
        setShareOpen(false);
        setPayOpen(false);
  }, [visible, accountScreen, avatarScreen, supportScreen]);

  useEffect(() => {
        onFullScreen?.(avatarScreen.open || supportScreen.open);
  }, [avatarScreen.open, supportScreen.open, onFullScreen]);

  useEffect(() => {
    getFilenameFormat()
      .then(setFormat)
      .catch(() => undefined);
    getAutoPaste()
      .then(setAutopaste)
      .catch(() => undefined);
    getNotify()
      .then(setNotifs)
      .catch(() => undefined);
    getHaptics()
      .then(setHapticsOn)
      .catch(() => undefined);
    getDarkTheme()
      .then(setDarkOn)
      .catch(() => undefined);
  }, []);

  const handleSwitchOrigin = useCallback((point: { x: number; y: number }) => {
    switchOrigin.current = point;
  }, []);

  const toggleTheme = () => {
    if (toggling.current) return;
    const targetDark = !darkOn;
    const bodyW = Math.min(windowWidth - 40, 600);
    const origin =
      switchOrigin.current.x !== 0 || switchOrigin.current.y !== 0
        ? switchOrigin.current
        : { x: (windowWidth - bodyW) / 2 + bodyW - 46, y: 92 };
    toggling.current = true;
    tapSelection();
    const { width: winW, height: winH } = Dimensions.get('window');
    switchTheme({
      switchThemeFunction: () => {
        setDarkOn(targetDark);
        setDarkTheme(targetDark).catch(() => undefined);
      },
animationConfig: {
        type: 'circular',
        duration: 900,
        startingPoint: {
          cxRatio: origin.x / winW,
          cyRatio: origin.y / winH,
        },
      },
    });
    setTimeout(() => {
      toggling.current = false;
    }, 1100);
  };

  useEffect(() => {
    const check = () => {
      isBatteryRestricted()
        .then(setBatteryRestricted)
        .catch(() => undefined);
    };
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ready gated by async auth load
      setAuthReady(true);
      return undefined;
    }
    let active = true;
    const load = () => {
      getAccount()
        .then((acc) => {
          if (active) setAccount(acc);
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setAuthReady(true);
        });
    };
    load();
    const unsub = onAuthChange(load);
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const wasVisible = useRef(visible);
  useEffect(() => {
      if (visible && !wasVisible.current && isSupabaseConfigured) {
      getAccount()
        .then((acc) => setAccount(acc))
        .catch(() => undefined);
    }
    wasVisible.current = visible;
  }, [visible]);

  useEffect(() => {
      if (account?.username) {
      getSocialNotify()
        .then(setSocialNotifyState)
        .catch(() => undefined);
    }
  }, [account?.username]);

  const toggleSocialNotify = (value: boolean) => {
    setSocialNotifyState(value);
    setSocialNotify(value).catch(() => undefined);
  };

  const choose = (f: FilenameFormat) => {
    tapSelection();
    setFormat(f);
    setFilenameFormat(f).catch(() => undefined);
    setTimeout(() => setPickerOpen(false), 150);
  };

  const toggleAutopaste = (v: boolean) => {
    setAutopaste(v);
    setAutoPaste(v).catch(() => undefined);
  };

  const toggleNotify = (v: boolean) => {
    if (!v) {
      setNotifs(false);
      setNotify(false).catch(() => undefined);
      return;
    }
    enableNotifications()
      .then(setNotifs)
      .catch(() => undefined);
  };

  const toggleHaptics = (v: boolean) => {
    setHapticsOn(v);
    setHaptics(v).catch(() => undefined);
    setHapticsEnabled(v);
    if (v) tapSelection();
  };

  const clearAppCache = () => {
    tapSelection();
    clearCache();
    setCacheBytes(0);
  };

  const openBattery = () => {
    tapSelection();
    requestIgnoreBatteryOptimization().catch(() => undefined);
  };

  const openSourceCode = () => {
    tapSelection();
    Linking.openURL('https://github.com/ejjays/phantom').catch(() => undefined);
  };

  const openSocial = (url: string) => {
    if (!url) return;
    Linking.openURL(url).catch(() => undefined);
  };

  const openSupportPage = () => {
    tapSelection();
    supportScreen.setOpen(true);
  };

  const paySupport = (method: SupportMethod, amount: number | null) => {
    if (method.kind === 'paymongo') {
      if (amount == null) return;
      tapSelection();
      setPayAmount(amount);
      setPayOpen(true);
      return;
    }
    tapSelection();
    const url = amount ? `${method.url}/${amount}PHP` : method.url;
    Linking.openURL(url).catch(() => undefined);
  };

  const openAvatarPicker = () => {
    tapSelection();
    avatarScreen.setOpen(true);
  };

  const pickAvatar = (id: string) => {
    const previous = account?.avatarUrl ?? null;
    tapSuccess();
    setAccount((prev) =>
      prev ? { ...prev, avatarUrl: presetMarker(id) } : prev
    );
    avatarScreen.setOpen(false);
    setPresetAvatar(id).catch((err) => {
      setAccount((prev) => (prev ? { ...prev, avatarUrl: previous } : prev));
      setAuthError(messageOf(err));
    });
  };

  const handleSignIn = async () => {
    tapSelection();
    setAuthError(null);
    setSigningIn(true);
    try {
      const uid = await signInWithGoogle();
      if (!uid) return;
      void syncProfileAvatar();
      const acc = await getAccount();
      setAccount(acc);
      if (acc && !acc.username) {
        setNameValue(suggestUsernameFrom(acc.name));
        setNameError(null);
        accountScreen.setOpen(true);
      } else {
        setNameValue(acc?.username ?? '');
        setNameError(null);
        accountScreen.setOpen(false);
        tapSuccess();
      }
    } catch (err) {
      setAuthError(messageOf(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handleGuestSignIn = async () => {
    tapSelection();
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInAsGuest();
      const acc = await getAccount();
      setAccount(acc);
      tapSuccess();
    } catch (err) {
      setAuthError(messageOf(err));
    } finally {
      setSigningIn(false);
    }
  };

  const saveName = async () => {
    const check = validateUsername(nameValue);
    if (!check.ok) {
      setNameError(check.error);
      return;
    }
    setNameBusy(true);
    setNameError(null);
    try {
      const result = await changeUsername(check.value);
      if (result === 'taken') {
        setNameError('that username is taken');
        return;
      }
      tapSuccess();
      setAccount((prev) => (prev ? { ...prev, username: check.value } : prev));
    } catch (err) {
      setNameError(messageOf(err));
    } finally {
      setNameBusy(false);
    }
  };

  const doSignOut = async () => {
    setSignOutOpen(false);
    accountScreen.setOpen(false);
    try {
      await signOutGoogle();
      setAccount(null);
    } catch (err) {
      setAuthError(messageOf(err));
    }
  };

  const settingsSections = (light: boolean) => (
    <>
      {isSupabaseConfigured ? (
        <>
          <SectionLabel light={light}>Account</SectionLabel>
          {!authReady ? (
            <AccountSkeleton />
          ) : account ? (
            <AccountCard
              account={account}
              light={light}
              onPress={() => {
                tapSelection();
                setNameValue(account?.username ?? '');
                setNameError(null);
                accountScreen.setOpen(true);
              }}
            />
          ) : (
            <SignInCard
              signingIn={signingIn}
              light={light}
              onGoogle={() => void handleSignIn()}
              onGuest={() => void handleGuestSignIn()}
            />
          )}
          {authError ? (
            <Text
              style={[
                tw`ml-1 mt-2 font-sans text-[12px]`,
                { color: PALETTE(light).error },
              ]}
            >
              {authError}
            </Text>
          ) : null}
        </>
      ) : null}

      <SectionLabel light={light}>Downloads</SectionLabel>
      <Card light={light}>
        <RowShell
          Icon={FolderIcon}
          label="Save location"
          hint="Movies/Phantom · Music/Phantom"
          tile={false}
          iconSize={26}
          light={light}
        >
          {null}
        </RowShell>
        <LinkRow
          Icon={FileIcon}
          label="Filename format"
          hint={`${formatName(format, 'Best video', 'MrBeast', 'youtube')}.mp4`}
          onPress={() => setPickerOpen(true)}
          tile={false}
          iconSize={26}
          light={light}
        />
        <ToggleRow
          Icon={NotificationIcon}
          label="Download alerts"
          hint="Notify when a download finishes"
          value={notifs}
          onValueChange={toggleNotify}
          tile={false}
          iconSize={26}
          light={light}
        />
        <ToggleRow
          Icon={PasteIcon}
          label="Auto-detect clipboard"
          hint="Fill copied link when you return"
          value={autopaste}
          onValueChange={toggleAutopaste}
          last
          tile={false}
          iconSize={26}
          light={light}
        />
      </Card>

      <SectionLabel light={light}>App</SectionLabel>
      <Card light={light}>
        {account ? (
          <ToggleRow
            Icon={SocialIcon}
            label="Social notifications"
            hint="Replies, mentions & likes on your comments"
            value={socialNotify}
            onValueChange={toggleSocialNotify}
            tile={false}
            iconSize={26}
            light={light}
          />
        ) : null}
        <ToggleRow
          Icon={HapticsIcon}
          label="Haptics"
          hint="Vibrate on taps and actions"
          value={hapticsOn}
          onValueChange={toggleHaptics}
          tile={false}
          iconSize={27}
          light={light}
        />
        <LinkRow
          Icon={BatteryIcon}
          label="Battery optimization"
          hint={
            batteryRestricted === false
              ? 'Allowed to run without limits'
              : 'Stop Android pausing long downloads'
          }
          value={batteryRestricted === false ? 'Off' : 'Fix'}
          tone={batteryRestricted === false ? 'good' : 'warn'}
          onPress={openBattery}
          tile={false}
          light={light}
        />
        <LinkRow
          Icon={ShareAppIcon}
          label="Share app"
          hint="Send Phantom to a friend"
          onPress={() => {
            tapSelection();
            setShareOpen(true);
          }}
          tile={false}
          iconSize={26}
          light={light}
        />
        <LinkRow
          Icon={ClearCacheIcon}
          label="Clear cache"
          value={cacheBytes > 0 ? formatBytes(cacheBytes) : 'Empty'}
          onPress={clearAppCache}
          tile={false}
          last
          iconSize={26}
          light={light}
        />
      </Card>

      <SectionLabel light={light}>About</SectionLabel>
      <Card light={light}>
        <LinkRow
          Icon={PrivacyIcon}
          label="Privacy"
          hint="Everything runs on your device"
          tile={false}
          iconSize={26}
          light={light}
        />
        <LinkRow
          Icon={VersionIcon}
          label="Version"
          value="1.1.0"
          tile={false}
          last
          iconSize={24}
          light={light}
        />
      </Card>
    </>
  );

  const noteBanner =
    isSupabaseConfigured && authReady && !account ? (
      <View style={tw`mx-[-20px] mt-3 bg-cyan-500 px-5 py-1.5`}>
        <Text style={tw`font-sans text-[12px] leading-4 text-white`}>
          <Text style={tw`font-sans-bold`}>Note: </Text>
          Sign-in is only for reactions and comments in Updates tab —
          it&apos;s not used in the actual downloads.
        </Text>
      </View>
    ) : null;

  return (
    <>
      {visible ? (
        <StatusBar
          barStyle={darkOn ? 'light-content' : 'dark-content'}
          backgroundColor={darkOn ? DARK_BG : LIGHT_BG}
        />
      ) : null}
      <View
        pointerEvents={visible ? 'auto' : 'none'}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            tw`bg-background`,
            fadeStyle,
            { backgroundColor: darkOn ? DARK_BG : LIGHT_BG },
          ]}
        />
        <Animated.ScrollView
        ref={scrollRef}
        style={[tw`flex-1`, fadeStyle]}
        contentContainerStyle={tw`items-center px-5 pb-36 pt-16`}
        showsVerticalScrollIndicator={false}
      >
        <SettingsBody
          isWide={isWide}
          light={!darkOn}
          themeSwitch={
            <ThemeSwitch
              dark={darkOn}
              instant
              visible={visible}
              onToggle={toggleTheme}
              onOrigin={handleSwitchOrigin}
            />
          }
          note={noteBanner}
          support={
            <SettingsSupport
              isWide={isWide}
              visible={visible}
              light={!darkOn}
              onOpenSupport={openSupportPage}
              onOpenSource={openSourceCode}
              onOpenSocial={openSocial}
            />
          }
        >
          {settingsSections(!darkOn)}
        </SettingsBody>
      </Animated.ScrollView>

      <Animated.View
        pointerEvents={accountScreen.open ? 'auto' : 'none'}
        style={[
          StyleSheet.absoluteFill,
          tw`bg-background`,
          accountScreen.style,
        ]}
      >
        {accountScreen.mounted && (
          <AccountPanel
            account={account}
            nameValue={nameValue}
            onChangeName={setNameValue}
            onSave={() => void saveName()}
            saving={nameBusy}
            error={nameError}
            onBack={() => {
              tapSelection();
              accountScreen.setOpen(false);
            }}
            onSignOut={() => setSignOutOpen(true)}
            onEditAvatar={openAvatarPicker}
            onLinkGoogle={() => void handleSignIn()}
          />
        )}
      </Animated.View>

      <Animated.View
        pointerEvents={avatarScreen.open ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, tw`bg-background`, avatarScreen.style]}
      >
        {avatarScreen.mounted && (
          <AvatarPicker
            categories={AVATAR_CATEGORIES}
            current={account?.avatarUrl ?? null}
            onPick={pickAvatar}
            onBack={() => {
              tapSelection();
              avatarScreen.setOpen(false);
            }}
          />
        )}
      </Animated.View>

      <Animated.View
        pointerEvents={supportScreen.open ? 'auto' : 'none'}
        style={[
          StyleSheet.absoluteFill,
          tw`bg-background`,
          supportScreen.style,
        ]}
      >
        {supportScreen.mounted && (
          <SupportPage
            methods={SUPPORT_METHODS}
            onPay={paySupport}
            onBack={() => {
              tapSelection();
              supportScreen.setOpen(false);
            }}
          />
        )}
      </Animated.View>

      <BottomSheet open={pickerOpen} onClose={() => setPickerOpen(false)}>
        <View style={tw`items-center pb-1`}>
          <LottieView
            source={filenameAnim}
            autoPlay
            loop
            style={tw`h-32 w-32`}
          />
          <Text
            style={tw`mt-1 font-sans-bold text-[22px] tracking-tight text-white`}
          >
            Filename format
          </Text>
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
                onPress={() => choose(f)}
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
      </BottomSheet>

      <BottomSheet
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        border="subtle"
      >
        <View style={tw`items-center px-2 pt-2`}>
          <Text
            style={tw`font-sans-bold text-[22px] tracking-tight text-white`}
          >
            Log out
          </Text>
          <Text
            style={tw`mt-2 text-center font-sans text-[14px] leading-5 text-slate-400`}
          >
            You can sign back in anytime.
          </Text>
        </View>
        <View style={tw`mt-7 flex-row`}>
          <Pressable
            onPress={() => setSignOutOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Cancel sign out"
            style={({ pressed }) => [
              tw`flex-1 items-center rounded-full border border-white/10 bg-white/5 py-4`,
              pressed ? { transform: [{ scale: 0.97 }] } : null,
            ]}
          >
            <Text style={tw`font-sans-semibold text-[15px] text-slate-200`}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void doSignOut()}
            accessibilityRole="button"
            accessibilityLabel="Confirm log out"
            style={({ pressed }) => [
              tw`ml-3 flex-1 items-center rounded-full bg-red-500 py-4`,
              pressed ? { transform: [{ scale: 0.97 }] } : null,
            ]}
          >
            <Text style={tw`font-sans-bold text-[15px] text-white`}>
              Log out
            </Text>
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet open={shareOpen} onClose={() => setShareOpen(false)}>
        <ShareAppSheet />
      </BottomSheet>

      {payOpen && payAmount != null ? (
        <PayMongoCheckoutModal
          amount={payAmount}
          onExit={(result: CheckoutResult) => {
            setPayOpen(false);
            if (result === 'success') tapSuccess();
          }}
        />
      ) : null}
    </View>
    </>
  );
}

export default memo(SettingsScreen);
