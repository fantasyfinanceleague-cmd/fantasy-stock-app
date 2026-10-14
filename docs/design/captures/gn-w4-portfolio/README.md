# W4 Portfolio, the stock sheet and Buy a stock on Game Night: gate captures (`feat/gn-w4-portfolio`)

Gate evidence for **Portfolio** (the hero, the dated value line with range pills, cash, Buy a
stock, the holdings rows that open the **player card**), the **stock sheet** (Buy | Sell, the
review, the confirmation, refusals) and **search** (results with owners, "No free slot", no
match, search → buy, sell-from-search). Every state is in **both themes** (`-light` / `-dark`).

**How it was captured (headless).** Device access for my simulators wasn't granted this session
(reported to the Orchestrator), so nothing here was tapped by the harness. Instead:
- two simulators of my own, "W4 Portfolio 17e" and "W4 Portfolio 17 Pro" (iOS 27.0, clones of
  the Matchup sims), Expo Go, Metro on port 8099; every fixture switch is a Metro restart plus a
  cold Expo Go launch; stills are `xcrun simctl io … screenshot`;
- the capture seam (`EXPO_PUBLIC_SHELL_FIXTURE=leagues`, `EXPO_PUBLIC_GAME_SEAM=1`) plays the
  Matchup fixture's league (Roberto B., Stock Scudetto, Thursday Sep 24, 1:37 PM ET), so
  Portfolio, its player cards and the sheet agree with the gated Matchup captures;
- **the "taps" are a DEV-only script** (`lib/money/captureScript.ts`,
  `EXPO_PUBLIC_CAPTURE_SCRIPT="card:NVDA@8000,sell@20000,review@32000,submit@40000"`): each step
  calls the SAME handler a finger would (open the row's card, the card's Sell, Review, Submit,
  a range pill, Search, a result). Gated on `SEAM_ON` (a dev build AND the seam flag); production
  never runs it. Submit under the seam is answered locally (`recordTrade.ts`): nothing is ever
  written. Metro logs each step (`[capture] sell @20000 ran`).
- Other capture-only flags: `EXPO_PUBLIC_HOME_FIXTURE` (`live_open`, `live_closed`,
  `xl_million`), `EXPO_PUBLIC_MATCHUP_FIXTURE` (`sold`, `bought`, `category`, `tiers`, `stress`),
  `EXPO_PUBLIC_PORTFOLIO_STAKE` (`budget_cap`, `budget_null` = a budget cap whose
  `budget_amount` is NULL, `price_tiers`), `EXPO_PUBLIC_CAPTURE_DELAY_MS` (loading),
  `EXPO_PUBLIC_CAPTURE_FAIL=1` (failed), `EXPO_PUBLIC_CAPTURE_REFUSAL` (a review refusal).

