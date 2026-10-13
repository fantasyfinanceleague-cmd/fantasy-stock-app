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
| Every fill has its own ink | for each fill on the screen (accent, you, loss-fill, lit, lead wash, clock cell, tiles, the band of a chip), name the `on*` token its text reads | text on a fill reads page text (`text`/`text2`) |
| Contrast | the worker's `contrastPairs.ts` test green in both themes; the board's `PAIRS` updated in the same change | a red test, or the two lists differ |
| Accent by area | `python3 ~/fantasy-stock-design-review/tools/game-night/app_accent_area.py <capture> <dark\|light> docs/design/tokens-v3-game-night.json` on every capture | accent > 5% of a frame (data colours are reported apart) |
| No rule lines between rows | inspect the row stack in the capture at 1:1 | a divider line between list rows (separation is space, surface or the lit slab) |
| Depth | Dark: page / card / inset are lightness steps, no shadows; Light: white cards with the rim on the tinted page, the sheet's shadow only | a drop shadow on Dark; a card without its rim |
| Numbers | game numbers ExtraBold (800); the Portfolio value Medium (500); everything tabular | a condensed Black number in the app; proportional digits in a column |
| Lines | edge to edge, stops at now, end dot in `live` with its halo, base line dashed; the 0-point and 1-point states captured (e.g. Monday before the first close, a stock bought today) | a blank frame, an axis or grid, a fill under a Game Night line |
| No sparklines on rows | Portfolio holdings, Matchup roster, watchlist, search rows | any small line on a row (the player card carries the lines) |
| Draft tiles | `surface` tile, the 3pt sector line at the bottom, label row (pick · sector) | a colour-filled tile ("a carbon copy of Sleeper") |
| Block rhythm | measured from pixels, glyph to glyph, in points (the existing gate step) | a flush stack; a gap off the token |
| 11pt floor, 44pt targets, drawn icons, colour never the only code | §9B | §9B |

## 6. Per screen: the states to capture and what to check

### Home
- **States:** every calm-Home state (ux-audit "Captures for the gate", items 1–11) in both
  themes; the season line with 0 points (week 1, Monday before the first close) and 1 point.
- **Check:** the team value is the one standout (`hero`, 46/800); This week is the rimmed card
  with 28pt scores and the "Live" chip; Standings is the rimmed card with your row's tint;
  24pt between blocks; the range tabs 8pt under the marks (the F1 rule).

### Matchup + the player card
- **States:** live; final; the reveal; Monday before the first close (rows in draft/slot
  order, every gain $0.00, no lit slab); an unslotted league (one list, best first, centre
  empty); a category league and a price-tier league (grouped by slot, the group header
  centred); a tied pair (equal week gain: neither half lit); a sweep (one side wins every
  row); a bye week; the playoffs; XL with the longest names.
- **Check:** the scoreboard is names, the two totals, who leads (the leader's half in
  `leadWash` + "{name} leads by {margin}"), nothing else (no win %, bars, projections,
  records, chart); the order is recomputed at each market close and never re-sorts while you
  look (record a live update: the rows hold still); tap a row on either side → the player card.
- **The player card's states:** yours and theirs; drafted, bought and claimed ("How you got
  it" / "How they got it": "Drafted 2nd overall · Sep 29 · $290.10", "Claimed off waivers ·
  Oct 7 · $187.20", "Bought · Oct 2 · $214.80"); market open (yours: Sell; theirs: Save /
  Saved) and closed (yours: Sell disabled with "Market's closed. Opens Mon 9:30 ET." beside
  it; theirs: Save); a slotted league (the slot pill in the header); a stock bought today (a
  1-point season line); the acquisition marker inside the line, not only at its start; XL;
  Reduce Motion (the sheet fades); VoiceOver reads the four key figures with their labels.
- **Reference notes from Giorgio's own screenshots** (`~/fantasy-stock-design-review/
  references/espn-player-card-{1,2,3}.webp`): ESPN shows the owning team **with its avatar**
  under the name, a **five-figure strip** in an outlined card, and a week-by-week game log
  (zebra rows). The board card has the owner as a pill without an avatar and four figures;
  the gate notes these as absent traits, for Giorgio, not as findings.

### Draft room + lobby
- **States:** on the clock (with the flash recorded in both themes), someone else's turn,
  after your pick, an auto-pick, the last 10 seconds, the room before the start, Draft
  complete; 16 managers; XL.
- **Check:** tiles per §5; the on-the-clock cell (`clockCell`, the 2pt `live` ring, the pick
  number in `clockCellLive`); the your-turn colour as Giorgio rules it (accent or gold: a
  three-key swap, §9C); haptic and chime timing unchanged.

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

## 7. Open with Giorgio (a gate never decides these)

- The your-turn colour: accent (drawn) or the approved gold.
- The player card's figure label: "Since the draft" (drawn) or "Season gain".
- Portfolio's chart and range pills.
- Any trait the reference check finds absent and the board never drew (e.g. the owner's
  avatar in the card, a weekly game log): listed for him, not added.
