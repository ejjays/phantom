import { Linking, type ViewStyle } from 'react-native';
import {
  EnrichedMarkdownText,
  type LinkPressEvent,
  type MarkdownStyle,
} from 'react-native-enriched-markdown';

const postMarkdownStyle: MarkdownStyle = {
  paragraph: {
    fontFamily: 'Rubik',
    fontSize: 15,
    lineHeight: 24,
    color: '#c9d2dd',
    marginBottom: 8,
  },
  h1: {
    fontFamily: 'Rubik-Bold',
    fontSize: 21,
    lineHeight: 28,
    color: '#ffffff',
    marginTop: 18,
    marginBottom: 6,
  },
  h2: {
    fontFamily: 'Rubik-Bold',
    fontSize: 18,
    lineHeight: 24,
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 6,
  },
  h3: {
    fontFamily: 'Rubik-SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: '#ffffff',
    marginTop: 14,
    marginBottom: 4,
  },
  h4: {
    fontFamily: 'Rubik-SemiBold',
    fontSize: 15,
    lineHeight: 21,
    color: '#ffffff',
    marginTop: 12,
    marginBottom: 4,
  },
  h5: {
    fontFamily: 'Rubik-SemiBold',
    fontSize: 14,
    lineHeight: 20,
    color: '#ffffff',
    marginTop: 10,
    marginBottom: 4,
  },
  h6: {
    fontFamily: 'Rubik-SemiBold',
    fontSize: 13,
    lineHeight: 19,
    color: '#ffffff',
    marginTop: 8,
    marginBottom: 4,
  },
  strong: { fontFamily: 'Rubik-Bold' },
  em: { fontFamily: 'Rubik', fontStyle: 'italic' },
  link: { color: '#22d3ee', underline: true },
  code: {
    fontFamily: 'IBMPlexMono',
    fontSize: 13,
    color: '#7dd3fc',
    backgroundColor: '#16203a',
  },
  codeBlock: {
    fontFamily: 'IBMPlexMono',
    fontSize: 13,
    lineHeight: 19,
    color: '#d7dce3',
    backgroundColor: '#16203a',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  blockquote: {
    fontFamily: 'Rubik',
    color: '#aab3c0',
    borderColor: 'rgba(34,211,238,0.45)',
    borderWidth: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(34,211,238,0.06)',
    padding: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  list: {
    bulletColor: '#22d3ee',
    markerColor: '#22d3ee',
    gapWidth: 8,
    marginLeft: 2,
    itemSpacing: 4,
    marginBottom: 8,
  },
  table: {
    fontFamily: 'Rubik',
    fontSize: 13.5,
    lineHeight: 19,
    color: '#c9d2dd',
    headerFontFamily: 'Rubik-SemiBold',
    headerTextColor: '#ffffff',
    headerBackgroundColor: 'rgba(255,255,255,0.06)',
    rowEvenBackgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderRadius: 8,
    cellPaddingHorizontal: 10,
    cellPaddingVertical: 8,
    align: 'left',
    marginTop: 4,
    marginBottom: 8,
  },
  taskList: {
    checkedColor: '#22d3ee',
    borderColor: 'rgba(255,255,255,0.3)',
    checkmarkColor: '#030014',
  },
  thematicBreak: {
    color: 'rgba(255,255,255,0.15)',
    height: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  image: { borderRadius: 12, marginTop: 8, marginBottom: 8 },
};

export default function PostMarkdown({
  text,
  style,
}: {
  text: string;
  style?: ViewStyle;
}) {
  return (
    <EnrichedMarkdownText
      markdown={text}
      markdownStyle={postMarkdownStyle}
      containerStyle={style}
      onLinkPress={({ url }: LinkPressEvent) => {
        void Linking.openURL(url);
      }}
    />
  );
}