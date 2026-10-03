import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Download, Check, Star, ArrowLeft } from 'lucide-react-native';
import tw from '../lib/tw';
import { useBackHandler } from '../lib/back';
import { resolve } from '../extractors';
import { getTitleDetails, type LunaItem, type LunaTitle } from '../extractors/watchluna/browse';
import { useDownload } from '../hooks/useDownload';
import { formatLabel, type DownloadState } from '../lib/format';
import { tapImpact, tapSelection } from '../lib/haptics';
import { log, error as logError } from '../lib/log';
import type { Format, VideoInfo } from '@phantom/extractors';

type Props = {
  visible: boolean;
  item: LunaItem | null;
  onClose: () => void;
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={tw`flex-row items-center gap-2`}>
      <Text style={tw`w-20 font-mono text-[11px] text-slate-500`}>{label}</Text>
      <Text style={tw`flex-1 font-mono-semibold text-[12px] text-slate-200`}>{value}</Text>
    </View>
  );
}

function TitleBlock({ details, kind }: { details: LunaTitle; kind: string }) {
  return (
    <View style={tw`flex-row items-end gap-3`}>
      {details.image && (
        <Image
          source={{ uri: details.image }}
          style={tw`-mt-20 h-44 w-30 rounded-2xl border-2 border-background`}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      )}
      <View style={tw`flex-1 pb-1`}>
        <Text style={tw`font-sans-bold text-[22px] leading-7 text-white`} numberOfLines={3}>
          {details.title}
        </Text>
        <View style={tw`mt-1 flex-row items-center gap-2`}>
          {details.year && (
            <Text style={tw`font-mono text-[12px] text-slate-400`}>{details.year}</Text>
          )}
          <Text style={tw`rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300`}>
            {kind === 'tv' ? 'TV Show' : 'Movie'}
          </Text>
          {details.contentRating && (
            <Text style={tw`rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-slate-400`}>
              {details.contentRating}
            </Text>
          )}
        </View>
        {typeof details.rating === 'number' && (
          <View style={tw`mt-1.5 flex-row items-center gap-1.5`}>
            <Star size={14} color="#facc15" />
            <Text style={tw`font-mono-semibold text-[13px] text-white`}>
              {details.rating.toFixed(1)}
            </Text>
            {typeof details.votes === 'number' && (
              <Text style={tw`font-mono text-[11px] text-slate-500`}>
                {details.votes.toLocaleString()} votes
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function DetailFooter({
  best,
  status,
  failed,
  onDownload,
}: {
  best: Format | undefined;
  status: DownloadState | undefined;
  failed: boolean;
  onDownload: () => void;
}) {
  const busy = status?.status === 'downloading';
  const saved = status?.status === 'saved';
  const label = saved
    ? 'Saved — see History'
    : best
      ? `Download • ${formatLabel(best)}`
      : 'Finding best quality…';
  return (
    <View style={tw`flex-row items-center gap-3 px-5`}>
      <Pressable
        onPress={onDownload}
        disabled={!best || busy || saved}
        testID="movie-download-btn"
        accessibilityLabel={saved ? 'Saved to history' : 'Download this title'}
        style={({ pressed }) => [
          tw`h-14 w-14 items-center justify-center rounded-full border border-cyan-300/40 bg-cyan-500/20 ${!best || saved ? 'opacity-50' : ''} ${pressed ? 'opacity-70' : ''}`,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#67e8f9" />
        ) : saved ? (
          <Check size={24} color="#67e8f9" />
        ) : (
          <Download size={24} color="#67e8f9" />
        )}
      </Pressable>
      <View style={tw`flex-1 rounded-2xl border border-white/10 bg-black/60 px-3.5 py-2.5`}>
        <Text style={tw`font-mono-semibold text-[13px] text-slate-100`}>{label}</Text>
        {busy && (
          <Text style={tw`mt-0.5 font-mono text-[11px] text-cyan-300`}>
            {status?.progress ?? 0}% downloaded
          </Text>
        )}
        {failed && (
          <Text style={tw`mt-0.5 font-mono text-[11px] text-red-400`}>
            Could not load sources — retry later
          </Text>
        )}
      </View>
    </View>
  );
}

export default function MovieDetailScreen({ visible, item, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<LunaTitle | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [failed, setFailed] = useState(false);
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
    log('Movies', `detail open ${item.kind}/${item.id}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per opened title, then async fill
    setDetails(null);
    setVideo(null);
    setFailed(false);
    void (async () => {
      try {
        const [found, resolved] = await Promise.all([
          getTitleDetails(item.kind, item.id),
          resolve(`https://watchluna.gd/${item.kind}/${item.id}`, undefined, { fresh: true }),
        ]);
        if (cancelled) return;
        const full = resolved && !resolved.isPartial ? resolved : null;
        if (found) setDetails(found);
        if (full) setVideo(full);
        if (!found && !full) {
          setFailed(true);
          logError('Movies', `detail ${item.kind}/${item.id} empty (no meta, no sources)`);
        } else {
          log(
            'Movies',
            `detail ${item.kind}/${item.id} ready title="${found?.title ?? full?.title}" formats=${full?.formats.length ?? 0} best=${full?.formats[0]?.formatId} ms=${Date.now() - started}`
          );
        }
      } catch (err) {
        if (cancelled) return;
        setFailed(true);
        logError('Movies', `detail ${item.kind}/${item.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, item]);

  const best = video?.formats[0];
  const status = best ? downloads[best.formatId] : undefined;
  const busy = status?.status === 'downloading';
  const saved = status?.status === 'saved';

  const onDownload = () => {
    if (!best || busy || saved) return;
    tapImpact();
    log('Movies', `download tap ${best.formatId} ${formatLabel(best)}`);
    void startDownload(best).then((result) => {
      if (result.status === 'saved') {
        log('Movies', `download saved ${best.formatId} uri=${result.uri ?? 'gallery'}`);
      } else if (result.status === 'error') {
        logError('Movies', `download error ${best.formatId}: ${result.message}`);
      } else {
        log('Movies', `download cancelled ${best.formatId}`);
      }
    });
  };

  return (
    <View
      style={[
        tw`absolute inset-0 bg-background`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      <ScrollView contentContainerStyle={tw`pb-40`}>
        {details?.backdrop ? (
          <View>
            <Image
              source={{ uri: details.backdrop }}
              style={tw`h-72 w-full`}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={tw`absolute inset-x-0 bottom-0 h-24 bg-black/40`} />
          </View>
        ) : (
          <View style={[tw`w-full bg-white/5`, { height: 120 }]} />
        )}
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

        {!details && !failed ? (
          <View style={tw`items-center px-6 py-10`}>
            <ActivityIndicator size="large" color="#22d3ee" />
            <Text style={tw`mt-3 font-mono text-[12px] text-slate-400`}>Loading title…</Text>
          </View>
        ) : !details ? (
          <View style={tw`items-center px-6 py-10`}>
            <Text style={tw`font-mono-semibold text-[15px] text-slate-100`}>Title unavailable</Text>
            <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
              Watchluna did not return this one — go back and try another.
            </Text>
          </View>
        ) : (
          <View style={tw`px-4`}>
            <TitleBlock details={details} kind={item?.kind ?? 'movie'} />

            {details.genres.length > 0 && (
              <View style={tw`mt-4 flex-row flex-wrap gap-1.5`}>
                {details.genres.map((genre) => (
                  <Text
                    key={genre}
                    style={tw`rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 font-mono text-[11px] text-cyan-200`}
                  >
                    {genre}
                  </Text>
                ))}
              </View>
            )}

            {details.description && (
              <Text style={tw`mt-4 font-sans text-[15px] leading-6 text-slate-200`}>
                {details.description}
              </Text>
            )}

            <View style={tw`mt-4 gap-2 rounded-2xl border border-white/10 bg-white/5 p-3.5`}>
              {details.director && <Meta label="Director" value={details.director} />}
              {details.cast.length > 0 && <Meta label="Cast" value={details.cast.slice(0, 4).join(', ')} />}
              {typeof details.durationSec === 'number' && (
                <Meta label="Runtime" value={`${Math.round(details.durationSec / 60)} min`} />
              )}
              <Meta
                label="Quality"
                value={best ? formatLabel(best) : failed ? 'Unavailable' : 'Resolving…'}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[tw`absolute bottom-0 left-0 right-0`, { paddingBottom: insets.bottom + 108 }]}>
        <DetailFooter
          best={best}
          status={status}
          failed={failed}
          onDownload={onDownload}
        />
      </View>
    </View>
  );
}
