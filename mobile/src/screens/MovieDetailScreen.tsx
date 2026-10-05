import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Download, Check, Star, ArrowLeft, RotateCcw } from 'lucide-react-native';
import tw from '../lib/tw';
import { useBackHandler } from '../lib/back';
import { usePressScale } from '../hooks/usePressScale';
import { Play3Icon, Play3FilledIcon } from '../components/icons';
import { resolve } from '../extractors';
import { type MovieItem, type MovieTitle } from '../extractors/movies/browse';
import { fetchCredits, fetchTmdbTitle } from '../extractors/movies/tmdb';
import { hasBlockedHosts, VIDROCK_HEADERS } from '../extractors/movies/vidrock';
import { LUNA_HOSTS } from '../extractors/movies/constants';
import { useDownload } from '../hooks/useDownload';
import { formatLabel, type DownloadState } from '../lib/format';
import { tapImpact, tapSelection } from '../lib/haptics';
import { log, error as logError } from '../lib/log';
import type { Format, VideoInfo } from '@phantom/extractors';

const AnimatedImage = Animated.createAnimatedComponent(Image);

type Props = {
  visible: boolean;
  item: MovieItem | null;
  onClose: () => void;
  onPlay: () => void;
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={tw`flex-1`}>
      <Text style={tw`font-mono text-[11px] text-slate-500`}>{label}</Text>
      <Text style={tw`mt-0.5 font-sans-semibold text-[15px] text-slate-100`}>{value}</Text>
    </View>
  );
}

function DetailMeta({ details }: { details: MovieTitle }) {
  const cells: { label: string; value: string }[] = [];
  if (typeof details.rating === 'number') {
    cells.push({ label: 'Rating', value: details.rating.toFixed(1) });
  }
  if (typeof details.durationSec === 'number') {
    cells.push({ label: 'Runtime', value: `${Math.round(details.durationSec / 60)} min` });
  }
  if (details.year) cells.push({ label: 'Released', value: details.year });
  if (cells.length === 0) return null;
  return (
    <View style={tw`mt-5 flex-row gap-3`}>
      {cells.map((cell) => (
        <Meta key={cell.label} label={cell.label} value={cell.value} />
      ))}
    </View>
  );
}

function detailsFromVideo(kind: MovieItem['kind'], id: string, full: VideoInfo): MovieTitle {
  return {
    id,
    kind,
    title: full.title,
    image: full.thumbnail ?? undefined,
    backdrop: undefined,
    durationSec: full.duration ?? undefined,
    description: full.description ?? undefined,
    year: undefined,
    rating: undefined,
    votes: undefined,
    genres: [],
    contentRating: undefined,
    director: undefined,
    cast: [],
  };
}

