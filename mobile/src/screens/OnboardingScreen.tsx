import { useState, type ComponentType } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableWithoutFeedback,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import LottieView, { type AnimationObject } from 'lottie-react-native';

import HeroSave from '../../assets/onboarding/hero-save.json';
import HeroPrivate from '../../assets/onboarding/hero-private.json';
import ArrowIcon from '../../assets/onboarding/ArrowIcon.png';
import TwinkleStars from '../components/backgrounds/TwinkleStars';
import SocialIconsBurst from '../components/ui/SocialIconsBurst';

type OnboardingData = {
  id: number;
  animation?: AnimationObject;
  Hero?: ComponentType<{ size: number }>;
  text: string;
  textColor: string;
  heroScale?: number;
};

const data: OnboardingData[] = [
  {
    id: 1,
    animation: HeroSave as AnimationObject,
    text: 'Any video or song, saved in seconds',
    textColor: '#ffffff',
  },
  {
    id: 2,
    Hero: SocialIconsBurst,
    text: 'From YouTube, Spotify, TikTok & 13+ more',
    textColor: '#ffffff',
  },
  {
    id: 3,
    animation: HeroPrivate as AnimationObject,
    text: 'No ads, completely free and Private!',
    textColor: '#ffffff',
    heroScale: 0.8,
  },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030014',
  },
  itemContainer: {
    flex: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 120,
  },
  itemText: {
    textAlign: 'left',
    alignSelf: 'stretch',
    fontSize: 44,
    fontWeight: 'bold',
    marginBottom: 10,
    paddingHorizontal: 24,
  },
  paginationContainer: {
    flexDirection: 'row',
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dots: {
    height: 10,
    marginHorizontal: 10,
    borderRadius: 5,
    backgroundColor: '#22d3ee',
  },
  button: {
    backgroundColor: '#0891b2',
    padding: 10,
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  arrow: {
    position: 'absolute',
  },
  textButton: { color: 'white', fontSize: 16, position: 'absolute' },
  bottomContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 30,
    paddingVertical: 30,
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
  },
});

function RenderItem({
  item,
  index,
  scrollX,
  activeIndex,
}: {
  item: OnboardingData;
  index: number;
  scrollX: SharedValue<number>;
  activeIndex: number;
}) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const isActive = activeIndex === index;

  const lottieAnimationStyle = useAnimatedStyle(() => {
    const translateYAnimation = interpolate(
      scrollX.value,
      [
        (index - 1) * SCREEN_WIDTH,
        index * SCREEN_WIDTH,
        (index + 1) * SCREEN_WIDTH,
      ],
      [200, 0, -200],
      Extrapolation.CLAMP
    );
    return { transform: [{ translateY: translateYAnimation }] };
  });

  const Hero = item.Hero;
  const heroSize = SCREEN_WIDTH * 0.9;
  const lottieSize = heroSize * (item.heroScale ?? 1);

  return (
    <View style={[styles.itemContainer, { width: SCREEN_WIDTH }]}>
      <Animated.View
        style={[
          {
            width: heroSize,
            height: heroSize,
            alignItems: 'center',
            justifyContent: 'center',
          },
          lottieAnimationStyle,
        ]}
      >
        {Hero
          ? isActive && <Hero key={activeIndex} size={lottieSize} />
          : item.animation && (
              <LottieView
                source={item.animation}
                style={{ width: lottieSize, height: lottieSize }}
                autoPlay
                loop
              />
            )}
      </Animated.View>
      <Text style={[styles.itemText, { color: item.textColor }]}>
        {item.text}
      </Text>
    </View>
  );
}

