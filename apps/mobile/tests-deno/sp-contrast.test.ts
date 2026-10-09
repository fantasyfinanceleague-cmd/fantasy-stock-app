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

// ── on-live (Design Lead, 2026-10-06, board #your-turn): one navy in both themes ──

import { pairRatio as ratioOf } from '../components/sp/logic/contrast.ts';

Deno.test('on-live is #0D1B2E in both themes, and clears the spec\'s ratios on live gold', () => {
  assertEquals(color.light.onLive, '#0D1B2E');
  assertEquals(color.dark.onLive, '#0D1B2E');
  // The spec quotes 5.1:1 (Light) and 11.0:1 (Dark); allow rounding.
  const light = ratioOf(color.light, 'onLive', 'live', null);
  const dark = ratioOf(color.dark, 'onLive', 'live', null);
  assertEquals(Math.abs(light - 5.1) < 0.1, true, `light ${light.toFixed(2)}`);
  assertEquals(Math.abs(dark - 11.0) < 0.2, true, `dark ${dark.toFixed(2)}`);
});

// ── The your-turn card's two pairs (UX audit re-gate 3c-2, B-1: §9A, a component
// that puts text on a fill adds its pair). Both are rows of PAIRS, so the loop
// above scores them in both themes at 4.5; this pins that they stay there and
// the ratios the Design Lead measured.

Deno.test('B-1: the your-turn pairs are in PAIRS and clear the measured ratios', () => {
  const has = (fg: string, bg: string, over: string | null) => PAIRS.some(([f, b, o]) => f === fg && b === bg && o === over);
  assertEquals(has('onLive', 'live', null), true); // the flash: navy text on the live gold fill
  assertEquals(has('liveText', 'warnTint', 'surface'), true); // at rest: "You're on the clock" on the warn tint
  // Design Lead: onLive on live 5.1:1 / 11.0:1 (above); liveText on warnTint over surface, Light 5.4:1.
  const restLight = ratioOf(color.light, 'liveText', 'warnTint', 'surface');
  const restDark = ratioOf(color.dark, 'liveText', 'warnTint', 'surface');
  assertEquals(Math.abs(restLight - 5.4) < 0.1, true, `light ${restLight.toFixed(2)}`);
  assertEquals(restDark >= 4.5, true, `dark ${restDark.toFixed(2)}`); // 7.8:1 today
});
