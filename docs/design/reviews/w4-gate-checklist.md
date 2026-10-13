# W4 gate checklist · the Game Night screens (Design Lead, 2026-10-12)

The gate every W4 screen branch passes before the Design Lead replies `DESIGN-APPROVED`
(plan `docs/plans/2026-10-12-visual-language-reset.md`, W4). It **adds to** the gate in
[`../UI-UX-PROGRAM.md`](../UI-UX-PROGRAM.md) ("Design review gate": specificity, squint,
scorecard, persona walk, P0–P3 with drift classes, the `ux-reviewer` table, §9B, block
rhythm); it replaces nothing there. Workers: read it before turn 1, so the captures you hand
back are the ones the gate needs.

**The authority for every value:** DESIGN_DIRECTION §9C (Game Night, both themes) and the
board section `#call-game-night`. The rules that bind every screen: PRODUCT_RULES
("Captivating, not bland", "Every section must elevate", "Both themes, designed together",
"Direction chosen: Game Night", "No sparklines on rows", "Nothing tappable does nothing") and
the calm-Home structure.

## Order (one gate each; at most two screen workers at once)

1. **Home** (in season, pre-draft, post-season).
2. **Matchup** (live, final, the reveal), with **the player card**.
3. **Draft room** and the lobby.
4. **League** (Standings, Schedule, Playoffs, History).
5. **Portfolio**, the stock sheet / player card from Portfolio, and Buy a stock (search).
6. **Onboarding, invite, join.**
7. **The watchlist and claims surfaces**, when their plan builds them.

Nothing ships to TestFlight until every screen is on Game Night in both themes
(PRODUCT_RULES: "no screen mixes skins").

## 1. The capture set (incomplete without all of it)

- **Both themes, every capture.** A capture set with one theme fails the gate before review
  ("a screen is not approved in one theme without the other").
- **Devices:** the 17e and the 17 Pro, Large text. XL (`accessibility-extra-large`) on the
  screen's busiest state. Reduce Motion on the screen's main motion.
- **States:** the screen's list in §6 below, each in Light and Dark.
- **Recordings:** the screen's signature motion (§9C Motion), plus one tap through every
  tappable element (§4).
- **The stress fixture** (§9B): 20-character names, ≥ $1,000,000 values and losses, the
  longest ticker and company names in the universe, 16 managers where a list allows it.
- Captures live in `~/fantasy-stock-design-review/<branch>/`; the worker's README lists each
  file with its state and theme.

## 2. The reference check (the plan's new step)

For each screen, a table: the board frame it builds (`#call-game-night`, Dark and Light), the
reference it borrows from (Dark: Sleeper / ESPN / Robinhood; Light: E*TRADE / Yahoo), and the
borrowed traits **present** or **absent**, with evidence (a capture and a point measurement).
The squint test is run against the **reference**, not against 1.2.0. The `ux-reviewer` adds
the row "resembles its reference?" with evidence.

## 3. Hallmark (adopted in `hallmark-notes.md`)

- **Self-critique** on the screen as built: Philosophy · Hierarchy · Execution · Specificity ·
  Earned · Variety (here: does the screen read as the same system as the screens already
  approved?), 1–5; any < 3 is a revision before the gate is sent.
- **`hallmark audit`** punch list on the captures: tell · where · severity (critical → P1,
  major → P2, minor → P3) · fix.

## 4. "Nothing tappable does nothing" (checked at every gate)

