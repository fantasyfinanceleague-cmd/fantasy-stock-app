# Design — Stockpile · studied DNA (source: the five references)

<!-- Hallmark · studied: yes · DNA-source: image (App Store + sleeper.com marketing captures, 2026-10-12)
     theme: studied-DNA (not locked) · scope: native iOS app, Dark first -->

**What this is.** The machine-readable record of what the five reference apps Giorgio named
actually do on screen, extracted with `hallmark study` (image mode, vision pass + pixel
sampling) on 2026-10-12 by the Design Lead. [`REFERENCES.md`](REFERENCES.md) is the
human-readable record; this file is the one the three W1 directions and the v3 token spec
(DESIGN_DIRECTION §9C, after Giorgio picks) build on.

**What this is not.** It is not a locked design system. Hallmark normally writes `design.md`
at a project root, where its pre-flight treats it as locked; this file lives in `docs/design/`
on purpose, because nothing is locked until Giorgio picks a direction and §9C is written.
Product rules ([`../PRODUCT_RULES.md`](../PRODUCT_RULES.md)), the UX rules, the calm-Home
structure ruling and DESIGN_DIRECTION §4/§5/§9B all outrank anything here.

## Provenance

- **Mode:** image. Each screenshot was opened at full resolution and colours were read from
  the pixels (5×5 median samples), not estimated by eye, except where marked *est.*
- **Sources** (public marketing images; viewed there, not copied into the repo):

  | # | Reference screen | Image |
  |---|---|---|
  | S1 | Sleeper · matchup (fantasy football) | `sleeper.com/web-public/images/marketing-pages/fantasy-football/matchup_mobile.webp` |
  | S2 | Sleeper · mobile draft board | `…/fantasy-football/draft_mobile.webp` |
  | S3 | ESPN Fantasy · matchup scoreboard | App Store id555376968, shot 1 (`Matchup-6_5…png`) |
  | S4 | Robinhood · portfolio hero | App Store id938003185, shot 4 (`ios-1242x2208_ALT.jpg`, "$1,500.00") |
  | S5 | E*TRADE · account header | App Store **id313259740**, shot 1 (`…_5.5_1.png`, "Net Assets $37,843.45") |

- **Attestation:** public references for our own product (Giorgio's list, 2026-10-12), so
  emission is allowed. Nothing here copies a source's pixels, imagery, copy or brand
  colour as ours; the DNA is shape, role, proportion and colour *behaviour*.
- **Confidence:** colours exact to the marketing render (JPEG/WebP, so ±2–3 per channel);
  sizes are approximate (marketing captures are 2× or 3× renders, converted to points);
  typefaces are named by role, never identified.
- **Two corrections to REFERENCES.md** (the screenshots disagree with its prose):
  - ESPN's matchup header has **no bars and no percentages**. It is a logo at each edge,
    two heavy numerals, then name · manager · record with a green streak "(W3)". The
    bars-and-% header is Sleeper's alone.
  - Sleeper's on-the-clock draft cell is **near-black** (darker than the page) with
    "ON THE CLOCK" and a timer glyph, not yellow. Yellow appears in S1 only as the
    "vs GB" live-game text.
  - Also: REFERENCES.md links E*TRADE as `id311627216`, which returns 404. The live listing
    is `id313259740`.

## The five diagnoses

Hallmark's web vocabulary (macrostructures, nav/footer archetypes) does not describe native
app screens, so each source is named by its **native screen archetype** instead.

### S1 · Sleeper matchup — "scoreboard card over a mirrored roster"

- **Surface:** flat deep navy page `#06091d` · oklch(15% 0.043 273). The header is a
  raised card one step lighter `#0a0f29` · oklch(18% 0.053 272), rimmed by a lighter navy
  edge `#253255` · oklch(32% 0.065 267), radius ≈ 12pt, inset 8pt from the screen edges.
  The bottom sheet sits at `#191f3d` · oklch(25% 0.057 273). **Depth comes from three
  lightness steps of one hue (273°), not from shadow, gradient or glow.**
- **Accent system:** the leader is mint `#02e7c3` · oklch(83% 0.155 176), the trailer is pink
  `#d86486` · oklch(65% 0.149 4); the user's avatar ring is blue `#048efb` · oklch(64% 0.19
  252). Inactive text is slate `#526683` · oklch(51% 0.052 258). Accent footprint ≈ 3% of
  the viewport: bars, win-% numerals, one pill.
- **Header anatomy (left ↔ right mirrored):** a large avatar (≈ 30pt, ringed) at each outer
  edge · score in heavy white (≈ 26pt) with the projection under it in slate · a win-% label
  in the team's colour over a 3pt bar (filled to the %, slate track) · name (≈ 17pt, 700)
  · handle + seed + record in slate · an emblem badge in the centre gutter.
  Below the card: a live play strip, then "Yet to play" counts and a dot pager.
