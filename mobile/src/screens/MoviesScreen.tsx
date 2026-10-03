import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  RefreshControl,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { Search, X, Star, Play } from 'lucide-react-native';
import tw from '../lib/tw';
import ufo from '../../assets/UFO.json';
import { PlatformLogo } from '../components/logos';
import MovieDetailSheet from '../components/sheets/MovieDetailSheet';
import {
  searchTitles,
  listRail,
  listTrending,
  type LunaItem,
} from '../extractors/watchluna/browse';
import { tapSelection } from '../lib/haptics';

type Props = {
  visible: boolean;
};

type Rail = { key: string; title: string; path: string; items: LunaItem[] };

const RAIL_DEFS = [
  { key: 'popular', title: 'Popular Movies', path: '/movies' },
  { key: 'top', title: 'Top Rated', path: '/movies?sort=top_rated' },
  { key: 'now', title: 'Now Playing', path: '/movies?filter=now_playing' },
];

function PosterCard({
  item,
  width,
  height,
  onOpen,
}: {
  item: LunaItem;
  width: number;
  height: number;
  onOpen: (item: LunaItem) => void;
}) {
  return (
    <Pressable
      onPress={() => {
        tapSelection();
        onOpen(item);
      }}
      accessibilityLabel={`${item.title}, ${item.year ?? ''}`}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={tw`overflow-hidden rounded-2xl border border-white/10 bg-white/5`}>
        {item.poster ? (
          <Image
            source={{ uri: item.poster }}
            style={{ width, height }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[tw`items-center justify-center bg-white/5`, { width, height }]}>
            <Play size={22} color="#64748b" />
          </View>
        )}
        {typeof item.rating === 'number' && (
          <View style={tw`absolute left-1.5 top-1.5 flex-row items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5`}>
            <Star size={10} color="#facc15" />
            <Text style={tw`font-mono text-[10px] text-white`}>{item.rating.toFixed(1)}</Text>
          </View>
        )}
      </View>
      <Text style={tw`mt-1.5 font-mono-semibold text-[11px] text-slate-100`} numberOfLines={1}>
        {item.title}
      </Text>
      {item.year && (
        <Text style={tw`font-mono text-[10px] text-slate-500`}>{item.year}</Text>
      )}
    </Pressable>
  );
}

