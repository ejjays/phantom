import AsyncStorage from '@react-native-async-storage/async-storage';

export function getBilibiliCookie(): string {
  return (process.env.EXPO_PUBLIC_BILIBILI_COOKIE ?? '').trim();
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

export async function nextSpeechMsgIndex(count: number): Promise<number> {
  const next = await AsyncStorage.getItem(SPEECH_MSG_KEY)
    .then((v) => (v ? Number(v) : 0))
    .catch(() => 0);
  await AsyncStorage.setItem(SPEECH_MSG_KEY, String((next + 1) % count)).catch(
    () => undefined
  );
  return next;
}

const QUIP_KEY = 'phantom.speech.quipIdx';

export async function nextQuipIndex(count: number): Promise<number> {
  const last = await AsyncStorage.getItem(QUIP_KEY)
    .then((v) => (v ? Number(v) : -1))
    .catch(() => -1);
  let pick = Math.floor(Math.random() * count);
  if (count > 1 && pick === last) pick = (pick + 1) % count;
  await AsyncStorage.setItem(QUIP_KEY, String(pick)).catch(() => undefined);
  return pick;
}

const IDLE_KEY = 'phantom.speech.idleIdx';

export async function nextIdleIndex(count: number): Promise<number> {
  const last = await AsyncStorage.getItem(IDLE_KEY)
    .then((v) => (v ? Number(v) : -1))
    .catch(() => -1);
  let pick = Math.floor(Math.random() * count);
  if (count > 1 && pick === last) pick = (pick + 1) % count;
  await AsyncStorage.setItem(IDLE_KEY, String(pick)).catch(() => undefined);
  return pick;
}

const BAD_LINK_KEY = 'phantom.speech.badLinkIdx';

export async function nextBadLinkIndex(count: number): Promise<number> {
  const last = await AsyncStorage.getItem(BAD_LINK_KEY)
    .then((v) => (v ? Number(v) : -1))
    .catch(() => -1);
  let pick = Math.floor(Math.random() * count);
  if (count > 1 && pick === last) pick = (pick + 1) % count;
  await AsyncStorage.setItem(BAD_LINK_KEY, String(pick)).catch(() => undefined);
  return pick;
}

const SUCCESS_KEY = 'phantom.speech.successIdx';

export async function nextSuccessIndex(count: number): Promise<number> {
  const last = await AsyncStorage.getItem(SUCCESS_KEY)
    .then((v) => (v ? Number(v) : -1))
    .catch(() => -1);
  let pick = Math.floor(Math.random() * count);
  if (count > 1 && pick === last) pick = (pick + 1) % count;
  await AsyncStorage.setItem(SUCCESS_KEY, String(pick)).catch(() => undefined);
  return pick;
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

export async function setNotifyPrimed(value: boolean): Promise<void> {
  await AsyncStorage.setItem(NOTIFY_PRIMED_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export async function getHaptics(): Promise<boolean> {
  const v = await AsyncStorage.getItem(HAPTICS_KEY).catch(() => null);
  return v !== '0';
}

export async function setHaptics(value: boolean): Promise<void> {
  await AsyncStorage.setItem(HAPTICS_KEY, value ? '1' : '0').catch(
    () => undefined
  );
}

export function formatName(
  fmt: FilenameFormat,
  title: string,
  artist: string | undefined,
  platform: string
): string {
  if (fmt === 'title') return title;
  if (fmt === 'title-platform') {
    const tag = platform.charAt(0).toUpperCase() + platform.slice(1);
    return `${title} (${tag})`;
  }
  return artist ? `${artist} - ${title}` : title;
}
