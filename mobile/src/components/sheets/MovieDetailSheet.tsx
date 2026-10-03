import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Download, Check, Star } from 'lucide-react-native';
import tw from '../../lib/tw';
import BottomSheet from './BottomSheet';
import { resolve } from '../../extractors';
import { getTitleDetails, type LunaItem, type LunaTitle } from '../../extractors/watchluna/browse';
import { useDownload } from '../../hooks/useDownload';
import { formatLabel, type DownloadState } from '../../lib/format';
import { tapImpact } from '../../lib/haptics';
import type { Format, VideoInfo } from '@phantom/extractors';

type Props = {
  item: LunaItem | null;
  open: boolean;
  onClose: () => void;
};

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={tw`flex-row items-center gap-1.5`}>
      <Text style={tw`font-mono text-[11px] text-slate-500`}>{label}</Text>
      <Text style={tw`font-mono-semibold text-[12px] text-slate-200`}>{value}</Text>
    </View>
  );
}

function SheetBody({
  details,
  kind,
  failed,
}: {
  details: LunaTitle | null;
  kind: string;
  failed: boolean;
}) {
  if (!details && !failed) {
    return (
      <View style={tw`items-center justify-center px-6 pb-10 pt-6`}>
        <ActivityIndicator size="large" color="#22d3ee" />
        <Text style={tw`mt-3 font-mono text-[12px] text-slate-400`}>Loading title…</Text>
      </View>
    );
  }
  if (!details) {
    return (
      <View style={tw`items-center px-6 pb-10 pt-6`}>
        <Text style={tw`font-mono-semibold text-[15px] text-slate-100`}>Title unavailable</Text>
        <Text style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}>
          Watchluna did not return this one — try another.
        </Text>
      </View>
    );
  }
  return (
    <View style={tw`px-5 pb-2`}>
      {details.backdrop && (
        <View style={tw`overflow-hidden rounded-2xl border border-white/10`}>
          <Image
            source={{ uri: details.backdrop }}
            style={tw`h-40 w-full`}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>
      )}
      <View style={tw`mt-3 flex-row gap-3`}>
        {details.image && (
          <Image
            source={{ uri: details.image }}
            style={tw`h-36 w-24 rounded-xl border border-white/10`}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        )}
        <View style={tw`flex-1 justify-center`}>
          <Text style={tw`font-sans-bold text-[20px] leading-6 text-white`} numberOfLines={2}>
            {details.title}
          </Text>
          <View style={tw`mt-1.5 flex-row items-center gap-2`}>
            {details.year && (
              <Text style={tw`font-mono text-[12px] text-slate-400`}>{details.year}</Text>
            )}
            <Text style={tw`rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300`}>
              {kind === 'tv' ? 'TV' : 'Movie'}
            </Text>
            {details.contentRating && (
              <Text style={tw`rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-slate-400`}>
                {details.contentRating}
              </Text>
            )}
          </View>
          {typeof details.rating === 'number' && (
            <View style={tw`mt-1.5 flex-row items-center gap-1`}>
              <Star size={13} color="#facc15" />
              <Text style={tw`font-mono-semibold text-[12px] text-slate-200`}>
                {details.rating.toFixed(1)}
              </Text>
              {typeof details.votes === 'number' && (
                <Text style={tw`font-mono text-[11px] text-slate-500`}>
                  ({details.votes.toLocaleString()})
                </Text>
              )}
            </View>
          )}
        </View>
      </View>
      {details.genres.length > 0 && (
        <View style={tw`mt-3 flex-row flex-wrap gap-1.5`}>
          {details.genres.map((genre) => (
            <Text
              key={genre}
              style={tw`rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 font-mono text-[11px] text-cyan-200`}
            >
              {genre}
            </Text>
          ))}
        </View>
      )}
      {details.description && (
        <Text style={tw`mt-3 font-sans text-[14px] leading-5 text-slate-300`} numberOfLines={4}>
          {details.description}
        </Text>
      )}
      <View style={tw`mt-3 gap-1.5`}>
        {details.director && <Meta label="Director" value={details.director} />}
        {details.cast.length > 0 && <Meta label="Cast" value={details.cast.slice(0, 3).join(', ')} />}
        {typeof details.durationSec === 'number' && (
          <Meta label="Runtime" value={`${Math.round(details.durationSec / 60)} min`} />
        )}
      </View>
    </View>
  );
}

function SheetFooter({
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
  return (
    <View style={tw`flex-row items-center gap-3 px-5 pb-2`}>
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
      <View style={tw`flex-1`}>
        <Text style={tw`font-mono-semibold text-[13px] text-slate-100`}>
          {saved ? 'Saved — see History' : best ? `Download • ${formatLabel(best)}` : 'Finding best quality…'}
        </Text>
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

export default function MovieDetailSheet({ item, open, onClose }: Props) {
  const [details, setDetails] = useState<LunaTitle | null>(null);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const { downloads, startDownload } = useDownload(video);

  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
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
        if (found) setDetails(found);
        if (resolved && !resolved.isPartial) setVideo(resolved);
        if (!found && !resolved) setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  const best = video?.formats[0];

  const onDownload = () => {
    if (!best) return;
    tapImpact();
    void startDownload(best);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      restRatio={0.88}
      footer={
        <SheetFooter
          best={best}
          status={best ? downloads[best.formatId] : undefined}
          failed={failed}
          onDownload={onDownload}
        />
      }
    >
      <SheetBody details={details} kind={item?.kind ?? 'movie'} failed={failed} />
    </BottomSheet>
  );
}
