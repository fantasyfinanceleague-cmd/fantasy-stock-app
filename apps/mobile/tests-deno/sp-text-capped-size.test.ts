/**
 * P2 (Design Lead, 2026-10-19): ANY sp Text with a Dynamic Type cap can take an uncapped
 * same-string twin's layout box on iOS (the Portfolio XXXL digits, 2026-10-16, generalised).
 * The sp Text primitive now turns an ENGAGED cap (fontScale > cap) into an explicit size
 * (cappedType.ts); below the cap nothing changes. Run: cd apps/mobile/tests-deno && deno test --allow-read .
 *
 * iOS font scales: Large 1.0, xxLarge ≈ 1.24, xxxLarge ≈ 1.35, accessibility XL ≈ 2.35, XXXL 3.571.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { cappedSpText } from '../components/sp/logic/cappedType.ts';
import { type } from '../constants/tokens/type.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const text = SOURCES['components/sp/Text.tsx'];
const chip = SOURCES['components/sp/PhaseChip.tsx'];
const digits = SOURCES['components/sp/game/ScoreDigits.tsx'];
const callout = type.callout; // 13/18, no cap of its own
const moneyV = type.money; // 44/46, cap 1.2

Deno.test('capped size: ENGAGED cap -> fontSize/lineHeight × cap, font scaling off, no multiplier', () => {
  assertEquals(cappedSpText(callout, undefined, undefined, 3.571, 1.3), {
    style: { fontSize: 13 * 1.3, lineHeight: 18 * 1.3 }, allowFontScaling: false, maxFontSizeMultiplier: undefined,
  });
  // The variant's own cap (money 1.2) the same way, with no prop given.
  assertEquals(cappedSpText(moneyV, undefined, undefined, 2.35, moneyV.maxScale), {
    style: { fontSize: 44 * 1.2, lineHeight: 46 * 1.2 }, allowFontScaling: false, maxFontSizeMultiplier: undefined,
  });
});

Deno.test('untouched below the cap: native scaling under the multiplier, no explicit size', () => {
  for (const s of [0.82, 1, 1.12, 1.24, 1.3]) {
    assertEquals(cappedSpText(callout, undefined, undefined, s, 1.3), { style: null, allowFontScaling: true, maxFontSizeMultiplier: 1.3 }, `${s}`);
  }
  // At the cap exactly nothing is engaged: drawn size == laid-out size.
  assertEquals(cappedSpText(moneyV, undefined, undefined, 1.2, 1.2).style, null);
  assertEquals(cappedSpText(moneyV, undefined, undefined, 1.21, 1.2).style, { fontSize: 44 * 1.2, lineHeight: 46 * 1.2 });
});

Deno.test('no cap at all: never an explicit size, whatever the scale (an uncapped Text scales natively)', () => {
  for (const s of [1, 1.35, 3.571]) {
    assertEquals(cappedSpText(callout, undefined, undefined, s, undefined), { style: null, allowFontScaling: true, maxFontSizeMultiplier: undefined });
  }
});

Deno.test('a non-finite scale never engages a cap', () => {
  assertEquals(cappedSpText(callout, undefined, undefined, Number.NaN, 1.3).style, null);
});

Deno.test("the caller's own fontSize/lineHeight is what the cap multiplies, each independently", () => {
  assertEquals(cappedSpText(callout, { fontSize: 20 }, undefined, 3.571, 1.3).style, { fontSize: 20 * 1.3, lineHeight: 18 * 1.3 });
  assertEquals(cappedSpText(callout, { lineHeight: 30 }, undefined, 3.571, 1.3).style, { fontSize: 13 * 1.3, lineHeight: 30 * 1.3 });
  assertEquals(cappedSpText(callout, { fontSize: 20, lineHeight: 24 }, undefined, 3.571, 1.3).style, { fontSize: 26, lineHeight: 24 * 1.3 });
});

Deno.test('a caller that turned font scaling OFF keeps it off and gets no explicit size', () => {
  assertEquals(cappedSpText(callout, undefined, false, 3.571, 1.3), { style: null, allowFontScaling: false, maxFontSizeMultiplier: 1.3 });
});

Deno.test('every capped variant engages at XXXL and stays native at Large', () => {
  const capped = Object.entries(type).filter(([, v]) => v.maxScale !== undefined);
  assert(capped.length >= 10);
  for (const [name, v] of capped) {
    assertEquals(cappedSpText(v, undefined, undefined, 1, v.maxScale).style, null, `${name} @ L`);
    assertEquals(cappedSpText(v, undefined, undefined, 3.571, v.maxScale).style, { fontSize: v.fontSize * v.maxScale!, lineHeight: v.lineHeight * v.maxScale! }, `${name} @ XXXL`);
  }
});

Deno.test('wiring: the sp Text primitive reads the system scale and applies cappedSpText', () => {
  assert(text.includes("import { cappedSpText } from './logic/cappedType';"));
  assert(text.includes('const { fontScale } = useWindowDimensions();'));
  assert(text.includes('const flatStyle = StyleSheet.flatten(style) as TextStyle | undefined;'));
  assert(text.includes('const capped = cappedSpText(typeStyle, flatStyle, callerAllowFontScaling, fontScale, resolvedMaxFontSizeMultiplier);'));
  // The cap it applies is the prop OR the variant's own, as before.
  assert(text.includes('const resolvedMaxFontSizeMultiplier = maxFontSizeMultiplier ?? typeStyle.maxScale;'));
});

Deno.test('wiring: the capped size lands AFTER the caller style, and both render paths take the capped props', () => {
  const at = (s: string) => text.indexOf(s);
  assert(at('    style,\n    capped.style,') > 0);
  assert(at('capped.style,') > at('    style,\n'));
  // Animated.Text and RNText both: allowFontScaling + maxFontSizeMultiplier from `capped`, ahead of {...rest}.
  const both = text.match(/allowFontScaling=\{capped\.allowFontScaling\}\s+maxFontSizeMultiplier=\{capped\.maxFontSizeMultiplier\}\s+\{\.\.\.rest\}/g) ?? [];
  assertEquals(both.length, 2);
  // No path still passes the raw multiplier to the native Text.
  assertEquals(text.includes('maxFontSizeMultiplier={resolvedMaxFontSizeMultiplier}'), false);
  // The caller's allowFontScaling is read out of `rest` (else the spread would override the cap).
  assert(text.includes('allowFontScaling: callerAllowFontScaling,'));
});

Deno.test('wiring: the raw RN Texts outside the primitive (PhaseChip, ScoreDigits) apply the same size', () => {
  assert(chip.includes('const capped = cappedTextProps(tagStyle, fontScale, tagStyle.maxScale);'));
  assert(chip.includes('fontSize: capped.style?.fontSize ?? tagStyle.fontSize,'));
  assert(chip.includes('lineHeight: capped.style?.lineHeight ?? tagStyle.lineHeight,'));
  assert(chip.includes('allowFontScaling={capped.allowFontScaling}'));
  assertEquals(chip.includes('maxFontSizeMultiplier={tagStyle.maxScale}'), false);

  assert(digits.includes('const capped = cappedTextProps(typeStyle, fontScale, typeStyle.maxScale);'));
  assert(digits.includes('fontSize={capped.style?.fontSize ?? typeStyle.fontSize}'));
  assert(digits.includes('lineHeight={capped.style?.lineHeight ?? typeStyle.lineHeight}'));
  assert(digits.includes('allowFontScaling={capped.allowFontScaling}'));
  assert(digits.includes('allowFontScaling={allowFontScaling}'));
  assertEquals(digits.includes('maxFontSizeMultiplier={typeStyle.maxScale}'), false);
});

Deno.test('inventory: no raw react-native Text sets a cap outside the files that apply the explicit size', () => {
  // Every source that names `maxFontSizeMultiplier` on a raw RN Text must be one of the three
  // that route it through cappedType (RollingMoney's two paths, PhaseChip, ScoreDigits) or the
  // primitive itself; a new raw capped Text elsewhere would be exposed to the twin bug.
  const rawRN = /import\s*\{[^}]*\bText as RNText\b[^}]*\}\s*from 'react-native'|import\s*\{[^}]*\bText\b[^}]*\}\s*from 'react-native'/;
  const allowed = new Set([
    'components/sp/Text.tsx',
    'components/home/RollingMoney.tsx',
    'components/sp/PhaseChip.tsx',
    'components/sp/game/ScoreDigits.tsx',
  ]);
  const offenders: string[] = [];
  for (const [path, src] of Object.entries(SOURCES)) {
    if (!path.endsWith('.tsx') || allowed.has(path)) continue;
    if (rawRN.test(src) && src.includes('maxFontSizeMultiplier')) offenders.push(path);
  }
  assertEquals(offenders, []);
  for (const path of allowed) {
    const src = SOURCES[path];
    assert(src.includes('cappedType'), `${path} applies the explicit size`);
  }
});
