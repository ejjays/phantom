import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Download, Check, Star, ArrowLeft, RotateCcw, Play } from 'lucide-react-native';
import tw from '../lib/tw';
import { useBackHandler } from '../lib/back';
import { resolve } from '../extractors';
import { getTitleDetails, type LunaItem, type LunaTitle } from '../extractors/watchluna/browse';
import { useDownload } from '../hooks/useDownload';
import { formatLabel, formatSize, type DownloadState } from '../lib/format';
import { tapImpact, tapSelection } from '../lib/haptics';
import { log, error as logError } from '../lib/log';
import type { Format, VideoInfo } from '@phantom/extractors';

type Props = {
  visible: boolean;
  item: LunaItem | null;
  onClose: () => void;
  onPlay: () => void;
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={tw`flex-row items-center gap-2`}>
      <Text style={tw`w-20 font-mono text-[11px] text-slate-500`}>{label}</Text>
      <Text style={tw`flex-1 font-mono-semibold text-[12px] text-slate-200`}>{value}</Text>
    </View>
  );
}

async function loadTitle(
  kind: LunaItem['kind'],
  id: string
): Promise<[LunaTitle | null, VideoInfo | null, string]> {
  let found: LunaTitle | null = null;
  try {
    found = await getTitleDetails(kind, id);
  } catch (err) {
    logError('Movies', `detail ${kind}/${id} meta failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  let full: VideoInfo | null = null;
  let sourceErr = 'empty resolve';
  try {
    const resolved = await resolve(`https://watchluna.gd/${kind}/${id}`, undefined, { fresh: true });
    if (resolved && !resolved.isPartial) full = resolved;
  } catch (err) {
    sourceErr = err instanceof Error ? err.message : String(err);
  }
  return [found, full, sourceErr];
}

function detailsFromVideo(kind: LunaItem['kind'], id: string, full: VideoInfo): LunaTitle {
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

function DlIcon({ phase }: { phase: DlPhase }) {
  if (phase === 'busy') return <ActivityIndicator size="small" color="#083344" />;
  if (phase === 'saved') return <Check size={24} color="#083344" strokeWidth={3} />;
  if (phase === 'errored') return <RotateCcw size={22} color="#083344" strokeWidth={2.5} />;
  return <Download size={22} color="#083344" strokeWidth={2.5} />;
}

function SectionIcon({
  phase,
  checking,
  canRecheck,
}: {
  phase: DlPhase;
  checking: boolean;
  canRecheck: boolean;
}) {
  if (checking && canRecheck) return <ActivityIndicator size="small" color="#083344" />;
  if (canRecheck) return <RotateCcw size={22} color="#083344" strokeWidth={2.5} />;
  return <DlIcon phase={phase} />;
}

function sectionTitle(
  phase: DlPhase,
  progress: number,
  noSources: boolean,
  checking: boolean
): string {
  if (phase === 'saved') return 'Saved to History';
  if (phase === 'errored') return 'Tap to retry';
  if (phase === 'busy') return `${progress}%`;
  if (phase === 'ready') return 'Download';
  if (checking) return 'Checking…';
  if (noSources) return 'Check again';
  return 'Finding best quality…';
}

function sectionHint(phase: DlPhase, hint: string): string {
  if (phase === 'saved') return 'Find it in the History tab';
  if (phase === 'busy') return 'Downloading…';
  if (phase === 'ready') return hint;
  return '';
}

function DownloadSection({
  best,
  status,
  noSources,
  checking,
  dlError,
  onDownload,
  onRecheck,
}: {
  best: Format | undefined;
  status: DownloadState | undefined;
  noSources: boolean;
  checking: boolean;
  dlError: string | null;
  onDownload: () => void;
  onRecheck: () => void;
}) {
  const phase = dlPhase(status, Boolean(best), dlError);
  const size = best?.filesize ? formatSize(best.filesize) : '';
  const sub = best ? [formatLabel(best), size].filter(Boolean).join(' • ') : '';
  const shell =
    phase === 'saved' ? 'bg-emerald-400' : phase === 'errored' ? 'bg-amber-400' : 'bg-cyan-400';
  const title = sectionTitle(phase, status?.progress ?? 0, noSources, checking);
  const hint = sectionHint(phase, sub);
  const idle = phase === 'ready' || phase === 'errored';
  const canRecheck = noSources && !checking;
  return (
    <View style={tw`mt-4`}>
      <Pressable
        onPress={() => {
          if (canRecheck) onRecheck();
          else onDownload();
        }}
        disabled={!idle && !canRecheck && phase !== 'busy' && phase !== 'saved'}
        testID="movie-download-btn"
        accessibilityLabel={phase === 'saved' ? 'Saved to history' : phase === 'errored' ? 'Retry download' : canRecheck ? 'Check for sources again' : 'Download this title'}
        style={({ pressed }) => [
          tw`h-16 overflow-hidden rounded-2xl ${shell} ${pressed && idle ? 'opacity-85' : ''} ${phase === 'waiting' ? 'opacity-60' : ''}`,
        ]}
      >
        {phase === 'busy' && (
          <View
            style={[tw`absolute inset-y-0 left-0 bg-black/20`, { width: `${status?.progress ?? 0}%` }]}
          />
        )}
        <View style={tw`flex-1 flex-row items-center gap-3 px-5`}>
          <SectionIcon phase={phase} checking={checking} canRecheck={canRecheck} />
          <View style={tw`flex-1`}>
            <Text style={tw`font-sans-bold text-[17px] text-slate-950`}>{title}</Text>
            {hint !== '' && (
              <Text style={tw`font-mono text-[12px] text-slate-800`}>{hint}</Text>
            )}
          </View>
        </View>
      </Pressable>
      {dlError && (
        <Text style={tw`mt-2 font-mono text-[12px] text-red-400`}>{dlError}</Text>
      )}
      {noSources && !best && (
        <Text style={tw`mt-2 font-mono text-[12px] text-slate-500`}>
          This title has no streams right now — check back after release.
        </Text>
      )}
    </View>
  );
}

export default function MovieDetailScreen({ visible, item, onClose, onPlay }: Props) {
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<LunaTitle | null>(null);
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
    log('Movies', `detail open ${item.kind}/${item.id}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per opened title, then async fill
    setDetails(null);
    setVideo(null);
    setFailed(false);
    setNoSources(false);
    setDlError(null);
    void (async () => {
      const [found, full, sourceErr] = await loadTitle(item.kind, item.id);
      if (cancelled) return;
      setChecking(false);
      if (found) setDetails(found);
      else if (full) setDetails(detailsFromVideo(item.kind, item.id, full));
      if (full) setVideo(full);
      else if (found) {
        setNoSources(true);
        log('Movies', `detail ${item.kind}/${item.id} meta-only title="${found.title}" sources failed: ${sourceErr} ms=${Date.now() - started}`);
        return;
      }
      if (!found && !full) {
        setFailed(true);
        logError('Movies', `detail ${item.kind}/${item.id} empty (no meta, no sources)`);
      } else {
        log(
          'Movies',
          `detail ${item.kind}/${item.id} ready title="${found?.title ?? full?.title}" formats=${full?.formats.length ?? 0} best=${full?.formats[0]?.formatId} ms=${Date.now() - started}`
        );
      }
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
        tw`absolute inset-0 bg-background`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      <ScrollView contentContainerStyle={tw`pb-10`}>
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
                value={best ? formatLabel(best) : noSources ? (checking ? 'Checking…' : 'No sources yet') : failed ? 'Unavailable' : 'Resolving…'}
              />
            </View>
            <DownloadSection
              best={best}
              status={status}
              noSources={noSources}
              checking={checking}
              dlError={dlError}
              onDownload={onDownload}
              onRecheck={recheckSources}
            />
            <Pressable
              onPress={() => {
                tapImpact();
                onPlay();
              }}
              disabled={!best}
              testID="movie-play-btn"
              accessibilityLabel="Play this title"
              style={({ pressed }) => [
                tw`mt-3 h-16 flex-row items-center gap-3 overflow-hidden rounded-2xl bg-white px-5 ${pressed && best ? 'opacity-85' : ''} ${!best ? 'opacity-50' : ''}`,
              ]}
            >
              <Play size={22} color="#083344" strokeWidth={2.5} />
              <View style={tw`flex-1`}>
                <Text style={tw`font-sans-bold text-[17px] text-slate-950`}>Play</Text>
                <Text style={tw`font-mono text-[12px] text-slate-700`}>
                  {noSources
                    ? checking
                      ? 'Checking for streams…'
                      : 'No streams right now'
                    : 'Stream instantly, no download'}
                </Text>
              </View>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
