import { Pressable, Text } from 'react-native';
import LottieView from 'lottie-react-native';
import tw from '../../lib/tw';
import VisualSheet from './VisualSheet';
import cat404 from '../../../assets/cat404.json';
import { tapImpact, tapSelection } from '../../lib/haptics';

const buttonGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

type Props = {
  open: boolean;
  onClose: () => void;
  message: string;
  onRetry: () => void;
  canRetry: boolean;
};

export default function ErrorSheet({
  open,
  onClose,
  message,
  onRetry,
  canRetry,
}: Props) {
  // retryable -> glow the retry; permanent -> glow dismiss, retry below
  const primary = canRetry
    ? { label: 'Try again', onPress: onRetry }
    : { label: 'Dismiss', onPress: onClose };
  const secondary = canRetry
    ? { label: 'Dismiss', onPress: onClose }
    : { label: 'Try again', onPress: onRetry };
  return (
    <VisualSheet
      visible={open}
      onClose={onClose}
      visual={
        <LottieView source={cat404} autoPlay loop style={tw`h-full w-full`} />
      }
      heightRatio={0.6}
      overlayContent={false}
      imageScale={0.62}
      stars
    >
      <Text
        style={tw`text-center text-[28px] leading-9 font-sans-bold text-white`}
      >
        Something went wrong
      </Text>
      <Text
        selectable
        style={tw`mt-2 text-center text-[15px] leading-6 font-sans text-slate-300`}
      >
        {message}
      </Text>

      <Pressable
        onPress={() => {
          tapImpact();
          primary.onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={primary.label}
        style={({ pressed }) => [
          tw`mt-5 w-full items-center justify-center rounded-full border border-primary/40 py-4`,
          { backgroundColor: '#22d3ee40' },
          buttonGlow,
          pressed && tw`opacity-90`,
        ]}
      >
        <Text
          style={[tw`text-[17px] font-sans-semibold`, { color: '#22d3ee' }]}
        >
          {primary.label}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          tapSelection();
          secondary.onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={secondary.label}
        style={({ pressed }) => [
          tw`mt-1 w-full items-center justify-center py-4`,
          pressed && tw`opacity-60`,
        ]}
      >
        <Text style={tw`text-[16px] font-sans-medium text-white/70`}>
          {secondary.label}
        </Text>
      </Pressable>
    </VisualSheet>
  );
}
