/**
 * P2 (Design Lead, 2026-10-16): Portfolio's hero sub-lines spread one character across the line
 * at XL/XXXL. iOS reused an uncapped twin's measurement for a Text capped by
 * maxFontSizeMultiplier; where a cap is engaged it is now an explicit size (cappedType.ts), and
 * RollingMoney draws ONE Text, no roll, above rollsDigits' threshold.
 * Run: cd apps/mobile/tests-deno && deno test .
 *
 * iOS font scales (callout/body): Large 1.0, xLarge ≈ 1.12, xxLarge ≈ 1.24, xxxLarge ≈ 1.35,
 * accessibility XL ≈ 2.35, accessibility XXXL ≈ 3.12.
 */
import { assertEquals } from 'jsr:@std/assert';
import { rollsDigits } from '../components/sp/logic/rollDigits.ts';
import { cappedFont, cappedTextProps } from '../components/sp/logic/cappedType.ts';
import { LARGE_TEXT_SCALE } from '../components/sp/logic/largeText.ts';
import { type } from '../constants/tokens/type.ts';
import rollingMoneySrc from '../components/home/RollingMoney.tsx' with { type: 'text' };
import portfolioSrc from '../components/money/PortfolioScreen.tsx' with { type: 'text' };

const HERO_LINE_CAP = 1.3; // PortfolioScreen's HERO_LINE_MAX_SCALE

Deno.test('rollsDigits: rolls at the standard sizes, capped or not', () => {
  for (const s of [0.82, 1, 1.12, 1.24]) {
    assertEquals(rollsDigits(s, undefined), true, `uncapped @ ${s}`);
    assertEquals(rollsDigits(s, HERO_LINE_CAP), true, `cap 1.3 @ ${s}`);
  }
});

Deno.test('rollsDigits: the bug frames (Portfolio sub-lines at XL and XXXL) draw one Text', () => {
  assertEquals(rollsDigits(2.35, HERO_LINE_CAP), false);
  assertEquals(rollsDigits(3.12, HERO_LINE_CAP), false);
});

Deno.test('rollsDigits: from the app large-text line up, one Text even when uncapped (Home sub-line)', () => {
  assertEquals(rollsDigits(LARGE_TEXT_SCALE, undefined), false);
  assertEquals(rollsDigits(1.35, undefined), false);
  assertEquals(rollsDigits(3.12, undefined), false);
  assertEquals(rollsDigits(LARGE_TEXT_SCALE - 0.01, undefined), true);
});

Deno.test('rollsDigits: a cap engaged BELOW the large-text line already stops the roll (the trigger itself)', () => {
  // The value lines (hero/money) cap at 1.2: xxLarge (1.24) engages it before 1.3.
  assertEquals(type.money.maxScale, 1.2);
  assertEquals(rollsDigits(1.24, type.money.maxScale), false);
  assertEquals(rollsDigits(1.24, type.hero.maxScale), false);
  // At the cap exactly, drawn size == laid-out size: still rolls.
  assertEquals(rollsDigits(1.2, 1.2), true);
  assertEquals(rollsDigits(1.21, 1.2), false);
});

Deno.test('rollsDigits: a non-finite scale rolls as before (largeText.ts treats it as normal)', () => {
  assertEquals(rollsDigits(Number.NaN, undefined), true);
  assertEquals(rollsDigits(Number.NaN, HERO_LINE_CAP), true);
});

Deno.test('wiring: RollingMoney reads the system font scale and decides with the cap it passes to the digits', () => {
  assertEquals(rollingMoneySrc.includes('const { fontScale } = useWindowDimensions();'), true);
  assertEquals(rollingMoneySrc.includes('const cap = maxScale ?? typeStyle.maxScale;'), true);
  assertEquals(rollingMoneySrc.includes('if (!rollsDigits(fontScale, cap)) {'), true);
  // The roll path still caps each digit with the SAME value it decided on.
  assertEquals(rollingMoneySrc.includes('maxFontSizeMultiplier={cap}'), true);
});

Deno.test('wiring: the large-text branch is ONE Text holding the whole value, fitted, never a digit map', () => {
  const start = rollingMoneySrc.indexOf('if (!rollsDigits(fontScale, cap)) {');
  const branch = rollingMoneySrc.slice(start, rollingMoneySrc.indexOf('\n  }\n', start));
  assertEquals((branch.match(/<RNText\b/g) ?? []).length, 1);
  assertEquals(branch.includes('{text}'), true);
  assertEquals(branch.includes('diff.map'), false);
  assertEquals(branch.includes('DigitColumn'), false);
  assertEquals(branch.includes('numberOfLines={1}'), true);
  assertEquals(branch.includes('adjustsFontSizeToFit'), true);
  assertEquals(branch.includes('minimumFontScale={FIT_MIN_SCALE}'), true);
  // An engaged cap is an explicit size, never maxFontSizeMultiplier on its own.
  assertEquals(branch.includes('const capped = cappedTextProps(typeStyle, fontScale, cap);'), true);
  assertEquals(branch.includes('fontSize: capped.style?.fontSize ?? typeStyle.fontSize'), true);
  assertEquals(branch.includes('lineHeight: capped.style?.lineHeight ?? typeStyle.lineHeight'), true);
  assertEquals(branch.includes('allowFontScaling={capped.allowFontScaling}'), true);
  assertEquals(branch.includes('maxFontSizeMultiplier={capped.maxFontSizeMultiplier}'), true);
  assertEquals(branch.includes('maxFontSizeMultiplier={cap}'), false);
  assertEquals(branch.includes('alignSelf: alignSelfFor(align)'), true);
  // Not keyed on Reduce Motion: the size decides, whatever the motion setting.
  assertEquals(branch.includes('reduced'), false);
});

