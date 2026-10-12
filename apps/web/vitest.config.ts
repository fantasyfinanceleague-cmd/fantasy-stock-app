import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scoped to src/design/** (Phase 2 foundation) and src/pages/landing/**
// (Phase 3a): pure-logic and component tests only. Never touches the app
// pages.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/design/**/*.test.{ts,tsx}', 'src/pages/landing/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['src/design/vitest.setup.ts'],
  },
});
