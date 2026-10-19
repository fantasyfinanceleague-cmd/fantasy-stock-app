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

### L pixel diffs against main, light, Large text (round 2 re-runs them; see "Round 2" below)

Round 1 compared every pixel of each state against main (the merge-base then) with `pxdiff.py`. **Correction (round 2):** in round 1 the
"stock sheet, sell, top" frame was in fact the review panel on both builds (the review step fired before the shot), so it never compared
the sheet's top. Round 2 re-shot every state with the top frames taken before any review, and found a real difference in one of them.

**Not captured on a device, and why.** (Unchanged in round 2.) Transfer commissioner (the fixtures have no commissioner with an open leave window: the
W8 tap-through already recorded this), Renewal change (the fixtures I tried did not land on the "You're running back · Change" roster
within the time spent), and the Sale picker (it needs two or more sales to fund a per-slot buy; no fixture gives two). Each uses the
same `SheetBody` as the sheets that were captured and carries the same structural pin and the same spacing-conservation pin
(`tests-deno/sheet-scroll-pinned-action.test.ts`); their Large pixel-identity is argued by that arithmetic, not measured. Treat them
as the first thing to look at when a real device pass reaches them.

## Round 2 (Design Lead, 2026-10-19): footer links capped, a soft edge, two defects found on the way

**1. Text in a SheetBody footer never outgrows the footer's button.** "Set later" (a `callout` Pressable) outranked its button at XXXL: callout, body
and caption carry no `maxScale` of their own, while a Button label is `headline`, capped at 1.6. `SHEET_FOOTER_MAX_SCALE = 1.6` (in `Sheet.tsx`,
pinned equal to `type.headline.maxScale`) now caps Set later and the Leave / Transfer refusal lines; every other footer text already carried
a 1.6 cap (the stock sheet's and the review's), and the Pick another stock / Cancel / Stay controls are Buttons (their label is the Button's own
headline cap). A test requires a `maxFontSizeMultiplier` on every `<Text>` inside every footer (8 today). Still: `final/drafttime-xxxl-light-top.png`.

**2. A soft edge where content scrolls under the footer.** A 24 pt `LinearGradient` (the sheet surface at alpha 0 into the surface, never the
`transparent` keyword; no rule line) sits just above the footer's top edge, shown ONLY while the content can scroll further down
(`components/sp/logic/sheetScroll.ts`: content − layout − scrolled > 1 pt, with a top bounce counted as 0 so a body that fits never flashes).
The metrics live in a ref and state flips only when the answer changes. At Large nothing overflows, so it does not show. Stills:
`final/sell-xxxl-light-top.png` (the "Shares / Avg entry" row dissolves into the pinned button), `final/sell-xxxl-light-end.png` (scrolled
to the end, the fade is gone, "Sell all 6.8942 sh ≈ $2,194.91" clear above the button), `final/leave-xxxl-light-top.png` (the "Y…" sliver
is a faded edge, no longer a cut glyph).

**3. Found and fixed: the stock sheet's ticker badge collapsed inside the scroll view.** At Large, on a held stock, the badge's "NVDA"
rendered at a fraction of its size (`adjustsFontSizeToFit` inside the scroll view, iOS; it is deterministic, and it is in the round-1 SHA too:
`r2L/round1-sell-mine.png`). The badge text is now sized by length (`tickerTileSize`: up to four characters at the 13 pt token, five or more at the old
fit's 0.85 floor), and a test forbids `adjustsFontSizeToFit` in any scrolled sheet body. The rendered badge now matches main.

**4. Found: a held stock's sell sheet is already taller than the 90% ceiling at Large on a 17e.** Fixed in round 3 (below).

### Round 2 Large diffs against main (`586a9598`), light, Large, same fixtures and timings

| State | Result |
|---|---|
| Stock sheet, sell, **top** (held stock) | differed in round 2 (finding 4); **superseded by round 3** |
| Stock sheet, buy, top / review | differs only inside two 40–65 px boxes: the chart's animated live dot, in the sheet and in the Portfolio behind the scrim |
| Stock sheet, blocked buy, top | differs only inside one 60 px live-dot box |
| Stock sheet, sell, review | live-dot box behind the scrim only |
| Draft time | **0 pixels differ** |
| Leave league | **0 pixels differ** |
| How it works | **0 pixels differ** |

## Round 3 (Design Lead, 2026-10-19): the held-stock sell at Large, ruled (a) with (b) as the backstop

**The ruling.** At Large on the 17e, "Sell all … ≈ $2,194.91" (what Review sell will do) must sit whole and unfaded above the footer, as on main. When a sheet hits its 90%
ceiling the footer's bottom padding yields first, down to the home-indicator inset; the sheet's own bottom padding and the footer's must never stack (exactly one carries the
inset); only then does the body scroll. (b): if that still leaves the body short, compress the footer's internal gaps, only at the ceiling, never below 8pt. Neither touches a
content-sized sheet.

**What it measured.** (a) alone was not enough: main clips ~32pt of its bottom padding off-screen (28pt visible under the credit) but the floor is the 34pt inset, so the body was
still about 5pt short. (b) closes it.

