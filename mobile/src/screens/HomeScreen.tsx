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
} from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../lib/tw';
import PhantomHero, { PHANTOM_ASPECT } from '../components/PhantomHero';
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
      height: size * PHANTOM_ASPECT,
    };
  });

  const triggerDownload = () => {
    setShowSpinner(true);

    onResolve();
  };

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        setShowSpinner(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    if (resetSignal === 0) return;
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
              <PhantomHero />
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
              triggerDownload();
            }}
          />
        </View>
      </Animated.View>
    </ScrollView>
  );
}
