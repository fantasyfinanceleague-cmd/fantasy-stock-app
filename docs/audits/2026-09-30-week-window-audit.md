# Week-window audit — who reads `week_start` / `week_end`, and is any of it wrong?

**Date:** 2026-09-30 · **Base:** `origin/main` @ `c7fe243` · **Type:** read-only audit (no code, no migrations)
**Requested by:** Orchestrator · **Trigger:** `_shared/schedule.ts` generates fixed-UTC, Tuesday-start windows (open 14:30Z, close 21:00Z, no holidays). Home already derives its displayed times from the market calendar (Design Lead ruling, backend ask #7). This audit covers every other consumer.

## TL;DR

**Yes, there is a SCORING-WRONG defect, and it happens every week in both EST and EDT.** A week is scored from three cuts that are supposed to be one instant, and they aren't:

| Cut | What it is | Where | Instant |
|---|---|---|---|
| **Baseline** | the ledger as of the **run** (all trades, no time bound), priced at the day's bar **open** | `snapshot-week-start/index.ts:366-374`, `:390`; `fetchOpenPrices` `:156-165` | cron `35 14 * * 1,2`, so **Mon 14:35Z**. On a holiday Monday or a Tuesday heal it is **Tue 14:35Z**, and retries add +5 min each |
| **In-week trades** | `created_at >= week_start AND created_at <= week_end` | `process-week-results/index.ts:620-627` | **Tue 14:30Z → Fri 21:00Z** |
| **Close** | the ledger as of the **run**. Every existing row is closed at the bar close (`close.ts:226-235`); held symbols with no row get an `entered_mid_week` row (`close.ts:237-269`) | `snapshot-week-end/index.ts:287-290` | cron `5 21 * * 5`, so **Fri 21:05Z** |

`calculateUserScore` (`user-score.ts:101`, `:194-205`) scores an `entered_mid_week` row **only through a matching buy in the in-week trade list**. So any trade that falls between the baseline cut and `week_start` is in **neither** the baseline nor the trade list:

- A **sell** leaves a phantom position that is scored all the way to Friday's close.
- A **buy** is dropped completely, both its gain and its cost basis. This is the cc26857 defect coming back, this time for Monday buys.

The record-trade server accepts trades 24/7 (`record-trade/index.ts:216`, "last available quote off-hours"). The mobile client allows trades 9:30–16:00 ET on weekdays, and Monday 10:35 ET–16:00 ET sits inside that range. So an ordinary user can hit this defect from the app every week.

**What the Orchestrator was alerted to:** a prod query to run before Fri 2026-10-02 21:15Z (see [Prod check](#prod-check-before-fri-2026-10-02-2115z)). That week's gap (Mon 09-28 14:35Z → Tue 09-29 14:30Z) has already passed, so only data can say whether a real league is affected.

## Summary table

Severity: **SCORING-WRONG** means a stored score or standing is wrong. **USER-VISIBLE-WRONG** means a displayed fact is wrong. **COSMETIC** means imprecise but harmless. **OK** means correct. "Proven" means it was replayed with a hermetic Deno script against the real pure modules (see [Method](#method--proof)). "Traced" means it was read from code but not replayed.

| # | Consumer (file:line) | Assumes | EST | EDT | Holiday wk | Severity | Evidence |
|---|---|---|---|---|---|---|---|
| **S1** | Trade window `process-week-results/index.ts:625-626` vs. baseline `snapshot-week-start/index.ts:371-374` | the week starts Tue 14:30Z | ✗ | ✗ | ✗ (see S4) | **SCORING-WRONG** | Proven |
| **S2** | Baseline ledger cut `snapshot-week-start/index.ts:371-374` + open price `:165` | nobody trades between Monday's open and the 14:35Z run | ✗ (5 min) | ✗ (65 min) | ✗ | **SCORING-WRONG** (exploitable) | Proven |
| **S3** | Tuesday re-run heal `snapshot-week-start/index.ts:401-430`, `fetchOpenPrices` `:161` | a participant uncovered on Tuesday is a Monday holder | ✗ | ✗ | n/a | **SCORING-WRONG** | Proven |
| **S4** | Baseline cut after `week_start`: holiday Monday, Tuesday heal, Alpaca-401 Monday | baseline instant < `week_start` | ✗ | ✗ | ✗ | **SCORING-WRONG** (double count) | Proven |
| **S5** | `week_end` 21:00Z (`schedule.ts:92`) vs. bar close `snapshot-week-end/index.ts:130,147` | `week_end` is the close | OK normally; ✗ on an early-close Friday | ✗ (17:00 ET) | ✗ early close | **SCORING-WRONG** (latent; exploitable) | Proven (EDT) |
| **S6** | Friday-holiday close price `snapshot-week-end/index.ts:130,157-180` | Friday has a daily bar | ✗ | ✗ | ✗ | **SCORING-WRONG** (approximate close) | Traced |
| **S7** | Week-end retries (+5 min, 3 attempts) vs. 21:15Z scorer | week-end always succeeds by 21:15Z | ✗ on failure | ✗ on failure | — | **SCORING-WRONG** (latent) | Traced |
| **S8** | `current_week` bump, `process-week-results/index.ts:1143-1210` + snapshot jobs keyed on `current_week` | every week advances on its Friday | ✗ on refusal | ✗ on refusal | — | **SCORING-WRONG** (cascade, latent) | Traced |
| T1 | Pending query `.lt('week_end', now)` `process-week-results/index.ts:522` | cron runs after `week_end` | OK | OK | OK | OK | Traced |
| T2 | Playoff dating `season-transition.ts:171-181`, `process-week-results/index.ts:189-209` | same Tue–Fri windows | same as S1–S5 | same | same | OK in itself (inherits S1–S6) | Traced |
| T3 | `league_end_date` backfill `20261012000003` | last `week_end` + 7·W | OK | OK | OK | OK | Traced |
| U1 | Mobile `getSeasonPhase` / `getUpcomingMatchupLabel` `apps/mobile/lib/weekStatus.ts:54-58,193-198` (Home "Week 1 starts Tue…", PhaseChip, league sheet) | the season starts at `league_start_date` = week-1 Tue 14:30Z | ✗ | ✗ | ✗ | **USER-VISIBLE-WRONG**; amplifies S1 in week 1 | Traced |
| U2 | Mobile `TradeModal` gate `apps/mobile/lib/marketHours.ts:87-100` | holiday list; no early closes | OK | OK | ✗ 2027+ list is empty; early closes unknown | **USER-VISIBLE-WRONG**; enables S5 on 2026-11-27 | Traced |
| U3 | Mobile `getWeekStatus`, `isAfterFridayClose` `apps/mobile/lib/weekStatus.ts:334-345,366` | fixed EST offset (-5) | OK | ✗ | — | COSMETIC: **no mounted caller** | Traced |
| U4 | Web `Dashboard.jsx:538-545,672-674,757-759`; `weekStatus.js`; `marketHolidays.js:237-249` | Tue–Fri week, EST offset | partly ✗ | ✗ | ✗ Monday holidays missed | COSMETIC: web is paused (`APP_PAUSED`) | Traced |
| U5 | Web `Matchup.jsx:258-310` | reads prices only, not times | OK | OK | OK | OK (inherits S1 data) | Traced |
| U6 | Legacy mobile `(tabs)/matchup.tsx`, `(tabs)/league.tsx` | — | — | — | — | OK: 16/25-line placeholders, no week logic | Traced |
| U7 | `draft-order-notify/plan.ts:37,63`; `send-notification` | print draft time only (ET via `Intl`) | OK | OK | — | OK: no week times | Traced |
| U8 | `get_home_summary` RPC (`20261011000001:51-52,114`) | passes `week_start` / `week_end` through raw | — | — | — | OK: Home re-derives times (ask #7) | Traced |

## Findings

### S1 — The Monday gap: trades between the baseline and `week_start` are unscored (SCORING-WRONG)

**Predicates:**
- Baseline ledger: `snapshot-week-start/index.ts:371-374` selects *all* trades for the league, with no `created_at` bound. `snapshotHoldings` (`_shared/snapshot-holdings.ts:97`) nets them as of the moment the job runs (Mon 14:35Z).
- In-week trades: `process-week-results/index.ts:625-626` uses `.gte('created_at', weekStart).lte('created_at', weekEnd)`, and `weekStart` = Tue 14:30Z (`schedule.ts:86-94`).
- Close: `close.ts:226-235` closes every Monday row, *including rows the user no longer holds*. `close.ts:237-269` inserts `entered_mid_week` rows for held symbols with no row.
- Scorer: `user-score.ts:101` excludes `entered_mid_week` rows from the start holdings. Their gain comes only from `midWeekBuys`, which is populated only from the in-week trade list (`:169-175`, `:194-205`).

**Result:** a trade in `(Mon 14:35Z, Tue 14:30Z)` is in no week. The window is 23 h 55 min long and covers:
- **EDT:** Mon 10:35 AM → Tue 10:30 AM ET, which includes 5 h 25 m of Monday market hours and the first hour of Tuesday's.
- **EST:** Mon 9:35 AM → Tue 9:30 AM ET, which includes 6 h 25 m of Monday market hours.

**Concrete (replayed, real modules):**

| Scenario | Timestamp | Scored | True | |
|---|---|---|---|---|
| Sell a Monday holding: 10 sh, open 100, sold 95, Fri close 80 | `2026-09-28T18:00Z` = **Mon 2:00 PM EDT** | **−$200** | −$50 | phantom held to Friday |
| Same sell, then reinvest 19 sh BBB @50 (Fri close 70) | Mon 2:00/2:01 PM EDT | **−$200** | +$330 | the buy is dropped |
| **Control:** identical trades Tue 11:00 AM EDT (in window) | `2026-09-29T15:00Z` | +$330 | +$330 | OK |
| Sell AAA, buy BBB | `2026-11-09T19:00Z` = **Mon 2:00 PM EST** | **−$200** | +$330 | same defect in EST |

In the reinvest case the close job *does* write a `BBB` row (`entered_mid_week=true`, `week_end_price=70`). The scorer then skips it because no in-window buy backs it. The row exists, but the gain doesn't count. This is the #5-style "signal ≠ effect" shape: the UI can show a `BBB` holding for the week while the score ignores it.

**Can a trade fall into TWO weeks?** Not from S1. It can from S4.
**Can a trade fall into NO week?** Yes. A gap *buy* only starts counting from next Monday's baseline. A gap *sell*'s real P/L (open → sale price) is never counted anywhere; the phantom open → Friday-close P/L is counted instead.

**Fix direction:** make the three cuts one instant, `T0` = that week's first market open (from `market_calendar`, which now exists: `20261005000002`).
- (a) snapshot-week-start nets the ledger with `created_at < T0` instead of "now".
- (b) The in-week trade window starts at `T0`, not the stored Tuesday `week_start`. Either store the true `T0` in the matchup row or derive it at scoring time. Changing `week_start` itself also changes `ledgerPositionState`'s partition (`scoring-eligibility.ts:370-409`), which must move with it.
- (c) The close ledger is cut at `created_at <= T_close` (the week's last market close), not at run time.
- (d) The close job should not close a Monday row at the Friday price for a position that the in-week trades show was sold. Today the scorer handles this correctly *only* because the sell is in the trade list, so once (b) holds this is automatic.

### S2 — Trades after Monday's open but before the snapshot run are credited from the open (SCORING-WRONG, exploitable)

**Predicate:** the baseline ledger is cut at the run (Mon 14:35Z), but it is priced at the bar's **open** `o` (`snapshot-week-start/index.ts:165,182`). A trade in `[Mon open, Mon 14:35Z]` is therefore absorbed into the baseline at the open price, not its fill price.

- **EDT:** Mon 9:30–10:35 AM ET (65 min).
- **EST:** Mon 9:30–9:35 AM ET (5 min). Retries add up to +15 min.

**Concrete (replayed):**

| Timestamp | Trade | Scored | True |
|---|---|---|---|
| `2026-09-28T14:15Z` = Mon 10:15 AM EDT | buy 10 BBB @60; open 50, Fri close 70 | **+$200** | +$100 |

The exploit: buy a stock that is already up since the open and get credited for the move you didn't hold. The mirror image also works: sell a stock that is down since the open, and its open → sale loss vanishes.

Trades before the open (the weekend, pre-market) are also absorbed at the open. That is arguably intended ("between weeks"), since those fills use stale quotes and aren't in any week either way.

**Fix direction:** same as S1(a). Cut the baseline at `T0` = the open, so any trade after the open is an in-week trade priced at its fill.

### S3 — The Tuesday re-run re-bases a Monday-gap buyer at TUESDAY's open (SCORING-WRONG)

**Predicate:**
- The cron fires on **Mon and Tue** (`35 14 * * 1,2`).
- On Tuesday, the per-participant coverage gate (`snapshot-week-start/index.ts:401-430`) writes any participant with no row. That is typically someone who was all-cash at Monday's run and bought in the gap.
- It uses the Tue 14:35Z ledger and **Tuesday's** open (`fetchOpenPrices` uses `today`, `:161`), with `entered_mid_week=false`.

**Concrete (replayed):**

| Timestamp | Trade | Scored | True |
|---|---|---|---|
| `2026-11-09T19:00Z` = Mon 2:00 PM EST | all-cash user buys 10 BBB @55; Tue open 52, Fri close 70 | **+$180** | +$150 |

The same heal also creates S4's double count for trades in `[Tue 14:30Z, Tue 14:35Z]`.

**Fix direction:** with S1(a), a Tuesday run on a normal week has nothing legitimate to do. Restrict it to "Monday was not a trading day", decided by `market_calendar`, not by `getUTCDay()` plus an Alpaca call.

### S4 — Baseline cut *after* `week_start`: the same trade is counted twice (SCORING-WRONG)

**Predicate:** whenever the baseline job runs at or after Tue 14:30Z, trades in `[Tue 14:30Z, run]` are in the baseline ledger **and** in the in-week window (`>= week_start`). That happens in three cases:
- a **holiday Monday**: `snapshot-week-start/index.ts:265-271` skips, and Tuesday is the baseline;
- the S3 heal;
- an Alpaca-401 Monday: `isMarketOpenToday` returns `open:false` on a 401 (CLAUDE.md success-signal #1), so a key problem reads as a holiday.

The +5-minute retries (`schedule_snapshot_retry`) widen the window to ~15–20 min.

**Concrete (replayed):**

| Timestamp | Trade | Scored | True |
|---|---|---|---|
| `2027-01-19T14:32Z` = Tue 9:32 AM EST, MLK week (Mon 2027-01-18 is a holiday) | buy 10 BBB @50; Tue open 50, Fri close 70 | **+$400** | +$200 |

Upcoming holiday Mondays: 2027-01-18, 2027-02-15, 2027-05-31, 2027-07-05, 2027-09-06.

**Fix direction:** same single-instant rule. On a holiday Monday, `T0` is Tuesday's open, and both the baseline cut and the trade window use it.

### S5 — `week_end` is not the close: post-close trades are scored against the earlier close (SCORING-WRONG, latent)

**Predicate:** `week_end` = Fri 21:00Z (`schedule.ts:92`). The close price is the daily bar `c` (`snapshot-week-end/index.ts:130,147`). A trade in `(market close, week_end]` is an in-week trade priced at the post-market quote. A buy there is scored as `close − fill`.

- **EDT:** 4:00–5:00 PM ET every Friday.
- **EST:** no window on a normal Friday. On an **early-close Friday** (2026-11-27, 1:00 PM close), the window is 1:00–4:00 PM ET.

**Concrete (replayed):**

| Timestamp | Trade | Scored | True (week ends at the close) |
|---|---|---|---|
| `2026-10-02T20:30Z` = Fri 4:30 PM EDT | buy 10 BBB @60 after bad after-hours news; 4 PM close 70 | **+$100** | $0 |

**Reachability:**
- The server accepts it: `record-trade` has no market-hours check.
- The mobile client blocks it on a normal EDT Friday (`marketHours.ts:87-100`, 9:30–16:00 ET). A direct authenticated call to `record-trade` still works.
- On 2026-11-27 the **mobile client itself allows it**, because `marketHours.ts` has no early-close table (U2).

**Fix direction:** cut the in-week trades and the close ledger at `T_close` from `market_calendar` (which handles early closes). Optionally, have `record-trade` refuse, or mark as next-week, any fill outside a session.

### S6 — Friday-holiday weeks are closed at a quote, not a close (SCORING-WRONG, approximate)

**Predicate:** snapshot-week-end runs Fri 21:05Z regardless of the calendar. It requests `bars?…start=today&end=today` (`:130`). A holiday has no bar, so every symbol falls through to `quotes/latest` and takes `ap || bp` (`:157-180`): the **ask** of the last IEX quote, which may be Thursday's post-market quote. That is not Thursday's close, and it is biased high (the ask).

Separately, the in-week window keeps running through the holiday Friday, so trades placed on the holiday (server-accepted, at stale quotes) are in-week.

**Upcoming Friday holidays:** **2026-12-25**, **2027-01-01**, 2027-03-26 (Good Friday), 2027-06-18, 2027-12-24.

**Evidence scope:** traced, not replayed; the Alpaca response shape on a holiday was not exercised.

**Fix direction:** `T_close` = the last session close of the week (Thursday here). Fetch that session's bar explicitly by date, never "today". Run or trigger the close job from the calendar, not from a fixed `5 21 * * 5`.

### S7 — The week-end retry chain overlaps the 21:15Z scorer (SCORING-WRONG, latent; not a timezone issue)

**Predicate:**
- If snapshot-week-end's 21:05Z run aborts a league (an unpriceable symbol or a failed read), it retries at +5 min, up to `MAX_RETRIES = 3`: ~21:10Z, then ~21:15Z.
- `process-week-results` fires at **21:15Z**. For that league it finds Monday rows with no `week_end_price`, so `hasWeekEndPrices=false`.
- `decideBatchScoring` proceeds (`scoring-eligibility.ts:180-199` only refuses *snapshot-less* batches). `decideUserScorer` returns `'legacy'`, and `calculateWeeklyGainLegacy` (`process-week-results/index.ts:137-160`) scores **live prices, ignores every in-week trade, and sets percentGain 0**.
- Standings increments are irreversible.

**Fix direction:** have process-week-results *refuse* (not legacy-score) a batch whose `week_end` has passed but whose close is incomplete, and let the Friday heal/next run pick it up. Or schedule the scorer after the retry chain's last slot.

### S8 — One refused week strands the next week's baseline (SCORING-WRONG cascade, latent; not a timezone issue)

**Predicate:**
- `current_week` advances only when every matchup in the week has `team1_gain` set (`process-week-results/index.ts:1143-1151`).
- Both snapshot jobs key on `leagues.current_week` (`snapshot-week-start/index.ts:328,344,379`; `snapshot-week-end/index.ts:259`), not on the calendar.
- So if week N has one refused matchup, the next Monday snapshots week N again. Week N's rows are end-priced, so the job hits `alreadyEndPriced` and skips (`:409-414`).
- Week N+1 gets **no baseline**. When it ends it is snapshot-less at week > 1 and is refused `no_snapshots_week_gt_1`, unless everyone is all-cash. Each refusal causes the next.

This is the all-or-nothing family (CLAUDE.md) at league-week granularity. **Evidence scope:** traced, not replayed.

**Fix direction:** the snapshot jobs should pick the week whose `[T0, T_close]` contains now (or just ended), from `matchups` plus the calendar, independent of `current_week`.

### T1–T3 — Scheduling that is correct in itself (OK)

- **T1:** the pending query `.lt('week_end', now)` (`process-week-results/index.ts:522`) at Fri 21:15Z picks up a 21:00Z `week_end` in both EST and EDT. OK.
- **T2:** `buildPlayoffBracket` (`season-transition.ts:171-181`) dates round r as the first Tuesday strictly after the last regular `week_end`, +7(r−1) days, 14:30Z → Fri 21:00Z. That is identical to `weekWindow(now, numWeeks + r)`, so the playoff windows are consistent with the regular season and with `league_end_date`. Playoff weeks inherit S1–S6 unchanged.
- **T3:** `20261012000003` computes `league_end_date` as the last regular `week_end` + 7·W days. That matches `planSeason` (`schedule.ts:193`). OK.

### U1 — Mobile says week 1 "starts Tuesday" while its baseline was taken Monday (USER-VISIBLE-WRONG; amplifies S1)

**Predicate:** `league_start_date` = week-1 `week_start` (`schedule.ts:192`). `getSeasonPhase` (`apps/mobile/lib/weekStatus.ts:54-58`) returns `'pre_season'` until that instant, and `getUpcomingMatchupLabel` (`:193-198`, Home `useHomeData.ts:407`) says "Week 1 starts Tue, Sep 29". `canTradeInPhase` (`:182`) allows trading in `pre_season`.

On week-1 Monday after 10:35 AM EDT (9:35 AM EST), the app therefore shows the league as not yet started and invites pre-season roster moves. Those land exactly in the S1 gap, because the baseline was already cut at Mon 14:35Z.

Also, `'regular'` begins at Tue 10:30 AM EDT, not at an open.

**Fix direction:** derive the phase boundary from `T0` (week 1's first open, from the calendar), consistent with the Home ruling (ask #7).

### U2 — Mobile trade gate: no 2027 holidays and no early closes (USER-VISIBLE-WRONG)

`apps/mobile/lib/marketHours.ts:12-35` hard-codes holidays for 2025–2026 only, so from 2027-01-01 (a Friday holiday) the modal will show "open". It has no early-close table either, so on 2026-11-27 and 2026-12-24 it allows trades 1:00–4:00 PM ET. On 2026-11-27 that enables S5.

ET conversion is done correctly with `Intl` (`:42-73`), so the modal is DST-correct.

**Fix direction:** read the gate from `market_calendar` (`open_et` / `close_et`) instead of a hard-coded list.

### U3 — Mobile `getWeekStatus` / `isAfterFridayClose`: fixed EST offset (COSMETIC, unmounted)

`apps/mobile/lib/weekStatus.ts:334-345` uses `etOffset = -5` and device-local `getDay()`. In EDT, "after Friday close" flips at 5 PM ET. However, `getWeekStatus`, `getCountdownMessage`, `getRelativeCountdown`, and `isNextMondayHoliday` have **no importer** outside `weekStatus.ts` (checked with grep across `app/`, `components/`, `lib/`), so nothing renders it today.

**Fix direction:** delete it, or port it to the calendar, before anything mounts it.

### U4 — Web Dashboard / weekStatus (COSMETIC, paused)

- `Dashboard.jsx:538-545` shows holidays inside `[week_start, week_end]`, which is Tue–Fri, so it never reports a Monday holiday.
- `marketHolidays.js:237-249` hard-codes `totalDays = 4`.
- `weekStatus.js` `isAfterFridayClose` uses an EST offset.
- `Dashboard.jsx:672-674,757-759` prints the dates only.

The web app is paused (`APP_PAUSED`), so none of this renders.

**Fix direction:** fold it into the calendar-derived model if the web is ever unpaused.

## Holidays — summary of the code as it is

| Week shape | What happens |
|---|---|
| **Monday holiday** (2027-01-18, 02-15, 05-31, 07-05, 09-06) | Monday run skips (`snapshot-week-start/index.ts:267-271`). The Tue 14:35Z run becomes the baseline at Tuesday's open. The S1 gap vanishes that week, but **S4's double count** applies to `[Tue 14:30Z, run+retries]`. Scoring is otherwise consistent. |
| **Tuesday holiday** (none until 2028-07-04) | Monday is normal. The Tuesday heal has no bar, so it falls back to quotes. The window is unchanged. Traced only. |
| **Friday holiday** (2026-12-25, 2027-01-01, 2027-03-26, 2027-06-18, 2027-12-24) | **S6**: the close is priced at a latest-quote ask, not Thursday's close. Holiday trades are in-week at stale quotes. |
| **Early-close Friday** (2026-11-27) | **S5** window 1:00–4:00 PM ET, and the mobile client allows trading in it. |
| **DST changes** (2026-11-01, 2027-03-14) | Both are Sundays, so no week straddles a change. The EST/EDT columns above are the whole story. |

## Prod check (before Fri 2026-10-02 21:15Z)

Read-only. It finds trades this week that fell before `week_start` but after Monday's open. Zero rows means this Friday is unaffected by S1–S4.

```sql
SELECT t.league_id, t.user_id, t.symbol, t.action, t.quantity, t.price, t.created_at, m.week_start
FROM trades t
JOIN (SELECT DISTINCT league_id, week_start FROM matchups
      WHERE week_end = '2026-10-02 21:00:00+00') m ON m.league_id = t.league_id
WHERE t.created_at >= '2026-09-28 13:30:00+00'   -- Mon 9:30 AM EDT
  AND t.created_at <  m.week_start               -- Tue 14:30Z
ORDER BY t.created_at;
```

For any hit:
- Trades before `MIN(week_snapshots.created_at)` for that league/week are S2 (credited from the open).
- Trades after it are S1 (sell = phantom, buy = dropped).
- If the league's baseline was written on Tuesday (a Monday-completed draft, or a heal), trades in `[week_start, snapshot created_at]` are S4.

## Method / proof

- Grepped `week_start|week_end|weekStart|weekEnd|getWeekStart|14:30|21:00|TUESDAY|weekWindow` across `supabase/functions`, `supabase/migrations`, `apps/web/src`, and `apps/mobile`, then read every hit plus the trade, market-hours, and week-status code they lead to.
- Cron schedules were taken from `docs/architecture/db-snapshot.json` (captured 2026-09-30T16:53Z), not from migrations: `snapshot-week-start 35 14 * * 1,2`, `snapshot-week-end 5 21 * * 5`, `process-weekly-matchups 15 21 * * 5`.
- **Replay:** [`2026-09-30-week-window-replay.ts`](2026-09-30-week-window-replay.ts) (run from repo root: `deno run --allow-read docs/audits/2026-09-30-week-window-replay.ts`; exits 1 while any scenario is wrong, so it doubles as the fix's failing test) imports the real pure modules and chains them the way the handlers do:
  1. `weekWindow` (`_shared/schedule.ts`) for the window;
  2. `snapshotHoldings` + `classifyCoverage` / `selectMissingHoldings` / `buildPricedRows` (`snapshot-week-start/plan.ts`), with the ledger filtered to `created_at <= run` for each Mon/Tue run;
  3. `buildCloseWork` (`snapshot-week-end/close.ts`) with the ledger at the Fri run;
  4. the `gte/lte created_at` window;
  5. `calculateUserScore` and `ledgerPositionState`.

  It replayed 8 scenarios. The only one that scored correctly was the in-window control (EDT 3). The other seven scored wrong: S1 ×3, S2, S3, S4, S5.
- The replay stands in for the handlers' DB reads and Alpaca prices with fixed inputs. Its fidelity rests on the handler predicates cited above, which were read, not executed.

## Not examined (scope of every verdict above)

- **No prod data was read.** Whether any real league has trades in these windows is unknown; see the prod check. "SCORING-WRONG" means the code produces a wrong score for a reachable input, not that a wrong score has been stored.
- The **edge handlers themselves** (`index.ts` files) were not executed. Only their pure modules were. The DB-read shapes are taken from the code.
- **Alpaca semantics:** whether the IEX daily bar's `o` / `c` equal the official open/close auction prices, whether `c` includes extended hours, and what `quotes/latest` returns on a holiday. S2, S5, and S6 assume the documented intent (open/close of the regular session).
- `fetchFillPrice` (`_shared/alpaca-price.ts`) was not read, so which quote an off-hours fill uses is taken from its call-site comment.
- **Duration leagues:** `nextDayMarketOpen` / `marketCloseOn` (`schedule.ts:97-104`) have the same fixed-UTC quirk (start 10:30 AM EDT, end 5 PM EDT, not snapped to trading days). I found no server scorer that reads `league_end_date`, but I did not trace how duration leagues are scored.
- The **new Home** (`useHomeData.ts` beyond line 407, the 3b-2 work) is excluded per the Design Lead ruling.
- The web app was read only where grep hit. It is paused.
- The `trigger_week_snapshot` / `trigger_week_end_snapshot` / `trigger_week_processing` SQL helpers were not re-read. They are manual http_post triggers with no window math.
- `cron.timezone` in prod was not queried. The schedules are read as GMT, per the `schedule_snapshot_retry` comment.
