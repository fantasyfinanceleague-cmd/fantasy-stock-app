// Stockpile — theme colour tokens, v3.1 "Game Night" (§9C, 2026-10-12).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9C and
// docs/design/tokens-v3-game-night.json (OKLCH source + the hex column this
// file ports; translucent roles are rgba()). Values are copied verbatim from
// the JSON's `hex` block — do not hand-tune a value here without updating the
// spec first. §9C supersedes the §9A VALUES; §9A's RULES stand (one design,
// two complete themes, no screen mixes them, colour never the only code).
//
// Changes in MEANING from §9A (decisions already taken — don't "restore" them):
//   - `onAccent` is the ink ON accent fills: dark navy in Dark, white in
//     Light. Fills that take white in BOTH themes (`you`, `lossFill`) read
//     the new `onYou`.
//   - `opp` is a mid slate, not orange: Game Night marks the opponent by
//     POSITION (the right-hand side), not colour; `onOpp` is dark ink.
//   - `primaryBg` is the accent (a cyan / deep-teal pill).
//   - `live` / `liveText` / `onLive` are the accent, not gold: the your-turn
//     flash is cyan (Giorgio, 2026-10-12). Were it ever reverted to gold, it is
//     exactly these three keys, both themes, back to the §9A values:
//       light: live '#C07E00', liveText '#8A5B00', onLive '#0D1B2E'
//       dark:  live '#FFC53D', liveText '#FFC53D', onLive '#0D1B2E'
//     (`liveGlow` follows `live`: §9A had rgba(192,126,0,0.35) Light /
//     rgba(255,197,61,0.45) Dark.)
//   - `bg` is for game screens; money screens use `moneyBg`.
//   - v3.1: YOUR side is shaded (`youTint`), never the leader's — `lit` and
//     `leadWash` are gone; the 11 `cat*` + `onCat` replace the five sample tiles.
//
// Elevation (§9C rule 1): depth comes from lightness steps of one hue
// (272°), never a shadow on Dark; in Light the only shadow is the sheet's.
// So `shadow` is 'none' in both themes and Dark's `sheetShadow` is 'none' —
// `elevation.ts` renders the native equivalents.
//
// Read the active theme via `useTheme()` (components/sp/ThemeProvider),
// never by importing `color.light`/`color.dark` directly in a component.
//
// Naming: each key is the camelCase form of the board's `--c-<kebab-name>`
// (e.g. `--c-text-2` -> `text2`); the v3 additions mirror the board's
// `--d-*` names the same way (`--d-on-cat` -> `onCat`).
//
// The board also defines `kbd-bg`, `kbd-key`, `kbd-key-2`, `chrome` and
// `chrome-dot` — deliberately NOT ported here: they only render the board's
// own illustrative keyboard / browser-chrome mockups.

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
  /** Ink on the `live` fill (the your-turn flash): dark in Dark, white in Light (§9C). */
  onLive: string;
  gain: string;
  loss: string;
  /** Money flat — never green, never red (§9A, unchanged rule from §9). */
  zero: string;
  gainTint: string;
  lossTint: string;
  danger: string;
  lossFill: string;
  warnTint: string;
  /* Medals (§9A, season complete only): a filled disc with the rank numeral.
     Never medal-coloured text. */
  medalGold: string;
  medalSilver: string;
  medalBronze: string;
  onMedal: string;
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
  /** CSS box-shadow shorthand — for reference/parity only. RN can't consume this string directly; the native shadow
   * config each theme actually renders lives in `elevation.ts`. */
  shadow: string;
  sheetShadow: string;
  scrim: string;
  tabbar: string;
  /** Ink on `you` and `lossFill` fills: white in BOTH themes (§9C, split from onAccent). NEW v3. */
  onYou: string;
  /** Card rim: a 1pt inset edge on every card, both themes (§9C rule 1). NEW v3. */
  rim: string;
  /** Money screens' page (Portfolio, the stock sheet): near-black in Dark, the white surface in Light. NEW v3. */
  moneyBg: string;
  /** Draft: the on-the-clock cell's fill (navy in both themes). NEW v3. */
  clockCell: string;
  /** The on-the-clock cell's clock. NEW v3. */
  onClockCell: string;
  /** The on-the-clock cell's pick number and ring (cyan in both themes: the cell is dark in both). NEW v3. */
  clockCellLive: string;
  /** Ink on a category pill: dark in Dark, white in Light. NEW v3.1. */
  onCat: string;
  /** The 11 categories (supabase/seed/categories.json): the draft tile's 3pt line and the
   * category pill. NEW v3.1 (replace v3's five sample tiles). */
  catTech: string;
  catFinance: string;
  catHealth: string;
  catEnergy: string;
  catTransport: string;
  catRetail: string;
  catFood: string;
  catMedia: string;
  catIndustrials: string;
  catRealEstate: string;
  catMisc: string;
}