- **Roster anatomy:** "Starters" (≈ 18pt, 700) left, a week stepper right in mint. Each row
  is **one matchup line**: your player (name 17pt/700, points 19pt/800, projection small) |
  a 26pt rounded-square **position pill** in the centre column | their player, mirrored.
  Rows are ≈ 64–90pt tall. **There are no divider lines**; rows are separated by space, and
  one row half is lit by a **tint slab** `#051f38` · oklch(24% 0.058 250) that bleeds off
  the screen edge, with only its inner corners rounded.
- **Type roles:** a heavy, slightly rounded grotesque for names and scores (800); the same
  family at 500 for meta lines. Single family. Lowercase segment tabs ("match · team ·
  players · league"), the selected one white 700 with a short 3pt pill underline.
- **Rhythm:** dense inside a row, generous between rows. Left-aligned on the left half and
  right-aligned on the right, so the page reads as two teams facing each other across the centre column.
- **Motion:** not visible (static capture).
- **Do not carry:** the chat sheet and its avatars (no chat in the product); the six-tab
  game-hub bar; projections and win probability (no such data here, and the Matchup
  ruling forbids added elements); the live play strip; stat lines under each name.

### S2 · Sleeper draft board — "tile board under a sheet"

- **Surface:** page `#0f172f` · oklch(21% 0.049 268); the bottom sheet (players / queue /
  team / chat) at `#1a244a` · oklch(27% 0.071 270) with a 20pt top radius, overlapping the
  board.
- **The board:** a grid of **flat, saturated tiles** with 2pt gaps and ≈ 4pt radius, each
  coloured by position: WR blue `#3ecaee` · oklch(78% 0.126 219), RB mint `#3ce1cc`
  · oklch(82% 0.135 182), TE orange `#f4bb87` · oklch(83% 0.094 63), QB pink `#be6796`
  · oklch(63% 0.124 348). **Text on tiles is dark navy, not white**: a small label row
  ("WR-DAL(8)" + "1.1" right), first name 600, last name 800 larger, a snake arrow
  bottom-right. Empty future cells are the page colour; the **on-the-clock cell is darker
  than the page**, with "ON THE CLOCK" in white heavy caps and a timer glyph.
- **Your turn:** a cyan pill "YOUR TURN" (*est.* `#5eeeee`, dark text, caps, ≈ 11pt)
  centred over a large white timer (≈ 20pt, 700, tabular). Above the board, a scrolling row of
  manager avatars (≈ 22pt) with names; yours reads "You" in white, others slate.
- **The list:** filter chips are 44pt circles, label + count ("QB 0/1"), the selected one
  white with dark text; rows carry a cyan **DRAFT** pill with a soft outer glow on the
  left, the rank in slate, name 17pt/700, a coloured dot + "WR - DET (9)", and two right
  columns with tiny caps labels (ADP, PTS) over 17pt/700 numerals.
- **Do not carry:** chat tab; ADP/PTS columns (no equivalent here); the glow on every row's
  pill (one glowing element per screen at most, see Merged DNA).

### S3 · ESPN matchup — "broadcast scoreboard over a cell grid"

- **Surface:** near-black page `#101113` · oklch(18% 0.004 264), panels `#1d1e1f`
  · oklch(23% 0.002 248). Chroma is almost zero: a charcoal, not a navy.
- **Header:** no card. A team logo (≈ 30pt) at each outer edge; the two scores as the
  **largest type on the screen** (≈ 36pt, heavy, tabular) beside their logos; team name
  (≈ 17pt) then "manager | 7-2-0 (W3)" in grey with the streak in green. Above it, a
  segmented strip of other matchups ("League Scores", "191.0 vs 91.0") as rounded pills,
  the current one outlined in white.
- **Roster:** "STARTERS" and "WEEK 12" as small uppercase labels on a darker band. Then
  **each player is its own panel**: two columns of panels with a 4pt gutter of page
  colour, and a narrow centre column (≈ 20pt) carrying a one-letter slot ("F", "D").
  State is coded by a **tinted panel + a 3pt bar on the panel's outer edge**: red tint
  `#301b1c` · oklch(25% 0.033 17) with a red bar, amber tint `#2c261c` · oklch(27% 0.020 80)
  with an amber bar. Points sit on the inner edge, beside the centre column, so the two
  sides' numbers face each other.
- **Type roles:** a heavy sans for scores; regular/600 for names; small uppercase for
  section labels. Tabular numerals throughout.
- **Rhythm:** dense and even; the grid is the rhythm.
- **Do not carry:** the brand blue frame (marketing only); three lines of sport stats per
  cell; the slot letters (no positions, per Giorgio).

### S4 · Robinhood portfolio — "the number and the line"

- **Surface:** pure black `#000000` · oklch(0% 0 0) is 96.5% of the screen area.
- **Accent:** one neon lime `#c4f400` · oklch(90% 0.221 123), ≈ 1% of the area: the line,
  the change line's ▲ and amount, the selected range pill. White text ≈ 1%.
- **Hero anatomy:** label ("Crypto", ≈ 22pt, 400) · the number ("$1,500.00", ≈ 34pt,
  **regular weight**, white) · a change line in the accent ("▲ $0.2800 (26.47%)") + "Today"
  in white · the chart: a single ≈ 2pt line, no axis, no grid, no fill, **running past the
  left margin to the screen edge**, and **stopping at "now"** with an end dot in a soft
  halo, leaving the rest of the day's x-axis empty · range pills (LIVE · 1D · 1W · 1M ·
  3M · YTD · 1Y) spread across the full width; the selected one is a filled lime rounded
  rect with black text, the others lime text.
