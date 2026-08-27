import AsyncStorage from '@react-native-async-storage/async-storage';

const YT_COOKIE_KEY = 'phantom.cookie.youtube';
const BILI_COOKIE_KEY = 'phantom.cookie.bilibili';

const storedCookie = async (key: string): Promise<string> =>
  ((await AsyncStorage.getItem(key).catch(() => null)) ?? '').trim();

// user cookie unlocks login-gated HD; env var stays as build-time fallback
export async function getBilibiliCookie(): Promise<string> {
  const stored = await storedCookie(BILI_COOKIE_KEY);
  return stored || (process.env.EXPO_PUBLIC_BILIBILI_COOKIE ?? '').trim();
}

export function setBilibiliCookie(value: string): Promise<void> {
  return AsyncStorage.setItem(BILI_COOKIE_KEY, value.trim()).catch(
    () => undefined
  );
}

export function getYoutubeCookie(): Promise<string> {
  return storedCookie(YT_COOKIE_KEY);
}

export function setYoutubeCookie(value: string): Promise<void> {
  return AsyncStorage.setItem(YT_COOKIE_KEY, value.trim()).catch(
    () => undefined
  );
}

// optional IG session cookie — unlocks authenticated media API (high rate
// limits), sidestepping aggressively-throttled logged-out endpoint
export function getInstagramCookie(): string {
  return (process.env.EXPO_PUBLIC_IG_COOKIE ?? '').trim();
}

export type FilenameFormat = 'artist-title' | 'title' | 'title-platform';

const FORMAT_KEY = 'phantom.filename.format';
const AUTOPASTE_KEY = 'phantom.autopaste';
const NOTIFY_KEY = 'phantom.notify';
const NOTIFY_PRIMED_KEY = 'phantom.notify.primed';
const HAPTICS_KEY = 'phantom.haptics';
const SC_CLIENTID_KEY = 'phantom.soundcloud.clientid';
const ONBOARDED_KEY = 'phantom.onboarded';
const GENERIC_SNIFFER_KEY = 'phantom.genericSniffer';

export async function getOnboarded(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ONBOARDED_KEY).catch(() => null);
  return v === '1';
}

