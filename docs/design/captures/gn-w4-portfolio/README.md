# W4 Portfolio, the stock sheet, Buy a stock and Trade history on Game Night: gate captures (`feat/gn-w4-portfolio`)

**Every frame here was captured on ONE build: app code `6eefc4ff`** (the DL gate pass), rebased
onto `origin/main` `e5fc97fb` as **`049a17f9`** with a byte-identical `apps/mobile/` tree
(`git diff 6eefc4ff 049a17f9 -- apps/mobile` is empty; main's #264/#265 changed docs only). The
previous set (mixed builds) was deleted, not kept. Every state is in **both themes**.

**How it was captured (headless).** Device access for my simulators wasn't granted, so nothing
was tapped by a finger:
- two simulators of my own, "W4 Portfolio 17e" and "W4 Portfolio 17 Pro" (iOS 27.0), Expo Go,
  Metro on port 8099; every configuration is a Metro restart (`--clear`) plus cold Expo Go
  launches; stills are `xcrun simctl io … screenshot`;
- the capture seam (`EXPO_PUBLIC_SHELL_FIXTURE=leagues`, `EXPO_PUBLIC_GAME_SEAM=1`) plays the
  Matchup fixture's league (Roberto B., Stock Scudetto, Thu Sep 24, 1:37 PM ET);
- **the "taps" are a DEV-only script** (`lib/money/captureScript.ts`, `EXPO_PUBLIC_CAPTURE_SCRIPT`):
  each step calls the SAME handler a finger would (a row's card, Sell, Review, Submit, a range
  pill, Search, a result, a filter, the chart scrub through the same `setScrubIndex` VoiceOver's
  adjust uses). Gated on `SEAM_ON` (a dev build AND the seam flag). Submit under the seam is
  answered locally (`recordTrade.ts`): nothing is ever written.
- Capture-only flags: `EXPO_PUBLIC_HOME_FIXTURE` (`live_open`, `live_closed`, `monday_preclose`,
  `xl_million`), `EXPO_PUBLIC_MATCHUP_FIXTURE` (`sold`, `bought`, `category`, `tiers`, `stress`),
  `EXPO_PUBLIC_PORTFOLIO_STAKE` (`budget_cap`, `budget_null`, `price_tiers`), `…_CAPTURE_DELAY_MS`
  (loading), `…_CAPTURE_FAIL=1` (failed), `…_CAPTURE_REFUSAL` (a review refusal),
  `…_CAPTURE_DRAFT_TODAY=1` (the draft-day season), `…_CAPTURE_LOSS=1` (every price mirrored
  below its draft price).

Large = `large`; XL = `accessibility-extra-large`; XXXL = `accessibility-extra-extra-extra-large`.
Fixture artifact: the fixture's fractional share counts make the per-slot notional read
**$2,000.01**.

## Portfolio

| Files | State | Shows |
|---|---|---|
| `p01-live-{1..5}-{17e,17pro}-*` | live | 1 Season (default): `moneyBg`; "Portfolio value"; the value in `money`; since the draft / today; the value line edge to edge on its dated axis, dashed base = the stake, live end dot; pills; "6 of 6 slots invested"; Buy a stock; holdings (disc · ticker · company · shares · value at 700 · today %). 2 **1W** (Mon…Fri from Friday's close; Fri empty). 3 1M. 4 Season again. 5 scrolled: all rows, Trade history, the credit. |
| `p02-closed-{1..3}-*` | `live_closed` | 1 static end dot. 2 the card: **Sell disabled, "Market's closed. Opens Fri 9:30 AM ET."**. 3 the sheet: **the same string**; "Drafted 2nd overall · Aug 31 · $290.10" (the card's line) in Your position; pill Buy \| Sell (neutral selected); Review sell disabled. |
| `p03-cash-from-sale-{1..4}-17e-*` | budget cap, V sold | "Cash from sales $2,032.68" (700); "$2,282.69 of your budget is left to spend."; **"+$113.74 · +0.93% today"** (the whole account's base, cash included; it read +1.12% before); 3 AMD's sheet ("Advanced Micro Devices"); 4 Review buy with budget rows + "Fills your Flex slot" + the credit. |
| `p04-after-buy-1-{17e,17pro}-*`, `p04-after-buy-scrolled-1-*` | budget cap, V sold, MSFT bought | No negative cash (defect b); "Your roster is full. Sell a holding first."; MSFT in the rows. |
| `p05-null-budget-{1,2}-17e-*` | `budget_null` (defects a, d) | "$0.00 of your budget is left to spend."; AMD's sheet: **"AMD costs more than your budget left."** in the warn panel, Review buy disabled, **Pick another stock** under it. |
| `p06-category-pills-{1..3}-17e-*` | category slots | Tech / Finance / Retail pills (Flex rows none); 3 the card with "Yours" + "Tech". |
| `p07-tier-pills-{1..3}-17e-*` | price tiers | "$200 or more" / "$100–$200" pills; COST's card. |
| `p08-loading-1-17e-*` | loading | The skeleton in the layout's shape. |
| `p08-failed-1-17e-*` | failed | "Your portfolio didn't load" + Try again. |
| `p08-during-draft-1-17e-*` | drafting | "Trading opens after the draft." + **Go to the draft room** (Home's shipped primary). |
| `p08-before-draft-{1,2}-17e-*` | before the draft (Serie A Traders) | The line + **"Sat, Oct 3 · 7:00 PM ET"** (Home's draft line); 2 = switched back to Stock Scudetto. |
| `p09-season-draft-day-1-{17e,17pro}-*` | drafted today (Thu 6 PM ET) | **The one-point Season line**: one live dot at the RIGHT end, above the stake's dashed base, on its one-date axis. |
| `p09-week-monday-preclose-1-*` | Monday 10:30 AM, before the first close, 1W | The week from Friday's close to now: the dot at Monday's first slot, Tue…Fri empty. Two points (Friday's close is a real point), so the y-scale spans them; the drop is −$39.29 ("today"). |
| `p09-bought-today-{1..3}-*` | MSFT bought today 10:05 AM | 1 the rows; 2 **MSFT's card**: "Since Sep 24", the one-point season line (the dot at the right end over the buy price), the week from the buy; 3 the sheet: "Bought · Sep 24 · $412.30". |
| `p10-loss-stress-{1,2}-{17e,17pro}-*` | ≥ $1M losses | **−$3,518,517.00 · −23.66% since the draft**, a red value line, every $1M+ row with its loss %. |
| `p11-stress-{large,xl,xxxl}-{1..3}-*` | ≥ $18M, the longest names, 7 holdings | 1 top: the value is the loudest text at every size; the sub-lines cap at 1.3× and never start with "·". 2 scrolled: the company truncates, **" · 13,500 sh" never does**; the credit stays a caption (capped). 3 the card. |

## Flows

| Files | Shows |
|---|---|
| `f01-card-flow-{1..5}-{17e,17pro}-*` | Large: row → NVDA's card → Sell → the sheet on Sell → Review sell → **Sold NVDA** on the `you` disc with Done + the credit. |
| `f02-card-flow-xl-{1..5}-*` | The same at XL on both phones. |
| `f03-refusal-conflict-1-17e-*` | `trade_conflict` at Submit: the warn panel and **Try again as the primary**. |

## Buy a stock (search)

| Files | Shows |
|---|---|
| `s01-search-empty-1-17e-*` | Empty: the field and its placeholder only (the hint that repeated the placeholder is gone). The keyboard was dismissed by the script, so the field shows its resting `rim` edge (the accent edge appears only while focused). |
| `s01-search-{2,3,4}-17e-*` | 2 "a": AAPL "You own this" (your colour), AMZN "Owned by Gianluigi B.", free stocks without status, the credit under the results. 3 "s": **SPY "Not in this league's list"**: only its disc and price dim; the reason is `text2` at full opacity; no chevron; not a button. 4 no match. |
| `s02-search-buy-{1..5}-17e-*` | Equal stakes, V's sale waiting: search → AMD → its sheet → Review buy (paid from the V slot) → Bought AMD. |
| `s03-sell-from-search-{1,2}-17e-*` | NVDA from search opens the same sheet on Sell (ruled A). |
| `s04-no-free-slot-{1,2}-17e-*` | Budget cap, every slot held: free stocks read "No free slot"; AMD's sheet says "Your roster is full. Sell a holding first." |

## Trade history (Game Night)

| Files | Shows |
|---|---|
| `h01-history-{1..3}-{17e,17pro}-*` | `moneyBg`; "‹ Portfolio"; title; pill filters (neutral selected); "Week of Sep 21" / "Draft · Aug 31"; rows: disc, "Bought MSFT" / "Sold V" / "Drafted NVDA", the time · shares at a price, the amount at 700; no rules; the credit. 2 Sells. 3 All again. |
| `h02-history-draft-only-1-17e-*` | A season with only draft picks. |
| `h03-history-empty-1-17e-*` | Sells with none: the app's line "No trades yet. Your buys, sells and draft picks will show here." (existing copy; it was written for the whole list, so under a filter it reads a little broad — flagged, not changed). |
| `h04-history-loading-1-17e-*`, `h05-history-failed-1-17e-*` | Skeleton rows; "Your portfolio didn't load" + Try again. |
| `h06-history-xl-1-17e-*` | XL: details wrap, the amounts hold. |

## Recordings (videos outside the repo, frame sheets here)

`~/fantasy-stock-design-review/feat-gn-w4-portfolio/`: `rec-scrub-{light,dark}.mov`,
`rec-row-card-sell-sheet-review-{light,dark}.mov`, `rec-search-buy-{light,dark}.mov`,
`rec-card-reduce-motion-{light,dark}.mov`.

| Frame sheet | Shows |
|---|---|
| `rec-scrub-{light,dark}-frames` | 0.5 s apart: **the Portfolio value chart scrubbed** (the line, the dot and "Sep 2 · $12,…" moving across), then NVDA's sheet and **its chart scrubbed** ("Mon · $303.00" → "Thu · $318.37"), then released. |
| `rec-row-card-sell-sheet-review-{light,dark}-frames` | 1 s apart: row → card rises → Sell → sheet → review → Sold NVDA. |
| `rec-search-buy-{light,dark}-frames` | 1 s apart: Portfolio → search → AMD → sheet → review → Bought AMD. |
| `rec-card-reduce-motion-{light,dark}-frames` | Reduce Motion ON, 0.1 s apart around the tap: the page, then the card in **one** frame step, lines already drawn. |

## Measurements (pixels, 3× → pt; `p01-live-1-17e-light`, identical on `-17pro-dark`)

Glyph to glyph: the axis dates → the pills 13.3; the pills → "6 of 6 slots invested" 26.0; that
line → the Buy a stock card's rim 26.0; the card → "Holdings" 28.7 (headline ascent; box gap
24); "Holdings" → the first row 11.7; rows 16.0 apart. The plot's lowest point → the dates 8.3.

**Accent by area** (the gate tool's rule; the second number sets apart the screen's ONE
primary pill): max without it **1.14%** (`p11-stress-xl-1-17e-dark`); max with it 5.55% (a sheet
with Review buy). Every frame is listed at the end.

## Every fill has its own ink

Selected range pill: `onAccent` on `accent`. Ticker disc: `text` on `inset`. Category pills:
`onCat` on `cat*`. Tier pill: `text` on `inset`. **Warn panel: `warnText` on `warnTint` over
`surface` — now a contrastPairs row in the app AND the board's PAIRS (Light 6.23, Dark 9.56;
113 checks per theme).** Confirmation: `onYou` on `you`. Buttons: `primaryFg`/`primaryBg`;
destructive `onYou`/`lossFill`. Segmented: `text` on the `surface` indicator over `sunken`.

## §2 Reference check (board `#call-game-night`, "Portfolio hero", as redrawn by the DL in #265)

| Reference | Trait | Present? | Evidence |
|---|---|---|---|
| Robinhood (Dark) | The value regular weight, big, then its line | Present (`money` 44/500) | `p01-*-1` |
| Robinhood | The line in the window's colour, no fill, no grid; red when down | Present | `p01`, `p10` |
| Robinhood | Range pills under the line | Present (1W · 1M · Season) | `p01-*-{1,2,3}` |
| Robinhood | Sparklines on holdings rows | **Absent by ruling** | `p01-*-5` |
| ESPN | Tapping a player opens the player card | Present | `f01`, `f02`, `p06-3`, `p09-2` |
| E*TRADE (Light) | Key figures on white, rimmed cards | Present | `*-light` |
| Board (#265) | The slot pill only in slotted leagues | Present (the DL's ruling: the rules win) | `p01` vs `p06`, `p07` |
| Squint vs Robinhood | The value loudest, the line second | Holds at Large, XL, XXXL, ≥ $1M gains and losses | `p10`, `p11` |

## §3 Self-critique (Hallmark, 1–5)

| Philosophy | Hierarchy | Execution | Specificity | Earned | Variety |
|---|---|---|---|---|---|
| 4 | 4 | 4 | 4 | 4 | 4 |

Same reading as the first pass; this pass removed the dead end before the draft, made each state
speak one string across card/sheet/review, and put Trade history on the same skin.

## §4 Tappables (element → what it does)

| Element | What it does | Evidence |
|---|---|---|
| League pill (header) | The league sheet (shell) | — |
| Range pills 1W / 1M / Season | Change the line's range | `p01-*-{1..4}` |
| The value chart | Long-press scrub (date · value) | `rec-scrub` |
| Buy a stock | Opens search | `s01`, `s02`, `rec-search-buy` |
| A holding row | Its player card (else the sheet, never dead) | `f01`, `f02` |
| Card Sell | Closes the card, opens the sheet on Sell; disabled with the reason when closed | `f01-2`, `p02-2` |
| Trade history | Opens Trade history | `h01` (opened by its route) |
| Go to the draft room (during the draft) | Opens League (the draft room) | `p08-during-draft` |
| Try again (failed) | Re-reads | `p08-failed`, `h05` |
| Sheet × | Closes | — |
| Sheet chart + pills 1W / 1M / 3M / 1Y | Scrub; change range | `rec-scrub`, `p02-3` |
| Buy \| Sell | Switches the action (held stocks only) | `f01-2` |
| Review sell / Review buy | Opens the review; disabled with its reason (closed, owned, full, over budget) | `f01`, `p02-3`, `p05`, `s04` |
| Pick another stock (over budget) | Closes the sheet (the review refusal's next step) | `p05-2` |
| Review: Edit / Sell NVDA / Buy AMD / Try again / Done | Back / submit / retry / close | `f01`, `s02`, `f03` |
| Search: ‹ Portfolio, a result | Back; its sheet | `s01`–`s04` |
| A "Not in this league's list" result | **Not a button** (no chevron, disabled state) | `s01-search-3` |
| History: ‹ Portfolio, filters | Back; filter | `h01` |

## The season-gain % basis (the Orchestrator's ruling: a correctness fix, every surface the same)

Every surface that divides by the stake uses teamValue's (which since defect (b) includes money
put in after the draft): **Home's hero "season gain %"** (`buildHomeViewModel` → `seasonGain(…,
teamValue(…).stake)`), **Portfolio's "since the draft %"** and **another manager's Portfolio**
(both `portfolioSummary` → teamValue). Pinned by `tests-deno/season-gain-basis.test.ts`.

## Not captured

- VoiceOver (labels pinned by tests).
- Real finger taps (no device grant): the same handlers, driven by the script.

## Accent by area, every frame

| Frame | Accent % (all) | Accent % (without the one primary) | Gain % | Loss % |
|---|---|---|---|---|
| `f01-card-flow-1-17e-dark` | 0.04 | 0.04 | 0.95 | 0.00 |
| `f01-card-flow-1-17e-light` | 0.04 | 0.04 | 0.93 | 0.00 |
| `f01-card-flow-1-17pro-dark` | 0.03 | 0.03 | 0.90 | 0.00 |
| `f01-card-flow-1-17pro-light` | 0.03 | 0.03 | 0.89 | 0.00 |
| `f01-card-flow-2-17e-dark` | 0.35 | 0.35 | 0.40 | 0.00 |
| `f01-card-flow-2-17e-light` | 0.35 | 0.35 | 0.40 | 5.21 |
| `f01-card-flow-2-17pro-dark` | 0.33 | 0.33 | 0.38 | 0.00 |
| `f01-card-flow-2-17pro-light` | 0.33 | 0.33 | 0.38 | 5.05 |
| `f01-card-flow-3-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-3-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-3-17pro-dark` | 5.12 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-3-17pro-light` | 5.12 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-4-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-4-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-4-17pro-dark` | 5.12 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-4-17pro-light` | 5.12 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-5-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-5-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-5-17pro-dark` | 5.12 | 0.00 | 0.00 | 0.00 |
| `f01-card-flow-5-17pro-light` | 5.12 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-1-17e-dark` | 0.04 | 0.04 | 1.33 | 0.00 |
| `f02-card-flow-xl-1-17e-light` | 0.04 | 0.04 | 1.32 | 0.00 |
| `f02-card-flow-xl-1-17pro-dark` | 0.03 | 0.03 | 1.32 | 0.00 |
| `f02-card-flow-xl-1-17pro-light` | 0.03 | 0.03 | 1.31 | 0.00 |
| `f02-card-flow-xl-2-17e-dark` | 0.39 | 0.39 | 0.74 | 0.00 |
| `f02-card-flow-xl-2-17e-light` | 0.39 | 0.39 | 0.73 | 0.00 |
| `f02-card-flow-xl-2-17pro-dark` | 0.37 | 0.37 | 0.69 | 0.00 |
| `f02-card-flow-xl-2-17pro-light` | 0.37 | 0.37 | 0.68 | 0.00 |
| `f02-card-flow-xl-3-17e-dark` | 5.17 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-3-17e-light` | 5.17 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-3-17pro-dark` | 5.02 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-3-17pro-light` | 5.02 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-4-17e-dark` | 5.17 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-4-17e-light` | 5.17 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-4-17pro-dark` | 5.02 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-4-17pro-light` | 5.02 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-5-17e-dark` | 5.17 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-5-17e-light` | 5.17 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-5-17pro-dark` | 5.02 | 0.00 | 0.00 | 0.00 |
| `f02-card-flow-xl-5-17pro-light` | 5.02 | 0.00 | 0.00 | 0.00 |
| `f03-refusal-conflict-1-17e-dark` | 5.26 | 0.03 | 0.00 | 0.00 |
| `f03-refusal-conflict-1-17e-light` | 5.26 | 0.03 | 0.00 | 0.00 |
| `h01-history-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h01-history-1-17e-light` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h01-history-1-17pro-dark` | 0.06 | 0.06 | 0.00 | 0.00 |
| `h01-history-1-17pro-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `h01-history-2-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h01-history-2-17e-light` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h01-history-2-17pro-dark` | 0.06 | 0.06 | 0.00 | 0.00 |
| `h01-history-2-17pro-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `h01-history-3-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h01-history-3-17e-light` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h01-history-3-17pro-dark` | 0.06 | 0.06 | 0.00 | 0.00 |
| `h01-history-3-17pro-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `h02-history-draft-only-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h02-history-draft-only-1-17e-light` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h03-history-empty-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h03-history-empty-1-17e-light` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h04-history-loading-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h04-history-loading-1-17e-light` | 0.07 | 0.07 | 0.00 | 0.00 |
| `h05-history-failed-1-17e-dark` | 4.63 | 0.07 | 0.00 | 0.00 |
| `h05-history-failed-1-17e-light` | 4.63 | 0.07 | 0.00 | 0.00 |
| `h06-history-xl-1-17e-dark` | 0.18 | 0.18 | 0.00 | 0.00 |
| `h06-history-xl-1-17e-light` | 0.18 | 0.18 | 0.00 | 0.00 |
| `p01-live-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p01-live-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p01-live-1-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `p01-live-1-17pro-light` | 0.81 | 0.81 | 0.55 | 0.00 |
| `p01-live-2-17e-dark` | 0.63 | 0.63 | 0.46 | 0.00 |
| `p01-live-2-17e-light` | 0.63 | 0.63 | 0.46 | 0.00 |
| `p01-live-2-17pro-dark` | 0.59 | 0.59 | 0.44 | 0.00 |
| `p01-live-2-17pro-light` | 0.59 | 0.59 | 0.44 | 0.00 |
| `p01-live-3-17e-dark` | 0.62 | 0.62 | 0.58 | 0.00 |
| `p01-live-3-17e-light` | 0.62 | 0.62 | 0.58 | 0.00 |
| `p01-live-3-17pro-dark` | 0.58 | 0.58 | 0.56 | 0.00 |
| `p01-live-3-17pro-light` | 0.58 | 0.58 | 0.55 | 0.00 |
| `p01-live-4-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p01-live-4-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p01-live-4-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `p01-live-4-17pro-light` | 0.81 | 0.81 | 0.55 | 0.00 |
| `p01-live-5-17e-dark` | 0.27 | 0.27 | 0.15 | 0.03 |
| `p01-live-5-17e-light` | 0.28 | 0.28 | 0.15 | 0.03 |
| `p01-live-5-17pro-dark` | 0.26 | 0.26 | 0.14 | 0.03 |
| `p01-live-5-17pro-light` | 0.26 | 0.26 | 0.14 | 0.03 |
| `p02-closed-1-17e-dark` | 0.86 | 0.86 | 0.59 | 0.00 |
| `p02-closed-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p02-closed-1-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `p02-closed-1-17pro-light` | 0.81 | 0.81 | 0.55 | 0.00 |
| `p02-closed-2-17e-dark` | 0.04 | 0.04 | 0.96 | 0.00 |
| `p02-closed-2-17e-light` | 0.04 | 0.04 | 0.94 | 0.00 |
| `p02-closed-2-17pro-dark` | 0.03 | 0.03 | 0.92 | 0.00 |
| `p02-closed-2-17pro-light` | 0.03 | 0.03 | 0.90 | 0.00 |
| `p02-closed-3-17e-dark` | 0.35 | 0.35 | 0.42 | 0.00 |
| `p02-closed-3-17e-light` | 0.35 | 0.35 | 0.42 | 0.00 |
| `p02-closed-3-17pro-dark` | 0.33 | 0.33 | 0.39 | 0.00 |
| `p02-closed-3-17pro-light` | 0.33 | 0.33 | 0.39 | 0.00 |
| `p03-cash-from-sale-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p03-cash-from-sale-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p03-cash-from-sale-2-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p03-cash-from-sale-2-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p03-cash-from-sale-3-17e-dark` | 5.55 | 0.35 | 0.29 | 0.00 |
| `p03-cash-from-sale-3-17e-light` | 5.55 | 0.35 | 0.29 | 0.00 |
| `p03-cash-from-sale-4-17e-dark` | 5.24 | 0.03 | 0.00 | 0.00 |
| `p03-cash-from-sale-4-17e-light` | 5.24 | 0.03 | 0.00 | 0.00 |
| `p04-after-buy-1-17e-dark` | 0.86 | 0.86 | 0.60 | 0.00 |
| `p04-after-buy-1-17e-light` | 0.86 | 0.86 | 0.59 | 0.00 |
| `p04-after-buy-1-17pro-dark` | 0.81 | 0.81 | 0.57 | 0.00 |
| `p04-after-buy-1-17pro-light` | 0.81 | 0.81 | 0.57 | 0.00 |
| `p04-after-buy-scrolled-1-17e-dark` | 0.56 | 0.56 | 0.15 | 0.03 |
| `p04-after-buy-scrolled-1-17e-light` | 0.56 | 0.56 | 0.15 | 0.03 |
| `p04-after-buy-scrolled-1-17pro-dark` | 0.79 | 0.79 | 0.14 | 0.03 |
| `p04-after-buy-scrolled-1-17pro-light` | 0.79 | 0.79 | 0.14 | 0.03 |
| `p05-null-budget-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p05-null-budget-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p05-null-budget-2-17e-dark` | 0.35 | 0.35 | 0.29 | 0.00 |
| `p05-null-budget-2-17e-light` | 0.35 | 0.35 | 0.29 | 0.00 |
| `p06-category-pills-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p06-category-pills-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p06-category-pills-2-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p06-category-pills-2-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p06-category-pills-3-17e-dark` | 0.04 | 0.04 | 0.95 | 0.00 |
| `p06-category-pills-3-17e-light` | 0.04 | 0.04 | 0.93 | 0.00 |
| `p07-tier-pills-1-17e-dark` | 0.86 | 0.86 | 0.62 | 0.00 |
| `p07-tier-pills-1-17e-light` | 0.86 | 0.86 | 0.61 | 0.00 |
| `p07-tier-pills-2-17e-dark` | 0.86 | 0.86 | 0.62 | 0.00 |
| `p07-tier-pills-2-17e-light` | 0.86 | 0.86 | 0.61 | 0.00 |
| `p07-tier-pills-3-17e-dark` | 0.04 | 0.04 | 0.98 | 0.00 |
| `p07-tier-pills-3-17e-light` | 0.04 | 0.04 | 0.97 | 0.00 |
| `p08-before-draft-1-17e-dark` | 0.12 | 0.12 | 0.00 | 0.00 |
| `p08-before-draft-1-17e-light` | 0.12 | 0.12 | 0.00 | 0.00 |
| `p08-before-draft-2-17e-dark` | 0.84 | 0.84 | 0.58 | 0.00 |
| `p08-before-draft-2-17e-light` | 0.84 | 0.84 | 0.56 | 0.00 |
| `p08-during-draft-1-17e-dark` | 5.29 | 0.18 | 0.00 | 0.00 |
| `p08-during-draft-1-17e-light` | 5.29 | 0.19 | 0.00 | 0.00 |
| `p08-failed-1-17e-dark` | 4.75 | 0.18 | 0.00 | 0.00 |
| `p08-failed-1-17e-light` | 4.75 | 0.18 | 0.00 | 0.00 |
| `p08-loading-1-17e-dark` | 0.18 | 0.18 | 0.00 | 0.00 |
| `p08-loading-1-17e-light` | 0.18 | 0.18 | 0.00 | 0.00 |
| `p09-bought-today-1-17e-dark` | 0.86 | 0.86 | 0.57 | 0.00 |
| `p09-bought-today-1-17e-light` | 0.86 | 0.86 | 0.57 | 0.00 |
| `p09-bought-today-1-17pro-dark` | 0.81 | 0.81 | 0.54 | 0.00 |
| `p09-bought-today-1-17pro-light` | 0.81 | 0.81 | 0.54 | 0.00 |
| `p09-bought-today-2-17e-dark` | 0.04 | 0.04 | 0.45 | 0.00 |
| `p09-bought-today-2-17e-light` | 0.04 | 0.04 | 0.44 | 0.00 |
| `p09-bought-today-2-17pro-dark` | 0.03 | 0.03 | 0.42 | 0.00 |
| `p09-bought-today-2-17pro-light` | 0.03 | 0.03 | 0.41 | 0.00 |
| `p09-bought-today-3-17e-dark` | 0.35 | 0.35 | 0.38 | 0.00 |
| `p09-bought-today-3-17e-light` | 0.35 | 0.35 | 0.38 | 5.21 |
| `p09-bought-today-3-17pro-dark` | 0.33 | 0.33 | 0.36 | 0.00 |
| `p09-bought-today-3-17pro-light` | 0.33 | 0.33 | 0.35 | 5.05 |
| `p09-season-draft-day-1-17e-dark` | 0.86 | 0.86 | 0.24 | 0.00 |
| `p09-season-draft-day-1-17e-light` | 0.86 | 0.86 | 0.23 | 0.00 |
| `p09-season-draft-day-1-17pro-dark` | 0.81 | 0.81 | 0.23 | 0.00 |
| `p09-season-draft-day-1-17pro-light` | 0.81 | 0.81 | 0.22 | 0.00 |
| `p09-week-monday-preclose-1-17e-dark` | 0.63 | 0.63 | 0.12 | 0.21 |
| `p09-week-monday-preclose-1-17e-light` | 0.63 | 0.63 | 0.12 | 0.21 |
| `p09-week-monday-preclose-1-17pro-dark` | 0.59 | 0.59 | 0.11 | 0.19 |
| `p09-week-monday-preclose-1-17pro-light` | 0.59 | 0.59 | 0.11 | 0.19 |
| `p10-loss-stress-1-17e-dark` | 0.86 | 0.86 | 0.00 | 0.58 |
| `p10-loss-stress-1-17e-light` | 0.86 | 0.86 | 0.00 | 0.58 |
| `p10-loss-stress-1-17pro-dark` | 0.81 | 0.81 | 0.00 | 0.55 |
| `p10-loss-stress-1-17pro-light` | 0.81 | 0.81 | 0.00 | 0.55 |
| `p10-loss-stress-2-17e-dark` | 0.19 | 0.19 | 0.00 | 0.18 |
| `p10-loss-stress-2-17e-light` | 0.20 | 0.20 | 0.00 | 0.18 |
| `p10-loss-stress-2-17pro-dark` | 0.26 | 0.26 | 0.00 | 0.17 |
| `p10-loss-stress-2-17pro-light` | 0.26 | 0.26 | 0.00 | 0.17 |
| `p11-stress-large-1-17e-dark` | 0.86 | 0.86 | 0.59 | 0.00 |
| `p11-stress-large-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `p11-stress-large-1-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `p11-stress-large-1-17pro-light` | 0.81 | 0.81 | 0.56 | 0.00 |
| `p11-stress-large-2-17e-dark` | 0.19 | 0.19 | 0.19 | 0.00 |
| `p11-stress-large-2-17e-light` | 0.20 | 0.20 | 0.18 | 0.00 |
| `p11-stress-large-2-17pro-dark` | 0.26 | 0.26 | 0.18 | 0.00 |
| `p11-stress-large-2-17pro-light` | 0.26 | 0.26 | 0.17 | 0.00 |
| `p11-stress-large-3-17e-dark` | 0.04 | 0.04 | 1.02 | 0.00 |
| `p11-stress-large-3-17e-light` | 0.04 | 0.04 | 1.01 | 0.00 |
| `p11-stress-large-3-17pro-dark` | 0.03 | 0.03 | 1.00 | 0.00 |
| `p11-stress-large-3-17pro-light` | 0.03 | 0.03 | 0.98 | 0.00 |
| `p11-stress-xl-1-17e-dark` | 1.14 | 1.14 | 0.73 | 0.00 |
| `p11-stress-xl-1-17e-light` | 1.14 | 1.14 | 0.72 | 0.00 |
| `p11-stress-xl-1-17pro-dark` | 1.07 | 1.07 | 0.69 | 0.00 |
| `p11-stress-xl-1-17pro-light` | 1.07 | 1.07 | 0.68 | 0.00 |
| `p11-stress-xl-2-17e-dark` | 0.27 | 0.27 | 0.34 | 0.00 |
| `p11-stress-xl-2-17e-light` | 0.27 | 0.27 | 0.34 | 0.00 |
| `p11-stress-xl-2-17pro-dark` | 0.26 | 0.26 | 0.32 | 0.00 |
| `p11-stress-xl-2-17pro-light` | 0.26 | 0.26 | 0.32 | 0.00 |
| `p11-stress-xl-3-17e-dark` | 0.02 | 0.02 | 1.59 | 0.00 |
| `p11-stress-xl-3-17e-light` | 0.02 | 0.02 | 1.58 | 0.00 |
| `p11-stress-xl-3-17pro-dark` | 0.03 | 0.03 | 1.53 | 0.00 |
| `p11-stress-xl-3-17pro-light` | 0.03 | 0.03 | 1.52 | 0.00 |
| `p11-stress-xxxl-1-17e-dark` | 1.14 | 1.14 | 0.73 | 0.00 |
| `p11-stress-xxxl-1-17e-light` | 1.14 | 1.14 | 0.72 | 0.00 |
| `p11-stress-xxxl-1-17pro-dark` | 1.07 | 1.07 | 0.69 | 0.00 |
| `p11-stress-xxxl-1-17pro-light` | 1.07 | 1.07 | 0.68 | 0.00 |
| `p11-stress-xxxl-2-17e-dark` | 0.27 | 0.27 | 0.34 | 0.00 |
| `p11-stress-xxxl-2-17e-light` | 0.27 | 0.27 | 0.34 | 0.00 |
| `p11-stress-xxxl-2-17pro-dark` | 0.26 | 0.26 | 0.32 | 0.00 |
| `p11-stress-xxxl-2-17pro-light` | 0.26 | 0.26 | 0.32 | 0.00 |
| `p11-stress-xxxl-3-17e-dark` | 0.02 | 0.02 | 1.59 | 0.00 |
| `p11-stress-xxxl-3-17e-light` | 0.02 | 0.02 | 1.58 | 0.00 |
| `p11-stress-xxxl-3-17pro-dark` | 0.03 | 0.03 | 1.53 | 0.00 |
| `p11-stress-xxxl-3-17pro-light` | 0.03 | 0.03 | 1.52 | 0.00 |
| `s01-search-2-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `s01-search-2-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `s01-search-3-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `s01-search-3-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `s01-search-4-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `s01-search-4-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `s01-search-empty-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `s01-search-empty-1-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `s02-search-buy-1-17e-dark` | 0.45 | 0.11 | 0.00 | 0.00 |
| `s02-search-buy-1-17e-light` | 0.45 | 0.11 | 0.00 | 0.00 |
| `s02-search-buy-2-17e-dark` | 5.55 | 0.35 | 0.29 | 0.00 |
| `s02-search-buy-2-17e-light` | 5.55 | 0.35 | 0.29 | 0.00 |
| `s02-search-buy-3-17e-dark` | 5.24 | 0.03 | 0.00 | 0.00 |
| `s02-search-buy-3-17e-light` | 5.24 | 0.03 | 0.00 | 0.00 |
| `s02-search-buy-4-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `s02-search-buy-4-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `s02-search-buy-5-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `s02-search-buy-5-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `s03-sell-from-search-1-17e-dark` | 0.45 | 0.11 | 0.00 | 0.00 |
| `s03-sell-from-search-1-17e-light` | 0.45 | 0.11 | 0.00 | 0.00 |
| `s03-sell-from-search-2-17e-dark` | 0.35 | 0.35 | 0.40 | 0.00 |
| `s03-sell-from-search-2-17e-light` | 0.35 | 0.35 | 0.40 | 5.21 |
| `s04-no-free-slot-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `s04-no-free-slot-1-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `s04-no-free-slot-2-17e-dark` | 0.35 | 0.35 | 0.29 | 0.00 |
| `s04-no-free-slot-2-17e-light` | 0.35 | 0.35 | 0.29 | 0.00 |