- **Rhythm:** generous; left-aligned; the chart takes about a third of the screen height.
- **The lesson:** the line stops at now, so an early-in-the-day chart is short, never
  blank. That is the 0-and-1-point design the handoff asks for, already solved.
- **Do not carry:** the marketing headline type; crypto/prediction content.

### S5 · E*TRADE account header — "brand bar + key figures"

- **Surface:** a deep indigo header band `#241056` · oklch(25% 0.117 288) under white cards
  on a light grey page (a Light-theme reference).
- **Header anatomy:** "Net Assets" label over "$37,843.45" (≈ 22pt, regular, white) left;
  a vertical rule; "Day's Gain" over "$909.07" in mint `#5fe0b0` · oklch(82% 0.134 166).
  Under it, an index strip of three figures (DOW · NASDAQ · S&P 500), each with a **4pt
  vertical bar in its performance colour** (green `#008100`) on its left: label, value,
  change.
- **Key figures card:** label left, value right, gains coloured, numerals right-aligned
  and tabular ("Net Account Value … $37,843.45").
- **Do not carry:** the purple; the news/video modules.

## Merged DNA (by surface, never averaged)

Hallmark's own rule is "one source, one diagnosis": blending five references is how you
get template soup. So the merge is **scoped**: each surface takes ONE backbone source, and
the others contribute named traits only.

| Surface | Backbone | Traits borrowed from the others |
|---|---|---|
| Game (Home in season, Matchup, League, Run it back) | S1 Sleeper | S3's facing numerals beside the centre column; S3/S5's outer-edge state bar |
| Draft room | S2 Sleeper | Yahoo's "your turn" warmth (copy and avatars only) |
| Money (Portfolio, stock sheet, watchlist) | S4 Robinhood | S5's key-figures list and right-aligned tabular numbers |

**Recurring DNA across all five** (these are the system, whichever direction wins):

1. **Depth from lightness steps of one hue.** S1 uses three navy steps (15 → 18 → 25% L)
   at one hue; S3 two charcoal steps; S4 none at all. No reference uses drop shadows on a
   dark surface. Our dark neutrals take a hue (≥ 0.005 chroma, Hallmark gate 22); the
   direction decides which.
2. **Separation by surface, never by lines.** No reference draws a rule between rows. S1
   uses space plus a tint slab, S3 uses a gutter between panels, S4 uses space alone. This
   is Giorgio's standings complaint ("not even good … dividing the columns and rows")
   answered: rows divide by surface and rhythm.
3. **One meaningful accent, small footprint (1–3%).** Lime (S4), cyan (S2), mint/pink
   pair (S1). The accent marks a state (live, your turn, selected, leading), never decoration.
4. **The number is the biggest thing, and the weight says what kind of number.** Game
   scores are heavy (S1/S3, 800+); money values are regular weight (S4/S5, 400–500).
   This maps onto Archivo already: `score.*` at 62%/900 or 100%/800 for game numbers,
   100%/400–500 for money heroes.
5. **Mirrored halves meet at a centre column.** S1 and S3 both put your side left and theirs
   right, with each side's number on its inner edge so the two numbers face each other
   across a narrow centre column. For us the centre column holds **nothing**, or at most
   the tier/category pill (both are drawn; Giorgio picks). Never a position.
6. **State on the outer edge.** S3 (panels) and S5 (index strip) both code a cell's state
   with a 3–4pt vertical bar on its outer edge plus a faint tint. It is cheap, colour-blind
   safe when paired with a sign, and doesn't compete with the numbers.
7. **Avatars at the edges, with presence.** Large (≥ 30pt) and ringed for you / live / on the
   clock (S1, S2).
