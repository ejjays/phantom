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
import { useBackHandler } from '../lib/back';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { ChevronRight, Ghost } from 'lucide-react-native';
import Constants from 'expo-constants';
import { tapSelection, tapSuccess, setHapticsEnabled } from '../lib/haptics';
import { cacheSize, clearCache, formatBytes } from '../lib/diskcache';
import tw from '../lib/tw';
import BottomSheet from '../components/sheets/BottomSheet';
import ShareAppSheet from '../components/sheets/ShareAppSheet';
import QrView from '../components/QrView';
import { buildGotymeQr, buildGcashQr } from '../lib/qrph';
import AvatarPicker from '../components/AvatarPicker';
import Avatar from '../components/Avatar';
import ThemeSwitch from '../components/ThemeSwitch';
import switchTheme from 'react-native-theme-switch-animation';
import SupportPage, { type SupportMethod } from '../components/SupportPage';
import SupportCarousel from '../components/SupportCarousel';
import Card from '../components/Card';
import AccountPanel, { AccountSkeleton } from '../components/AccountPanel';
import gcashQr from '../../assets/support/gcash-qr.png';
import gotymeQr from '../../assets/support/gotyme-qr.png';
import gotyme50 from '../../assets/support/gotyme-50.webp';
import gotyme100 from '../../assets/support/gotyme-100.webp';
import gotyme250 from '../../assets/support/gotyme-250.webp';
import gotyme500 from '../../assets/support/gotyme-500.webp';
import gcash50 from '../../assets/support/gcash-50.webp';
import gcash100 from '../../assets/support/gcash-100.webp';
import gcash250 from '../../assets/support/gcash-250.webp';
import gcash500 from '../../assets/support/gcash-500.webp';
import {
  FolderIcon,
  PasteIcon,
  DownloadsIcon,
  NotificationIcon,
  SocialIcon,
  HapticsIcon,
  BatteryIcon,
  ClearCacheIcon,
  PrivacyIcon,
  VersionIcon,
  GoogleIcon,
  ShareAppIcon,
  ExperimentIcon,
  FileIcon,
} from '../components/icons';
import {
  checkForUpdate,
  type UpdateManifest,
} from '../lib/updater/manifest';
import { downloadApk, installDownloadedApk } from '../lib/updater/install';
import {
  hasInstallPermission,
  openInstallPermissionSettings,
} from '../../modules/silent-updater';
import {
  getFilenameFormat,
  setFilenameFormat,
  getAutoPaste,
  setAutoPaste,
  getNotify,
  setNotify,
  getHaptics,
  setHaptics,
  getGenericSnifferEnabled,
  setGenericSnifferEnabled,
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
import { useAppDialog } from '../components/AppDialog';
import {
  AlertDialog,
  Host,
  Text as ComposeText,
  TextButton as ComposeTextButton,
  RadioButton,
  ListItem,
  Column,
} from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';

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
const SUPPORT_METHODS: readonly SupportMethod[] = [
  {
    id: 'gcash',
    label: 'GCash',
    kind: 'qr',
    source: gcashQr,
    amountQrs: { 50: gcash50, 100: gcash100, 250: gcash250, 500: gcash500 },
  },
  {
    id: 'gotyme',
    label: 'GoTyme',
    kind: 'qr',
    source: gotymeQr,
    amountQrs: { 50: gotyme50, 100: gotyme100, 250: gotyme250, 500: gotyme500 },
  },
  {
    id: 'paypal',
    label: 'PayPal',
    kind: 'paypal',
    url: 'https://www.paypal.me/christson021',
  },
];

const QR_BUILDERS: Record<string, (amount: number) => string> = {
  gcash: buildGcashQr,
  gotyme: buildGotymeQr,
};

type IconType = ComponentType<{ size?: number; color?: string }>;

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
  chevron?: boolean;
}) {
  const { value, onPress, tone, light, chevron = true, ...rest } = props;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
    >
      <RowShell {...rest} light={light}>
        {value ? <ValueLabel value={value} tone={tone} light={light} /> : null}
        {chevron ? (
          <ChevronRight size={18} color={PALETTE(!!light).chevron} />
        ) : null}
      </RowShell>
    </Pressable>
  );
}

