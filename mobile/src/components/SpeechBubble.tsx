import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeInDown,
  Easing,
} from 'react-native-reanimated';
import tw from '../lib/tw';
import { nextSpeechMsgIndex, nextFollowupIndex } from '../lib/settings';

const WELCOME_MSG =
  'Hi, welcome I\u2019m Phantom, let\u2019s make some magic..';
const RETURNING_MSGS = [
  'hey, it\u2019s me again. glad you\u2019re here',
  'hello, good to see you again',
  'let\u2019s do some magic again?',
];
const FOLLOWUP_MSGS = [
  'got a link? let\u2019s grab it',
  'youtube, spotify, tiktok — your pick',
  'what are we downloading today?',
  'ready when you are',
];

const TYPE_MS = 42;
const HOLD_MS = 6500;
const FULL_HOLD_MS = 2500;

export default function SpeechBubble({
  variant,
}: {
  variant: 'welcome' | 'returning';
}) {
  const [message, setMessage] = useState(WELCOME_MSG);
  const [followUp, setFollowUp] = useState('');
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [hold, setHold] = useState(false);
  const [cursorOn, setCursorOn] = useState(false);
  const [ready, setReady] = useState(false);
  const opacity = useSharedValue(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let mounted = true;
    if (variant === 'returning') {
      void Promise.all([
        nextSpeechMsgIndex(RETURNING_MSGS.length),
        nextFollowupIndex(FOLLOWUP_MSGS.length),
      ]).then(([msgIndex, followIndex]) => {
        if (!mounted) return;
        setMessage(RETURNING_MSGS[msgIndex]);
        setFollowUp(FOLLOWUP_MSGS[followIndex]);
        setReady(true);
      });
    } else {
      setReady(true);
    }
    return () => {
      mounted = false;
    };
  }, [variant]);

  useEffect(() => {
    if (!typing && !hold) return;
    setCursorOn(true);
    const interval = setInterval(() => {
      setCursorOn((on) => !on);
    }, 500);
    return () => {
      clearInterval(interval);
      setCursorOn(false);
    };
  }, [typing, hold]);

  useEffect(() => {
    if (!ready) return;
    const lines = variant === 'returning' ? [message, followUp] : [WELCOME_MSG];
    let lineIndex = 0;
    let length = 0;
    const tick = () => {
      const line = lines[lineIndex];
      if (length < line.length) {
        length += 1;
        setText(line.slice(0, length));
        setTyping(true);
        timers.current.push(setTimeout(tick, TYPE_MS));
      } else if (lineIndex < lines.length - 1) {
        setTyping(false);
        setHold(true);
        timers.current.push(
          setTimeout(() => {
            setHold(false);
            setText('');
            lineIndex += 1;
            length = 0;
            timers.current.push(setTimeout(tick, 200));
          }, FULL_HOLD_MS)
        );
      } else {
        setTyping(false);
        timers.current.push(
          setTimeout(() => {
            opacity.value = withTiming(0, {
              duration: 400,
              easing: Easing.out(Easing.cubic),
            });
          }, HOLD_MS)
        );
      }
    };
    timers.current.push(setTimeout(tick, 350));
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [message, followUp, variant, ready, opacity]);

  const bubbleStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: '100%',
        marginBottom: -14,
        alignSelf: 'center',
        alignItems: 'center',
      }}
    >
      <Animated.View style={[bubbleStyle, { alignItems: 'center' }]}>
        <View
          style={tw`max-w-[240px] items-center rounded-2xl border border-cyan-400/25 bg-[#0e1a2e]/90 px-3.5 py-2`}
        >
          <Text
            style={tw`text-center font-mono-medium text-xs leading-5 text-cyan-100`}
          >
            {text}
            {hold ? '...' : ''}
            {typing || hold ? (
              <Text style={{ color: cursorOn ? undefined : 'transparent' }}>
                |
              </Text>
            ) : null}
          </Text>
        </View>
        <View
          style={{
            width: 10,
            height: 10,
            marginTop: -5,
            backgroundColor: 'rgba(14, 26, 46, 0.9)',
            borderRightWidth: 1,
            borderBottomWidth: 1,
            borderColor: 'rgba(34,211,238,0.25)',
            transform: [{ rotate: '45deg' }],
          }}
        />
      </Animated.View>
    </Animated.View>
  );
}
