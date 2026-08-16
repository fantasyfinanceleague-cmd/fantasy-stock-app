// Minimal flat ESLint config for the mobile app (Expo / React Native / TS).
// typescript-eslint parser + plugin, plus react-hooks (to match the web app).
// The one enforced error rule is no-use-before-define (variables: true) — the
// same TDZ guard the web app runs. No type-aware rules, so no `project` needed.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'babel.config.js', 'metro.config.js', '**/__tests__/**', '**/*.test.*'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // TDZ guard — matches web. Base rule off; the TS-aware version on.
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { variables: true }],
      // React hooks (matches web); this is what makes the exhaustive-deps
      // eslint-disable in components/SlotBuilder.tsx a real, honored directive.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
