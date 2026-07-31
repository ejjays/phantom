import * as Crypto from 'expo-crypto';
import type { SignInWithIdTokenCredentials } from '@supabase/supabase-js';
import {
  GoogleOneTapSignIn,
  isCancelledResponse,
  isNoSavedCredentialFoundResponse,
} from 'react-native-nitro-google-signin';
import { supabase } from './supabase';
import { log } from '../log';

const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();

// flip to trace google sign-in steps in Metro (off by default; logs safe values only, never tokens)
const DEBUG = false;
const dbg = (...args: unknown[]) => {
  if (DEBUG) log('googleAuth', '[gauth]', ...args);
};

export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) throw new Error('Supabase is not configured');
  if (!webClientId) throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  dbg('webClientId=', JSON.stringify(webClientId));

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
    { encoding: Crypto.CryptoEncoding.HEX }
  );

  // hashed nonce → google; raw → supabase
  GoogleOneTapSignIn.configure({ webClientId, nonce: hashedNonce });
  await GoogleOneTapSignIn.checkPlayServices();

  let response = await GoogleOneTapSignIn.signIn();
  dbg(
    'signIn noSavedCred=',
    isNoSavedCredentialFoundResponse(response),
    'cancelled=',
    isCancelledResponse(response)
  );
  if (isNoSavedCredentialFoundResponse(response)) {
    // no authorized account → full chooser
    response = await GoogleOneTapSignIn.presentExplicitSignIn();
    dbg('explicit cancelled=', isCancelledResponse(response));
  }
  if (isCancelledResponse(response)) {
    dbg('cancelled -> returning null');
    return null;
  }

  const credential = response.data;
  if (!credential) throw new Error('Google sign-in returned no credential');
  dbg('got idToken, length=', credential.idToken?.length);

  // guest session running → link the google identity so reactions/comments
  // carry over; no session → fresh account (old one-tap path).
  const { data: existing } = await supabase.auth.getSession();
  const isGuest = existing.session?.user?.is_anonymous ?? false;
  const credentials: SignInWithIdTokenCredentials = {
    provider: 'google',
    token: credential.idToken,
    nonce: rawNonce,
  };
  const { data, error } = isGuest
    ? await supabase.auth.linkIdentity(credentials)
    : await supabase.auth.signInWithIdToken(credentials);
  if (error && isGuest && error.code === 'identity_already_exists') {
    dbg('identity already exists -> signing in as existing account');
    await supabase.auth.signOut();
    const retry = await supabase.auth.signInWithIdToken(credentials);
    if (retry.error) throw retry.error;
    return retry.data.user?.id ?? null;
  }
  if (error) {
    dbg('supabase auth error:', error.message);
    throw error;
  }

  const userId = data.user?.id;
  if (!userId) throw new Error('Google sign-in returned no user');
  dbg('success userId=', userId);
  return userId;
}

export async function signOutGoogle(): Promise<void> {
  try {
    await GoogleOneTapSignIn.signOut();
  } catch {
    /* best-effort credential clear */
  }
  if (supabase) await supabase.auth.signOut();
}
