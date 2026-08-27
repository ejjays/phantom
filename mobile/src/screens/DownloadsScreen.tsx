import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  useWindowDimensions,
  AppState,
  StyleSheet,
  Modal,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBackHandler } from '../lib/back';
import { Image } from 'expo-image';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import {
  LayoutGrid,
  List,
  Play,
  FolderOpen,
  RotateCcw,
  MoreVertical,
  Search,
  Trash2,
  X,
} from 'lucide-react-native';
import LottieView from 'lottie-react-native';
import tw from '../lib/tw';
import ufo from '../../assets/UFO.json';
import SearchOverlay, {
  SearchHighlight,
} from '../components/SearchOverlay';
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
import { getNotify, getHistoryView, setHistoryView } from '../lib/settings';
import { tapSelection, tapImpact } from '../lib/haptics';
import { useAppDialog } from '../components/AppDialog';
import { PlatformLogo, type PlatformName } from '../components/logos';
import TwinkleStars from '../components/backgrounds/TwinkleStars';
import ShootingStars from '../components/backgrounds/ShootingStars';
import SwipeToDelete from '../components/SwipeToDelete';
import {
  Host,
  SnackbarHost,
  type SnackbarHostRef,
} from '@expo/ui/jetpack-compose';

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

type MenuActionProps = {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
};

function MenuAction({ icon, label, onPress }: MenuActionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) =>
        tw`flex-row items-center gap-2 px-4 py-3.5 ${pressed ? 'bg-white/10' : ''}`
      }
    >
      {icon}
      <Text style={tw`font-sans text-[15px] text-slate-200`}>{label}</Text>
    </Pressable>
  );
}

