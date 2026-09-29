// Stockpile — the contrast check tables (§9A, "One design, two themes",
// 2026-09-29). SOURCE OF TRUTH: docs/design/screens/board.jsx's `TOKEN_ROWS`
// and `PAIRS` (design/key-screens-2026-09-29 branch, synced as of commit
// 0bd741f — "contrast PAIRS +3 (live dot on inset, neutral avatar initials,
// '?' fallback)"), copied verbatim — this is the SAME table the
// design-review board itself scores live (86/86: 14 tokens + 29 pairs × 2
// themes), now also enforced by tests-deno/sp-contrast.test.ts so a token
// edit can't silently fail AA without the board being open. This list must
// stay IDENTICAL to the board's — add a pair here AND there when a new
// component puts text or a graphic on a fill, never here alone.
//
// Keys here are ThemeColors keys (constants/tokens/color.ts), not the
// `--c-*` kebab names board.jsx uses — same values, this file's naming
// convention.

import type { ThemeColors } from './color';

export type TokenKey = keyof ThemeColors;

/** [token, role, minimum contrast against `surface` — text 4.5, graphics 3, 0 = unscored]. */
export type TokenRow = [token: TokenKey, role: string, min: number];

export const TOKEN_ROWS: readonly TokenRow[] = [
  ['text', 'Primary text', 4.5],
  ['text2', 'Secondary text', 4.5],
  ['accent', 'Links, accent text', 4.5],
  ['youText', 'Your name / score text', 4.5],
  ['oppText', 'Opponent text', 4.5],
  ['liveText', 'Live tags', 4.5],
  ['gain', 'Money up', 4.5],
  ['loss', 'Money down', 4.5],
  ['zero', 'Money flat', 4.5],
  ['danger', 'Errors', 4.5],
  ['you', 'Your fills (tug, avatar)', 3],
  ['opp', 'Opponent fills', 3],
  ['live', 'Live dot, clock ring', 3],
  ['borderStrong', 'Control borders', 3],
  // Disabled/decorative text ONLY, never information — measured, not scored.
  ['text3', 'Disabled / decorative text ONLY, never information', 0],
];

/**
 * Every foreground-on-fill pair the components actually render, with the
 * background it really sits on. `over` names the base a translucent `bg` is
 * composited over (null = white, i.e. bg is already opaque).
 * [fg token, bg token, over token | null, min contrast, where it's used]
 */
export type ContrastPair = [fg: TokenKey, bg: TokenKey, over: TokenKey | null, min: number, where: string];

export const PAIRS: readonly ContrastPair[] = [
  ['onAccent', 'you', null, 4.5, 'Avatar initials, winner banner, filled roster slots'],
  ['onOpp', 'opp', null, 4.5, 'Opponent avatar initials'],
  ['onAccent', 'lossFill', null, 4.5, 'Sell button label'],
  ['primaryFg', 'primaryBg', null, 4.5, 'Primary button label'],
  ['inverseFg', 'inverseBg', null, 4.5, 'FINAL chip, selected toggle'],
  ['secondaryFg', 'secondaryBg', 'surface', 4.5, 'Secondary button label'],
  ['text', 'inset', null, 4.5, 'Chips, draft cells, search field, panels'],
  ['text2', 'inset', null, 4.5, 'Chip meta, race-chart day labels'],
  ['liveText', 'inset', null, 4.5, 'LIVE chip'],
  ['liveText', 'surface', null, 4.5, 'Broadcast tags on cards'],
  ['text2', 'sunken', null, 4.5, 'Segmented-control labels'],
  ['text', 'bg', null, 4.5, 'Screen text'],
  ['text2', 'bg', null, 4.5, 'Captions on the screen background'],
  ['gain', 'bg', null, 4.5, 'Gain on the screen background (Home hero)'],
  ['loss', 'bg', null, 4.5, 'Loss on the screen background'],
  ['gain', 'inset', null, 4.5, 'Gain inside panels'],
  ['accent', 'accentTint', 'surface', 4.5, 'Selected web nav, icon tiles'],
  ['gain', 'gainTint', 'surface', 4.5, 'Cash tile "$", done check'],
  ['text', 'youTint', 'surface', 4.5, 'Your standings row'],
  ['accent', 'tabbar', 'bg', 4.5, 'Active tab label'],
  ['text2', 'tabbar', 'bg', 4.5, 'Inactive tab labels'],
  ['warnText', 'warnTint', 'bg', 4.5, '"Your call" notes'],
  ['text', 'warnTint', 'bg', 4.5, 'Sign-ups-paused banner'],
  ['text', 'warnTint', 'surface', 4.5, 'Uneven-bye heads-up (inside a card)'],
  ['live', 'inset', null, 3, 'Live dot inside a LIVE chip (graphic)'],
  ['text', 'line', null, 4.5, 'Initials on a neutral (other manager) avatar'],
  ['text2', 'line', null, 4.5, 'Neutral "?" avatar fallback'],
  ['onAccent', 'you', null, 3, 'Chevrons on the drawn draft track (graphic)'],
  ['surface', 'live', null, 3, 'Trophy icon on the champion badge (graphic)'],
];
