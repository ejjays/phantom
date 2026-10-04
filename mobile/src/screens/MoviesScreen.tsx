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
  ActivityIndicator,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { X, ChevronRight } from 'lucide-react-native';
import tw from '../lib/tw';
import { useBackHandler } from '../lib/back';
import { usePressScale } from '../hooks/usePressScale';
import ufo from '../../assets/UFO.json';
import {
  MoviesSearchCircleIcon,
  MoviesBackCircleIcon,
  MoviesFilterIcon,
  PhantomIcon,
  Play3Icon,
} from '../components/icons';
import TrendingCarousel from '../components/TrendingCarousel';
import MovieDetailScreen from './MovieDetailScreen';
import MoviePlayerScreen from './MoviePlayerScreen';
import {
  searchTitles,
  listRail,
  listTrending,
  getTitleDetails,
  type LunaItem,
} from '../extractors/watchluna/browse';
import { tapSelection } from '../lib/haptics';
import { log, error as logError } from '../lib/log';

type Props = {
  visible: boolean;
  onFullScreen?: (open: boolean) => void;
  onClose: () => void;
};

type Rail = {
  key: string;
  title: string;
  path: string;
  items: LunaItem[];
  page: number;
  totalPages: number;
  loadingMore: boolean;
};

const RAIL_DEFS = [
  { key: 'popular', title: 'Popular Movies', path: '/movies' },
  { key: 'top', title: 'Top Rated', path: '/movies?sort=top_rated' },
  { key: 'now', title: 'Now Playing', path: '/movies?filter=now_playing' },
  { key: 'tv-popular', title: 'Popular TV Shows', path: '/tv' },
  { key: 'tv-top', title: 'Top Rated TV', path: '/tv?sort=top_rated' },
  { key: 'airing', title: 'Airing Today', path: '/airing-today' },
];

const EXPLORE_CAP = 10;

