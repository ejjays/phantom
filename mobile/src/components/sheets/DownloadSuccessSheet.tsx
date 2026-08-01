import { Pressable, Text } from 'react-native';
import LottieView from 'lottie-react-native';
import tw from '../../lib/tw';
import VisualSheet from './VisualSheet';
import success from '../../../assets/success.json';
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
  isAudio: boolean;
  onOpen: () => void;
};

export default function DownloadSuccessSheet({
  open,
  onClose,
  isAudio,
  onOpen,
}: Props) {
  const dest = isAudio ? 'Music/Phantom' : 'Movies/Phantom';
  const actionLabel = isAudio ? 'Open music' : 'Open gallery';
  return (
    <VisualSheet
      visible={open}
      onClose={onClose}
      heightRatio={0.6}
      overlayContent={false}
      imageScale={0.52}
      stars
      visual={
        <LottieView
          source={success}
          style={{ width: '100%', height: '100%' }}
          autoPlay
          loop={false}
        />
      }
    >
      <Text
        style={tw`text-center text-[28px] leading-9 font-sans-bold text-white`}
      >
        Download complete!
      </Text>
      <Text
        style={tw`mt-2 text-center text-[15px] leading-6 font-sans text-slate-300`}
      >
        Saved to {dest} — tap below to open.
      </Text>

      <Pressable
        onPress={() => {
          tapImpact();
          onOpen();
        }}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
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
          {actionLabel}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          tapSelection();
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel="Done"
        style={({ pressed }) => [
          tw`mt-1 w-full items-center justify-center py-4`,
          pressed && tw`opacity-60`,
        ]}
      >
        <Text style={tw`text-[16px] font-sans-medium text-white/70`}>Done</Text>
      </Pressable>
    </VisualSheet>
  );
}