const light: ThemeColors = {
  bg: '#F3F5FC',
  surface: '#FDFEFF',
  inset: '#E7EBF6',
  sunken: '#E6E9F4',
  line: '#D5DAEA',
  border: '#D5DAEA',
  borderStrong: '#737A8D',
  text: '#0E142C',
  text2: '#505B72',
  text3: '#969EB2',
  accent: '#00708E',
  accentTint: 'rgba(0, 112, 142, 0.12)',
  accentWash: 'rgba(0, 112, 142, 0.05)',
  onAccent: '#FDFEFF',
  you: '#0064DC',
  youText: '#0053C2',
  youTint: 'rgba(0, 100, 220, 0.1)',
  opp: '#788093',
  oppText: '#505B72',
  onOpp: '#06091C',
  live: '#00708E',
  liveText: '#006885',
  liveGlow: 'rgba(0, 112, 142, 0.3)',
  onLive: '#FDFEFF',
  gain: '#006C47',
  loss: '#C02447',
  zero: '#505B72',
  gainTint: 'rgba(0, 108, 71, 0.1)',
  lossTint: 'rgba(192, 36, 71, 0.1)',
  danger: '#B7191C',
  lossFill: '#BD1F3D',
  warnTint: '#FAE7B3',
  medalGold: '#AD7300',
  medalSilver: '#7C8795',
  medalBronze: '#C36C36',
  onMedal: '#160E02',
  warnLine: '#EFCC83',
  warnText: '#784900',
  primaryBg: '#00708E',
  primaryFg: '#FDFEFF',
  secondaryBg: 'rgba(253, 254, 255, 0.0)',
  secondaryFg: '#0E142C',
  secondaryBorder: '#737A8D',
  inverseBg: '#0E142C',
  inverseFg: '#FDFEFF',
  track: '#D5DAEA',
  shadow: 'none',
  sheetShadow: '0 8px 24px rgba(13, 27, 46, 0.12)',
  scrim: 'rgba(14, 20, 44, 0.38)',
  tabbar: 'rgba(253, 254, 255, 0.94)',
  // NEW in v3 / v3.1 (§9C).
  onYou: '#FAFCFE',
  rim: '#D5DAEA',
  moneyBg: '#FDFEFF',
  clockCell: '#131832',
  onClockCell: '#FDFEFF',
  clockCellLive: '#35EEFF',
  onCat: '#FDFEFF',
  catTech: '#3E66B3',
  catFinance: '#047E44',
  catHealth: '#944887',
  catEnergy: '#637200',
  catTransport: '#0076A1',
  catRetail: '#A34C1B',
  catFood: '#A54358',
  catMedia: '#7355A9',
  catIndustrials: '#007F79',
  catRealEstate: '#8D5F00',
  catMisc: '#5F636F',
};

const dark: ThemeColors = {
  bg: '#060A1F',
  surface: '#0E132F',
  inset: '#181F3E',
  sunken: '#030513',
  line: '#222C4C',
  border: '#222C4C',
  borderStrong: '#58698C',
  text: '#F3F5FB',
  text2: '#98A8C5',
  text3: '#5E6981',
  accent: '#35EEFF',
  accentTint: 'rgba(53, 238, 255, 0.16)',
  accentWash: 'rgba(53, 238, 255, 0.06)',
  onAccent: '#080D25',
  you: '#0067DF',
  youText: '#83BAFF',
  youTint: 'rgba(0, 103, 223, 0.22)',
  opp: '#7F8DA5',
  oppText: '#98A8C5',
  onOpp: '#080D25',
  live: '#35EEFF',
  liveText: '#35EEFF',
  liveGlow: 'rgba(53, 238, 255, 0.35)',
  onLive: '#080D25',
  gain: '#39EEBA',
  loss: '#F76D89',
  zero: '#98A8C5',
  gainTint: 'rgba(57, 238, 186, 0.12)',
  lossTint: 'rgba(247, 109, 137, 0.14)',
  danger: '#FB8371',
  lossFill: '#C12440',
  warnTint: 'rgba(244, 191, 63, 0.1)',
  medalGold: '#ECAE30',
  medalSilver: '#BBC5D1',
  medalBronze: '#DE8F57',
  onMedal: '#080D25',
  warnLine: 'rgba(244, 191, 63, 0.35)',
  warnText: '#FAC547',
  primaryBg: '#35EEFF',
  primaryFg: '#080D25',
  secondaryBg: 'rgba(14, 19, 47, 0.0)',
  secondaryFg: '#F3F5FB',
  secondaryBorder: '#58698C',
  inverseBg: '#F3F5FB',
  inverseFg: '#060A1F',
  track: '#222C4C',
  shadow: 'none',
  sheetShadow: 'none',
  scrim: 'rgba(2, 3, 12, 0.55)',
  tabbar: 'rgba(4, 6, 23, 0.94)',
  // NEW in v3 / v3.1 (§9C).
  onYou: '#FAFCFE',
  rim: '#253154',
  moneyBg: '#020309',
  clockCell: '#01020A',
  onClockCell: '#F3F5FB',
  clockCellLive: '#35EEFF',
  onCat: '#0A0F27',
  catTech: '#97BEFF',
  catFinance: '#83D39D',
  catHealth: '#E9A3DB',
  catEnergy: '#B7C874',
  catTransport: '#66CCF4',
  catRetail: '#F9A781',
  catFood: '#FBA0AD',
  catMedia: '#C6AEFC',
  catIndustrials: '#59D4CD',
  catRealEstate: '#E1B767',
  catMisc: '#A6ABB8',
};

export const color = { light, dark };
export type ThemeMode = keyof typeof color;
