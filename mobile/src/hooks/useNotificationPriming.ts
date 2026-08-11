import { useState, useCallback, useEffect } from 'react';
import {
  getNotify,
  setNotify,
  getNotifyPrimed,
  setNotifyPrimed,
} from '../lib/settings';
import { enableNotifications } from '../lib/notify';

export function useNotificationPriming(enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      const primed = await getNotifyPrimed();
      if (cancelled || primed) return;
      const already = await getNotify();
      if (!cancelled && !already) setVisible(true);
    })();
    return () => {
      cancelled = true;
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
