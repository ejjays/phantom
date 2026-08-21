import { ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import tw from '../lib/tw';
import { AutoIcon, MusicIcon, PasteIcon } from './FormatIcons';

export type DownloadMode = 'auto' | 'audio';

type ButtonProps = {
  active?: boolean;
  label: string;
  icon: ReactNode;
  onPress: () => void;
};

function PillButton({ active, label, icon, onPress }: ButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={tw`relative flex-1 items-center justify-center py-2.5`}
    >
      {active ? (
        <LinearGradient
          colors={['#7c3aed', '#4f46e5'] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={tw`absolute inset-0`}
        />
      ) : null}
      <View style={tw`flex-row items-center`}>
        {icon}
        <Text
          style={tw.style(
            'ml-1.5 font-mono-bold text-sm',
            active ? 'text-white' : 'text-black'
          )}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

type Props = {
  mode: DownloadMode;
  setMode: (mode: DownloadMode) => void;
  onPaste: () => void;
};

export default function FormatBar({ mode, setMode, onPaste }: Props) {
  return (
    <View
      style={[
        tw`mt-3 w-full flex-row overflow-hidden rounded-2xl border border-cyan-400/50 bg-cyan-500`,
        {
          shadowColor: '#06b6d4',
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        },
      ]}
    >
      <PillButton
        active={mode === 'auto'}
        label="Auto"
        icon={<AutoIcon size={26} />}
        onPress={() => setMode('auto')}
      />
      <View style={tw`w-px bg-white/30`} />
      <PillButton
        active={mode === 'audio'}
        label="Audio"
        icon={<MusicIcon size={22} />}
        onPress={() => setMode('audio')}
      />
      <View style={tw`w-px bg-white/30`} />
      <PillButton
        label="Paste"
        icon={<PasteIcon size={22} />}
        onPress={onPaste}
      />
    </View>
  );
}
