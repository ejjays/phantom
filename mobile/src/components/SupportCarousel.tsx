import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  interpolateColor,
  Extrapolation,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import Carousel, {
  type ICarouselInstance,
} from 'react-native-reanimated-carousel';
import LottieView from 'lottie-react-native';
import tw from '../lib/tw';
import { tapSelection } from '../lib/haptics';
import HeroLottieCard, { textOutline } from './HeroLottieCard';
import SocialCard from './SocialCard';
import { GithubIcon, InstagramIcon, XIcon, FacebookIcon } from './icons';
import supportBg from '../../assets/support/background.json';
import githubBg from '../../assets/github/github-bg.json';
import star from '../../assets/github/star.json';

const CYAN = '#22d3ee';

const SOCIAL_LINKS = [
  {
    id: 'instagram',
    Icon: InstagramIcon,
    color: '#e1306c',
    fillColor: '#e1306c',
    url: 'https://instagram.com/ejjay.alloso',
  },
  {
    id: 'x',
    Icon: XIcon,
    color: '#ffffff',
    fillColor: '#000000',
    url: 'https://x.com/ejjaysz',
  },
  {
    id: 'facebook',
    Icon: FacebookIcon,
    color: '#1877F2',
    fillColor: '#1877F2',
    url: 'https://www.facebook.com/ejjaysz',
  },
] as const;

const CAROUSEL_CARDS = ['support', 'social', 'github'] as const;
type CarouselCardId = (typeof CAROUSEL_CARDS)[number];
const CAROUSEL_DATA: CarouselCardId[] = [...CAROUSEL_CARDS];

type CardHandlers = {
  onSupport: () => void;
  onGithub: () => void;
  onSocial: (url: string) => void;
};

function SupportCardContent({
  id,
  cardW,
  cardHeight = 200,
  starActive,
  onSupport,
  onGithub,
  onSocial,
  onInteraction,
}: {
  id: CarouselCardId;
  cardW: number;
  cardHeight?: number;
  starActive: boolean;
  onInteraction: () => void;
} & CardHandlers) {
  if (id === 'support') {
    return (
      <Pressable onPress={onSupport} onPressIn={onInteraction}>
        <HeroLottieCard source={supportBg} minHeight={cardHeight}>
          <Text
            style={[
              tw`font-sans-bold text-[20px] leading-7 text-white`,
              textOutline,
            ]}
          >
            Support the build
          </Text>
          <Text
            style={[
              tw`mt-1.5 font-sans-medium text-[12px] text-white`,
              textOutline,
              { textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 6 },
            ]}
          >
            If it helped you, you can support the work behind it. 💙
          </Text>
        </HeroLottieCard>
      </Pressable>
    );
  }
  if (id === 'social') {
    return (
      <SocialCard
        width={cardW}
        height={cardHeight}
        links={SOCIAL_LINKS}
        onOpen={onSocial}
        onInteraction={onInteraction}
      />
    );
  }
  return (
    <Pressable onPress={onGithub} onPressIn={onInteraction}>
      <HeroLottieCard
        source={githubBg}
        bgColor="#241654"
        glow
        glowColor="#673AB7"
        minHeight={cardHeight}
        rightSlot={
          starActive ? (
            <LottieView
              key="star-active"
              source={star}
              autoPlay
              loop
              renderMode="HARDWARE"
              style={{ width: 94, height: 94 }}
            />
          ) : (
            <View style={{ width: 94, height: 94 }} />
          )
        }
        bottomLeft={
          <Text style={[tw`font-sans text-[10px] text-white/50`, textOutline]}>
            Licensed under AGPLv3
          </Text>
        }
      >
        <View style={tw`mb-2.5`}>
          <GithubIcon size={30} color="#ffffff" />
        </View>
        <Text
          style={[
            tw`font-sans-bold text-[20px] leading-7 text-white pr-18`,
            textOutline,
          ]}
        >
          Give a star on{'\n'}GitHub
        </Text>
        <Text
          style={[
            tw`mt-1.5 font-sans-medium text-[12px] text-white/85 pr-18`,
            textOutline,
          ]}
        >
          Panther is fully free & open source
        </Text>
      </HeroLottieCard>
    </Pressable>
  );
}

function CarouselCardItem({
  id,
  width,
  animationValue,
  starActive,
  onSupport,
  onGithub,
  onSocial,
  onInteraction,
}: {
  id: CarouselCardId;
  width: number;
  animationValue: SharedValue<number>;
  starActive: boolean;
  onInteraction: () => void;
} & CardHandlers) {
  const cardW = width - 18;
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animationValue.value,
      [-1, 0, 1],
      [0.55, 1, 0.55],
      Extrapolation.CLAMP
    ),
  }));
  return (
    <Animated.View
      style={[
        { flex: 1, alignItems: 'center', justifyContent: 'center' },
        fadeStyle,
      ]}
    >
      <View style={{ width: cardW }}>
        <SupportCardContent
          id={id}
          cardW={cardW}
          starActive={starActive}
          onSupport={onSupport}
          onGithub={onGithub}
          onSocial={onSocial}
          onInteraction={onInteraction}
        />
      </View>
    </Animated.View>
  );
}