function TrendingCard({
  item,
  active,
  onOpen,
}: {
  item: LunaItem;
  active: boolean;
  onOpen: (item: LunaItem) => void;
}) {
  const scale = useSharedValue(active ? 1 : 0.9);

  useEffect(() => {
    scale.value = withSpring(active ? 1 : 0.9, { damping: 18, stiffness: 220 });
  }, [active, scale]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[tw`mr-4`, animated]}>
      <Pressable
        onPress={() => {
          tapSelection();
          onOpen(item);
        }}
        accessibilityLabel={`Trending: ${item.title}`}
      >
        <View style={tw`overflow-hidden rounded-[28px] border border-white/10`}>
          {item.poster ? (
            <Image
              source={{ uri: item.poster }}
              style={tw`h-64 w-44`}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={tw`h-64 w-44 items-center justify-center bg-white/5`}>
              <Play size={26} color="#64748b" />
            </View>
          )}
          <View style={tw`absolute inset-x-0 bottom-0 bg-black/60 px-3 pb-2.5 pt-6`}>
            <Text style={tw`font-sans-bold text-[14px] text-white`} numberOfLines={1}>
              {item.title}
            </Text>
            {item.year && (
              <Text style={tw`font-mono text-[10px] text-slate-300`}>{item.year}</Text>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function MoviesScreenInner({ visible }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LunaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [trending, setTrending] = useState<LunaItem[]>([]);
  const [rails, setRails] = useState<Rail[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<LunaItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const booted = useRef(false);
  const seq = useRef(0);

  const loadBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const [foundTrending, ...foundRails] = await Promise.all([
        listTrending().catch(() => null),
        ...RAIL_DEFS.map((def) =>
          listRail(def.path, 1, def.title)
            .then((rail) => ({ ...def, items: rail?.items ?? [] }))
            .catch(() => ({ ...def, items: [] }))
        ),
      ]);
      setTrending(foundTrending ?? []);
      setActiveId(foundTrending?.[0] ? `${foundTrending[0].kind}-${foundTrending[0].id}` : null);
      setRails(foundRails);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible || booted.current) return;
    booted.current = true;
    void loadBrowse();
  }, [visible, loadBrowse]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const current = seq.current + 1;
    seq.current = current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items = await searchTitles(term);
          if (seq.current === current) setResults(items);
        } catch {
          if (seq.current === current) setResults([]);
        } finally {
          if (seq.current === current) setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const openDetail = useCallback((item: LunaItem) => {
    setSelected(item);
    setSheetOpen(true);
  }, []);

  const onQuery = (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) {
      seq.current += 1;
      setResults([]);
      setSearching(false);
    } else {
      setSearching(true);
    }
  };

  const viewable = useRef(({ viewableItems }: { viewableItems: { item: LunaItem }[] }) => {
    const first = viewableItems[0]?.item;
    if (first) setActiveId(`${first.kind}-${first.id}`);
  });

  const viewConfig = useRef({ itemVisiblePercentThreshold: 70 });

  const inSearch = query.trim().length >= 2;
  const gridW = (width - 32 - 24) / 3;

  return (
    <View
      style={[
        tw`absolute inset-0 bg-background`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      <View style={[tw`px-4 pb-2`, { paddingTop: insets.top + 12 }]}>
        <View style={tw`flex-row items-center justify-between`}>
          <View>
            <Text style={tw`font-mono text-[11px] tracking-widest text-cyan-400`}>
              WATCHLUNA
            </Text>
            <Text style={tw`font-sans-bold text-[30px] tracking-tight text-white`}>
              {inSearch ? 'Results' : 'Movies'}
            </Text>
          </View>
          <PlatformLogo name="watchluna" size={30} />
        </View>
        <View style={tw`relative mt-3 justify-center`}>
          <TextInput
            style={[
              tw`rounded-2xl border-2 border-primary bg-black/30 pl-12 pr-10 font-mono text-[15px] text-white`,
              { height: 52, textAlignVertical: 'center' },
            ]}
            placeholder="Search movies and shows…"
            placeholderTextColor="#5b6472"
            value={query}
            onChangeText={onQuery}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search movies and shows"
          />
          <View style={tw`absolute left-4`}>
            <Search size={20} color="#5b6472" />
          </View>
          {query.length > 0 && (
            <Pressable
              onPress={() => {
                tapSelection();
                setQuery('');
                Keyboard.dismiss();
              }}
              style={tw`absolute right-3 rounded-full p-1`}
              accessibilityLabel="Clear search"
            >
              <X size={18} color="#94a3b8" />
            </Pressable>
          )}
        </View>
      </View>

      {inSearch ? (
        <FlatList
          data={results}
          numColumns={3}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          columnWrapperStyle={tw`gap-3 px-4`}
          contentContainerStyle={tw`gap-3 pb-32 pt-2`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PosterCard item={item} width={gridW} height={gridW * 1.5} onOpen={openDetail} />
          )}
          ListHeaderComponent={
            searching ? (
              <Text style={tw`px-4 pb-2 font-mono text-[12px] text-slate-400`}>
                Searching for “{query.trim()}”…
              </Text>
            ) : (
              <Text style={tw`px-4 pb-2 font-mono text-[12px] text-slate-400`}>
                {results.length === 0
                  ? `No results for “${query.trim()}”`
                  : `${results.length} results for “${query.trim()}”`}
              </Text>
            )
          }
          ListEmptyComponent={
            searching ? null : (
              <View style={tw`items-center px-8 pt-10`}>
                <LottieView source={ufo} autoPlay loop style={{ width: 180, height: 180 }} />
                <Text style={tw`mt-2 text-center font-mono-medium text-sm text-cyan-400`}>
                  Nothing found out there.
                </Text>
                <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
                  Try another title or check the spelling.
                </Text>
              </View>
            )
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={tw`pb-32`}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void loadBrowse()}
              tintColor="#22d3ee"
              colors={['#22d3ee']}
              progressBackgroundColor="#17324c"
            />
          }
        >
          {trending.length > 0 && (
            <View style={tw`pt-2`}>
              <Text style={tw`px-4 pb-2 font-sans-bold text-[16px] text-slate-200`}>
                Trending this week
              </Text>
              <FlatList
                data={trending}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={tw`px-4`}
                keyExtractor={(item) => `${item.kind}-${item.id}`}
                renderItem={({ item }) => (
                  <TrendingCard
                    item={item}
                    active={activeId === `${item.kind}-${item.id}`}
                    onOpen={openDetail}
                  />
                )}
                onViewableItemsChanged={viewable.current}
                viewabilityConfig={viewConfig.current}
              />
            </View>
          )}
          {rails.map((rail) =>
            rail.items.length > 0 ? (
              <View key={rail.key} style={tw`mt-5`}>
                <Text style={tw`px-4 pb-2 font-sans-bold text-[16px] text-slate-200`}>
                  {rail.title}
                </Text>
                <FlatList
                  data={rail.items}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={tw`gap-3 px-4`}
                  keyExtractor={(item) => `${item.kind}-${item.id}`}
                  renderItem={({ item }) => (
                    <PosterCard item={item} width={112} height={168} onOpen={openDetail} />
                  )}
                />
              </View>
            ) : null
          )}
          {trending.length === 0 && rails.every((rail) => rail.items.length === 0) && !loading && (
            <View style={tw`items-center px-8 pt-10`}>
              <LottieView source={ufo} autoPlay loop style={{ width: 200, height: 200 }} />
              <Text style={tw`mt-2 text-center font-mono-medium text-sm text-cyan-400`}>
                Could not reach Watchluna.
              </Text>
              <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
                Pull down to retry.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      <MovieDetailSheet
        item={selected}
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false);
          setSelected(null);
        }}
      />
    </View>
  );
}

const MoviesScreen = memo(MoviesScreenInner);
export default MoviesScreen;
