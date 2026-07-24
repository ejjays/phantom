/**
 * @fileoverview custom rules
 */

const WHAT_WORDS = new Set([
  'sets',
  'assigns',
  'calls',
  'creates',
  'initializes',
  'checks',
  'returns',
  'loops',
  'updates',
]);

const URL_REGEX = /https?:\/\/[^\s]+/g;
const CODE_REF_REGEX = /`[^`]+`/g;
const PUNCTUATION_REGEX = /[.,;:'"!?[\](){}]/g;

const pantherPlugin = {
  rules: {
    'no-raw-fetch': {
      meta: {
        type: 'problem',
        docs: { description: 'Force use of secureFetch instead of raw fetch' },
        messages: {
          useSecureFetch:
            'Raw fetch() is forbidden for security (SSRF). Use secureFetch() from src/utils/network/security.util.ts',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (node.callee.name === 'fetch') {
              const filename = context.filename || context.getFilename();
              if (filename.includes('security.util.ts')) return;
              if (filename.includes('tests/')) return; // allow in tests for now

              context.report({ node, messageId: 'useSecureFetch' });
            }
          },
        };
      },
    },
    'no-raw-spawn': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Force use of service wrappers instead of raw spawn',
        },
        messages: {
          useService:
            'Raw spawn() is forbidden. Use ytdlp.service.ts or other service-layer wrappers for process management.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (node.callee.name === 'spawn') {
              const filename = context.filename || context.getFilename();
              if (filename.includes('ytdlp.service.ts')) return;
              if (filename.includes('services/ytdlp/')) return;
              if (filename.includes('controllers/remix.controller.ts')) return;
              if (filename.includes('utils/media/video.util.ts')) return;
              if (filename.includes('extractors/bluesky.ts')) return;
              if (filename.includes('extractors/soundcloud.ts')) return;
              if (filename.includes('extractors/vimeo.ts')) return;
              if (filename.includes('tests/')) return;

              context.report({ node, messageId: 'useService' });
            }
          },
        };
      },
    },
    'panther-comments': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            "Enforce Panther comment style (Focus on 'why', not 'what')",
        },
        messages: {
          isWhatComment:
            "Comment explains 'what' (mechanics). Use comments only for 'why' (intent). Flagged word: '{{word}}'",
          notStartLowercase: 'Comment must start with a lowercase letter.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode;

        return {
          Program() {
            const comments = sourceCode.getAllComments();

            for (const comment of comments) {
              const rawText = comment.value.trim();

              if (
                !rawText ||
                rawText.startsWith('*') ||
                rawText.includes('eslint-') ||
                rawText.startsWith('skipcq:') ||
                rawText.startsWith('!') ||
                rawText.startsWith('/')
              ) {
                continue;
              }

              const cleanText = rawText
                .replace(URL_REGEX, '')
                .replace(CODE_REF_REGEX, '');

              const tokens = cleanText
                .split(/\s+/)
                .map((w) => w.replace(PUNCTUATION_REGEX, ''))
                .filter(Boolean);

              if (tokens.length === 0) continue;

              const firstChar = tokens[0][0];
              if (firstChar && firstChar !== firstChar.toLowerCase()) {
                context.report({
                  loc: comment.loc,
                  messageId: 'notStartLowercase',
                });
              }

              let hasWhatWord = false;

              for (const word of tokens) {
                if (!hasWhatWord && WHAT_WORDS.has(word.toLowerCase())) {
                  context.report({
                    loc: comment.loc,
                    messageId: 'isWhatComment',
                    data: { word },
                  });
                  hasWhatWord = true;
                }
              }
            }
          },
        };
      },
    },
    'no-inline-svg': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Keep SVG in canonical icon files, not inlined in components',
        },
        messages: {
          useIconFile:
            "Inline <svg> detected. Icons belong in a dedicated icon module (mobile: components/icons.tsx or FormatIcons.tsx; frontend: assets/icons/*) — don't hardcode raw SVG in feature components.",
        },
      },
      create(context) {
        const filename = context.filename || context.getFilename();
        const EXEMPT = [
          'components/icons.tsx',
          'FormatIcons.tsx',
          'DotBackground.tsx',
          'assets/icons/',
          'tests/',
        ];
        if (EXEMPT.some((part) => filename.includes(part))) return {};
        return {
          JSXOpeningElement(node) {
            const name = node.name && node.name.name;
            if (name === 'svg' || name === 'Svg') {
              context.report({ node, messageId: 'useIconFile' });
            }
          },
        };
      },
    },
  },
};

export default pantherPlugin;