function Dot({
  index,
  scrollX,
}: {
  index: number;
  scrollX: SharedValue<number>;
}) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();

  const animatedDotStyle = useAnimatedStyle(() => {
    const widthAnimation = interpolate(
      scrollX.value,
      [
        (index - 1) * SCREEN_WIDTH,
        index * SCREEN_WIDTH,
        (index + 1) * SCREEN_WIDTH,
      ],
      [10, 20, 10],
      Extrapolation.CLAMP
    );
    const opacityAnimation = interpolate(
      scrollX.value,
      [
        (index - 1) * SCREEN_WIDTH,
        index * SCREEN_WIDTH,
        (index + 1) * SCREEN_WIDTH,
      ],
      [0.5, 1, 0.5],
      Extrapolation.CLAMP
    );
    return { width: widthAnimation, opacity: opacityAnimation };
  });

  return <Animated.View style={[styles.dots, animatedDotStyle]} />;
}

function Pagination({ scrollX }: { scrollX: SharedValue<number> }) {
  return (
    <View style={styles.paginationContainer}>
      {data.map((item, index) => (
        <Dot index={index} scrollX={scrollX} key={item.id} />
      ))}
    </View>
  );
}

function CustomButton({
  flatListRef,
  flatListIndex,
  dataLength,
  onDone,
}: {
  flatListRef: React.RefObject<FlatList<OnboardingData> | null>;
  flatListIndex: SharedValue<number>;
  dataLength: number;
  onDone: () => void;
}) {
  const buttonAnimationStyle = useAnimatedStyle(() => {
    return {
      width:
        flatListIndex.value === dataLength - 1
          ? withSpring(140)
          : withSpring(60),
      height: 60,
    };
  });

  const arrowAnimationStyle = useAnimatedStyle(() => {
    return {
      width: 30,
      height: 30,
      opacity:
        flatListIndex.value === dataLength - 1 ? withTiming(0) : withTiming(1),
      transform: [
        {
          translateX:
            flatListIndex.value === dataLength - 1
              ? withTiming(100)
              : withTiming(0),
        },
      ],
    };
  });

  const textAnimationStyle = useAnimatedStyle(() => {
    return {
      opacity:
        flatListIndex.value === dataLength - 1 ? withTiming(1) : withTiming(0),
      transform: [
        {
          translateX:
            flatListIndex.value === dataLength - 1
              ? withTiming(0)
              : withTiming(-100),
        },
      ],
    };
  });

  return (
    <TouchableWithoutFeedback
      onPress={() => {
        if (flatListIndex.value < dataLength - 1) {
          flatListRef.current?.scrollToIndex({
            index: flatListIndex.value + 1,
          });
        } else {
          onDone();
        }
      }}
    >
      <Animated.View style={[styles.button, buttonAnimationStyle]}>
        <Animated.Text style={[styles.textButton, textAnimationStyle]}>
          Get Started
        </Animated.Text>
        <Animated.Image
          source={ArrowIcon}
          style={[styles.arrow, arrowAnimationStyle]}
        />
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

export default function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const flatListRef = useAnimatedRef<FlatList<OnboardingData>>();
  const scrollX = useSharedValue(0);
  const flatListIndex = useSharedValue(0);
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  useAnimatedReaction(
    () => Math.round(scrollX.value / SCREEN_WIDTH),
    (page, prevPage) => {
      if (page !== prevPage) {
        flatListIndex.value = page;
        runOnJS(setActiveIndex)(page);
      }
    }
  );

  return (
    <View style={styles.container}>
      <TwinkleStars />
      <Animated.FlatList
        ref={flatListRef}
        onScroll={onScroll}
        data={data}
        renderItem={({ item, index }) => (
          <RenderItem
            item={item}
            index={index}
            scrollX={scrollX}
            activeIndex={activeIndex}
          />
        )}
        keyExtractor={(item) => item.id.toString()}
        scrollEventThrottle={16}
        horizontal
        bounces={false}
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />
      <View style={styles.bottomContainer}>
        <Pagination scrollX={scrollX} />
        <CustomButton
          flatListRef={flatListRef}
          flatListIndex={flatListIndex}
          dataLength={data.length}
          onDone={onDone}
        />
      </View>
    </View>
  );
}
