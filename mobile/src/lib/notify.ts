import notifee, {
  AndroidImportance,
  AndroidStyle,
  AuthorizationStatus,
  EventType,
  type Event,
} from 'react-native-notify-kit';
import * as Sharing from 'expo-sharing';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { File, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { runDownloadCancel, CANCEL_ACTION } from './fgservice';
import { setNotify } from './settings';
import xLogo from '../../assets/logos/x.png';
import instagramLogo from '../../assets/logos/instagram.png';
import facebookLogo from '../../assets/logos/facebook.png';
import tiktokLogo from '../../assets/logos/tiktok.png';
import spotifyLogo from '../../assets/logos/spotify.png';
import youtubeLogo from '../../assets/logos/youtube.png';
import threadsLogo from '../../assets/logos/threads.png';
import bilibiliLogo from '../../assets/logos/bilibili.png';
import blueskyLogo from '../../assets/logos/bluesky.png';
import redditLogo from '../../assets/logos/reddit.png';
import soundcloudLogo from '../../assets/logos/soundcloud.png';
import vimeoLogo from '../../assets/logos/vimeo.png';
import dailymotionLogo from '../../assets/logos/dailymotion.png';

const CHANNEL = 'complete';
const SMALL_ICON = 'notification_icon';
const BRAND = '#22d3ee';
const TAP_TYPE = 'download-complete';
const SHARE_ACTION = 'share-file';
const OPEN_ACTION = 'open-file';

export type MediaKind = 'video' | 'audio' | 'image';

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function mimeFor(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

function kindFromExt(ext: string): MediaKind {
  const e = ext.toLowerCase();
  if (e === 'jpg' || e === 'jpeg' || e === 'png' || e === 'webp' || e === 'gif')
    return 'image';
  if (
    e === 'mp3' ||
    e === 'm4a' ||
    e === 'aac' ||
    e === 'opus' ||
    e === 'ogg' ||
    e === 'wav' ||
    e === 'flac'
  )
    return 'audio';
  return 'video';
}

const PLATFORM_LOGOS: Record<string, number> = {
  x: xLogo,
  instagram: instagramLogo,
  facebook: facebookLogo,
  tiktok: tiktokLogo,
  spotify: spotifyLogo,
  youtube: youtubeLogo,
  threads: threadsLogo,
  bilibili: bilibiliLogo,
  bluesky: blueskyLogo,
  reddit: redditLogo,
  soundcloud: soundcloudLogo,
  vimeo: vimeoLogo,
  dailymotion: dailymotionLogo,
};

async function ensureNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function enableNotifications(): Promise<boolean> {
  const granted = await ensureNotificationPermission();
  await setNotify(granted);
  return granted;
}

export async function notifyDownloadComplete(
  name: string,
  thumbnail?: string,
  platform?: string,
  ext?: string,
  uri?: string
): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL,
    name: 'Completed downloads',
    importance: AndroidImportance.HIGH,
  });
  const logo = platform ? (PLATFORM_LOGOS[platform] ?? null) : null;
  const data: { type: string; uri?: string; name?: string; ext?: string } = {
    type: TAP_TYPE,
  };
  if (uri) data.uri = uri;
  data.name = name;
  if (ext) data.ext = ext;
  const kind = kindFromExt(ext ?? 'mp4');
  const primaryLabel = kind === 'image' ? 'Open' : 'Play now';
  await notifee.displayNotification({
    title: 'Download complete',
    body: `${name} saved`,
    data,
    android: {
      channelId: CHANNEL,
      smallIcon: SMALL_ICON,
      color: BRAND,
      largeIcon: thumbnail ?? logo ?? undefined,
      autoCancel: true,
      pressAction: { id: 'default' },
      actions: uri
        ? [
            {
              title: primaryLabel,
              pressAction: { id: OPEN_ACTION, launchActivity: 'default' },
            },
            {
              title: 'Share',
              pressAction: { id: SHARE_ACTION, launchActivity: 'default' },
            },
          ]
        : undefined,
      style: thumbnail
        ? {
            type: AndroidStyle.BIGPICTURE,
            picture: thumbnail,
            largeIcon: logo,
          }
        : undefined,
    },
  });
}

function isCancelPress(event: Event): boolean {
  return (
    event.type === EventType.ACTION_PRESS &&
    event.detail.pressAction?.id === CANCEL_ACTION
  );
}

const handled = new Set<string>();

async function handleFileAction(
  notificationId: string | undefined,
  pressId: string,
  data: { uri?: string; ext?: string }
): Promise<void> {
  const uri = data.uri;
  if (!uri) return;
  const key = `${notificationId}:${pressId}:${uri}`;
  if (handled.has(key)) return;
  handled.add(key);
  const fail = (): void => {
    if (notificationId) notifee.cancelNotification(notificationId).catch(() => undefined);
  };
  try {
    if (pressId === OPEN_ACTION) {
      await ReactNativeBlobUtil.android.actionViewIntent(
        uri,
        mimeFor(data.ext ?? '')
      );
      return;
    }
    if (pressId !== SHARE_ACTION) return;
    const tmp = new File(
      Paths.cache,
      `share-${Date.now()}.${data.ext ?? 'bin'}`
    );
    try {
      await copyAsync({ from: uri, to: tmp.uri });
      if (!(await Sharing.isAvailableAsync())) {
        fail();
        return;
      }
      await Sharing.shareAsync(tmp.uri);
    } finally {
      if (tmp.exists) tmp.delete();
    }
  } catch {
    fail();
  }
}

export function addDownloadTapListener(handler: () => void): () => void {
  notifee
    .getInitialNotification()
    .then((initial) => {
      if (!initial) return;
      const id = initial.pressAction?.id;
      const data = initial.notification?.data ?? {};
      if (id === SHARE_ACTION || id === OPEN_ACTION) {
        void handleFileAction(initial.notification?.id, id, data);
        return;
      }
      if (data.type === TAP_TYPE) handler();
    })
    .catch(() => undefined);

  return notifee.onForegroundEvent((event) => {
    if (isCancelPress(event)) {
      runDownloadCancel();
      return;
    }
    if (event.type === EventType.ACTION_PRESS) {
      const id = event.detail.pressAction?.id ?? '';
      void handleFileAction(
        event.detail.notification?.id,
        id,
        event.detail.notification?.data ?? {}
      );
      return;
    }
    if (
      event.type === EventType.PRESS &&
      event.detail.notification?.data?.type === TAP_TYPE
    ) {
      handler();
    }
  });
}

export function registerNotificationBackgroundHandler(): void {
  notifee.onBackgroundEvent((event) => {
    if (isCancelPress(event)) {
      runDownloadCancel();
      return Promise.resolve();
    }
    if (event.type === EventType.ACTION_PRESS) {
      const id = event.detail.pressAction?.id ?? '';
      return handleFileAction(
        event.detail.notification?.id,
        id,
        event.detail.notification?.data ?? {}
      );
    }
    return Promise.resolve();
  });
}
