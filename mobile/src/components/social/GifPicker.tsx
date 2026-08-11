import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../../lib/tw';
import { tapSelection } from '../../lib/haptics';
import { searchGifs, PAGE, type Gif } from '../../lib/social/giphy';

const GAP = 8;
const CELL_H = 118;
const CYAN = '#22d3ee';
const REFRESH_CAP = 200;

// pull-to-refresh jumps to a random offset so it surfaces different GIFs
// instead of re-showing the same top results
function randomStart(total: number): number {
  const max = Math.min(total - PAGE, REFRESH_CAP);
  return max > 0 ? Math.floor(Math.random() * max) : 0;
}

type Mode = 'fresh' | 'refresh' | 'more';

export default function GifPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string, aspect: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const reqId = useRef(0);
  const offset = useRef(0);
  const total = useRef(0);
  const hasMore = useRef(true);
  const moreBusy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (term: string, mode: Mode) => {
    if (mode === 'more' && (moreBusy.current || !hasMore.current)) return;
    // newer request wins; stale awaits are dropped on return
    const id = (reqId.current += 1);
    const start =
      mode === 'more'
        ? offset.current
        : mode === 'refresh'
          ? randomStart(total.current)
          : 0;
    if (mode === 'more') {
      moreBusy.current = true;
      setLoadingMore(true);
    } else {
      abort.current?.abort();
      abort.current = new AbortController();
      hasMore.current = true;
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
    }
    try {
      const page = await searchGifs(term, start, abort.current?.signal);
      if (id !== reqId.current) return;
      hasMore.current = page.gifs.length >= PAGE;
      if (mode === 'more') {
        setGifs((prev) => {
          const seen = new Set(prev.map((gif) => gif.id));
          return [...prev, ...page.gifs.filter((gif) => !seen.has(gif.id))];
        });
        offset.current = start + page.gifs.length;
      } else {
        total.current = page.total;
        setGifs(page.gifs);
        offset.current = start + page.gifs.length;
      }
    } catch {
      // aborted or network hiccup — keep whatever is already shown
    } finally {
      if (mode === 'more') moreBusy.current = false;
      if (id === reqId.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- gates reset & trending fetch on open
    if (!open) return;
    // load trending on open; typed queries only fire on submit (below)
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- reset before trending fetch on open
    setQuery('');
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- reset before trending fetch on open
    setGifs([]);
    void load('', 'fresh');
  }, [open, load]);

  const pick = (url: string, aspect: number) => {
    tapSelection();
    onSelect(url, aspect);
    onClose();
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[tw`flex-1 bg-background`, { paddingTop: insets.top }]}>
        <View style={tw`flex-row items-center px-4 pb-2 pt-2`}>
          <Text
            style={tw`font-sans-bold text-[20px] tracking-tight text-white`}
          >
            GIFs
          </Text>
          <Text style={tw`ml-2 font-sans text-[11px] text-white/30`}>
            Powered by GIPHY
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={tw`ml-auto h-9 w-9 items-center justify-center rounded-full bg-white/8`}
          >
            <X size={20} color="#cbd5e1" strokeWidth={2} />
          </Pressable>
        </View>

        <View
          style={tw`mx-4 mb-2 flex-row items-center rounded-full bg-white/8 px-4 py-2.5`}
        >
          <Search size={18} color="#64748b" strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void load(query, 'fresh')}
            placeholder="Search GIPHY"
            placeholderTextColor="#64748b"
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            style={tw`ml-2.5 flex-1 font-sans text-[16px] text-white`}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => {
                setQuery('');
                void load('', 'fresh');
              }}
              hitSlop={8}
            >
              <X size={16} color="#64748b" strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        {loading && gifs.length === 0 ? (
          <View style={tw`flex-1 items-center justify-center`}>
            <ActivityIndicator color={CYAN} />
          </View>
        ) : !loading && gifs.length === 0 ? (
          <View style={tw`flex-1 items-center justify-center px-8`}>
            <Text style={tw`text-center font-sans text-[14px] text-slate-500`}>
              No GIFs found
            </Text>
          </View>
        ) : (
          <FlatList
            data={gifs}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{
              padding: GAP,
              gap: GAP,
              paddingBottom: 40,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            onEndReachedThreshold={0.6}
            onEndReached={() => {
              if (!loadingMore && hasMore.current) void load(query, 'more');
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void load(query, 'refresh')}
                tintColor={CYAN}
                colors={[CYAN]}
                progressBackgroundColor="#17324c"
              />
            }
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator color={CYAN} style={tw`py-4`} />
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => pick(item.url, item.aspect)}
                style={{ flex: 1, height: CELL_H }}
              >
                <Image
                  source={{ uri: item.preview }}
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                  }}
                  contentFit="cover"
                />
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}
