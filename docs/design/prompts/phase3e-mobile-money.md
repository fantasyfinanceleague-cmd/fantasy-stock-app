# Phase 3e worker prompt: mobile Portfolio, the stock sheet and trading (`ui/mobile-money`)

> **v2, Design Lead, 2026-09-30.** This replaces the 2026-09-26 draft, which predates the key-screens board, the Light/Dark themes (§9A: there is no "money surface" any more) and the 2026-09-29 trading rulings (whole positions, per-slot proceeds).
>
> **Runs in parallel with 3c** (`ui/mobile-game`; disjoint screens). Both target the **1.2.0** TestFlight build, which ships every tab on the new design with no placeholder tabs.
>
> **Starts when** `ui/mobile-home` (3b-2) is merged. Branch off `main` after that merge. (The budget/tier trading question is **decided: A**, 2026-09-30.)
>
> **Visual source of truth:** the key-screens board, `docs/design/screens/key-screens.html`. Its sections are key screen **5 Portfolio and stock sheet** (all four phones) and Part 2 › **"Trading" (3e)** with all its figures and notes (including the two "Budget league" review screens).
>
> Plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3e: the money screens**. Your branch is `ui/mobile-money`. You report to `Orchestrator` and `Design Lead` via `SendMessage`.

**The bar.** "Would this impress on first use next to Robinhood, Revolut or Arc?", not "is it correct". Correctness, honesty, tokens, contrast and Reduce Motion are **table stakes, not the goal**. This is the calm, precise register of the app (no `spring.lively` here), but calm is not timid. The **signature moments** below are **required**, each with a Reduce Motion version and a recording.

**Copy.** Keep existing strings and Giorgio's copy **verbatim**. New copy comes from the board, where it is marked "new copy". Take text from **inside the phone frames**, never from a figure's caption. Propose other wording; don't make it. Keep all strings in one module (e.g. `lib/money/moneyCopy.ts`).

## Read first

