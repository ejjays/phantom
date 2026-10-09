import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardController } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import tw from '../lib/tw';
import { useBackHandler } from '../lib/back';
import { fetchTvSeasons, fetchSeasonEpisodes, type TmdbSeason, type TmdbEpisode } from '../extractors/movies/tmdb';
import { tapSelection } from '../lib/haptics';

type Props = {
  visible: boolean;
  tmdbId: string;
  title: string;
  initialSeason: number | null;
  onClose: () => void;
  onPlay: (season: string, episode: string) => void;
};

function pickSeason(seasons: TmdbSeason[], initial: number | null): number | null {
  if (seasons.length === 0) return null;
  if (initial !== null && seasons.some((s) => s.number === initial)) return initial;
  return (seasons.find((s) => s.number > 0) ?? seasons[0]).number;
}

function matchesQuery(ep: TmdbEpisode, raw: string): boolean {
  const text = raw.trim().toLowerCase();
  if (!text) return true;
  if (ep.name.toLowerCase().includes(text)) return true;
  if (ep.overview?.toLowerCase().includes(text)) return true;
  const digits = text.replace(/[^0-9]/gu, '');
  return digits.length > 0 && String(ep.number) === String(Number(digits));
}

function PillSkeletons() {
  return (
    <View style={tw`flex-row gap-2 px-4 py-2`}>
      {[0, 1].map((key) => (
        <View key={key} style={[tw`h-9 rounded-full bg-white/5`, { width: 110 }]} />
      ))}
    </View>
  );
}

