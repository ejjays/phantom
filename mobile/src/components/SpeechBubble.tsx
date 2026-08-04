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
import { nextSpeechMsgIndex } from '../lib/settings';

const WELCOME_MSG =
  'Hi, welcome I\u2019m Phantom, let\u2019s make some magic..';
const RETURNING_PAIRS: [string, string][] = [
  [
    'hey, it\u2019s me again. glad you\u2019re here',
    'got a link? let\u2019s grab it',
  ],
  ['hello, good to see you again', 'youtube, spotify, tiktok \u2014 your pick'],
  ['let\u2019s do some magic again?', 'same spell, new link. paste it'],
  [
    'it\u2019s me. who else would haunt a downloader?',
    'now. about that link..',
  ],
  [
    'you\u2019re back! the media is waiting for us',
    'are you ready for the show?',
  ],
  [
    'good timing. i was just polishing my spook',
    'so. where\u2019s the victim link?',
  ],
  [
    'the internet is loud. let\u2019s grab someone.. i mean. something',
    'paste it. let\u2019s make magic',
  ],
];

const TYPE_MS = 42;
const QUIP_TYPE_MS = 20;
const HOLD_MS = 6500;
const FULL_HOLD_MS = 2500;
const QUIP_HOLD_MS = 8000;

export default function SpeechBubble({
  variant,
  quip,
  onFade,
}: {
  variant: 'welcome' | 'returning';
  quip?: string;
  onFade?: () => void;
}) {
  const [message, setMessage] = useState(WELCOME_MSG);
  const [followUp, setFollowUp] = useState('');
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [hold, setHold] = useState(false);
  const [cursorOn, setCursorOn] = useState(false);
  const [ready, setReady] = useState(false);
  const opacity = useSharedValue(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFadeRef = useRef(onFade);

  useEffect(() => {
    onFadeRef.current = onFade;
  }, [onFade]);

  useEffect(() => {
    let mounted = true;
    if (variant === 'returning' && !quip) {
      setReady(false);
      void nextSpeechMsgIndex(RETURNING_PAIRS.length).then((index) => {
        if (!mounted) return;
        const [msg, follow] = RETURNING_PAIRS[index];
        setMessage(msg);
        setFollowUp(follow);
        setReady(true);
      });
    } else {
      setReady(true);
    }
    return () => {
      mounted = false;
    };
  }, [variant, quip]);

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
    opacity.value = 1;
    setHold(false);
    setTyping(false);
    const lines = quip
      ? [quip]
      : variant === 'returning'
        ? [message, followUp]
        : [WELCOME_MSG];
    const typeMs = quip ? QUIP_TYPE_MS : TYPE_MS;
    const holdMs = quip ? QUIP_HOLD_MS : HOLD_MS;
    let lineIndex = 0;
    let length = 0;
    let chars = Array.from(lines[0]);
    const tick = () => {
      if (length < chars.length) {
        length += 1;
        setText(chars.slice(0, length).join(''));
        setTyping(true);
        timer.current = setTimeout(tick, typeMs);
      } else if (lineIndex < lines.length - 1) {
        setTyping(false);
        setHold(true);
        timer.current = setTimeout(() => {
          setHold(false);
          setText('');
          lineIndex += 1;
          length = 0;
          chars = Array.from(lines[lineIndex]);
          timer.current = setTimeout(tick, 200);
        }, FULL_HOLD_MS);
      } else {
        setTyping(false);
        timer.current = setTimeout(() => {
          opacity.value = withTiming(0, {
            duration: 400,
            easing: Easing.out(Easing.cubic),
          });
          timer.current = setTimeout(() => {
            onFadeRef.current?.();
          }, 400);
        }, holdMs);
      }
    };
    timer.current = setTimeout(tick, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, followUp, variant, ready, quip]);

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
