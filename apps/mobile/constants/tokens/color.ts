// Stockpile — theme colour tokens (§9A, "One design, two themes", 2026-09-29).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9A and
// docs/design/screens/themes.css (`--c-*`, on the design/key-screens-2026-09-29
// branch at the time of writing). Values here are copied verbatim from that
// file — do not hand-tune a value here without updating themes.css first.
//
// Supersedes the old money/game surface axis (§9). Every `*.onGame` leaf,
// `surface.money.*` and `surface.game.*` is gone: a screen is entirely Light
// or entirely Dark, never both, so a component only ever needs ONE colour
// value per name at a time — the active theme's — not a surface-conditional
// pair. Read the active theme via `useTheme()` (components/sp/ThemeProvider),
// never by importing `color.light`/`color.dark` directly in a component.
//
// Naming: each key is the camelCase form of themes.css's `--c-<kebab-name>`
// (e.g. `--c-text-2` -> `text2`, `--c-on-accent` -> `onAccent`,
// `--c-border-strong` -> `borderStrong`) — mechanical and 1:1 with the single
// source of truth, so a parity test can walk both without a translation
// table. `text2`/`text3` read oddly next to `text.secondary`/`text.disabled`
// in the old shape, but a nested shape here would invent structure themes.css
// doesn't have, which is exactly the kind of thing that drifts silently.
//
// themes.css also defines `kbd-bg`, `kbd-key`, `kbd-key-2`, `chrome` and
// `chrome-dot` — deliberately NOT ported here. Those five exist only to
// render the design-review board's own illustrative iOS-keyboard and
// browser-chrome mockups (docs/design/screens/screens.css's `.ks-kbd*` /
// `.ks-web__bar*` rules); no real app screen or component ever needs a fake
// keyboard or browser bar. If `sp-theme-parity.test.ts` or a future audit
// against themes.css looks short by 5 keys, this is why — don't "fix" it by
// adding them.

export interface ThemeColors {
  bg: string;
  surface: string;
  inset: string;
  sunken: string;
  line: string;
  border: string;
  borderStrong: string;
  text: string;
  text2: string;
  /** Disabled or decorative text ONLY (~3:1) — never information (§9A). */
  text3: string;
  accent: string;
  accentTint: string;
  accentWash: string;
  onAccent: string;
  you: string;
  youText: string;
  youTint: string;
  opp: string;
  oppText: string;
  onOpp: string;
  live: string;
  liveText: string;
  liveGlow: string;
  gain: string;
  loss: string;
  /** Money flat — never green, never red (§9A, unchanged rule from §9). */
  zero: string;
  gainTint: string;
  lossTint: string;
  danger: string;
  lossFill: string;
  warnTint: string;
  warnLine: string;
  warnText: string;
  primaryBg: string;
  primaryFg: string;
  secondaryBg: string;
  secondaryFg: string;
  secondaryBorder: string;
  inverseBg: string;
  inverseFg: string;
  track: string;
  /** CSS box-shadow shorthand, verbatim from themes.css — for reference/
   * parity only. RN can't consume this string directly; the native shadow
   * config each theme actually renders lives in `elevation.ts`. */
  shadow: string;
  sheetShadow: string;
  scrim: string;
  tabbar: string;
}

const light: ThemeColors = {
  bg: '#F3F5F8',
  surface: '#FFFFFF',
  inset: '#F0F3F7',
  sunken: '#EBEFF4',
  line: '#E3E8EF',
  border: '#DDE3EA',
  borderStrong: '#76828F',
  text: '#0D1B2E',
  text2: '#5B6678',
  text3: '#8A94A3',
  accent: '#2860F0',
  accentTint: '#E8EEFF',
  accentWash: 'rgba(40, 96, 240, 0.06)',
  onAccent: '#FFFFFF',
  you: '#2860F0',
  youText: '#2860F0',
  youTint: 'rgba(40, 96, 240, 0.08)',
  opp: '#E8541F',
  oppText: '#B93C0E',
  onOpp: '#0D1B2E',
  live: '#C07E00',
  liveText: '#8A5B00',
  liveGlow: 'rgba(192, 126, 0, 0.35)',
  gain: '#12803F',
  loss: '#C8303A',
  zero: '#5B6678',
  gainTint: '#EDF7F0',
  lossTint: '#FCE8E9',
  danger: '#B42318',
  lossFill: '#C8303A',
  warnTint: '#FFF6DE',
  warnLine: '#F5D48A',
  warnText: '#7A4B00',
  primaryBg: '#0D1B2E',
  primaryFg: '#FFFFFF',
  secondaryBg: '#FFFFFF',
  secondaryFg: '#0D1B2E',
  secondaryBorder: '#76828F',
  inverseBg: '#0D1B2E',
  inverseFg: '#FFFFFF',
  track: '#E3E8EF',
  shadow: '0 2px 8px rgba(13, 27, 46, 0.05)',
  sheetShadow: '0 8px 24px rgba(13, 27, 46, 0.12)',
  scrim: 'rgba(13, 27, 46, 0.38)',
  tabbar: 'rgba(255, 255, 255, 0.92)',
};

const dark: ThemeColors = {
  bg: '#0D1B2E',
  surface: '#16263D',
  inset: '#1E3250',
  sunken: '#0A1524',
  line: '#263A58',
  border: '#263A58',
  borderStrong: '#8DA0BD',
  text: '#F3F6FA',
  text2: '#9AAAC4',
  text3: '#6B7D99',
  accent: '#7FA6FF',
  accentTint: 'rgba(127, 166, 255, 0.16)',
  accentWash: 'rgba(127, 166, 255, 0.07)',
  onAccent: '#FFFFFF',
  you: '#3366FF',
  youText: '#8AB0FF',
  youTint: 'rgba(51, 102, 255, 0.18)',
  opp: '#FF6A3D',
  oppText: '#FF8F66',
  onOpp: '#0D1B2E',
  live: '#FFC53D',
  liveText: '#FFC53D',
  liveGlow: 'rgba(255, 197, 61, 0.45)',
  gain: '#4ADE8B',
  loss: '#FF7A7A',
  zero: '#9AAAC4',
  gainTint: 'rgba(74, 222, 139, 0.14)',
  lossTint: 'rgba(255, 122, 122, 0.14)',
  danger: '#FF8A80',
  lossFill: '#D93A44',
  warnTint: 'rgba(255, 197, 61, 0.1)',
  warnLine: 'rgba(255, 197, 61, 0.35)',
  warnText: '#FFC53D',
  primaryBg: '#FFFFFF',
  primaryFg: '#0D1B2E',
  secondaryBg: 'transparent',
  secondaryFg: '#F3F6FA',
  secondaryBorder: '#8DA0BD',
  inverseBg: '#F3F6FA',
  inverseFg: '#0D1B2E',
  track: '#263A58',
  shadow: 'none',
  // Sheets slide up from the bottom, so Dark's sheet shadow casts UPWARD
  // (negative y-offset) — not a typo, verbatim from themes.css.
  sheetShadow: '0 -8px 32px rgba(0, 0, 0, 0.45)',
  scrim: 'rgba(0, 0, 0, 0.55)',
  tabbar: 'rgba(13, 27, 46, 0.92)',
};

export const color = { light, dark };
export type ThemeMode = keyof typeof color;
