// Stockpile — WCAG contrast math (§9A, "One design, two themes",
// 2026-09-29). Dependency-free, same reasoning as ./money.ts and ./tug.ts.
//
// Ported VERBATIM from docs/design/screens/board.jsx (design/key-screens-
// 2026-09-29 branch) — that file's `parse`/`over`/`lumRGB`/`ratio`/
// `contrast`/`pairRatio` functions, unchanged in logic, only translated from
// board.jsx's untyped JS to TS. This is deliberately the SAME algorithm the
// design-review board itself scores live, so a value that passes here is
// guaranteed to read as passing on the board too — see
// tests-deno/sp-contrast.test.ts, which uses this to assert both of the
// board's tables (token-on-surface, and every PAIRS foreground-on-fill
// combination) for both themes.

export type RGBA = [r: number, g: number, b: number, a: number];
export type RGB = [r: number, g: number, b: number];

// A mathematical constant of the WCAG compositing algorithm itself (the
// neutral backdrop an opaque colour composites against when no other base
// is given — board.jsx hardcodes the same value in the same two spots),
// not a design decision that should route through a `color.*` token.
// eslint-disable-next-line no-restricted-syntax -- see comment above
const OPAQUE_WHITE = '#FFFFFF';

/** '#RRGGBB' | 'rgba(r, g, b, a)' | 'transparent' -> [r, g, b, a] (0-255, 0-1). */
export function parseColor(c: string): RGBA {
  if (c === 'transparent') return [0, 0, 0, 0];
  if (c.startsWith('#')) {
    const h = c.slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
    return [r, g, b, 1];
  }
  const m = c.match(/[\d.]+/g);
  if (!m) throw new Error(`parseColor: unrecognised colour string "${c}"`);
  const nums = m.map(Number);
  return [nums[0], nums[1], nums[2], nums[3] ?? 1];
}

/** Composite `top` over opaque `base` -> opaque [r, g, b]. */
export function over(top: string, base: string): RGB {
  const t = parseColor(top);
  const b = parseColor(base);
  const composited = [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3]));
  return composited as RGB;
}

function relativeLuminance(rgb: RGB): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return rgb
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    .reduce((sum, v, i) => sum + v * weights[i], 0);
}

/** WCAG contrast ratio between two already-composited opaque RGB colours. */
export function ratio(fgRGB: RGB, bgRGB: RGB): number {
  const x = relativeLuminance(fgRGB);
  const y = relativeLuminance(bgRGB);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A single token's contrast against a surface colour (both may be translucent). */
export function contrastAgainstSurface(tokenValue: string, surfaceValue: string): number {
  return ratio(over(tokenValue, surfaceValue), over(surfaceValue, OPAQUE_WHITE));
}

function toHex(rgb: RGB): string {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/**
 * A foreground-on-fill pair's real ratio: `bg` composited over `base` (or
 * white, if there's no base — the fill is already opaque), then `fg`
 * composited over THAT result. Generic over the theme shape so this stays
 * usable with any token record, not just constants/tokens/color.ts's
 * ThemeColors specifically.
 */
export function pairRatio<K extends string>(theme: Record<K, string>, fg: K, bg: K, base: K | null): number {
  const bgRGB = base ? over(theme[bg], theme[base]) : over(theme[bg], OPAQUE_WHITE);
  const bgHex = toHex(bgRGB);
  return ratio(over(theme[fg], bgHex), bgRGB);
}
