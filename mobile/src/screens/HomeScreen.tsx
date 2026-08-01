import { useRef, useEffect, useState } from 'react';
import {
  View,
  TextInput,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../lib/tw';
import GhostHero, { GHOST_ASPECT } from '../components/GhostHero';
import LinkPing from '../components/LinkPing';
import Header from '../components/Header';
import Button3D from '../components/Button3D';
import FormatBar, { type DownloadMode } from '../components/FormatBar';
import { useBlurOnKeyboardHide } from '../hooks/useKeyboard';

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
  const glitchOpacity = useSharedValue(1);
  const glitchScale = useSharedValue(1);
  const glitchX = useSharedValue(0);
  const glitchRotate = useSharedValue(0);
  const [showSpinner, setShowSpinner] = useState(false);

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

  const ghostStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, kb.value / 400);
    const size = baseIconSize - progress * baseIconSize * 0.1;
    return {
      width: size,
      height: size * GHOST_ASPECT,
      opacity: glitchOpacity.value,
      transform: [
        { translateX: glitchX.value },
        { scale: glitchScale.value },
        { rotate: `${glitchRotate.value}deg` },
      ],
    };
  });

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

    onResolve();
  };

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        glitchOpacity.value = 1;
        glitchScale.value = 1;
        glitchX.value = 0;
        glitchRotate.value = 0;
        setShowSpinner(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    if (resetSignal === 0) return;
    glitchOpacity.value = 1;
    glitchScale.value = 1;
    glitchX.value = 0;
    glitchRotate.value = 0;
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
            <Animated.View style={ghostStyle}>
              <GhostHero />
            </Animated.View>
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