function EpisodeSkeletons() {
  return (
    <View style={tw`gap-1 px-4 pb-10 pt-2`}>
      {[0, 1, 2, 3, 4].map((key) => (
        <View key={key} style={tw`flex-row items-center gap-3 py-2`}>
          <View style={[tw`bg-white/5`, { width: 120, aspectRatio: 16 / 9, borderRadius: 12 }]} />
          <View style={tw`flex-1 gap-1.5`}>
            <View style={[tw`rounded bg-white/5`, { width: 40, height: 11 }]} />
            <View style={[tw`rounded bg-white/10`, { width: '70%', height: 14 }]} />
            <View style={[tw`rounded bg-white/5`, { width: '90%', height: 12 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function MovieEpisodesScreen({ visible, tmdbId, title, initialSeason, onClose, onPlay }: Props) {
  const insets = useSafeAreaInsets();
  const [seasons, setSeasons] = useState<TmdbSeason[]>([]);
  const [season, setSeason] = useState<number | null>(initialSeason);
  const [episodes, setEpisodes] = useState<TmdbEpisode[] | null>(null);
  const [pending, setPending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput>(null);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    searchRef.current?.blur();
    void KeyboardController.dismiss();
  };

  useBackHandler(() => {
    if (!visible) return false;
    if (searchOpen) {
      closeSearch();
      return true;
    }
    onClose();
    return true;
  }, 15);

  useEffect(() => {
    if (!visible || !tmdbId) return;
    let cancelled = false;
    void fetchTvSeasons(tmdbId).then((found) => {
      if (cancelled) return;
      setSeasons(found);
      setSeason((prev) => {
        if (prev !== null && found.some((s) => s.number === prev)) return prev;
        return pickSeason(found, initialSeason);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visible, tmdbId, initialSeason]);

  useEffect(() => {
    if (!visible || season === null || !tmdbId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- track reload per season, list stays visible meanwhile
    setPending(true);
    void fetchSeasonEpisodes(tmdbId, season).then((found) => {
      if (cancelled) return;
      setEpisodes(found);
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, tmdbId, season]);

  if (!tmdbId) return null;

  const ordered = [...seasons].sort(
    (first, second) => (first.number === 0 ? 1 : 0) - (second.number === 0 ? 1 : 0) || first.number - second.number
  );
  const term = query.trim();
  const filtered = episodes !== null && term ? episodes.filter((ep) => matchesQuery(ep, term)) : episodes;

  return (
    <Animated.View
      entering={SlideInRight.duration(250)}
      exiting={SlideOutRight.duration(200)}
      style={[tw`absolute inset-0 bg-[#121011]`, { pointerEvents: visible ? 'auto' : 'none' }]}
    >
      <View style={[tw`flex-row items-center gap-2 px-4 pb-2`, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => {
            tapSelection();
            onClose();
          }}
          style={tw`rounded-full bg-white/5 p-2.5`}
          accessibilityLabel="Back to details"
        >
          <ArrowLeft size={22} color="#ffffff" />
        </Pressable>
        {searchOpen ? (
          <TextInput
            ref={searchRef}
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="Search E2 or title…"
            placeholderTextColor="#64748b"
            cursorColor="#22d3ee"
            selectionColor="#22d3ee"
            returnKeyType="search"
            autoCorrect={false}
            style={tw`h-10 flex-1 font-sans text-[15px] text-white`}
            accessibilityLabel="Search episodes"
          />
        ) : (
          <View style={tw`flex-1`}>
            <Text style={tw`font-sans-bold text-[18px] text-white`} numberOfLines={1}>
              Episodes
            </Text>
            <Text style={tw`font-mono text-[12px] text-slate-400`} numberOfLines={1}>
              {title}
            </Text>
          </View>
        )}
        <View style={tw`w-8 items-end justify-center`}>
          {pending ? (
            <ActivityIndicator size="small" color="#22d3ee" />
          ) : searchOpen ? (
            <Pressable
              onPress={() => {
                tapSelection();
                closeSearch();
              }}
              style={tw`p-1`}
              accessibilityLabel="Close search"
            >
              <X size={20} color="#e2e8f0" />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => {
                tapSelection();
                setSearchOpen(true);
              }}
              style={tw`p-1`}
              accessibilityLabel="Search episodes"
            >
              <Search size={20} color="#e2e8f0" />
            </Pressable>
          )}
        </View>
      </View>
      {seasons.length === 0 && episodes === null ? (
        <PillSkeletons />
      ) : (
        ordered.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={tw`items-center gap-2 px-4 py-2`}
          >
            {ordered.map((entry) => {
              const active = entry.number === season;
              return (
                <Pressable
                  key={entry.number}
                  onPress={() => {
                    tapSelection();
                    setSeason(entry.number);
                  }}
                  style={tw`h-9 justify-center rounded-full px-4 ${active ? 'bg-white/20' : 'bg-white/5'}`}
                  accessibilityLabel={`Season ${entry.number}`}
                >
                  <Text style={tw`font-sans-medium text-[13px] leading-5 ${active ? 'text-white' : 'text-slate-400'}`}>
                    {entry.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )
      )}
      {filtered === null ? (
        <EpisodeSkeletons />
      ) : filtered.length === 0 ? (
        <View style={tw`flex-1 items-center justify-center px-8`}>
          <Text style={tw`font-sans-semibold text-[15px] text-slate-200`}>
            {term ? `No matches for "${term}"` : 'No episodes found'}
          </Text>
        </View>
      ) : (
        <FlatList
          key={`${season}-${term}`}
          data={filtered}
          keyExtractor={(item) => String(item.number)}
          contentContainerStyle={tw`gap-1 px-4 pb-10 pt-2`}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            term ? (
              <Text style={tw`font-mono text-[11px] text-slate-500`}>
                {filtered.length === 1 ? '1 result' : `${filtered.length} results`}
              </Text>
            ) : null
          }
          renderItem={({ item: ep }) => (
            <Pressable
              onPress={() => {
                tapSelection();
                if (season !== null) onPlay(String(season), String(ep.number));
              }}
              style={tw`flex-row items-center gap-3 rounded-2xl py-2`}
              accessibilityLabel={`Play episode ${ep.number}: ${ep.name}`}
            >
              {ep.still ? (
                <Image
                  source={{ uri: ep.still }}
                  style={{ width: 120, aspectRatio: 16 / 9, borderRadius: 12 }}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View
                  style={[
                    tw`bg-white/5`,
                    { width: 120, aspectRatio: 16 / 9, borderRadius: 12 },
                  ]}
                />
              )}
              <View style={tw`flex-1 gap-0.5`}>
                <Text style={tw`font-mono text-[11px] text-slate-500`}>E{ep.number}</Text>
                <Text style={tw`font-sans-medium text-[14px] text-slate-100`} numberOfLines={1}>
                  {ep.name}
                </Text>
                {ep.overview && (
                  <Text style={tw`font-sans text-[12px] leading-4 text-slate-400`} numberOfLines={2}>
                    {ep.overview}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </Animated.View>
  );
}