function CarouselDot({
  index,
  progress,
  onPress,
}: {
  index: number;
  progress: SharedValue<number>;
  onPress: (index: number) => void;
}) {
  const style = useAnimatedStyle(() => {
    const len = CAROUSEL_DATA.length;
    const raw = Math.abs(progress.value - index);
    const dist = Math.min(raw, len - raw);
    const t = 1 - Math.min(dist, 1);
    return {
      width: 8 + t * 14,
      backgroundColor: interpolateColor(
        t,
        [0, 1],
        ['rgba(255,255,255,0.2)', CYAN]
      ),
    };
  });
  return (
    <Pressable onPress={() => onPress(index)} hitSlop={12}>
      <Animated.View style={[{ height: 4, borderRadius: 2 }, style]} />
    </Pressable>
  );
}

function StackCard({
  id,
  index,
  cardW,
  cardHeight,
  visible,
  onSupport,
  onGithub,
  onSocial,
  onInteraction,
}: {
  id: CarouselCardId;
  index: number;
  cardW: number;
  cardHeight: number;
  visible: boolean;
  onInteraction: () => void;
} & CardHandlers) {
  const startX = index === 1 ? 40 : -40;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    if (!visible) return;
    progress.value = withDelay(
      index * 90,
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) })
    );
  }, [visible, index, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * startX }],
  }));
  return (
    <Animated.View style={style}>
      <SupportCardContent
        id={id}
        cardW={cardW}
        cardHeight={cardHeight}
        starActive
        onSupport={onSupport}
        onGithub={onGithub}
        onSocial={onSocial}
        onInteraction={onInteraction}
      />
    </Animated.View>
  );
}

export default function SupportCarousel({
  visible,
  onOpenSupport,
  onOpenSource,
  onOpenSocial,
  layout = 'carousel',
  width,
}: {
  visible: boolean;
  onOpenSupport: () => void;
  onOpenSource: () => void;
  onOpenSocial: (url: string) => void;
  layout?: 'carousel' | 'stack';
  width?: number;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const contentW = width ?? Math.min(windowWidth - 40, 600);

  const carouselRef = useRef<ICarouselInstance>(null);
  const progress = useSharedValue(0);
  const [activeCard, setActiveCard] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const stopAutoplay = useCallback(() => setAutoPlay(false), []);

  const handleOpenSupport = useCallback(() => {
    stopAutoplay();
    onOpenSupport();
  }, [onOpenSupport, stopAutoplay]);

  const handleOpenSource = useCallback(() => {
    stopAutoplay();
    onOpenSource();
  }, [onOpenSource, stopAutoplay]);

  const handleOpenSocial = useCallback(
    (url: string) => {
      stopAutoplay();
      onOpenSocial(url);
    },
    [onOpenSocial, stopAutoplay]
  );

  const onDotPress = (index: number) => {
    tapSelection();
    stopAutoplay();
    carouselRef.current?.scrollTo({
      count: index - progress.value,
      animated: true,
    });
  };

  if (layout === 'stack') {
    return (
      <View style={{ gap: 24 }}>
        {CAROUSEL_DATA.map((id, i) => (
          <StackCard
            key={id}
            id={id}
            index={i}
            cardW={contentW}
            cardHeight={224}
            visible={visible}
            onSupport={handleOpenSupport}
            onGithub={handleOpenSource}
            onSocial={handleOpenSocial}
            onInteraction={stopAutoplay}
          />
        ))}
      </View>
    );
  }

  return (
    <View>
      <View
        onStartShouldSetResponder={() => {
          stopAutoplay();
          return false;
        }}
        onResponderTerminationRequest={() => false}
      >
        <Carousel
          ref={carouselRef}
          data={CAROUSEL_DATA}
          loop
          autoPlay={autoPlay && visible}
          autoPlayInterval={4000}
          scrollAnimationDuration={700}
          width={contentW}
          height={208}
          mode="parallax"
          modeConfig={{
            parallaxScrollingScale: 0.92,
            parallaxScrollingOffset: 48,
            parallaxAdjacentItemScale: 0.82,
          }}
          onConfigurePanGesture={(gesture) => {
            gesture.onBegin(() => {
              'worklet';
              runOnJS(stopAutoplay)();
            });
          }}
          onProgressChange={(_, absoluteProgress) => {
            progress.value = absoluteProgress;
          }}
          onSnapToItem={setActiveCard}
          renderItem={({ item, animationValue }) => (
            <CarouselCardItem
              id={item}
              width={contentW}
              animationValue={animationValue}
              starActive={activeCard === 2}
              onSupport={handleOpenSupport}
              onGithub={handleOpenSource}
              onSocial={handleOpenSocial}
              onInteraction={stopAutoplay}
            />
          )}
        />
      </View>
      <View
        style={[tw`mt-2.5 flex-row items-center justify-center`, { gap: 6 }]}
      >
        {CAROUSEL_DATA.map((id, i) => (
          <CarouselDot
            key={id}
            index={i}
            progress={progress}
            onPress={onDotPress}
          />
        ))}
      </View>
    </View>
  );
}
