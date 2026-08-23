import { View } from 'react-native';
import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import tw from '../lib/tw';
import tipBg from '../../assets/support/tip-bg.json';

const GRADIENT: [string, string, string] = [
  'rgba(255,255,255,0.13)',
  'rgba(255,255,255,0.04)',
  'rgba(15,8,35,0.42)',
];

export default function CardBackdrop({
  stars = true,
  children,
}: {
  stars?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {stars ? (
        <LottieView
          source={tipBg}
          autoPlay={false}
          progress={0}
          resizeMode="cover"
          style={[
            tw`absolute inset-0`,
            { transform: [{ scale: 2.2 }], transformOrigin: 'top' },
          ]}
        />
      ) : null}
      <LinearGradient
        colors={GRADIENT}
        locations={[0, 0.45, 1]}
        style={tw`absolute inset-0`}
      />
      {children}
    </>
  );
}
