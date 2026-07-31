import { getApp } from '@react-native-firebase/app';
import {
  getMessaging,
  getToken,
  subscribeToTopic,
  onTokenRefresh,
  onMessage,
} from '@react-native-firebase/messaging';
import { supabase, isSupabaseConfigured } from './supabase';
import { getExistingUserId, onAuthChange, ensureGuestReady } from './updates';
import { warn } from '../log';
import { displaySocialNotification } from './pushRender';
import {
  TOPIC_UPDATES,
  deviceTokenRow,
  shouldRegisterToken,
} from './push.logic';

const fcm = () => getMessaging(getApp());

let started = false;
let cachedToken: string | null = null;

async function currentToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = await getToken(fcm());
    return cachedToken;
  } catch (err) {
    warn('push', 'getToken failed', err);
    return null;
  }
}

async function upsertToken(userId: string): Promise<void> {
  if (!supabase) return;
  // device_tokens.user_id → profiles FK; a stale guest session can lack the
  // row (auth event fires before the profile upsert), so heal it first
  await ensureGuestReady(userId);
  const token = await currentToken();
  if (!token) return;
  const { error } = await supabase
    .from('device_tokens')
    .upsert(deviceTokenRow(userId, token), { onConflict: 'token' });
  if (error) warn('push', 'token upsert failed', error.message);
}

// on sign-out, drop this device's token row. topic subscription stays intact.
async function deleteToken(): Promise<void> {
  if (!supabase) return;
  const token = await currentToken();
  if (!token) return;
  await supabase
    .from('device_tokens')
    .delete()
    .eq('token', token)
    .then(({ error }) => {
      if (error) warn('push', 'token delete failed', error.message);
    });
}

function syncTokenToSession(): void {
  void getExistingUserId().then((userId) => {
    if (shouldRegisterToken(isSupabaseConfigured, userId))
      void upsertToken(userId);
    else void deleteToken();
  });
}

// one-shot init. guarded for old dev clients missing the FCM native module.
export async function initPush(): Promise<void> {
  if (started || !isSupabaseConfigured) return;
  started = true;
  try {
    await subscribeToTopic(fcm(), TOPIC_UPDATES);
  } catch (err) {
    warn('push', 'topic subscribe failed', err);
  }
  try {
    const userId = await getExistingUserId();
    if (shouldRegisterToken(isSupabaseConfigured, userId))
      await upsertToken(userId);
    onTokenRefresh(fcm(), (token) => {
      cachedToken = token;
      syncTokenToSession();
    });
    onMessage(fcm(), (message) => {
      void displaySocialNotification(message);
    });
    onAuthChange(syncTokenToSession);
  } catch (err) {
    warn('push', 'init failed', err);
  }
}
