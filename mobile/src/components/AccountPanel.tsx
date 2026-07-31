import { useEffect } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Lock, Pencil } from 'lucide-react-native';
import tw from '../lib/tw';
import Card from './Card';
import Avatar from './Avatar';
import KeyboardAvoidingForm from './KeyboardAvoidingForm';
import { GoogleIcon } from './icons';
import {
  validateUsername,
  displayName,
  type Account,
} from '../lib/social/updates';

const buttonGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

export function AccountSkeleton() {
  const pulse = useSharedValue(0.4);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.9, { duration: 1000 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Card>
      <Animated.View style={[tw`flex-row items-center p-4`, pulseStyle]}>
        <View
          style={[tw`bg-white/10`, { width: 52, height: 52, borderRadius: 26 }]}
        />
        <View style={tw`ml-3.5 flex-1`}>
          <View style={tw`h-3.5 w-32 rounded-full bg-white/10`} />
          <View style={tw`mt-2.5 h-2.5 w-44 rounded-full bg-white/5`} />
        </View>
      </Animated.View>
    </Card>
  );
}

function AccountRow({
  label,
  value,
  onPress,
  last,
  locked,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  last?: boolean;
  locked?: boolean;
}) {
  const row = (
    <View
      style={[
        tw`flex-row items-center justify-between px-5 py-4`,
        last ? null : tw`border-b border-white/5`,
      ]}
    >
      <View style={tw`flex-row items-center`}>
        <Text style={tw`font-sans text-[14px] text-slate-400`}>{label}</Text>
        {locked ? (
          <View style={tw`ml-1.5`}>
            <Lock size={13} color="#64748b" strokeWidth={2.2} />
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={tw`ml-4 flex-1 text-right font-sans-medium text-[15px] text-white`}
      >
        {value}
      </Text>
    </View>
  );
  if (!onPress) return row;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.03)' }}
    >
      {row}
    </Pressable>
  );
}

export default function AccountPanel({
  account,
  nameValue,
  onChangeName,
  onSave,
  saving,
  error,
  onBack,
  onSignOut,
  onEditAvatar,
  onLinkGoogle,
}: {
  account: Account | null;
  nameValue: string;
  onChangeName: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSignOut: () => void;
  onEditAvatar: () => void;
  onLinkGoogle?: () => void;
}) {
  const changed = nameValue.trim() !== (account?.username ?? '');
  const canSave = changed && validateUsername(nameValue).ok && !saving;
  return (
    <KeyboardAvoidingForm contentContainerStyle={tw`px-5 pb-36 pt-14`}>
      <View style={[tw`w-full self-center`, { maxWidth: 600 }]}>
        <View style={tw`h-10 flex-row items-center justify-center`}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={tw`absolute left-0 h-10 w-10 items-center justify-center rounded-full bg-white/10`}
          >
            <ChevronLeft size={22} color="#e2e8f0" strokeWidth={2.2} />
          </Pressable>
          <Text style={tw`font-sans-semibold text-[18px] text-white`}>
            Account
          </Text>
        </View>

        <View style={tw`mt-8 items-center`}>
          <Pressable onPress={onEditAvatar} hitSlop={8}>
            <Avatar
              name={displayName(account?.username ?? account?.name ?? 'G')}
              uri={account?.avatarUrl}
              size={112}
            />
            <View
              style={tw`absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-[3px] border-background bg-primary`}
            >
              <Pencil size={15} color="#04101f" strokeWidth={2.5} />
            </View>
          </Pressable>
        </View>

        <View style={tw`mt-9 overflow-hidden rounded-3xl bg-white/5`}>
          <AccountRow label="Name" value={account?.name ?? '—'} locked />
          <AccountRow label="Email" value={account?.email ?? '—'} locked />
          <View style={tw`flex-row items-center justify-between px-5 py-4`}>
            <Text style={tw`font-sans text-[14px] text-slate-400`}>
              Username
            </Text>
            <TextInput
              value={nameValue}
              onChangeText={onChangeName}
              onSubmitEditing={() => {
                if (canSave) onSave();
              }}
              placeholder="username"
              placeholderTextColor="#5b6472"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              selectionColor="#22d3ee"
              textAlign="right"
              style={tw`ml-4 flex-1 py-0 font-sans-medium text-[15px] text-white`}
            />
          </View>
        </View>
        {error ? (
          <Text style={tw`ml-1 mt-2 font-sans text-[12px] text-red-400`}>
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={!canSave}
          style={({ pressed }) => [
            tw`mt-7`,
            pressed && canSave ? { transform: [{ scale: 0.98 }] } : null,
          ]}
        >
          <LinearGradient
            colors={canSave ? ['#22d3ee', '#06b6d4'] : ['#1e293b', '#1e293b']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              tw`items-center rounded-full py-4`,
              canSave ? buttonGlow : null,
            ]}
          >
            <Text
              style={[
                tw`font-sans-bold text-[16px]`,
                { color: canSave ? '#04101f' : '#64748b' },
              ]}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Text>
          </LinearGradient>
        </Pressable>

        {account?.isGuest && onLinkGoogle ? (
          <Pressable
            onPress={onLinkGoogle}
            style={({ pressed }) => [
              tw`mt-3 flex-row items-center justify-center rounded-full border border-white/15 bg-white/5 py-4`,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            <GoogleIcon size={18} />
            <Text style={tw`ml-3 font-sans-semibold text-[16px] text-white`}>
              Link with Google
            </Text>
          </Pressable>
        ) : null}

        {account?.isGuest ? (
          <Text
            style={tw`mt-4 text-center font-sans text-[12px] leading-4 text-slate-500`}
          >
            To prevent abuse, anonymous accounts can&apos;t be signed back into
            — link Google to keep your comments and reactions.
          </Text>
        ) : (
          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => [
              tw`mt-3 items-center rounded-full border border-white/10 bg-white/5 py-4`,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            <Text style={tw`font-sans-semibold text-[16px] text-red-400`}>
              Log out
            </Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingForm>
  );
}
