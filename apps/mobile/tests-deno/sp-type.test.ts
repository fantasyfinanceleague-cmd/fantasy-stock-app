/**
 * Hermetic unit tests for constants/tokens/type.ts's `effectiveFontSize` —
 * no RN, run with:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Design Lead, 2026-09-29 (DESIGN-CHANGES ui/foundation-mobile): the
 * accessibility-XL gallery capture showed "Portfolio" (display, base 32)
 * rendering SMALLER than "Screen title" (title, base 22) once Dynamic Type
 * scaled title further than display's lower cap — the base-size ordering
 * (display > title) doesn't by itself guarantee the ON-SCREEN ordering once
 * each variant's `maxScale` ceiling is applied. This pins the fix: with the
 * caps chosen (score 1.2; display/title/headline sharing 1.6; tag 1.4;
 * body/callout/caption uncapped), score >= display >= title >= headline
 * must hold at every fontScale, not just fontScale 1.
 */
import { assertEquals } from 'jsr:@std/assert';
import { effectiveFontSize, type as typeTokens } from '../constants/tokens/type.ts';

const FONT_SCALES = [1, 1.35, 2, 3.1];

Deno.test('effectiveFontSize: caps growth at maxScale once fontScale exceeds it', () => {
  // score.xl's cap is 1.2 - at fontScale 2 it should read as if fontScale
  // were only 1.2, not 2.
  assertEquals(effectiveFontSize('score.xl', 2), typeTokens['score.xl'].fontSize * 1.2);
  assertEquals(effectiveFontSize('score.xl', 1.2), typeTokens['score.xl'].fontSize * 1.2);
});

Deno.test('effectiveFontSize: scales linearly below the cap', () => {
  assertEquals(effectiveFontSize('title', 1.1), typeTokens.title.fontSize * 1.1);
});

Deno.test('effectiveFontSize: an uncapped variant (body) scales with fontScale unbounded', () => {
  assertEquals(effectiveFontSize('body', 3.1), typeTokens.body.fontSize * 3.1);
});

Deno.test('effectiveFontSize: at fontScale 1, every variant reads as its raw base fontSize', () => {
  for (const variant of Object.keys(typeTokens) as Array<keyof typeof typeTokens>) {
    assertEquals(effectiveFontSize(variant, 1), typeTokens[variant].fontSize);
  }
});

for (const fontScale of FONT_SCALES) {
  Deno.test(`type ramp ordering holds at fontScale ${fontScale}: score >= display >= title >= headline`, () => {
    const score = effectiveFontSize('score.xl', fontScale);
    const display = effectiveFontSize('display', fontScale);
    const title = effectiveFontSize('title', fontScale);
    const headline = effectiveFontSize('headline', fontScale);

    assertEquals(score >= display, true, `score.xl (${score}) should be >= display (${display})`);
    assertEquals(display >= title, true, `display (${display}) should be >= title (${title})`);
    assertEquals(title >= headline, true, `title (${title}) should be >= headline (${headline})`);
  });
}

Deno.test('type ramp ordering: the specific regression case ("Portfolio" vs "Screen title") no longer inverts', () => {
  // Before the fix: display capped at 1.4, title uncapped -> at a high
  // enough fontScale title's uncapped growth overtakes display's capped 32 *
  // 1.4 = 44.8, flipping the visual hierarchy. Pin the exact scale where the
  // old caps would have inverted, and assert it no longer does.
  const regressionFontScale = 2.5;
  const display = effectiveFontSize('display', regressionFontScale);
  const title = effectiveFontSize('title', regressionFontScale);
  assertEquals(display >= title, true);
});