function PosterCard({
  item,
  width,
  height,
  testID,
  onOpen,
}: {
  item: LunaItem;
  width: number;
  height: number;
  testID?: string;
  onOpen: (item: LunaItem) => void;
}) {
  const radius = Math.round(width * 0.24);
  const playSize = Math.max(13, Math.round(width * 0.13));
  const badgePad = Math.max(4, Math.round(width * 0.04));
  const titleSize = width >= 150 ? 16 : 12;
  const { pressScaleStyle, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable
      onPress={() => {
        tapSelection();
        onOpen(item);
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testID}
      accessibilityLabel={`${item.title}, ${item.year ?? ''}`}
      style={{ width }}
    >
      <Animated.View style={pressScaleStyle}>
      <View style={[tw`overflow-hidden bg-white/5`, { borderRadius: radius }]}>
        {item.poster ? (
          <Image
            source={{ uri: item.poster }}
            style={{ width, height }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[tw`items-center justify-center bg-white/5`, { width, height }]}>
            <Play3Icon size={playSize} color="#64748b" />
          </View>
        )}
        {item.poster ? (
          <View
            style={[
              tw`absolute items-center justify-center`,
              {
                right: Math.round(width * 0.12),
                bottom: Math.round(height * 0.08),
                padding: badgePad,
                borderRadius: 999,
                backgroundColor: 'rgba(30, 30, 30, 0.8)',
              },
            ]}
          >
            <Play3Icon size={playSize} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text
        style={[tw`mt-1.5 font-sans-medium uppercase text-slate-100`, { fontSize: titleSize }]}
        numberOfLines={1}
      >
        {item.title}
      </Text>
      </Animated.View>
    </Pressable>
  );
}

function MoviesScreenInner({ visible, onFullScreen, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LunaItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [trending, setTrending] = useState<LunaItem[]>([]);
  const [rails, setRails] = useState<Rail[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LunaItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playerItem, setPlayerItem] = useState<LunaItem | null>(null);
  const [railKey, setRailKey] = useState<string | null>(null);
  const [exploreItems, setExploreItems] = useState<LunaItem[]>([]);
  const [explorePage, setExplorePage] = useState(0);
  const [exploreTotal, setExploreTotal] = useState(1);
  const [exploreMore, setExploreMore] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recents, setRecents] = useState<LunaItem[]>([]);
  const searchRef = useRef<TextInput>(null);
  const booted = useRef(false);
  const seq = useRef(0);
  const busyRails = useRef<Record<string, boolean>>({});
  const busyExplore = useRef(false);

  const enrichTrending = useCallback(async (seed: LunaItem[]) => {
    const started = Date.now();
    const settled = await Promise.allSettled(
      seed.slice(0, 10).map((item) => getTitleDetails(item.kind, item.id))
    );
    const known = new Map<string, { rating?: number; year?: string }>();
    settled.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const found = result.value;
      if (found.rating !== undefined || found.year !== undefined) {
        known.set(`${seed[index].kind}-${seed[index].id}`, {
          rating: found.rating,
          year: found.year,
        });
      }
    });
    if (known.size === 0) return;
    setTrending((prev) =>
      prev.map((item) => {
        const meta = known.get(`${item.kind}-${item.id}`);
        if (!meta) return item;
        return {
          ...item,
          rating: meta.rating ?? item.rating,
          year: meta.year ?? item.year,
        };
      })
    );
    log('Movies', `trending enriched ${known.size} ms=${Date.now() - started}`);
  }, []);

  const loadBrowse = useCallback(async () => {
    const started = Date.now();
    log('Movies', 'browse start');
    setLoading(true);
    try {
      const [foundTrending, ...foundRails] = await Promise.all([
        listTrending().catch((err: unknown) => {
          logError('Movies', `trending failed: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }),
        ...RAIL_DEFS.map((def) =>
          listRail(def.path, 1, def.title)
            .then((rail) => ({
              ...def,
              items: rail?.items ?? [],
              page: 1,
              totalPages: rail?.totalPages ?? 1,
              loadingMore: false,
            }))
            .catch((err: unknown) => {
              logError('Movies', `rail ${def.key} failed: ${err instanceof Error ? err.message : String(err)}`);
              return { ...def, items: [], page: 1, totalPages: 1, loadingMore: false };
            })
        ),
      ]);
      setTrending(foundTrending ?? []);
      setRails(foundRails);
      setExploreItems([]);
      setExplorePage(0);
      setExploreTotal(1);
      const summary = foundRails.map((rail) => `${rail.key}:${rail.items.length}`).join(',');
      log(
        'Movies',
        `browse done trending=${foundTrending?.length ?? 0} rails=${summary} ms=${Date.now() - started}`
      );
      if (foundTrending && foundTrending.length > 0) void enrichTrending(foundTrending);
    } finally {
      setLoading(false);
    }
  }, [enrichTrending]);

  useEffect(() => {
    if (!visible || booted.current) return;
    booted.current = true;
    void loadBrowse();
  }, [visible, loadBrowse]);

  useEffect(() => {
    if (!searchOpen) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [searchOpen]);

  const loadMoreRail = useCallback(
    async (key: string) => {
      const rail = rails.find((entry) => entry.key === key);
      if (!rail || rail.loadingMore || rail.page >= rail.totalPages) return;
      if (busyRails.current[key]) return;
      busyRails.current[key] = true;
      setRails((prev) => prev.map((entry) => (entry.key === key ? { ...entry, loadingMore: true } : entry)));
      const started = Date.now();
      try {
        const next = await listRail(rail.path, rail.page + 1, rail.title);
        if (!next) return;
        const seen = new Set(rail.items.map((item) => `${item.kind}-${item.id}`));
        const fresh = next.items.filter((item) => !seen.has(`${item.kind}-${item.id}`));
        setRails((prev) =>
          prev.map((entry) => {
            if (entry.key !== key) return entry;
            const known = new Set(entry.items.map((item) => `${item.kind}-${item.id}`));
            return {
              ...entry,
              items: [...entry.items, ...fresh.filter((item) => !known.has(`${item.kind}-${item.id}`))],
              page: rail.page + 1,
              totalPages: next.totalPages,
            };
          })
        );
        log('Movies', `rail ${key} page=${rail.page + 1}/${next.totalPages} +${fresh.length} ms=${Date.now() - started}`);
      } catch (err) {
        logError('Movies', `rail ${key} more failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        busyRails.current[key] = false;
        setRails((prev) => prev.map((entry) => (entry.key === key ? { ...entry, loadingMore: false } : entry)));
      }
    },
    [rails]
  );

  const loadMoreExplore = useCallback(async () => {
    if (exploreMore || explorePage >= Math.min(exploreTotal, EXPLORE_CAP)) return;
    if (busyExplore.current) return;
    busyExplore.current = true;
    setExploreMore(true);
    const started = Date.now();
    try {
      const next = await listRail('/movies', explorePage + 1, 'Explore');
      if (!next) return;
      const seen = new Set([
        ...rails.flatMap((rail) => rail.items.map((item) => `${item.kind}-${item.id}`)),
        ...exploreItems.map((item) => `${item.kind}-${item.id}`),
      ]);
      const fresh = next.items.filter((item) => !seen.has(`${item.kind}-${item.id}`));
      setExploreItems((prev) => {
        const known = new Set(prev.map((item) => `${item.kind}-${item.id}`));
        return [...prev, ...fresh.filter((item) => !known.has(`${item.kind}-${item.id}`))];
      });
      setExplorePage(explorePage + 1);
      setExploreTotal(next.totalPages);
      log('Movies', `explore page=${explorePage + 1}/${next.totalPages} +${fresh.length} ms=${Date.now() - started}`);
    } catch (err) {
      logError('Movies', `explore more failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busyExplore.current = false;
      setExploreMore(false);
    }
  }, [exploreMore, explorePage, exploreTotal, rails, exploreItems]);

  const onBrowseScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 900) {
      void loadMoreExplore();
    }
  };

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const current = seq.current + 1;
    seq.current = current;
    const started = Date.now();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items = await searchTitles(term);
          if (seq.current === current) {
            setResults(items);
            log('Movies', `search "${term}" -> ${items.length} ms=${Date.now() - started}`);
          }
        } catch (err) {
          if (seq.current === current) {
            setResults([]);
            logError('Movies', `search "${term}" failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } finally {
          if (seq.current === current) setSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const openDetail = useCallback(
    (item: LunaItem) => {
      setSelected(item);
      setDetailOpen(true);
      setRecents((prev) =>
        [item, ...prev.filter((entry) => !(entry.kind === item.kind && entry.id === item.id))].slice(0, 6)
      );
      onFullScreen?.(true);
    },
    [onFullScreen]
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setSelected(null);
    onFullScreen?.(false);
  }, [onFullScreen]);

  const closePlayer = useCallback(() => {
    setPlaying(false);
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

  useBackHandler(() => {
    if (!visible || detailOpen) return false;
    if (searchOpen) {
      setSearchOpen(false);
      onQuery('');
      return true;
    }
    if (!railKey) return false;
    setRailKey(null);
    return true;
  }, 5);

  const inSearch = query.trim().length >= 2;
  const gridW = (width - 32 - 24) / 3;
  const openRail = !inSearch ? (rails.find((entry) => entry.key === railKey) ?? null) : null;

  return (
    <View
      style={[
        tw`absolute inset-0 bg-[#121011]`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      {!detailOpen && !playing && (
      <View style={[tw`bg-[#121011] px-5`, { paddingTop: insets.top + 8, zIndex: 10, elevation: 10 }]}>
        {searchOpen ? (
          <View style={tw`flex-row items-center gap-2 py-2`}>
            <Pressable
              onPress={() => {
                tapSelection();
                setSearchOpen(false);
                onQuery('');
                Keyboard.dismiss();
              }}
              testID="movies-search-back"
              accessibilityRole="button"
              accessibilityLabel="Back to browse"
              hitSlop={8}
            >
              <MoviesBackCircleIcon size={44} />
            </Pressable>
            <View style={tw`h-11 flex-1 flex-row items-center gap-2 rounded-full bg-[#1E1E1E] pl-4 pr-3`}>
              <TextInput
                ref={searchRef}
                testID="movies-search"
                style={[tw`flex-1 font-sans text-[12px] text-white`, { textAlignVertical: 'center', paddingVertical: 0 }]}
                placeholder="Search any movies name here"
                placeholderTextColor="#939392"
                cursorColor="#EB2F3D"
                selectionColor="#EB2F3D"
                value={query}
                onChangeText={onQuery}
                returnKeyType="search"
                autoCorrect={false}
                accessibilityLabel="Search movies and shows"
              />
              <MoviesFilterIcon size={18} />
            </View>
          </View>
        ) : (
          <View style={tw`flex-row items-center justify-between py-2`}>
            <View style={tw`flex-row items-center gap-2`}>
              <PhantomIcon size={26} color="#FFFFFF" />
              <Text style={tw`font-sans-semibold text-[24px] text-white`}>Watch</Text>
            </View>
            <View style={tw`flex-row gap-3`}>
              <Pressable
                onPress={() => {
                  tapSelection();
                  setSearchOpen(true);
                }}
                testID="movies-search-open"
                accessibilityRole="button"
                accessibilityLabel="Search movies"
                hitSlop={8}
              >
                <MoviesSearchCircleIcon size={44} />
              </Pressable>
              <Pressable
                onPress={() => {
                  tapSelection();
                  Keyboard.dismiss();
                  onClose();
                }}
                testID="movies-close"
                accessibilityRole="button"
                accessibilityLabel="Close movies"
                hitSlop={8}
                style={tw`h-11 w-11 items-center justify-center rounded-full bg-[#1E1E1E]`}
              >
                <X size={20} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}
      </View>
      )}

      {searchOpen ? (
        inSearch ? (
        <FlatList
          data={results}
          numColumns={3}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          columnWrapperStyle={tw`gap-3 px-4`}
          contentContainerStyle={tw`gap-3 pb-32 pt-2`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <PosterCard item={item} width={gridW} height={gridW * 1.5} testID={`movie-result-${index}`} onOpen={openDetail} />
          )}
          ListHeaderComponent={
            <Text style={tw`px-4 pb-2 font-mono text-[12px] text-slate-400`}>
              {searching
                ? `Searching for “${query.trim()}”…`
                : results.length === 0
                  ? `No results for “${query.trim()}”`
                  : `${results.length} results for “${query.trim()}”`}
            </Text>
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
          recents.length > 0 ? (
            <View style={tw`pt-2`}>
              <Text style={tw`px-5 pb-2 font-sans-semibold text-[16px] text-white`}>
                Recent search
              </Text>
              <FlatList
                data={recents}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={tw`gap-3 px-5`}
                keyExtractor={(item) => `${item.kind}-${item.id}`}
                renderItem={({ item, index }) => (
                  <PosterCard item={item} width={120} height={160} testID={`movie-recent-${index}`} onOpen={openDetail} />
                )}
              />
            </View>
          ) : (
            <View style={tw`items-center px-8 pt-10`}>
              <Text style={tw`font-sans-semibold text-[16px] text-white`}>Recent search</Text>
              <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
                Search any movies name here
              </Text>
            </View>
          )
        )
      ) : openRail ? (
        <FlatList
          data={openRail.items}
          numColumns={3}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          columnWrapperStyle={tw`gap-3 px-4`}
          contentContainerStyle={tw`gap-3 pb-32 pt-2`}
          onEndReached={() => void loadMoreRail(openRail.key)}
          onEndReachedThreshold={0.5}
          renderItem={({ item, index }) => (
            <PosterCard item={item} width={gridW} height={gridW * 1.5} testID={`movie-grid-${index}`} onOpen={openDetail} />
          )}
          ListHeaderComponent={
            <View style={tw`flex-row items-center gap-1 px-4 pb-2`}>
              <Pressable
                onPress={() => {
                  tapSelection();
                  setRailKey(null);
                }}
                style={tw`rounded-full p-1`}
                accessibilityLabel="Back to browse"
              >
                <ChevronRight size={18} color="#94a3b8" style={{ transform: [{ rotate: '180deg' }] }} />
              </Pressable>
              <Text style={tw`font-sans-bold text-[18px] text-white`}>{openRail.title}</Text>
              <Text style={tw`font-mono text-[11px] text-slate-500`}>
                {openRail.items.length} titles
              </Text>
            </View>
          }
          ListFooterComponent={
            openRail.loadingMore ? (
              <ActivityIndicator size="small" color="#22d3ee" style={tw`py-4`} />
            ) : openRail.page >= openRail.totalPages ? (
              <Text style={tw`py-4 text-center font-mono text-[11px] text-slate-600`}>
                That is everything — {openRail.totalPages} pages
              </Text>
            ) : null
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={tw`pb-32`}
          keyboardShouldPersistTaps="handled"
          onScroll={onBrowseScroll}
          scrollEventThrottle={400}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void loadBrowse()}
              tintColor="#22d3ee"
              colors={['#22d3ee']}
              progressBackgroundColor="#1E1E1E"
            />
          }
        >
          {trending.length > 0 && (
            <View style={tw`pt-2`}>
              <Text style={tw`px-4 pb-2 font-sans-bold text-[16px] text-slate-200`}>
                Trending this week
              </Text>
              <TrendingCarousel
                items={trending}
                onOpen={openDetail}
                onPlay={(item) => {
                  setPlayerItem(item);
                  setPlaying(true);
                }}
              />
            </View>
          )}
          {rails.map((rail) =>
            rail.items.length > 0 ? (
              <View key={rail.key} style={tw`mt-7`}>
                <Pressable
                  onPress={() => {
                    tapSelection();
                    setRailKey(rail.key);
                    log('Movies', `rail open ${rail.key} items=${rail.items.length}`);
                  }}
                  accessibilityLabel={`See all ${rail.title}`}
                  style={tw`flex-row items-center justify-between pr-4`}
                >
                  <Text style={tw`px-4 pb-3 font-sans-bold text-[16px] text-slate-200`}>
                    {rail.title}
                  </Text>
                  <View style={tw`flex-row items-center gap-0.5 pb-3`}>
                    <Text style={tw`font-sans-semibold text-[13px] text-cyan-400`}>See all</Text>
                    <ChevronRight size={15} color="#22d3ee" />
                  </View>
                </Pressable>
                <FlatList
                  data={rail.items}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={tw`gap-3 px-4`}
                  keyExtractor={(item) => `${item.kind}-${item.id}`}
                  onEndReached={() => void loadMoreRail(rail.key)}
                  onEndReachedThreshold={0.6}
                  renderItem={({ item, index }) => (
                    <PosterCard item={item} width={162} height={216} testID={`movie-rail-${rail.key}-${index}`} onOpen={openDetail} />
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
          {(exploreItems.length > 0 || exploreMore) && (
            <View style={tw`mt-6`}>
              <Text style={tw`px-4 pb-2 font-sans-bold text-[16px] text-slate-200`}>
                Explore more
              </Text>
              <View style={tw`flex-row flex-wrap gap-3 px-4`}>
                {exploreItems.map((item, index) => (
                  <PosterCard
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    width={gridW}
                    height={gridW * 1.5}
                    testID={`movie-explore-${index}`}
                    onOpen={openDetail}
                  />
                ))}
              </View>
              {exploreMore && <ActivityIndicator size="small" color="#22d3ee" style={tw`py-4`} />}
            </View>
          )}
        </ScrollView>
      )}

      <MovieDetailScreen
        visible={detailOpen}
        item={selected}
        onClose={closeDetail}
        onPlay={() => {
          setPlayerItem(selected);
          setPlaying(true);
        }}
      />
      <MoviePlayerScreen
        visible={playing}
        item={playerItem}
        upNext={trending}
        onSelect={setPlayerItem}
        onClose={closePlayer}
      />
    </View>
  );
}

const MoviesScreen = memo(MoviesScreenInner);
export default MoviesScreen;
