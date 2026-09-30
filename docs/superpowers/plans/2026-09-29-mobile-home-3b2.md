# Phase 3b-2 — mobile Home (one league through the season) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, this session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace Home's 3b-1 placeholder with the single-league dashboard: one `homePhase()`-driven hero card per phase (ten states), the D1 Concept A hero, the this-week scoreboard, the "Season gain, week by week" chart and standings, plus the signature moments H1–H6.

**Architecture:** All decisions are made in pure, deno-tested modules under `apps/mobile/lib/home/`: phase, live score, season series, today change, team value and copy. One data hook (`useHomeLeague`) fetches a bounded request set and feeds those modules. Presentational components under `components/home/` only render what the modules return. Nothing on Home infers a phase, re-sorts standings or computes a number outside those modules.

**Tech Stack:** Expo 54 / RN, reanimated 4.1, react-native-svg 15, gesture-handler 2.28, expo-haptics, supabase-js; the deno tests are in `apps/mobile/tests-deno`.

**Spec:** `docs/design/prompts/phase3b2-mobile-home.md` (origin/docs/design-3b2-home-prompt @ 0f4cf76). The visual truth is `docs/design/screens/` (the D1 labels come from origin/design/d1-decided-season-gain @ 0cf5cfc).

## Global Constraints

- The big number is team value. The line under it reads `+$X · +Y% season gain · +$Z today`. The Season card is captioned "Season gain, week by week". "since the draft" never appears on Home. All hero/season labels live in `lib/home/homeCopy.ts`.
- Single-league Home (the pill, "+N"; no other-leagues row). Dollars decide.
- Standings come only from `league_standings_ranked`, in server order, and are never re-sorted.
- A regular-season bye has no result. The minus is U+2212. Money never wraps. Zero is grey.
- Nothing is final before `team1_gain`/`team2_gain` are non-null for my matchup.
- Motion uses tokens only (`useMotion`, `useLeadChangeSpring`). `lively` stays game-surface only.
- Styles go at the bottom, with the file-top eslint-disable on new component files.
- No prod-mutating commands. Commit on `ui/mobile-home` only.

## Baseline (origin/main @ da36037, measured on this branch before any change)

