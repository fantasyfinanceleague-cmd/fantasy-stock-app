# Phase 3c plan: mobile Matchup, League, draft room, Run it back (`ui/mobile-game`)

> Worker "3c Game", 2026-10-05. Spec: `docs/design/prompts/phase3c-mobile-game.md` (v2 + Run it back). Board: `docs/design/screens/key-screens.html`.
> Branch `ui/mobile-game` off `origin/main` @ `ee09a31`.
> **Landed early:** `1c32e02` (marketWeek moved to `lib/time/`, with a shim) and `cc28a0a` (U1).

## 0. Ground truth found in recon (affects the plan)

1. **No "as-of last week" standings exist.** `league_standings_ranked(p_league_id)` reads the cumulative `league_standings` table. No per-week variant or history table exists, so the ▲/▼ rule ("last week's order from the same RPC, not a client sort") needs a backend decision (D1).
2. **The Run it back SQL (PR #94) differs from design-doc §2.4.** The fixtures will follow the SQL, not the doc:
   - `counts` is nested (`counts:{in,new,out,pending,team_count,max_teams}`).
   - Non-member invitees get `full_list:false` and no `people`/`counts` keys at all.
   - There is no `caller_status:'none'`; a not-visible caller gets `{status:'not_visible'}`.
   - `people[]` carries `can_nudge`/`can_remove`/`is_commissioner`, but has no `invited_at` and no Season-1 rank. Its order is alphabetical within each group.
   - `get_home_summary.season_number` is NULL until Season 2's draft. Use `leagues.season_number`, which LeagueContext already selects with `*`.
   - `pick_clock_enabled` is not in `start_renewed_season`'s whitelist.
3. **Mobile still calls the revoked `start_new_league_season`** (`league-settings.tsx:174`; the button shows when `season_status='completed'`). It's removed in this phase.
4. **The client never touches `draft_queue` / `set_draft_queue` / `auto_pick`,** and `draft.tsx` doesn't select `drafts.pick_source`. The queue is read with `.from('draft_queue')` (own-row RLS) and written only through `set_draft_queue`.
5. **`get_home_league` already returns both sides' week snapshots + trades, my matchup rows and the ranked standings with names/`is_bot`.** So Matchup live is get_home_league + quote + historical-bars = 3 requests (+ the shared summary = 4, within the ≤5 budget). Matchup and Home then feed identical inputs to the one `liveWeekScore`.
6. **Members can read every league row of `matchups`, `week_snapshots` and `trades`** (is_member RLS / "Users can view trades in their leagues"). So "All matchups · League" can be scored live with the same helper.
7. Board inconsistencies, each resolved by a ruling or by derivation, never by guessing:
   - The 4-team bracket's "Championship" becomes **Final** (ruled round names).
   - The Season 2 teams count (5 vs 6) is derived from the roster.
   - The review's "Everyone has replied" is derived from `replies_pending`.
   - The `$2,000 per slot` vs `$2,000.00 a slot` formats follow each frame verbatim.

## 1. Screens: data per screen and request budget on load

The shared `get_home_summary`, `market_session_status` and `market_calendar` (LeagueContext) aren't counted again. `[dev] [game:<screen>] N requests` logging backs every count in the DONE report.

| # | Screen | Reads (on load) | Count |
|---|---|---|---|
| 1–3, 5 | Matchup live / final / phases / Friday reveal | `get_home_league`, `quote{symbols}`, `historical-bars{symbols,start=Mon−6d}` | **3** (+ summary = 4 ≤ 5) |
| 4 | All matchups (League segment, fetched lazily on first tap) | `matchups` (league, this week), `week_snapshots` (league, this week), `trades` (league, in the week window), `quote{all symbols}`. Names come from get_home_league standings. | 4 on tap; 0 on Matchup load |
| 6 | League standings + Week N results | `league_standings_ranked`, the previous-week order (D1), `matchups` (league, week N), `get_league_display_names` | 4 (3 if D1 folds both ranks into one RPC) |
| 7 | Playoff bracket | `matchups` where `is_playoff`, `get_league_display_names` | 2 |
| 8 | Draft lobby + reveal / waiting | `get_draft_order`, `get_league_display_names`, `draft_queue` (own), `draft-control{status}` | 4 |
| 9 | Arrange order / final | `get_draft_order` (+ names, shared with the lobby) → `set_draft_order` on save | 2 |
| 10 | Start draft confirm | `draft-control{status}` (blockers: not_enough_members / playoff_teams_exceeds_members); the playoff-teams fix is a `leagues` update | 1 (+1 on fix) |
| 11 | Draft room | `get_draft_clock`, `get_draft_order`, `drafts` (+`pick_source`), `league_draft_slots`, `get_league_display_names`, `draft_queue`, the realtime `drafts` channel (the existing one) | 6 + channel (today's draft.tsx issues more) |
| 12 | Create league · Season / Draft | none on load; insert with `pick_seconds`, `draft_order_mode`, `playoff_teams`, `num_weeks` | 0 |
| 13 | Draft recap | `drafts` (league, mine for "Your picks"), `quote{symbols}` | 2 |
| R1/R3/R4 | Home cards | The ask: `get_renewal_roster(successor_league_id)` only when the summary row has `successor_league_id` or `previous_league_id` | +1, only in those states |
| R2/R5/R6/R7 | League tab · season over / Who's running back / sheet | `get_renewal_roster`, `get_league_history(previous)` (Season 1 order + final standings) | 2 |
| R8 | Season 2 review | `leagues` row (already in context), `league_draft_slots` → `start_renewed_season` | 1 |
| R9/R10 | League tab S2 pre-draft / History | `get_league_history`; `get_season_matchups` on drill-in | 1 (+1) |

## 2. Architecture

**New pure modules, `lib/game/` (deno-tested, no RN imports):**
- `matchupPhase.ts`: maps `homePhase`'s PhaseResult onto Matchup's states. It reuses `homePhase` itself and never re-derives the phase. Pre-season, a bye with no scoreboard, and the playoff tag with its round are covered here.
- `lineupLedger.ts`: per-symbol week contributions, from the same FIFO accounting as `liveWeekScore`.
  - This means a small ADDITIVE extension to `liveWeekScore`: it also returns `bySymbol` contributions, and the existing fields are unchanged. Its server-parity test still holds.
  - Displayed rows use largest-remainder cent rounding, so **rows sum to the displayed score exactly**.
  - An unpriced symbol shows as "at cost" with the approved `plCoverage` caption. No % sits inside that caption's scope.
- `weekRace.ts`: Mon…Fri cumulative points. Each finished day = `liveWeekScore` with `price = that day's close` and trades filtered to `createdAt ≤ that day's close`; then the live point. No interpolation, and days with no bar are absent.
- `leadChange.ts`: detects a leader flip between polls, with a ≥30s cooldown, and names the mover (the largest |Δcontribution| since the last poll) → the chyron text.
- `revealOnce.ts`: key `reveal:<league>:<week>`, persisted in AsyncStorage behind an injectable store for deno.
- `standingsMovement.ts`: ▲/▼ from two server orders (current vs previous). It compares ranks only; it never sorts.
- `draftBoard.ts`: snake geometry (cell for pick n, the track path, on-the-clock seat, "Then X picks twice (12, 13)", "You pick 4th, then 13th, 20th…").
- `pickLog.ts`: `pick_source` → line (`auto_queue` → "Auto-picked · from their queue", `auto_best` → "Auto-picked · best available", `auto_skip` → skip, `manual`/`bot` → "Picked"); Auto badge = `auto_%`.
- `draftClock.ts`: deadline/server-skew → `on_clock` | `last10` | `auto_picking` (past the deadline, no row yet) | `idle`.
- `startDraftGates.ts`: draft-control blockers → the three confirm variants + the fix-it stepper bounds.
- `byeNotice.ts` (the board's `byeNotice`) and `playoffPlan.ts` (round names / weeks / byes line, from `lib/playoffs.ts`).
- `renewal.ts`: `group` → copy; counts line; R5 rows in Season 1 order; draft rows disabled ⇔ `replies_pending`; nudge enabled ⇔ `can_nudge` (with its 24h reason); in→out flip → ask card; redirect after "I'm in".
- `gameCopy.ts`: EVERY string, tagged verbatim(existing) / verbatim(Giorgio) / board / new-flagged (homeCopy pattern).

**Hooks:** `useMatchup`, `useAllMatchups`, `useStandings`, `useBracket`, `useDraftLobby`, `useDraftRoom`, `useRenewal`, `useLeagueHistory`. Each mirrors useHomeLeague (a stale guard, the request log, a `GAME_FIXTURE` branch).

**Components:** `components/game/*` are screen-level compositions that are NOT shared primitives: MatchupScoreboard, WeekRace, Lineups, StandingsTable (FLIP), Bracket, ClockRing, SnakeBoard, PickLog, OrderList (drag), RenewalRoster, ChampBanner.
- They compose the existing `sp/game` Scoreboard / ScoreDigits / TugBar / Chyron / LiveDot / Card unchanged.
- Any needed change to an `sp/*` primitive goes to the Design Lead first (none expected yet; I'll flag if the side-by-side "Scores" layout on key screen 2 needs a Scoreboard variant).

**Routes:**
- `(tabs)/matchup.tsx`: replaces the placeholder.
- `(tabs)/league.tsx`: replaces the placeholder. It's phase-driven: pre-draft → lobby, drafting → the draft room entry, season → standings/playoffs/history, complete → R2, renewal → R5/R6/R9.
- `draft.tsx`: rebuilt in place, keeping PR #20's finalize-heal logic verbatim.
- New stack routes: `arrange-order`, `start-draft` (sheet), `draft-recap`, `league-history`, `run-it-back/review`.
- The ticker tap goes to 3e's stock route (D7).

**Lib moves (each its own commit, imports updated, shim kept while 3e is in flight):** `liveWeekScore` and `ordinal` → `lib/game/`, once Matchup imports them.

## 3. Motion (each with a Reduce Motion path and a recording)

- **G1** ScoreDigits roll per poll; TugBar `spring.lively`; LiveDot the only loop.
- **G2** chyron slides in (`base`); the tug crosses with `lively` overshoot; score slam 1.08→1 (`base`); `Haptics.impactAsync(Light)`; at most one per 30s.
- **G3** the Friday reveal: scores roll to the close; the chip goes Live→Final; the tug settles; the banner rises (`slow`); on a win one celebratory beat ≤1.2s. Plays once per matchup-week, is non-blocking (pointerEvents none) and is skipped by Reduce Motion.
- **G4** FLIP rows (`slow`, `settle`, `useMotion().stagger`), then the ▲/▼ pop.
- **G5** a ticker fly from the search row to its board cell (measured layout); the track draws to the next pick; the ring hands over; the roster slot fills; your turn gets a pulse + haptic; the last 10s turn loss-red.
- **G6** the order resolves seat by seat (stagger); your slot is highlighted; "You pick 4th, then 13th…" types in.
- Errors and refusals appear instantly.

## 4. Fixtures (derived, never typed): `lib/game/fixture/`

- **One league, Stock Scudetto (6 managers, 14 weeks, $2,000 × 6).** `data.js` players, holdings `H` and `ROBERTO_WEEKS` drive a generated round-robin schedule. Weeks 1–5 are per-manager weekly gains chosen so the derived records equal THROUGH_W5 (Paolo 5–0 … Andrea 0–5, with H2H Alessandro over Roberto). Week 6 = WEEK6.
- Standings come from a **fixture-only** ranking emulation of `league_standings_ranked` (dev path only; production never ranks). A test asserts it reproduces STANDINGS_BEFORE/FINAL with their ▲/▼.
- The playoff fixtures for 4 and 6 teams are built from the backend shape: P−1 rows, no round-1 row for a bye seed, week = numWeeks + round.
- **Draft:** DRAFT_BOARD + snake seats; auto-pick picks 12/13 (`auto_queue`, `auto_best`); the clock 42/60 → past-deadline "Auto-picking…".
- **Serie A Traders lobby:** order revealed / still waiting (3 of 4).
- **Run it back:**
  - SEASON1 is frozen as `get_league_history` rows.
  - `get_renewal_roster` is produced in the **SQL shape** for each caller: commissioner (full, with can_nudge/can_remove), in-player (full, read-only), newcomer, pending/out (`full_list:false`).
  - In: Roberto/Paolo/Francesco/Gianluigi; out: Alessandro; pending: Andrea; new: Marta C.
- `EXPO_PUBLIC_GAME_FIXTURE=<state>` selects a state, mirroring 3b-2's `HOME_FIXTURE`.

## 5. Tests (deno, TDD, one commit per task)

- The phase → Matchup state mapping, for every PhaseResult kind.
- The ledger: rows sum to the score exactly (rounding), the at-cost exclusion, parity with Home's this-week number.
- The week race: no interpolation; mid-week trades only from their day; missing bars are absent, not 0.
- Lead-change detection, including the 30s cooldown and the mover naming.
- Reveal-once persistence, keyed per matchup-week.
- U1: done in `cc28a0a` (week-1 Monday after T0; holiday Monday; EST; the no-coverage fallback).
- The ▲/▼ movement against the previous week's server order (no sort).
- The pick log line per `pick_source`, and the Auto badge.
- Clock states: last10, and "Auto-picking…" past the deadline until the row arrives (server skew from `server_now`).
- Start-draft gates: <4 managers → invite; P > managers → stepper max = managers, Start disabled until it fits; the uneven-bye notice.
- byeNotice and playoffPlan, for every P from 2 to 16.
- The snake geometry and the "then 13th, 20th…" string.
- Run it back:
  - `group` → copy;
  - draft rows disabled ⇔ `replies_pending`;
  - the 24h nudge disable reason;
  - the in→out flip removing the list (R6 → the ask card);
  - the redirect after "I'm in";
  - `full_list:false` handling;
  - Season 1 ordering.
- Copy: every gameCopy string is tagged, and the board strings match the board.
- Contrast: any new token pair joins `sp-contrast.test.ts`.
- Request counts: each hook's fixture path asserts its request list.

## 6. Order of work

1. ✅ lib move `marketWeek` → `lib/time` (`1c32e02`). ✅ U1 (`cc28a0a`).
2. `gameCopy` + the fixture league (derived) + its ranking-emulation test.
3. **Matchup:** the ledger/race/leadChange/reveal libs → `useMatchup` → the screen (live, final, phases, bye, playoffs) → All matchups. Then the lib move liveWeekScore/ordinal → `lib/game`.
4. **League:** standings + movement (after D1) → Week N results → bracket → League tab phase routing; remove "Start new season".
5. **Draft:** lobby / reveal / waiting → arrange order / final → start-draft confirm → the draft room rebuild (clock, snake, queue, auto-pick visibility) → create-league Season/Draft steps → draft recap.
6. **Run it back:** R1/R3/R4 Home cards (additive) → R2/R5/R6/R7 → R8 → R9/R10.
7. The architecture map regen, full checks, then ONE capture pass (Light + Dark, XL on the 17e) and the G1–G6 recordings + the Reduce Motion clip.
8. Real-data checks (Giorgio signed in), then DONE.

## 7. Open decisions (need an answer before "go", or before the step that needs them)

- **D1 (backend, blocks the ▲/▼ in step 4):** there is no last-week order. Options:
  - (a) A new overload `league_standings_ranked(p_league_id, p_through_week)` that ranks from scored regular-season `matchups` ≤ week with the SAME keys. A PGlite test asserts that through the latest scored week it equals the 1-arg version. The migration goes in `20261030000000` (provisional).
  - (b) A new `league_standings_movement(p_league_id)` returning `{user_id, rank, prev_rank}`, where `rank` comes from the existing RPC verbatim.
  - **Recommend (a).** Who authors it: me (drafted via supabase-migration-writer) or a backend worker?
- **D2:** should "All matchups · League" score the other games live (4 requests on first tap, the same `liveWeekScore`)? Recommend yes; otherwise they'd show only after Friday.
- **D3 (behaviour):** the auto-pick cron is deferred. Should open draft-room clients fire `validate-and-record-pick {action:'auto_pick', pick_number}` once past the deadline? The server gates it on the deadline, is idempotent and returns `already_recorded`. Without it a timed-out turn stalls until the sweep runs. Recommend yes, with 0–3s jitter. The UI shows "Auto-picking…" either way.
- **D4 (copy/visual, to Giorgio via the Design Lead):** the League tab's `Schedule` segment (key screen 3: Standings | Schedule | History) has no board frame. Mockup needed, or drop the segment for 1.2.0.
- **D5 (copy):** the chyron grammar. The board has 5 example lines (data.js CHYRONS). I'd derive templates — "{T} {±x%} puts {name} ahead", "… keeps {name} in it", "{name} holds the lead through a red day", "{name} opens the week ahead", "{T} {±x%} on Friday seals it" — and flag them as new copy. OK?
- **D6 (backend ask to the feat/run-it-back worker):**
  - (i) R7's "Asked Sat, Jan 16" needs `invited_at` in `people[]`; it isn't returned. Until then the line shows only "Nudged …" / nothing.
  - (ii) R5's "Season 1 order" needs a rank. I can join `get_league_history(previous_league_id).final_standings`, which is the server's frozen rank, not a client sort. A `previous_rank` field in people[] would remove that second read. Which one?
- **D7 (3e coordination):** the route name for 3e's stock sheet, so the ticker tap can link to it (a stub until 3e merges). Proposal: `/stock/[symbol]`.
- **D8:** Create league's "Draft step" segmented control for the pick clock reads 30/45/60/75/90 (step 15, matching the DB CHECK). Confirming that's the full set (no 30–90 slider).
- **D9:** Matchup's "Scores" side by side (key screen 2) vs the `sp/game` Scoreboard's stacked rows. If I need a side-by-side variant of Scoreboard, that's a primitive change → the Design Lead. I'll try composing ScoreDigits/TugBar directly in `components/game/MatchupScoreboard` first, with no primitive edit.