function UpdateControl({ light }: { light?: boolean }) {
  const installed = Constants.expoConfig?.version ?? '0.0.0';
  const [status, setStatus] = useState<
    'checking' | 'none' | 'available' | 'downloading' | 'installing' | 'error' | 'permission'
  >('checking');
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    const update = await checkForUpdate(installed);
    if (!update) {
      setStatus('none');
      return;
    }
    setManifest(update.manifest);
    setStatus('available');
  }, [installed]);

  const install = useCallback(async () => {
    if (!manifest) return;
    if (!(await hasInstallPermission())) {
      setStatus('permission');
      await openInstallPermissionSettings();
      return;
    }
    setStatus('downloading');
    setProgress(0);
    abortRef.current = new AbortController();
    try {
      const path = await downloadApk(
        manifest,
        (written, total) => setProgress(total ? written / total : 0),
        abortRef.current.signal
      );
      setStatus('installing');
      await installDownloadedApk(path);
    } catch {
      abortRef.current = null;
      setStatus('error');
    }
  }, [manifest]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time update check
    void check();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // user returns from the "allow installs" settings screen: auto-resume
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || status !== 'permission') return;
      void install();
    });
    return () => sub.remove();
  }, [status, install]);

  const label =
    status === 'checking'
      ? 'Checking for updates…'
      : status === 'available' && manifest
        ? `Phantom ${manifest.version} available`
        : status === 'downloading'
          ? `Downloading ${Math.round(progress * 100)}%`
          : status === 'installing'
            ? 'Installing…'
            : status === 'permission'
              ? 'Allow installs to update'
              : status === 'error'
                ? 'Update failed'
                : 'Up to date';
  const hint =
    status === 'none'
      ? `You're on the latest version`
      : status === 'available' && manifest
        ? (manifest.notes ?? 'Includes fixes and improvements')
        : status === 'permission'
          ? 'Tap to grant "Install unknown apps" in settings'
          : status === 'error'
            ? 'Tap to retry'
            : 'Downloads silently — no Play Store needed';

  return (
    <>
      <SectionLabel light={light}>App update</SectionLabel>
      <Card light={light}>
        <LinkRow
          Icon={DownloadsIcon}
          label={label}
          hint={hint}
          value={status === 'none' ? `v${installed}` : undefined}
          onPress={() => {
            tapSelection();
            if (status === 'none' || status === 'checking') {
              setStatus('checking');
              void check();
            } else {
              void install();
            }
          }}
          tile={false}
          iconSize={26}
          light={light}
        />
        {status === 'available' ? (
          <View style={tw`px-4 pb-4`}>
            <Pressable
              onPress={() => {
                tapSelection();
                void install();
              }}
              accessibilityRole="button"
              android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
              style={[
                tw`rounded-full py-2.5 items-center`,
                { backgroundColor: CYAN },
              ]}
            >
              <Text style={tw`font-sans-bold text-[14px] text-white`}>
                Download &amp; install
              </Text>
            </Pressable>
          </View>
        ) : null}
        {status === 'downloading' ? (
          <View style={tw`h-1 mx-4 mb-4 rounded-full bg-neutral-200 overflow-hidden`}>
            <View
              style={{
                width: `${progress * 100}%`,
                backgroundColor: CYAN,
              }}
            />
          </View>
        ) : null}
      </Card>
    </>
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
  const [pendingFormat, setPendingFormat] = useState<FilenameFormat>('artist-title');
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [autopaste, setAutopaste] = useState(false);
  const [notifs, setNotifs] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(true);
  const [genericSniffer, setGenericSniffer] = useState(false);
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
  const [shareOpen, setShareOpen] = useState(false);

  // sub-screen hooks cut animation boilerplate
  const accountScreen = useSubScreen(visible);
  const avatarScreen = useSubScreen(visible);
  const supportScreen = useSubScreen(visible);
  const { showDialog } = useAppDialog();

  // qr slide-up vs slide-right
  const [qr, setQr] = useState<{
    source?: number;
    value?: string;
    label: string;
    note?: string;
  } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMounted, setQrMounted] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isWide = windowWidth >= 768;
  const qrProgress = useSharedValue(0);
  useEffect(() => {
    const opening = qrOpen;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mounted gates qr enter animation
    if (opening) setQrMounted(true);
    qrProgress.value = withTiming(
      opening ? 1 : 0,
      { duration: 260, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished && !opening) runOnJS(setQrMounted)(false);
      }
    );
  }, [qrOpen, qrProgress]);
  const qrStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - qrProgress.value) * windowHeight }],
  }));

  useBackHandler(() => {
    if (!visible || !qrOpen) return false;
    tapSelection();
    setQrOpen(false);
    return true;
  }, 10);

  useBackHandler(() => {
    if (!visible || !formatMenuOpen) return false;
    setFormatMenuOpen(false);
    return true;
  }, 10);

  // reset scroll on tab exit
  useEffect(() => {
      if (visible) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    accountScreen.setOpen(false);
    avatarScreen.setOpen(false);
    supportScreen.setOpen(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset overlays on tab exit
    setQrOpen(false);
        setShareOpen(false);
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
    getGenericSnifferEnabled()
      .then(setGenericSniffer)
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
    setFormatMenuOpen(false);
  };

  const formatClickable = (f: FilenameFormat) =>
  clickable(() => setPendingFormat(f), { indication: false });

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

  const toggleGenericSniffer = (v: boolean) => {
    tapSelection();
    setGenericSniffer(v);
    setGenericSnifferEnabled(v).catch(() => undefined);
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

  const openQr = (source: number, label: string, note?: string) => {
    tapSelection();
    setQr({ source, label, note });
    setQrOpen(true);
  };

  const paySupport = (method: SupportMethod, amount: number | null) => {
    if (method.kind === 'paypal') {
      tapSelection();
      const url = amount ? `${method.url}/${amount}PHP` : method.url;
      Linking.openURL(url).catch(() => undefined);
      return;
    }
    const note = amount
      ? `Scan in ${method.label} to send ₱${amount}. Thank you for the support!`
      : undefined;
    // amount w/o preset card -> generate QR Ph dynamically
    const build = QR_BUILDERS[method.id];
    if (build && amount != null && method.amountQrs?.[amount] == null) {
      tapSelection();
      setQr({ value: build(amount), label: method.label, note });
      setQrOpen(true);
      return;
    }
    const source =
      (amount != null ? method.amountQrs?.[amount] : undefined) ??
      method.source;
    openQr(source, method.label, note);
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
    accountScreen.setOpen(false);
    try {
      await signOutGoogle();
      setAccount(null);
    } catch (err) {
      setAuthError(messageOf(err));
    }
  };

  const handleSignOut = useCallback(() => {
    showDialog({
      title: 'Log out',
      message: 'You can sign back in anytime.',
      confirmLabel: 'Log out',
      destructive: true,
      onConfirm: () => void doSignOut(),
    });
  }, [showDialog]);

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
          onPress={() => {
            tapSelection();
            setPendingFormat(format);
            setFormatMenuOpen(true);
          }}
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
        {false && (
          <ToggleRow
            Icon={ExperimentIcon}
            label="Grab from any site"
            hint="Experimental: best-effort scan for unsupported links"
            value={genericSniffer}
            onValueChange={toggleGenericSniffer}
            tile={false}
            iconSize={27}
            light={light}
          />
        )}
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

      <UpdateControl light={light} />

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
          value={Constants.expoConfig?.version ?? '1.2.1'}
          tile={false}
          last
          chevron={false}
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
            onSignOut={handleSignOut}
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

      <BottomSheet open={shareOpen} onClose={() => setShareOpen(false)}>
        <ShareAppSheet />
      </BottomSheet>
      <Animated.View
        pointerEvents={qrOpen ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, qrStyle]}
      >
        {qrMounted && qr ? (
          <QrView
            source={qr.source}
            value={qr.value}
            label={qr.label}
            note={
              qr.note ??
              `Scan this in your ${qr.label} app to send a tip. Thank you for the support!`
            }
            onClose={() => {
              tapSelection();
              setQrOpen(false);
            }}
          />
        ) : null}
      </Animated.View>

      {formatMenuOpen ? (
        <Host matchContents>
          <AlertDialog
            onDismissRequest={() => setFormatMenuOpen(false)}
            colors={{
              containerColor: '#2a2150',
              titleContentColor: '#e2e8f0',
              textContentColor: '#cbd5e1',
            }}
          >
            <AlertDialog.Title>
              <ComposeText style={{ fontWeight: 'bold', fontSize: 20 }}>
                Filename format
              </ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <Column>
                {FORMAT_ORDER.map((f) => (
                  <ListItem
                    key={f}
                    tonalElevation={0}
                    colors={{
                      containerColor: '#2a2150',
                      supportingContentColor: '#8b95b5',
                    }}
                    modifiers={[formatClickable(f)]}
                  >
                    <ListItem.LeadingContent>
                      <RadioButton selected={pendingFormat === f} />
                    </ListItem.LeadingContent>
                    <ListItem.HeadlineContent>
                      <ComposeText>{FORMAT_LABELS[f]}</ComposeText>
                    </ListItem.HeadlineContent>
                    <ListItem.SupportingContent>
                      <ComposeText style={{ fontSize: 12 }}>
                        {`${formatName(f, 'Best video', 'MrBeast', 'youtube')}.mp4`}
                      </ComposeText>
                    </ListItem.SupportingContent>
                  </ListItem>
                ))}
              </Column>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <ComposeTextButton
                onClick={() => choose(pendingFormat)}
                colors={{ contentColor: '#22d3ee' }}
              >
                <ComposeText style={{ fontWeight: 'bold' }}>OK</ComposeText>
              </ComposeTextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <ComposeTextButton
                onClick={() => setFormatMenuOpen(false)}
                colors={{ contentColor: '#94a3b8' }}
              >
                <ComposeText style={{ fontWeight: 'bold' }}>Cancel</ComposeText>
              </ComposeTextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        </Host>
      ) : null}
    </View>
    </>
  );
}

export default memo(SettingsScreen);
