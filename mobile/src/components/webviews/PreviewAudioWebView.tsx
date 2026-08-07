import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

// html5 audio sandbox — plays remote MP3 previews without a native module.
// commands come in via injectJavaScript, status goes out via ReactNativeWebView.postMessage.
const AUDIO_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#000;">
<audio id="a" preload="auto" crossorigin="anonymous"></audio>
<script>
(function(){
  var audio = document.getElementById('a');
  function send(payload){
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }
  audio.addEventListener('timeupdate', function(){
    send({ type: 'progress', currentTime: audio.currentTime, duration: audio.duration || 0 });
  });
  audio.addEventListener('ended', function(){ send({ type: 'ended' }); });
  audio.addEventListener('play', function(){ send({ type: 'playing' }); });
  audio.addEventListener('pause', function(){ send({ type: 'paused' }); });
  audio.addEventListener('loadedmetadata', function(){
    send({ type: 'loaded', duration: audio.duration || 0 });
  });
  audio.addEventListener('error', function(){ send({ type: 'error' }); });
  window.__nx = {
    load: function(src){
      if (!src) { audio.removeAttribute('src'); audio.load(); return; }
      if (audio.src !== src) { audio.src = src; audio.load(); }
    },
    play: function(){ var p = audio.play(); if (p && p.catch) p.catch(function(){ send({ type: 'error' }); }); },
    pause: function(){ audio.pause(); },
    seek: function(t){ try { audio.currentTime = t; } catch(e){} },
  };
  send({ type: 'ready' });
})();
true;
</script>
</body>
</html>`;

type PreviewProgress = {
  currentTime: number;
  duration: number;
};

export type PreviewAudioMessage =
  | { type: 'ready' }
  | { type: 'loaded'; duration: number }
  | ({ type: 'progress' } & PreviewProgress)
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | { type: 'error' };

export type PreviewAudioHandle = {
  load: (src: string | null) => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
};

type Props = {
  onMessage: (msg: PreviewAudioMessage) => void;
};

// hidden but rendered (offscreen), so the media element keeps playing
const PreviewAudioWebView = forwardRef<PreviewAudioHandle, Props>(
  function PreviewAudioWebView({ onMessage }, ref) {
    const webRef = useRef<WebView>(null);
    const readyRef = useRef(false);
    const pending = useRef<string[]>([]);

    const send = useCallback((js: string) => {
      if (readyRef.current) {
        webRef.current?.injectJavaScript(`${js}; true;`);
      } else {
        pending.current.push(js);
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        load: (src) =>
          send(`window.__nx && window.__nx.load(${JSON.stringify(src)})`),
        play: () => send(`window.__nx && window.__nx.play()`),
        pause: () => send(`window.__nx && window.__nx.pause()`),
        seek: (seconds) =>
          send(`window.__nx && window.__nx.seek(${Number(seconds) || 0})`),
      }),
      [send]
    );

    const handleMessage = (event: WebViewMessageEvent) => {
      let parsed: PreviewAudioMessage | null = null;
      try {
        parsed = JSON.parse(event.nativeEvent.data) as PreviewAudioMessage;
      } catch {
        return;
      }
      if (parsed.type === 'ready') {
        readyRef.current = true;
        // flush any commands sent before webview finished bootstrap
        for (const js of pending.current) {
          webRef.current?.injectJavaScript(`${js}; true;`);
        }
        pending.current = [];
      }
      onMessage(parsed);
    };

    return (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -10000,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0,
        }}
      >
        <WebView
          ref={webRef}
          source={{ html: AUDIO_HTML }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          onMessage={handleMessage}
        />
      </View>
    );
  }
);

export default PreviewAudioWebView;
