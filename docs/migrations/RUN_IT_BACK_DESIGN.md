# "Run it back": renewing a finished league (backend design)

**Status:** DESIGN ONLY. Nothing here is implemented, and no migration exists.
The Orchestrator approves the architecture. Giorgio settles the product
choices in §4 through the Design Lead's "Your call: Run it back" mockups.
**Branch:** `docs/run-it-back-design`. **Migration range reserved:** `20261023000000`–`09`.
**Author:** the "run it back backend" worker, 2026-10-04, read-only against `main` @ `ee2ceff`.

---

## TL;DR

- **Recommendation: architecture B.** The renewal is a **new `leagues` row** cloned from the
  finished one, linked by `previous_league_id`. The old league is never written again, so its
  history stays **full detail** (week by week, playoffs, best week) through the existing
  `get_season_result` with no change.
- **Why B:** every operational table and every reader is keyed by `league_id`. Under B the new
  season gets a new `league_id`, so each reader stays correct with no change: scoring, both
  snapshot jobs, draft turn math, `record-trade`, ranking, Home, the draft-order state machine.
  Under A or C, all of them need season scoping (≈20 server sites and ≈30 client sites). The
  draft-order triggers also **cannot be reset** for a league that keeps its id (§1.A.4).
- **Phase 1 is one SQL RPC plus a small change to `finalize_league_draft`.** The RPC is
  `renew_league`: atomic, commissioner-only, `authenticated`, explicit revoke from anon. After it
  runs, the new league goes through the **existing** draft path: draft-order modes, pick clock,
  auto-pick, `draft-control`, then `validate-and-record-pick` → `planSeason` →
  `finalize_league_draft`. No new edge function is needed for a redraft.
- **`start_new_league_season`: revoke it now and drop it later.** It is authenticated-callable,
  it destroys history, and it leaves the league stuck with no draft and no schedule. Phase 0 is a
  one-line `REVOKE` migration; phase 1 drops the function.
- **Product choices, by backend cost.** Auto-carry is ≈0 extra work. Opt-in is small (S): one RPC
  and one notification kind. Kept rosters is medium (M): an edge function that prices positions,
  plus a decision on how they are valued. Keepers are large (L): a declaration window, legality
  checks, and forced picks inside the turn engine.

---

## 0. Facts this design rests on (verified on `main` @ `ee2ceff`)

| # | Fact | Where |
|---|---|---|
| F1 | `start_new_league_season` INSERTs a `league_seasons` row, zeroes `league_standings`, **DELETEs every matchup**, and sets `season_status='active'`, `current_week=1`. It never touches `drafts`, `trades`, `week_snapshots` or `draft_status`. It is `authenticated`-callable and commissioner-gated. The only client caller is `apps/mobile/app/league-settings.tsx:174`, whose confirm text promises "Generate a new matchup schedule", which the function does not do. | `20260718000000` |
| F2 | Snake turn math is `totalPicks = count(drafts WHERE league_id)`. The draft is complete once `totalPicks >= n * numRounds`. In a same-id season 2 with season-1 picks still present, the draft would read **complete before its first pick**. | `_shared/draft-validation.ts:162-178`, `_shared/draft-write.ts:112` |
| F3 | Holdings are `userNetHoldings(drafts ∪ trades WHERE league_id)` everywhere: the draft legality gate, `record-trade`, `snapshot-week-start`, `snapshot-week-end` and `process-week-results`. None of them has a season filter. | `_shared/snapshot-holdings.ts`, `record-trade/index.ts:241-250`, `snapshot-week-start/index.ts:446-462` |
| F4 | The draft-order meta trigger refuses to **DELETE a non-`open` order while its league exists**, and refuses **any** UPDATE of a `locked` order. State only moves forward. Triggers bind every role, service_role included. The members trigger **refuses INSERT into a league whose order is `locked`** (no new members). | `20261013000000` lines 438-460, 497-519, 676-690 |
| F5 | `lock_draft_order_on_start` names the same-id case directly: "A re-start of a league whose order is already locked (no product flow does this today; season 2 keeps draft_status completed)." | `20261013000000:617-624` |
| F6 | Unique keys with no season column: `matchups (league_id, week_number, team1_user_id)` and `(…, team2_user_id)`; `matchups_bracket_address (league_id, playoff_round_number, bracket_position)`; `week_snapshots (league_id, user_id, week_number, symbol)`; `league_standings (league_id, user_id)`; `league_draft_order_meta (league_id)` PK; `league_draft_order (league_id, position)`; **`drafts_league_pick_unique_idx (league_id, pick_number) WHERE created_at > '2026-01-08'`**, so a second draft under the same id collides at pick 1; `draft_queue (league_id, user_id, symbol)`. | `20251230000000`, `20261012000000:177`, `20260105000000:18`, `20260108000000:28`, `20261010000000` |
| F13 | Other same-id traps, any of which would wrongly read a prior season: `start_league_playoffs` returns `already_transitioned` if **any** playoff matchup exists for the league (`NOT EXISTS`, `20261012000001`). `process-week-results:486` scans **globally** for `team1_gain IS NULL AND week_end < now()`. `league_standings_ranked`'s H2H tiebreak reads **all** scored regular matchups of the league. `get_draft_clock` counts all `drafts` of the league. `join_league_by_code` refuses `season_status='completed'` and `draft_status <> 'not_started'` (`20260930000000`). | explorer recon, latest definitions |
| F14 | The unmerged `ui/mobile-home` branch (`8ec6462`) adds `get_home_league` (`20261018000000`), which reads `matchups`/`week_snapshots` by league+week and `drafts`/`trades` by league+user for all time, and calls `get_season_result` from `lib/home/useSeasonResult.ts:93`. On `main`, `get_season_result` has no caller yet; `useHomeData.ts` and `LeagueCarousel.tsx` are dead code (imported only by a test). | branch `ui/mobile-home` |
| F7 | `get_season_result` gives `detail_scope='full'` only for the league's **current** season. Its playoff, coverage and best-week checks read `matchups WHERE league_id` with no season filter. Older seasons are `standings_only` precisely because F1 deletes their matchups. | `20261014000000` |
| F8 | `finalize_league_draft` creates **season 1** only when `current_season_id IS NULL`, and treats "zero regular-season matchups" as a fresh schedule. It takes no season number. | `20260926000000` |
| F9 | `record-trade` refuses only `draft_status <> 'completed'`. It does **not** refuse `season_status='completed'`, so trades are accepted in a finished league today. | `record-trade/index.ts:227` |
| F10 | The mobile league sheet already groups leagues into **Live / Upcoming / Finished** (`lib/shell/leagueSheet.ts`). Home shows one selected league, with a "+N" pill for the rest (product rule 2026-09-29). | `apps/mobile/lib/shell/leagueSheet.ts` |
| F11 | `[I5]` (self-DELETE on `league_members`) exists in the DB. The draft-order trigger closes the gap for a pre-draft leave and refuses a leave while `in_progress`. There is no mobile leave UI (STATUS §4 item 11). | `20260712000002:34`, `20261013000000:728-745` |
| F12 | Leagues are created by a **client INSERT** into `leagues` + `league_members` (`create-league.tsx:125-160`), plus `saveLeagueSlots` → `league_draft_slots`. | `apps/mobile/app/create-league.tsx` |

