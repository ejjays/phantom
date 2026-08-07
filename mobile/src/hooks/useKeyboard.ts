import { useEffect, type RefObject } from 'react';
import { type TextInput } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';

export function useBlurOnKeyboardHide(ref: RefObject<TextInput | null>) {
  useEffect(() => {
    const sub = KeyboardEvents.addListener('keyboardWillHide', () => {
      ref.current?.blur();
    });
    return () => sub.remove();
  }, [ref]);
}
