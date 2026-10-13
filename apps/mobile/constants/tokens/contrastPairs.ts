// Stockpile — the contrast check tables (§9A, "One design, two themes",
// 2026-09-29; values re-scored for v3 "Game Night", §9C, 2026-10-12). SOURCE OF TRUTH: docs/design/screens/board.jsx's `TOKEN_ROWS`
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
  // Medals (§9A, season complete only): each disc is a graphic on the surface.
  ['medalGold', 'Medal disc, gold, on the surface', 3],
  ['medalSilver', 'Medal disc, silver, on the surface', 3],
  ['medalBronze', 'Medal disc, bronze, on the surface', 3],
];

/**
 * Every foreground-on-fill pair the components actually render, with the
 * background it really sits on. `over` names the base a translucent `bg` is
 * composited over (null = white, i.e. bg is already opaque).
 * [fg token, bg token, over token | null, min contrast, where it's used]
 */
export type ContrastPair = [fg: TokenKey, bg: TokenKey, over: TokenKey | null, min: number, where: string];

export const PAIRS: readonly ContrastPair[] = [
  // §9C: `onAccent` split — fills that take white in BOTH themes (you, loss-fill) read `onYou`.
  ['onYou', 'you', null, 4.5, 'Avatar initials, winner banner, filled roster slots'],
  ['onOpp', 'opp', null, 4.5, 'Opponent avatar initials'],
  ['onYou', 'lossFill', null, 4.5, 'Sell button label'],
  ['primaryFg', 'primaryBg', null, 4.5, 'Primary button label'],
  ['inverseFg', 'inverseBg', null, 4.5, 'FINAL chip, selected toggle'],
  ['secondaryFg', 'secondaryBg', 'surface', 4.5, 'Secondary button label'],
  ['text', 'inset', null, 4.5, 'Chips, draft cells, search field, panels'],
  ['text2', 'inset', null, 4.5, 'Chip meta, race-chart day labels'],
  ['liveText', 'inset', null, 4.5, 'LIVE chip'],
  // 3b-1 carry-over, fixed 3b-2: the header phase chip's `inset` fill was
  // nearly invisible against `bg` in Light (#F0F3F7 vs #F3F5F8) — the chip
  // sits on the PAGE background there, not a card, so it now uses
  // `surface` + a hairline instead (PhaseChip's `onPageBackground` prop,
  // ShellHeader — retrofits Matchup/League/Portfolio's header chip too).
  ['liveText', 'surface', null, 4.5, 'Broadcast tags on cards, and the header chip on the page background (3b-2 retrofit)'],
  ['text', 'surface', null, 4.5, 'Default-style header chip on the page background (3b-2 retrofit)'],
  ['text2', 'sunken', null, 4.5, 'Segmented-control labels'],
  ['text', 'bg', null, 4.5, 'Screen text'],
  ['text2', 'bg', null, 4.5, 'Captions on the screen background'],
  ['gain', 'bg', null, 4.5, 'Gain on the screen background (Home hero)'],
  ['loss', 'bg', null, 4.5, 'Loss on the screen background'],
  ['danger', 'bg', null, 4.5, 'Field errors on the screen background (3b-1 auth, username)'],
  ['gain', 'inset', null, 4.5, 'Gain inside panels'],
  ['loss', 'inset', null, 4.5, 'Loss inside panels (3b-1 onboarding FINAL vignette)'],
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
  ['onYou', 'you', null, 3, 'Chevrons on the drawn draft track (graphic)'],
  ['surface', 'live', null, 3, 'Trophy icon on the champion badge (graphic)'],
  // Medals: the rank numeral on each disc (text, 4.5)...
  ['onMedal', 'medalGold', null, 4.5, 'Medal rank numeral on the gold disc'],
  ['onMedal', 'medalSilver', null, 4.5, 'Medal rank numeral on the silver disc'],
  ['onMedal', 'medalBronze', null, 4.5, 'Medal rank numeral on the bronze disc'],
  // ...and each disc on the caller's you-tint row, composited over the surface (graphic, 3).
  ['medalGold', 'youTint', 'surface', 3, 'Medal disc, gold, on the you-tint row (graphic)'],
  ['medalSilver', 'youTint', 'surface', 3, 'Medal disc, silver, on the you-tint row (graphic)'],
  ['medalBronze', 'youTint', 'surface', 3, 'Medal disc, bronze, on the you-tint row (graphic)'],
  // Your turn (Design Lead, 2026-10-06; board #your-turn): the flash fills the clock card with
  // live gold, text in on-live; at rest the card is warn-tint with the title in liveText.
  ['onLive', 'live', null, 4.5, 'Your-turn flash: text on the live gold fill'],
  ['liveText', 'warnTint', 'surface', 4.5, "Your-turn rest: \"You're on the clock\" on the warn-tint card"],

  // ── Game Night (§9C, 2026-10-12): the new pairs. §9C names them by group (the lit slab, the
  // leader's wash, the clock cell, the sector pills and lines, the money page, the "Yours"
  // pill, the accent fill, your ring) — these are those groups, row by row, as the W3
  // primitives render them. The board's PAIRS must carry the same rows.
  // The lit slab (RosterRow: the half that wins the row).
  ['text', 'lit', null, 4.5, 'Roster: ticker on the lit slab'],
  ['text2', 'lit', null, 4.5, 'Roster: company and week % on the lit slab'],
  ['gain', 'lit', null, 4.5, 'Roster: week gain on the lit slab'],
  ['loss', 'lit', null, 4.5, 'Roster: week loss on the lit slab (both halves down)'],
  // The leader's half of the Scoreboard.
  ['text', 'leadWash', 'surface', 4.5, "Scoreboard: name and total on the leader's wash"],
  // The draft's on-the-clock cell.
  ['onClockCell', 'clockCell', null, 4.5, 'Draft: the clock in the on-the-clock cell'],
  ['clockCellLive', 'clockCell', null, 4.5, 'Draft: the pick number (and its ring) in the on-the-clock cell'],
  // Sector pills (text on the fill)...
  ['onTile', 'tileTech', null, 4.5, 'Sector pill: Tech'],
  ['onTile', 'tileComm', null, 4.5, 'Sector pill: Comm'],
  ['onTile', 'tileCons', null, 4.5, 'Sector pill: Cons'],
  ['onTile', 'tileFin', null, 4.5, 'Sector pill: Fin'],
  ['onTile', 'tileHealth', null, 4.5, 'Sector pill: Hlth'],
  // ...and the draft tile's 3pt sector line on the tile's surface (graphic).
  ['tileTech', 'surface', null, 3, 'Draft tile: the Tech line (graphic)'],
  ['tileComm', 'surface', null, 3, 'Draft tile: the Comm line (graphic)'],
  ['tileCons', 'surface', null, 3, 'Draft tile: the Cons line (graphic)'],
  ['tileFin', 'surface', null, 3, 'Draft tile: the Fin line (graphic)'],
  ['tileHealth', 'surface', null, 3, 'Draft tile: the Hlth line (graphic)'],
  // The money page (Portfolio, the stock sheet's screen).
  ['text', 'moneyBg', null, 4.5, 'Money page: the value and rows'],
  ['text2', 'moneyBg', null, 4.5, 'Money page: captions'],
  ['gain', 'moneyBg', null, 4.5, 'Money page: gain'],
  ['loss', 'moneyBg', null, 4.5, 'Money page: loss'],
  // The "Yours" pill on the player card (the sheet's surface).
  ['youText', 'youTint', 'surface', 4.5, 'Player card: the "Yours" pill'],
  // The accent fill (the primary pill, the money range pills).
  ['onAccent', 'accent', null, 4.5, 'Filled accent pill: the money range pills, the Draft button'],
  // Your ring: the 2pt `you` ring sits across a 2pt `bg` gap, so it reads against the page.
  ['you', 'bg', null, 3, 'Your avatar ring across its bg gap (graphic)'],
  // Chip (§9C: accentTint + liveText, the dot drawn). Not among §9C's named groups; added
  // by W3 because the Chip renders text and a dot on that fill: on the page (the header)
  // and on cards / sheets.
  ['liveText', 'accentTint', 'bg', 4.5, 'LIVE chip on the page background'],
  ['liveText', 'accentTint', 'surface', 4.5, 'LIVE chip on a card or sheet'],
  ['live', 'accentTint', 'bg', 3, 'Live dot inside the LIVE chip (graphic)'],
  // ManagerRow (§9C): your Standings row is the you-tint over the tile's surface; its
  // record and its season gain / movement sit on it. Also W3's, beyond §9C's groups.
  ['text2', 'youTint', 'surface', 4.5, 'Your Standings row: the W–L record'],
  ['gain', 'youTint', 'surface', 4.5, 'Your Standings row: season gain up, movement up'],
  ['loss', 'youTint', 'surface', 4.5, 'Your Standings row: season gain down, movement down'],
];
