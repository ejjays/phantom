import { useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import * as Brightness from 'expo-brightness';
import { log } from '../lib/log';

function clamp(value: number): number {
  return Math.max(0.05, Math.min(1, value));
}

export function useBrightnessSwipe(onLevel: (value: number) => void) {
  const start = useRef(0.5);
  const lastSet = useRef(-1);

  const gesture = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-24, 24])
    .runOnJS(true)
    .onBegin(() => {
      void Brightness.getBrightnessAsync()
        .then((level) => {
          start.current = level;
          lastSet.current = level;
        })
        .catch(() => undefined);
    })
    .onUpdate((event) => {
      const next = clamp(start.current - event.translationY / 300);
      if (Math.abs(next - lastSet.current) < 0.02) return;
      lastSet.current = next;
      void Brightness.setBrightnessAsync(next).catch(() => undefined);
      log('Player', `brightness ${Math.round(next * 100)}%`);
      onLevel(next);
    });

  return gesture;
}
