import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';

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

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<DialogConfig | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const hideLock = useRef(false);

  const showDialog = useCallback(
    (cfg: DialogConfig) => {
      fadeAnim.setValue(0);
      slideAnim.setValue(30);
      setConfig(cfg);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [fadeAnim, slideAnim]
  );

  const hideDialog = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 30,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setConfig(null);
      hideLock.current = false;
    });
  }, [fadeAnim, slideAnim]);

  const handleCancel = useCallback(() => {
    if (hideLock.current) return;
    hideLock.current = true;
    config?.onCancel?.();
    hideDialog();
  }, [config, hideDialog]);

  const handleConfirm = useCallback(() => {
    if (hideLock.current) return;
    hideLock.current = true;
    config?.onConfirm?.();
    hideDialog();
  }, [config, hideDialog]);

  const contextValue = useMemo(
    () => ({ showDialog, hideDialog }),
    [showDialog, hideDialog]
  );

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      <Modal
        visible={!!config}
        transparent
        animationType="none"
        onRequestClose={handleCancel}
      >
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Animated.View
            style={[styles.dialog, { transform: [{ translateY: slideAnim }] }]}
          >
            {config?.title && <Text style={styles.title}>{config.title}</Text>}
            {config?.message && (
              <Text style={styles.message}>{config.message}</Text>
            )}
            <View style={styles.buttonRow}>
              {(config?.showCancel ?? true) && (
                <TouchableOpacity
                  style={styles.button}
                  onPress={handleCancel}
                  activeOpacity={0.7}
                >
                  <Text style={styles.buttonText}>
                    {config?.cancelLabel ?? 'Cancel'}
                  </Text>
                </TouchableOpacity>
              )}
              {config?.confirmLabel && (
                <TouchableOpacity
                  style={styles.button}
                  onPress={handleConfirm}
                  activeOpacity={0.7}
                >
                  <Text style={styles.buttonText}>{config.confirmLabel}</Text>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 40,
  },
  dialog: {
    width: '85%',
    backgroundColor: '#2a2a2a',
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'flex-start',
    borderWidth: 1,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'left',
  },
  message: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'left',
    lineHeight: 22,
    marginBottom: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
  },
  button: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#22d3ee',
    fontSize: 15,
    fontWeight: '500',
  },
});
