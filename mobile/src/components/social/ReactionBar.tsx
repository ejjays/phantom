import { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import tw from '../../lib/tw';
import ReactionEmoji from './ReactionEmoji';
import AnimatedCount from './AnimatedCount';
import { type ReactionTally } from '../../lib/social/updates';

const CYAN = '#22d3ee';
const REACTION_GLOW =
  '0px 0px 8px 0px rgba(34,211,238,0.3), 0px 0px 3px 0px rgba(34,211,238,0.35)';

function ReactionPill({
  tally,
  onReact,
}: {
  tally: ReactionTally;
  onReact: (emoji: string) => void;
}) {
  const glow = useSharedValue(tally.mine ? 1 : 0);
  useEffect(() => {
    glow.value = withTiming(tally.mine ? 1 : 0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [tally.mine, glow]);
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      glow.value,
      [0, 1],
      ['rgba(20,30,55,0.7)', 'rgba(34,211,238,0.16)']
    ),
  }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Pressable onPress={() => onReact(tally.emoji)} style={tw`mr-2`}>
      <View style={tw`rounded-full`}>
        <Animated.View
          style={[tw`flex-row items-center rounded-full px-2.5 py-1`, bgStyle]}
        >
          <ReactionEmoji emoji={tally.emoji} size={23} />
          <AnimatedCount
            value={tally.count}
            style={[
              tw`ml-1.5 font-sans-semibold text-[12px]`,
              tally.mine ? { color: CYAN } : tw`text-slate-400`,
            ]}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            tw`rounded-full border`,
            { borderColor: CYAN, boxShadow: REACTION_GLOW },
            ringStyle,
          ]}
        />
      </View>
    </Pressable>
  );
}

export { ReactionPlayContext } from './ReactionEmoji';
export default function ReactionBar({
  tallies,
  onReact,
}: {
  tallies: ReactionTally[];
  onReact: (emoji: string) => void;
}) {
  return (
    <View style={tw`flex-row items-center`}>
      {tallies.map((tally) => (
        <ReactionPill key={tally.emoji} tally={tally} onReact={onReact} />
      ))}
    </View>
  );
}
