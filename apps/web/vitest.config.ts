import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scoped to src/design/** (Phase 2 foundation), src/join/** and the Vite
// plugins (onboarding W5): pure-logic and component tests only. Never renders
// the old app pages or the landing.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/design/**/*.test.{ts,tsx}', 'src/join/**/*.test.{ts,tsx}', 'vite-plugins/**/*.test.ts'],
    globals: true,
    // Fake values so the onboarding pages' invite-preview URL resolves (every request is mocked).
    env: { VITE_SUPABASE_URL: 'https://test.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
    setupFiles: ['src/design/vitest.setup.ts'],
  },
});
