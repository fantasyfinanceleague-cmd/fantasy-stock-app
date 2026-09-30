// Minimal flat ESLint config for the mobile app (Expo / React Native / TS).
// typescript-eslint parser + plugin, plus react-hooks (to match the web app).
// The one enforced error rule is no-use-before-define (variables: true) — the
// same TDZ guard the web app runs. No type-aware rules, so no `project` needed.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'babel.config.js', 'metro.config.js', '**/__tests__/**', '**/*.test.*', 'tests-deno/**'],
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
  {
    // Phase 2 foundation (docs/design/DESIGN_DIRECTION.md §2 enforcement):
    // "bypassing tokens harder than using them." Scoped to the NEW primitive
    // layer only — components/sp/** — not app-wide yet (screens migrate in
    // Phase 3). constants/tokens/** itself is NOT in this glob: those files
    // ARE the source of every hex value and font size this rule exists to
    // keep out of their CONSUMERS.
    // Phase 3b-1: extended to components/shell/** (the app shell), which is
    // held to the same token-only rule.
    files: ['components/sp/**/*.{ts,tsx}', 'components/shell/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^#([0-9a-fA-F]{3}){1,2}$/]",
          message: 'No raw hex colour literals in components/sp/** — use a `color.*` token from constants/tokens.',
        },
        {
          selector: "Property[key.name='fontSize'] > Literal",
          message: 'No raw numeric fontSize in components/sp/** — use a `type.*` token from constants/tokens.',
        },
      ],
    },
  },
);
