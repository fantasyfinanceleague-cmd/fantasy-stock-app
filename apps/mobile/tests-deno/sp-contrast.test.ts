/**
 * Hermetic unit tests for the §9A theme contrast tables — no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Design Lead, 2026-09-29 ("One design, two themes"): this is the SAME
 * check docs/design/screens/board.jsx runs live (same algorithm — ported
 * verbatim in components/sp/logic/contrast.ts — and the same TOKEN_ROWS /
 * PAIRS tables, copied verbatim into constants/tokens/contrastPairs.ts), now
 * also enforced here so a token edit can't silently fail AA without the
 * board being open to notice. Two tables, both themes:
 *   1. token-on-surface (TOKEN_ROWS, min 0 = measured but not scored — text3
 *      is disabled/decorative only, never information);
 *   2. every real foreground-on-fill pair the components render (PAIRS),
 *      tints composited over their stated base.
 *
 * A token-on-surface check alone has already been shown (board.jsx's own
 * comment, and independently by two real bugs found while wiring this
 * migration — Chip's first cut of "accent fill + onAccent text" measured
 * 2.39:1 in Dark, and PhaseChip's live dot on its own inverted background
 * measured 1.46:1) to miss real failures a token-on-surface check alone
 * would never catch. The PAIRS table is the evidence that matches the claim.
 */
import { assertEquals } from 'jsr:@std/assert';
import { color, ThemeMode } from '../constants/tokens/color.ts';
import { TOKEN_ROWS, PAIRS } from '../constants/tokens/contrastPairs.ts';
import { contrastAgainstSurface, pairRatio } from '../components/sp/logic/contrast.ts';

const THEMES: ThemeMode[] = ['light', 'dark'];

for (const theme of THEMES) {
  const T = color[theme];

  for (const [token, role, min] of TOKEN_ROWS) {
    if (min === 0) continue; // text3: measured elsewhere, never scored (disabled/decorative only).
    Deno.test(`contrast (${theme}): --c-${token} (${role}) >= ${min}:1 on surface`, () => {
      const c = contrastAgainstSurface(T[token], T.surface);
      assertEquals(c >= min, true, `${theme}.${token} = ${c.toFixed(2)}:1 on surface, needs >= ${min}:1`);
    });
  }

  for (const [fg, bg, over, min, where] of PAIRS) {
    Deno.test(`contrast (${theme}): --c-${fg} on --c-${bg}${over ? ` over --c-${over}` : ''} >= ${min}:1 (${where})`, () => {
      const c = pairRatio(T, fg, bg, over);
      assertEquals(c >= min, true, `${theme}: ${fg} on ${bg}${over ? ` over ${over}` : ''} = ${c.toFixed(2)}:1, needs >= ${min}:1 (${where})`);
    });
  }
}

Deno.test('contrast: text3 is measured (both themes) even though unscored', () => {
  for (const theme of THEMES) {
    const T = color[theme];
    const c = contrastAgainstSurface(T.text3, T.surface);
    assertEquals(Number.isFinite(c) && c > 0, true);
  }
});

// ── on-live (§9C, 2026-10-12): the accent's own ink — dark in Dark, white in Light ──
// (§9A had one navy in both themes on a gold `live`; §9C makes `live` the accent, so its
// ink follows `onAccent`. If Giorgio keeps gold, see color.ts's three-key revert.)

import { pairRatio as ratioOf } from '../components/sp/logic/contrast.ts';

Deno.test('on-live follows the accent: #080D25 in Dark, #FDFEFF in Light, and clears 4.5 on live', () => {
  assertEquals(color.dark.onLive, '#080D25');
  assertEquals(color.light.onLive, '#FDFEFF');
  assertEquals(color.dark.onLive, color.dark.onAccent);
  assertEquals(color.light.onLive, color.light.onAccent);
  // Measured from the §9C hex: Light 5.61:1, Dark 13.54:1.
  const light = ratioOf(color.light, 'onLive', 'live', null);
  const dark = ratioOf(color.dark, 'onLive', 'live', null);
  assertEquals(Math.abs(light - 5.61) < 0.05, true, `light ${light.toFixed(2)}`);
  assertEquals(Math.abs(dark - 13.54) < 0.05, true, `dark ${dark.toFixed(2)}`);
});

// ── The your-turn card's two pairs (UX audit re-gate 3c-2, B-1: §9A, a component
// that puts text on a fill adds its pair). Both are rows of PAIRS, so the loop
// above scores them in both themes at 4.5; this pins that they stay there and
// the ratios the Design Lead measured.

Deno.test('B-1: the your-turn pairs are in PAIRS and clear the measured ratios', () => {
  const has = (fg: string, bg: string, over: string | null) => PAIRS.some(([f, b, o]) => f === fg && b === bg && o === over);
  assertEquals(has('onLive', 'live', null), true); // the flash: navy text on the live gold fill
  assertEquals(has('liveText', 'warnTint', 'surface'), true); // at rest: "You're on the clock" on the warn tint
  // §9C values: liveText on warnTint over surface, Light 5.17:1, Dark 10.77:1.
  const restLight = ratioOf(color.light, 'liveText', 'warnTint', 'surface');
  const restDark = ratioOf(color.dark, 'liveText', 'warnTint', 'surface');
  assertEquals(Math.abs(restLight - 5.17) < 0.05, true, `light ${restLight.toFixed(2)}`);
  assertEquals(restDark >= 4.5, true, `dark ${restDark.toFixed(2)}`); // 10.77:1 today
});