function TitleBlock({
  details,
  item,
  kind,
}: {
  details: MovieTitle | null;
  item: MovieItem | null;
  kind: string;
}) {
  const title = details?.title ?? item?.title ?? '';
  const image = details?.image ?? item?.poster;
  const year = details?.year ?? item?.year;
  const rating = details?.rating ?? item?.rating;
  const votes = details?.votes;
  const contentRating = details?.contentRating;
  return (
    <View style={tw`flex-row items-end gap-3`}>
      {image && (
        <Image
          source={{ uri: image }}
          style={tw`h-44 w-30 rounded-[20px]`}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      )}
      <View style={tw`flex-1 pb-1`}>
        <Text style={tw`font-sans-bold text-[20px] leading-7 text-white`} numberOfLines={3}>
          {title}
        </Text>
        <View style={tw`mt-1 flex-row items-center gap-2`}>
          {year && (
            <Text style={tw`font-mono text-[12px] text-slate-400`}>{year}</Text>
          )}
          <Text style={tw`rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300`}>
            {kind === 'tv' ? 'TV Show' : 'Movie'}
          </Text>
          {contentRating && (
            <Text style={tw`rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-slate-400`}>
              {contentRating}
            </Text>
          )}
        </View>
        {typeof rating === 'number' && (
          <View style={tw`mt-1.5 flex-row items-center gap-1.5`}>
            <Star size={14} color="#facc15" />
            <Text style={tw`font-mono-semibold text-[13px] text-white`}>
              {rating.toFixed(1)}
            </Text>
            {typeof votes === 'number' && (
              <Text style={tw`font-mono text-[11px] text-slate-500`}>
                {votes.toLocaleString()} votes
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function Skeleton({
  width,
  height,
  radius = 8,
}: {
  width: number | string;
  height: number;
  radius?: number;
}) {
  const pulse = useSharedValue(0.3);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.65, { duration: 900 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius }, tw`bg-white/10`, style]}
    />
  );
}

function initialsOf(name: string): string {
  const bits = name.trim().split(/\s+/u).slice(0, 2);
  return bits.map((bit) => bit.charAt(0).toUpperCase()).join('');
}

function DetailSkeletons() {
  return (
    <>
      <View style={tw`mt-5 flex-row gap-3`}>
        {[0, 1, 2].map((cell) => (
          <View key={cell} style={tw`gap-1.5`}>
            <Skeleton width={56} height={11} radius={4} />
            <Skeleton width={64} height={20} radius={6} />
          </View>
        ))}
      </View>
      <View style={tw`mt-5 flex-row gap-1.5`}>
        <Skeleton width={110} height={34} radius={999} />
        <Skeleton width={80} height={34} radius={999} />
        <Skeleton width={96} height={34} radius={999} />
      </View>
      <View style={tw`mt-5 gap-2`}>
        <Skeleton width={110} height={20} radius={6} />
        <Skeleton width="100%" height={14} radius={6} />
        <Skeleton width="100%" height={14} radius={6} />
        <Skeleton width="65%" height={14} radius={6} />
      </View>
      <View style={tw`mt-5 gap-2`}>
        <Skeleton width={90} height={20} radius={6} />
        <Skeleton width="55%" height={14} radius={6} />
      </View>
      <View style={tw`mt-5 gap-2`}>
        <Skeleton width={70} height={20} radius={6} />
        <Skeleton width="100%" height={14} radius={6} />
        <Skeleton width="70%" height={14} radius={6} />
      </View>
    </>
  );
}

type DlPhase = 'busy' | 'saved' | 'errored' | 'ready' | 'waiting';

function dlPhase(
  status: DownloadState | undefined,
  hasBest: boolean,
  dlError: string | null
): DlPhase {
  if (status?.status === 'saved') return 'saved';
  if (status?.status === 'error' || dlError !== null) return 'errored';
  if (
    status?.status === 'downloading' ||
    status?.status === 'muxing' ||
    status?.status === 'saving'
  ) {
    return 'busy';
  }
  if (hasBest) return 'ready';
  return 'waiting';
}

function WatchBar({
  best,
  status,
  dlError,
  checking,
  noSources,
  bottomPad,
  onPlay,
  onDownload,
  onRecheck,
}: {
  best: Format | undefined;
  status: DownloadState | undefined;
  dlError: string | null;
  checking: boolean;
  noSources: boolean;
  bottomPad: number;
  onPlay: () => void;
  onDownload: () => void;
  onRecheck: () => void;
}) {
  const phase = dlPhase(status, Boolean(best), dlError);
  const idle = phase === 'ready' || phase === 'errored';
  const canRecheck = noSources && !checking;
  const disabled = !idle && !canRecheck && phase !== 'busy' && phase !== 'saved';
  const saved = phase === 'saved';
  const busy = phase === 'busy';
  const watchPress = usePressScale();
  const dlPress = usePressScale();
  const ready = useSharedValue(best ? 1 : 0);
  useEffect(() => {
    ready.value = withTiming(best ? 1 : 0, { duration: 250 });
  }, [best, ready]);
  const playStyle = useAnimatedStyle(() => ({
    opacity: ready.value,
    transform: [{ scale: 0.5 + ready.value * 0.5 }],
  }));
  return (
    <View style={[tw`absolute inset-x-0 bottom-0 px-4`, { paddingBottom: bottomPad }]}>
      <View
        style={[
          tw`rounded-full border border-white/10 bg-[#1E1E1E] p-3`,
          {
            shadowColor: '#000',
            shadowOpacity: 0.4,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          },
        ]}
      >
        {dlError ? (
          <Text style={tw`mb-2 text-center font-mono text-[11px] text-red-400`}>{dlError}</Text>
        ) : noSources && !best ? (
          <Text style={tw`mb-2 text-center font-mono text-[11px] text-slate-500`}>
            This title has no streams right now — check back after release.
          </Text>
        ) : null}
        <View style={tw`flex-row items-center gap-3`}>
          <Pressable
            onPress={() => {
              tapImpact();
              onPlay();
            }}
            onPressIn={watchPress.onPressIn}
            onPressOut={watchPress.onPressOut}
            disabled={!best}
            testID="movie-play-btn"
            accessibilityLabel="Watch now"
            style={[tw`h-14 flex-1 items-center justify-center overflow-hidden rounded-full bg-[#EB2F3D]`, !best && tw`opacity-50`]}
          >
            <Animated.View style={[tw`flex-row items-center gap-2`, watchPress.pressScaleStyle]}>
              <View style={tw`h-5 w-5 items-center justify-center`}>
              {!best && checking && <ActivityIndicator size="small" color="#FFFFFF" />}
              {best && (
                <Animated.View style={playStyle}>
                  <Play3FilledIcon size={20} color="#FFFFFF" />
                </Animated.View>
              )}
            </View>
              <Text style={tw`font-sans-semibold text-[15px] text-white`}>Watch Now</Text>
            </Animated.View>
          </Pressable>
          <Pressable
            onPress={() => {
              if (canRecheck) onRecheck();
              else onDownload();
            }}
            onPressIn={dlPress.onPressIn}
            onPressOut={dlPress.onPressOut}
            disabled={disabled}
            testID="movie-download-btn"
            accessibilityLabel={
              saved
                ? 'Saved to history'
                : phase === 'errored'
                  ? 'Retry download'
                  : canRecheck
                    ? 'Check for sources again'
                    : 'Download this title'
            }
            style={[tw`h-14 w-14 items-center justify-center overflow-hidden rounded-full`, saved ? tw`bg-emerald-400` : tw`bg-white/10`]}
          >
            <Animated.View style={dlPress.pressScaleStyle}>
              {busy || (checking && canRecheck) ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : saved ? (
                <Check size={24} color="#083344" strokeWidth={3} />
              ) : canRecheck || phase === 'errored' ? (
                <RotateCcw size={22} color="#FFFFFF" strokeWidth={2.5} />
              ) : (
                <Download size={22} color="#FFFFFF" strokeWidth={2.5} />
              )}
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

async function tryBrowserFallback(
  kind: MovieItem['kind'],
  id: string,
  itemTitle: string,
  itemPoster: string | undefined,
  meta: MovieTitle | null,
  cancelled: () => boolean
): Promise<VideoInfo | null> {
  try {
    const { resolveWatchPageViaBrowser } = await import('../extractors/movies/browserProbe');
    const order = [...LUNA_HOSTS.filter((host) => host !== 'watchluna.gd'), 'watchluna.gd'];
    for (const host of order) {
      const watchUrl =
        kind === 'movie'
          ? `https://${host}/watch/movie/${id}`
          : `https://${host}/watch/tv/${id}/1/1`;
      const viaBrowser = await resolveWatchPageViaBrowser(watchUrl);
      if (cancelled()) return null;
      if (viaBrowser && viaBrowser.formats.length > 0) {
        return {
          type: 'video',
          id,
          title: meta?.title ?? itemTitle,
          uploader: 'Phantom',
          webpageUrl: watchUrl,
          thumbnail: meta?.image ?? itemPoster,
          duration: meta?.durationSec,
          description: meta?.description,
          formats: viaBrowser.formats,
          extractorKey: 'phantom',
          isJsInfo: true,
          fromBrain: false,
          isIsrcMatch: false,
          isFullData: true,
          isPartial: false,
          downloadHeaders: {
            ...VIDROCK_HEADERS,
            ...(viaBrowser.cookies ? { Cookie: viaBrowser.cookies } : {}),
          },
        };
      }
    }
    return null;
  } catch (err) {
    logError('Movies', `detail ${kind}/${id} browser failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function DetailHero({ backdrop, poster }: { backdrop?: string; poster?: string }) {
  if (!backdrop && !poster) {
    return <View style={[tw`w-full overflow-hidden rounded-b-[40px] bg-white/5`, { height: 120 }]} />;
  }
  return (
    <View style={tw`overflow-hidden rounded-b-[55px] bg-[#121011]`}>
      {poster && (
        <Image
          source={{ uri: poster }}
          style={[tw`w-full`, { aspectRatio: 393 / 413 }]}
          contentFit="cover"
          contentPosition="top"
          cachePolicy="memory-disk"
        />
      )}
      {backdrop && backdrop !== poster && (
        <AnimatedImage
          entering={FadeIn.duration(400)}
          source={{ uri: backdrop }}
          style={[tw`absolute inset-0 w-full`, { aspectRatio: 393 / 413 }]}
          contentFit="cover"
          contentPosition="top"
          cachePolicy="memory-disk"
        />
      )}
    </View>
  );
}

export default function MovieDetailScreen({ visible, item, onClose, onPlay }: Props) {
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<MovieTitle | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [noSources, setNoSources] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [dlError, setDlError] = useState<string | null>(null);
  const { downloads, startDownload } = useDownload(video);

  useBackHandler(() => {
    if (!visible) return false;
    onClose();
    return true;
  }, 10);

  useEffect(() => {
    if (!visible || !item) return;
    let cancelled = false;
    const started = Date.now();
    const { kind, id } = item;
    log('Movies', `detail open ${kind}/${id}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per opened title, then async fill
    setDetails(null);
    setVideo(null);
    setFailed(false);
    setNoSources(false);
    setDlError(null);
    setChecking(true);
    const target = `https://watchluna.gd/${kind}/${id}`;
    let found: MovieTitle | null = null;
    let full: VideoInfo | null = null;
    let sourceErr = 'empty resolve';
    let metaSettled = false;
    let videoSettled = false;
    const maybeFinish = () => {
      if (!metaSettled || !videoSettled) return;
      setChecking(false);
      if (!found && !full) {
        setFailed(true);
        logError('Movies', `detail ${kind}/${id} empty (no meta, no sources)`);
      } else {
        if (!found && full) setDetails(detailsFromVideo(kind, id, full));
        if (full) {
          log(
            'Movies',
            `detail ${kind}/${id} ready title="${found?.title ?? full?.title}" formats=${full?.formats.length ?? 0} best=${full?.formats[0]?.formatId} ms=${Date.now() - started}`
          );
        } else if (found) {
          setNoSources(true);
          log('Movies', `detail ${kind}/${id} meta-only title="${found.title}" sources failed: ${sourceErr} ms=${Date.now() - started}`);
        }
      }
    };
    void (async () => {
      try {
        const [titleResult, creditsResult] = await Promise.allSettled([
          fetchTmdbTitle(kind, id),
          fetchCredits(kind, id),
        ]);
        if (cancelled) return;
        if (titleResult.status === 'fulfilled' && titleResult.value) {
          const tmdb = titleResult.value;
          const credits =
            creditsResult.status === 'fulfilled' ? creditsResult.value : null;
          const photos: Record<string, string> = {};
          const names: string[] = [];
          if (credits) {
            for (const person of credits.cast) {
              names.push(person.name);
              if (person.photo) photos[person.name] = person.photo;
            }
            log('Movies', `detail ${kind}/${id} credits cast=${credits.cast.length}`);
          }
          found = {
            id,
            kind,
            title: tmdb.title,
            image: tmdb.image,
            backdrop: tmdb.backdrop,
            durationSec: tmdb.durationSec,
            description: tmdb.description,
            year: tmdb.year,
            rating: tmdb.rating,
            votes: tmdb.votes,
            genres: tmdb.genres,
            contentRating: undefined,
            director: credits?.director?.name,
            directorPhoto: credits?.director?.photo,
            cast: names,
            castPhotos: photos,
          };
          setDetails(found);
        } else {
          logError('Movies', `detail ${kind}/${id} meta failed`);
        }
      } catch (err) {
        logError('Movies', `detail ${kind}/${id} meta failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        metaSettled = true;
        if (!cancelled) maybeFinish();
      }
    })();
    void (async () => {
      const usable = (candidate: VideoInfo | null) =>
        candidate !== null && !candidate.isPartial && candidate.formats.length > 0;
      try {
        const cached = await resolve(target, undefined);
        if (cancelled) return;
        if (usable(cached)) {
          full = cached;
          setVideo(cached);
          setNoSources(false);
          log('Movies', `detail ${kind}/${id} cached formats=${cached?.formats.length ?? 0}`);
        }
      } catch {
        log('Movies', `detail ${kind}/${id} cache dry, resolving fresh`);
      }
      if (!cancelled && !full) {
        for (let round = 1; round <= 3 && !full; round++) {
          try {
            const resolved = await resolve(target, undefined, { fresh: true });
            if (cancelled) return;
            if (usable(resolved)) {
              full = resolved;
            } else if (round < 3) {
              log('Movies', `detail ${kind}/${id} round ${round} dry, retrying`);
              await new Promise((done) => setTimeout(done, 1200));
            }
          } catch (err) {
            sourceErr = err instanceof Error ? err.message : String(err);
            if (round < 3) {
              log('Movies', `detail ${kind}/${id} round ${round} failed, retrying`);
              await new Promise((done) => setTimeout(done, 1200));
            }
          }
        }
        if (cancelled) return;
        if (full) {
          setVideo(full);
          setNoSources(false);
        }
      }
      if (!cancelled && !full && hasBlockedHosts()) {
        full = await tryBrowserFallback(kind, id, item.title, item.poster, found, () => cancelled);
        if (cancelled) return;
        if (full) {
          setVideo(full);
          setNoSources(false);
          log('Movies', `detail ${kind}/${id} browser formats=${full.formats.length}`);
        }
      }
      videoSettled = true;
      if (!cancelled) maybeFinish();
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, item, reloads]);

  const recheckSources = () => {
    if (!item || checking) return;
    tapImpact();
    setChecking(true);
    setReloads((count) => count + 1);
    log('Movies', `detail ${item.kind}/${item.id} recheck`);
  };

  const best = video?.formats[0];
  const status = best ? downloads[best.formatId] : undefined;
  const busy = status?.status === 'downloading';
  const saved = status?.status === 'saved';

  const onDownload = () => {
    const errored = status?.status === 'error';
    if ((!best && !errored) || busy || saved) return;
    tapImpact();
    setDlError(null);
    if (!best) return;
    log('Movies', `download tap ${best.formatId} ${formatLabel(best)}`);
    void startDownload(best).then((result) => {
      if (result.status === 'saved') {
        log('Movies', `download saved ${best.formatId} uri=${result.uri ?? 'gallery'}`);
      } else if (result.status === 'error') {
        setDlError(result.message);
        logError('Movies', `download error ${best.formatId}: ${result.message}`);
      } else {
        log('Movies', `download cancelled ${best.formatId}`);
      }
    });
  };

  return (
    <View
      style={[
        tw`absolute inset-0 bg-[#121011]`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      <ScrollView contentContainerStyle={tw`pb-40`}>
        <DetailHero backdrop={details?.backdrop} poster={item?.poster} />
        <Pressable
          onPress={() => {
            tapSelection();
            onClose();
          }}
          style={[tw`absolute left-4 rounded-full bg-black/60 p-2.5`, { top: insets.top + 8 }]}
          accessibilityLabel="Back to movies"
        >
          <ArrowLeft size={22} color="#ffffff" />
        </Pressable>
        {item && (
          <View style={[tw`absolute right-4 rounded bg-white/10 px-2 py-1`, { top: insets.top + 12 }]}>
            <Text style={tw`font-mono text-[11px] text-slate-200`}>
              {item.kind === 'tv' ? 'TV SHOW' : 'MOVIE'}
            </Text>
          </View>
        )}

        {!details && failed ? (
          <View style={tw`items-center px-6 py-10`}>
            <Text style={tw`font-mono-semibold text-[15px] text-slate-100`}>Title unavailable</Text>
            <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
              Phantom could not load this one — go back and try another.
            </Text>
          </View>
        ) : (
          <View style={tw`mx-4 -mt-[120px] rounded-[32px] bg-[#1E1E1E] p-5`}>
            <TitleBlock details={details} item={item} kind={item?.kind ?? 'movie'} />

            {details ? (
              <>
                <DetailMeta details={details} />

                {details.genres.length > 0 && (
                  <View style={tw`mt-5 flex-row flex-wrap gap-1.5`}>
                    {details.genres.map((genre) => (
                      <Text
                        key={genre}
                        style={tw`rounded-full border border-white/10 bg-white/10 px-3 py-1.5 font-sans-medium text-[12px] text-slate-100`}
                      >
                        {genre}
                      </Text>
                    ))}
                  </View>
                )}

                {details.description && (
                  <View style={tw`mt-5`}>
                    <Text style={tw`font-sans-semibold text-[16px] text-white`}>Story Plot</Text>
                    <Text style={tw`mt-1.5 font-sans text-[14px] leading-6 text-slate-300`}>
                      {details.description}
                    </Text>
                  </View>
                )}

                {details.director && (
                  <View style={tw`mt-5`}>
                    <Text style={tw`font-sans-semibold text-[16px] text-white`}>Director</Text>
                    <View style={tw`mt-2 flex-row items-center gap-2.5`}>
                      {details.directorPhoto ? (
                        <Image
                          source={{ uri: details.directorPhoto }}
                          style={tw`h-11 w-11 rounded-full`}
                          contentFit="cover"
                          cachePolicy="memory-disk"
                        />
                      ) : (
                        <View style={tw`h-11 w-11 items-center justify-center rounded-full bg-white/10`}>
                          <Text style={tw`font-sans-semibold text-[14px] text-slate-200`}>
                            {initialsOf(details.director)}
                          </Text>
                        </View>
                      )}
                      <Text style={tw`font-sans text-[14px] text-slate-300`}>{details.director}</Text>
                    </View>
                  </View>
                )}

                {details.cast.length > 0 && (
                  <View style={tw`mt-5`}>
                    <Text style={tw`font-sans-semibold text-[16px] text-white`}>Cast</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={tw`gap-3 pr-5 pt-2`}
                    >
                      {details.cast.slice(0, 8).map((name) => {
                        const photo = details.castPhotos?.[name];
                        return (
                          <View key={name} style={tw`w-[68px] items-center`}>
                            {photo ? (
                              <Image
                                source={{ uri: photo }}
                                style={tw`h-14 w-14 rounded-full`}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                              />
                            ) : (
                              <View style={tw`h-14 w-14 items-center justify-center rounded-full bg-white/10`}>
                                <Text style={tw`font-sans-semibold text-[16px] text-slate-200`}>
                                  {initialsOf(name)}
                                </Text>
                              </View>
                            )}
                            <Text
                              style={tw`mt-1.5 text-center font-sans-medium text-[10px] text-slate-300`}
                              numberOfLines={2}
                            >
                              {name}
                            </Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </>
            ) : (
              <DetailSkeletons />
            )}
          </View>
        )}
      </ScrollView>
      {!failed && visible && item && (
        <WatchBar
          best={best}
          status={status}
          dlError={dlError}
          checking={checking}
          noSources={noSources}
          bottomPad={insets.bottom + 12}
          onPlay={onPlay}
          onDownload={onDownload}
          onRecheck={recheckSources}
        />
      )}
    </View>
  );
}
