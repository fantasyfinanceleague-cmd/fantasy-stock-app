/**
 * Hermetic unit tests for components/sp/logic/theme.ts — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Orchestrator, 2026-09-29 (1.1.0 regression fix): every legacy screen is
 * still light-only, so components/sp/ThemeProvider.tsx's THEME_FORCED
 * forces the resolved theme to 'light' regardless of the system/stored
 * preference — except in __DEV__, where the design gallery still needs to
 * render both themes for review. This pins that "forced wins" rule.
 */
import { assertEquals } from 'jsr:@std/assert';
import { resolveTheme } from '../components/sp/logic/theme.ts';

Deno.test('resolveTheme: a non-null forced value wins over an explicit Dark preference, outside dev', () => {
  assertEquals(resolveTheme('dark', 'dark', 'light', false), 'light');
});

Deno.test('resolveTheme: a non-null forced value wins over System resolving to Dark, outside dev', () => {
  assertEquals(resolveTheme('system', 'dark', 'light', false), 'light');
});

Deno.test('resolveTheme: in __DEV__, the force is bypassed and the real preference governs', () => {
  assertEquals(resolveTheme('dark', 'dark', 'light', true), 'dark');
  assertEquals(resolveTheme('system', 'dark', 'light', true), 'dark');
});

Deno.test('resolveTheme: a null forced value never overrides anything, dev or not', () => {
  assertEquals(resolveTheme('dark', 'light', null, false), 'dark');
  assertEquals(resolveTheme('system', 'dark', null, false), 'dark');
  assertEquals(resolveTheme('system', 'light', null, true), 'light');
});

Deno.test('resolveTheme: System preference resolves via the OS scheme when nothing is forced', () => {
  assertEquals(resolveTheme('system', 'dark', null, false), 'dark');
  assertEquals(resolveTheme('system', 'light', null, false), 'light');
});

Deno.test('resolveTheme: an unknown/undefined system scheme defaults to light, not a crash', () => {
  assertEquals(resolveTheme('system', undefined, null, false), 'light');
  assertEquals(resolveTheme('system', null, null, false), 'light');
});

Deno.test('resolveTheme: an explicit Light/Dark preference passes through unchanged when nothing is forced', () => {
  assertEquals(resolveTheme('light', 'dark', null, false), 'light');
  assertEquals(resolveTheme('dark', 'light', null, false), 'dark');
});
