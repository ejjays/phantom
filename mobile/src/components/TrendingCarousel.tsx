import { useRef, useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolateColor,
  type SharedValue,
} from 'react-native-reanimated';
import Carousel, {
  type ICarouselInstance,
} from 'react-native-reanimated-carousel';
import { Image } from 'expo-image';
import { Star } from 'lucide-react-native';
import tw from '../lib/tw';
import { tapSelection } from '../lib/haptics';
import type { LunaItem } from '../extractors/watchluna/browse';

const CYAN = '#22d3ee';

function TrendingSlide({
  item,
  slotW,
  index,
  onOpen,
}: {
  item: LunaItem;
  slotW: number;
  index: number;
  onOpen: (item: LunaItem) => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable
        onPress={() => {
          tapSelection();
          onOpen(item);
        }}
        testID={`movie-trending-${index}`}
        accessibilityLabel={`Trending: ${item.title}`}
        style={{ width: slotW - 18 }}
      >
        <View style={tw`overflow-hidden rounded-[28px] border border-white/10 bg-white/5`}>
          {item.poster ? (
            <Image
              source={{ uri: item.poster }}
              style={tw`h-72 w-full`}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={tw`h-72 w-full items-center justify-center bg-white/5`}>
              <Text style={tw`font-sans-bold text-[18px] text-slate-400`} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          )}
          <View style={tw`absolute inset-x-0 bottom-0 bg-black/60 px-4 pb-3 pt-8`}>
            <Text style={tw`font-sans-bold text-[16px] text-white`} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={tw`mt-1 flex-row items-center gap-2`}>
              {item.year && (
                <Text style={tw`font-mono text-[11px] text-slate-300`}>{item.year}</Text>
              )}
              {typeof item.rating === 'number' && (
                <View style={tw`flex-row items-center gap-1`}>
                  <Star size={11} color="#facc15" />
                  <Text style={tw`font-mono text-[11px] text-slate-200`}>
                    {item.rating.toFixed(1)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function TrendingDot({
  index,
  count,
  progress,
  onPress,
}: {
  index: number;
  count: number;
  progress: SharedValue<number>;
  onPress: (index: number) => void;
}) {
  const style = useAnimatedStyle(() => {
    const raw = Math.abs(progress.value - index);
    const dist = Math.min(raw, count - raw);
    const active = 1 - Math.min(dist, 1);
    return {
      width: 8 + active * 14,
      backgroundColor: interpolateColor(
        active,
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

export default function TrendingCarousel({
  items,
  onOpen,
}: {
  items: LunaItem[];
  onOpen: (item: LunaItem) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const slotW = Math.min(windowWidth - 32, 600);
  const carouselRef = useRef<ICarouselInstance>(null);
  const progress = useSharedValue(0);
  const [active, setActive] = useState(0);

  if (items.length === 0) return null;

  const onDotPress = (index: number) => {
    tapSelection();
    carouselRef.current?.scrollTo({ count: index - active, animated: true });
  };

  return (
    <View>
      <Carousel
        ref={carouselRef}
        data={items}
        loop={items.length > 1}
        autoPlay={items.length > 1}
        autoPlayInterval={4500}
        scrollAnimationDuration={700}
        width={slotW}
        height={296}
        mode="parallax"
        modeConfig={{
          parallaxScrollingScale: 0.92,
          parallaxScrollingOffset: 48,
          parallaxAdjacentItemScale: 0.82,
        }}
        onProgressChange={(_, absolute) => {
          progress.value = absolute;
        }}
        onSnapToItem={setActive}
        renderItem={({ item, index }) => (
          <TrendingSlide item={item} slotW={slotW} index={index} onOpen={onOpen} />
        )}
      />
      {items.length > 1 && (
        <View style={[tw`mt-2.5 flex-row items-center justify-center`, { gap: 6 }]}>
          {items.map((item, index) => (
            <TrendingDot
              key={`${item.kind}-${item.id}`}
              index={index}
              count={items.length}
              progress={progress}
              onPress={onDotPress}
            />
          ))}
        </View>
      )}
    </View>
  );
}
