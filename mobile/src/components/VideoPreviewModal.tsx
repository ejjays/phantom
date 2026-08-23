import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Modal,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { X, VideoOff } from 'lucide-react-native';
import tw from '../lib/tw';

type Props = {
  visible: boolean;
  url: string | null;
  aspectRatio: number;
  poster?: string;
  onClose: () => void;
};

const DISMISS_OFFSET = 130;
const DISMISS_VELOCITY = 600;
const SPRING = { damping: 20, stiffness: 220, mass: 0.7 };

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const HLS_JS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
const HLS_JS_SRI =
  'sha384-5E8B0pTlZZJMabWpC0fyYf6OUpe15jJij34BqBAh4NXoHAlLNOjCPRrwtOXOQFAn';

const isHlsUrl = (url: string) => /\.m3u8(\?|$)/iu.test(url);

const HEAD =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" /><style>html,body{margin:0;height:100%;background:#000}.wrap{display:flex;align-items:center;justify-content:center;height:100vh}video{width:100%;height:100%;object-fit:contain}video::-webkit-media-controls-fullscreen-button{display:none!important}</style>';

const VIDEO_ATTRS =
  'controls autoplay playsinline webkit-playsinline controlslist="nofullscreen nodownload noremoteplayback" disablepictureinpicture';

const buildHtml = (url: string, poster?: string) => {
  const posterAttr = poster ? ` poster="${escapeAttr(poster)}"` : '';
  if (isHlsUrl(url)) {
    return `<!DOCTYPE html><html><head>${HEAD}</head><body><div class="wrap"><video id="v"${posterAttr} ${VIDEO_ATTRS}></video></div><script src="${HLS_JS_URL}" integrity="${HLS_JS_SRI}" crossorigin="anonymous"></script><script>(function(){var v=document.getElementById('v');var src=${JSON.stringify(url).replace(/</gu, '\\u003c')};if(window.Hls&&window.Hls.isSupported()){var h=new Hls({maxBufferLength:10});h.on(Hls.Events.ERROR,function(_e,d){if(d&&d.fatal)window.ReactNativeWebView.postMessage('error');});h.loadSource(src);h.attachMedia(v);}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=src;}else{window.ReactNativeWebView.postMessage('error');}})();</script></body></html>`;
  }
  return `<!DOCTYPE html><html><head>${HEAD}</head><body><div class="wrap"><video src="${escapeAttr(url)}"${posterAttr} ${VIDEO_ATTRS}></video></div></body></html>`;
};

const INJECTED =
  "(function(){var v=document.querySelector('video');if(!v)return;var ok=function(){window.ReactNativeWebView.postMessage('playing');};v.addEventListener('playing',ok);v.addEventListener('timeupdate',ok);v.addEventListener('loadeddata',ok);v.addEventListener('error',function(){window.ReactNativeWebView.postMessage('error');});var ar=function(){if(v.videoWidth&&v.videoHeight)window.ReactNativeWebView.postMessage('ar:'+(v.videoWidth/v.videoHeight));};v.addEventListener('loadedmetadata',ar);ar();if(v.readyState>=2||!v.paused)ok();})();true;";

const PreviewMessage = ({ text }: { text: string }) => (
  <View style={tw`flex-1 items-center justify-center px-8`}>
    <VideoOff size={40} color="#64748b" />
    <Text style={tw`mt-3 text-center font-mono text-sm text-slate-300`}>
      {text}
    </Text>
  </View>
);

type PlayerProps = {
  url: string;
  poster?: string;
  onAspectRatio: (ratio: number) => void;
};

function PreviewPlayer({ url, poster, onAspectRatio }: PlayerProps) {
  const [failed, setFailed] = useState(false);

  const fail = () => setFailed(true);

  const handleMessage = (event: WebViewMessageEvent) => {
    const data = event.nativeEvent.data;
    if (data === 'error') fail();
    else if (data.startsWith('ar:')) {
      const ratio = parseFloat(data.slice(3));
      if (ratio > 0) onAspectRatio(ratio);
    }
  };

  if (failed) {
    return <PreviewMessage text="Preview isn't available for this source." />;
  }

  return (
    <View style={tw`flex-1`}>
      <WebView
        source={{ html: buildHtml(url, poster) }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        allowsFullscreenVideo={false}
        mediaPlaybackRequiresUserAction={false}
        injectedJavaScript={INJECTED}
        onMessage={handleMessage}
        onError={fail}
        onHttpError={fail}
        style={tw`flex-1 bg-transparent`}
      />
    </View>
  );
}

export default function VideoPreviewModal({
  visible,
  url,
  aspectRatio,
  poster,
  onClose,
}: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const [ratio, setRatio] = useState(aspectRatio);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- resets drag + ratio per preview open
    if (visible) {
      tx.value = 0;
      ty.value = 0;
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-derived-state -- reset ratio per preview; webview reports actual
      setRatio(aspectRatio);
    }
  }, [visible, aspectRatio, tx, ty]);

  const box =
    ratio >= screenW / screenH
      ? { width: screenW, height: screenW / ratio }
      : { width: screenH * ratio, height: screenH };

  const pan = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .onUpdate((event) => {
      tx.value = event.translationX;
      ty.value = event.translationY;
    })
    .onEnd((event) => {
      const dist = Math.sqrt(
        event.translationX * event.translationX +
          event.translationY * event.translationY
      );
      const speed = Math.sqrt(
        event.velocityX * event.velocityX + event.velocityY * event.velocityY
      );
      if (dist > DISMISS_OFFSET || speed > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      } else {
        tx.value = withSpring(0, SPRING);
        ty.value = withSpring(0, SPRING);
      }
    });

  const contentStyle = useAnimatedStyle(() => {
    const dist = Math.min(
      Math.sqrt(tx.value * tx.value + ty.value * ty.value),
      360
    );
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scale: 1 - (dist / 360) * 0.1 },
      ],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    const dist = Math.min(
      Math.sqrt(tx.value * tx.value + ty.value * ty.value),
      300
    );
    return { opacity: 1 - (dist / 300) * 0.85 };
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={tw`flex-1`}>
        <View style={tw`flex-1 items-center justify-center`}>
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable style={tw`flex-1 bg-black`} onPress={onClose} />
          </Animated.View>

          <GestureDetector gesture={pan}>
            <Animated.View style={[box, contentStyle]}>
              {url ? (
                <PreviewPlayer
                  key={url}
                  url={url}
                  poster={poster}
                  onAspectRatio={setRatio}
                />
              ) : (
                <PreviewMessage text="Preview isn't available for this source." />
              )}
            </Animated.View>
          </GestureDetector>

          <TouchableOpacity
            onPress={onClose}
            style={tw`absolute right-4 top-12 h-10 w-10 items-center justify-center rounded-full bg-white/10`}
          >
            <X size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
