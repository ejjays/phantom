import type { ReactNode } from 'react';
import { View } from 'react-native';
import tw from '../lib/tw';

export default function Card({
  children,
  light,
}: {
  children: ReactNode;
  light?: boolean;
}) {
  return (
    <View
      style={
        light
          ? {
              overflow: 'hidden',
              borderRadius: 24,
              borderWidth: 1,
              borderColor: 'rgba(15,23,42,0.09)',
              backgroundColor: '#ffffff',
            }
          : tw`overflow-hidden rounded-3xl border border-white/10 bg-white/5`
      }
    >
      {children}
    </View>
  );
}
