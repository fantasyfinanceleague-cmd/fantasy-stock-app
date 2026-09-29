/**
 * Hermetic unit tests pinning that Light and Dark carry the exact same set
 * of token keys — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * §9A, "One design, two themes" (2026-09-29): a screen reads whichever
 * theme is active by the SAME key names either way (`colors.text`,
 * `colors.you`, ...) — if a key existed only in one theme, any component
 * using it would silently render `undefined` the moment the OTHER theme was
 * active, with no type error (ThemeColors is typed as one object shape, so
 * TypeScript can't catch a values-file that's short a key at the const
 * level — a plain object literal missing a required interface property IS a
 * type error, but this guards against copy-paste drift being introduced
 * later without anyone re-running tsc, and against a key present with the
 * wrong TYPE of value silently matching). Every value differs between
 * themes by design; only the KEY SET must match.
 */
import { assertEquals } from 'jsr:@std/assert';
import { color } from '../constants/tokens/color.ts';

Deno.test('theme parity: light and dark have identical key sets', () => {
  const lightKeys = Object.keys(color.light).sort();
  const darkKeys = Object.keys(color.dark).sort();
  assertEquals(lightKeys, darkKeys);
});

Deno.test('theme parity: every key holds a non-empty string in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    const T = color[theme];
    for (const [key, value] of Object.entries(T)) {
      assertEquals(typeof value, 'string', `${theme}.${key} should be a string`);
      assertEquals(value.length > 0, true, `${theme}.${key} should not be empty`);
    }
  }
});

Deno.test('theme parity: light and dark hold genuinely different values for at least most keys', () => {
  // A handful of keys are legitimately identical across themes (onAccent,
  // onOpp - both white/navy by design regardless of theme), so this isn't
  // "every key must differ" - it's a sanity check that the two objects
  // aren't accidental duplicates of each other.
  const keys = Object.keys(color.light);
  const differing = keys.filter((k) => color.light[k as keyof typeof color.light] !== color.dark[k as keyof typeof color.dark]);
  assertEquals(differing.length > keys.length / 2, true, 'expected most tokens to differ between Light and Dark');
});
