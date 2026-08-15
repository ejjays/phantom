import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  withTiming,
  withDelay,
  Easing,
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import tw from '../lib/tw';

function SearchOverlay<T>({
  visible,
  searchQuery,
  query,
  results,
  hint,
  placeholder,
  bgClass = 'bg-[#0f0f0f]',
  modal = true,
  renderRow,
  onSearchChange,
  onClear,
  onBack,
}: {
  visible: boolean;
  searchQuery: string;
  query: string;
  results: T[];
  hint: string;
  placeholder: string;
  bgClass?: string;
  modal?: boolean;
  renderRow: (item: T) => ReactNode;
  onSearchChange: (text: string) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const fade = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    fade.value = 0;
    fade.value = withTiming(1, {
      duration: 150,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, fade]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const content = (
    <Animated.View
      style={[
        modal ? null : StyleSheet.absoluteFill,
        tw`flex-1 ${bgClass}`,
        { paddingTop: insets.top },
        animatedStyle,
      ]}
    >
        <View
          style={tw`flex-row items-center border-b border-white/10 bg-white/5`}
        >
          <View style={tw`flex-1 flex-row items-center px-3 py-2.5`}>
            <Pressable hitSlop={12} onPress={onBack}>
              <ArrowLeft size={24} color="#ffffff" />
            </Pressable>
            <TextInput
              autoFocus
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder={placeholder}
              placeholderTextColor="#666"
              style={tw`ml-3 flex-1 text-[15px] text-white`}
              selectionColor="#22d3ee"
            />
            {searchQuery.length > 0 ? (
              <Pressable hitSlop={8} onPress={onClear}>
                <X size={18} color="#888" />
              </Pressable>
            ) : null}
          </View>
        </View>

        {query ? (
          <View style={tw`px-4 pb-1 pt-2`}>
            <Text style={tw`text-[12px] text-slate-500`}>
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </Text>
          </View>
        ) : (
          <View style={tw`flex-1 items-center justify-center px-4 pb-20`}>
            <Search size={40} color="#333" />
            <Text style={tw`mt-3 text-[14px] text-slate-600`}>{hint}</Text>
          </View>
        )}

        {query ? (
          <ScrollView
            style={tw`flex-1`}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {results.length === 0 ? (
              <View style={tw`items-center px-4 py-10`}>
                <Search size={32} color="#444" />
                <Text style={tw`mt-3 text-center text-[14px] text-slate-500`}>
                  {'No results for "'}
                  {query}
                  {'"'}
                </Text>
                <Text style={tw`mt-1 text-center text-[12px] text-slate-600`}>
                  Try a different search term
                </Text>
              </View>
            ) : null}
            {results.map((item) => renderRow(item))}
          </ScrollView>
        ) : null}
      </Animated.View>
    );

  if (!visible) return null;
  if (!modal) return content;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onBack}>
      {content}
    </Modal>
  );
}

function SearchHighlight({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const glow = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    if (!active) return;
    glow.value = 1;
    glow.value = withDelay(
      800,
      withTiming(0, { duration: 650, easing: Easing.in(Easing.quad) })
    );
  }, [active, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <View>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: -16,
              right: -16,
              top: -8,
              bottom: -8,
              backgroundColor: 'rgba(34,211,238,0.12)',
              borderRadius: 4,
            },
            style,
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

export default SearchOverlay;
export { SearchHighlight };