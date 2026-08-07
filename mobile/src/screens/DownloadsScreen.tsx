import { memo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Trash2, Play, FolderOpen } from 'lucide-react-native';
import LottieView from 'lottie-react-native';
import tw from '../lib/tw';
import ufo from '../../assets/UFO.json';
import {
  useDownloadHistory,
  removeHistory,
  clearHistory,
  type HistoryItem,
} from '../lib/downloadHistory';
import {
  resumeInflight,
  discardInflight,
} from '../lib/download/downloadPipeline';
import { useInflight, type InflightItem } from '../lib/inflight';
import { openSavedTarget } from '../lib/download/gallery';
import {
  setDownloadCancelHandler,
  startDownloadService,
  stopDownloadService,
  updateDownloadProgress,
} from '../lib/fgservice';
import { notifyDownloadComplete } from '../lib/notify';
import { getNotify } from '../lib/settings';
import { tapSelection, tapImpact } from '../lib/haptics';
import { useAppDialog } from '../components/AppDialog';
import { PlatformLogo, type PlatformName } from '../components/logos';
import TwinkleStars from '../components/backgrounds/TwinkleStars';
import ShootingStars from '../components/backgrounds/ShootingStars';

type Props = {
  visible: boolean;
};

const LOGO_FOR: Partial<Record<string, PlatformName>> = {
  bilibili: 'bilibili',
  bluesky: 'bluesky',
  dailymotion: 'dailymotion',
  facebook: 'facebook',
  instagram: 'instagram',
  reddit: 'reddit',
  soundcloud: 'soundcloud',
  spotify: 'spotify',
  threads: 'threads',
  tiktok: 'tiktok',
  vimeo: 'vimeo',
  x: 'x',
  youtube: 'youtube',
};

/**
 * Renders a saved download with its metadata and actions to open or delete it.
 *
 * @param item - The saved download to display
 * @param onChanged - Callback invoked after the download is deleted
 */
function Row({
  item,
  onChanged,
}: {
  item: HistoryItem;
  onChanged: () => void;
}) {
  const open = useCallback(() => {
    tapImpact();
    void openSavedTarget({ isAudio: item.isAudio, uri: item.uri });
  }, [item.isAudio, item.uri]);

  const del = useCallback(() => {
    tapSelection();
    void removeHistory(item.id).then(onChanged);
  }, [item.id, onChanged]);

  const logo = LOGO_FOR[item.platform];
  const when = new Date(item.savedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <View style={tw`flex-row items-center gap-3 px-4 py-3`}>
      <Pressable
        onPress={open}
        style={tw`h-14 w-14 overflow-hidden rounded-xl bg-white/5`}
      >
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={tw`h-full w-full`}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={tw`h-full w-full items-center justify-center`}>
            <Play size={20} color="#64748b" />
          </View>
        )}
      </Pressable>

      <Pressable onPress={open} style={tw`flex-1`}>
        <Text
          style={tw`font-mono-semibold text-[13px] text-slate-100`}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <View style={tw`mt-1 gap-0.5`}>
          <View style={tw`flex-row items-center gap-1.5`}>
            {logo && <PlatformLogo name={logo} size={13} />}
            <Text style={tw`font-mono text-[11px] text-slate-400`}>
              {[
                item.platform,
                item.ext.toUpperCase(),
                item.isAudio ? 'Audio' : 'Video',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text style={tw`pl-[19px] font-mono text-[10px] text-slate-500`}>
            {when}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={del}
        accessibilityLabel="Delete download"
        style={tw`rounded-lg p-2`}
        hitSlop={8}
      >
        <Trash2 size={18} color="#64748b" />
      </Pressable>
    </View>
  );
}

/**
 * Renders an interrupted download with progress, resume, and discard actions.
 *
 * @param item - The interrupted download to display
 * @param onChanged - Callback invoked after the download is resumed or discarded
 */