---

## 1. Architectures

Three are compared: A and B as required, plus C, the "textbook" normalisation, so that the
rejection of season columns is explicit rather than implied.

### A. Same `league_id`: archive the old season, then reset for a new draft

The old season's operational rows move out of the way, by deletion or by an archive, and the
league is reset to `draft_status='not_started'`.

**A.1 Tables touched (and where the archive lives).**

| Table | Action | Archive options |
|---|---|---|
| `matchups` | move or delete (F6 keys collide on week 1) | (a) `league_seasons.archive jsonb`; (b) an `archived_matchups` table with `season_id`; (c) keep in place with a new `season_id` (this is C) |
| `drafts` | **must** move (F2: turn math) | as above |
| `trades` | **must** move (F3: holdings) | as above |
| `week_snapshots` | must move (F6 key on `week_number`) | as above |
| `league_standings` | reset (today's zeroing) | already in `league_seasons.final_standings` |
| `league_draft_order_meta` / `league_draft_order` | **must** be reset. **Blocked by F4** for every role. | the trigger must gain a sanctioned "archive" transition |
| `draft_queue` | clear | — |
| `start_league_playoffs` guard, `process-week-results` global unscored scan, `league_standings_ranked` H2H, `get_draft_clock` count (F13) | each would read the prior season's rows if any survive the move | — |
| `league_notifications` (`draft_order_set`) | the partial UNIQUE "exactly once per member per league" would block season 2's notice | needs a season key or a delete |
| `leagues` | `draft_status`, `draft_date`, `draft_started_at`, `league_start/end_date`, `current_week`, `num_weeks?`, `season_status`, `current_season_id` reset | — |
| `league_seasons` | new row | — |

**A.2 Readers needing season scoping.** The readers themselves need none, *if* the move is
perfect; that conditional is the whole risk. After a correct archive, every reader sees only the
current season, because nothing else is left under the `league_id`. History readers are the
exception: anything that renders a past season must read the archive instead of the live tables:
- `get_season_result`'s `full` checks would need a second code path over the archive, or past
  seasons stay `standings_only` (today's behaviour).
- Week-by-week history needs an archive reader.
- The mobile/web screens that read `matchups`/`drafts`/`trades` for "what happened" would need an
  archive mode.

**A.3 Realtime / RLS.** New archive tables need member-SELECT policies (`is_member`) and
explicit revokes. Realtime subscriptions keyed on `league_id` would see a burst of DELETEs at
renewal, so every open client must handle a league "un-drafting" under it.

**A.4 Migration size: large.** It covers the archive schema; the archive-and-reset function
(DEFINER); a **rewrite of the draft-order state machine** (`enforce_league_draft_order_meta`,
`sync_draft_order_on_member_change`, `lock_draft_order_on_start`) to allow `locked → archived`
plus a fresh row; the `league_notifications` uniqueness; archive readers for history; and PGlite
tests for all of it. The draft-order machine is the most carefully proven code in the repo
(24/24 effect test, a regression test that found the commissioner-first leak). Reopening it is
the most expensive part of A and the most likely to regress.

**A.5 Partial-state risk: high**, the exact CLAUDE.md family. Archive-then-delete across five
tables is safe only as one transaction. Even in one transaction, a later column added to
`drafts` or `trades` and forgotten in the archive copy is **silent data loss**: the DELETE
succeeds and the copy omits the column. Any guard of the form "does this league have drafts?"
(F2, `finalize_league_draft`'s "zero regular-season rows", the stuck-draft detector) changes
meaning from "never drafted" to "drafted this season". Those guards were written assuming a
`league_id` has one lifetime.

**A.6 History rendering.** `get_season_result` keeps returning `standings_only` for every past
season unless it is taught to read the archive. Week-by-week history needs new readers.

### C. Same `league_id`, `season_id` on every operational table

Add `season_id uuid NOT NULL REFERENCES league_seasons` to `matchups`, `drafts`, `trades`,
`week_snapshots`, `league_standings`, `league_draft_order*`, `draft_queue` and
`league_notifications`. Every unique key gains `season_id`, and every reader filters
`season_id = leagues.current_season_id`.

**C.1 Tables touched.** All eight, plus every unique index in F6, plus a backfill (`season_id`
= the league's current season for every existing row). `league_seasons` must exist **before**
the draft (today `finalize_league_draft` creates it at the **end** of the draft, F8), so season
creation moves earlier for every league, including brand-new ones.

**C.2 Readers needing scoping: all of them.** Missing one is not an error. It **silently
blends two seasons**, which is the all-or-nothing family again: each reader keyed on
`league_id` alone reads "any row for this league" where it means "this season's rows".

| Layer | Sites |
|---|---|
| Edge functions | `process-week-results` (`index.ts` ≈11 `matchups` sites, the `week_snapshots`/`drafts`/`trades` reads at 570/628/657/670, the `league_standings` writes at 1070-1094, `season-completion.ts:192`, `season-transition.ts`), `snapshot-week-start` (381/447/456/460/496/624), `snapshot-week-end` (336/400/405/409/526/541), `record-trade` (242/249/396), `_shared/draft-write.ts` (113/122/208/298), `validate-and-record-pick`, `draft-autopick-sweep`, `draft-control` |
| SQL | `get_home_summary` (and `get_home_league`, F14), `league_standings_ranked` (H2H, F13), `get_season_result`, `complete_league_season`, `start_league_playoffs`, `finalize_league_draft`, `league_activity` view, `get_draft_clock`, `overdue_draft_turns`, `auto_pick_search_candidates`, `set_draft_queue`, all draft-order functions and triggers |
| Mobile | `usePortfolio.ts`, `player-portfolio.tsx`, `trade-history.tsx`, `(tabs)/draft.tsx`, `LeagueContext.tsx`; on `ui/mobile-home`, `get_home_league` and its hooks (F14). (`useHomeData.ts` and `LeagueCarousel.tsx` are dead code.) |
| Web (paused) | `Dashboard.jsx`, `DraftPage.jsx`, `Leaderboard.jsx`, `Matchup.jsx`, `PortfolioPage.jsx`, `TradeHistory.jsx` |

**C.3 Realtime / RLS.** Policies do not change (membership is still per league), but every
realtime filter on `league_id` now also delivers the other seasons' events.

**C.4 Migration size: largest.** It means schema changes on eight tables, with backfill and
re-keyed uniques under locks on live tables. It also means touching ≈20 server sites and ≈30
client sites, with a mobile release gate, because an old build reading without the filter blends
seasons the moment season 2 exists.

**C.5 Partial-state risk: high and long-lived.** It is not a one-time move. Every future reader
must remember the filter, forever.

**C.6 History rendering: best of the three.** Every past season stays full detail in place.
`get_season_result` just keys its checks on `season_id`.

### B. A new `leagues` row cloned from the old one (recommended)

`renew_league(old)` INSERTs a new league that copies the settings, sets
`previous_league_id = old.id`, copies the membership (or invites it, §4), and moves the invite
code. The old league is left **exactly as it is**: completed, scored, read-only.

**B.1 Tables touched.**

| Table | Action |
|---|---|
| `leagues` | **INSERT** one row (copy-classified columns, §2.3). **UPDATE** the old row's `invite_code` only (moved to the new league, §2.3). New columns: `previous_league_id uuid REFERENCES leagues(id)`, a partial UNIQUE on it (one successor per league, which is also the race and idempotency guard), `lineage_id uuid` (root league id; NULL = self), `season_number int NOT NULL DEFAULT 1` (lineage ordinal) |
| `league_members` | INSERT the carried members (auto-carry) or just the commissioner (opt-in) |
| `league_draft_slots` | copy the old league's rows (new ids, same shape) |
| `league_seasons` | **none at renewal.** `finalize_league_draft` creates the new league's season at draft end, as for every league, now numbered `leagues.season_number` instead of a literal 1 (§2.4) |
| everything else | **nothing.** No DELETE anywhere, and no row of the old league changes except `invite_code` |

**B.2 Readers needing season scoping: none.** A new `league_id` means each reader in the C.2
table is already scoped correctly by construction. Season 2's drafts, trades, snapshots,
matchups, standings, draft order and queue are simply that league's rows. Three things do
change, and none of them is a scoping fix:
1. `finalize_league_draft`: the season row uses `v_league.season_number` (one expression, two
   lines).
2. `get_home_summary`: add `previous_league_id`, `successor_league_id` and `season_number` to its
   output, so the league sheet can show "Season 2" and the finished league can link "Season 2 is
   set up →". Display only; the scoping is unchanged. **If `ui/mobile-home`'s `get_home_league` (F14) merges first**, the same three columns go there instead of (or as well as) `get_home_summary`. Under B, `get_home_league` itself needs **no** scoping change.
3. `record-trade`: refuse `season_status = 'completed'` (F9). This is a pre-existing gap, but
   under B the finished league stays in the sheet next to its successor, so a stray trade there
   becomes much more likely. One line, with a hermetic test.

**B.3 Realtime / RLS.** No new policies. The new league's rows are gated by membership of the
new league, through the policies that already exist. The old league stays readable to its
members because nobody's `league_members` row is deleted. Realtime filters on `league_id` keep
working, and the client re-subscribes when the active league switches. The Home-switch UX
therefore matters (§2.6), but it is not a backend risk.

**B.4 Migration size: small.** Three columns and one partial unique index; one DEFINER function
(`renew_league`); a two-line `finalize_league_draft` change; a re-created `get_home_summary`; a
new read function (`get_league_history`); the revoke/drop of `start_new_league_season`. There
are no changes to operational tables and no backfill beyond defaults.

**B.5 Partial-state risk: low, and recoverable.** Renewal is one transaction that writes only
**new** rows (and one invite code). It either fully exists or does not exist, and a failure
loses nothing. The checks that remain are all count-against-expected-set, per CLAUDE.md:
- Members copied: `count(new members) = count(old members)` under auto-carry, asserted inside
  the function before COMMIT.
- Slots copied: same, per `slot_index`.
- Columns copied: classified **exhaustively** (§2.3). The PGlite test enumerates
  `information_schema.columns` for `leagues` and **fails on any column it has not classified** as
  copy, reset or new. A future `leagues` column cannot silently go uncopied; the test forces the
  author to decide. This is the CLAUDE.md "verdict scope matches evidence scope" rule turned
  into a test.
- Double renewal (two taps, two devices): the partial UNIQUE on `previous_league_id` makes the
  second INSERT fail with `23505`. The function catches it and returns the existing successor's
  id as `already_renewed`, so the renewal is idempotent and never forks.

**B.6 History rendering.** For each league in the lineage, `get_season_result(league_id)`
returns `detail_scope = 'full'`, because each league's only season is its current season and its
matchups were never deleted. Week-by-week results, playoff exit round and best week all survive
with no change to `get_season_result`. A season list is a lineage walk (`get_league_history`,
§2.2). Seasons archived by `start_new_league_season` before this ships stay `standings_only`,
which is exactly what they are.

**B.7 What B costs that A and C do not.**
- **Two league rows in the user's list.** The old one moves to "Finished" by itself (F10). Whether
  a superseded league stays in the sheet, collapses under its successor, or hides is a client
  choice fed by `successor_league_id` (Design question, §4.5).
- **Identity across seasons is the lineage, not the id.** "All-time record vs. Alex" or "3×
  champion" become lineage queries (`lineage_id` index), not single-league ones. That fits a
  read RPC; it is not a reason to share ids.
- **Push/notification state and draft queues start empty** in the new league. That is correct:
  they are per-draft.

### Comparison

| | A: archive + reset | C: `season_id` everywhere | **B: new league row** |
|---|---|---|---|
| Operational tables changed | 8 (moves + trigger rewrite) | 8 (schema + backfill) | **0** |
| Readers to re-scope | history readers only, if the move is perfect | **all ≈50** | **0** (3 display/guard touches) |
| Draft-order state machine | **must be rewritten** (F4) | re-keyed on season | **untouched** |
| Destructive step | yes (DELETE after copy) | no | **no** |
| Partial-state exposure | high (multi-table move) | high, permanent (every future reader) | **low** (one INSERT transaction) |
| Past-season detail | `standings_only` unless archive readers are built | full | **full, free** |
| Old mobile builds | see a league "un-draft" | blend seasons unless filtered | **unaffected** (it's just a new league) |
| Migration size | L | XL | **S** |

**Recommendation: B.** It is the only option where correctness of the scoring and draft
pipeline after renewal is a property of the schema, not of every reader remembering a filter.
C's one real advantage, full history in place, B also gets for free.

---

## 2. The flow under B, end to end

```
commissioner: "Run it back"                 (old league: season_status='completed')
   │  rpc renew_league(old_id, overrides?)
   ▼
NEW league row: draft_status='not_started', draft_date NULL, settings copied,
                previous_league_id=old, season_number=old+1, invite code moved
   │  auto-carry: all members copied         │  opt-in (§4.2): commissioner only + notices
   ▼                                         ▼  members: rpc accept_league_renewal(new_id)
settings review: commissioner edits the NEW league (existing leagues_update_commissioner [I2a]
                 + league_draft_slots writes); playoff_teams is still editable (not_started)
   │  commissioner sets draft_date
   ▼
draft-order modes: random at T−1h / manual (get_draft_order, set_draft_order)  — unchanged
   │  draft-control 'start' (blockers: ≥4 members, playoff_teams ≤ members, date reached)
   ▼
trg_leagues_order_start locks the order → pick clock + auto-pick sweep + queue — unchanged
   │  last pick: validate-and-record-pick / draft-autopick-sweep → draft-write.ts
   ▼
planSeason (_shared/schedule.ts) → finalize_league_draft: matchups, standings,
   dates, league_seasons row (season_number = leagues.season_number) — CHANGED (2 lines)
   ▼
week 1: snapshot-week-start / -end / process-week-results — unchanged (new league_id)
```

### 2.1 New, changed, reused

| Name | Kind | New / changed / reused | Caller | Notes |
|---|---|---|---|---|
| `renew_league(p_league_id uuid, p_name text default null)` | SQL, SECURITY DEFINER | **new** | mobile (commissioner) | §2.3. Returns `jsonb {status: 'renewed'\|'already_renewed', league_id}`; game-flow refusals return `{status:'refused', reason}` (finalize convention), auth failures raise `42501`. |
| `get_league_history(p_league_id uuid)` | SQL, SECURITY DEFINER, STABLE | **new** | mobile | One row per season in the lineage: `league_id, season_number, season_id, completed_at, champion/runner-up (+display names), caller's final_rank/record/points_for, is_current`. Reads only `league_seasons` + `leagues`, never operational tables. The detail tap calls `get_season_result(that_league_id)`. |
| `accept_league_renewal(p_league_id uuid)` | SQL, SECURITY DEFINER | **new, opt-in only** | mobile (member) | §4.2 |
| `finalize_league_draft` | SQL | **changed** | `draft-write.ts` (service_role) | `season_number = v_league.season_number` in the season INSERT and the select after it. Grants unchanged (service_role only); re-assert with the `proacl` query since `CREATE OR REPLACE` keeps the ACL. |
| `get_home_summary` | SQL | **changed** (output columns) | mobile | + `previous_league_id`, `successor_league_id`, `season_number`. Changing a `RETURNS TABLE` shape needs `DROP FUNCTION` + `CREATE`, which **resets privileges**, so re-apply the explicit revoke/grant (the opposite trap to CLAUDE.md's `CREATE OR REPLACE`). |
| `record-trade` | edge fn | **changed** | mobile | refuse `season_status='completed'` → `{ok:false, reason:'season_completed'}` (200, game-flow refusal) |
| `start_new_league_season` | SQL | **revoked (phase 0), dropped (phase 1)** | — | §3 |
| `draft-control` (`status`/`start`/`add_bots`), `get_draft_order`, `set_draft_order`, `get_draft_clock`, `set_draft_queue`, `validate-and-record-pick`, `draft-autopick-sweep`, `draft-order-notify`, `_shared/schedule.ts planSeason`, `snapshot-week-start`, `snapshot-week-end`, `process-week-results`, `complete_league_season`, `start_league_playoffs`, `league_standings_ranked`, `get_season_result` | — | **reused unchanged** | — | the new league is an ordinary league |

STATUS §4 item 9 proposed "route it through an edge function reusing `_shared/schedule.ts` +
`finalize_league_draft`". Under B that path **already exists**: it is the normal draft
completion in `draft-write.ts`. A redraft needs no edge function. Only the kept-rosters variant
(§4.3) needs one, because it must price positions.

### 2.2 Security model

Every new function follows the established shape: SECURITY DEFINER, `SET search_path = public,
pg_temp`, and grants written out in full:
```sql
REVOKE ALL ON FUNCTION public.renew_league(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_league(uuid, text) FROM anon;          -- Supabase default grant
REVOKE ALL ON FUNCTION public.renew_league(uuid, text) FROM service_role;  -- no server caller; auth.uid() would be NULL anyway
GRANT EXECUTE ON FUNCTION public.renew_league(uuid, text) TO authenticated;
```
Verify every one with the `proacl` query. The PGlite test simulates `ALTER DEFAULT PRIVILEGES`
so that the assertion proves the explicit revokes work, as `finalize_league_draft.pglite.test.ts`
does.

| Function | Who | Identity check (inside, keyed on `auth.uid()`) | State checks |
|---|---|---|---|
| `renew_league` | commissioner of the **old** league | `auth.uid() IS NULL → 42501`; `leagues.commissioner_id = auth.uid()::text` (text cast, B1 convention), checked **before** state so a non-commissioner learns nothing | old league `league_type='matchup'` (duration leagues: §4.6), `season_status='completed'`, its current season `completed_at IS NOT NULL` (both, not either: a completed status with an open season row is the `season_status_mismatch` that `get_season_result` refuses), and no successor yet |
| `get_league_history` | a member of `p_league_id` | `is_member(p_league_id)`, else 0 rows (no existence oracle, like `get_season_result`) | — |
| `accept_league_renewal` | a member of the **predecessor** | `is_member(new.previous_league_id)` evaluated for `auth.uid()`; never a caller-supplied user id (the `join_league_by_code` `p_user_id` lesson) | new league `draft_status='not_started'`; the members trigger then enforces the order rules (append after T−1h, refuse once locked) |

- **The commissioner of the new league** is the old commissioner (copied). A commissioner
  hand-off at renewal is out of scope; `commissioner_id` is copied as is.
- **Settings edits** after renewal use the paths that exist today: `leagues_update_commissioner`
  [I2a], the F1 member column guard, the playoff freeze (still `not_started`, so editable) and
  `trg_leagues_order_mode`. Nothing new is opened.
- **`renew_league` writes the old league's `invite_code`.** That is an UPDATE of another league
  row under DEFINER, so it is scoped to `WHERE id = p_league_id`, done after the identity gate,
  and is the **only** column of the old row it writes.

### 2.3 `renew_league`: the column contract

Every `leagues` column is classified. The PGlite test fails on any unclassified column (B.5).

| Class | Columns |
|---|---|
| **Copy** (editable afterwards) | `name` (or `p_name`), `num_participants`, `num_rounds`, `stake_mode`, `notional_per_slot`, `budget_amount`, `budget_mode` (deprecated, copied so the default never differs), `allow_undraftable`, `league_type`, `duration_days`, `num_weeks`, `playoff_teams`, `draft_order_mode`, `pick_seconds`, `pick_clock_enabled`, `commissioner_id` |
| **Reset** (to the create-league defaults) | `draft_status='not_started'`, `draft_date=NULL` (the commissioner picks one; the draft-start blocker `no_draft_date` already enforces it), `draft_started_at=NULL`, `league_start_date=NULL`, `league_end_date=NULL`, `current_week=1`, `current_season_id=NULL`, `season_status='active'` |
| **New** | `id`, `created_at`, `previous_league_id = old.id`, `lineage_id = coalesce(old.lineage_id, old.id)`, `season_number = old.season_number + 1` |
| **Moved** | `invite_code`: the new league takes the old code; the old league gets a fresh random one. Shared invite links keep pointing at the league people actually want to join. (`invite_code` is UNIQUE, so the old row is updated first in the same transaction.) |

Also copied: the `league_draft_slots` rows (same `slot_index`/`slot_count`/`price_min`/
`price_max`/`category_id`, new ids). `num_weeks` is copied as is. Under auto-carry the member
count is unchanged, so the planner's minimum still holds; if members leave or join before the
draft, `num_weeks` stays editable while `not_started`, and `finalize_league_draft` refuses a
`num_weeks_mismatch` honestly.

Auto-carry copies `league_members` (`user_id`, `role`). **Bots are copied too**: they were part
of the league. Draft start re-checks `≥4` and `playoff_teams ≤ members` anyway. There is no
draft-order meta row yet, so the members trigger's "no row: nothing to do" branch applies, and
the order is materialised fresh at reveal or start.

### 2.4 `finalize_league_draft` change (exact)

```sql
-- was: values (p_league_id, 1, …)  /  where … and season_number = 1
insert into league_seasons (league_id, season_number, started_at)
values (p_league_id, v_league.season_number, coalesce(v_league.league_start_date, p_league_start))
on conflict (league_id, season_number) do nothing;
…
select id into v_season_id from league_seasons
where league_id = p_league_id and season_number = v_league.season_number;
```
`season_number` defaults to 1, so every existing and newly created league behaves byte-identically.
The existing PGlite suite must pass unchanged, plus one new case (season_number = 3 → a
`league_seasons` row numbered 3).

### 2.5 Old league: read-only by convention, guarded where it matters

After renewal the old league is `draft_status='completed'`, `season_status='completed'`, with
every matchup scored. What could still write to it, and how each is closed:
- **Scoring and snapshot crons:** they select leagues by pending or current-week matchups, and a
  finished league has none. Nothing to do.
- **Trades:** `record-trade` refuses them (B.2 item 3).
- **Joins:** `join_league_by_code` already refuses a `season_status='completed'` league (F13).
  Moving the code makes the old invite links useful again instead of dead-ending in that refusal.
- **Snapshot jobs (pre-existing, not introduced by B):** both select **every** matchup league
  with `current_week IS NOT NULL` (`snapshot-week-start/index.ts:319`, `snapshot-week-end/index.ts:301`),
  with no `season_status` filter, so finished leagues are examined every run today. Their
  coverage gates make that a no-op, but B accumulates finished leagues faster. Recommended as
  a cheap follow-up: add `.neq('season_status','completed')` to both selects (hermetic-testable,
  and it reduces pointless reads). Not required for correctness.
- **Commissioner settings edits ([I2a]):** still possible and harmless (no reader re-derives a
  finished season from settings; `get_season_result` takes P from the rows). Flagged, not
  blocked, in phase 1.

### 2.6 Client contract (for the mobile worker, not this design's code)

- After `renew_league` returns, `setActiveLeagueId(new_id)` (as `create-league.tsx` does).
- Members' devices still point at the old league. Its Home "Season complete" state reads
  `successor_league_id` from `get_home_summary` and shows the "Season 2 is set up" link.
- The history screen: `get_league_history(current)`, then `get_season_result(row.league_id)`
  for detail.
- Remove the `league-settings.tsx` "Start New Season" button, which calls the revoked function.

---

## 3. Today's `start_new_league_season`: revoke now, drop in phase 1

It is **strictly worse than nothing**. It deletes the season's matchups, so history drops to
`standings_only`. It creates no draft and no schedule (STATUS §4 item 9). Season-1 drafts and
trades persist, so holdings carry over silently (F3). `draft_status` stays `completed`, so the
pick path refuses and nothing ever heals it. Its confirm dialog also tells the commissioner it
generates a schedule, which it does not. It is callable today by any commissioner of a completed
league through the 1.1.0 build's settings screen.

- **Phase 0 (immediately, independent of this feature):** `20261023000000_revoke_start_new_league_season.sql`:
  ```sql
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM anon;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM authenticated;
  -- no grant to anyone; postgres keeps ownership
  ```
  Effect check: `proacl` shows only `postgres`; an authenticated commissioner call returns
  `42501`. The 1.1.0 button then fails closed with an error alert instead of wiping a season.
  The function is **not dropped yet**, so `season_result.pglite.test.ts` (which slices it from
  `20260718000000` to build the archived-season fixture) keeps working, and the function stays
  restorable if anything unexpected calls it.
- **Phase 1:** drop it in `20261023000009_drop_start_new_league_season.sql`, after the mobile
  build without the button ships. The PGlite fixture keeps slicing the definition from the
  historical file, since migration files are never rewritten. **Wrapping it was considered and
  rejected:** nothing in its body is worth keeping under B.

---

## 4. Product choices that change the backend

Each row is additive on top of phase 1 (redraft + auto-carry).

| Choice | Backend delta | Size |
|---|---|---|
| **4.1 Auto-carry** (everyone is in; leave if you're out) | **none beyond phase 1.** Opting out = leaving the new league before the draft through the existing `[I5]` self-DELETE (F11); the draft-order trigger closes the gap and refuses once in progress. Needs a mobile "I'm out" button (client only). A commissioner "remove member pre-draft" would be a small new DEFINER RPC (`remove_league_member`, commissioner-only, `draft_status='not_started'` only). | 0 / XS |
| **4.2 Opt-in** (each member confirms) | `renew_league` copies only the commissioner. **+ `league_notifications.kind` CHECK += `'league_renewal'`**, one row per human predecessor member, inserted in the renewal transaction (the existing exactly-once partial UNIQUE pattern). **+ `accept_league_renewal(new_id)`** (§2.2). **+ push:** generalise `draft-order-notify`'s body builder by `kind` (Design Lead copy), or phase it as in-app only. Decline = no action (no row). No deadline is needed: draft start freezes membership (F4), and late acceptors after T−1h are appended (existing rule). Non-predecessor newcomers still join by invite code. | S |
| **4.3 Kept rosters** (no draft; last season's holdings carry over) | **+ edge function `carry-rosters`** (commissioner, after renewal, before any draft): for each carried member, final net holdings from the **old** league (`userNetHoldings` over its drafts ∪ trades), priced now (`_shared/alpaca-price.ts`), written as `drafts` rows in the **new** league with **`pick_source='carried'`** (CHECK change, an explicit discriminator, never inferred), then `draft_status` → `in_progress` (locks the order) → `planSeason` → `finalize_league_draft`. **Decisions it forces:** (a) basis: entry price = the carry-time price (season gain starts at 0, as it must for a per-season score); (b) quantity in `fixed_notional` leagues: keep shares (team values differ from day 1) or re-size every slot to the notional (equal start, but it is no longer "the same roster"); (c) members with no prior roster (newcomers or opt-ins) cannot be carried, so they need a mini-draft or are refused; (d) the all-or-nothing pricing problem (CLAUDE.md #7): one unpriceable symbol must not abort the whole league, so define a per-member coverage verdict and a refusal that is recoverable. | M |
| **4.4 Keepers** (keep K stocks, draft the rest) | **+ `leagues.keeper_count smallint` (0 = off)**; **+ `league_keepers (league_id, user_id, symbol, slot_id, declared_at)`** in the new league, owner-write through an RPC or edge function that validates: the symbol was held at the end of the predecessor season (`userNetHoldings`), and it is **legal under the new league's settings** (same `validatePick` gate as auto-pick: tiers, categories, budget, draftable universe); declarations lock with the draft order at T−1h. **+ forced picks:** turn math counts rows (F2), so keepers cannot be pre-inserted. Instead, when a keeper-owner's turn falls in a keeper round, the pick path records the keeper immediately with **`pick_source='keeper'`** (CHECK change), priced at pick time. This touches `draft-write.ts`, `validate-and-record-pick`, `draft-autopick-sweep`, `get_draft_clock` (no clock on a forced turn) and `overdue_draft_turns`. **Decisions it forces:** keeper rounds (first K or last K), whether a keeper costs a pick, the basis (pick-time price), and what happens when a declared keeper becomes illegal (delisted or tier change) between declaration and draft. | L |
| **4.5 Superseded league display** | none server-side beyond `successor_league_id` in `get_home_summary` (phase 1). Hide, collapse or show is a client choice. | 0 |
| **4.6 Duration leagues** | `get_season_result` returns `unsupported` for them and `complete_league_season` is matchup-only, so a duration league never reaches `season_status='completed'` the same way. Phase 1 refuses with `not_a_matchup_league`. Supporting them needs a duration-completion story first. | — |
| **4.7 History visible to newcomers** | `get_league_history` gates on membership of the **current** league, so a newcomer sees the podium list. `get_season_result` gates on membership of **that** league, so detail stays with the people who played it. If Giorgio wants newcomers to see full detail, widen `get_season_result`'s gate to "member of this league **or** of any successor in its lineage" (one predicate). | 0 / XS |

---

## 5. Test plan and migration range

### 5.1 PGlite (`supabase/tests/`, real Postgres under Deno)

**`renew_league.pglite.test.ts`**, loading the new migrations **verbatim** on the replica schema
(reusing the `finalize_league_draft` and `season_result` fixtures):
- **Grants:** `proacl` for `renew_league`, `get_league_history` and `accept_league_renewal`
  (with the simulated Supabase default grants, so revoke-from-anon is proven, not assumed); the
  pinned `search_path`; `prosecdef`.
- **Identity:** anon → `42501`; a member who is not commissioner → refused, with no state leak
  (the same error whether the season is complete or not); the commissioner passes.
- **State gates:** active, playoffs, `season_status` completed with `completed_at` NULL, a
  duration league, already renewed: each refused, **asserted to write nothing** (row counts of
  `leagues`, `league_members`, `league_draft_slots` unchanged).
- **The column contract:** enumerate `information_schema.columns` for `leagues`; fail on any
  column not in the copy/reset/new/moved lists; assert each class's values on the new row.
- **Count-against-expected:** members copied == predecessor members (bots included); slots
  copied == predecessor slots by `slot_index`.
- **Idempotency and race:** a second call returns `already_renewed` and the same id; two
  concurrent calls → exactly one successor (partial UNIQUE).
- **Old league untouched:** every predecessor table's row count and a checksum of `matchups`,
  `drafts`, `trades`, `week_snapshots`, `league_standings` and `league_seasons` are identical
  before and after; only `invite_code` differs on the `leagues` row.
- **Invite code moved:** `join_league_by_code(old code)` lands in the **new** league.
- **Draft-order interaction:** the new league has no meta row. A pre-draft `[I5]` leave and a
  join both work. Starting the draft locks the order. Under opt-in, a join after lock is refused.
- **`finalize_league_draft`:** the existing suite unchanged, plus `season_number=3` → a season
  row numbered 3 linked as current.
- **`get_league_history`:** the lineage of 3 is ordered; a non-member gets 0 rows; a newcomer
  sees the podiums only (per the §4.7 default); each row's `get_season_result` is
  `detail_scope='full'`.
- **`start_new_league_season`:** after phase 0, the authenticated call → `42501`, and `proacl`
  shows postgres only.

**Opt-in (phase 2):** `accept_league_renewal` covers the non-predecessor refused, the
exactly-once notification, acceptance after T−1h appended, and acceptance after lock refused.

### 5.2 Hermetic (Deno, no DB)

- `record-trade`: the `season_completed` refusal (a pure predicate extracted next to the
  existing `draft_not_completed` check).
- Mobile `tests-deno`: the league-sheet grouping with `successor_league_id` (the superseded
  league placement per §4.5), and the "Season N" label.
- Kept rosters (if chosen): `carry-rosters` planning (holdings → rows, per-member coverage
  verdict, partial pricing → `partial` not `ok`) as a pure module, the `enrich-symbols`
  `price-batch.ts` pattern.

### 5.3 Prod effect test

`docs/security/run-it-back-effect-test.sql`: proacl for all new and changed functions;
`start_new_league_season` revoked; in a `BEGIN … ROLLBACK`, a renewal of a completed test league
as its commissioner, then the asserted row counts. The real end-to-end proof is a test league
renewed, drafted, finalized, and its week 1 scored, the same bar `test_0925` set for season 1.

### 5.4 Migration range `20261023000000`–`09`

| Version | Content | Phase |
|---|---|---|
| `20261023000000` | revoke `start_new_league_season` from PUBLIC/anon/authenticated | 0 (ship now) |
| `20261023000001` | `leagues.previous_league_id`, `lineage_id`, `season_number` + partial UNIQUE + `lineage_id` index | 1 |
| `20261023000002` | `finalize_league_draft` season number (+ re-asserted grants) | 1 |
| `20261023000003` | `renew_league` | 1 |
| `20261023000004` | `get_league_history` | 1 |
| `20261023000005` | `get_home_summary` + lineage columns (DROP/CREATE, grants re-applied) | 1 |
| `20261023000006` | opt-in: `league_notifications.kind` += `league_renewal`, `accept_league_renewal` | 2 |
| `20261023000007`–`08` | keepers or kept rosters: `pick_source` CHECK, `keeper_count`, `league_keepers` | 3 |
| `20261023000009` | drop `start_new_league_season`; this goes in `supabase/migrations/deferred/` until the button-less mobile build ships (CLAUDE.md: a header comment holds nothing) | 1, deferred |

---

## 6. Effort and phasing

| Phase | Scope | Backend effort | Gate |
|---|---|---|---|
| **0** | Revoke `start_new_league_season` | XS: one migration, one effect query | none; recommended now |
| **1** | **Redraft + auto-carry**: migrations `01`–`05`, `record-trade` refusal, PGlite + hermetic tests, effect test | **S–M: ≈1.5–2 worker days** including tests | Giorgio's mockup decision on 4.1 vs 4.2 (if opt-in wins, fold phase 2 in: +0.5–1 day) |
| **1-client** | Run-it-back entry on Season complete, settings review on the new league, history list, the "I'm out" button, removal of the old button | mobile, sized by the Design Lead's screens | phase 1 deployed |
| **2** | Opt-in (if not folded in) | S: ≈1 day (+ push copy) | Design copy |
| **3a** | Kept rosters | M: ≈3 days, plus the valuation decisions in 4.3 | Giorgio on 4.3(a)–(c) |
| **3b** | Keepers | L: ≈5+ days; touches the draft engine, pick clock and auto-pick | Giorgio on 4.4's decisions; a live draft test as for auto-pick |

**Deploy order for phase 1** (the HUMAN ACTIONS for Giorgio, from the deploy checkout): `db push`
(`01`–`05`) → deploy `record-trade` → effect test → re-capture `db-snapshot.json` (new functions
and grants) → `node scripts/gen-architecture.mjs` committed with the code PR. Nothing in phase 1
breaks an old client: the new columns have defaults, `get_home_summary` only gains columns, and
the revoked function was already wrong.

---

## Open questions for the Orchestrator / Giorgio

1. Auto-carry or opt-in (4.1 / 4.2)? Backend cost differs by about a day; the UX differs more.
2. Redraft only at launch, with keepers and kept rosters later (recommended)? If keepers are
   wanted at launch, 4.4's four decisions are needed before any code.
3. Does a newcomer see past seasons in full, or only the podiums (4.7)?
4. The superseded league in the switcher: shown under Finished, collapsed into its successor, or
   hidden (4.5)?
5. Approve shipping **phase 0 now**, ahead of the feature?
