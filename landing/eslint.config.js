import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../scripts/eslint-plugin-phantom.js'
);
const hasPlugin = existsSync(pluginPath);
const phantomPlugin = hasPlugin
  ? (await import('../../scripts/eslint-plugin-phantom.js')).default
  : null;

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'public'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,
  prettierConfig,
  {
    plugins: {
      ...(phantomPlugin ? { phantom: phantomPlugin } : {}),
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...(phantomPlugin
        ? {
            'phantom/phantom-comments': 'error',
            'phantom/no-inline-svg': 'warn',
          }
        : {}),
      complexity: ['error', 30],
      'object-shorthand': ['error', 'always'],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'id-length': [
        'error',
        {
          min: 2,
          exceptions: ['_', 'x', 'y', 'id', 'ms', 'ok', 'url', 'e'],
        },
      ],
      'react/jsx-max-depth': ['error', { max: 7 }],
      'react/no-array-index-key': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/prop-types': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^[A-Z_]',
          caughtErrorsIgnorePattern: '^[A-Z_]',
        },
      ],
      'require-await': 'error',
      'prefer-template': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration[kind="let"]',
          message: 'Use "const" instead of "let" for exports.',
        },
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration[kind="var"]',
          message: 'Use "const" instead of "var" for exports.',
        },
      ],
      'spaced-comment': ['error', 'always'],
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      'spaced-comment': 'off',
    },
  }
);
