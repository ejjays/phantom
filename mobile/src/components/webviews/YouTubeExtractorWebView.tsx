import { useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  attachWebView,
  onWebViewMessage,
  resetReady,
} from '../../extractors/youtube/bridge';
import {
  YT_EXTRACTOR_HTML,
  YT_BOOTSTRAP_JS,
} from '../../extractors/youtube/webviewSource';
import { log, warn as logWarn } from '../../lib/log';

export default function YouTubeExtractorWebView() {
  const ref = useRef<WebView>(null);

  const recover = (reason: string): void => {
    logWarn(
      'YouTubeExtractorWebView',
      `[JS-YT/wv] ${reason}; reloading webview`
    );
    resetReady();
    ref.current?.reload();
  };

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -10000,
        left: 0,
        width: 200,
        height: 200,
        opacity: 0,
      }}
    >
      <WebView
        ref={ref}
        source={{
          html: YT_EXTRACTOR_HTML,
          baseUrl: 'https://www.youtube.com/',
        }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        onLoadStart={() =>
          attachWebView((js) => ref.current?.injectJavaScript(js))
        }
        onLoadEnd={() => {
          log(
            'YouTubeExtractorWebView',
            '[JS-YT/wv] page load end; injecting bootstrap'
          );
          ref.current?.injectJavaScript(YT_BOOTSTRAP_JS);
        }}
        onMessage={(event) => onWebViewMessage(event.nativeEvent.data)}
        onError={({ nativeEvent }) =>
          logWarn(
            'YouTubeExtractorWebView',
            `[JS-YT/wv] load error: ${nativeEvent.code} ${nativeEvent.description} @ ${nativeEvent.url}`
          )
        }
        onHttpError={({ nativeEvent }) =>
          logWarn(
            'YouTubeExtractorWebView',
            `[JS-YT/wv] http error: ${nativeEvent.statusCode} @ ${nativeEvent.url}`
          )
        }
        onRenderProcessGone={({ nativeEvent }) =>
          recover(`render process gone (crashed=${nativeEvent?.didCrash})`)
        }
        onContentProcessDidTerminate={() =>
          recover('content process terminated')
        }
        style={{ flex: 1 }}
      />
    </View>
  );
}
