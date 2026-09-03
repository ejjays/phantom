import { ActivityIndicator, Pressable, Text } from 'react-native';
import tw from '../lib/tw';

const glow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

export default function CyanButton({
  label,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}) {
  const isDisabled = Boolean(disabled || loading);
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        tw`w-full items-center justify-center rounded-full border py-4`,
        isDisabled ? tw`border-white/10` : tw`border-primary/40`,
        { backgroundColor: isDisabled ? '#1e293b' : '#22d3ee40' },
        !isDisabled ? glow : null,
        pressed && !isDisabled ? tw`opacity-90` : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#22d3ee" />
      ) : (
        <Text
          style={[
            tw`text-[17px] font-sans-semibold`,
            { color: isDisabled ? '#64748b' : '#22d3ee' },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
