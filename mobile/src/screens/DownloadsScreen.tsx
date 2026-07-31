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
import spacecat from '../../assets/spacecat.json';
import {
  useDownloadHistory,
  removeHistory,
  clearHistory,
  type HistoryItem,
} from '../lib/downloadHistory';
import { openSavedTarget } from '../lib/download/gallery';
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

function DownloadsScreenInner({ visible }: Props) {
  const { items, loading, refresh } = useDownloadHistory();
  const { showDialog } = useAppDialog();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const titleSize = Math.min(30, Math.max(22, width * 0.062));
  const catSize = Math.min(200, Math.max(140, width * 0.5));

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

  return (
    <View
      style={[
        tw`absolute inset-0 bg-background`,
        { opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none' },
      ]}
    >
      {items.length === 0 && (
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
        <Text
          style={[
            tw`font-mono-bold text-slate-100`,
            { fontSize: titleSize, lineHeight: titleSize * 1.2 },
          ]}
        >
          History
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
        contentContainerStyle={tw`pb-32 ${items.length ? 'pt-1' : 'flex-1'}`}
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
        {items.length === 0 ? (
          <View style={tw`flex-1 items-center justify-center px-8`}>
            <LottieView
              source={spacecat}
              autoPlay
              loop
              style={{ width: catSize, height: catSize }}
            />
            <Text
              style={tw`mt-4 text-center font-mono-medium text-sm text-slate-500`}
            >
              Nothing saved yet.
            </Text>
            <Text
              style={tw`mt-1 text-center font-mono text-[12px] text-slate-600`}
            >
              Your saved media shows up here.
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <Row key={item.id} item={item} onChanged={() => void refresh()} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const DownloadsScreen = memo(DownloadsScreenInner);
export default DownloadsScreen;
