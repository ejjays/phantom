import { Text, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { createContext, memo, useContext, useEffect, useState } from 'react';
import { FireIcon, ThumbsUpIcon, TwoToneHeartIcon } from '../icons';
import { reactionAnimation } from '../../lib/social/updates.logic';

export const ReactionPlayContext = createContext(0);

export default memo(function ReactionEmoji({
  emoji,
  size,
}: {
  emoji: string;
  size: number;
}) {
  const tick = useContext(ReactionPlayContext);
  const source = reactionAnimation(emoji);
  const [runId, setRunId] = useState(0);
  useEffect(() => {
    setRunId((id) => id + 1);
  }, [tick]);

  if (source) {
    return (
      <View style={{ paddingVertical: 1.5 }}>
        <LottieView
          key={`${runId}`}
          source={source}
          autoPlay
          loop={false}
          style={{ width: size, height: size }}
        />
      </View>
    );
  }
  let glyph;
  if (emoji === '🔥') glyph = <FireIcon size={size} />;
  else if (emoji === '👍') glyph = <ThumbsUpIcon size={size} />;
  else if (emoji === '❤️') glyph = <TwoToneHeartIcon size={size} />;
  else
    glyph = (
      <View
        style={{
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: size, lineHeight: size * 1.1 }}>{emoji}</Text>
      </View>
    );
  return <View style={{ paddingVertical: 1.5 }}>{glyph}</View>;
});
