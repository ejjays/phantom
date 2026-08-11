import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { FireIcon, ThumbsUpIcon, TwoToneHeartIcon } from '../icons';
import {
  reactionImageUrl,
  reactionPlayMs,
} from '../../lib/social/updates.logic';

export const ReactionPlayContext = createContext(0);

export default memo(function ReactionEmoji({
  emoji,
  size,
}: {
  emoji: string;
  size: number;
}) {
  const tick = useContext(ReactionPlayContext);
  const uri = reactionImageUrl(emoji);
  const playMs = reactionPlayMs(emoji);
  const ref = useRef<Image>(null);
  const [runId, setRunId] = useState(0);
  useEffect(() => {
    if (!playMs) return undefined;
    setRunId((id) => id + 1);
    const timer = setTimeout(() => {
      void ref.current?.stopAnimating();
    }, playMs);
    return () => clearTimeout(timer);
  }, [tick, playMs, uri]);

  if (uri) {
    return (
      <View style={{ paddingVertical: 1.5 }}>
        <Image
          key={`${runId}`}
          ref={ref}
          source={{ uri }}
          style={{ width: size, height: size }}
          autoplay
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
