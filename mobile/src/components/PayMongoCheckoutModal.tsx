import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import { EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import tw from '../lib/tw';
import { tapSelection, tapSuccess } from '../lib/haptics';
import { isSupabaseConfigured, supabase } from '../lib/social/supabase';
import { signInAsGuest } from '../lib/social/updates';
import { saveToDevice } from '../lib/download/save';

// matched verbatim in supabase/functions/paymongo-checkout/index.ts — keep in sync
const PAY_SCHEME = 'phantom-pay://';
const GCASH_SCHEMES = ['gcash://', 'gcashpay://'];

const QR_PREFIX = 'phantom-qr:';
const IMAGE_URL_RE = /\.(png|jpe?g|webp|gif)([?#]|$)/iu;

// webview silently drops file downloads — catch a[download] clicks in-page and
// hand the bytes back to RN, which saves them to the gallery itself
const QR_CLICK_JS = `(function(){
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!a || !a.href) return;
    e.preventDefault();
    var url = a.href;
    var name = a.download || 'phantom-qr.png';
    if (url.indexOf('data:') === 0) {
      window.ReactNativeWebView.postMessage('${QR_PREFIX}' + name + ':' + url);
    } else if (url.indexOf('blob:') === 0) {
      fetch(url).then(function(r){return r.blob();}).then(function(b){
        var rd = new FileReader();
        rd.onload = function(){ window.ReactNativeWebView.postMessage('${QR_PREFIX}' + name + ':' + rd.result); };
        rd.readAsDataURL(b);
      }).catch(function(){ window.ReactNativeWebView.postMessage('${QR_PREFIX}error'); });
    } else {
      window.ReactNativeWebView.postMessage('${QR_PREFIX}' + name + ':' + url);
    }
  }, true);
})();`;

const blobToDataUrlJs = (url: string) =>
  `(function(){fetch(${JSON.stringify(url)}).then(function(r){return r.blob();}).then(function(b){
    var rd = new FileReader();
    rd.onload = function(){ window.ReactNativeWebView.postMessage('${QR_PREFIX}qr.png:' + rd.result); };
    rd.readAsDataURL(b);
  }).catch(function(){ window.ReactNativeWebView.postMessage('${QR_PREFIX}error'); });})();true;`;

type Phase = 'create' | 'open' | 'success' | 'error';
export type CheckoutResult = 'success' | 'cancelled' | 'dismissed';

type CheckoutResponse = { checkoutUrl?: string; donationId?: string };
type StatusResponse = { status?: string };

export default function PayMongoCheckoutModal({
  amount,
  onExit,
}: {
  amount: number;
  onExit: (result: CheckoutResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('create');
  const [errorMsg, setErrorMsg] = useState('');
  const [qrNote, setQrNote] = useState<string | null>(null);
  const checkoutUrlRef = useRef<string | null>(null);
  const donationIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webViewRef = useRef<WebView>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const start = useCallback(async () => {
    setPhase('create');
    setErrorMsg('');
    finishedRef.current = false;
    try {
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Payments are not set up on this build');
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) await signInAsGuest();
      const res = await supabase.functions.invoke('paymongo-checkout', {
        body: { amount },
      });
      const data = res.data as CheckoutResponse;
      if (res.error || !data?.checkoutUrl) {
        throw new Error(res.error?.message ?? 'Could not start checkout');
      }
      checkoutUrlRef.current = data.checkoutUrl;
      donationIdRef.current = data.donationId ?? null;
      setPhase('open');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('error');
    }
  }, [amount]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount bootstrap: kick off checkout, run once
    void start();
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      if (qrNoteTimerRef.current) clearTimeout(qrNoteTimerRef.current);
    };
  }, [start]);

  const note = useCallback((msg: string) => {
    setQrNote(msg);
    if (qrNoteTimerRef.current) clearTimeout(qrNoteTimerRef.current);
    qrNoteTimerRef.current = setTimeout(() => setQrNote(null), 4000);
  }, []);

  // base64 (data: URL) → temp file → gallery
  const saveQrDataUrl = useCallback(
    async (dataUrl: string) => {
      const mime = /^data:([^;]+);base64,/u.exec(dataUrl)?.[1] ?? 'image/png';
      const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      const tmp = new File(Paths.cache, `qr-${Date.now()}.${ext}`);
      try {
        const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        await writeAsStringAsync(tmp.uri, b64, { encoding: EncodingType.Base64 });
        const res = await saveToDevice(tmp);
        note(res.ok ? 'QR code saved to gallery' : 'Could not save QR code');
      } catch {
        note('Could not save QR code');
      } finally {
        if (tmp.exists) tmp.delete();
      }
      tapSelection();
    },
    [note]
  );

  // http(s) URL → temp file → gallery
  const saveQrUrl = useCallback(
    async (name: string, url: string) => {
      const ext = (/\.[a-z0-9]+(?:\?|$)/iu.exec(name)?.[0] ?? '.png')
        .replace(/[^a-z0-9]/giu, '');
      const tmp = new File(Paths.cache, `qr-${Date.now()}.${ext || 'png'}`);
      try {
        await File.downloadFileAsync(url, tmp, { idempotent: true });
        const res = await saveToDevice(tmp);
        note(res.ok ? 'QR code saved to gallery' : 'Could not save QR code');
      } catch {
        note('Could not save QR code');
      } finally {
        if (tmp.exists) tmp.delete();
      }
    },
    [note]
  );

  const handleWebMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = event.nativeEvent.data;
      if (!msg.startsWith(QR_PREFIX)) return;
      const rest = msg.slice(QR_PREFIX.length);
      if (rest === 'error') {
        note('Could not download QR code');
        return;
      }
      const sep = rest.indexOf(':');
      if (sep < 0) return;
      const [name, payload] = [rest.slice(0, sep), rest.slice(sep + 1)];
      if (payload.startsWith('data:')) {
        void saveQrDataUrl(payload);
      } else if (/^https?:/u.test(payload)) {
        void saveQrUrl(name, payload);
      }
    },
    [note, saveQrDataUrl, saveQrUrl]
  );

  const finish = useCallback((result: CheckoutResult) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (result === 'success') {
      tapSuccess();
      setPhase('success');
      exitTimerRef.current = setTimeout(() => onExitRef.current('success'), 1600);
    } else {
      tapSelection();
      onExitRef.current(result);
    }
  }, []);

  const handleNav = (request: WebViewNavigation) => {
    const { url } = request;
    if (url.startsWith(PAY_SCHEME)) {
      finish(url.includes('/success') ? 'success' : 'cancelled');
      return false;
    }
    if (GCASH_SCHEMES.some((scheme) => url.startsWith(scheme))) {
      Linking.openURL(url).catch(() => undefined);
      return false;
    }
    // paymongo's download button opens the QR as a blob: or image: url —
    // grab the bytes in-page and save them ourselves
    if (url.startsWith('blob:')) {
      webViewRef.current?.injectJavaScript(blobToDataUrlJs(url));
      return false;
    }
    if (url.startsWith('data:image/')) {
      void saveQrDataUrl(url);
      return false;
    }
    if (IMAGE_URL_RE.test(url)) {
      void saveQrUrl('phantom-qr.png', url);
      return false;
    }
    return true;
  };

  // gcash app returns to the system browser, not our webview — poll the
  // donation row as fallback so the app still resolves to success
  const poll = useCallback(async () => {
    if (finishedRef.current || !donationIdRef.current || !supabase) return;
    try {
      const res = await supabase.functions.invoke('paymongo-checkout', {
        body: { action: 'status', donationId: donationIdRef.current },
      });
      const data = res.data as StatusResponse;
      if (data?.status === 'paid') finish('success');
    } catch {
      // transient — next tick retries
    }
  }, [finish]);

  useEffect(() => {
    if (phase !== 'open') return undefined;
    const iv = setInterval(() => void poll(), 3000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });
    return () => {
      clearInterval(iv);
      sub.remove();
    };
  }, [phase, poll]);

  // esc/back always dismisses the overlay
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finish('dismissed');
      return true;
    });
    return () => sub.remove();
  }, [finish]);

  return (
    <View style={[StyleSheet.absoluteFill, tw`bg-[#030014]`]}>
      <View
        style={[
          tw`flex-row items-center px-5 pb-2`,
          { paddingTop: insets.top + 12 },
        ]}
      >
        <View style={tw`h-10 w-10`} />
        <Text style={tw`flex-1 text-center font-sans-semibold text-[18px] text-white`}>
          {phase === 'success' ? 'Thank you!' : 'Pay with QR Ph'}
        </Text>
        <View style={tw`h-10 w-10 items-center justify-center rounded-full`}>
          <ShieldCheck size={20} color="#22d3ee" />
        </View>
      </View>

      {phase === 'open' && checkoutUrlRef.current ? (
        <WebView
          ref={webViewRef}
          source={{ uri: checkoutUrlRef.current }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          style={tw`flex-1`}
          containerStyle={{ backgroundColor: '#ffffff', borderRadius: 24, marginHorizontal: 8 }}
          renderLoading={() => <Spinner label="Opening secure checkout…" />}
          injectedJavaScript={QR_CLICK_JS}
          onMessage={handleWebMessage}
          onShouldStartLoadWithRequest={handleNav}
          onError={() => {
            setErrorMsg('Checkout page failed to load');
            setPhase('error');
          }}
        />
      ) : null}

      {phase === 'create' ? <Spinner label="Preparing secure checkout…" /> : null}

      {phase === 'success' ? (
        <View style={tw`flex-1 items-center justify-center px-8`}>
          <View
            style={tw`h-24 w-24 items-center justify-center rounded-full`}
          >
            <CheckCircle2 size={72} color="#4ade80" />
          </View>
          <Text style={tw`mt-6 font-sans-bold text-[24px] text-white`}>
            Payment received!
          </Text>
          <Text style={tw`mt-2 text-center font-sans-medium text-[15px] leading-6 text-slate-300`}>
            Thank you for supporting Phantom. It means the world.
          </Text>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={tw`flex-1 items-center justify-center px-8`}>
          <View style={tw`h-20 w-20 items-center justify-center rounded-full bg-red-500/10`}>
            <TriangleAlert size={44} color="#f87171" />
          </View>
          <Text style={tw`mt-5 font-sans-bold text-[20px] text-white`}>
            Checkout unavailable
          </Text>
          <Text style={tw`mt-2 text-center font-sans-medium text-[14px] leading-6 text-slate-400`}>
            {errorMsg}
          </Text>
          <View style={tw`mt-8 w-full`}>
            <Button label="Try again" primary={false} onPress={() => void start()} />
            <View style={tw`h-3`} />
            <Button label="Close" primary onPress={() => finish('dismissed')} />
          </View>
        </View>
      ) : null}

      <View style={[tw`pt-3`, { paddingBottom: insets.bottom + 14 }]}>
        <Text style={tw`text-center font-sans text-[11px] ${qrNote ? 'text-primary' : 'text-slate-500'}`}>
          {qrNote ?? 'Secure checkout powered by PayMongo'}
        </Text>
      </View>
    </View>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <View style={tw`flex-1 items-center justify-center bg-[#030014]`}>
      <ActivityIndicator size="large" color="#22d3ee" />
      <Text style={tw`mt-4 font-sans-medium text-[14px] text-slate-300`}>{label}</Text>
    </View>
  );
}

function Button({
  label,
  primary,
  onPress,
}: {
  label: string;
  primary: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={tw`items-center rounded-full border py-3.5 ${
        primary ? 'border-white/10 bg-white/5' : 'border-primary/40 bg-primary/10'
      }`}
    >
      <Text style={tw`font-sans-semibold text-[15px] ${primary ? 'text-white' : 'text-primary'}`}>
        {label}
      </Text>
    </Pressable>
  );
}