Text sizes: Large = `large`; XL = `accessibility-extra-large`; XXXL =
`accessibility-extra-extra-extra-large`. A fixture artifact to ignore: the Matchup fixture's
fractional share counts make the per-slot notional read **$2,000.01** (it's $2,000 ± rounding).

## Portfolio

| Files | State | Shows |
|---|---|---|
| `01-live-open-1-{17e,17pro}-{light,dark}` | live, Season (default) | `moneyBg` page; "Portfolio value"; the value in `money` (44/500); "+$343.51 · +2.86% since the draft", "+$121.27 · +0.99% today"; the value line edge to edge on its dated axis (Aug 31 → Sep 24), dashed base = the stake, live end dot; pills 1W · 1M · Season; "6 of 6 slots invested"; Buy a stock; Holdings rows (disc, ticker, company · shares, value, today %), no sparklines, no rules. |
| `01-live-open-2-*` | 1W | The trading week on **Mon…Fri**, from Friday's close; the line stops at Thursday-now; Fri stays empty. |
| `01-live-open-3-*` | 1M | Dated axis (the season is under a month old, so it starts at the draft). |
| `08-category-pills-1-17e-*`, `17-stress-*-scrolled-*` | scrolled | All the rows, Trade history (a rimmed card), the Alpaca credit. |
| `02-closed-top-1-*` | `live_closed` (Thu 8 PM) | The end dot static (no breathing); the same figures at Thursday's close. |
| `02-closed-2-17e-*` | card, closed | **Sell disabled with "Market's closed. Opens Fri 9:30 AM ET." beside it.** |
| `02-closed-3-17e-*` | stock sheet, closed | Review sell disabled, "Trading opens Fri 9:30 AM ET." beside it; the 1W line ends at Thursday's close (today's close is the price; no bar yet). |
| `03-cash-from-sale-{1..4}-17e-*` | budget cap, V sold Tue, nothing bought | "Portfolio value · includes cash", **"Cash from sales $2,032.68"**, "$2,282.69 of your budget is left to spend." (budget left ≥ cash from sales, as it must be); 3 = AMD's sheet; 4 = **Review buy**: Budget now $2,282.69, Budget left after $2,122.69, "Fills your Flex slot". |
| `04-after-buy-1-*` | budget cap, V sold, MSFT bought | **Defect (b)**: no "Cash from sales −$X" line; the value is the holdings ($12,376.22); "Your roster is full. Sell a holding first." on Buy a stock. |
| `07-null-budget-{1,2}-17e-*` | `budget_null` (defects **(d)** and **(a)**) | The NULL cap reads as the server's $0 cap: "$0.00 of your budget is left to spend."; AMD's sheet: **"AMD costs more than your budget left."** in the warn panel, Review buy disabled under it, before any review. |
| `08-category-pills-{1,2}-17e-*` | category slots | Tech / Finance / Retail pills on the slotted rows (Flex rows carry none); the card shows "Yours" + "Tech". |
| `09-tier-pills-{1,2}-17e-*` | price tiers | "$200 or more" / "$100–$200" pills on every row; COST's card. |
| `10-loading-1-17e-*` | loading | The skeleton in the real layout's shape (hero, plot, pills, four rows). |
| `11-failed-1-17e-*` | the ledger read fails | "Your portfolio didn't load" + Try again (the app's LoadFailure). |
| `12-before-draft-1-17e-*` | the league is drafting | "Trading opens after the draft." (existing copy, no new words). |
| `17-stress-{large,xl,xxxl}[-scrolled]-{17e,17pro}-*` | §9B stress: $18,391,842.00, the longest listed names, 7 holdings | The value fits (RollingMoney shrink-to-fit); the sub-lines cap at 1.3× and never start a line with "·"; rows hold the full figure and truncate the company. |
| `17-stress-{large,xl,xxxl}-card-*` | the card from the stress row | The gated PlayerCard (W3/Matchup) unchanged: the figures stack at XL. |

## The player card from Portfolio, and Sell → the sheet

| Files | Shows |
|---|---|
| `06-card-flow-{1..6}-17e-*` | 1 the row → **NVDA's player card** (yours: Sell; three figures; season line; this week Mon…Fri; "How you got it" at the bottom); 2 **Sell** → the card leaves, the **stock sheet** rises on Sell ("Sell all 6.8942 sh ≈ $2,194.91", Review sell); 3 **Review sell**; 4–5 Submit → **"Sold NVDA"** on the `you` disc (onYou check) + Done; 6 the page behind scrolled. |
| `18-flow-large-{1..3}-{17e,17pro}-*` | The same flow on both phones at Large (card, sheet, review). |
| `19-flow-xl-{1..4}-{17e,17pro}-*` | The same at **XL**: the card's figures stack; the sheet's price stays the loudest (its small text caps at 1.6×); the review's labels wrap, values never truncate. |
| `20-refusal-conflict-1-17e-*` | A refusal at Submit (`trade_conflict`): the warn panel ("Nothing was traded: …") and Try again; nothing was written. |

## Buy a stock (search)

| Files | Shows |
|---|---|
| `13-search-empty-1-17e-*` | Focused field (accent edge), the board's hint "Type a ticker (AMZN) or a company name (Amazon)." |
| `13-search-2-17e-*` | "a": AAPL **"You own this"** in your colour; AMZN "Owned by Gianluigi B."; free stocks with no status; prices at 800, chevrons. |
| `13-search-3-17e-*` | No match: "No stock matches “zzz”." + "Check the ticker, or try the company name." |
| `14-search-buy-{1..5}-17e-*` | Equal stakes, V's sale waiting: search → AMD → its sheet (Buy) → **Review buy** ("Buy $2,032.68 of AMD", paid from the V slot) → **"Bought AMD"**. |
| `15-sell-from-search-{1,2}-17e-*` | **Sell-from-search (ruled A)**: NVDA from search opens the same sheet, on Sell. |
| `16-no-free-slot-{1,2}-17e-*` | Budget cap, every slot held: free stocks read **"No free slot"** (still tappable); AMD's sheet says "Your roster is full. Sell a holding first." with Review buy disabled. |

## Recordings (videos outside the repo, frame sheets here)

Videos: `~/fantasy-stock-design-review/feat-gn-w4-portfolio/` (`rec-row-card-sell-sheet-review-dark.mov`,
`rec-search-buy-light.mov`, `rec-card-reduce-motion-dark.mov`).

| Frame sheet | Shows |
|---|---|
| `rec-row-card-sell-sheet-review-dark-frames` | 0.5 s apart: row → card rises → Sell → sheet → Review sell → Sold NVDA. |
| `rec-search-buy-light-frames` | 1 s apart: Portfolio → Buy a stock → "a" → AMD → sheet → review → Bought AMD. |
| `rec-card-rises-dark-frames` | 0.1 s apart: the card **rising** with its lines drawing in. |
| `rec-card-reduce-motion-dark-frames` | Reduce Motion ON: the card is there in **one** frame step (no rise, no draw-in); the launch frames showed no failure flash (see the bug below). |

## Measurements (from pixels, 3× → pt; `01-live-open-1-17e-light`, the same on 17 Pro dark)

Glyph to glyph: the axis dates → the pills 13.3pt; the pills → "6 of 6 slots invested" 26.0;
that line → the Buy a stock card's rim 26.0; the card → "Holdings" 28.7 (headline ascent: the box
gap is 24); "Holdings" → the first row 11.7; rows 16.0 apart (space, no rules). The plot's lowest
point → the dates 8.3 (the Chart's own 6pt + label ascent).

**Accent by area** (app_accent_area.py's rule: ΔRGB ≤ 45, every 2nd pixel; the second number
sets apart the screen's ONE primary, a full-width accent pill). Max without the primary: **1.14%**
(the stress frames: the Season pill + the live dot + Buy a stock). Max with it: 5.55% (a sheet
with Review buy). Every frame is listed at the end.

## Every fill has its own ink

The selected range pill: `onAccent` on `accent` (RangePills `pills`). The ticker disc: `text` on
`inset`. Category pills: `onCat` on `cat*`. Price-tier pill: `text` on `inset`. The warn panel:
`warnText` on `warnTint` (`warnLine` edge). The confirmation check: `onYou` on `you` (a
contrastPairs row; it was `text` on `text2` — fixed in this branch). Review buy / Done: the Button
primary (`primaryFg` on `primaryBg`); Review sell / Sell NVDA: destructive (`onYou` on `lossFill`).

## §2 Reference check (board `#call-game-night`, "Portfolio hero", A amended)

| Reference | Trait | Present? | Evidence |
|---|---|---|---|
| Robinhood (Dark), the portfolio hero | The value regular weight, big, then its line | Present (`money` 44/500) | `01-*` |
| Robinhood | The line in the day's colour, no fill, no grid | Present (`gain`/`loss` by the window's sign; dashed base) | `01-*-{1,2,3}` |
| Robinhood | Range pills under the line, the selected one filled | Present (1W · 1M · Season; Giorgio "yes", 2026-10-12) | `01-*-{1,2,3}` |
| Robinhood | Sparklines on holdings rows | **Absent by ruling** ("No sparklines on rows") | `01-*`, `08-*-1` |
| ESPN | Tapping a player opens the player card | Present (every row) | `06`, `18`, `19` |
| E*TRADE (Light) | Key figures on white, rimmed cards | Present (the card's strip; Buy a stock / Trade history rimmed) | `*-light` |
| Board frame | "Holdings" + "Value · today"; disc, ticker, pill, company · shares, value, today % | Present | `01`, `08`, `09` |
| Board frame | A category pill on every row | Present only in **slotted** leagues (PRODUCT_RULES: "the slot pill"); unslotted rows carry none | `01` vs `08` |
| Squint vs Robinhood | The value is the loudest thing; the line second | Holds at Large, XL, XXXL and ≥ $1M | `17-*` |

## §3 Self-critique (Hallmark, 1–5)

| Philosophy | Hierarchy | Execution | Specificity | Earned | Variety |
|---|---|---|---|---|---|
| 4 | 4 | 4 | 4 | 4 | 4 |

Philosophy: the money screen as Robinhood draws it, inside a fantasy app (the card is ESPN's).
Hierarchy: the value, then the line, then what you can spend, then the roster; XL/XXXL keep it
(the sub-lines and every caption cap). Execution: rows divide by space, cards by rim, one button
shape (pills). Specificity: real stake modes and their real money (cash from sales vs budget
left, the $0 cap). Earned: no decoration; the line is the only graphic. Variety: the same Chart,
RangePills, PlayerCard, rimmed Card and disc as Home and Matchup. Nothing under 3.

## §4 Tappables (element → what it does)

| Element | What it does | Evidence |
|---|---|---|
| League pill (header) | The league sheet (shell, unchanged) | — |
| Range pills 1W / 1M / Season | Change the line's range (the selected one doesn't re-fire) | `01-*-{1,2,3}` |
| The chart | Long-press scrub (date · value); VoiceOver steps the points | (gesture; not scripted) |
| Buy a stock | Opens search | `13`, `14`, `rec-search-buy` |
| A holding row | Its **player card** (or, if the week's data didn't load, the stock sheet — never a dead tap) | `06`, `18`, `19`, `rec-row-card…` |
| Card × | Closes the card | (the card's own; gated at Matchup) |
| Card Sell | Closes the card, opens the sheet on Sell; **disabled with the reason** when closed | `06-card-flow-2`, `02-closed-2` |
| Trade history | Opens the history screen | `08-category-pills-1` (not scripted) |
| Try again (failed) | Re-reads the ledger and prices | `11` |
| Sheet × | Closes the sheet | — |
| Sheet range pills 1W / 1M / 3M / 1Y | Change the stock's line | `02-closed-3`, `18-*-2` |
| Buy \| Sell (held stocks only) | Switches the action | `06-card-flow-2` |
| Review sell / Review buy | Opens the review; **disabled with its reason** (closed market, owned, roster full, over budget) | `06`, `02-closed-3`, `07`, `16` |
| Review: Edit | Back to the sheet | `06-card-flow-3` |
| Review: Sell NVDA / Buy AMD | Submits | `06-card-flow-4`, `14-*-4` |
| Review: Try again / Pick another stock / Go to Portfolio | A refusal's next step | `20` |
| Done | Closes the sheet | `06-card-flow-5` |
| Search: ‹ Portfolio | Back | `13` |
| A search result | Its sheet (yours on Sell; others on Buy, blocked with the reason where it can't buy) | `14`, `15`, `16` |
| A "Not in this league's list" result | **Not a button**: dimmed, no chevron, the reason on its line | (no such stock in the seam's sample) |

## The four money defects (from the auto-pick review)

- **(a)** record-trade's preview `would_fill` ignores the budget (it says so: "minus the
  budget/roster checks (the client shows those itself)"), and the client didn't check, so the
  review offered buys the server refused as `over_budget`, showing "Budget left after −$X". Fixed
  client-side only (no edge-function change): `stockSheetModel` refuses a share over the budget
  left before any review ("{SYMBOL} costs more than your budget left.", the app's existing
  refusal copy), and the review's own build refuses again. `07-null-budget-2`.
- **(b)** `teamValue` kept stake = draft cost and let cash go negative, so a net buy inside the
  budget read "Cash from sales −$X". Now a net buy is capital put in (stake grows), cash never
  goes negative; the gain is unchanged. Home, Portfolio, the buy row and the draft room agree:
  `03` (cash $2,032.68 ≤ budget left $2,282.69), `04` (no negative line).
- **(c)** `components/TradeModal.tsx` was imported only by two theme tests: deleted; the tests
  point at the draft room's field; the architecture flow "Buy or sell a stock" now anchors on the
  stock sheet's real trade path (it had been anchored on TradeModal).
- **(d)** a NULL `budget_amount` is a $0 cap on the server (`Number(budgetAmount) || 0`) but
  "unknown" on the client. **Chosen: the client agrees with the server** —
  `effectiveBudgetCap()` returns the server's expression for budget_cap, used by the buy row,
  the sheet, the review and the draft room's caption. `07-null-budget-1`.

## Bugs the captures found (fixed here)

- **"Your portfolio didn't load" flashed at every launch** (and stuck for as long as a slow
  ledger took): the hook set `error` before the session/leagues were read and never reset it
  while loading, and the ledger hook reported the previous league's error for one render.
  Fixed in `usePortfolioData` / `usePortfolioLedger`; `rec-card-reduce-motion` shows the clean
  splash → skeleton → content.
- At XL/XXXL the hero's sub-lines rivalled the value and a "·" started a line; the Alpaca credit
  outgrew the value at XXXL. Capped (1.3× on Portfolio, 1.6× in the sheet/review/search).
- The confirmation check was `text` on a `text2` disc (low contrast in both themes).
- The closed-market 1W stock line stopped at Wednesday.

## Not captured

- VoiceOver (labels pinned in code: each row, the hero lines, the figures).
- Real finger taps (no device grant): the flows are the same handlers, driven by the script.
- The chart scrub gesture.
- A "Not in this league's list" result (the seam's search sample has none; the row is a
  non-button by construction).

## Accent by area, every frame

| Frame | Accent % (all) | Accent % (without the one primary) | Gain % | Loss % |
|---|---|---|---|---|
| `01-live-open-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `01-live-open-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `01-live-open-1-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `01-live-open-1-17pro-light` | 0.81 | 0.81 | 0.55 | 0.00 |
| `01-live-open-2-17e-dark` | 0.63 | 0.63 | 0.46 | 0.00 |
| `01-live-open-2-17e-light` | 0.63 | 0.63 | 0.46 | 0.00 |
| `01-live-open-2-17pro-dark` | 0.59 | 0.59 | 0.44 | 0.00 |
| `01-live-open-2-17pro-light` | 0.59 | 0.59 | 0.44 | 0.00 |
| `01-live-open-3-17e-dark` | 0.62 | 0.62 | 0.58 | 0.00 |
| `01-live-open-3-17e-light` | 0.62 | 0.62 | 0.58 | 0.00 |
| `01-live-open-3-17pro-dark` | 0.58 | 0.58 | 0.56 | 0.00 |
| `01-live-open-3-17pro-light` | 0.58 | 0.58 | 0.55 | 0.00 |
| `02-closed-2-17e-dark` | 0.04 | 0.04 | 0.96 | 0.00 |
| `02-closed-2-17e-light` | 0.04 | 0.04 | 0.94 | 0.00 |
| `02-closed-3-17e-dark` | 0.35 | 0.35 | 0.42 | 0.00 |
| `02-closed-3-17e-light` | 0.35 | 0.35 | 0.42 | 0.00 |
| `02-closed-top-1-17e-dark` | 0.86 | 0.86 | 0.59 | 0.00 |
| `02-closed-top-1-17e-light` | 0.86 | 0.86 | 0.58 | 0.00 |
| `02-closed-top-1-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `02-closed-top-1-17pro-light` | 0.81 | 0.81 | 0.55 | 0.00 |
| `03-cash-from-sale-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `03-cash-from-sale-1-17e-light` | 0.86 | 0.86 | 0.57 | 0.00 |
| `03-cash-from-sale-2-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `03-cash-from-sale-2-17e-light` | 0.86 | 0.86 | 0.57 | 0.00 |
| `03-cash-from-sale-3-17e-dark` | 5.55 | 0.35 | 0.29 | 0.00 |
| `03-cash-from-sale-3-17e-light` | 5.55 | 0.35 | 0.29 | 0.00 |
| `03-cash-from-sale-4-17e-dark` | 5.24 | 0.03 | 0.00 | 0.00 |
| `03-cash-from-sale-4-17e-light` | 5.24 | 0.03 | 0.00 | 0.00 |
| `04-after-buy-1-17e-dark` | 0.86 | 0.86 | 0.60 | 0.00 |
| `04-after-buy-1-17e-light` | 0.86 | 0.86 | 0.59 | 0.00 |
| `04-after-buy-1-17pro-dark` | 0.81 | 0.81 | 0.57 | 0.00 |
| `04-after-buy-1-17pro-light` | 0.81 | 0.81 | 0.57 | 0.00 |
| `06-card-flow-1-17e-dark` | 0.04 | 0.04 | 0.95 | 0.00 |
| `06-card-flow-1-17e-light` | 0.04 | 0.04 | 0.93 | 0.00 |
| `06-card-flow-2-17e-dark` | 0.35 | 0.35 | 0.40 | 0.00 |
| `06-card-flow-2-17e-light` | 0.35 | 0.35 | 0.40 | 5.21 |
| `06-card-flow-3-17e-dark` | 0.03 | 0.03 | 0.00 | 0.00 |
| `06-card-flow-3-17e-light` | 0.03 | 0.03 | 0.00 | 5.21 |
| `06-card-flow-4-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `06-card-flow-4-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `06-card-flow-5-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `06-card-flow-5-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `06-card-flow-6-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `06-card-flow-6-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `07-null-budget-1-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `07-null-budget-1-17e-light` | 0.86 | 0.86 | 0.57 | 0.00 |
| `07-null-budget-2-17e-dark` | 0.35 | 0.35 | 0.29 | 0.00 |
| `07-null-budget-2-17e-light` | 0.35 | 0.35 | 0.29 | 0.00 |
| `08-category-pills-1-17e-dark` | 0.27 | 0.27 | 0.15 | 0.03 |
| `08-category-pills-1-17e-light` | 0.28 | 0.28 | 0.43 | 0.03 |
| `08-category-pills-2-17e-dark` | 0.04 | 0.04 | 0.95 | 0.00 |
| `08-category-pills-2-17e-light` | 0.04 | 0.04 | 0.93 | 0.00 |
| `09-tier-pills-1-17e-dark` | 0.44 | 0.44 | 0.15 | 0.03 |
| `09-tier-pills-1-17e-light` | 0.44 | 0.44 | 0.15 | 0.03 |
| `09-tier-pills-2-17e-dark` | 0.04 | 0.04 | 0.98 | 0.00 |
| `09-tier-pills-2-17e-light` | 0.04 | 0.04 | 0.97 | 0.00 |
| `10-loading-1-17e-dark` | 0.18 | 0.18 | 0.00 | 0.00 |
| `10-loading-1-17e-light` | 0.18 | 0.18 | 0.00 | 0.00 |
| `11-failed-1-17e-dark` | 4.75 | 0.18 | 0.00 | 0.00 |
| `11-failed-1-17e-light` | 4.75 | 0.18 | 0.00 | 0.00 |
| `12-before-draft-1-17e-dark` | 0.18 | 0.18 | 0.00 | 0.00 |
| `12-before-draft-1-17e-light` | 0.19 | 0.19 | 0.00 | 0.00 |
| `13-search-2-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `13-search-2-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `13-search-3-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `13-search-3-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `13-search-empty-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `13-search-empty-1-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `14-search-buy-1-17e-dark` | 0.45 | 0.11 | 0.00 | 0.00 |
| `14-search-buy-1-17e-light` | 0.45 | 0.11 | 0.00 | 0.00 |
| `14-search-buy-2-17e-dark` | 5.55 | 0.35 | 0.29 | 0.00 |
| `14-search-buy-2-17e-light` | 5.55 | 0.35 | 0.29 | 0.00 |
| `14-search-buy-3-17e-dark` | 5.24 | 0.03 | 0.00 | 0.00 |
| `14-search-buy-3-17e-light` | 5.24 | 0.03 | 0.00 | 0.00 |
| `14-search-buy-4-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `14-search-buy-4-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `14-search-buy-5-17e-dark` | 5.28 | 0.00 | 0.00 | 0.00 |
| `14-search-buy-5-17e-light` | 5.28 | 0.00 | 0.00 | 0.00 |
| `15-sell-from-search-1-17e-dark` | 0.45 | 0.11 | 0.00 | 0.00 |
| `15-sell-from-search-1-17e-light` | 0.45 | 0.11 | 0.00 | 0.00 |
| `15-sell-from-search-2-17e-dark` | 0.35 | 0.35 | 0.40 | 0.00 |
| `15-sell-from-search-2-17e-light` | 0.35 | 0.35 | 0.40 | 5.21 |
| `16-no-free-slot-1-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `16-no-free-slot-1-17e-light` | 0.06 | 0.06 | 0.00 | 0.00 |
| `16-no-free-slot-2-17e-dark` | 0.35 | 0.35 | 0.29 | 0.00 |
| `16-no-free-slot-2-17e-light` | 0.35 | 0.35 | 0.29 | 0.00 |
| `17-stress-large-17e-dark` | 0.86 | 0.86 | 0.58 | 0.00 |
| `17-stress-large-17e-light` | 0.86 | 0.86 | 0.57 | 0.00 |
| `17-stress-large-17pro-dark` | 0.81 | 0.81 | 0.56 | 0.00 |
| `17-stress-large-17pro-light` | 0.81 | 0.81 | 0.56 | 0.00 |
| `17-stress-large-card-17e-dark` | 0.04 | 0.04 | 1.02 | 0.00 |
| `17-stress-large-card-17e-light` | 0.04 | 0.04 | 1.01 | 0.00 |
| `17-stress-large-card-17pro-dark` | 0.03 | 0.03 | 1.00 | 0.00 |
| `17-stress-large-card-17pro-light` | 0.03 | 0.03 | 0.98 | 0.00 |
| `17-stress-large-scrolled-17e-dark` | 0.19 | 0.19 | 0.19 | 0.00 |
| `17-stress-large-scrolled-17e-light` | 0.20 | 0.20 | 0.18 | 0.00 |
| `17-stress-large-scrolled-17pro-dark` | 0.26 | 0.26 | 0.18 | 0.00 |
| `17-stress-large-scrolled-17pro-light` | 0.26 | 0.26 | 0.17 | 0.00 |
| `17-stress-xl-17e-dark` | 1.14 | 1.14 | 0.73 | 0.00 |
| `17-stress-xl-17e-light` | 1.14 | 1.14 | 0.72 | 0.00 |
| `17-stress-xl-17pro-dark` | 1.07 | 1.07 | 0.69 | 0.00 |
| `17-stress-xl-17pro-light` | 1.07 | 1.07 | 0.68 | 0.00 |
| `17-stress-xl-card-17e-dark` | 0.02 | 0.02 | 1.59 | 0.00 |
| `17-stress-xl-card-17e-light` | 0.02 | 0.02 | 1.58 | 0.00 |
| `17-stress-xl-card-17pro-dark` | 0.03 | 0.03 | 1.53 | 0.00 |
| `17-stress-xl-card-17pro-light` | 0.03 | 0.03 | 1.52 | 0.00 |
| `17-stress-xl-scrolled-17e-dark` | 0.27 | 0.27 | 0.29 | 0.00 |
| `17-stress-xl-scrolled-17e-light` | 0.27 | 0.27 | 0.29 | 0.00 |
| `17-stress-xl-scrolled-17pro-dark` | 0.26 | 0.26 | 0.27 | 0.00 |
| `17-stress-xl-scrolled-17pro-light` | 0.26 | 0.26 | 0.27 | 0.00 |
| `17-stress-xxxl-17e-dark` | 1.14 | 1.14 | 0.73 | 0.00 |
| `17-stress-xxxl-17e-light` | 1.14 | 1.14 | 0.72 | 0.00 |
| `17-stress-xxxl-17pro-dark` | 1.07 | 1.07 | 0.69 | 0.00 |
| `17-stress-xxxl-17pro-light` | 1.07 | 1.07 | 0.68 | 0.00 |
| `17-stress-xxxl-card-17e-dark` | 0.02 | 0.02 | 1.59 | 0.00 |
| `17-stress-xxxl-card-17e-light` | 0.02 | 0.02 | 1.58 | 0.00 |
| `17-stress-xxxl-card-17pro-dark` | 0.03 | 0.03 | 1.53 | 0.00 |
| `17-stress-xxxl-card-17pro-light` | 0.03 | 0.03 | 1.52 | 0.00 |
| `17-stress-xxxl-scrolled-17e-dark` | 0.27 | 0.27 | 0.23 | 0.00 |
| `17-stress-xxxl-scrolled-17e-light` | 0.27 | 0.27 | 0.23 | 0.00 |
| `17-stress-xxxl-scrolled-17pro-dark` | 0.26 | 0.26 | 0.21 | 0.00 |
| `17-stress-xxxl-scrolled-17pro-light` | 0.26 | 0.26 | 0.21 | 0.00 |
| `18-flow-large-1-17e-dark` | 0.04 | 0.04 | 0.95 | 0.00 |
| `18-flow-large-1-17e-light` | 0.04 | 0.04 | 0.93 | 0.00 |
| `18-flow-large-1-17pro-dark` | 0.03 | 0.03 | 0.90 | 0.00 |
| `18-flow-large-1-17pro-light` | 0.03 | 0.03 | 0.89 | 0.00 |
| `18-flow-large-2-17e-dark` | 0.35 | 0.35 | 0.40 | 0.00 |
| `18-flow-large-2-17e-light` | 0.35 | 0.35 | 0.40 | 5.21 |
| `18-flow-large-2-17pro-dark` | 0.33 | 0.33 | 0.38 | 0.00 |
| `18-flow-large-2-17pro-light` | 0.33 | 0.33 | 0.38 | 5.05 |
| `18-flow-large-3-17e-dark` | 0.03 | 0.03 | 0.00 | 0.00 |
| `18-flow-large-3-17e-light` | 0.03 | 0.03 | 0.00 | 5.21 |
| `18-flow-large-3-17pro-dark` | 0.03 | 0.03 | 0.00 | 0.00 |
| `18-flow-large-3-17pro-light` | 0.03 | 0.03 | 0.00 | 5.06 |
| `19-flow-xl-1-17e-dark` | 0.04 | 0.04 | 1.33 | 0.00 |
| `19-flow-xl-1-17e-light` | 0.04 | 0.04 | 1.32 | 0.00 |
| `19-flow-xl-1-17pro-dark` | 0.03 | 0.03 | 1.32 | 0.00 |
| `19-flow-xl-1-17pro-light` | 0.03 | 0.03 | 1.31 | 0.00 |
| `19-flow-xl-2-17e-dark` | 0.39 | 0.39 | 0.74 | 0.00 |
| `19-flow-xl-2-17e-light` | 0.39 | 0.39 | 0.73 | 0.00 |
| `19-flow-xl-2-17pro-dark` | 0.37 | 0.37 | 0.69 | 0.00 |
| `19-flow-xl-2-17pro-light` | 0.37 | 0.37 | 0.68 | 0.00 |
| `19-flow-xl-3-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `19-flow-xl-3-17e-light` | 0.07 | 0.07 | 0.00 | 5.01 |
| `19-flow-xl-3-17pro-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `19-flow-xl-3-17pro-light` | 0.07 | 0.07 | 0.00 | 4.87 |
| `19-flow-xl-4-17e-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `19-flow-xl-4-17e-light` | 0.07 | 0.07 | 0.00 | 5.01 |
| `19-flow-xl-4-17pro-dark` | 0.07 | 0.07 | 0.00 | 0.00 |
| `19-flow-xl-4-17pro-light` | 0.07 | 0.07 | 0.00 | 4.87 |
| `20-refusal-conflict-1-17e-dark` | 0.03 | 0.03 | 0.00 | 0.00 |
| `20-refusal-conflict-1-17e-light` | 0.03 | 0.03 | 0.00 | 0.00 |