**What was built** (`Sheet.tsx` / `logic/sheetScroll.ts`):
- The sheet's 32pt bottom padding and the footer's own are ONE bottom space: the shell cancels the sheet's padding with an equal negative margin (only under a footer) and a single
  spacer of their sum sits under the footer. A content-sized sheet is exactly as tall as before; there is no stacking.
- The footer is no longer one wrapper view: its items, the gaps between them (spacers) and the bottom space are direct children of the shell beside the scroll; each item carries the
  footer's gutter. (A Fragment footer's children are its items; `RenewalChoice` is now one View so its row/refusal keep their 8pt gap.)
- `footerSpacing(...)` (pure, 14 cases in the test) computes the order from measured heights: bottom space to the inset, then gaps to 8, then the body takes the rest.
  **Why explicit math, not flex-shrink weights:** a first version used weights (bottom space ≫ gaps ≫ body) and worked at Large, but at XXXL the footer fell off the bottom of the
  sheet: Yoga redistributes shrink only twice, so a three-layer priority cannot be left to it.
- (b) is built in (the gap spacers); on the 17e it supplies the last 5.3pt (the credit line sits 5.3pt closer to the button than main's; nothing above it moves).

**Acceptance, on the final code** (`r4/`, `r6L/`, `final2/` in the design-review folder):

| Frame | Result |
|---|---|
| 17e, Large, light: held-stock sell, top, vs main | "Sell all … ≈ $2,194.91" whole, unfaded, body unscrolled. **0 differing pixels above the footer's credit line** except the chart's live dot (a 65 px box); the Review sell button is identical. The only other difference is the credit line, 5.3pt higher (cluster y 2387–2448 px, 517 × 61 px) |
| 17 Pro, Large, light: the same frame | fits with no scroll; differs from main only inside the live-dot box (775–842 y, 819–886 x px) |
| 17e, Large: buy top, blocked buy top, sell review, buy review | only the live-dot boxes, as before |
| 17e, Large: Draft time, Leave league, How it works | **0 pixels differ** |
| 17e, XXXL, light: `final2/sell-xxxl-light-top.png` / `…-end.png` | fade at the top; at the end the fade is gone; Review sell and the credit pinned; gaps compressed to 8; bottom space at the inset |
| 17e, XXXL, light: `final2/leave-xxxl-light-top.png`, `final2/drafttime-xxxl-light-top.png` | actions pinned, Set later capped, fade over the cut line |

## Tests and checks

- `tests-deno/sheet-scroll-pinned-action.test.ts` (21 tests): the footer is outside the scroll (and after it); the wrapper and scroll shrink inside the 90% ceiling
  and the footer does not; no border, fill or shadow on any footer (no rule line); for each fixed sheet the action (and its reason line) is in the `footer` slot
  and not in the scroll children; the Large spacing is conserved per sheet; every footer `<Text>` is capped and the cap is the button label's; the fade rule
  (14 cases) and the fade's structure (one fade, in the footer's view, `bottom: '100%'`, 24 pt, surface-to-surface, `pointerEvents` none, state flips only on
  change, the ScrollView is the shell's direct child); no `adjustsFontSizeToFit` in a scrolled body and the badge sizing; round 3's `footerSpacing` order (natural when it fits, bottom space to the inset, then gaps to 8, then the body; the measured 17e case; edge cases) and the one-bottom-space / gap-spacer structure (no stacking, the spacer under the items, only with a footer, no flex-shrink weights); and the audit test (every `<Sheet>` file uses
  `SheetBody`, scrolls on its own, or is a listed exception).
- **Mutations: 48 of 48 killed (rounds 1–3), measured by the test run's exit code.** (Round 1 said "12 of 12 killed"; that harness counted the text "0 failed" as a kill, so it proved
  nothing. Re-run properly, two mutants survived, one never applied and one was a no-op by construction; the pins were strengthened and the mutants rebuilt.)
  The set: the stock sheet's button back in the scroll; the footer inside the `ScrollView`; `flexShrink` removed; a pinned `testID` dropped; a `borderTopWidth` on the
  footer; the reason condition dropped; Stay's `testID` dropped; the scroll padding off by one step (Large drift); How it works losing `SheetBody`; Set draft time's `testID`
  dropped; the sale picker's gutter lost; the renewal choice back in the body; Set later / the Leave error / the review caption uncapped; the footer cap raised; the fade
  always shown / with the `transparent` keyword / eating touches / 40 pt / under a border / at `bottom: 0` / duplicated in the scroll; the fade rule ignoring the offset,
  counting a top bounce, or always true; `setFade` every frame; an extra wrapper around the scroll; `adjustsFontSizeToFit` back on the badge; the badge's length rule
  and long size changed.
- Three older exact-string source guards were updated for the new indentation and `testID`s (`game-draft-time-sheet`, `game-leave-league` ×2); what they pin is unchanged.
- tsc 0, lint 0 errors (8 pre-existing warnings), tappables / sourceManifest / the architecture map regenerated and current, gitleaks clean.
- Deno: `cd apps/mobile/tests-deno && deno test --allow-read .` is **2455 passed, 0 failed**. Round 1 reported two failures as "also failing on main": those two
  (`onboarding-w4`, `shell-username`) read source files and need `--allow-read`; without the flag they fail on any tree. Not a main defect.
