/**
 * The v3 "Game Night" token port (DESIGN_DIRECTION §9C, 2026-10-12) — hermetic, no RN:
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * Reads the spec's own machine-readable table, docs/design/tokens-v3-game-night.json (v3.1),
 * so a spec edit that the port doesn't follow fails here.
 *
 * Pins: every spec key, both themes, at the spec's exact hex/rgba; the 18 new keys (v3.1); the
 * changes in meaning §9C lists so W3 doesn't "restore" them; the re-pointed and new
 * contrast rows; and the elevation rule (no shadow on Dark; in Light only the sheet's).
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import spec from '../../../docs/design/tokens-v3-game-night.json' with { type: 'json' };
import { color, type ThemeColors } from '../constants/tokens/color.ts';
import { PAIRS } from '../constants/tokens/contrastPairs.ts';
import { parseColor } from '../components/sp/logic/contrast.ts';

const THEMES = ['light', 'dark'] as const;
const hex = spec.hex as Record<string, { light: string; dark: string }>;
const CAT_KEYS = [
  'catTech', 'catFinance', 'catHealth', 'catEnergy', 'catTransport', 'catRetail', 'catFood', 'catMedia',
  'catIndustrials', 'catRealEstate', 'catMisc',
] as const;
const NEW_KEYS = ['onYou', 'rim', 'moneyBg', 'clockCell', 'onClockCell', 'clockCellLive', 'onCat', ...CAT_KEYS] as const;

Deno.test('v3.1 port: the spec has 66 colour keys, and every one is in both themes at its exact value', () => {
  assertEquals(Object.keys(hex).length, 66);
  for (const theme of THEMES) {
    for (const [key, v] of Object.entries(hex)) {
      assertEquals((color[theme] as unknown as Record<string, string>)[key], v[theme], `${theme}.${key}`);
    }
  }
});

Deno.test('v3.1 port: ThemeColors = the 66 spec keys + the two CSS shadow reference strings, nothing else', () => {
  for (const theme of THEMES) {
    const keys = Object.keys(color[theme]).sort();
    assertEquals(keys, [...Object.keys(hex), 'shadow', 'sheetShadow'].sort(), theme);
  }
});

Deno.test('v3.1 port: the 18 NEW keys are present in both themes; lit, leadWash and the sample tiles are gone', () => {
  assertEquals(NEW_KEYS.length, 18);
  for (const gone of ['lit', 'leadWash', 'onTile', 'tileTech', 'tileComm', 'tileCons', 'tileFin', 'tileHealth']) {
    assert(!(gone in color.light) && !(gone in color.dark), `${gone} should be gone (v3.1)`);
  }
  for (const theme of THEMES) {
    for (const key of NEW_KEYS) {
      assert(typeof color[theme][key] === 'string' && color[theme][key].length > 0, `${theme}.${key}`);
      assert(key in hex, `${key} is in the spec`);
    }
  }
});

// Relative luminance, for "dark ink" / "white ink" checks without pinning a hex twice.
function lum(c: string): number {
  const [r, g, b] = parseColor(c).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

Deno.test('meaning: onAccent is SPLIT — dark ink in Dark, white in Light', () => {
  assert(lum(color.dark.onAccent) < 0.05, `dark.onAccent ${color.dark.onAccent} should be dark ink`);
  assert(lum(color.light.onAccent) > 0.9, `light.onAccent ${color.light.onAccent} should be white`);
});

Deno.test('meaning: onYou is white in BOTH themes (the you and loss-fill fills moved here)', () => {
  for (const theme of THEMES) assert(lum(color[theme].onYou) > 0.9, `${theme}.onYou`);
  assertEquals(color.light.onYou, color.dark.onYou);
});

Deno.test('meaning: opp is a slate, not orange — low chroma, and dark onOpp ink', () => {
  for (const theme of THEMES) {
    const [r, g, b] = parseColor(color[theme].opp);
    assert(Math.max(r, g, b) - Math.min(r, g, b) < 48, `${theme}.opp ${color[theme].opp} is not a slate`);
    assert(b >= r, `${theme}.opp leans blue, not orange`);
    assert(lum(color[theme].onOpp) < 0.05, `${theme}.onOpp is dark ink`);
  }
});

Deno.test('meaning: the primary button IS the accent, and live IS the accent (your-turn colour open with Giorgio)', () => {
  for (const theme of THEMES) {
    const c: ThemeColors = color[theme];
    assertEquals(c.primaryBg, c.accent, `${theme}.primaryBg`);
    assertEquals(c.primaryFg, c.onAccent, `${theme}.primaryFg`);
    assertEquals(c.live, c.accent, `${theme}.live`);
    assertEquals(c.onLive, c.onAccent, `${theme}.onLive`);
  }
});

Deno.test('contrast: the three §9C rows are re-pointed from onAccent to onYou', () => {
  const has = (fg: string, bg: string, min: number) => PAIRS.some(([f, b, o, m]) => f === fg && b === bg && o === null && m === min);
  assert(has('onYou', 'you', 4.5), 'avatar initials / winner banner / filled roster slots');
  assert(has('onYou', 'lossFill', 4.5), 'the Sell label');
  assert(has('onYou', 'you', 3), 'the draft-track chevrons');
  assert(!PAIRS.some(([f, b]) => f === 'onAccent' && (b === 'you' || b === 'lossFill')), 'no onAccent left on a you / loss fill');
});

// The Game Night rows (§9C v3.1's 50, by its groups) + W3's three Chip rows. The board's
// PAIRS must carry the same.
const GAME_NIGHT_PAIRS: ReadonlyArray<[string, string, string | null, number]> = [
  ['text2', 'youTint', 'surface', 4.5], ['gain', 'youTint', 'surface', 4.5], ['loss', 'youTint', 'surface', 4.5],
  ['text', 'youTint', 'bg', 4.5], ['text2', 'youTint', 'bg', 4.5], ['gain', 'youTint', 'bg', 4.5], ['loss', 'youTint', 'bg', 4.5],
  ['onClockCell', 'clockCell', null, 4.5], ['clockCellLive', 'clockCell', null, 4.5],
  ['text', 'moneyBg', null, 4.5], ['text2', 'moneyBg', null, 4.5], ['gain', 'moneyBg', null, 4.5], ['loss', 'moneyBg', null, 4.5],
  ['youText', 'youTint', 'surface', 4.5], ['onAccent', 'accent', null, 4.5], ['you', 'bg', null, 3],
  ['opp', 'inset', null, 3],
  ...CAT_KEYS.map((k) => ['onCat', k, null, 4.5] as [string, string, null, number]),
  ...CAT_KEYS.map((k) => [k, 'surface', null, 3] as [string, string, null, number]),
  ...CAT_KEYS.map((k) => [k, 'inset', null, 3] as [string, string, null, number]),
];
const W3_CHIP_PAIRS: ReadonlyArray<[string, string, string | null, number]> = [
  ['liveText', 'accentTint', 'bg', 4.5], ['liveText', 'accentTint', 'surface', 4.5], ['live', 'accentTint', 'bg', 3],
];
// W4 Draft: the your-turn rest moved from §9A's warn tint to the accent tint over the page, so
// one of the 40 earlier rows (liveText on warnTint over surface) left and these three came in.
const W4_DRAFT_PAIRS: ReadonlyArray<[string, string, string | null, number]> = [
  ['text', 'accentTint', 'bg', 4.5], ['text2', 'accentTint', 'bg', 4.5], ['loss', 'accentTint', 'bg', 4.5],
];
// W4 Portfolio: the money sheet's warn panel (warnText on warnTint) sits on the sheet's surface.
const W4_PORTFOLIO_PAIRS: ReadonlyArray<[string, string, string | null, number]> = [
  ['warnText', 'warnTint', 'surface', 4.5],
];

// W4 Onboarding: the "Email confirmed" chip (gain on gainTint) sits on the page.
const W4_ONBOARDING_PAIRS: ReadonlyArray<[string, string, string | null, number]> = [
  ['gain', 'gainTint', 'bg', 4.5],
];

Deno.test('contrast: every Game Night pair is in PAIRS (sp-contrast.test.ts scores each in both themes)', () => {
  assertEquals(GAME_NIGHT_PAIRS.length, 50, '§9C v3.1: 50 new pairs');
  for (const [fg, bg, over, min] of [...GAME_NIGHT_PAIRS, ...W3_CHIP_PAIRS, ...W4_DRAFT_PAIRS, ...W4_PORTFOLIO_PAIRS, ...W4_ONBOARDING_PAIRS]) {
    assert(PAIRS.some(([f, b, o, m]) => f === fg && b === bg && o === over && m === min), `${fg} on ${bg}${over ? ` over ${over}` : ''} >= ${min}`);
  }
  assertEquals(PAIRS.length, 40 - 1 + GAME_NIGHT_PAIRS.length + W3_CHIP_PAIRS.length + W4_DRAFT_PAIRS.length + W4_PORTFOLIO_PAIRS.length + W4_ONBOARDING_PAIRS.length);
});

Deno.test('every category has its pair: a pill (onCat) AND a line on the tile and on an inset', () => {
  for (const k of CAT_KEYS) {
    assert(PAIRS.some(([f, b]) => f === 'onCat' && b === k), `${k} pill`);
    assert(PAIRS.some(([f, b, , m]) => f === k && b === 'surface' && m === 3), `${k} line on the tile`);
    assert(PAIRS.some(([f, b, , m]) => f === k && b === 'inset' && m === 3), `${k} line on an inset`);
  }
});

Deno.test('elevation rule 1: no card shadow in either theme; Dark has no sheet shadow either', () => {
  assertEquals(color.light.shadow, 'none');
  assertEquals(color.dark.shadow, 'none');
  assertEquals(color.dark.sheetShadow, 'none');
  assert(color.light.sheetShadow !== 'none', 'Light keeps the sheet\'s shadow');
});

Deno.test('depth from lightness steps of one hue (Dark): bg < surface < inset; sunken below the page', () => {
  const d = color.dark;
  assert(lum(d.bg) < lum(d.surface) && lum(d.surface) < lum(d.inset), 'bg → surface → inset rises');
  assert(lum(d.sunken) < lum(d.bg), 'sunken sits below the page');
  assert(lum(d.moneyBg) < lum(d.bg), 'the money page is darker than the game page');
});

Deno.test('the owner disc row sits directly after your ring row, worded as the board has it', () => {
  const i = PAIRS.findIndex(([f, b]) => f === 'you' && b === 'bg');
  assertEquals(PAIRS[i + 1], ['opp', 'inset', null, 3, 'Owner avatar disc in the "Owned by" pill (graphic)']);
});
