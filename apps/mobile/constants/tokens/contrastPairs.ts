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
  ['text', 'warnTint', 'bg', 4.5, 'Draft blockers card: title and lines (on the page)'],
  ['text', 'warnTint', 'surface', 4.5, 'Text on the warn tint over a surface (no current use: the signups and bye notes read warnText since W4 Onboarding)'],
  // W4 Portfolio: the money sheet's warn panel (a refusal or a pre-review block) on the sheet's surface.
  ['warnText', 'warnTint', 'surface', 4.5, 'Money sheet warn panel (refusals, pre-review blocks)'],
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
  // W4 Draft (§9C, accentTint = "your-turn card at rest"): the rest moved to the accent tint
  // over the page; the title there is the LIVE chip row's pair (liveText on accentTint over bg),
  // and the round line, the captions and the last-10 s clock are these three.
  ['onLive', 'live', null, 4.5, 'Your-turn flash: text on the live fill'],
  ['text', 'accentTint', 'bg', 4.5, 'Your-turn rest: the round line and the clock on the accent-tint card'],
  ['text2', 'accentTint', 'bg', 4.5, 'Your-turn rest: the captions on the accent-tint card'],
  ['loss', 'accentTint', 'bg', 4.5, 'Your-turn rest: the clock in the last 10 seconds'],

  // ── Game Night, §9C v3.1 (2026-10-12): the 50 new scored pairs. §9C names them by group
  // (your side on the card surface and on the page, the clock cell, the money page, the
  // "Yours" pill, the accent fill, your ring, the owner's avatar disc, the 11 category pills
  // and the 11 category lines on the tile and on an inset); these are those groups row by
  // row. Your text on your card-surface half is the existing "Your standings row" row. The
  // board's PAIRS must carry the same rows, in this order.
  // Your side, shaded in your colour, win or lose (shading B): on the card surface (your
  // Scoreboard half, your Standings row)...
  ['text2', 'youTint', 'surface', 4.5, 'Your side on a card: secondary text (your Scoreboard half, your Standings record)'],
  ['gain', 'youTint', 'surface', 4.5, 'Your side on a card: gain (your Standings season gain, movement up)'],
  ['loss', 'youTint', 'surface', 4.5, 'Your side on a card: loss (your Standings season gain, movement down)'],
  // ...and on the page (your roster column, its slab off the screen edge).
  ['text', 'youTint', 'bg', 4.5, 'Your roster column: your ticker'],
  ['text2', 'youTint', 'bg', 4.5, 'Your roster column: company and week %'],
  ['gain', 'youTint', 'bg', 4.5, 'Your roster column: week gain'],
  ['loss', 'youTint', 'bg', 4.5, 'Your roster column: week loss'],
  // The draft's on-the-clock cell.
  ['onClockCell', 'clockCell', null, 4.5, 'Draft: the clock in the on-the-clock cell'],
  ['clockCellLive', 'clockCell', null, 4.5, 'Draft: the pick number (and its ring) in the on-the-clock cell'],
  // The money page (Portfolio, the stock sheet's screen).
  ['text', 'moneyBg', null, 4.5, 'Money page: the value and rows'],
  ['text2', 'moneyBg', null, 4.5, 'Money page: captions'],
  ['gain', 'moneyBg', null, 4.5, 'Money page: gain'],
  ['loss', 'moneyBg', null, 4.5, 'Money page: loss'],
  // The "Yours" pill on the player card (the sheet's surface).
  ['youText', 'youTint', 'surface', 4.5, 'Player card: the "Yours" pill'],
  // The accent fill (the money range pills, the Draft button).
  ['onAccent', 'accent', null, 4.5, 'Filled accent pill: the money range pills, the Draft button'],
  // Your ring: the 2pt `you` ring sits across a 2pt `bg` gap, so it reads against the page.
  // ...and, right after it, the owner's avatar disc on the player card's "Owned by" pill.
  ['you', 'bg', null, 3, 'Your avatar ring across its bg gap (graphic)'],
  ['opp', 'inset', null, 3, 'Owner avatar disc in the "Owned by" pill (graphic)'],
  // The 11 category pills (text on the fill)...
  ['onCat', 'catTech', null, 4.5, 'Category pill: Tech'],
  ['onCat', 'catFinance', null, 4.5, 'Category pill: Finance'],
  ['onCat', 'catHealth', null, 4.5, 'Category pill: Health'],
  ['onCat', 'catEnergy', null, 4.5, 'Category pill: Energy'],
  ['onCat', 'catTransport', null, 4.5, 'Category pill: Autos'],
  ['onCat', 'catRetail', null, 4.5, 'Category pill: Retail'],
  ['onCat', 'catFood', null, 4.5, 'Category pill: Food'],
  ['onCat', 'catMedia', null, 4.5, 'Category pill: Media'],
  ['onCat', 'catIndustrials', null, 4.5, 'Category pill: Industry'],
  ['onCat', 'catRealEstate', null, 4.5, 'Category pill: Property'],
  ['onCat', 'catMisc', null, 4.5, 'Category pill: Misc'],
  // ...the 11 category lines on the draft tile's surface (graphic)...
  ['catTech', 'surface', null, 3, 'Draft tile: the TEC line (graphic)'],
  ['catFinance', 'surface', null, 3, 'Draft tile: the FIN line (graphic)'],
  ['catHealth', 'surface', null, 3, 'Draft tile: the HLT line (graphic)'],
  ['catEnergy', 'surface', null, 3, 'Draft tile: the NRG line (graphic)'],
  ['catTransport', 'surface', null, 3, 'Draft tile: the AUT line (graphic)'],
  ['catRetail', 'surface', null, 3, 'Draft tile: the RTL line (graphic)'],
  ['catFood', 'surface', null, 3, 'Draft tile: the F&B line (graphic)'],
  ['catMedia', 'surface', null, 3, 'Draft tile: the MED line (graphic)'],
  ['catIndustrials', 'surface', null, 3, 'Draft tile: the IND line (graphic)'],
  ['catRealEstate', 'surface', null, 3, 'Draft tile: the PRP line (graphic)'],
  ['catMisc', 'surface', null, 3, 'Draft tile: the MSC line (graphic)'],
  // ...and on an inset (graphic).
  ['catTech', 'inset', null, 3, 'The Tech line on an inset (graphic)'],
  ['catFinance', 'inset', null, 3, 'The Finance line on an inset (graphic)'],
  ['catHealth', 'inset', null, 3, 'The Health line on an inset (graphic)'],
  ['catEnergy', 'inset', null, 3, 'The Energy line on an inset (graphic)'],
  ['catTransport', 'inset', null, 3, 'The Autos line on an inset (graphic)'],
  ['catRetail', 'inset', null, 3, 'The Retail line on an inset (graphic)'],
  ['catFood', 'inset', null, 3, 'The Food line on an inset (graphic)'],
  ['catMedia', 'inset', null, 3, 'The Media line on an inset (graphic)'],
  ['catIndustrials', 'inset', null, 3, 'The Industry line on an inset (graphic)'],
  ['catRealEstate', 'inset', null, 3, 'The Property line on an inset (graphic)'],
  ['catMisc', 'inset', null, 3, 'The Misc line on an inset (graphic)'],

  // W3's own, beyond §9C's 50 — the Chip renders text and a dot on its tint (§9C "Chip":
  // accentTint + liveText, the dot drawn), on the page (the header) and on cards / sheets.
  ['liveText', 'accentTint', 'bg', 4.5, 'LIVE chip on the page background'],
  ['liveText', 'accentTint', 'surface', 4.5, 'LIVE chip on a card or sheet'],
  ['live', 'accentTint', 'bg', 3, 'Live dot inside the LIVE chip (graphic)'],
];
