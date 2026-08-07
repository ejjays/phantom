import notifee, {
  AndroidImportance,
  AndroidStyle,
  AuthorizationStatus,
  EventType,
  type Event,
} from 'react-native-notify-kit';
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
  platform?: string
): Promise<void> {
  await notifee.createChannel({
    id: CHANNEL,
    name: 'Completed downloads',
    importance: AndroidImportance.HIGH,
  });
  const logo = platform ? (PLATFORM_LOGOS[platform] ?? null) : null;
  await notifee.displayNotification({
    title: 'Download complete',
    body: `${name} saved`,
    data: { type: TAP_TYPE },
    android: {
      channelId: CHANNEL,
      smallIcon: SMALL_ICON,
      color: BRAND,
      largeIcon: thumbnail ?? logo ?? undefined,
      autoCancel: true,
      pressAction: { id: 'default' },
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

export function addDownloadTapListener(handler: () => void): () => void {
  notifee
    .getInitialNotification()
    .then((initial) => {
      if (initial?.notification.data?.type === TAP_TYPE) handler();
    })
    .catch(() => undefined);

  return notifee.onForegroundEvent((event) => {
    if (isCancelPress(event)) {
      runDownloadCancel();
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

// register at app entry, before render
export function registerNotificationBackgroundHandler(): void {
  notifee.onBackgroundEvent((event) => {
    if (isCancelPress(event)) runDownloadCancel();
    return Promise.resolve();
  });
}