function InflightRow({
  item,
  onChanged,
}: {
  item: InflightItem;
  onChanged: () => void;
}) {
  const resume = useCallback(() => {
    tapImpact();
    const controller = new AbortController();
    setDownloadCancelHandler(() => controller.abort());
    void (async () => {
      try {
        await startDownloadService();
        const outcome = await resumeInflight(
          item,
          (state) => updateDownloadProgress(state.progress),
          controller.signal
        );
        if (outcome.status === 'saved' && (await getNotify())) {
          await notifyDownloadComplete(
            item.id,
            item.thumbnail,
            item.platform
          ).catch(() => undefined);
        }
      } catch {
        /* row stays for another attempt */
      } finally {
        setDownloadCancelHandler(null);
        stopDownloadService().catch(() => undefined);
        onChanged();
      }
    })();
  }, [item, onChanged]);

  const del = useCallback(() => {
    tapSelection();
    void discardInflight(item.id).then(onChanged);
  }, [item.id, onChanged]);

  const logo = LOGO_FOR[item.platform];
  const pct = Math.max(0, Math.min(100, item.progress));

  return (
    <View style={tw`flex-row items-center gap-3 px-4 py-3`}>
      <Pressable
        onPress={resume}
        style={tw`h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-white/5`}
      >
        {item.thumbnail ? (
          <Image
            source={{ uri: item.thumbnail }}
            style={tw`h-full w-full`}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <Play size={20} color="#64748b" />
        )}
      </Pressable>

      <Pressable onPress={resume} style={tw`flex-1`}>
        <Text
          style={tw`font-mono-semibold text-[13px] text-slate-100`}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <View style={tw`mt-1 gap-1`}>
          <View style={tw`flex-row items-center gap-1.5`}>
            {logo && <PlatformLogo name={logo} size={13} />}
            <Text style={tw`font-mono text-[11px] text-slate-400`}>
              {[
                item.platform,
                item.ext.toUpperCase(),
                item.isAudio ? 'Audio' : 'Video',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Text style={tw`font-mono text-[11px] text-cyan-400`}>{pct}%</Text>
          </View>
          <View style={tw`ml-[19px] h-1 overflow-hidden rounded-full bg-white/10`}>
            <View
              style={[
                tw`h-full rounded-full bg-cyan-400`,
                { width: `${pct}%` },
              ]}
            />
          </View>
        </View>
      </Pressable>

      <Pressable
        onPress={del}
        accessibilityLabel="Discard download"
        style={tw`rounded-lg p-2`}
        hitSlop={8}
      >
        <Trash2 size={18} color="#64748b" />
      </Pressable>
    </View>
  );
}

/**
 * Displays saved and in-progress downloads with refresh and history-clearing controls.
 *
 * @param visible - Whether the downloads screen is visible
 * @returns The downloads screen element
 */
function DownloadsScreenInner({ visible }: Props) {
  const { items, loading, refresh } = useDownloadHistory();
  const { items: inflight } = useInflight();
  const { showDialog } = useAppDialog();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const ufoSize = Math.min(320, Math.max(200, width * 0.6));

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const clearAll = useCallback(() => {
    if (items.length === 0) return;
    showDialog({
      title: 'Clear history?',
      message: `Remove ${items.length} ${items.length === 1 ? 'item' : 'items'} from the list. Your saved files stay in the gallery.`,
      cancelLabel: 'Cancel',
      confirmLabel: `Clear ${items.length === 1 ? 'item' : 'all'}`,
      onConfirm: () => {
        void clearHistory().then(refresh);
      },
    });
  }, [items.length, showDialog, refresh]);

  const empty = items.length === 0 && inflight.length === 0;

  return (
    <View
      style={[
        tw`absolute inset-0 bg-background`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      {empty && (
        <>
          <TwinkleStars />
          <ShootingStars />
        </>
      )}
      <View
        style={[
          tw`flex-row items-center justify-between px-4 pb-2 pt-3`,
          { paddingTop: insets.top + 12 },
        ]}
      >
        <Text style={tw`font-sans-bold text-[30px] tracking-tight text-white`}>
          Downloads
        </Text>
        {items.length > 0 && (
          <Pressable
            onPress={clearAll}
            style={tw`flex-row items-center gap-1 rounded-lg px-2 py-1.5`}
          >
            <FolderOpen size={14} color="#64748b" />
            <Text style={tw`font-mono text-[11px] text-slate-400`}>Clear</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={tw`pb-32 ${empty ? 'flex-1' : 'pt-1'}`}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refresh()}
            tintColor="#22d3ee"
            colors={['#22d3ee']}
            progressBackgroundColor="#17324c"
          />
        }
      >
        {empty ? (
          <View style={tw`flex-1 items-center justify-center px-8`}>
            <LottieView
              source={ufo}
              autoPlay
              loop
              style={{ width: ufoSize, height: ufoSize }}
            />
            <Text
              style={tw`mt-4 text-center font-mono-medium text-sm text-cyan-400`}
            >
              Nothing saved yet.
            </Text>
            <Text
              style={tw`mt-1 text-center font-mono text-[12px] text-slate-400`}
            >
              Downloads in progress show up here too.
            </Text>
          </View>
        ) : (
          <>
            {inflight.length > 0 && (
              <>
                <View style={tw`flex-row items-center justify-between px-4 pb-1 pt-2`}>
                  <Text
                    style={tw`font-sans-bold text-[15px] tracking-tight text-slate-300`}
                  >
                    In progress
                  </Text>
                </View>
                {inflight.map((item) => (
                  <InflightRow
                    key={item.id}
                    item={item}
                    onChanged={() => void refresh()}
                  />
                ))}
              </>
            )}
            {items.length > 0 && (
              <>
                <View style={tw`flex-row items-center justify-between px-4 pb-1 pt-2`}>
                  <Text
                    style={tw`font-sans-bold text-[15px] tracking-tight text-slate-300`}
                  >
                    Saved
                  </Text>
                </View>
                {items.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    onChanged={() => void refresh()}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const DownloadsScreen = memo(DownloadsScreenInner);
export default DownloadsScreen;
