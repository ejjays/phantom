import type { FcmConfig } from 'react-native-notify-kit';

// social pushes get their own channel so users can tune them separately.
export const SOCIAL_CHANNEL = 'social';

// tap-routing marker. mirrors the download TAP_TYPE pattern.
export const SOCIAL_TAP_TYPE = 'social';

export function socialFcmConfig(): FcmConfig {
  return {
    defaultChannelId: SOCIAL_CHANNEL,
    defaultPressAction: { id: 'default' },
    fallbackBehavior: 'display',
  };
}

// bare data ping with no title/body = silent control message, skip rendering.
export function hasRenderablePayload(
  data: Record<string, string> | undefined,
  notification?: { title?: string; body?: string }
): boolean {
  if (data && (typeof data.notifee_options === 'string' || !!data.title)) {
    return true;
  }
  return !!(notification && (notification.title || notification.body));
}
