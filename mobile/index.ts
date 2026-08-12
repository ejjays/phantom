import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';
import { getMessaging } from '@react-native-firebase/messaging';

import App from './App';
import { initCrashReporter, wrap } from './src/lib/crash';
import { registerNotificationBackgroundHandler } from './src/lib/notify';
import { displaySocialNotification } from './src/lib/social/pushRender';

initCrashReporter();
registerNotificationBackgroundHandler();

try {
  getMessaging().setBackgroundMessageHandler(async (message) => {
    await displaySocialNotification(message);
  });
} catch {
  /* native FCM module absent on a pre-rebuild dev client */
}

registerRootComponent(wrap(App));