- `CLAUDE.md`:
  - the partial-state family;
  - "Success signals are unreliable" (`supabase-js` `.rpc()`/`functions.invoke` resolve errors, they don't throw: always check `{ error }`);
  - "Overloaded NULLs";
  - the styles-at-bottom ESLint rule;
  - "UI entry points: MOUNTED and REACHABLE".
- `docs/STATUS.md`.
- `docs/audits/2026-09-30-week-window-audit.md`: **U2 is yours** (below).
- `docs/design/DESIGN_DIRECTION.md`: §3 (the stock-detail sheet, Sell pre-selected), §4/§5, §9 and **§9A**.
- The merged 3b-2 prompt and its review log `~/fantasy-stock-design-review/ui-mobile-home/DESIGN-REVIEW.md`. **Every finding there is a rule here.**
- `supabase/functions/record-trade/index.ts` and `_shared/draft-validation.ts` (`fixedNotionalFunding`, `resolveFunding`, `leagueOwnedSymbols`, `userCashSpent`, `fillQuantity`): the server is the authority on every trade.

## Rulings in force (don't reopen them without Giorgio)

- **Available cash comes from the stake mode, never the legacy budget columns** (root cause of Giorgio's 1.1.0 live trade test, 2026-10-05).
  - In 1.1.0, `portfolio.tsx:136` derived "available cash" from the LEGACY `leagues.budget_mode === 'budget'` and `budget_amount − totalCost`. test_0925 is `fixed_notional` but still carries `budget_mode = 'budget'` and `budget_amount = 100`. So the screen showed $0 and the client BLOCKED a buy the server would have allowed: reinvesting JPM's sale proceeds, sold whole at $333.25 × 2.916472 = **$971.92**.
  - **Rule:** NEVER read `budget_mode` / `budget_amount` for a per-slot league.
    - `stake_mode = 'fixed_notional'`: what you can buy with = the `record-trade` preview's `sources` (sold-slot proceeds and skipped slots).
    - `stake_mode = 'budget_cap'`: the budget logic (`budget_amount` − cash spent, mirroring `userCashSpent`).
    - `price_tiers`: the open slot's tier.
    One pure, tested function decides it from `stake_mode`, so no screen re-derives it.
- **Whole positions.**
  - **Sell = the entire position** ("Sell all X sh ≈ $Y"). No partial amounts.
  - **Buy = invests the whole source.**
- **NO quantity input on BUY, in ANY stake mode. The server decides the quantity** (Giorgio's 1.1.0 buy test, 2026-10-05). The 1.1.0 popup let him choose "3 shares ≈ $200" while `record-trade` invested the whole slot, $971.92, about 14.6 shares of VIST. That's a misrepresentation, not just confusion.
  - `fixed_notional`: shares = the whole source amount (the sold slot's proceeds, or a skipped slot's notional) / price.
  - `budget_cap` and `price_tiers`: exactly **1 share**.
  - **The review states the real outcome BEFORE confirm,** from the `record-trade` preview and the live quote. For example: "Buy $971.92 of VIST · ≈14.6329 shares at $66.42 · from your JPM slot", or for one-share leagues "Buy 1 share of SHOP · $104.20 · $443.56 budget left". Shares follow the share-display rule (≤ 4 dp) and carry "≈", because the fill price can move. Nothing on the buy path lets the user type or step a quantity or a dollar amount.
- **Per-slot (`fixed_notional`) leagues reinvest the SALE PROCEEDS**, never a fresh $2,000.
  - After a sale the slot shows as a **Cash** row: zero gain, counted in value, so the portfolio value doesn't change on the sale.
  - A buy asks **which sale pays** when more than one has cash. One buy never mixes two slots.
  - A draft slot that was **skipped** counts as a source worth the full notional.
  - Server: `record-trade` `action: 'preview'` returns `{ unfilled_slots, sources: [{ trade_id, symbol, amount }] }`, and a buy passes `sold_trade_id`.
  - Refusals `proceeds_unavailable` ("That sale's cash isn't available anymore. Pick another." → back to the picker) and `no_proceeds` ("There's no cash in your slots to invest.", terminal) are board copy.
- **Budget-cap / price-tier leagues: decided A (Giorgio, 2026-09-30).** Trade exactly as the server does now:
  - one share per buy (`fillQuantity`); a sell is the whole position;
  - a sale's cash goes back into the budget (`userCashSpent`);
  - every review says "1 share" and shows the **budget left** (budget cap). A tier league shows the open slot's **price tier** instead, and a stock outside it is refused (`no_eligible_slot`);
  - there's no Cash row and no "which sale pays" picker in these leagues; those are per-slot only.
  The board's "Budget league · review sell / review buy" screens are the target. Making these leagues spend a whole sale is a possible later backend change, so don't build it.
- **A stock is owned by at most one manager in a league** (`symbol_owned`). The stock sheet says who owns it: "Drafted by you · Round 1, pick 2", or another manager's name with the Bot badge where it applies. When someone else owns it, Buy is disabled with that reason.
- **Portfolio's gain is value − cost, labelled "since the draft".** It is deliberately NOT Home's "season gain". Never reuse one label for the other number (D1, Concept A).
- **Unpriced holdings count at cost**, with the approved caption (`plCoverage.ts`: "N holding(s) counted at cost (no live price yet)"). A row with no live price shows its entry value and the caption, never $0.
- **Market-data credit:** screens that show prices carry "Market data provided by Alpaca" (caption, secondary text). The wording is still to be confirmed against the provider's terms, so keep it in one constant.
- **Market closed:** trading is shown but disabled, with the time it opens ("Trading opens Mon 9:30 AM ET"), from the calendar.

## Hard rules from 3b-2 (each one cost a review round there)

1. **Times and windows** come from the **market calendar** (`market_session_status` / `market_calendar`), via 3b-2's `marketWeek.ts` and `lib/time/etParts.ts`, and are shown in ET. Never format `matchups.week_start/week_end`: they're fixed-UTC.
2. **Numbers are real or absent, never fabricated.**
   - The stock-sheet chart draws only real bars.
   - "Today" shows only on trading days.
   - No part defaults to 0.
   - Value and gain on a row come from the **same prices**, so a row can never contradict itself.
3. **Hermes.** Pin `hourCycle: 'h23'` (or `hour12: false`) for `formatToParts` with an hour, and VALIDATE the parts. Probe any state-deciding timezone logic on the simulator.
4. **Fixtures are derived, not typed.** One fixture league with the board's numbers (Stock Scudetto, $2,000 per slot, Roberto's six holdings, the TSLA sale of $1,890.12, the SHOP buy). Sums must tie out, as on the board's ledger.
5. **Fix everything, then shoot once.**
6. **A visible product decision that isn't ruled goes to Giorgio as a board "Your call" BEFORE "go".**

## Craft floor (DESIGN_DIRECTION §9B + §4 "Motion craft"; adopted 2026-10-05)

These apply to every screen you build. They are new since this prompt was first written, so audit your existing work against them too.
- **Icons:** the `sp` icon set only. Replace any Unicode or emoji glyph used as an icon in your screens (ⓘ, ▲/▼, ✓, ›, →, ●-as-text) with a drawn icon or shape. Add missing icons to the set through the Design Lead.
- **Hit areas:** ≥ 44 × 44 pt for everything tappable, **including text links** ("Invest", "Change", "Share", the Cash row, each holding row). Use padding or `hitSlop`, and report how you verified it.
- **11 pt text floor:** chips, tags, badges, cell numbers and tab labels included.
- **Motion craft:**
  - one authored moment per screen, with a one-line motion thesis in your PLAN;
  - every animation passes "what's lost if it's removed?";
  - exit is faster than entrance;
  - content is visible at rest (an animation that doesn't run never hides content);
  - the live dot and any pulse pause when the screen isn't focused or the app is backgrounded.
- **Gestures:** never disable edge-swipe back. Sheets swipe to dismiss with Cancel/Done; the trade review mid-confirm is the one place a dismiss guard is justified. A one-tap destructive action with no review step (Remove, delete) confirms through a native action sheet whose button names the action (never Yes/No/OK). A flow with a review screen is already confirmed by that screen's single action-named button, with no extra sheet. **Sell and Buy:** the Review screen is the confirmation; its button reads "Sell TSLA" / "Buy SHOP", with no action sheet on top. Show the outcome (shares, ≈ price, proceeds or source, what's left) and "Prices can move before the order fills." Disable the button and show progress while submitting; the dismiss guard applies only during that submit.
- **Copy:** confirm buttons name the action; every message is a whole sentence (no stitched fragments); errors say what failed and how to recover, never a raw code.
- **Tags** must carry information and never repeat an adjacent chip or title.
- **Colour is never the only code:** every colour signal has a text, sign or shape twin and a VoiceOver label.
- **≤ 4 visible choices** at a decision point, with one primary action (check the stock sheet: ranges + Buy/Sell + position).
- **Stress fixture** (captured): a 20-character username and a 40-character league name; values and losses ≥ $1,000,000; 16 managers, 1,000+ trade-history rows (a virtualised list); offline/slow (a stale-data state); a `rate_limited` refusal.
- **Phone only for 1.2.0** (iPad support is off; no tablet layouts).

## Shared code and ownership

- **Reuse** 3b-2's `teamValue`, `todayChange`, `plCoverage`, `marketWeek`, `etParts` and `ordinal`, plus 3c's promoted locations once they land (3c owns every `lib/` move: rebase onto it rather than moving files yourself).
- **3e OWNS the trade and portfolio primitives:**
  - the stock sheet;
  - the trade flow screens;
  - money formatting helpers: a **company-name cleaner** (strip feed suffixes like "- Common Stock" or ", Inc. - Class A"; a pure, tested function) and **share formatting** (≤ 4 decimals);
  - the `TradeModal.tsx` retirement.
- **Retire the legacy `components/TradeModal.tsx`.** It's already orphaned on `main` (3b-1 removed its only import). Confirm nothing imports it (CLAUDE.md: MOUNTED and REACHABLE) and delete it with the new flow. Don't port its budget logic: that logic is the bug above.
- Changes to shared primitives (tokens, `Card`, `ShellHeader`, `sp/*`) go through the Design Lead. Tell the Orchestrator so 3c can rebase.
- **U2 is yours.** The trade gate in `lib/marketHours.ts` has a hard-coded holiday list that ends in 2026 and no early closes, so it would allow a trade on 2026-11-27 after the 1 PM close. Replace it with the calendar (`market_session_status` / `market_calendar` via `marketWeek`), including half days.
  - The client gate must fail CLOSED: if the calendar can't be read, trading is disabled with "Trading hours unavailable. Try again shortly." (new copy, flagged). Never fall back to "open".
  - **A server gate is coming** (`fix/record-trade-market-hours`, owned by the Orchestrator); see "Market-hours refusals" below. The client gate stays: it keeps a closed market from ever offering a trade button.
  - Also depends on 3c's **U1** fix to `weekStatus.getSeasonPhase`/`canTradeInPhase` (week 1's Monday). Rebase onto it when it lands.

## Screens: build each to its board screen

| # | Screen | Board | Notes |
|---|---|---|---|
| 1 | **Portfolio** | key screen 5, "Portfolio · live" | Header: "Portfolio value" (roll on change), "+$343.59 · +2.86% since the draft", "today". "6 of 6 slots invested · $2,000.00 per slot at the draft". Holdings: logo tile (the full ticker), ticker, clean company name, shares (≤ 4 dp), value, today %. "Trade history · Includes your 6 draft picks". Alpaca credit. |
| 2 | Portfolio with a **Cash** slot | "After selling TSLA · the slot holds the proceeds" | "Portfolio value · includes cash", "5 of 6" slots, "1 ready to invest", the Cash row "From selling TSLA · ready to invest" with "Invest ›". |
| 3 | **Stock sheet** (held) | "Stock sheet · Sell pre-selected" | Price + today; a chart against the previous close with range tabs (the board's `1D 1W 1M 3M 1Y`; each range draws real bars only); your position; the ownership line; **Sell pre-selected**. Opens from any ticker anywhere, including 3c's lineups (expose a route both phases use). |
| 4 | Stock sheet (not held; owned by someone else; market closed) | "Market closed" + the ownership rule | Not held and free: Buy primary. Owned by another manager: Buy disabled "Owned by Paolo M." (new copy, flagged). Market closed: the sheet still informs, and actions are disabled with the open time. |
| 5 | **Sell** → **Review sell** → **Sold** | "Sell TSLA", "Review sell", "Sold" | **Choose what to sell from YOUR HOLDINGS** (a list of your positions, or the stock sheet's Sell), **never a symbol search**: you can't sell what you don't own. **No quantity stepper:** a sell is always the whole position, so the sheet reads "Sell all 2.9165 shares of JPM · ≈$971.92", and the quantity can never exceed what you hold because it's never chosen. The review shows shares, price, what you get, and how the slot compares with its $2,000.00 start. Sold offers invest now or later. |
| 6 | **Which sale pays?** | "Which sale pays?" | Shown when `preview.sources.length > 1`; the skipped-slot source appears as full notional. |
| 7 | **Buy** → **Review buy** → **Bought** | "Review buy", "Bought" | **Buy keeps the ticker search.** The funding source is always visible from the start of the buy ("$971.92 from your JPM slot"), not only on the review. **No quantity or amount input:** after picking a ticker, the review states the server's outcome ("Buy $971.92 of VIST · ≈14.6329 shares at $66.42 · from your JPM slot"). Review: "≈ 18.1393 SHOP", price, "Paid from · TSLA slot · $1,890.12", "Left in the slot · $0.00" (zero grey). |
| 8 | **Trade history** | "Trade history" | Trades **and draft picks** (`league_activity`, #5), grouped by week, with filters All / Buys / Sells / Draft and an honest empty state. |
| 9 | **Budget/tier league trading** (decided A) | "Budget league · review sell", "Budget league · review buy" | "1 TSLA · all you hold", "Back to your budget $248.36" (neutral, not a gain), "Budget left after"; the buy shows "1 SHOP", "Budget now", "Budget left after". A tier league swaps the budget rows for the slot's price tier. Fixture: derive the budget league from the board's numbers ($2,500 budget, Roberto's draft prices, one share each). |

**Refusals:** show every `record-trade` refusal as polite, specific copy, mapped by `reason`:
- the per-slot board copy above;
- `symbol_owned`, `not_owned`, `over_budget`, `no_eligible_slot`, `roster_full`, `not_draftable`, `no_price`, `rate_limited`, `draft_not_completed`, `not_a_member`: each flagged new copy;
- an unknown reason gets one generic line.

A refusal appears **instantly** and never looks like success. Check `{ error }` on every call.

**Market-hours refusals (server gate, `fix/record-trade-market-hours`):**
- **Market closed:** HTTP 200 `{ ok: false, reason: 'market_closed', market_reason: 'pre_market' | 'after_hours' | 'weekend' | 'holiday', next_open_at }`. Show the board's market-closed copy with the time from `next_open_at` formatted in ET: "Market closed" / "Trading opens Mon 9:30 AM ET." (verbatim board pattern). `market_reason` may pick a short lead-in (e.g. "It's a market holiday."); flag any such line as new copy. Never show a raw reason code.
- **Calendar unavailable:** HTTP **503**. Show "Trading hours unavailable. Try again shortly." (the same copy as the client gate) and keep the review screen open so the user can retry. It must not read as a failed trade.
- **The race:** a review opened while the market was open and submitted after the close. The server's refusal wins. Replace the review's confirm state with the closed message instantly (no spinner-then-error flash), keep the review's numbers visible, disable Confirm, and return the user to the sheet in its closed state. Test it with a fixture clock that crosses 4:00 PM ET, and a half-day 1:00 PM close, between opening the review and confirming.
- **Previews stay allowed when closed** (`action: 'preview'` returns a `market` label). Use it to label the sheet ("Prices show Friday's close.") and never to enable a trade.
- Until that branch deploys, the refusal can't happen in production. Build and test against a fixture response, and verify it for real once it's live.

## Backend (check before building; don't assume)

- **Live, use as-is:**
  - `record-trade` (`buy` / `sell` / `preview`, `sold_trade_id`);
  - the `league_activity` view (#5, trades ∪ picks);
  - `market_session_status`, `quote` / `ticker-quotes` (with `prevClose`), `historical-bars`, `symbol-name`;
  - `get_league_display_names` (owner names + `is_bot`).
- A **new RPC** (e.g. one call for "who owns each symbol in this league", if the sheet needs it beyond `drafts`/`trades` reads) needs a plan-first message to the Orchestrator and uses migration range **`20261026000000`–`20261026000009`**. **These timestamps are PROVISIONAL:** right before release, any migration you add is re-stamped later than prod's latest applied migration (`supabase db push` refuses older unapplied files). Don't depend on the exact number.

## Motion and signature moments

| Moment | Spec | Reduce Motion |
|---|---|---|
| **M1 Row → sheet** | The tapped holding row's ticker tile and name travel into the sheet header (shared element) while the sheet rises on `spring.snappy` and the scrim fades (`base`) | Sheet fades in place |
| **M2 Live chart** | The line draws on first view (`feature`), a range change morphs (`base`), the endpoint is the **live dot** only while the market is open, and the scrub gives haptic ticks on real bars with a floating price + time label | Drawn, instant range change; scrub label works, no ticks |
| **M3 Value roll** | Portfolio value, today and row values roll per changed digit on quote refresh (`base`, `settle`), never on first paint | Instant swap |
| **M4 Trade success** | Confirm → the button's check draws (`slow`) → on return, the position row morphs into place in the holdings list (the Cash row becomes the new stock) and the value rolls | A static check; the rows update in place |
| **M5 Holdings re-order** | When values change the sort, rows FLIP to their new positions (`base`), using the stagger token | Rows jump |
| Pressables | Scale 0.98 (`instant`) + light haptic | No scale; the haptic stays |
| Refusals / errors | Appear **instantly** (§4) | same |

**No `spring.lively` on money screens.** The **whole trade sheet** (sell from holdings, buy with search and its funding source, the reviews and the done states) is new UI built to the board with these moments. Nothing of the legacy modal's look or logic survives.

## Accessibility

- At XL:
  - money never wraps;
  - the holdings rows reflow (value under the name) without truncating;
  - the sheet's actions stay reachable above the home indicator;
  - the review screens' labels wrap and their values never truncate.
- VoiceOver:
  - a holding row reads "NVDA, NVIDIA, 6.8942 shares, $2,194.91, up 3.81% today";
  - the chart has a summary plus an adjustable action through its points;
  - disabled Buy/Sell announce their reason.
- Contrast test passes in both themes; report any new pair.

## Verify, then report DONE (captures in `~/fantasy-stock-design-review/ui-mobile-money/`)

- **Checks:**
  - `npx tsc --noEmit` (baseline 1);
  - `npm run lint` (0 errors);
  - the deno suites, plus new tests for: the company-name cleaner; share formatting; Buy/Sell defaults (held → Sell; owned by another → Buy disabled); the refusal → copy map (every `reason`); the U2 gate (a 2027 holiday, the 2026-11-27 half day, **calendar unreadable → closed**); preview → picker logic (0, 1 and 2 sources; a skipped slot); **the available-cash function, including the exact test_0925 shape** (`stake_mode = 'fixed_notional'` with legacy `budget_mode = 'budget'`, `budget_amount = 100`, and JPM sold whole at $333.25 × 2.916472) asserting a buy IS offered, funded with **$971.92 from JPM**, and that `budget_amount` is never read; **buy quantity**: no quantity/amount input exists on the buy path in any stake mode; in the fixture, the confirm screen's dollars and shares equal what the server records (`fixed_notional`: source amount / price, rounded like `record-trade`; one-share leagues: 1); sell entry only lists held positions, with no quantity input; the market-hours refusals (`market_closed` for each `market_reason`, the 503, and the open-then-closed race incl. a half-day close); the budget/tier review numbers (budget left after a sell and a buy);
  - the contrast test;
  - `node scripts/gen-architecture.mjs`.
  - Report the counts and the **request count on load** (Portfolio ≤ 4).
- **Captures:** every row of the screens table, in Light AND Dark, full length; XL on the 17e (Light): Portfolio, the stock sheet, both reviews.
- **Recordings, Reduce Motion OFF:** M1–M5. Plus one combined Reduce-Motion-ON clip.
- **Real trade test** (Phase 4 of the API-key work), against the **1.1.0 backend** in a **test league**, market open, with **Giorgio's explicit go-ahead in the report**. Sell a position, then buy with its proceeds. **The shares and dollars shown before confirm must match the `trades` row after** (quantity, price × quantity ≈ the source amount). **Include the case that failed in 1.1.0:** in test_0925 (per-slot with legacy budget columns), buy with JPM's **$971.92** and confirm the client offers it. Verify the EFFECT in the data, not the response: the `trades` rows, `funded_by_trade_id`, and value unchanged across the sale. Never trade in a real league. If the market is closed, capture up to the review and stop.
- **Honesty check, Giorgio signed in:** Portfolio value = Σ holding rows (+ cash); the stock sheet's position = the row.
- **Copy audit** as in 3b-2.

## DESIGN-APPROVED criteria

1. Every screen matches its board screen in both themes. Off-board states are built from board parts, with their copy flagged.
2. No row contradicts itself; the Portfolio value equals the sum of rows plus cash; the sale leaves value unchanged.
3. Whole positions and per-slot proceeds are exactly as ruled: sell is chosen from holdings with no quantity input; buy has NO quantity/amount input in any stake mode, and its review states the server's real outcome (dollars, ≈shares, price, source) before confirm, matching the recorded trade; buy shows its funding source; the picker appears only with more than one source; every refusal is mapped and instant; **available cash never reads the legacy budget columns for a per-slot league** (the test_0925 test passes).
4. Holding → Sell pre-selected; owned by another → Buy disabled with the reason; market closed → informs, disabled with the open time.
5. The U2 gate reads the calendar and fails closed; the server's `market_closed`/503 refusals and the close-time race are handled instantly and politely; no fabricated numbers; Hermes-safe formatting.
6. "Since the draft" is never confused with Home's "season gain"; the unpriced caption and the Alpaca credit are present.
7. **All five signature moments (M1–M5) are present, smooth and calm-but-premium**, with their Reduce Motion versions. A missing or timid moment is a DESIGN-CHANGES.
8. Clean names, ≤ 4 dp shares, U+2212 minus, zero grey, no truncation at XL.
9. The real trade test passed, with its effect verified in the data.
10. The craft floor holds: no glyph-icons, 44 pt hit areas verified, the 11 pt floor, the motion-craft lines, the stress fixture captured. The gate report follows UI-UX-PROGRAM's format (specificity, squint, 0–4 scorecard, persona walk, P0–P3).

Report your PLAN first (including your fixture plan and how the U2 gate fails closed) and wait for "go".
