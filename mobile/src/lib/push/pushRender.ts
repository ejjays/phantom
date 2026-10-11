import notifee, { AndroidImportance, EventType } from 'react-native-notify-kit';
import {
  parseFcmPayload,
  reconstructNotification,
} from 'react-native-notify-kit/dist/fcm/index';
import type { FcmRemoteMessage } from 'react-native-notify-kit';
import {
  SOCIAL_CHANNEL,
  socialFcmConfig,
  hasRenderablePayload,
} from './pushRender.logic';
import { parseSocialTap, type SocialDeepLink } from './notificationTap.logic';
import { presetSource, isPresetMarker } from '../social/avatars';
import appLogo from '../../../assets/icon.png';

let channelReady = false;

const BRAND = '#22d3ee';

function resolveLargeIcon(avatar: string | undefined): string | number {
  if (isPresetMarker(avatar)) return presetSource(avatar) ?? appLogo;
  if (avatar && /^https?:\/\//u.test(avatar)) return avatar;
  return appLogo;
}

async function ensureChannel(): Promise<void> {
  if (channelReady) return;
  await notifee.createChannel({
    id: SOCIAL_CHANNEL,
    name: 'Comments & updates',
    importance: AndroidImportance.HIGH,
  });
  channelReady = true;
}

// rnfirebase: data is string|object; notify-kit expects string-only.
type IncomingMessage = {
  messageId?: string;
  data?: Record<string, string | object>;
  notification?: { title?: string; body?: string };
};

function toFcmMessage(message: IncomingMessage): FcmRemoteMessage {
  const data = message.data
    ? Object.fromEntries(
        Object.entries(message.data).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        ])
      )
    : undefined;
  return {
    messageId: message.messageId,
    data,
    notification: message.notification,
  };
}

// data-only messages: SDK never auto-displays, we render for foreground +
// headless background.
export async function displaySocialNotification(
  message: IncomingMessage
): Promise<void> {
  const remote = toFcmMessage(message);
  if (!hasRenderablePayload(remote.data, remote.notification)) return;
  await ensureChannel();
  const parsed = parseFcmPayload(remote.data);
  const notification = reconstructNotification(
    parsed,
    remote,
    socialFcmConfig()
  );
  const largeIcon = resolveLargeIcon(remote.data?.avatar);
  if (notification.android) {
    notification.android.largeIcon = largeIcon;
    notification.android.circularLargeIcon = true;
    notification.android.color = BRAND;
  } else {
    notification.android = {
      channelId: SOCIAL_CHANNEL,
      largeIcon,
      circularLargeIcon: true,
      color: BRAND,
    };
  }
  await notifee.displayNotification(notification);
}

// cold-start via getInitialNotification & foreground tap via onForegroundEvent.
export function addSocialTapListener(
  handler: (link: SocialDeepLink) => void
): () => void {
  notifee
    .getInitialNotification()
    .then((initial) => {
      const link = parseSocialTap(initial?.notification.data);
      if (link) handler(link);
    })
    .catch(() => undefined);

  return notifee.onForegroundEvent((event) => {
    if (event.type !== EventType.PRESS) return;
    const link = parseSocialTap(event.detail.notification?.data);
    if (link) handler(link);
  });
}