The full audit (W8) runs once after the whole redesign; each gate still checks its own screen:
a table of every element that looks tappable (rows, chips, pills, chevrons, avatars, the
league pill, tabs, links, the player card's actions) → what it does, captured in the tap-
through recording. Anything that can't act in the current state is **hidden**, or **disabled
with the reason beside it**. A silent no-op is a P1.

## 5. The §9C mechanical checks (measure, never eyeball)

| Check | How | Fail if |
|---|---|---|
| Tokens only | grep the branch's changed files for `#[0-9A-Fa-f]{3,8}` and `rgba(` outside `constants/tokens/` | any colour literal in a component |
| Every fill has its own ink | for each fill on the screen (accent, you, loss-fill, your-side tint, clock cell, category pills, the band of a chip), name the `on*` token its text reads | text on a fill reads page text (`text`/`text2`) |
| Contrast | the worker's `contrastPairs.ts` test green in both themes (110 checks per theme as of W3); the board's `TOKEN_ROWS`/`PAIRS` and `themes.css` updated in the same change | a red test, the two lists differ, or `themes.css` differs from `color.ts` |
| Accent by area | `python3 ~/fantasy-stock-design-review/tools/game-night/app_accent_area.py <capture> <dark\|light> docs/design/tokens-v3-game-night.json` on every capture; the README gives two numbers per frame, with and without the screen's one primary action | accent > 5% of a frame NOT counting the screen's single primary action (Design Lead, W4 Home gate 2026-10-13: the primary is what the accent is for; it is a full-width pill, §9C). Data colours are reported apart. A second accent-filled control counts. |
| No rule lines between rows | inspect the row stack in the capture at 1:1 | a divider line between list rows (separation is space, surface or your side's tint) |
| Depth | Dark: page / card / inset are lightness steps, no shadows; Light: white cards with the rim on the tinted page, the sheet's shadow only | a drop shadow on Dark; a card without its rim |
| Numbers | game numbers ExtraBold (800); the Portfolio value Medium (500); everything tabular | a condensed Black number in the app; proportional digits in a column |
| Lines | edge to edge, stops at now, end dot in `live` with its halo, base line dashed; the 0-point and 1-point states captured (e.g. Monday before the first close, a stock bought today) | a blank frame, an axis or grid, a fill under a Game Night line |
| No sparklines on rows | Portfolio holdings, Matchup roster, watchlist, search rows | any small line on a row (the player card carries the lines) |
| Draft tiles | `surface` tile, the 3pt category line at the bottom, label row (pick · 3-letter code) | a colour-filled tile ("a carbon copy of Sleeper"); a sample sector instead of the app's category |
| Block rhythm | measured from pixels, glyph to glyph, in points (the existing gate step) | a flush stack; a gap off the token |
| Uppercase in the string | grep the changed files for `textTransform` | any `textTransform` (React Native measures before the transform and can clip the last glyph; uppercase with `.toUpperCase()`, §9C Type) |
| Shrink-to-fit floor | grep for `minimumFontScale` and check size × scale | any label that can shrink under 11pt; avatar initials under 11pt |
| 11pt floor, 44pt targets, drawn icons, colour never the only code | §9B (text tabs need `minWidth: 44`, not only `hitSlop`) | §9B |

## 6. Per screen: the states to capture and what to check

### Home
- **States:** every calm-Home state (ux-audit "Captures for the gate", items 1–11) in both
  themes; the season line with 0 points (week 1, Monday before the first close) and 1 point.
- **Check:** the team value is the one standout (`hero`, 46/800); This week is the rimmed card
  with 28pt scores and the "Live" chip; Standings is the rimmed card with your row's tint;
  24pt between blocks; the season chart top to bottom: the plot, the W/L marks, the two end
  dates (§9C X axis); the range tabs 8pt under that (the F1 rule).

### Matchup + the player card
- **States:** live while you lead and while you're BEHIND; final (won and lost); the reveal;
  Monday before the first close (rows in draft/slot order, every gain $0.00); an unslotted
  league (one list, best first, centre empty); a category league and a price-tier league
  (grouped by slot, the group header centred); a bye week; the playoffs; XL with the longest
  names.
- **Check:** the scoreboard is names, the two totals, who leads ("{name} leads by {margin}"),
  nothing else (no win %, bars, projections, records, chart); **your half and your roster
  column are shaded (`youTint`) in every state, win or lose, and nothing marks a row's winner**
  (Giorgio, 2026-10-12: "it's you … Not whoever's winning"); the order is recomputed at each
  market close and never re-sorts while you look (record a live update: the rows hold still);
  tap a row on either side → the player card.
- **The player card's states:** yours and theirs; drafted, bought and claimed ("How you got
  it" / "How they got it", at the BOTTOM, the price per share: "Drafted 2nd overall · Sep 29 ·
  $290.10", "Claimed off waivers · Oct 7 · $187.20", "Bought · Oct 2 · $214.80"); market open
  (yours: Sell, NEVER Save; theirs: Save / Saved) and closed (yours: Sell disabled with
  "Market's closed. Opens Mon 9:30 ET." beside it; theirs: Save); the owner's avatar inside the
  "Owned by" pill; a slotted league (the slot pill in the header); THREE key figures (Price ·
  Week gain · Since the draft, or "Since Oct 2" for a later buy); the season line on a date
  axis with no acquisition marker; this week on a Mon…Fri axis (days to come empty); a stock
  bought today (a 1-point season line, the full axis); XL; Reduce Motion (the sheet fades);
  VoiceOver reads the three figures with their labels.
- **Reference notes from Giorgio's own screenshots** (`~/fantasy-stock-design-review/
  references/espn-player-card-{1,2,3}.webp`): the owner's avatar is now drawn (approved); the
  week-by-week game log is "later" (not in this build); the gate does not flag its absence.
- **Carried from the W3 gate (2026-10-12): fixed before this gate is sent, each one checked.**
  - **The owner's disc shows ONE initial** (§9C Type: a disc under 24pt). Capture a wide pair
    ("Marco W." → "M") and "Gianluigi B." → "G" in both themes; a test in `sp-avatar.test.ts`.
  - **The card matches the board** (`directions.jsx`, the `PlayerCard` frame), three details:
    1. **"How you got it" sits in an `inset` panel** (radius 14, padding 12 / 14), its title as
       a `tag`-size label in `text2` (normal width, not the Expanded face), the line under it
       at 15/700, tabular. Not a headline over body text.
    2. **Save carries the drawn star** (18pt, outline) before the label. **Saved:** the same
       star filled, the label "Saved"; nothing else changes (no accent fill).
    3. **The Season title row carries its caption** on the right: "{entry price} → {price
       now}" ("$290.10 → $318.37") in `caption`, `text2`, tabular, on the title's baseline.
  - **No action can render without its handler.** Type `PlayerCardProps` so `onSell` is
    required for your own stock and `onToggleSave` for theirs (a discriminated union on
    `owner`); a disabled button only ever appears with its reason beside it. Every screen's X
    closes the sheet (the gallery's no-op X doesn't count, but no screen may copy it).
  - **RosterRow's VoiceOver label says whose half it is**: "Yours, NVDA …" / "Gianluigi B.,
    NKE …".
  - **The 4pt scale:** PlayerCard gap 14 → 16, Scoreboard padding 14 → 16, GroupHead 10 → 12
    and 5 → 4, RangePills tab gap 18 → 16 (measured glyph to glyph in the captures).
- **Not seen at W3, so first seen here** (the W3 captures were the gallery, inline):
  the card **as a sheet** (rising over `scrim`, Reduce Motion fades it; record both); **Sell
  enabled**, and the tap through it to the sell flow; **Save → Saved** and back; a
  **"Bought"** acquisition; a **price-tier slot pill** ("$100–$200") in the header; a stock
  **bought today** (the dated 0- and 1-point season line with its full axis); **VoiceOver**
  reading the three figures, the owner and the action; **XL** on the card (the figure labels
  wrap or hold at ≥ 11pt; "SINCE THE DRAFT" is the longest).

### Draft room + lobby
- **States:** on the clock (with the flash recorded in both themes), someone else's turn,
  after your pick, an auto-pick, the last 10 seconds, the room before the start, Draft
  complete; 16 managers; XL.
- **Check:** tiles per §5; the on-the-clock cell (`clockCell`, navy in both themes, the 2pt
  `live` ring, the pick number in `clockCellLive`); your turn in the accent (cyan / teal,
  decided); haptic and chime timing unchanged.

### League
- **States:** Standings in full (6 and 16 managers, ties, your row in the middle and at the
  bottom), Schedule, Playoffs (byes as rows of their round, GS-6; the champion row, GS-7),
  History; XL (names wrap onto two lines, the open P2).
- **Check:** each manager row a `surface` tile 6pt apart, your row `youTint` + the 1.5pt
  ring, bold name, no "(you)"; movement as drawn chevrons + number; season gain coloured by
  sign; no grid lines.

### Portfolio, the stock sheet, Buy a stock
- **States:** live, closed, cash from a sale, after a buy; the chart and range pills **only if
  Giorgio approves them** (open question); search with owned / available / no free slot rows.
- **Check:** the page is `moneyBg`; the value in `money` (Medium 500); no sparklines; the
  sector/slot pill on rows; the Alpaca credit on every price surface; the card opens from
  every row.

### Onboarding, invite, join
- **States:** each step; refusals (rule 8); the invite and the join preview (names nobody).
- **Check:** Yahoo's warmth in copy and avatars only; one primary per step; both themes.

## 7. Decided with Giorgio (2026-10-12), so a gate checks, never asks

Cyan your turn; "Since the draft"; the Portfolio chart and range pills; two end dates on Home;
price per share; the navy clock cell in Light; the owner's avatar on the card (the weekly log
later); the 11 categories; Matchup shading B (your side). A trait the reference check finds
absent that the board never drew is listed for Giorgio, not added.