Deno.test('wiring: the branch comes after every hook (no conditional hook order)', () => {
  const branchAt = rollingMoneySrc.indexOf('if (!rollsDigits(fontScale, cap)) {');
  const fnAt = rollingMoneySrc.indexOf('export function RollingMoney(');
  const before = rollingMoneySrc.slice(fnAt, branchAt);
  assertEquals(/\buse[A-Z]\w*\(/.test(rollingMoneySrc.slice(branchAt)), false);
  for (const hook of ['useTheme()', 'useMotion()', 'useWindowDimensions()', 'useRef(text)', 'useRef(rollKey)', 'useState<number | null>(null)', 'useEffect(() => {']) {
    assertEquals(before.includes(hook), true, hook);
  }
});

Deno.test('Reduce Motion path unchanged: per character, instant swap, no timing when reduced', () => {
  assertEquals(rollingMoneySrc.includes('if (!changed || reduced) {\n      progress.value = 1;\n      return;\n    }'), true);
  assertEquals(rollingMoneySrc.includes('progress.value = withTiming(1, { duration, easing });'), true);
  assertEquals(rollingMoneySrc.includes('reduced={reduced}'), true);
  assertEquals(rollingMoneySrc.includes('{diff.map((entry, i) => ('), true);
});

Deno.test('Portfolio sub-lines still pass their 1.3× cap to RollingMoney (the threshold reads it)', () => {
  assertEquals(portfolioSrc.includes(`const HERO_LINE_MAX_SCALE = ${HERO_LINE_CAP};`), true);
  const heroLine = portfolioSrc.slice(portfolioSrc.indexOf('function HeroLine'));
  assertEquals((heroLine.match(/maxScale=\{HERO_LINE_MAX_SCALE\} \/>/g) ?? []).length, 2);
});

const callout = type.callout; // 13 / 18, no cap of its own

Deno.test('cappedFont: null (scale natively) when no cap, at or under the cap, or a non-finite scale', () => {
  assertEquals(cappedFont(callout, 3.571, undefined), null);
  assertEquals(cappedFont(callout, 1, HERO_LINE_CAP), null);
  assertEquals(cappedFont(callout, HERO_LINE_CAP, HERO_LINE_CAP), null);
  assertEquals(cappedFont(callout, Number.NaN, HERO_LINE_CAP), null);
});

Deno.test('cappedFont: an engaged cap is the size iOS draws it at — fontSize and lineHeight × cap', () => {
  assertEquals(cappedFont(callout, 3.571, HERO_LINE_CAP), { fontSize: 13 * 1.3, lineHeight: 18 * 1.3 });
  assertEquals(cappedFont(callout, 1.31, HERO_LINE_CAP), { fontSize: 13 * 1.3, lineHeight: 18 * 1.3 });
  // money 44/46 at its own 1.2 cap. letterSpacing is NOT scaled: iOS feeds NSKernAttributeName the
  // given value and scales only the font and the line height (RCTAttributedTextUtils.mm).
  assertEquals(cappedFont(type.money, 2.35, type.money.maxScale), { fontSize: 44 * 1.2, lineHeight: 46 * 1.2 });
});

Deno.test('cappedTextProps: engaged -> explicit size, font scaling OFF, no multiplier; else native under the cap', () => {
  assertEquals(cappedTextProps(callout, 3.571, HERO_LINE_CAP), {
    style: { fontSize: 13 * 1.3, lineHeight: 18 * 1.3 }, allowFontScaling: false, maxFontSizeMultiplier: undefined,
  });
  assertEquals(cappedTextProps(callout, 1, HERO_LINE_CAP), { style: null, allowFontScaling: true, maxFontSizeMultiplier: HERO_LINE_CAP });
  assertEquals(cappedTextProps(callout, 3.571, undefined), { style: null, allowFontScaling: true, maxFontSizeMultiplier: undefined });
});

Deno.test('every engaged cap also stops the roll, so the digit path never meets an engaged cap', () => {
  for (const s of [1, 1.12, 1.21, 1.24, 1.29, 1.31, 1.35, 2.35, 3.571]) {
    for (const cap of [undefined, 1.2, 1.3]) {
      if (cappedFont(callout, s, cap) !== null) assertEquals(rollsDigits(s, cap), false, `${s} / ${cap}`);
    }
  }
});

Deno.test('wiring: Portfolio HeroLine keeps its 1.3× cap as a prop; the primitive turns it into a size', () => {
  const heroLine = portfolioSrc.slice(portfolioSrc.indexOf('function HeroLine'), portfolioSrc.indexOf('const styles = StyleSheet.create'));
  // Four capped pieces: two RollingMoney (maxScale) and the "·" and the words (maxFontSizeMultiplier).
  assertEquals((heroLine.match(/maxScale=\{HERO_LINE_MAX_SCALE\}/g) ?? []).length, 2);
  assertEquals((heroLine.match(/maxFontSizeMultiplier=\{HERO_LINE_MAX_SCALE\}/g) ?? []).length, 2);
  assertEquals(heroLine.includes('cappedTextProps'), false);
});