| Check | Baseline |
|---|---|
| `npx tsc --noEmit` (apps/mobile) | **2** errors: `LeagueCarousel.tsx(99)` (known orphan) **and** `ExternalLink.tsx(13)` (unused `@ts-expect-error`, which appears after a fresh `npm ci`, so the brief's "1" is stale). I won't add any. |
| `npm run lint` | 0 errors, 12 warnings |
| `cd tests-deno && deno test .` | 393 passed, 0 failed |

---

## Orchestrator rulings (GO received 2026-09-29; session moved to Sonnet from this point)

- **F1 → Option A approved.** New RPC `get_home_league(p_league_id uuid) returns jsonb`, migration `20261018000000`–`20261018000009` reserved (renamed from
  `20261016000000` on 2026-09-30 so it sorts after
  `20261017000000_f8_push_tokens_relocation.sql`, landed on main first —
  `supabase db push` refuses a pending file older than the latest applied
  one). Visibility no wider than existing member RLS (trades: "Users can view trades in their leagues"; week_snapshots: `week_snapshots_select_members`; drafts: "Users can view picks in their leagues"). The migration header carries a dataset→policy table. Scope: this league only, caller's own ledger, opponent's rows for the CURRENT week only, standings via `league_standings_ranked`, names via `get_league_display_names`/`participant_display_name`. Grants: SECURITY DEFINER, `search_path = public, pg_temp`, `is_member` gate (unauth → 42501; non-member → empty). REVOKE ALL from public/anon/authenticated/service_role, then GRANT EXECUTE to authenticated. PGlite test per `supabase/tests/season_result.pglite.test.ts`'s harness pattern: member ok, non-member empty, anon 42501, proacl asserted, opponent's PREVIOUS-week trades NOT returned, mutation-checked member gate. Regenerate the architecture map. security-reviewer + supabase-reviewer subagents review the migration before DONE. DONE message carries a HUMAN ACTION db push + proacl + effect check. Client destructures `{data,error}` on every `.rpc()`; on error, an honest empty/error state, never zeros.
- **F2 → approved as proposed**, plus a per-position rule for `todayChange`: held-since-before-today = qty×(price−prevClose); bought today = qty×(price−buyPrice); sold today = proceeds − qty×prevClose (realized today). No prevClose for a symbol → unpriced, never 0. Non-trading day → null. Tested per case, including a slot sold then rebought same day.
- **F3 → resolved.** `teamValue` = Σ qty×live price + cash, ONE helper, Portfolio 3e reuses it. Stake: fixed_notional = notional_per_slot × num_rounds (skipped slots are cash, they count); price_tiers AND budget_cap = one-share-per-pick (`fillQuantity`), so stake = Σ draft price × qty (the drafted roster's cost basis) — NOT `budget_amount` (a cap, not an investment). Cash in the one-share modes: read `record-trade`'s actual rule rather than assuming the fixed_notional proceeds rule applies; if cash can go negative or the value identity breaks in a mode, flag it in the report instead of smoothing it. Tests: one fixture per mode, plus legacy NULL `stake_mode` (treated as one-share, flagged). Hero `+Y%` = season gain ÷ stake.
- **F4/F5 → agreed**, build as planned.
- **State 8 (season complete) → backed by `get_season_result(p_league_id, p_season_id default null)`**, PR #77 (`origin/feat/season-result-summary` @ `dceeb40`, migration `20261014000000_get_season_result_rpc.sql`), merging soon but **not live yet** — build against its returned shape and degrade honestly (RPC-not-found / any-error → the existing minimum: rank, record, season gain from the summary, no fabricated tiles) until it's live. Mapping rules from its author:
  - **Playoffs tile:** champion → "won the Final"; runner_up → "lost in the Final"; eliminated at round r → "lost in the " + `playoffRoundLabels(playoff_teams)[r-1]`; missed (`exit_round` NULL, record 0–0) → "missed the playoffs". Record = `playoff_wins`–`playoff_losses` (a bye is not a game).
  - **`detail_scope='standings_only'`** (a past, no-longer-current season): `playoff_teams`/`playoff_weeks`/`exit_round`/W-L/`best_week_*` are all NULL. `runner_up` still renders "lost in the Final" WITHOUT indexing the labels (no `playoff_teams` to index with). `playoff_result` NULL under this scope = unknown → **hide the tile**, never "missed".
  - **Regular season tile:** "Nth of M · W–L" = `final_rank` of `standings_count`; append "–T" only if `ties > 0`.
  - **Best week tile:** `best_week_number`/`best_week_gain` — can be a bye week, can be negative.
  - **Season gain tile:** `points_for`.
  - **NULL discipline:** every number is NULL unless `status='complete'`. `caller_participated=false` → caller fields NULL, podium still set.
  - **Statuses:** `complete` / `not_complete` (`season_in_progress`|`no_season`) / `inconsistent` (+`reason`) / `unsupported` (duration league). Anything but `complete` → no fabricated tile, ever.

## Findings that shape the plan (superseded by the rulings above; kept for the reasoning)

**F1. The request budget (≤ 5) can't be met with existing endpoints.** The live state needs:

- the summary;
- this week's snapshots (both players), plus my snapshots for every past week (the chart);
- this week's trades (both players; mid-week buys don't exist in `week_snapshots` until Friday), plus my full ledger (drafts + trades) for team value;
- quotes;
- my matchups (all weeks);
- standings (`league_standings_ranked`) plus names/bots (`get_league_display_names`);
- bars.

Folded with PostgREST `.or()` where possible, that is still **summary + snapshots + trades + drafts + quote + matchups + standings + names + bars = 9** (8 new, since the summary is already fetched by `LeagueContext`).

- **Option A (recommended): one new read-only RPC** `get_home_league(p_league_id uuid) returns jsonb`.
  - SECURITY DEFINER, `search_path` pinned, `is_member` gate, and grants revoked from `anon`/`authenticated`/`service_role`, then granted to `authenticated` (the proacl check in the header).
  - It returns `{ stake, my_ledger:{drafts,trades}, opp_week_trades, snapshots:{mine_all_weeks, opp_this_week}, my_matchups, standings:[{user_id,rank,wins,losses,ties,points_for,display_name,is_bot}] }`.
  - Home on load: summary (shared with LeagueContext) + `get_home_league` + `quote` + `historical-bars` = **4**. `market_session_status` is already fetched by LeagueContext and is exposed rather than re-fetched.
  - I need a migration timestamp range, and a PGlite test goes with it.
- **Option B: no backend change.** 9 requests, over budget, and I'd report the count as such.
- I can build every pure module and all the UI against the fixture before A lands. Only `useHomeLeague`'s fetch layer depends on the choice.

**F2. The multi-symbol `quote` returns `{prices}` only, with no `prevClose`.** Only the single-symbol path returns `prevClose`. For "+$Z today" I plan to take `prevClose` from `historical-bars`: the last daily bar dated before today (ET). So the bars request fires **on load**, in parallel, not lazily. The chart still *draws* only when it enters the viewport. That avoids an edge-function change. The alternative is extending `quote` multi-mode to return `prevCloses`, which needs a deploy. Recommend the bars route.

**F3. Team value isn't defined anywhere client-side, and cash counts in value (per data.js SALE).** I propose:

> value = stake + unrealized + realized = Σ qty × price + cash

This works because cash ≡ stake − cost(current) + realized under the proceeds-reinvest rule (derivation in `teamValue.ts`'s header; it holds for skipped draft slots too).

- The stake is `notional_per_slot × num_rounds` (fixed_notional) or `budget_amount` (budget_cap).
- **price_tiers: what is the stake?** If there's no answer, the hero shows value without cash for that mode and flags it.
- The hero's `+Y%` = season gain ÷ stake (data.js: 343.59 / 12,000 = 2.86%).
- Please confirm the definition. Portfolio (3e) should reuse the same helper.

**F4. The old Matchup live math (pre-3b-1 `matchup.tsx`) was not `entered_mid_week`-aware.**

- For a user who had any Monday snapshot, every holding *not* in the snapshot scored **$0**. So a partial mid-week buyer's live score silently omitted those buys. That is CLAUDE.md's partial-state family again (instance 6 if you're counting).
- Matchup is a 3b-1 placeholder today, so there is nothing to "share" yet. `liveWeekScore` is therefore **ported from the server scorer** `process-week-results/user-score.ts::calculateUserScore`, with `weekEndPrice` replaced by the live price, not from the old client.
- A deno **parity test imports the server scorer** and asserts identical results on Friday-close prices. Matchup (3c) will call the same helper.

**F5. `current_week` advances on Friday once scoring succeeds** (`process-week-results` step 6). So all weekend, the summary's "current matchup" is next week's unstarted row. The scored-weekend state reads the *previous* week's matchup row (from my matchups), not the summary. `homePhase` takes both.

---

## `homePhase(input)`: the single source of phase

Inputs:

```ts
{ league: Pick<League, 'draft_status'|'league_start_date'|'season_status'|'current_week'|'num_weeks'|'playoff_teams'>;
  current: MatchupRow|null;
  previous: MatchupRow|null;
  myUserId;
  laterPlayoffRow: boolean;
  lastPlayoffLost: boolean;
  draftOrderWaiting: boolean;
  now: Date;
  market: { status:'open'|'closed'|'unknown'; reason; sessionCloseAt|null; nextOpenAt|null } }
```

`MatchupRow` = `{week, weekStart, weekEnd, isPlayoff, team1, team2, team1Gain, team2Gain}`. It returns a discriminated union.

| # | kind | Rule (evaluated top-down; first match wins) |
|---|---|---|
| 8 | `complete` | `season_status = 'completed'` (or legacy `current_week > num_weeks`, via `getSeasonPhase`) |
| 6 | `pre_draft` `{waiting}` | `draft_status = 'not_started'`; `waiting` = `get_draft_order` says the order isn't set/revealed |
| 7 | `drafting` | `draft_status = 'in_progress'` |
| 5 | `pre_season` | draft completed and (`now < league_start_date` **or** week 1's `weekStart > now`) |
| 3 | `scoring` `{week}` | the row in play (`current` if `now ≥ current.weekEnd`, else `previous` when `now < current.weekStart`) has `now ≥ weekEnd` **and** my side's gain IS NULL; **both** gains must be non-null to leave this state |
| 4 | `scored` `{week, result, nextStart}` | same row, both gains non-null, `now < next row's weekStart` (the Mon 9:30, or a holiday-shifted Tue, comes from the row, not a weekday rule) |
| 9 | `bye` `{week, nextStart}` | regular season, `now ∈ [weekStart, weekEnd)`, and no row for me **or** no opponent with `!isPlayoff` |
| 10 | `playoffs` modifier | `season_status = 'playoffs'`: states 1–4 carry `playoff:{round}` (from `playoffRoundLabelForWeek`); no row this week plus `laterPlayoffRow` → `{kind:'playoff_bye', round:'Semifinals'}`; no row plus `lastPlayoffLost` → `{kind:'eliminated', round}` |
| 1 | `live_open` | `now ∈ [weekStart, weekEnd)` and `market.status = 'open'` |
| 2 | `live_closed` `{reason, resumesAt}` | `now ∈ [weekStart, weekEnd)` and market not open; `reason` ∈ overnight/weekend/holiday from `market.reason`; `resumesAt` = `market.nextOpenAt`; `status='unknown'` → closed with `resumesAt:null` (never claims open, never invents a time) |

**Boundary tests (deno, `tests-deno/home-phase.test.ts`)**, one or more per state:

- Fri 15:59:59 ET → live_open.
- Fri 16:00:00 with gains null → scoring.
- Fri 16:00 with **only team1 gain** non-null (partial) → still scoring.
- Both non-null → scored.
- Sat with `current_week` already advanced (current = W7 unstarted, previous = W6 scored) → scored W6, `nextStart` = W7 row's weekStart.
- Mon 09:29:59 → scored; Mon 09:30:00 → live_open.
- Holiday Monday (W7 weekStart = Tue 09:30; Mon market reason `holiday`) → Mon 10:00 is still scored W6, and Tue 09:30 → live_open.
- Wed 20:00 → live_closed (overnight, resumes Thu 09:30).
- Market status `unknown` mid-week → live_closed with `resumesAt: null`.
- Bye week → bye, never a score.
- Playoff semifinal live → live_open + `{round:'Semifinals'}`.
- First-round bye, eliminated, season complete, pre_draft waiting/set, drafting, pre_season (Sun before W1).

## `liveWeekScore(input)`: shared with Matchup (3c)

`lib/home/liveWeekScore.ts`:

```ts
liveWeekScore({ snapshots, trades, price }) → { gain, pct, startValue, unpriced: string[], hasPositions }
```

- `snapshots` = this week's rows for one user, with `enteredMidWeek`.
- `trades` = that user's trades with `createdAt ∈ [weekStart, now]`.
- `price` is `(sym) => number | null`.

The algorithm is the server scorer's verbatim: Monday lots from `!enteredMidWeek` rows only; FIFO sells from Monday lots, then mid-week buys; remaining lots are marked at `price(sym)`. The one difference: an unpriced symbol is *listed* in `unpriced`, not silently dropped, and the server's drop semantics are kept for the gain/basis. The UI shows a note when `unpriced.length > 0` (same honesty as `plCoverage.unpricedNote`).

Tests (`tests-deno/live-week-score.test.ts`):

- **Parity with `calculateUserScore`** (imported from `supabase/functions/process-week-results/user-score.ts`) on 6 fixtures at Friday prices: held all week; partial sell; **some Monday lots plus one mid-week buy (the partial case)**; buy-then-sell same week; an `entered_mid_week` row present **and** the same buy in trades (no double count); all cash.
- The data.js sample at Thursday live → Roberto `gain` equals `KS.MATCHUP.live.you.gain` (the board number).
- An unpriced symbol is reported and not counted.

## `buildSeasonGainSeries(input)`: the chart (D1)

`lib/home/seasonGainSeries.ts`:

```ts
buildSeasonGainSeries({ weeks: WeekInput[], closes: Record<sym, {date, close}[]>, live: {gain}|null })
  → { points: {date, gain, week}[], weekStartIdx: number[], pinned: {week, barGain, scored, diff}[], mismatches: number }
```

- `WeekInput` = `{week, weekStart, weekEnd, scoredGain|null, snapshots, trades}`. A bye week has `scoredGain: 0` and no snapshots.
- A point is **one per trading day** (the dates present in the bars within `[weekStart, weekEnd]`). Weekends and holidays have no point, so they're flat by construction. The first point is `0` at Week 1's open, so there's no draft or deposit jump.
- For day *d* in week *w*: `Σ scored gains of weeks < w` + `liveWeekScore(snapshots_w, trades_w ≤ d, close_d)`.
- Each completed week's Friday point is **pinned** to `scoredGain`. `|barGain − scored| > 0.01` is counted in `mismatches` and listed in `pinned`, reported, never hidden.
- The last point is `Σ scored + live.gain`, which is **the same function call** as the hero, so they're equal by construction and the test asserts it.
- Windows: `windowSeries(series, '1W'|'1M'|'Season')`.
  - 1W is the current week's points, rebased to 0 at Monday open, and its endpoint = the this-week score.
  - 1M is the last 21 trading days, rebased to 0 at the window start.
  - Season is everything.

Tests (`tests-deno/season-gain-series.test.ts`):

- No deposit jump: the first point is 0 even with draft-price ≠ Monday-open.
- A Fri → Mon gap contributes 0.
- A holiday Monday has no point.
- Friday pin overrides the bar value, and the mismatch is counted when > $0.01 and not at $0.01.
- Endpoint = `seasonGain` (hero).
- The 1W endpoint = `liveWeekScore`.
- The 1M rebase starts at 0.
- A bye week is flat.
- The data.js ROBERTO_WEEKS reproduce `throughW5 = 129.99`.

## Other pure modules

- **`todayChange`**: Σ qty × (price − prevClose) over current holdings. A lot bought today counts from its entry price. Returns `null` on a non-trading day (market reason weekend/holiday, or no bar for today), so the hero hides it.
- **`teamValue`**: F3's value = Σ qty × price + cash, with `stakeFor(league)`. Unpriced lots count at cost (the `plCoverage` rule).
- **`seasonGain`**: `Σ my scored gains (matchups, weeks < live week) + live.gain`; percent = ÷ stake.
- **`homeCopy.ts`**: every hero/season/state string plus the VoiceOver sentences, each tagged `verbatim-existing | giorgio | board | new-flagged` in a comment. It is the single module the copy audit reads.

## Data: `useHomeLeague(leagueId)`

Returns `{ status, data, refresh }`, keyed by league. There's an in-memory cache per league so a pill switch crossfades onto cached data (H5).

- The summary row and market come from `LeagueContext`, extended to expose the raw `get_home_summary` row and the `market_session_status` row it already fetches, **with no new request**.
- Then Option A/B (F1), `quote` and `historical-bars`.
- The quote poll runs every 30 s only in `live_open`. Every supabase result's `{error}` is destructured (success-signal #5).
- The request counter is dev-only (`__DEV__` log) for the report.
- Per-state extras, fetched only in that state:
  - pre_draft: `get_draft_order` + `get_league_display_names` + `get_draft_clock`, for `pick_seconds`;
  - drafting: `get_draft_clock` + `get_draft_order`, plus my drafts for "Your team so far".

## Components (`components/home/`)

`HomeHero`, `ThisWeekCard` (a `Card variant="scoreboard"` with `ScoreDigits` via a shared `Scores` row, one shared size, and `TugBar`), `SeasonCard` (a `SeasonChart` SVG plus `WeekChips` plus a `SegmentedControl`), `StandingsCard`, `PhaseCard` (states 3–10 bodies), `PreDraftCard`, `DraftingCard`, `SeasonCompleteCard`, `RollingMoney` (money-surface digit roll, keyed by league id).

- `app/(tabs)/index.tsx` renders `ShellHeader` plus a `BarsRefresh` scroll. Content is offset by the **measured** header height (`onLayout`), which is carry-over 1.
- All shared-element candidates get stable `nativeID`s for 3c.

## Motion H1–H6 (tokens → reduced)

| | Full | Reduce Motion |
|---|---|---|
| H1 | Value/gain go through `RollingMoney` (per changed column, `duration.base`, `settle`), with a ref-guarded no-roll on first paint. The gain line gets one opacity/tint pulse (`base`) per changed value | instant swap |
| H2 | The path draws via an animated `strokeDashoffset` (`feature`) on first viewport entry. A window change morphs between paths resampled to N = 64 (`base`). `LiveDot` is at the endpoint only in live_open. Scrub is `Gesture.Pan().activateAfterLongPress(120)` with a floating label (date · gain), `Haptics.selectionAsync()` per trading-day index change, and highlighting of the matching week chip; the touch target is ≥ 44 pt | drawn; instant window change; the label works, no ticks |
| H3 | The scores roll (`ScoreDigits`). `TugBar` animates via `useLeadChangeSpring` (`lively`). A leader change crossfades the lead line and plays one accent-wash overlay (`base`). No haptic | static at the new ratio; instant text |
| H4 | Hero `entering`: opacity plus translateY 8 → 0 (`slow`, `settle`). Chips and standings rows use `stagger.delayFor(i)` | crossfade `quick`, no stagger |
| H5 | After S3, a `key={leagueId}` wrapper crossfades (`quick`). `RollingMoney` is keyed by league id, so nothing rolls | instant |
| H6 | The phase card is keyed by `phase.kind`: crossfade plus 8 px rise on change. The trophy springs in with `lively` plus one glow sweep, once per season (an AsyncStorage flag `home.trophy.<leagueId>.<seasonNumber>`) | static |

## Carry-overs

1. The header height is measured, not hard-coded.
2. The profile email wraps by character at XL (`ProfileView`).
3. Chips on the page background use the `surface` fill plus a hairline. That's retrofitted on the `ShellHeader` phase chip (Matchup/League/Portfolio), and the pair is added to `sp-contrast.test.ts` in both themes; I'll send the Design Lead the new PAIRS row.

## Fixture plan (states I can't reach live)

- `EXPO_PUBLIC_HOME_FIXTURE=<live_open|live_closed|scoring|scored|pre_season|pre_draft|pre_draft_waiting|drafting|complete|bye|playoff_live|playoff_bye|eliminated|leader_flip>`, `__DEV__` only, in `lib/home/devFixture.ts`.
- It is built from **data.js numbers** (Stock Scudetto, Roberto vs Gianluigi, week 6 of 14, THU/FRI prices, ROBERTO_WEEKS), so the fixture screens match the board to the cent.
- `leader_flip` alternates Thursday prices on the 30 s poll to force H3. `scoring → scored` flips after 5 s to record H6.
- Real data: state 1/2 on Giorgio's live league (he signs in), for the honesty check.

## Honesty check (on real data, for the report)

- Log with `__DEV__` from the hook: the chart endpoint vs the hero gain; the 1W endpoint vs the this-week score; each Friday point vs `matchups` (with the mismatch count); and value, stake, cost, season gain, `points_for` and value − stake − season gain (the drift).
- I'll ask the Orchestrator for any cross-check SQL (read-only), which Giorgio runs.

## Files

**Create:**

- `lib/home/{homePhase,liveWeekScore,seasonGainSeries,todayChange,teamValue,seasonGain,homeCopy,devFixture}.ts`
- `lib/home/useHomeLeague.ts`
- `components/home/*.tsx` (listed above)
- `tests-deno/{home-phase,live-week-score,season-gain-series,today-change,team-value,home-copy}.test.ts`
- (Option A) `supabase/migrations/<assigned>_get_home_league.sql` plus `supabase/tests/` PGlite

**Modify:**

- `app/(tabs)/index.tsx`
- `lib/LeagueContext.tsx` (expose the summary row and market; no new request)
- `components/shell/ShellHeader.tsx` (chip fill)
- `components/shell/ProfileView.tsx` (email wrap)
- `tests-deno/sp-contrast.test.ts`
- `docs/architecture/*` (regenerated)

**Delete:** `lib/useHomeData.ts` (its only importer was the old Home; I'll verify with grep first).

## Tasks (each ends with the checks green + a commit; `git status` / `git diff --cached --stat` / `git branch --show-current` before each)

1. `homeCopy` + `homePhase` + tests (TDD).
2. `liveWeekScore` + server-parity tests.
3. `seasonGainSeries` + `windowSeries` + tests.
4. `todayChange`, `teamValue`, `seasonGain` + tests.
5. The dev fixture + `useHomeLeague` (fixture path first; the real fetch per F1) + the LeagueContext exposure.
6. Hero + ThisWeekCard + Standings (static) + the measured header offset.
7. SeasonCard: the chart, windows, chips, scrub, a11y adjustable action.
8. The phase cards 3–10 + pre-draft/drafting/complete.
9. Motion H1–H6 + reduced paths.
10. Carry-overs 2 and 3 + the contrast test.
11. Architecture regen, captures/recordings (Light/Dark, XL 17 Pro + 17e), the honesty check, the copy audit, then Design Lead review → DONE.

## Review Focus (the failure modes most likely to bite; each has a test in the owning task)

1. **Partial scoring rows:** one gain posted, the other null → still "Scoring…" (Task 1).
2. **Weekend after the `current_week` bump:** Home must show last week's final, not a $0 "live" next week (Task 1).
3. **A partial mid-week buyer:** some Monday lots plus a mid-week buy → live score = server score (Task 2).
4. **A missing quote or bar:** listed and noted, never $0-valued and never silently dropped from the hero without a note (Tasks 2 and 4).
5. **Calendar `unknown`, or a holiday Monday:** never "Market open"; the resume time comes from the calendar or the row, never a weekday rule (Task 1).

## Handoff (2026-09-30, paused -- Giorgio near his usage limit)

**HEAD: `eb05f92`, branch `ui/mobile-home`. Working tree clean** (verified via `git status`/`git diff --cached --stat` immediately before this note; only pre-existing untracked `.codex/`/`AGENTS.md`, not mine).

**Done, this session, in order:**
- Full B1-B8/S1-S6 pass (Design Lead's first review) -- landed across many commits ending at `9649308`.
- A-standard Light+Dark re-shoot #1 (66 files) -- delivered, then reviewed.
- Design Lead's re-shoot review found R1-R4 (blocking) + S7-S10 (should-fix). All of **R2, R3, R4, S7, S8, S9, S10 are fixed, tested (576/576 deno, tsc/lint baseline-clean), verified on-device, and committed at `eb05f92`** (commit message has full detail per item).
- **R1's root cause found**: the capture pass's "scroll to bottom" step used the simulator tool's `swipe` action, which does NOT reliably register as a scroll in this app's ScrollViews -- confirmed empirically (swipe: zero scroll; a slower multi-point `touch_path` drag: scrolls correctly). This is a capture-TOOLING bug, not a code bug -- no code fix needed, just a technique change for the next capture pass.
- The Design Lead has since approved the FINAL B8 scope (relayed by Orchestrator): XL on 3b2 17e only (states 1/3/6/7/10, hero at $123,456.78/+$23,456.78, I12 caption, carry-overs 1+2, carry-over 3 as a standard-size Light still), recordings RM-off (H1/H2/H3/H5/H6, H2 as first-view draw-in + Season->1W window change + a scrub across a past week into the live week) plus ONE combined RM-on clip, and a README index (not contact sheets). Giorgio has granted simulator consent for 3b2 17e (previously blocked).
- H1/H3/H5/H6 RM-off recordings from BEFORE the R2-R4/S7-S10 fixes already exist at `~/fantasy-stock-design-review/ui-mobile-home/C-recordings/rm-off/` (H1-roll.mov, H3-leader-flip.mov, H5-league-switch.mov, H6-trophy.mov) -- these used live_open/leader_flip/league-switch/complete states, none of which R1-R4 touched, so they're likely still valid, but WEREN'T RE-VERIFIED after the fixture edits in `eb05f92` (useHomeLeague.ts changed under all of them for other reasons -- e.g. the S5 leader_flip fix, the R4 pre-season/standings fixes). Spot-check before trusting them in the final delivery.
- A-standard Light+Dark re-shoot #1's 66 files are now STALE (superseded by the code fixes) and should be treated as not-yet-redone.

**Remaining, in order:**
1. **Re-shoot A-standard Light+Dark, ALL 17 states, using `touch_path` (NOT `swipe`) for every "scroll to bottom" step.** This is the ONLY re-shoot needed before the gate -- Design Lead's review said "re-shoot ONLY the states they touch," but since R3 (season gain) and R4 (fixture records) both reach the hero/standings on EVERY state, and R1 (scroll technique) affects every multi-screen state, treat this as a full 17-state x 2-theme pass, same establishe technique as before (fixture env var + terminate/openurl/sleep 13 + tap (374,465) to dismiss the Expo Go dev-menu toast, all in POINTS not pixels -- device is "3b2 17 Pro", UDID `501242EE-621B-423A-A40C-549F3ECBFB1E`, 1206x2622px = 402x874pt, 3x scale), except replace the swipe step with a touch_path like:
   `points: [{x:200,y:750,dt_ms:0},{x:200,y:600,dt_ms:80},{x:200,y:450,dt_ms:80},{x:200,y:300,dt_ms:80},{x:200,y:150,dt_ms:80}]`
   (verified working empirically this session -- scrolled a full screen's worth of content in one pass). Clear `~/fantasy-stock-design-review/ui-mobile-home/A-standard/{light,dark}/*.png` first.
2. **XL on 3b2 17e** (consent already granted): states 1/3/6/7/10, Light only. Set `xcrun simctl ui <17e-udid> content_size accessibility-extra-extra-extra-large` (already the max accessibility size, set once this session, may still be set -- verify first) and `appearance light`. Need the specific $123,456.78/+$23,456.78 hero figures and the I12 unpriced-symbol caption -- these are NOT the current fixture's numbers, so either add a dedicated XL-only fixture variant or override quote()/holdings for this pass specifically (not yet designed -- pick the simplest approach that doesn't disturb the standard fixture). Carry-over 1 (league pill wraps to two lines, nothing overlapping) and carry-over 2 (Profile email wrap) need their own screens (shell, not Home). Carry-over 3 is a STANDARD-size Light still of the header on Matchup/League/Portfolio tabs, plus a note for the contrast-test pair -- not an XL capture.
3. **Recordings, RM off**: H1 (roll on update, not first paint), H3 (leader flip), H5 (league switch crossfade), H6 (trophy), and a NEW H2 clip specifically (chart first-view draw-in, then a Season->1W window change, then a scrub across a past week into the live week, checking the label snaps to real points like "Week 3 · ..."). Re-verify H1/H3/H5/H6 against the POST-FIX fixture state (see note above) rather than assuming the existing files are still accurate; H1/H3 need `leader_flip` + a pull-to-refresh-style gesture (this session found the SAME swipe-vs-touch_path issue may apply to triggering pull-to-refresh -- the gesture that worked for the recordings used `computer` swipe with SHORT distance (460,400)->(460,1200), which DID register -- likely because RefreshControl's touch threshold is more forgiving than a ScrollView content scroll; re-verify if it stops working). Recording mechanism: `xcrun simctl io <udid> recordVideo --codec=h264 --force <path>.mov &` backgrounded in the SAME bash call as the reload sequence (to minimize inter-call latency), `kill -INT <pid>` to stop cleanly (do NOT SIGKILL). Then ONE combined RM-on clip covering all of H1/H2/H3/H5/H6 -- Reduce Motion could NOT be toggled via Settings > Accessibility > Motion this session (every tap on that specific toggle, and even a KNOWN-currently-on toggle on the same screen, silently failed to register across 4 different attempts/methods -- tap x3, then a touch_path drag across the switch -- while ordinary list-row navigation on the SAME screens worked fine); this needs a fresh investigation (or ask Giorgio to toggle it manually on the device before this recording).
4. **README index** at `~/fantasy-stock-design-review/ui-mobile-home/README.md` (or similar) -- a state -> file path index, not contact sheets (Design Lead builds their own).
5. Send Orchestrator the folder path + HEAD SHA once 1-4 land; they forward to Design Lead for DESIGN-APPROVED.
6. Only after DESIGN-APPROVED: send Orchestrator the DONE report (SHA, check counts vs baseline, honesty-check table + request count noting the real-data check waits for Giorgio's sign-in, the copy-audit list, deferred items).

**Exact next step when resuming:** start at remaining-item 1 (the A-standard re-shoot with `touch_path`), starting from `xcrun simctl ui 501242EE-621B-423A-A40C-549F3ECBFB1E appearance light` and clearing the A-standard light/dark directories.
