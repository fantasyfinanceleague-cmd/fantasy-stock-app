import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // TDZ guard: flag use-before-define of let/const/class (variables:true),
      // per the 2026-08-11 Leagues.jsx `selectedUpdateLeagueObj` crash.
      'no-use-before-define': ['error', { variables: true }],
    },
  },
  // Phase 2 foundation (docs/design/prompts/phase2-foundation-web.md): the
  // design-system source gets TS + typescript-eslint. Scoped to src/design,
  // the Phase 3a landing (src/pages/landing) and src/brand.ts only — the
  // rest of apps/web stays JS/eslint-recommended
  // as above, untouched.
  {
    files: ['src/design/**/*.{ts,tsx}', 'src/pages/landing/**/*.{ts,tsx}', 'src/brand.ts'],
    extends: [
      ...tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
    ],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { variables: true }],
    },
  },
  // DESIGN_DIRECTION.md §2: "a lint rule against raw hex outside tokens.ts".
  // tokens.ts (the JS mirror of the CSS custom properties) and test files
  // (golden-case assertions legitimately compare against hex strings) are
  // the only exemptions.
  {
    files: ['src/design/**/*.{ts,tsx}', 'src/pages/landing/**/*.{ts,tsx}', 'src/brand.ts'],
    ignores: ['src/design/tokens.ts', 'src/design/**/*.test.{ts,tsx}', 'src/pages/landing/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            'Raw hex color literals are forbidden here — use var(--sp-*) in CSS or the tokens.ts mirror in JS/TS (DESIGN_DIRECTION.md §2).',
        },
      ],
    },
  },
])
