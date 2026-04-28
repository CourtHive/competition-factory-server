import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: 'tsconfig.json',
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        process: 'readonly',
        // Build-time constants injected by Vite via `define` in vite.config.ts
        __BUILD_COMMIT__: 'readonly',
        __BUILD_TIME__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      sonarjs: sonarjs,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'sonarjs/cognitive-complexity': ['warn', 30],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-console': 'off',
      'no-empty': 'warn',
      'no-prototype-builtins': 'off',
    },
  },
];