8. **A chart is one line, edge to edge, that stops at now.** No axis, grid or fill; the end
   dot carries the live state (S4).
9. **Range pills spread full width,** the selected one filled in the accent (S4).
10. **Colour-coded tiles with dark text** for categories (S2): saturated fills (≈ 78–83% L),
    navy text on top, 2pt gaps, small radius.

## Studied tokens (candidates, not yet ours)

```css
/* Values as observed. Direction A/B/C each pick ONE paper family; §9C names roles. */
--studied-navy-0:    oklch(15% 0.043 273);  /* S1 page */
--studied-navy-1:    oklch(18% 0.053 272);  /* S1 card */
--studied-navy-2:    oklch(25% 0.057 273);  /* S1 sheet / S2 sheet ≈ 27% */
--studied-navy-rim:  oklch(32% 0.065 267);  /* S1 card edge */
--studied-slate:     oklch(51% 0.052 258);  /* S1 inactive text */
--studied-charcoal-0: oklch(18% 0.004 264); /* S3 page */
--studied-charcoal-1: oklch(23% 0.002 248); /* S3 panel */
--studied-black:     oklch(0% 0 0);         /* S4 page (pure black is the brand here) */
--studied-mint:      oklch(83% 0.155 176);  /* S1 leader / S5 gain ≈ 82% 0.134 166 */
--studied-pink:      oklch(65% 0.149 4);    /* S1 trailer */
--studied-cyan:      oklch(88% 0.14 195);   /* S2 YOUR TURN / DRAFT, est. */
--studied-lime:      oklch(90% 0.221 123);  /* S4 accent */
--studied-blue-ring: oklch(64% 0.19 252);   /* S1 you-ring */
--studied-tint-win:  oklch(24% 0.058 250);  /* S1 lit half-row */
--studied-tint-loss: oklch(25% 0.033 17);   /* S3 red panel */
--studied-tile-blue: oklch(78% 0.126 219);  --studied-tile-mint: oklch(82% 0.135 182);
--studied-tile-orange: oklch(83% 0.094 63); --studied-tile-pink: oklch(63% 0.124 348);
```

Shapes: card radius ≈ 12pt (S1), tile radius ≈ 4pt (S2), sheet radius 20pt (S2), pills full
round, position/tier pill a 26pt rounded square (S1). Type stays **Archivo** (the board may
argue a second display face, naming its cost; the references show no case that needs one).

## How the three W1 directions use this

Each direction has ONE primary source (Hallmark's rule), so they read as three systems,
not three palettes on one system.

| Direction | Primary | Paper | Accent | Game numerals | Row separation |
|---|---|---|---|---|---|
| A · Game Night | S1/S2 Sleeper | navy steps 15/18/25% at 273° | cyan for live/your turn; mint/pink lead pair | heavy, normal width | space + tint slab off the edge |
| B · Broadcast | S3 ESPN | charcoal 18/23%, near-neutral | one league colour as the frame; red/green panel tints | heaviest, largest on screen | panels with a gutter + outer-edge state bar |
| C · Terminal | S4 Robinhood | pure black | one neon (lime family) for line, selected, emphasis | game scores heavy, money regular | space alone |

## Binding constraints the references do NOT override

- **Matchup** (Giorgio 2026-10-12, verbatim in PRODUCT_RULES): scoreboard header (names,
  the two totals, who leads) + mirrored two-column roster, each row's week performance.
  **No** win-% chips, bars, projections, live strip, "yet to play", chat, positions or race
  chart, in any direction. S1's header shape is borrowed for its *arrangement*
  (avatars at edges, scores inside, name + record under), not for its extra modules. A
  lead indicator, if essential, goes to Giorgio as its own "Your call", not into a direction.
- **Calm-Home structure** stays: one standout number, the chart under it, This week →
  Matchup, Standings → League, 24pt between blocks, one primary per screen.
- **§9B native craft floor** (11pt floor, 44pt targets, drawn icons not glyphs, colour never
  the only code, Reduce Motion), §4 motion, §5 Reduce Motion.
- **Every chart has a designed 0-point and 1-point state** (S4's "stops at now" is the model).

## Notes · anti-patterns the references carry that we must not

- Gradient glow surfaces (Sleeper's picks side; excluded by Giorgio).
- Glow on every repeated control (S2's DRAFT pills): at most ONE lit element per screen,
  and only when it means "you, now" (your turn, live).
- Fabricated data modules: projections, win probability, stat lines. We have none of that
  data; inventing it fails Hallmark gate 46 (honest copy) and our "verify the effect" rule.
- Six-tab hub bars and chat strips.
- Brand colours used as ours (ESPN blue, E*TRADE purple, Robinhood lime as-is): each
  direction derives its own accent; the studied value is the behaviour, not the hex.
