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
 * body/callout/caption uncapped), display >= title >= headline must hold at
 * every fontScale, not just fontScale 1 (§9C: score.xl >= display at the base size).
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

// THE TYPE-RAMP INVARIANT, in one place (§9C, Design Lead ruling 2026-10-12): each screen's
// standout stays the loudest text on its own screen at every Dynamic Type size.
//   at 1× only:        score.xl ≥ display (they never share a screen; caps 1.2 vs 1.6)
//   at every fontScale: display ≥ title ≥ headline, hero ≥ display, money ≥ display
// `score.md` is a row size now and is not in the ramp. No value changes.
Deno.test('type ramp ordering at the base size: score.xl >= display >= title >= headline', () => {
  const [xl, display, title, headline] = (['score.xl', 'display', 'title', 'headline'] as const).map((v) => effectiveFontSize(v, 1));
  assertEquals(xl >= display, true, `score.xl (${xl}) should be >= display (${display})`);
  assertEquals(display >= title, true);
  assertEquals(title >= headline, true);
});

for (const fontScale of FONT_SCALES) {
  Deno.test(`type ramp ordering holds at fontScale ${fontScale}: hero, money >= display >= title >= headline`, () => {
    const display = effectiveFontSize('display', fontScale);
    const title = effectiveFontSize('title', fontScale);
    const headline = effectiveFontSize('headline', fontScale);
    const hero = effectiveFontSize('hero', fontScale);
    const money = effectiveFontSize('money', fontScale);

    assertEquals(hero >= display, true, `hero (${hero}) should be >= display (${display})`);
    assertEquals(money >= display, true, `money (${money}) should be >= display (${display})`);
    assertEquals(display >= title, true, `display (${display}) should be >= title (${title})`);
    assertEquals(title >= headline, true, `title (${title}) should be >= headline (${headline})`);
  });
}

Deno.test('§9C: score.md is a row size (17/22), below title — it left the ramp', () => {
  assertEquals(typeTokens['score.md'].fontSize, 17);
  assertEquals(typeTokens['score.md'].lineHeight, 22);
  assertEquals(typeTokens['score.md'].fontSize < typeTokens.title.fontSize, true);
});

Deno.test('§9C: the condensed Black cut leaves the app\'s numbers (no variant uses it)', () => {
  for (const [variant, style] of Object.entries(typeTokens)) {
    assertEquals(style.fontFamily === 'Archivo-Condensed-Black', false, `${variant} still uses the condensed Black cut`);
  }
});

Deno.test('§9C rule 5: game numbers heavy (800), money numbers regular (500)', () => {
  for (const v of ['hero', 'score.xl', 'score.lg', 'score.md', 'ticker'] as const) {
    assertEquals(typeTokens[v].fontFamily, 'Archivo-ExtraBold', v);
  }
  assertEquals(typeTokens.money.fontFamily, 'Archivo-Medium');
  assertEquals([typeTokens.hero.fontSize, typeTokens.hero.lineHeight], [46, 48]);
  assertEquals([typeTokens.money.fontSize, typeTokens.money.lineHeight], [44, 46]);
  assertEquals([typeTokens['score.xl'].fontSize, typeTokens['score.xl'].lineHeight], [32, 36]);
  assertEquals([typeTokens['score.lg'].fontSize, typeTokens['score.lg'].lineHeight], [28, 30]);
  assertEquals([typeTokens.ticker.fontSize, typeTokens.ticker.lineHeight], [16, 20]);
});

Deno.test('§9B 11pt floor: no variant is below 11pt', () => {
  for (const [variant, style] of Object.entries(typeTokens)) {
    assertEquals(style.fontSize >= 11, true, `${variant} is ${style.fontSize}pt`);
  }
});

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
