# Phase 3e worker prompt — Mobile money screens (`ui/mobile-money`)

> Drafted by Design Lead, 2026-09-26 (a phase added to the Orchestrator's list:
> Portfolio and trading had no owner). Starts after **3b-1 merges**; runs in
> parallel with 3c. Backend asks: **#5** (trade history unioned with draft
> picks) blocks the history screen only; **#3** (daily series) is a
> nice-to-have for the position chart. Plan on Opus, build on Sonnet.

---

You are the UI worker for **Phase 3e · the money screens**, the calm
fintech register of Game Day. Your branch is `ui/mobile-money`. You report to
`Orchestrator` and `Design Lead`.

## Read first

`CLAUDE.md`, `docs/STATUS.md`, the charter contract,
`docs/design/prompts/phase3-plan.md`. `docs/design/DESIGN_DIRECTION.md` §1 B
(the money register), §3 (the stock-detail sheet, Sell pre-selected), §4, §5,
§9 (money-surface tokens, money formatting). `docs/design/AUDIT-2026-09.md` §5
Populated: Portfolio contradictions ($1,000.00 beside +1.32%); a green "+$0.00"
chip; the Buy CTA at $0 budget; raw feed names ("JP Morgan Chase & Co. C…");
6-decimal shares; a holding tap opening **Buy**; the "Market Closed / Market
closed" sheet; trade history omitting draft picks.

## Scope (all `Surface kind="money"`)

1. **Portfolio tab** (active league from the pill)
   - Header: portfolio value (`type.display`, roll on change), window gain
     (cash-flow adjusted; zero neutral), and budget remaining. The Buy CTA is
     **disabled with a reason** when the budget can't buy anything or trading
     isn't open (the phase from the shared helper; PR #36's pre-draft state stays).
   - Holdings list rows: ticker (`type.headline`), a **clean company name**
     (strip feed suffixes like "- Common Stock", ", Inc. - Class A": a pure,
     tested helper), shares to ≤ 4 decimals, **market value** (live) and gain
     since entry (dollar and percent). The value and the gain must come from the same
     prices, so the row can't contradict itself.
   - Sector split: a compact bar (not a donut), if data allows.
2. **Stock-detail sheet** (new; opened from any ticker anywhere, including 3c lineups)
   - Price + day change; a chart (1D / 1W / 1M) with scrub; your position (shares,
     avg entry, value, gain); **who in your league owns it**; and actions
     **Buy / Sell** with **Sell pre-selected when you hold it**.
   - Market closed: the sheet still shows the detail; the actions are disabled with
     "Trading opens Mon 9:30 AM ET" (ask #7 when available; otherwise the
     existing market check), replacing the "Market Closed / Market closed" modal.
3. **Trade flow** (from the sheet): quantity or dollar amount, a live estimate,
   budget impact, confirm, then a **success state with the new position** (no
   silent close). Keep `record-trade` as the authority; show its refusal reasons
   verbatim and politely.
4. **History**: trades **and draft picks** (ask #5), grouped by week, with
   filters (All / Buys / Sells / Draft). Honest empty state.

## Motion

| Moment | Spec | Reduced |
|---|---|---|
| Sheet open / close | `spring.snappy`; backdrop `base` | Fade in place |
| Row → sheet | Shared-element feel: the ticker row lifts (scale 1.02, `quick`) as the sheet rises | No lift |
| Value / gain change | Digit roll, `base` | Instant |
| Chart first view / range change | Draw `feature` / morph `base` | Drawn / instant |
| Trade confirm → success | A check draws (`slow`), the position row updates (roll) | A static check |
| Pressables | Scale 0.98, `instant` + haptic | No scale; haptic stays |

**No `spring.lively`** on money screens.

## Verify, then report DONE

- tsc / lint / deno tests (+ tests for the company-name cleaner, share
  formatting, the Buy/Sell default, and disabled-reason logic).
- **Device capture** (populated account; Giorgio signs in): Portfolio
  (holdings, zero-budget state, pre-draft state), the stock sheet (held and not
  held; market open and closed), the trade flow through success, history with
  draft picks. Also XL Dynamic Type and **iPhone 17e**.
- A **trade test** only when the market is open, in a test league, with Giorgio's
  go-ahead in the report. Otherwise capture up to confirm and stop.
- Recordings: sheet open from a row, a trade confirm → success. **Reduce Motion on/off.**
- Architecture map regenerated if call sites change.

## DESIGN-APPROVED criteria

1. No row contradicts itself (value and gain from the same prices).
2. Tapping something you hold defaults to **Sell**; the market-closed sheet still informs.
3. Clean names, sane decimals, zero neutral, U+2212 minus, no wrapping at XL.
4. Buy is disabled with a reason, never a dead primary button.
5. Calm register: no `lively` springs, no game-surface bleed.
6. Motion from tokens; every reduced-motion row evidenced.

Report your PLAN first and wait for "go".

## Ambition bar (added 2026-09-27, after Giorgio called the first landing "still very basic")

**The bar is "would this impress on first use next to Robinhood, Sleeper, Revolut or Arc?"**, not "is it correct". Performance, honesty, tokens and reduced motion are **table stakes, not the goal**. The Design Lead will push back on timid work. **Copy:** keep Giorgio's existing copy **verbatim** unless this prompt explicitly changes it; propose wording changes, don't make them.

**Signature moments this phase must include** (each with its reduced-motion row and a recording):
- **Row → stock sheet shared element:** the ticker row expands into the sheet header.
- **Live chart** with an endpoint pulse on each price update; the scrub has haptic ticks and a floating price.
- **Trade flow:** an amount control with haptic detents and a live estimate that rolls; confirm → a success choreography (a check draws, and the position card morphs into place in the holdings list).
- **Holdings re-order** smoothly when values change the sort.
