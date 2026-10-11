// device-level topic subscription — signed-out users still receive broadcast
// pushes (no per-user token).
export const TOPIC_UPDATES = 'updates';

export type DeviceTokenRow = {
  user_id: string;
  token: string;
  platform: string;
  updated_at: string;
};

export function deviceTokenRow(
  userId: string,
  token: string,
  now = Date.now()
): DeviceTokenRow {
  return {
    user_id: userId,
    token,
    platform: 'android',
    updated_at: new Date(now).toISOString(),
  };
}

// guard: token registration needs a signed-in user.
export function shouldRegisterToken(
  configured: boolean,
  userId: string | null
): userId is string {
  return configured && typeof userId === 'string' && userId.length > 0;
}
