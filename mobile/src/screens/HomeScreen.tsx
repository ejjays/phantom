import { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  RefreshControl,
  ScrollView,
  AppState,
  Keyboard,
  BackHandler,
} from 'react-native';
import {
  AlertDialog,
  Host,
  Text as ComposeText,
  TextButton as ComposeTextButton,
} from '@expo/ui/jetpack-compose';
import { useBackHandler } from '../lib/back';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import tw from '../lib/tw';
import { useScreenSize } from '../hooks/useScreenSize';
import PhantomHero, { PHANTOM_ASPECT } from '../components/PhantomHero';
import SpeechBubble from '../components/SpeechBubble';
import LinkPing from '../components/LinkPing';
import Button3D from '../components/Button3D';
import FormatBar, { type DownloadMode } from '../components/FormatBar';
import { useBlurOnKeyboardHide } from '../hooks/useKeyboard';
import {
  nextQuipIndex,
  nextIdleIndex,
  nextBadLinkIndex,
  nextSuccessIndex,
} from '../lib/settings';
import { idleTick } from '../lib/idle.logic';

const QUIP_COOLDOWN_MS = 8000;
const IDLE_CHECK_MS = 1000;

const PHANTOM_QUIPS = [
  'boo! ...just kidding, it\u2019s me',
  'got a link? i\u2019m hungry',
  'i dream in mp3 shuffles',
  'youtube? spotify? surprise me',
  'i\u2019d cross the internet for you',
  'boop. i felt that',
  'no link? we can still vibe',
  'i\u2019ve seen so many urls. yours are my favorite',
  'my magic is free \u2014 links aren\u2019t',
  'you returned! i was about to haunt this screen solo',
  'rawr,.. i mean.. boo',
  'you can see me but i can\u2019t see you.. are you a ghost too?',
];

const PHANTOM_IDLE_LINES = [
  'no rush. the magic can wait',
  'just chilling... whenever you\u2019re ready',
  'staring at me? should i strike a pose?',
  'waiting mode: activated',
  'sometimes i haunt, mostly i download',
  'do ghosts get lonely? ...yes',
  'i almost counted all the pixels in your screen',
  'I\u2019ll just be here, floating',
  'i once downloaded a video twice. it was that good',
  'silence is my favorite playlist',
  'i\u2019ve memorized every icon on this screen',
  'stare all you want. i\u2019m used to being watched (ghost problems)',
];

const PHANTOM_BAD_LINK_LINES = [
  'hmm, that doesn\u2019t look like a link to me..',
  'that\u2019s not a link.. try pasting one?',
  'did you mean to paste something else?',
  'i can\u2019t read that. is it a url?',
  'oops \u2014 that\u2019s not a valid link',
  'i need a link, not just words. try again?',
  'that link looks broken to me..',
  'no magic can happen without a real link',
];

const PHANTOM_SUCCESS_LINES = [
  'got it! saved to your device. i did a little ghost dance',
  'caught it! it\u2019s all yours now',
  'done! the magic worked.. again',
  'saved! that one\u2019s worth keeping',
  'download complete. my spook level: expert',
  'it\u2019s yours now. handle with care',
  'saved safely. my ghost duties: complete',
];

