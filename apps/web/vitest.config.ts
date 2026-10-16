import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scoped to src/design/** (Phase 2 foundation): pure-logic and component
// tests only. Never touches app pages, App.jsx, or the landing. Plus
// src/supabase/**: the old app's client guards (fetch scope, URL sessions).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/design/**/*.test.{ts,tsx}', 'src/supabase/**/*.test.js'],
    globals: true,
    setupFiles: ['src/design/vitest.setup.ts'],
  },
});
