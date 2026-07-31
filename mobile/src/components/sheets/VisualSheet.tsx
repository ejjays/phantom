import { type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../../lib/tw';
import BottomSheet from './BottomSheet';

type Props = {
  visible: boolean;
  onClose: () => void;
  image?: number;
  visual?: ReactNode;
  children: ReactNode;
  imageRatio?: number;
  heightRatio?: number;
  overlayContent?: boolean;
  imageScale?: number;
  stars?: boolean;
};

export default function VisualSheet({
  visible,
  onClose,
  image,
  visual,
  children,
  imageRatio = 0.72,
  heightRatio = 0.84,
  overlayContent = true,
  imageScale = 1,
  stars = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: screenH, width: screenW } = useWindowDimensions();

  const visibleH = Math.round(screenH * heightRatio);
  const imageH = Math.round(visibleH * imageRatio);
  const sheetWidth = Math.min(screenW, 560);
  const stackedSize = Math.round(sheetWidth * imageScale);

  return (
    <BottomSheet open={visible} onClose={onClose} stars={stars}>
      {image && overlayContent ? (
        <>
          <Image
            source={image}
            style={[{ height: imageH }, tw`absolute left-0 right-0 top-0`]}
            contentFit="cover"
            transition={200}
          />
          <LinearGradient
            colors={['transparent', '#0b1526']}
            locations={[0.3, 0.6]}
            style={[{ position: 'absolute', inset: 0 }]}
            pointerEvents="none"
          />
        </>
      ) : null}

      {overlayContent ? (
        <View
          style={[
            tw`flex-1 justify-end px-6`,
            { paddingBottom: insets.bottom + 18 },
          ]}
        >
          {children}
        </View>
      ) : (
        <>
          <View style={tw`items-center justify-center`}>
            {visual ? (
              <View style={{ width: stackedSize, height: stackedSize }}>
                {visual}
              </View>
            ) : image ? (
              <Image
                source={image}
                style={{ width: stackedSize, height: stackedSize }}
                contentFit="contain"
                transition={200}
              />
            ) : null}
          </View>
          <View style={tw`px-6 pb-2`}>{children}</View>
        </>
      )}
    </BottomSheet>
  );
}