export async function setOnboarded(value: boolean): Promise<void> {
  await AsyncStorage.setItem(ONBOARDED_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

const SPEECH_MSG_KEY = 'phantom.speech.msgIdx';

const readIndex = (key: string) =>
  AsyncStorage.getItem(key)
    .then((v) => (v ? Number(v) : -1))
    .catch(() => -1);

export async function nextSpeechMsgIndex(count: number): Promise<number> {
  const next = await readIndex(SPEECH_MSG_KEY);
  const pick =
    Number.isInteger(next) && next >= 0 && next < count
      ? next
      : Math.floor(Math.random() * count);
  await AsyncStorage.setItem(SPEECH_MSG_KEY, String((pick + 1) % count)).catch(
    () => undefined
  );
  return pick;
}

const pickNoRepeat = async (key: string, count: number): Promise<number> => {
  const last = await readIndex(key);
  const validLast =
    Number.isInteger(last) && last >= 0 && last < count ? last : -1;
  let pick = Math.floor(Math.random() * count);
  if (count > 1 && pick === validLast) pick = (pick + 1) % count;
  await AsyncStorage.setItem(key, String(pick)).catch(() => undefined);
  return pick;
};

const QUIP_KEY = 'phantom.speech.quipIdx';

export function nextQuipIndex(count: number): Promise<number> {
  return pickNoRepeat(QUIP_KEY, count);
}

const IDLE_KEY = 'phantom.speech.idleIdx';

export function nextIdleIndex(count: number): Promise<number> {
  return pickNoRepeat(IDLE_KEY, count);
}

const BAD_LINK_KEY = 'phantom.speech.badLinkIdx';

export function nextBadLinkIndex(count: number): Promise<number> {
  return pickNoRepeat(BAD_LINK_KEY, count);
}

const SUCCESS_KEY = 'phantom.speech.successIdx';

export function nextSuccessIndex(count: number): Promise<number> {
  return pickNoRepeat(SUCCESS_KEY, count);
}

export async function getScClientId(): Promise<{
  id: string;
  at: number;
} | null> {
  const raw = await AsyncStorage.getItem(SC_CLIENTID_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: string; at?: number };
    return v.id && v.at ? { id: v.id, at: v.at } : null;
  } catch {
    return null;
  }
}

export async function setScClientId(id: string): Promise<void> {
  await AsyncStorage.setItem(
    SC_CLIENTID_KEY,
    JSON.stringify({ id, at: Date.now() })
  ).catch(() => undefined);
}

export async function getFilenameFormat(): Promise<FilenameFormat> {
  const v = await AsyncStorage.getItem(FORMAT_KEY).catch(() => null);
  if (v === 'title' || v === 'title-platform') return v;
  return 'artist-title';
}

export async function setFilenameFormat(value: FilenameFormat): Promise<void> {
  await AsyncStorage.setItem(FORMAT_KEY, value).catch(() => undefined);
}

export async function getAutoPaste(): Promise<boolean> {
  const v = await AsyncStorage.getItem(AUTOPASTE_KEY).catch(() => null);
  return v === '1';
}

export async function setAutoPaste(value: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTOPASTE_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export async function getNotify(): Promise<boolean> {
  const v = await AsyncStorage.getItem(NOTIFY_KEY).catch(() => null);
  return v === '1';
}

export async function setNotify(value: boolean): Promise<void> {
  await AsyncStorage.setItem(NOTIFY_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export async function getNotifyPrimed(): Promise<boolean> {
  const v = await AsyncStorage.getItem(NOTIFY_PRIMED_KEY).catch(() => null);
  return v === '1';
}

// generic webview sniffer is best-effort: opt-in only, off by default
export async function getGenericSnifferEnabled(): Promise<boolean> {
  const v = await AsyncStorage.getItem(GENERIC_SNIFFER_KEY).catch(() => null);
  return v === '1';
}

export async function setGenericSnifferEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(GENERIC_SNIFFER_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export async function setNotifyPrimed(value: boolean): Promise<void> {
  await AsyncStorage.setItem(NOTIFY_PRIMED_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export type HistoryView = 'list' | 'grid';

const HISTORY_VIEW_KEY = 'phantom.history.view';

export async function getHistoryView(): Promise<HistoryView> {
  const v = await AsyncStorage.getItem(HISTORY_VIEW_KEY).catch(() => null);
  return v === 'grid' ? 'grid' : 'list';
}

export async function setHistoryView(value: HistoryView): Promise<void> {
  await AsyncStorage.setItem(HISTORY_VIEW_KEY, value).catch(() => undefined);
}

export async function getHaptics(): Promise<boolean> {
  const v = await AsyncStorage.getItem(HAPTICS_KEY).catch(() => null);
  return v !== '0';
}

const DARK_THEME_KEY = 'phantom.theme.dark';

export async function getDarkTheme(): Promise<boolean> {
  const v = await AsyncStorage.getItem(DARK_THEME_KEY).catch(() => null);
  return v !== '0';
}

export async function setDarkTheme(value: boolean): Promise<void> {
  await AsyncStorage.setItem(DARK_THEME_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export async function setHaptics(value: boolean): Promise<void> {
  await AsyncStorage.setItem(HAPTICS_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export function formatName(
  fmt: FilenameFormat,
  title: string | undefined,
  artist: string | undefined,
  platform: string
): string {
  const t = (title ?? '').toString().trim() || 'Untitled';
  if (fmt === 'title') return t;
  if (fmt === 'title-platform') {
    const tag = platform.charAt(0).toUpperCase() + platform.slice(1);
    return `${t} (${tag})`;
  }
  return artist ? `${artist} - ${t}` : t;
}
