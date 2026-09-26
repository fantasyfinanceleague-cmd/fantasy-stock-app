import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scoped to src/design/** (Phase 2 foundation): pure-logic and component
// tests only. Never touches app pages, App.jsx, or the landing.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/design/**/*.test.{ts,tsx}'],
    globals: true,
  },
});
