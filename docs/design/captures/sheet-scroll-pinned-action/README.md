# Sheets: the content scrolls, the action stays pinned, on `fix/sheet-scroll-pinned-action`

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills, the drivers (`fx.sh`, `shot.sh`, `ldiff.sh`, `pxdiff.py`) and
the L pixel diffs are in **`~/fantasy-stock-design-review/fix-sheet-scroll-pinned-action/`**; this file is the index and the audit.

**The bug (P1, Design Lead, 2026-10-16).** The stock sheet (`StockSheetBody` inside `Sheet`, `maxHeight: 90%`) had no scroll view.
At XXXL Dynamic Type its lower half was clipped, so Review buy / Review sell could not be reached and a large-text user could not
trade (reference: `chore-keep-money/S6-sheet-clipped-xxxl-light.png`).

**The ruling.** The sheet's content scrolls; the action is pinned in a footer outside the scroll, on the sheet's own surface, with no
rule line over it (§9C: the content just scrolls under it; Robinhood's order-sheet pattern). The reason line a disabled action carries
moves with the button. At Large the sheet is content-sized, so the footer sits exactly where the button sat: L frames are pixel-identical.

## What was built

One shared layout, `SheetBody` in `components/sp/Sheet.tsx`: a wrapper (`flexShrink 1`, `minHeight 0`) holding a `ScrollView`
(`flexShrink 1`) and, after it, an optional `footer` View (never shrinks). A sheet puts it as its only child and passes the action
as `footer`. To keep Large identical, each sheet's old `body` style (gap G, bottom padding P) is split in two: the scroll's bottom
padding is G (it stands in for the gap above the footer) and the footer carries gap G and bottom padding P. A test pins both numbers
per sheet.

## The audit: every `<Sheet>` consumer, found by grep (`<Sheet`, `from '@/components/sp/Sheet'`; `Sheet.tsx` is the only `<Modal>`)

| Sheet | Primary action | Could it fall below the 90% ceiling? | What was done |
|---|---|---|---|
| **Stock sheet, main view** (`StockSheetBody`) | Review buy / Review sell | **YES: the bug.** Captured clipped at XXXL on a held stock | Body scrolls (header, price, chart, position, Buy \| Sell). Footer: the warn panel, the button, "Pick another stock", the reason line, the market note, the Alpaca credit |
| Stock sheet, pre-review refusal view | Try again / Edit | Yes, in principle (a refusal sentence plus two buttons at XXXL) | Message scrolls; the buttons are the footer |
| **Trade review** (`TradeReviewPanel`, inside the stock sheet) | Buy / Sell {symbol}, Done, a refusal's next step, Try again | Yes (title, headline, four lines, a card line and a message at XXXL) | Lines scroll; the action, the caption and the credit are the footer |
| **Sale picker** (`SalePicker`) | Use {symbol}… | Yes (one radio row per sale) | Rows scroll; "Use…" is the footer |
| Stock sheet, loading and load failure | Try again (load failure) | No: a header and one card | Unchanged. Not captured at XXXL (the fixtures that reach it were not worth the time); by construction it is well under half the sheet |
| **Leave league** (`LeaveLeagueSheet`) | Leave league / Stay | **Yes** (bullets) | Bullets scroll; the refusal line, Leave league and Stay are the footer |
| **Transfer commissioner** (`TransferCommissionerSheet`) | Hand over / Cancel | **Yes** (up to 15 managers) | Title, note and the list scroll; the refusal line, Hand over and Cancel are the footer |
| **Draft time** (`DraftDateSheet`) | Set draft time / Set later | **Yes** (a 216 pt wheel plus lines) | Wheel and lines scroll; both buttons are the footer |
| **Renewal change** (`RenewalChangeSheet`, via `RenewalAskBody`) | I'm out / I'm in | Possible (the ask's copy at XXXL) | `RenewalAskBody` gets an optional `layout({ body, footer })`: the card keeps one run, the sheet scrolls the question and pins the choice, its refusal and the "you can change this" note |
| How it works (`HowItWorksSheet`) | none (the × is its only control) | The three rows fit at XXXL on a 17e (line capped at 1.4×); a small phone could clip | Content scrolls in `SheetBody`, no footer; the home-indicator inset is kept |
| Category picker (`SlotBuilder`) | none (a row IS the choice) | Already a `ScrollView` (shrinks inside the 90% ceiling) | Unchanged |
| Player card (`PlayerCardBody`) | Save to watchlist (the card's one action) | Whole card is one `ScrollView`, so it is reachable; the action sits mid-card with "How you got it" and the credit below it | **Not changed** (moving it would change an approved L layout). Flagged for the Design Lead below |
| Your leagues (`LeagueSheet`, its own sheet, not `<Sheet>`) | none (rows pick) | Header pinned, rows in a `ScrollView`, `maxHeight 90%` | Unchanged |
| Design gallery sample | none | dev only | Unchanged |

**Flags for the Design Lead.**
1. The stock sheet's header × now scrolls away at XXXL (it is the sheet's first element). The sheet still closes by swipe, backdrop
   and Android back, and the review has Edit. If the × must stay reachable, it can move into a pinned header: a new ruling.
2. The player card's action is not pinned (see its row). It is reachable by scrolling; whether it should pin is a design call.
3. Found in passing, not touched: League settings at XXXL breaks "Commissioner" across three lines ("Com / missi / oner") on the
   member view (`drafttime`/`leave` navigation stills, `scratch/`). It is the money-unbreakable rule's neighbour; a separate round.

## The gate

Build: this branch's working tree. iPhone 17e simulator, iOS 27.0, Expo Go, status bar 9:41, a dead Supabase URL, dev fixtures only
(the game seam; `PORTFOLIO_STAKE=price_tiers` for the sell, `fixed_notional` + `MATCHUP_FIXTURE=sold` for the buy). Every tap and
swipe below was a real touch through the simulator control tool (duration 0.1 taps).

### The stock sheet at XXXL (`accessibility-extra-extra-extra-large`), both themes

| Frames | State |
|---|---|
| `sell-xxxl-light-top.png` → `…-scrolled.png` → `…-review.png` | SELL, light: Review sell is on screen before any scroll; swipe to the end (everything reachable, the Buy \| Sell control and the summary above the pinned button); **tap Review sell** → the review opens (Sell NVDA pinned) |
| `sell-xxxl-dark-top.png` → `…-scrolled.png` → `…-review.png` | SELL, dark, the same three steps |
| `buy-xxxl-light-top.png` → `…-review.png` | BUY, light: an unheld stock has no position panel, so the sheet is content-sized and needs no scroll; **tap Review buy** → the review (Buy AMD) |
| `buy-xxxl-dark-top.png` → `…-review.png` | BUY, dark, the same |
| `blocked-xxxl-light-top.png` → `…-scrolled.png` | the disabled case: a full roster. The warn panel ("Your roster is full. Sell a holding first.") and the disabled Review buy are pinned together in the footer, with the reason moving with the button |

### The other sheets at XXXL

| Frames | State |
|---|---|
| `drafttime-xxxl-light-top.png` → `…-scrolled.png` → `…-after-tap.png` | Draft time: the wheel and lines scroll; Set draft time and Set later pinned; **tap Set draft time** → the sheet closes and the League settings row reads the chosen time |
| `leave-xxxl-light-top.png` → `…-after-stay.png` | Leave league: the bullets scroll under the pinned Leave league and Stay; **tap Stay** → the sheet closes |
| `howitworks-xxxl-light-top.png` | How it works: fits at XXXL on a 17e (no scroll needed; the scroll is protective) |

### L pixel diffs against main (the merge-base `5a44398a`), light, Large text

Same fixtures and timings, both builds on the same simulator, compared with `pxdiff.py` (every pixel, all channels).

| State | Result |
|---|---|
| Stock sheet, sell, top / review | **0 pixels differ** |
| Stock sheet, buy, top / review | review **0**; top differs only inside a 42 px box: the chart's animated live dot (its halo pulses) |
| Stock sheet, blocked buy (warn panel), top / review | differs only inside a 54 px live-dot box; **0 pixels outside it** |
| Draft time | **0 pixels differ** |
| Leave league | **0 pixels differ** |
| How it works | **0 pixels differ** |

**Not captured on a device, and why.** Transfer commissioner (the fixtures have no commissioner with an open leave window: the
W8 tap-through already recorded this), Renewal change (the fixtures I tried did not land on the "You're running back · Change" roster
within the time spent), and the Sale picker (it needs two or more sales to fund a per-slot buy; no fixture gives two). Each uses the
same `SheetBody` as the sheets that were captured and carries the same structural pin and the same spacing-conservation pin
(`tests-deno/sheet-scroll-pinned-action.test.ts`); their Large pixel-identity is argued by that arithmetic, not measured. Treat them
as the first thing to look at when a real device pass reaches them.

## Tests and checks

- `tests-deno/sheet-scroll-pinned-action.test.ts` (13 tests): the footer is outside the scroll (and after it); the wrapper and scroll
  shrink inside the 90% ceiling and the footer does not; no border, fill or shadow on any footer (no rule line); for each fixed sheet
  the action (and its reason line) is in the `footer` slot and not in the scroll children; the Large spacing is conserved per sheet;
  and an audit test: every file that opens a `<Sheet>` uses `SheetBody`, scrolls on its own, or is a listed exception.
- Mutations, each making that suite fail (12 of 12 killed): the stock sheet's button back in the scroll; the footer inside the
  `ScrollView`; the wrapper's `flexShrink` removed; a pinned `testID` dropped from the review; a `borderTopWidth` on the footer; the
  reason line out of the footer; Stay out of the footer; the scroll padding changed by one step (Large drift); How it works losing
  `SheetBody`; Set draft time out of the footer; the sale picker's footer losing its gutter; the renewal choice back in the body.
- Three older exact-string source guards were updated for the new indentation and the new `testID`s (`game-draft-time-sheet`,
  `game-leave-league` ×2); what they pin is unchanged.
- tsc 0, lint 0 errors (8 pre-existing warnings), tappables / sourceManifest / the architecture map regenerated and current,
  gitleaks clean. The deno suite is green except `onboarding-w4` (the invite-reason mapping) and `shell-username` (the suggestions
  function), which also fail on a clean `main`.
