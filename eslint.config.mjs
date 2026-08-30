import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'build/**', 'coverage/**', 'admin-client/**', '.eslintrc.js'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: 'tsconfig.json',
      },
      globals: {
        ...globals.node,
        ...globals.vitest,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      sonarjs: sonarjs,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'sonarjs/cognitive-complexity': ['warn', 30],
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-console': 'off',
      'no-empty': 'warn',
      'no-prototype-builtins': 'off',
      'preserve-caught-error': 'off',
      // Ban `JSON.parse(JSON.stringify(x))` as a deep-copy idiom — it silently drops `undefined`,
      // functions, `Date`/`Map`/`Set` and throws on cycles. It was the idiom in `public/getParticipants.ts`
      // for copying the shared privacy-policy fixture, beside three routes that copied nothing at all and
      // mutated that fixture in place. Machine-enforced because prose could not hold it. Mirrors the rule
      // in factory's eslint.config.mjs; keep the two in step.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='JSON'][callee.property.name='parse'] > CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message:
            'Use structuredClone() to deep-copy — JSON.parse(JSON.stringify(x)) drops undefined/functions/Date/Map/Set and throws on cycles. For tournamentRecords use tools.makeDeepCopy, which carries factory extension semantics.',
        },
      ],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'preserve-caught-error': 'off',
    },
  },
];
