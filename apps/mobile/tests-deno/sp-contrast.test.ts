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
