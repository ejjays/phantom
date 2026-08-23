import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  type ListRenderItem,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Bell } from 'lucide-react-native';
import tw from '../../lib/tw';
import Avatar from '../Avatar';
import { tapSelection } from '../../lib/haptics';
import { relativeTime } from '../../lib/social/updates';
import {
  listNotifications,
  markAllRead,
  subscribeToNotifications,
  notificationAction,
  type InboxItem,
} from '../../lib/social/notifications';

const CYAN = '#22d3ee';

function Row({
  item,
  onPress,
}: {
  item: InboxItem;
  onPress: (item: InboxItem) => void;
}) {
  const handle = item.actorName.startsWith('@')
    ? item.actorName
    : `@${item.actorName}`;
  return (
    <Pressable
      onPress={() => onPress(item)}
      android_ripple={{ color: 'rgba(255,255,255,0.04)' }}
      style={[
        tw`flex-row items-start px-5 py-3.5`,
        item.read ? null : { backgroundColor: 'rgba(34,211,238,0.06)' },
      ]}
    >
      <Avatar name={item.actorName} size={44} uri={item.actorAvatar} />
      <View style={tw`ml-3.5 flex-1`}>
        <Text style={tw`font-sans text-[14px] leading-5 text-slate-200`}>
          <Text style={tw`font-sans-semibold text-white`}>{handle}</Text>{' '}
          {notificationAction(item.type)}
        </Text>
        {item.preview ? (
          <Text
            numberOfLines={1}
            style={tw`mt-0.5 font-sans text-[13px] text-slate-500`}
          >
            {item.preview}
          </Text>
        ) : null}
        <Text style={tw`mt-1 font-sans text-[11.5px] text-slate-600`}>
          {relativeTime(item.createdAt)}
        </Text>
      </View>
      {item.read ? null : (
        <View
          style={[
            tw`ml-2 mt-1.5 h-2.5 w-2.5 rounded-full`,
            { backgroundColor: CYAN },
          ]}
        />
      )}
    </Pressable>
  );
}

export default function NotificationsPanel({
  visible,
  onBack,
  onOpen,
}: {
  visible: boolean;
  onBack: () => void;
  onOpen: (item: InboxItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    listNotifications()
      .then((list) => {
        setItems(list);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    load();
    void markAllRead();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    const unsubscribe = subscribeToNotifications(refresh);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [visible, load]);

  const renderItem = useRef<ListRenderItem<InboxItem>>(({ item }) => (
    <Row item={item} onPress={onOpen} />
  )).current;

  return (
    <View style={[tw`flex-1`, { paddingTop: insets.top }]}>
      <View style={tw`flex-row items-center px-3 pb-2 pt-2`}>
        <Pressable
          onPress={() => {
            tapSelection();
            onBack();
          }}
          hitSlop={8}
          style={tw`p-1`}
        >
          <ChevronLeft size={26} color="#cbd5e1" strokeWidth={2} />
        </Pressable>
        <Text
          style={tw`ml-1 font-sans-bold text-[20px] tracking-tight text-white`}
        >
          Notifications
        </Text>
      </View>

      {loaded && items.length === 0 ? (
        <View style={tw`flex-1 items-center justify-center px-10`}>
          <View
            style={tw`h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5`}
          >
            <Bell size={26} color="#475569" strokeWidth={1.8} />
          </View>
          <Text style={tw`mt-4 font-sans-semibold text-[16px] text-slate-200`}>
            No notifications yet
          </Text>
          <Text
            style={tw`mt-1.5 text-center font-sans text-[13px] leading-5 text-slate-500`}
          >
            Replies, mentions and likes on your comments will show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
