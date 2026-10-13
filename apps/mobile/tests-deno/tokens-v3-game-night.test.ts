/**
 * The v3 "Game Night" token port (DESIGN_DIRECTION §9C, 2026-10-12) — hermetic, no RN:
 *
 *   cd apps/mobile/tests-deno && deno test .
 *
 * fixtures/tokens-v3-game-night.json is a byte-for-byte copy of the spec's
 * docs/design/tokens-v3-game-night.json (commit 092c37b0 on design/game-night-picked,
 * not yet on main when W3 was built). Once that file is on main, point the import there.
 *
 * Pins: every spec key, both themes, at the spec's exact hex/rgba; the 14 new keys; the
 * changes in meaning §9C lists so W3 doesn't "restore" them; the re-pointed and new
 * contrast rows; and the elevation rule (no shadow on Dark; in Light only the sheet's).
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import spec from './fixtures/tokens-v3-game-night.json' with { type: 'json' };
import { color, type ThemeColors } from '../constants/tokens/color.ts';
import { PAIRS } from '../constants/tokens/contrastPairs.ts';
import { parseColor } from '../components/sp/logic/contrast.ts';

const THEMES = ['light', 'dark'] as const;
const hex = spec.hex as Record<string, { light: string; dark: string }>;
const NEW_KEYS = [
  'onYou', 'rim', 'lit', 'leadWash', 'moneyBg', 'clockCell', 'onClockCell', 'clockCellLive', 'onTile',
  'tileTech', 'tileComm', 'tileCons', 'tileFin', 'tileHealth',
] as const;

Deno.test('v3 port: the spec has 62 colour keys, and every one is in both themes at its exact value', () => {
  assertEquals(Object.keys(hex).length, 62);
  for (const theme of THEMES) {
    for (const [key, v] of Object.entries(hex)) {
      assertEquals((color[theme] as unknown as Record<string, string>)[key], v[theme], `${theme}.${key}`);
    }
  }
});

Deno.test('v3 port: ThemeColors = the 62 spec keys + the two CSS shadow reference strings, nothing else', () => {
  for (const theme of THEMES) {
    const keys = Object.keys(color[theme]).sort();
    assertEquals(keys, [...Object.keys(hex), 'shadow', 'sheetShadow'].sort(), theme);
  }
});

Deno.test('v3 port: the 14 NEW keys are present in both themes (§9C says "13"; its own list is 9 + 5 tiles)', () => {
  assertEquals(NEW_KEYS.length, 14);
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

// The Game Night rows (§9C's groups, row by row; your shaded side in place of the lit slab
// and the leader's wash, Giorgio 2026-10-12). The board's PAIRS must carry the same.
const GAME_NIGHT_PAIRS: ReadonlyArray<[string, string, string | null, number]> = [
  ['text', 'youTint', 'bg', 4.5], ['text2', 'youTint', 'bg', 4.5], ['gain', 'youTint', 'bg', 4.5], ['loss', 'youTint', 'bg', 4.5],
  ['onClockCell', 'clockCell', null, 4.5], ['clockCellLive', 'clockCell', null, 4.5],
  ['onTile', 'tileTech', null, 4.5], ['onTile', 'tileComm', null, 4.5], ['onTile', 'tileCons', null, 4.5],
  ['onTile', 'tileFin', null, 4.5], ['onTile', 'tileHealth', null, 4.5],
  ['tileTech', 'surface', null, 3], ['tileComm', 'surface', null, 3], ['tileCons', 'surface', null, 3],
  ['tileFin', 'surface', null, 3], ['tileHealth', 'surface', null, 3],
  ['text', 'moneyBg', null, 4.5], ['text2', 'moneyBg', null, 4.5], ['gain', 'moneyBg', null, 4.5], ['loss', 'moneyBg', null, 4.5],
  ['youText', 'youTint', 'surface', 4.5], ['onAccent', 'accent', null, 4.5], ['you', 'bg', null, 3],
  ['liveText', 'accentTint', 'bg', 4.5], ['liveText', 'accentTint', 'surface', 4.5], ['live', 'accentTint', 'bg', 3],
  ['text2', 'youTint', 'surface', 4.5], ['gain', 'youTint', 'surface', 4.5], ['loss', 'youTint', 'surface', 4.5],
];

Deno.test('contrast: every Game Night pair is in PAIRS (sp-contrast.test.ts scores each in both themes)', () => {
  for (const [fg, bg, over, min] of GAME_NIGHT_PAIRS) {
    assert(PAIRS.some(([f, b, o, m]) => f === fg && b === bg && o === over && m === min), `${fg} on ${bg}${over ? ` over ${over}` : ''} >= ${min}`);
  }
  assertEquals(PAIRS.length, 40 + GAME_NIGHT_PAIRS.length);
});

Deno.test('every new fill key has its pair: a tile is scored as a pill AND as a line', () => {
  for (const tile of ['tileTech', 'tileComm', 'tileCons', 'tileFin', 'tileHealth']) {
    assert(PAIRS.some(([f, b]) => f === 'onTile' && b === tile), `${tile} pill`);
    assert(PAIRS.some(([f, b, , m]) => f === tile && b === 'surface' && m === 3), `${tile} line`);
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

Deno.test("Giorgio's shading ruling: no PAIRS row puts anything on lit or leadWash (your side is shaded, not the winner's)", () => {
  assert(!PAIRS.some(([, b]) => b === 'lit' || b === 'leadWash'));
});
