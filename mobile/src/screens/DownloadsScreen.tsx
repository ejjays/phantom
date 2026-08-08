import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { Play, FolderOpen, RotateCcw, UndoDot, X } from 'lucide-react-native';
import LottieView from 'lottie-react-native';
import tw from '../lib/tw';
import ufo from '../../assets/UFO.json';
import {
  useDownloadHistory,
  removeHistory,
  restoreHistory,
  clearHistory,
  type HistoryItem,
} from '../lib/downloadHistory';
import {
  resumeInflight,
  discardInflight,
} from '../lib/download/downloadPipeline';
import { useInflight, type InflightItem } from '../lib/inflight';
import { openSavedTarget, fileStillExists } from '../lib/download/gallery';
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
import SwipeToDelete from '../components/SwipeToDelete';

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

function Row({
  item,
  missing,
  onDelete,
}: {
  item: HistoryItem;
  missing?: boolean;
  onDelete: (item: HistoryItem) => void;
}) {
  const open = useCallback(() => {
    if (missing) return;
    tapImpact();
    void openSavedTarget({ isAudio: item.isAudio, uri: item.uri });
  }, [item.isAudio, item.uri, missing]);

  const del = useCallback(() => {
    tapSelection();
    onDelete(item);
  }, [item, onDelete]);

  const logo = LOGO_FOR[item.platform];
  const when = new Date(item.savedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <SwipeToDelete onDelete={del}>
      <View style={tw`flex-row items-center gap-3 px-4 py-3`}>
      <Pressable
        onPress={open}
        disabled={missing}
        style={tw`h-14 w-14 overflow-hidden rounded-xl bg-white/5 ${missing ? 'opacity-40' : ''}`}
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

      <Pressable onPress={open} disabled={missing} style={tw`flex-1`}>
        <Text
          style={tw`font-mono-semibold text-[13px] ${missing ? 'text-slate-500' : 'text-slate-100'}`}
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
          {missing ? (
            <Text style={tw`pl-[19px] font-mono text-[10px] text-red-400/90`}>
              file no longer exists
            </Text>
          ) : (
            <Text style={tw`pl-[19px] font-mono text-[10px] text-slate-500`}>
              {when}
            </Text>
          )}
        </View>
      </Pressable>
      </View>
    </SwipeToDelete>
  );
}

function InflightRow({
  item,
  onChanged,
}: {
  item: InflightItem;
  onChanged: () => void;
}) {
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const resume = useCallback(() => {
    if (running) return;
    tapImpact();
    setRunning(true);
    const ctrl = new AbortController();
    controller.current = ctrl;
    setDownloadCancelHandler(() => ctrl.abort());
    void (async () => {
      try {
        await startDownloadService();
        const outcome = await resumeInflight(
          item,
          (state) => updateDownloadProgress(state.progress),
          ctrl.signal
        );
        if (outcome.status === 'saved' && (await getNotify())) {
          await notifyDownloadComplete(
            item.id,
            item.thumbnail,
            item.platform,
            item.ext,
            outcome.uri
          ).catch(() => undefined);
        }
      } catch {
        /* row stays for another attempt */
      } finally {
        setDownloadCancelHandler(null);
        stopDownloadService().catch(() => undefined);
        setRunning(false);
        onChanged();
      }
    })();
  }, [item, onChanged, running]);

  const cancel = useCallback(() => {
    tapSelection();
    controller.current?.abort();
    if (!controller.current) void discardInflight(item.id).then(onChanged);
  }, [item.id, onChanged]);

  const logo = LOGO_FOR[item.platform];
  const pct = Math.max(0, Math.min(100, item.progress));

  return (
    <View style={tw`flex-row items-center gap-3 px-4 py-3`}>
      <View style={tw`h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-white/5`}>
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
      </View>

      <View style={tw`flex-1`}>
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
          <View style={tw`ml-[19px] mt-0.5 flex-row items-center gap-2`}>
            <Pressable
              onPress={resume}
              disabled={running}
              accessibilityLabel="Resume download"
              style={tw`flex-row items-center gap-1 rounded-lg border border-white/10 px-2 py-1 ${running ? 'opacity-40' : ''}`}
            >
              <RotateCcw size={12} color="#67e8f9" />
              <Text style={tw`font-mono text-[10px] text-cyan-300`}>Resume</Text>
            </Pressable>
            <Pressable
              onPress={cancel}
              accessibilityLabel="Cancel download"
              style={tw`flex-row items-center gap-1 rounded-lg border border-white/10 px-2 py-1`}
            >
              <X size={12} color="#f87171" />
              <Text style={tw`font-mono text-[10px] text-red-300`}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function DownloadsScreenInner({ visible }: Props) {
  const { items, loading, refresh } = useDownloadHistory();
  const { items: inflight } = useInflight();
  const { showDialog } = useAppDialog();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const ufoSize = Math.min(320, Math.max(200, width * 0.6));
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [undoItem, setUndoItem] = useState<{
    item: HistoryItem;
    index: number;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoItem(null);
  }, []);

  const undoDelete = useCallback(() => {
    tapImpact();
    if (!undoItem) return;
    void restoreHistory(undoItem.item, undoItem.index);
    clearUndo();
  }, [undoItem, clearUndo]);

  const onDelete = useCallback(
    (item: HistoryItem) => {
      const index = itemsRef.current.findIndex((it) => it.id === item.id);
      void removeHistory(item.id).then(refresh);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoItem({ item, index: Math.max(0, index) });
      undoTimer.current = setTimeout(() => setUndoItem(null), 4000);
    },
    [refresh]
  );

  useEffect(() => () => clearUndo(), [clearUndo]);

  // batch-verify saved files against android's media db; dims rows whose
  // file was deleted behind our back (gallery/file manager)
  const recheck = useCallback((list: HistoryItem[]) => {
    void Promise.all(
      list.map(async (it) => ({ id: it.id, ok: await fileStillExists(it.uri) }))
    ).then((res) => {
      setMissing(() => {
        const next: Record<string, boolean> = {};
        for (const result of res) if (result.ok === false) next[result.id] = true;
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh().then(() => recheck(itemsRef.current));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh().then(() => recheck(itemsRef.current));
      }
    });
    return () => sub.remove();
  }, [visible, refresh, recheck]);

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
                    missing={missing[item.id]}
                    onDelete={onDelete}
                  />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
      {undoItem && (
        <Animated.View
          entering={FadeInUp.duration(200)}
          exiting={FadeOutDown.duration(200)}
          style={[
            tw`absolute right-4 flex-row items-center gap-3 rounded-full border border-white/10 bg-slate-900/95 px-4 py-2.5`,
            { bottom: 98 + insets.bottom + 12 },
          ]}
        >
          <Pressable
            onPress={undoDelete}
            hitSlop={8}
            style={tw`flex-row items-center gap-1.5`}
            accessibilityLabel="Undo delete"
          >
            <UndoDot size={14} color="#22d3ee" strokeWidth={2.5} />
            <Text style={tw`font-mono text-[12px] font-semibold text-cyan-400`}>
              Undo
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const DownloadsScreen = memo(DownloadsScreenInner);
export default DownloadsScreen;
