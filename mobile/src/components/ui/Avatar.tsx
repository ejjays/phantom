import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import tw from '../../lib/tw';
import { presetSource } from '../../lib/social/avatars';

const AVATAR_COLORS = [
  '#22d3ee',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#fbbf24',
  '#60a5fa',
  '#fb7185',
  '#2dd4bf',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? '#22d3ee';
}

export default function Avatar({
  name,
  size,
  uri,
}: {
  name: string;
  size: number;
  uri?: string | null;
}) {
  const preset = presetSource(uri);
  if (preset != null) {
    return (
      <Image
        source={preset}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  const seed = name.trim().length > 0 ? name.trim() : '?';
  const initial = (seed.charAt(0) || '?').toUpperCase();
  const color = avatarColor(seed);
  return (
    <View
      style={[
        tw`items-center justify-center rounded-full`,
        { width: size, height: size, backgroundColor: `${color}26` },
      ]}
    >
      <Text style={[tw`font-sans-bold`, { color, fontSize: size * 0.42 }]}>
        {initial}
      </Text>
    </View>
  );
}
