import { View } from 'react-native';
import type { ComponentProps, ReactNode } from 'react';
import LottieView from 'lottie-react-native';
import tw from '../../lib/tw';

export const textOutline = {
  textShadowColor: 'rgba(0,0,0,0.7)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
};

function rgba(hex: string, alpha: number) {
  const int = parseInt(hex.slice(1), 16);
  return `rgba(${Math.floor(int / 65536)}, ${Math.floor(int / 256) % 256}, ${int % 256}, ${alpha})`;
}

export default function HeroLottieCard({
  source,
  minHeight = 224,
  speed = 1,
  glow = false,
  glowColor = '#22d3ee',
  glowStrength = 1,
  bgColor = '#1b104e',
  rightSlot,
  bottomLeft,
  children,
}: {
  source: ComponentProps<typeof LottieView>['source'];
  minHeight?: number;
  speed?: number;
  glow?: boolean;
  glowColor?: string;
  glowStrength?: number;
  bgColor?: string;
  rightSlot?: ReactNode;
  bottomLeft?: ReactNode;
  children: ReactNode;
}) {
  const card = (
    <View
      style={[
        tw`justify-center overflow-hidden rounded-3xl`,
        glow
          ? { borderWidth: 1, borderColor: rgba(glowColor, 0.6 * glowStrength) }
          : null,
        { minHeight, backgroundColor: bgColor },
      ]}
    >
      <LottieView
        source={source}
        autoPlay
        loop
        speed={speed}
        resizeMode="cover"
        renderMode="HARDWARE"
        style={tw`absolute inset-0`}
      />
      {rightSlot ? (
        <View style={tw`absolute inset-y-0 right-4 justify-center`}>
          {rightSlot}
        </View>
      ) : null}
      {bottomLeft ? (
        <View style={tw`absolute bottom-4 left-6`}>{bottomLeft}</View>
      ) : null}
      <View style={tw`p-6`}>{children}</View>
    </View>
  );

  if (!glow) return card;

  const glowShadow = `0px 0px 12px 0px ${rgba(glowColor, 0.4 * glowStrength)}, 0px 0px 5px 0px ${rgba(glowColor, 0.5 * glowStrength)}`;
  return (
    <View style={[tw`rounded-3xl`, { boxShadow: glowShadow }]}>{card}</View>
  );
}
