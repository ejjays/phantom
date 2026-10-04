import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Star, Play } from 'lucide-react-native';
import tw from '../lib/tw';
import { tapSelection } from '../lib/haptics';
import type { LunaItem } from '../extractors/watchluna/browse';

const ACCENT = '#EB2F3D';

function MetaLine({ item }: { item: LunaItem }) {
  const rating = item.rating;
  const hasRating = typeof rating === 'number';
  const bits = [
    hasRating ? rating.toFixed(1) : null,
    item.year ?? null,
  ].filter((bit): bit is string => bit !== null);
  const label = bits.length > 0 ? bits.join('  •  ') : item.kind === 'tv' ? 'TV SHOW' : 'MOVIE';
  return (
    <View style={tw`mt-1 flex-row items-center gap-1.5`}>
      {hasRating && <Star size={12} color="#facc15" />}
      <Text style={tw`font-sans-medium text-[12px] text-slate-300`} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function TrendingSlide({
  item,
  pageW,
  bannerH,
  index,
  onOpen,
  onPlay,
}: {
  item: LunaItem;
  pageW: number;
  bannerH: number;
  index: number;
  onOpen: (item: LunaItem) => void;
  onPlay: (item: LunaItem) => void;
}) {
  return (
    <View style={{ width: pageW, paddingHorizontal: 16 }}>
      <View style={tw`overflow-hidden rounded-[48px] bg-[#1E1E1E]`}>
        <Pressable
          onPress={() => {
            tapSelection();
            onOpen(item);
          }}
          testID={`movie-trending-${index}`}
          accessibilityLabel={`Trending: ${item.title}`}
        >
            {item.poster ? (
              <Image
                source={{ uri: item.poster }}
                style={{ width: pageW - 32, height: bannerH }}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
            <View
              style={[
                tw`items-center justify-center bg-[#1E1E1E] px-8`,
                { width: pageW - 32, height: bannerH },
              ]}
            >
              <Text style={tw`text-center font-sans-semibold text-[18px] text-white`} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            tapSelection();
            onPlay(item);
          }}
          accessibilityLabel={`Watch now: ${item.title}`}
          style={tw`absolute bottom-4 right-4 flex-row items-center gap-1.5 rounded-full bg-[#1E1E1E] py-2 pl-3 pr-3.5`}
        >
          <Text style={tw`font-sans-medium text-[12px] text-white`}>Watch Now</Text>
          <Play size={14} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={tw`mx-3 -mt-16 rounded-[32px] bg-[#1E1E1E]`}>
        <View style={tw`flex-row items-center justify-between gap-3 px-5 py-4`}>
          <View style={tw`flex-1`}>
            <Text style={tw`font-sans-semibold text-[16px] text-white`} numberOfLines={1}>
              {item.title.toUpperCase()}
            </Text>
            <MetaLine item={item} />
          </View>
          <Pressable
            onPress={() => {
              tapSelection();
              onOpen(item);
            }}
            accessibilityLabel={`Details: ${item.title}`}
          >
            <LinearGradient
              colors={['#333333', '#767676', '#363535']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={tw`rounded-full px-5 py-2.5`}
            >
              <Text style={tw`font-sans-medium text-[14px] text-white`}>Details</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function TrendingDot({
  index,
  active,
  onPress,
}: {
  index: number;
  active: boolean;
  onPress: (index: number) => void;
}) {
  return (
    <Pressable onPress={() => onPress(index)} hitSlop={12}>
      <View
        style={[
          tw`rounded-full`,
          {
            height: 4,
            width: active ? 22 : 8,
            backgroundColor: active ? ACCENT : 'rgba(255,255,255,0.2)',
          },
        ]}
      />
    </Pressable>
  );
}

export default function TrendingCarousel({
  items,
  onOpen,
  onPlay,
}: {
  items: LunaItem[];
  onOpen: (item: LunaItem) => void;
  onPlay: (item: LunaItem) => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const listW = windowWidth;
  const pageW = Math.min(windowWidth - 64, 560);
  const sidePad = (listW - pageW) / 2;
  const bannerH = Math.round(((pageW - 32) * 310) / 353);
  const listRef = useRef<FlatList<LunaItem>>(null);
  const [raw, setRaw] = useState(() => (items.length > 1 ? items.length : 0));
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const [dotActive, setDotActive] = useState(0);
  const dotRef = useRef(0);

  const total = items.length;
  const trio = useMemo(
    () => (total > 1 ? [...items, ...items, ...items] : items),
    [items, total]
  );
  const dot = total > 0 ? ((dotActive % total) + total) % total : 0;

  useEffect(() => {
    if (total < 2) return undefined;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: rawRef.current + 1, animated: true });
    }, 4500);
    return () => clearTimeout(timer);
  }, [raw, total, trio]);

  const normalize = useCallback(
    (value: number) => {
      if (total < 2) return value;
      if (value < total) {
        listRef.current?.scrollToIndex({ index: value + total, animated: false });
        return value + total;
      }
      if (value >= 2 * total) {
        listRef.current?.scrollToIndex({ index: value - total, animated: false });
        return value - total;
      }
      return value;
    },
    [total]
  );

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const value = Math.round(event.nativeEvent.contentOffset.x / pageW);
    if (value >= 0 && value < trio.length) setRaw(normalize(value));
  };

  const onLiveScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (total < 2) return;
    const value = Math.round(event.nativeEvent.contentOffset.x / pageW);
    const next = ((value % total) + total) % total;
    if (next !== dotRef.current) {
      dotRef.current = next;
      setDotActive(next);
    }
  };

  const onDotPress = useCallback(
    (index: number) => {
      tapSelection();
      listRef.current?.scrollToIndex({ index: total + index, animated: true });
    },
    [total]
  );

  if (items.length === 0) return null;

  const onScrollToIndexFailed = (info: { index: number }) => {
    listRef.current?.scrollToOffset({ offset: info.index * pageW, animated: false });
  };

  return (
    <View>
      <FlatList
        ref={listRef}
        data={trio}
        style={{ width: listW }}
        contentContainerStyle={{ paddingHorizontal: sidePad }}
        initialScrollIndex={total > 1 ? total : 0}
        initialNumToRender={3}
        horizontal
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        snapToInterval={pageW}
        decelerationRate="fast"
        disableIntervalMomentum
        keyExtractor={(item, index) => `${item.kind}-${item.id}-${index}`}
        getItemLayout={(_, index) => ({ length: pageW, offset: pageW * index, index })}
        onMomentumScrollEnd={onMomentumEnd}
        onScroll={onLiveScroll}
        onScrollToIndexFailed={onScrollToIndexFailed}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => (
          <TrendingSlide
            item={item}
            pageW={pageW}
            bannerH={bannerH}
            index={index}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        )}
      />
      {items.length > 1 && (
        <View style={[tw`mt-2.5 flex-row items-center justify-center`, { gap: 6 }]}>
          {items.map((item, index) => (
            <TrendingDot
              key={`${item.kind}-${item.id}`}
              index={index}
              active={index === dot}
              onPress={onDotPress}
            />
          ))}
        </View>
      )}
    </View>
  );
}