function Row({
  item,
  missing,
  onDelete,
  onPress,
}: {
  item: HistoryItem;
  missing?: boolean;
  onDelete: (item: HistoryItem) => void;
  onPress?: () => void;
}) {
  const open = useCallback(() => {
    if (onPress) {
      onPress();
      return;
    }
    if (missing) return;
    tapImpact();
    void openSavedTarget({ isAudio: item.isAudio, uri: item.uri });
  }, [item.isAudio, item.uri, missing, onPress]);

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
    <SwipeToDelete onDelete={del} capsule>
      <View style={tw`flex-row items-center gap-3 px-4 py-3`}>
        <Pressable
          onPress={open}
          disabled={missing}
          style={tw`h-14 w-[100px] overflow-hidden rounded-md border border-cyan-400/30 bg-white/5 ${missing ? 'opacity-40' : ''}`}
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
          {item.author && (
            <Text
              style={tw`mt-0.5 font-mono text-[11px] text-slate-300`}
              numberOfLines={1}
            >
              by {item.author}
            </Text>
          )}
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

function GridCard({
  item,
  missing,
  width,
  full,
  onDelete,
}: {
  item: HistoryItem;
  missing?: boolean;
  width: number;
  full?: boolean;
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
    <SwipeToDelete onDelete={del} animate={false}>
      <Pressable
        onPress={open}
        disabled={missing}
        accessibilityLabel={`${item.title}, swipe left to delete`}
        style={({ pressed }) => [
          tw`overflow-hidden rounded-xl border border-cyan-400/20 bg-[#0b1526] ${missing ? 'opacity-40' : ''} ${pressed ? 'opacity-80' : ''}`,
          { width: full ? width - 32 : (width - 44) / 2 },
        ]}
      >
        <View>
          <View style={tw`${full ? 'aspect-video' : 'aspect-square'} w-full`}>
            {item.thumbnail ? (
              <Image
                source={{ uri: item.thumbnail }}
                style={tw`h-full w-full`}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={tw`h-full w-full items-center justify-center`}>
                <Play size={24} color="#64748b" />
              </View>
            )}
          </View>
          <View style={tw`p-2.5`}>
            <Text
              style={tw`font-mono-semibold text-[12px] ${missing ? 'text-slate-500' : 'text-slate-100'}`}
              numberOfLines={full ? 2 : 1}
            >
              {item.title}
            </Text>
            {item.author && (
              <Text
                style={tw`mt-0.5 font-mono text-[10px] text-slate-300`}
                numberOfLines={1}
              >
                by {item.author}
              </Text>
            )}
            {full ? (
              <View
                style={tw`mt-1 flex-row items-center justify-between gap-2`}
              >
                <View style={tw`flex-1 flex-row items-center gap-1`}>
                  {logo && <PlatformLogo name={logo} size={16} />}
                  {logo && (
                    <Text style={tw`font-mono text-[10px] text-slate-400`}>
                      {item.platform}
                    </Text>
                  )}
                  <Text style={tw`font-mono text-[10px] text-slate-600`}>
                    ·
                  </Text>
                  <Text style={tw`font-mono text-[10px] text-slate-400`}>
                    {item.ext.toUpperCase()}
                  </Text>
                  <Text style={tw`font-mono text-[10px] text-slate-600`}>
                    ·
                  </Text>
                  <Text style={tw`font-mono text-[10px] text-slate-500`}>
                    {item.isAudio ? 'Audio' : 'Video'}
                  </Text>
                </View>
                <Text
                  style={tw`font-mono text-[10px] ${missing ? 'text-red-400/90' : 'text-slate-500'}`}
                  numberOfLines={1}
                >
                  {missing ? 'file no longer exists' : when}
                </Text>
              </View>
            ) : (
              <>
                <View style={tw`mt-1 flex-row items-center gap-1`}>
                  {logo && <PlatformLogo name={logo} size={11} />}
                  {logo && (
                    <Text style={tw`font-mono text-[10px] text-slate-600`}>
                      ·
                    </Text>
                  )}
                  <Text style={tw`font-mono text-[10px] text-slate-400`}>
                    {item.ext.toUpperCase()}
                  </Text>
                  <Text style={tw`font-mono text-[10px] text-slate-600`}>
                    ·
                  </Text>
                  <Text style={tw`font-mono text-[10px] text-slate-500`}>
                    {item.isAudio ? 'Audio' : 'Video'}
                  </Text>
                </View>
                <Text
                  style={tw`mt-0.5 font-mono text-[10px] ${missing ? 'text-red-400/90' : 'text-slate-500'}`}
                  numberOfLines={1}
                >
                  {missing ? 'file no longer exists' : when}
                </Text>
              </>
            )}
          </View>
        </View>
      </Pressable>
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
      <View
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
          <View
            style={tw`ml-[19px] h-1 overflow-hidden rounded-full bg-white/10`}
          >
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
              <Text style={tw`font-mono text-[10px] text-cyan-300`}>
                Resume
              </Text>
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
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const entryPositions = useRef<Map<string, number>>(new Map());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearchOpen(false);
    const term = query.trim().toLowerCase();
    if (term) {
      const matched = items.find((it) =>
        it.title.toLowerCase().includes(term)
      );
      if (matched) setFocusEntryId(matched.id);
    }
    setQuery('');
  }, [query, items]);

  useEffect(() => {
    if (visible || !searchOpen) return;
    closeSearch();
  }, [visible, searchOpen, closeSearch]);

  useEffect(() => {
    if (!focusEntryId) return;
    const scrollTimer = setTimeout(() => {
      const y = entryPositions.current.get(focusEntryId);
      if (y != null && scrollRef.current) {
        scrollRef.current.scrollTo({ y, animated: true });
      }
    }, 150);
    const clearTimer = setTimeout(() => setFocusEntryId(null), 2600);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [focusEntryId]);

  useBackHandler(() => {
    if (!visible) return false;
    if (searchOpen) {
      closeSearch();
      return true;
    }
    return false;
  }, 10);

  useEffect(() => {
    void getHistoryView().then(setView);
  }, []);

  const toggleView = useCallback(() => {
    tapSelection();
    setView((v) => {
      const next = v === 'list' ? 'grid' : 'list';
      void setHistoryView(next);
      return next;
    });
  }, []);

  const snackbarRef = useRef<SnackbarHostRef>(null);

  const [snackbarOpen, setSnackbarOpen] = useState(false);

  const askUndo = useCallback(async (item: HistoryItem, index: number) => {
    setSnackbarOpen(true);
    try {
      const result = await snackbarRef.current?.showSnackbar({
        message: 'Download deleted',
        actionLabel: 'Undo',
        duration: 'long',
      });
      if (result === 'actionPerformed') {
        tapImpact();
        void restoreHistory(item, index);
      }
    } finally {
      setSnackbarOpen(false);
    }
  }, []);

  const onDelete = useCallback(
    (item: HistoryItem) => {
      tapImpact();
      const index = itemsRef.current.findIndex((it) => it.id === item.id);
      void removeHistory(item.id).then(refresh);
      void askUndo(item, Math.max(0, index));
    },
    [refresh, askUndo]
  );

  const recheck = useCallback((list: HistoryItem[]) => {
    void Promise.all(
      list.map(async (it) => ({ id: it.id, ok: await fileStillExists(it.uri) }))
    ).then((res) => {
      setMissing(() => {
        const next: Record<string, boolean> = {};
        for (const result of res)
          if (result.ok === false) next[result.id] = true;
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
  const trimmedQuery = query.trim().toLowerCase();
  const filteredItems = trimmedQuery
    ? items.filter((it) => it.title.toLowerCase().includes(trimmedQuery))
    : items;

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
          tw`flex-row items-center justify-between bg-background pl-4 pr-2 pb-2 pt-3`,
          { paddingTop: insets.top + 12 },
        ]}
      >
        <Text style={tw`font-sans-bold text-[30px] tracking-tight text-white`}>
          Downloads
        </Text>
        {items.length > 0 && (
          <Pressable
            onPress={() => {
              tapSelection();
              setMenuOpen(true);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 8 }}
            style={tw`rounded-lg pl-2 pr-0.5 py-2`}
            accessibilityLabel="More options"
          >
            <MoreVertical size={20} color="#94a3b8" />
          </Pressable>
        )}
      </View>

      {menuOpen && (
        <Modal
          transparent
          visible
          animationType="none"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable
            style={tw`flex-1 bg-black/40`}
            onPress={() => {
              tapSelection();
              setMenuOpen(false);
            }}
            accessibilityLabel="Close menu"
          >
            <View
              style={tw`mr-3 flex-1 items-end`}
              accessibilityViewIsModal
            >
<View
                style={[
                  tw`overflow-hidden rounded-2xl border border-white/10 bg-[#15152c]`,
                  { marginTop: insets.top + 44 },
                ]}
                accessibilityViewIsModal
              >
                <MenuAction
                  icon={<Search size={16} color="#e2e8f0" />}
                  label="Search"
                  onPress={() => {
                    setMenuOpen(false);
                    tapSelection();
                    Keyboard.dismiss();
                    setSearchOpen(true);
                  }}
                />
                <MenuAction
                  icon={
                    view === 'list' ? (
                      <LayoutGrid size={16} color="#e2e8f0" />
                    ) : (
                      <List size={16} color="#e2e8f0" />
                    )
                  }
                  label={view === 'list' ? 'Grid' : 'List'}
                  onPress={() => {
                    setMenuOpen(false);
                    void toggleView();
                  }}
                />
                <MenuAction
                  icon={<Trash2 size={16} color="#e2e8f0" />}
                  label="Clear all"
                  onPress={() => {
                    setMenuOpen(false);
                    clearAll();
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Modal>
      )}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={tw`pb-32 ${empty ? 'flex-1' : 'pt-1'}`}
        keyboardShouldPersistTaps="handled"
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
                <View
                  style={tw`flex-row items-center justify-between px-4 pb-1 pt-2`}
                >
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
                <View
                  style={tw`flex-row items-center justify-between px-4 pb-1 pt-2`}
                >
                  <Text
                    style={tw`font-sans-bold text-[15px] tracking-tight text-slate-300`}
                  >
                    Saved
                  </Text>
                </View>
                {view === 'grid' ? (
                  <View
                    style={tw`flex-row flex-wrap justify-center gap-3 px-4 pb-2`}
                  >
                    {items.map((item, index) => {
                      const cols = items.length <= 2 ? 1 : 2;
                      const lastOdd =
                        cols === 2 &&
                        items.length % 2 === 1 &&
                        index === items.length - 1;
                      return (
                        <View
                          key={item.id}
                          onLayout={(e) =>
                            entryPositions.current.set(
                              item.id,
                              e.nativeEvent.layout.y
                            )
                          }
                        >
                          <SearchHighlight
                            active={focusEntryId === item.id}
                          >
                            <GridCard
                              item={item}
                              missing={missing[item.id]}
                              width={width}
                              full={cols === 1 || lastOdd}
                              onDelete={onDelete}
                            />
                          </SearchHighlight>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  items.map((item) => (
                    <View
                      key={item.id}
                      onLayout={(e) =>
                        entryPositions.current.set(
                          item.id,
                          e.nativeEvent.layout.y
                        )
                      }
                    >
                      <SearchHighlight active={focusEntryId === item.id}>
                        <Row
                          item={item}
                          missing={missing[item.id]}
                          onDelete={onDelete}
                        />
                      </SearchHighlight>
                    </View>
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>

      <SearchOverlay
        visible={searchOpen}
        searchQuery={query}
        query={trimmedQuery}
        results={filteredItems}
        hint={`Search ${items.length} downloads`}
        placeholder="Search downloads…"
        bgClass="bg-background"
        modal={false}
        onSearchChange={setQuery}
        onClear={() => {
          tapSelection();
          setQuery('');
        }}
        onBack={() => {
          tapSelection();
          closeSearch();
        }}
        renderRow={(item) => (
          <Row
            key={item.id}
            item={item}
            missing={missing[item.id]}
            onDelete={onDelete}
            onPress={() => {
              tapSelection();
              setFocusEntryId(item.id);
              setSearchOpen(false);
              Keyboard.dismiss();
            }}
          />
        )}
      />

      <View
        pointerEvents={snackbarOpen ? 'box-none' : 'none'}
        style={[
          StyleSheet.absoluteFill,
          { justifyContent: 'flex-end', paddingBottom: 98 + insets.bottom },
        ]}
      >
        <View style={{ height: 84 }}>
          <Host colorScheme="light" seedColor="#06b6d4" style={{ flex: 1 }}>
<SnackbarHost ref={snackbarRef} />
          </Host>
        </View>
      </View>
    </View>
  );
}

const DownloadsScreen = memo(DownloadsScreenInner);
export default DownloadsScreen;