function looksLikeLink(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const host = trimmed
    .replace(/^https?:\/\//iu, '')
    .split(/[/?#]/u)[0]
    .toLowerCase();
  return host.includes('.');
}

type Props = {
  link: string;
  onChangeLink: (text: string) => void;
  loading: boolean;
  mode: DownloadMode;
  setMode: (mode: DownloadMode) => void;
  onResolve: () => void;
  onPaste: () => void;
  onInputFocus: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  resetSignal: number;
  focusSignal: number;
  firstVisit: boolean;
  bubbleTrigger: number;
  pickerOpen: boolean;
  active: boolean;
  muted: boolean;
  invalidLink: boolean;
  successSignal: number;
};

export default function HomeScreen({
  link,
  onChangeLink,
  loading,
  mode,
  setMode,
  onResolve,
  onPaste,
  onInputFocus,
  refreshing,
  onRefresh,
  resetSignal,
  focusSignal,
  firstVisit,
  bubbleTrigger,
  pickerOpen,
  active,
  muted,
  invalidLink,
  successSignal,
}: Props) {
  const linkInputRef = useRef<TextInput>(null);
  useBlurOnKeyboardHide(linkInputRef);
  const { width: screenW, height: screenH } = useScreenSize();
  const insets = useSafeAreaInsets();
  const kb = useSharedValue(0);
  const inputBottom = useSharedValue(0);
  const moonX = useSharedValue(0);
  const [showSpinner, setShowSpinner] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [gazeTick, setGazeTick] = useState(0);
  const [quip, setQuip] = useState<string | null>(null);
  const [idleMsg, setIdleMsg] = useState<string | null>(null);
  const [appActive, setAppActive] = useState(
    AppState.currentState === 'active'
  );

  const lastActivity = useRef(Date.now());
  const bumpActivity = () => {
    lastActivity.current = Date.now();
  };

  const quipSeq = useRef(0);
  const idleSeq = useRef(0);
  const badLinkSeq = useRef(0);
  const successSeq = useRef(0);
  const quipVisible = useRef(false);
  const idleVisible = useRef(false);
  const badLinkVisible = useRef(false);
  const successVisible = useRef(false);
  const lastQuipAt = useRef(0);
  const lastIdleAt = useRef(0);
  const lastIdleStart = useRef(0);
  const badLinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBadLinkAt = useRef(0);
  const [badLinkMsg, setBadLinkMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [flagVisible, setFlagVisible] = useState(false);
  const [greetDone, setGreetDone] = useState(false);

  const flagWasShowing = useRef(false);
  const flagVisibleRef = useRef(false);
  useEffect(() => {
    flagVisibleRef.current = flagVisible;
  }, [flagVisible]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state === 'active') {
        bumpActivity();
        if (flagWasShowing.current) setFlagVisible(true);
      } else if (state === 'background') {
        flagWasShowing.current = flagVisibleRef.current;
        if (flagVisibleRef.current) setFlagVisible(false);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- resets bubble on new trigger
    setGreetDone(false);
  }, [bubbleTrigger]);

  const handleQuip = () => {
    bumpActivity();
    if (muted) return;
    if (quipVisible.current) return;
    if (Date.now() - lastQuipAt.current < QUIP_COOLDOWN_MS) return;
    quipVisible.current = true;
    idleVisible.current = false;
    badLinkVisible.current = false;
    successVisible.current = false;
    setIdleMsg(null);
    setBadLinkMsg(null);
    setSuccessMsg(null);
    setGreetDone(true);
    void nextQuipIndex(PHANTOM_QUIPS.length).then((index) => {
      quipSeq.current += 1;
      setQuip(PHANTOM_QUIPS[index]);
    });
  };

  const warnBadLink = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || looksLikeLink(trimmed)) return;
    if (muted) return;
    if (badLinkVisible.current) return;
    if (Date.now() - lastBadLinkAt.current < QUIP_COOLDOWN_MS) return;
    badLinkVisible.current = true;
    idleVisible.current = false;
    setIdleMsg(null);
    void nextBadLinkIndex(PHANTOM_BAD_LINK_LINES.length).then((index) => {
      badLinkSeq.current += 1;
      setBadLinkMsg(PHANTOM_BAD_LINK_LINES[index]);
    });
  };

  useEffect(() => {
    return () => {
      if (badLinkTimer.current) clearTimeout(badLinkTimer.current);
    };
  }, []);

  useEffect(() => {
    if (badLinkTimer.current) clearTimeout(badLinkTimer.current);
    badLinkTimer.current = setTimeout(() => warnBadLink(link), 600);
    return () => {
      if (badLinkTimer.current) clearTimeout(badLinkTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warnBadLink recreated each render, would reset debounce timer
  }, [link]);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- warning cleared post-debounce
    if (!badLinkMsg) return;
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- link validity checked post-debounce
    if (!link.trim() || looksLikeLink(link)) {
      badLinkVisible.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- clears warning once link becomes valid
      setBadLinkMsg(null);
    }
  }, [link, badLinkMsg]);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- parent success signal, one-shot
    if (successSignal === 0) return;
    bumpActivity();
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- raises flag on success signal
    setFlagVisible(true);
    if (successVisible.current) return;
    successVisible.current = true;
    idleVisible.current = false;
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- clears speech for success banner
    setIdleMsg(null);
    badLinkVisible.current = false;
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- clears warning for success banner
    setBadLinkMsg(null);
    void nextSuccessIndex(PHANTOM_SUCCESS_LINES.length).then((index) => {
      successSeq.current += 1;
      setSuccessMsg(PHANTOM_SUCCESS_LINES[index]);
    });
  }, [successSignal]);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- keyboard focus edge, ref-gated
    if (inputFocused) {
      quipVisible.current = false;
      idleVisible.current = false;
    }
  }, [inputFocused]);

  useEffect(() => {
    if (!active || !appActive || inputFocused || loading || muted) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const bubbleUp =
        quipVisible.current ||
        badLinkVisible.current ||
        successVisible.current ||
        idleVisible.current ||
        (!greetDone && bubbleTrigger > 0);
      const decision = idleTick({
        now,
        lastActivity: lastActivity.current,
        lastIdleAt: lastIdleAt.current,
        lastIdleStart: lastIdleStart.current,
        bubbleUp,
      });
      if (decision === 'pause') {
        lastActivity.current = now;
        return;
      }
      if (decision === 'wait') return;
      idleVisible.current = true;
      lastIdleStart.current = now;
      void nextIdleIndex(PHANTOM_IDLE_LINES.length).then((index) => {
        idleSeq.current += 1;
        setIdleMsg(PHANTOM_IDLE_LINES[index]);
      });
    }, IDLE_CHECK_MS);
    return () => clearInterval(interval);
  }, [
    active,
    appActive,
    inputFocused,
    loading,
    greetDone,
    muted,
    bubbleTrigger,
  ]);

  useEffect(() => {
    bumpActivity();
    quipVisible.current = false;
    idleVisible.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- clears speech when muted toggles
    setIdleMsg(null);
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- clears quip when muted toggles
    setQuip(null);
  }, [muted]);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- focus signal drives reanimated moon wipe
    if (focusSignal === 0) return;
    moonX.value = withSequence(
      withTiming(-260, { duration: 0 }),
      withTiming(0, { duration: 1100, easing: Easing.out(Easing.cubic) })
    );
  }, [focusSignal, moonX]);

  useGenericKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        kb.value = event.height;
      },
      onEnd: (event) => {
        'worklet';
        kb.value = event.height;
      },
    },
    []
  );

  const liftStyle = useAnimatedStyle(() => {
    const keyboardTop = screenH - kb.value;
    const overlap = inputBottom.value + insets.bottom + 16 - keyboardTop;
    return { transform: [{ translateY: -Math.max(0, overlap) }] };
  });

  const moonStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moonX.value }],
  }));

  const baseIconSize = Math.min(228, Math.max(209, screenW * 0.266));

  const ghostStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, kb.value / 400);
    return {
      transform: [{ scale: 1 - progress * 0.05 }],
    };
  });

  const triggerDownload = () => {
    setShowSpinner(true);

    onResolve();
  };

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- spinner 2s dwell after resolve ends
    if (!loading) {
      const timer = setTimeout(() => {
        setShowSpinner(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- parent reset signal, one-shot
    if (resetSignal === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-you-might-not-need-an-effect/no-adjust-state-on-prop-change -- reset signal cancels spinner
    setShowSpinner(false);
  }, [resetSignal]);

  const handleFocus = () => {
    onInputFocus();
    linkInputRef.current?.measureInWindow((_left, top, _width, height) => {
      inputBottom.value = top + height;
    });
  };

  useBackHandler(() => {
    if (!active) return false;
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return true;
    }
    setExitOpen(true);
    return true;
  }, 0);

  return (
    <View style={tw`flex-1`}>
      <Animated.View
        pointerEvents="none"
        style={[
          moonStyle,
          {
            position: 'absolute',
            top: 8,
            left: 8,
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: '#f9f9fb',
            boxShadow:
              '0px 0px 50px 0px rgba(193, 119, 241, 0.85), 0px 0px 50px 0px rgba(135, 42, 211, 0.85), inset 0px 0px 26px -10px #9b40fc',
          },
        ]}
      />
      <ScrollView
        style={tw`flex-1`}
        contentContainerStyle={tw`grow px-6 pb-16`}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onTouchStart={() => {
          bumpActivity();
          setFlagVisible(false);
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              bumpActivity();
              setFlagVisible(false);
              void onRefresh();
            }}
            tintColor="#22d3ee"
            colors={['#22d3ee']}
            progressBackgroundColor="#17324c"
            progressViewOffset={16}
          />
        }
      >
        <Animated.View
          style={[tw`flex-1 items-center justify-center`, liftStyle]}
        >
          <View style={tw`w-full max-w-md`}>
            <View style={tw`items-center ${inputFocused ? 'mb-0' : 'mb-2'}`}>
              <View style={{ position: 'relative' }}>
                {quip && !pickerOpen ? (
                  <SpeechBubble
                    key={`quip-${quip}`}
                    variant="welcome"
                    quip={quip}
                    visible={!inputFocused}
                    onFade={() => {
                      quipVisible.current = false;
                      lastQuipAt.current = Date.now();
                      setQuip(null);
                    }}
                  />
                ) : badLinkMsg && !pickerOpen ? (
                  <SpeechBubble
                    key={`badlink-${badLinkMsg}`}
                    variant="welcome"
                    quip={badLinkMsg}
                    visible={!inputFocused}
                    onFade={() => {
                      badLinkVisible.current = false;
                      lastBadLinkAt.current = Date.now();
                      setBadLinkMsg(null);
                    }}
                  />
                ) : successMsg && !pickerOpen ? (
                  <SpeechBubble
                    key={`success-${successMsg}`}
                    variant="welcome"
                    quip={successMsg}
                    visible={!inputFocused}
                    onFade={() => {
                      successVisible.current = false;
                      setSuccessMsg(null);
                    }}
                  />
                ) : !greetDone && bubbleTrigger > 0 && !pickerOpen ? (
                  <SpeechBubble
                    key={`greet-${bubbleTrigger}`}
                    variant={firstVisit ? 'welcome' : 'returning'}
                    visible={!inputFocused}
                    onFade={() => setGreetDone(true)}
                  />
                ) : idleMsg && !pickerOpen ? (
                  <SpeechBubble
                    key={`idle-${idleMsg}`}
                    variant="welcome"
                    quip={idleMsg}
                    visible={!inputFocused}
                    onFade={() => {
                      idleVisible.current = false;
                      lastIdleAt.current = Date.now();
                      lastIdleStart.current = Date.now();
                      setIdleMsg(null);
                    }}
                  />
                ) : null}
                <Animated.View
                  style={[
                    {
                      width: baseIconSize,
                      height: baseIconSize * PHANTOM_ASPECT,
                      transformOrigin: 'bottom center',
                    },
                    ghostStyle,
                  ]}
                >
                  <PhantomHero
                    amazeSignal={0}
                    focusSignal={gazeTick}
                    flagVisible={flagVisible}
                    onQuip={handleQuip}
                  />
                </Animated.View>
              </View>
            </View>

            <View style={tw`relative justify-center`}>
              <View style={tw`absolute left-4 z-10`}>
                <LinkPing />
              </View>
              <TextInput
                ref={linkInputRef}
                style={[
                  tw`rounded-2xl border-2 border-primary bg-black/30 pl-12 pr-4 font-mono text-[15px] text-white`,
                  { height: 52, textAlignVertical: 'center' },
                ]}
                placeholder="paste your link here"
                placeholderTextColor="#5b6472"
                value={link}
                onChangeText={(text) => {
                  bumpActivity();
                  onChangeLink(text);
                }}
                onFocus={() => {
                  bumpActivity();
                  setInputFocused(true);
                  if (!link.trim()) setGazeTick((count) => count + 1);
                  handleFocus();
                  warnBadLink(link);
                }}
                onBlur={() => {
                  bumpActivity();
                  setInputFocused(false);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Paste download link"
              />
            </View>

            <FormatBar mode={mode} setMode={setMode} onPaste={onPaste} />

            <Button3D
              label={invalidLink ? 'Retry' : 'Download'}
              retry={invalidLink}
              loading={showSpinner}
              testID="download-submit"
              onPress={() => {
                if (!link.trim()) return;
                bumpActivity();
                onResolve();
                triggerDownload();
              }}
            />
          </View>
        </Animated.View>
      </ScrollView>
      {exitOpen && (
        <Host matchContents>
          <AlertDialog
            onDismissRequest={() => setExitOpen(false)}
            colors={{
              containerColor: '#15152c',
              titleContentColor: '#e2e8f0',
              textContentColor: '#94a3b8',
            }}
          >
            <AlertDialog.Title>
              <ComposeText style={{ fontWeight: 'bold' }}>
                Exit Phantom?
              </ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>Are you sure you want to quit?</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <ComposeTextButton
                onClick={() => BackHandler.exitApp()}
                colors={{ contentColor: '#22d3ee' }}
              >
                <ComposeText style={{ fontWeight: 'bold' }}>Exit</ComposeText>
              </ComposeTextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <ComposeTextButton
                onClick={() => setExitOpen(false)}
                colors={{ contentColor: '#94a3b8' }}
              >
                <ComposeText style={{ fontWeight: 'bold' }}>Cancel</ComposeText>
              </ComposeTextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        </Host>
      )}
    </View>
  );
}
