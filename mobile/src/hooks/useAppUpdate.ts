import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import {
  checkForUpdate,
  type UpdateCheck,
  type UpdateManifest,
} from '../lib/updater/manifest';
import { downloadApk, installDownloadedApk } from '../lib/updater/install';
import {
  hasInstallPermission,
  openInstallPermissionSettings,
} from '../../modules/silent-updater';

export type UpdateStatus =
  | 'checking'
  | 'none'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error'
  | 'permission';

export function useAppUpdate(autoCheck = true) {
  const installed = Constants.expoConfig?.version ?? '0.0.0';
  const [status, setStatus] = useState<UpdateStatus>('checking');
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const check = useCallback(async (): Promise<UpdateCheck | null> => {
    const update = await checkForUpdate(installed);
    if (!update) {
      setStatus('none');
      return null;
    }
    setManifest(update.manifest);
    setStatus('available');
    return update;
  }, [installed]);

  const install = useCallback(
    async (explicit?: UpdateManifest) => {
      const target = explicit ?? manifest;
      if (!target) return;
      if (!(await hasInstallPermission())) {
        setStatus('permission');
        await openInstallPermissionSettings();
        return;
      }
      setStatus('downloading');
      setProgress(0);
      abortRef.current = new AbortController();
      try {
        const path = await downloadApk(
          target,
          (written, total) => setProgress(total ? written / total : 0),
          abortRef.current.signal
        );
        setStatus('installing');
        await installDownloadedApk(path);
      } catch (err) {
        abortRef.current = null;
        setStatus('error');
        setErrorMessage(err instanceof Error ? err.message : String(err));
        console.error('update install failed', err);
      }
    },
    [manifest]
  );

  const updateNow = useCallback(async () => {
    if (status === 'downloading' || status === 'installing') return;
    if (status === 'available' && manifest) {
      void install(manifest);
      return;
    }
    const update = await check();
    if (update) void install(update.manifest);
  }, [status, manifest, check, install]);

  useEffect(() => {
    if (!autoCheck) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time update check
    void check();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // user returns from the "allow installs" settings screen: auto-resume
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || status !== 'permission') return;
      void install();
    });
    return () => sub.remove();
  }, [status, install]);

  return { installed, status, manifest, progress, errorMessage, check, install, updateNow };
}