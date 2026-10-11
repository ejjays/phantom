import { useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Check } from 'lucide-react-native';
import tw from '../../lib/tw';

type EditFormProps = {
  title: string;
  author: string;
  setTitle: (value: string) => void;
  setAuthor: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onFocusField: (bottomY: number) => void;
};

const FieldLabel = ({ label }: { label: string }) => (
  <Text
    style={tw`ml-1 font-mono-bold text-[10px] uppercase tracking-wider text-primary`}
  >
    {label}
  </Text>
);

export default function EditForm({
  title,
  author,
  setTitle,
  setAuthor,
  onCancel,
  onSave,
  onFocusField,
}: EditFormProps) {
  const titleRef = useRef<TextInput>(null);
  const authorRef = useRef<TextInput>(null);
  return (
    <View>
      <FieldLabel label="Title" />
      <TextInput
        ref={titleRef}
        onFocus={() =>
          titleRef.current?.measureInWindow((_x, y, _w, height) =>
            onFocusField(y + height)
          )
        }
        value={title}
        onChangeText={setTitle}
        placeholder="Enter title"
        placeholderTextColor="#5b6472"
        style={[
          tw`mt-1 rounded-xl border border-white/10 bg-black/20 px-4 font-mono text-sm text-white`,
          { height: 48, textAlignVertical: 'center' },
        ]}
      />
      <View style={tw`mt-3`}>
        <FieldLabel label="Author" />
        <TextInput
          ref={authorRef}
          onFocus={() =>
            authorRef.current?.measureInWindow((_x, y, _w, height) =>
              onFocusField(y + height)
            )
          }
          value={author}
          onChangeText={setAuthor}
          placeholder="Enter author"
          placeholderTextColor="#5b6472"
          style={[
            tw`mt-1 rounded-xl border border-white/10 bg-black/20 px-4 font-mono text-sm text-white`,
            { height: 48, textAlignVertical: 'center' },
          ]}
        />
      </View>
      <View style={tw`mt-5 flex-row justify-between`}>
        <TouchableOpacity
          onPress={onCancel}
          style={tw`mr-1.5 flex-1 items-center rounded-xl border border-white/10 py-3`}
        >
          <Text style={tw`font-mono-medium text-sm text-slate-400`}>
            Cancel
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSave}
          style={tw`ml-1.5 flex-1 flex-row items-center justify-center rounded-xl bg-primary py-3`}
        >
          <Check size={16} color="#030014" strokeWidth={4} />
          <Text style={tw`ml-1 font-mono-bold text-sm text-background`}>
            Save
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
