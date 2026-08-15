import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  Host,
  AlertDialog,
  TextButton,
  Text,
} from '@expo/ui/jetpack-compose';

interface DialogConfig {
  title?: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  showCancel?: boolean;
  onCancel?: () => void;
  onConfirm?: () => void;
}

interface DialogContextValue {
  showDialog: (config: DialogConfig) => void;
  hideDialog: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useAppDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx)
    throw new Error('useAppDialog must be used within AppDialogProvider');
  return ctx;
}

const dialogColors = {
  containerColor: '#15152c',
  titleContentColor: '#ffffff',
  textContentColor: '#cbd5e1',
};

const confirmColor = '#06b6d4';
const dismissColor = '#94a3b8';

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<DialogConfig | null>(null);
  const [locked, setLocked] = useState(false);

  const showDialog = useCallback((cfg: DialogConfig) => {
    setLocked(false);
    setConfig(cfg);
  }, []);

  const hideDialog = useCallback(() => setConfig(null), []);

  const handleCancel = useCallback(() => {
    if (locked) return;
    setLocked(true);
    config?.onCancel?.();
    setConfig(null);
  }, [locked, config]);

  const handleConfirm = useCallback(() => {
    if (locked) return;
    setLocked(true);
    config?.onConfirm?.();
    setConfig(null);
  }, [locked, config]);

  const contextValue = useMemo(
    () => ({ showDialog, hideDialog }),
    [showDialog, hideDialog]
  );

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {config && (
        <Host matchContents>
          <AlertDialog
            onDismissRequest={handleCancel}
            colors={dialogColors}
          >
            {config.title && (
              <AlertDialog.Title>
                <Text style={{ fontFamily: 'Rubik-SemiBold', fontSize: 20 }}>
                  {config.title}
                </Text>
              </AlertDialog.Title>
            )}
            <AlertDialog.Text>
              <Text style={{ fontFamily: 'Rubik', fontSize: 16, lineHeight: 22 }}>
                {config.message}
              </Text>
            </AlertDialog.Text>
            {(config.showCancel ?? true) && (
              <AlertDialog.DismissButton>
                <TextButton
                  onClick={handleCancel}
                  colors={{ contentColor: dismissColor }}
                >
                  <Text style={{ fontFamily: 'Rubik-SemiBold', fontSize: 15 }}>
                    {config.cancelLabel ?? 'Cancel'}
                  </Text>
                </TextButton>
              </AlertDialog.DismissButton>
            )}
            {config.confirmLabel && (
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={handleConfirm}
                  colors={{ contentColor: confirmColor }}
                >
                  <Text style={{ fontFamily: 'Rubik-SemiBold', fontSize: 15 }}>
                    {config.confirmLabel}
                  </Text>
                </TextButton>
              </AlertDialog.ConfirmButton>
            )}
          </AlertDialog>
        </Host>
      )}
    </DialogContext.Provider>
  );
}
