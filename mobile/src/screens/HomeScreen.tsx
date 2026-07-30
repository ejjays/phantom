import { useRef, useEffect, useState } from 'react';
import {
  View,
  TextInput,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  createAnimatedComponent,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../lib/tw';
import pantherSitting from '../../assets/panther-sitting.png';
import pantherAttack from '../../assets/panther-attack.png';
import LinkPing from '../components/LinkPing';
import Header from '../components/Header';
import Button3D from '../components/Button3D';
import FormatBar, { type DownloadMode } from '../components/FormatBar';
import { useBlurOnKeyboardHide } from '../hooks/useKeyboard';

const AnimatedImage = createAnimatedComponent(Image);

type Props = {
  link: string;
  onChangeLink: (text: string) => void;
  loading: boolean;
  mode: DownloadMode;
  setMode: (mode: DownloadMode) => void;
  onResolve: () => void;
  onPaste: () => void;
  onInputFocus: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  resetSignal: number;
};

export default function HomeScreen({
  link,
  onChangeLink,
  loading,
  mode,
  setMode,
  onResolve,
  onPaste,
  onInputFocus,
  refreshing,
  onRefresh,
  resetSignal,
}: Props) {
  const linkInputRef = useRef<TextInput>(null);
  useBlurOnKeyboardHide(linkInputRef);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const kb = useSharedValue(0);
  const inputBottom = useSharedValue(0);
  const isAttacking = useSharedValue(0);
  const glitchOpacity = useSharedValue(1);
  const glitchScale = useSharedValue(1);
  const glitchX = useSharedValue(0);
  const glitchRotate = useSharedValue(0);
  const [showSpinner, setShowSpinner] = useState(false);

  const debris1Opacity = useSharedValue(0);
  const debris1X = useSharedValue(0);
  const debris2Opacity = useSharedValue(0);
  const debris2X = useSharedValue(0);
  const debris3Opacity = useSharedValue(0);
  const debris3Y = useSharedValue(0);

  useGenericKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        kb.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        kb.value = event.height;
      },
    },
    []
  );

  const liftStyle = useAnimatedStyle(() => {
    const keyboardTop = screenH - kb.value;
    const overlap = inputBottom.value + insets.bottom + 16 - keyboardTop;
    return { transform: [{ translateY: -Math.max(0, overlap) }] };
  });

  const baseIconSize = Math.min(228, Math.max(209, screenW * 0.266));

  const sittingStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, kb.value / 400);
    const size = baseIconSize - progress * baseIconSize * 0.1;
    return {
      width: size,
      height: size,
      opacity: glitchOpacity.value * (1 - isAttacking.value),
      transform: [
        { translateX: glitchX.value },
        { scale: glitchScale.value },
        { rotate: `${glitchRotate.value}deg` },
      ],
    };
  });

  const attackStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, kb.value / 400);
    const size = baseIconSize - progress * baseIconSize * 0.1;
    return {
      width: size,
      height: size,
      opacity: isAttacking.value,
      transform: [{ scale: 1 + isAttacking.value * 0.08 }],
    };
  });

  const debris1Style = useAnimatedStyle(() => ({
    width: baseIconSize,
    height: baseIconSize,
    opacity: debris1Opacity.value * (1 - isAttacking.value),
    transform: [{ translateX: debris1X.value - 6 }],
    tintColor: '#ff00ff',
  }));

  const debris2Style = useAnimatedStyle(() => ({
    width: baseIconSize,
    height: baseIconSize,
    opacity: debris2Opacity.value * (1 - isAttacking.value),
    transform: [{ translateX: debris2X.value + 6 }],
    tintColor: '#00ffff',
  }));

  const debris3Style = useAnimatedStyle(() => ({
    width: baseIconSize,
    height: baseIconSize * 0.25,
    opacity: debris3Opacity.value * (1 - isAttacking.value),
    transform: [{ translateY: debris3Y.value }],
  }));

  const triggerGlitch = () => {
    setShowSpinner(true);

    glitchOpacity.value = withSequence(
      withTiming(0.3, { duration: 40 }),
      withTiming(0.9, { duration: 40 }),
      withTiming(0.2, { duration: 25 }),
      withTiming(0.8, { duration: 35 }),
      withTiming(0.4, { duration: 25 }),
      withTiming(0.6, { duration: 30 }),
      withTiming(0.0, { duration: 70 })
    );

    glitchScale.value = withSequence(
      withTiming(1.12, { duration: 35 }),
      withTiming(0.92, { duration: 40 }),
      withTiming(1.08, { duration: 25 }),
      withTiming(0.95, { duration: 30 }),
      withTiming(1.05, { duration: 20 }),
      withTiming(1, { duration: 35 })
    );

    glitchX.value = withSequence(
      withTiming(-15, { duration: 25 }),
      withTiming(12, { duration: 25 }),
      withTiming(-10, { duration: 18 }),
      withTiming(8, { duration: 18 }),
      withTiming(-5, { duration: 12 }),
      withTiming(4, { duration: 12 }),
      withTiming(0, { duration: 25 })
    );

    glitchRotate.value = withSequence(
      withTiming(-5, { duration: 25 }),
      withTiming(4, { duration: 25 }),
      withTiming(-3, { duration: 18 }),
      withTiming(2, { duration: 18 }),
      withTiming(0, { duration: 25 })
    );

    debris1Opacity.value = withSequence(
      withTiming(0.5, { duration: 25 }),
      withTiming(0.25, { duration: 20 }),
      withTiming(0.4, { duration: 18 }),
      withTiming(0.15, { duration: 15 }),
      withTiming(0.3, { duration: 15 }),
      withTiming(0, { duration: 35 })
    );
    debris1X.value = withSequence(
      withTiming(-10, { duration: 25 }),
      withTiming(8, { duration: 20 }),
      withTiming(-6, { duration: 18 }),
      withTiming(4, { duration: 15 }),
      withTiming(0, { duration: 25 })
    );

    debris2Opacity.value = withSequence(
      withDelay(
        10,
        withSequence(
          withTiming(0.4, { duration: 25 }),
          withTiming(0.2, { duration: 20 }),
          withTiming(0.35, { duration: 18 }),
          withTiming(0.1, { duration: 15 }),
          withTiming(0.25, { duration: 15 }),
          withTiming(0, { duration: 35 })
        )
      )
    );
    debris2X.value = withSequence(
      withTiming(10, { duration: 25 }),
      withTiming(-8, { duration: 20 }),
      withTiming(6, { duration: 18 }),
      withTiming(-4, { duration: 15 }),
      withTiming(0, { duration: 25 })
    );

    debris3Opacity.value = withSequence(
      withDelay(
        20,
        withSequence(
          withTiming(0.5, { duration: 20 }),
          withTiming(0.3, { duration: 18 }),
          withTiming(0.45, { duration: 15 }),
          withTiming(0.2, { duration: 15 }),
          withTiming(0, { duration: 30 })
        )
      )
    );
    debris3Y.value = withSequence(
      withTiming(-20, { duration: 20 }),
      withTiming(20, { duration: 18 }),
      withTiming(-12, { duration: 15 }),
      withTiming(10, { duration: 15 }),
      withTiming(0, { duration: 20 })
    );

    setTimeout(() => {
      isAttacking.value = withTiming(1, { duration: 70 });
    }, 180);

    onResolve();
  };

  useEffect(() => {
    if (!loading && isAttacking.value === 1) {
      const timer = setTimeout(() => {
        isAttacking.value = 0;
        glitchOpacity.value = 1;
        glitchScale.value = 1;
        glitchX.value = 0;
        glitchRotate.value = 0;
        debris1Opacity.value = 0;
        debris2Opacity.value = 0;
        debris3Opacity.value = 0;
        setShowSpinner(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    if (resetSignal === 0) return;
    isAttacking.value = 0;
    glitchOpacity.value = 1;
    glitchScale.value = 1;
    glitchX.value = 0;
    glitchRotate.value = 0;
    debris1Opacity.value = 0;
    debris2Opacity.value = 0;
    debris3Opacity.value = 0;
    setShowSpinner(false);
  }, [resetSignal]);

  const handleFocus = () => {
    onInputFocus();
    linkInputRef.current?.measureInWindow((_left, top, _width, height) => {
      inputBottom.value = top + height;
    });
  };

  return (
    <ScrollView
      style={tw`flex-1`}
      contentContainerStyle={tw`grow px-6 pb-16`}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor="#22d3ee"
          colors={['#22d3ee']}
          progressBackgroundColor="#17324c"
          progressViewOffset={16}
        />
      }
    >
      <Header />
      <Animated.View
        style={[tw`flex-1 items-center justify-center -mt-6`, liftStyle]}
      >
        <View style={tw`w-full max-w-md`}>
          <View style={tw`items-center mb-2`}>
            {/* debris layer 1 - magenta offset */}
            <AnimatedImage
              source={pantherSitting}
              style={[tw`absolute`, debris1Style]}
              contentFit="contain"
            />
            {/* debris layer 2 - cyan offset */}
            <AnimatedImage
              source={pantherSitting}
              style={[tw`absolute`, debris2Style]}
              contentFit="contain"
            />
            {/* debris layer 3 - slice */}
            <AnimatedImage
              source={pantherSitting}
              style={[tw`absolute`, debris3Style]}
              contentFit="cover"
            />
            {/* sitting panther (default) */}
            <AnimatedImage
              source={pantherSitting}
              style={[tw`absolute`, sittingStyle]}
              contentFit="contain"
            />
            {/* attack panther (shown after glitch) */}
            <AnimatedImage
              source={pantherAttack}
              style={attackStyle}
              contentFit="contain"
            />
          </View>

          <View style={tw`relative justify-center`}>
            <View style={tw`absolute left-4 z-10`}>
              <LinkPing />
            </View>
            <TextInput
              ref={linkInputRef}
              style={[
                tw`rounded-2xl border-2 border-primary bg-black/30 pl-12 pr-4 font-mono text-[15px] text-white`,
                { height: 52, textAlignVertical: 'center' },
              ]}
              placeholder="paste your link here"
              placeholderTextColor="#5b6472"
              value={link}
              onChangeText={onChangeLink}
              onFocus={handleFocus}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Paste download link"
            />
          </View>

          <FormatBar mode={mode} setMode={setMode} onPaste={onPaste} />

          <Button3D
            label="Download"
            loading={showSpinner}
            onPress={() => {
              if (!link.trim()) return;
              onResolve();
              triggerGlitch();
            }}
          />
        </View>
      </Animated.View>
    </ScrollView>
  );
}
