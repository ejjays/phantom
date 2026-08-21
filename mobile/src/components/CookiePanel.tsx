import { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ClipboardPaste, Trash2 } from 'lucide-react-native';
import tw from '../lib/tw';
import KeyboardAvoidingForm from './KeyboardAvoidingForm';
import type { CookieCheckResult } from '../lib/cookieCheck';

const buttonGlow = {
  shadowColor: '#06b6d4',
  shadowOpacity: 0.5,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 0 },
  elevation: 10,
};

export default function CookiePanel({
  title,
  value,
  onChangeValue,
  onSave,
  saving,
  onClear,
  onCheck,
  onBack,
}: {
  title: string;
  value: string;
  onChangeValue: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  onClear: () => void;
  onCheck: (
    cookie: string
  ) => CookieCheckResult | Promise<CookieCheckResult>;
  onBack: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CookieCheckResult | null>(
    null
  );
  const canSave = value.trim().length > 0 && !saving;

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setCheckResult(null);
    const result = await onCheck(value.trim());
    setCheckResult(result);
    setChecking(false);
  };

  const save = () => {
    if (value.includes(';') && !/=/.test(value.split(';')[0])) {
      setError('That does not look like a cookie header — paste the full "name=value; …" string.');
      return;
    }
    setError(null);
    onSave();
  };

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
            {title}
          </Text>
        </View>

        <View style={tw`mt-8 overflow-hidden rounded-3xl bg-white/5`}>
          <View style={tw`flex-row items-center justify-between px-5 py-4`}>
            <Text style={tw`font-sans text-[14px] text-slate-400`}>Cookie</Text>
            <Pressable
              onPress={() => onChangeValue('')}
              hitSlop={8}
              style={tw`flex-row items-center`}
            >
              <ClipboardPaste size={13} color="#64748b" strokeWidth={2.2} />
              <Text style={tw`ml-1 font-sans text-[12px] text-slate-500`}>
                Clear
              </Text>
            </Pressable>
          </View>
          <TextInput
            value={value}
            onChangeText={(next) => {
              setCheckResult(null);
              onChangeValue(next);
            }}
            placeholder="Paste your cookie here…"
            placeholderTextColor="#5b6472"
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor="#22d3ee"
            style={[
              tw`h-[140px] px-5 pb-5 font-sans text-[13px] leading-5 text-white`,
              { textAlignVertical: 'top' },
            ]}
          />
        </View>

        {value.trim().length > 0 ? (
          <Pressable
            onPress={() => void check()}
            disabled={checking}
            style={({ pressed }) => [
              tw`mt-3 flex-row items-center justify-center rounded-full border border-white/15 bg-white/5 py-3.5`,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            {checking ? (
              <ActivityIndicator size="small" color="#22d3ee" />
            ) : (
              <Text style={tw`font-sans-semibold text-[15px] text-white`}>
                Check cookie
              </Text>
            )}
          </Pressable>
        ) : null}

        {checkResult ? (
          <Text
            style={[
              tw`ml-1 mt-2 font-sans text-[12px]`,
              checkResult.status === 'valid'
                ? tw`text-green-400`
                : checkResult.status === 'unreachable' ||
                    checkResult.status === 'unverified'
                  ? tw`text-amber-400`
                  : tw`text-red-400`,
            ]}
          >
            {checkResult.detail}
          </Text>
        ) : null}

        {error ? (
          <Text style={tw`ml-1 mt-2 font-sans text-[12px] text-red-400`}>
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={save}
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
              {saving ? 'Saving…' : 'Save cookie'}
            </Text>
          </LinearGradient>
        </Pressable>

        {value.length > 0 ? (
          <Pressable
            onPress={onClear}
            style={({ pressed }) => [
              tw`mt-3 flex-row items-center justify-center rounded-full border border-white/10 bg-white/5 py-4`,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
            ]}
          >
            <Trash2 size={16} color="#f87171" strokeWidth={2.2} />
            <Text style={tw`ml-2 font-sans-semibold text-[16px] text-red-400`}>
              Remove cookie
            </Text>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingForm>
  );
}