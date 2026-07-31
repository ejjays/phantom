import { useState, useCallback, useEffect } from 'react';
import {
  getNotify,
  setNotify,
  getNotifyPrimed,
  setNotifyPrimed,
} from '../lib/settings';
import { enableNotifications } from '../lib/notify';

const APPEAR_DELAY_MS = 650;

/*
 * shows the notification permission sheet once per fresh install, but only
 *  once `enabled` (i.e. onboarding done) so it never competes with onboarding
 */
export function useNotificationPriming(enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const primed = await getNotifyPrimed();
        if (cancelled || primed) return;
        const already = await getNotify();
        if (!cancelled && !already) setVisible(true);
      })();
    }, APPEAR_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);

  const allow = useCallback(async () => {
    setVisible(false);
    const granted = await enableNotifications();
    await setNotifyPrimed(true);
    if (granted) await setNotify(true);
  }, []);

  const dismiss = useCallback(async () => {
    setVisible(false);
    await setNotifyPrimed(true);
  }, []);

  return { visible, allow, dismiss };
}
