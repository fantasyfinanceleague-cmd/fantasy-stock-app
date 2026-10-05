# "Run it back": renewing a finished league (backend design)

**Status:** DESIGN ONLY. Nothing here is implemented, and no migration exists.
The Orchestrator approves the architecture. Giorgio settles the product
choices in §4 through the Design Lead's "Your call: Run it back" mockups.
**Rev 2 (2026-10-04):** phase 1 is aligned to the Design Lead's lean path on the board
(`design/your-call-run-it-back` @ `99032ec`). §2.0 maps each frame to the backend, and §4
costs every non-lean option as phase 2.
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
- **Phase 1 = the board's lean path:** carry-over with "I'm out" until the order is set, a new
  draft, carried and editable settings, a "Start Season 2" notification, and Season 1 history
  kept.
  - It is mainly one SQL RPC, `renew_league(old, p_settings, p_slots)`, called atomically at
    **Start Season 2**: commissioner-only, `authenticated`, explicit revoke from anon. Cancelling
    the review writes nothing.
  - It adds `get_league_history`, a two-line `finalize_league_draft` change and a notification
    kind.
  - After that, the new league goes through the **existing** draft path: draft-order modes, pick
    clock, auto-pick, `draft-control`, then the pick path → `planSeason` →
    `finalize_league_draft`. No new edge function is needed. Estimate ≈2–2.5 worker days.
- **`start_new_league_season`: revoke it now and drop it later.** It is authenticated-callable,
  it destroys history, and it leaves the league stuck with no draft and no schedule. Phase 0 is a
  one-line `REVOKE` migration; phase 1 drops the function.
- **Phase 2, per non-lean board option (§4):**

  | Option | Size | What it adds |
  |---|---|---|
  | (a)-B "I'm in" by a deadline | S | an explicit in/out response table and an RPC |
  | (a)-C commissioner picks | XS–S | an exclude list and a "not included" notice |
  | (b)-B keep teams | M–L | an edge function, carried slots, and positions sized at Week 1's open |
  | (b)-C keepers (up to 2) | L | declarations, plus forced picks in the owner's last rounds of the turn engine |

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
`previous_league_id = old.id`, copies the membership (or invites it, §4.1), and gets a fresh
invite code. The old league is left **exactly as it is**, not one row written: completed,
scored, read-only.

**B.1 Tables touched.**

| Table | Action |
|---|---|
| `leagues` | **INSERT** one row (copy-classified columns, §2.3). New columns: `previous_league_id uuid REFERENCES leagues(id)`, a partial UNIQUE on it (one successor per league, which is also the race and idempotency guard), `lineage_id uuid` (root league id; NULL = self), `season_number int NOT NULL DEFAULT 1` (lineage ordinal) |
| `league_members` | INSERT the carried members (auto-carry) or just the commissioner (opt-in, §4.1) |
| `league_notifications` | INSERT one `season_renewed` row per carried human member (kind CHECK +=) |
| `league_draft_slots` | copy the old league's rows (new ids, same shape) |
| `league_seasons` | **none at renewal.** `finalize_league_draft` creates the new league's season at draft end, as for every league, now numbered `leagues.season_number` instead of a literal 1 (§2.4) |
| everything else | **nothing.** No DELETE anywhere, and no row of the old league changes |

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
(`renew_league`); a two-line `finalize_league_draft` change; one notification kind; a
re-created `get_home_summary`; a new read function (`get_league_history`); the revoke/drop of
`start_new_league_season`. There
are no changes to operational tables and no backfill beyond defaults.

**B.5 Partial-state risk: low, and recoverable.** Renewal is one transaction that writes only
**new** rows. It either fully exists or does not exist, and a failure
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
§2.1). Seasons archived by `start_new_league_season` before this ships stay `standings_only`,
which is exactly what they are.

**B.7 What B costs that A and C do not.**
- **Two league rows in the user's list.** The old one moves to "Finished" by itself (F10). Whether
  a superseded league stays in the sheet, collapses under its successor, or hides is a client
  choice fed by `successor_league_id` (Design question, §4.8).
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

## 2. Phase 1: the Design Lead's lean path, end to end

The board (`design/your-call-run-it-back` @ `99032ec`, `docs/design/screens/inventory.jsx`,
"Your call: Run it back") leans towards:
- **(a) Who's in:** everyone carries over, with "I'm out this season" until the draft order is
  set. New people join with the invite code until the draft.
- **(b) How teams start:** a new draft.
- **(c) Settings:** every Season 1 setting carries over and is editable until the draft.
  "Start Season 2" notifies everyone.
- **(d) History:** a Season 1 champion banner until Season 2's draft, and League › History with
  Season 1's frozen final standings and, ideally, its matchups.

**Phase 1 implements exactly that.** Every frame of the lean path is mapped to its backend piece
in §2.0. Every non-lean option is costed in §4.

### 2.0 Board frame → backend

| Board frame | What the backend provides | Phase |
|---|---|---|
| Home "Run it back?" card / League tab "Run it back" (commissioner) | The old league is `season_status='completed'`, the caller is commissioner, and `successor_league_id IS NULL`. All three come from `get_home_summary` (+ lineage columns). | 1 |
| (c) Season 2 review ("Everything carries over… Change anything before the draft", Cancel / **Start Season 2**) | **Nothing is written while reviewing.** The client pre-fills the form from the old league's row and slots. **Start Season 2** = one atomic `renew_league(old_id, p_settings, p_slots)`. **Cancel** leaves no trace, so there is no ghost successor blocking a later renewal (the partial UNIQUE would). | 1 |
| "Everyone gets a notification" / member push "Roberto B. is running it back. You're in for Season 2, the draft is Sat, Jan 23 · 7:00 PM ET." | `renew_league` writes one `league_notifications` row per carried **human** member except the commissioner, kind `season_renewed`, in the same transaction (exactly once by partial UNIQUE). Push goes through `draft-order-notify`, generalised to build its body by `kind` (copy verbatim from the board; the "the draft is …" clause is dropped when `draft_date` is TBD, as that function already does for the order notice). **Caveat:** that function's cron is still in `deferred/` (STATUS item 19), so the push goes live when the cron is promoted. The in-app record exists from day 1. | 1 |
| (a) Member Home "You're in · 6 of 6 back" | The member is already in the new league's `league_members` (auto-carry). "N of M back" = `|new members ∩ predecessor members|` over `|predecessor members|`, from `get_league_history`'s roster block (§2.1). No discriminator column is needed: membership itself is the state. | 1 |
| "I'm out this season · You can drop out until the draft order is set (Sat 6:00 PM ET)" | A self-leave of the **new** league through the existing `[I5]` DELETE (F11). The draft-order trigger already removes the leaver and closes the gap while the order is `open` or `finalized`, and refuses once `locked`. The "until the order is set" window is **client-gated** in phase 1, from `get_draft_order().finalized`. The DB stays permissive between T−1h and the draft (a leave then still closes the gap safely, the existing draft-order rule). If Giorgio wants it hard-enforced, that is one extra refusal (§4, XS). The Season 1 row is never touched, so an opted-out member still sees Season 1. | 1 |
| "Invite more with SCUD26" / new people join until the draft | `renew_league` gives the new league a **fresh** invite code (the board shows a new code), generated in SQL with the same 32-symbol alphabet and length as `apps/mobile/lib/inviteCode.ts`, retried on the UNIQUE. `join_league_by_code` already admits a `not_started` league and refuses after the draft starts (F13). **Nothing changes here.** The old league's code keeps dead-ending in the existing `completed` refusal. | 1 |
| (b) "New draft · Order: Random, set Sat 6:00 PM ET. Last season's champion has no advantage." | The new league has no draft-order row, so the existing draft-order modes apply fresh: random at T−1h, or manual. Pick clock, queue and auto-pick are reused unchanged. Nothing seeds the order from Season 1's standings. | 1 |
| Start draft → finalize → Week 1 | `draft-control` `start` → the existing pick path → `draft-write.ts` → `planSeason` → `finalize_league_draft` (now numbering the season from `leagues.season_number`, §2.4) → the snapshot and scoring crons. All existing. | 1 |
| (d) Champion banner "Season 1 champion · Roberto B. · 11–3 · won the Final" until Season 2's draft | `get_league_history(new_id)` returns the predecessor's podium. The record comes from the frozen `final_standings`, and "won the Final" from `get_season_result(old_id)` (`playoff_result='champion'`). The client hides the banner once `draft_status <> 'not_started'`. | 1 |
| Member Home "Season 1 · Roberto B. won · you finished 5th (4–10)" | `get_league_history` returns the caller's own final rank and record per season. | 1 |
| (d) League › History: the season list, plus "Season 1 · final standings" with season gain | `get_league_history(new_id)`: one row per season in the lineage, **with the full frozen `final_standings` array** (rank, W–L–T, `points_for`, display name) for completed seasons. It is visible to every member of the current league, newcomers included, because it is a frozen snapshot. | 1 |
| (d) "Every week's matchups and the draft recap stay here too" (tagged "Needs backend: today they're deleted") | **Under B they are no longer deleted.** The old league's `matchups` and `drafts` simply remain. Members who played Season 1 read them with the queries and RLS that exist today, keyed on the **old** `league_id` (`is_member(old)` holds because their Season 1 membership row is never touched). `get_season_result(old_id)` stays `detail_scope='full'`. **Newcomers** who never played Season 1 are not members of the old league, so week-by-week detail needs one read RPC (§4.6). The "Needs backend" tag becomes "phase 1 for players, small phase 2 for newcomers". | 1 / 2 |

### 2.1 New, changed, reused

| Name | Kind | Status | Caller | Notes |
|---|---|---|---|---|
| `renew_league(p_league_id uuid, p_settings jsonb default '{}', p_slots jsonb default null)` | SQL, SECURITY DEFINER | **new** | mobile (commissioner, "Start Season 2") | §2.3. Returns `jsonb {status:'renewed'\|'already_renewed', league_id, invite_code}`. Game-flow refusals return `{status:'refused', reason}` (finalize convention). Auth failures raise `42501`. |
| `get_league_history(p_league_id uuid)` | SQL, SECURITY DEFINER, STABLE | **new** | mobile (banner, History, member Home) | One row per season in the lineage, newest first: `league_id, season_number, season_id, is_current, draft_status, draft_date, completed_at, champion_user_id/_display_name, runner_up_…, final_standings` (a jsonb array of `{user_id, display_name, rank, wins, losses, ties, points_for}` from `league_seasons.final_standings` + `participant_display_name`), plus `my_rank/my_wins/my_losses/my_ties/my_points_for`. The current row also carries `roster: [{user_id, display_name, status: 'in'\|'out'}]` over the predecessor's members (`in` = also a member of the current league). It reads only `leagues`, `league_seasons` and `league_members`, never operational tables. |
| `finalize_league_draft` | SQL | **changed** | `draft-write.ts` (service_role) | The season INSERT and the select after it use `v_league.season_number`. Grants unchanged; re-asserted (§2.4). |
| `get_home_summary` | SQL | **changed** (output columns) | mobile | + `previous_league_id`, `successor_league_id`, `season_number`. A `RETURNS TABLE` shape change needs `DROP FUNCTION` + `CREATE`, which **resets privileges**, so the explicit revoke/grant is re-applied (the mirror of CLAUDE.md's `CREATE OR REPLACE` trap). If `ui/mobile-home`'s `get_home_league` (F14) merges first, the columns go there as well. |
| `league_notifications` | table | **changed** | — | `kind` CHECK += `'season_renewed'`; the exactly-once partial UNIQUE gains a sibling for that kind. |
| `draft-order-notify` | edge fn | **changed** | cron (deferred) | Body builder switches on `kind`. `season_renewed` copy is verbatim from the board. Token handling is unchanged (`_shared/push.ts`). |
| `record-trade` | edge fn | **changed** | mobile | Refuses `season_status='completed'` → `{ok:false, reason:'season_completed'}` (200, game-flow refusal). Closes F9 before finished leagues start accumulating next to their successors. |
| `start_new_league_season` | SQL | **revoked (phase 0), dropped (phase 1, deferred)** | — | §3 |
| `draft-control`, `get_draft_order`, `set_draft_order`, `get_draft_clock`, `set_draft_queue`, `validate-and-record-pick`, `draft-autopick-sweep`, `_shared/schedule.ts`, `join_league_by_code`, `snapshot-week-start`, `snapshot-week-end`, `process-week-results`, `complete_league_season`, `start_league_playoffs`, `league_standings_ranked`, `get_season_result` | — | **reused unchanged** | — | The new league is an ordinary league. |

STATUS §4 item 9 proposed "route it through an edge function reusing `_shared/schedule.ts` +
`finalize_league_draft`". Under B that path **already exists**: it is the normal draft
completion in `draft-write.ts`. The lean path needs no new edge function. Only "keep teams"
needs one (§4.3), because holdings are computed in TypeScript and must be priced.

### 2.2 Security model

Every new function follows the established shape: SECURITY DEFINER, `SET search_path = public,
pg_temp`, and grants written out in full:
```sql
REVOKE ALL ON FUNCTION public.renew_league(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.renew_league(uuid, jsonb, jsonb) FROM anon;          -- Supabase default grant
REVOKE ALL ON FUNCTION public.renew_league(uuid, jsonb, jsonb) FROM service_role;  -- no server caller; auth.uid() would be NULL anyway
GRANT EXECUTE ON FUNCTION public.renew_league(uuid, jsonb, jsonb) TO authenticated;
```
Verify every one with the `proacl` query. The PGlite test simulates `ALTER DEFAULT PRIVILEGES`
so the assertion proves the explicit revokes work, as `finalize_league_draft.pglite.test.ts`
does.

| Function | Who | Identity check (inside, keyed on `auth.uid()`) | State checks |
|---|---|---|---|
| `renew_league` | commissioner of the **old** league | `auth.uid() IS NULL → 42501`; `leagues.commissioner_id = auth.uid()::text` (text cast, B1 convention), checked **before** state so a non-commissioner learns nothing | old league `league_type='matchup'` (§4.7), `season_status='completed'` **and** its current season `completed_at IS NOT NULL` (both: one without the other is the `season_status_mismatch` that `get_season_result` refuses), no successor yet; `p_settings` keys ⊆ the whitelist (§2.3) |
| `get_league_history` | a member of `p_league_id` | `auth.uid() IS NULL → 42501`; `is_member(p_league_id)`, else 0 rows (no existence oracle, like `get_season_result`) | — |

- **The commissioner of the new league** is the old commissioner. A commissioner hand-off is out
  of scope.
- **Edits after Start Season 2** ("change anything before the draft") use the paths that exist
  today: `leagues_update_commissioner` [I2a], the F1 member column guard, the playoff freeze
  (still `not_started`, so editable), `trg_leagues_order_mode`, and the slot editor. Nothing new
  is opened.
- **The old league is not written at all.** No row of the predecessor changes. Because the code
  is fresh rather than moved, `renew_league` never UPDATEs another league row under DEFINER.

### 2.3 `renew_league`: the column contract

Every `leagues` column is classified. The PGlite test fails on any unclassified column (B.5).

| Class | Columns |
|---|---|
| **Copy, overridable through `p_settings`** | `name`, `num_participants`, `num_rounds`, `stake_mode`, `notional_per_slot`, `budget_amount`, `allow_undraftable`, `num_weeks`, `playoff_teams`, `draft_order_mode`, `pick_seconds`, `pick_clock_enabled` |
| **Copy, fixed** | `league_type` (a lineage stays one game type), `duration_days`, `budget_mode` (deprecated; copied so the default never differs), `commissioner_id` |
| **Reset, overridable through `p_settings`** | `draft_date` (default NULL = TBD; the review's "Draft" row sets it) |
| **Reset, fixed** | `draft_status='not_started'`, `draft_started_at=NULL`, `league_start_date=NULL`, `league_end_date=NULL`, `current_week=1`, `current_season_id=NULL`, `season_status='active'` |
| **New** | `id`, `created_at`, `invite_code` (fresh), `previous_league_id = old.id`, `lineage_id = coalesce(old.lineage_id, old.id)`, `season_number = old.season_number + 1` |

- **`p_settings`**: a key outside the overridable whitelist is **refused**
  (`invalid_settings`), not ignored, so a client typo can never silently drop a setting the
  commissioner changed. Values are validated by the table's own CHECKs. A violation aborts the
  whole transaction and is returned as `{status:'refused', reason:'invalid_settings', detail}`.
- **`p_slots`**: NULL means copy the old league's `league_draft_slots` (same `slot_index`,
  `slot_count`, `price_min`, `price_max`, `category_id`, new ids). A provided array replaces
  them, validated by the table's CHECKs and UNIQUE in the same transaction. The review's
  "Stakes · 6 slots" edit therefore lands atomically with the league, unlike create-league's
  separate `saveLeagueSlots` call.
- **Members**: copy the predecessor's `league_members` (`user_id`, `role`) as a count against
  the expected set (`inserted = predecessor count`, else raise). **Bots are copied too.** Draft
  start re-checks `≥4` and `playoff_teams ≤ members` anyway, so opt-outs below either threshold
  surface as the existing start blockers (`not_enough_members`,
  `playoff_teams_exceeds_members`), and the commissioner lowers P on the review or settings
  screen. There is no draft-order row yet, so the members trigger's "no row: nothing to do"
  branch applies.
- **Notifications**: one `season_renewed` row per carried human member other than the
  commissioner (`user_id NOT LIKE 'bot-%'`, the existing bot convention).
- **`num_weeks`** is copied (or overridden). If opt-outs or joins change the headcount, it stays
  editable while `not_started`, and `finalize_league_draft` refuses a `num_weeks_mismatch`
  honestly rather than writing a short schedule.

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
The existing PGlite suite must pass unchanged, plus one new case (`season_number = 3` → a
`league_seasons` row numbered 3, linked as current). `CREATE OR REPLACE` keeps the ACL, but the
migration still re-states the four revokes and the service_role grant, so the file reads as the
lockdown it is.

### 2.5 The old league after renewal: frozen, guarded where it matters

After renewal the old league is `draft_status='completed'`, `season_status='completed'`, with
every matchup scored. Nothing in phase 1 writes to it. What *could* write to it, and how each
path is closed:
- **Scoring crons:** `process-week-results` selects pending matchups, and a finished league has
  none.
- **Snapshot crons (pre-existing, not introduced by B):** both select **every** matchup league
  with `current_week IS NOT NULL` (`snapshot-week-start/index.ts:319`,
  `snapshot-week-end/index.ts:301`), with no `season_status` filter, so finished leagues are
  examined every run today. Their coverage gates make that a no-op, but B accumulates finished
  leagues faster. Recommended cheap follow-up: `.neq('season_status','completed')` on both
  selects (hermetic-testable). Not required for correctness.
- **Trades:** `record-trade` refuses them (§2.1).
- **Joins:** `join_league_by_code` already refuses a `completed` league (F13).
- **Commissioner settings edits ([I2a]):** still possible and harmless (no reader re-derives a
  finished season from settings; `get_season_result` takes P from the rows). Flagged, not blocked.

### 2.6 Client contract (for the mobile worker, not this design's code)

- **Start Season 2:** call `renew_league` → `setActiveLeagueId(new_id)` (as `create-league.tsx`
  does). `already_renewed` routes to the existing successor.
- **Members:** their devices still point at the old league. Its Season-complete Home reads
  `successor_league_id` and shows the Season 2 card. The new league also appears in their league
  sheet under Upcoming (F10).
- **"I'm out this season":** delete own membership of the **new** league. Hide the button once
  `get_draft_order().finalized`.
- **Banner, History, "you finished 5th":** `get_league_history(current)`. Detail tap →
  `get_season_result(row.league_id)` + the existing matchups/draft reads on that league id.
- **Remove** the `league-settings.tsx` "Start New Season" button, which calls the revoked function.

---

## 3. Today's `start_new_league_season`: revoke now, drop in phase 1

It is **strictly worse than nothing**:
- It deletes the season's matchups, so history drops to `standings_only`.
- It creates no draft and no schedule (STATUS §4 item 9).
- Season-1 drafts and trades persist, so holdings carry over silently (F3).
- `draft_status` stays `completed`, so the pick path refuses and nothing ever heals it.
- Its confirm dialog tells the commissioner it generates a schedule, which it does not.

It is callable today by any commissioner of a completed league through the 1.1.0 build's
settings screen.

- **Phase 0 (now, independent of this feature):** `20261023000000_revoke_start_new_league_season.sql`:
  ```sql
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM anon;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM authenticated;
  -- no grant to anyone; postgres keeps ownership
  ```
  - **Effect check:** `proacl` shows only `postgres`, and an authenticated commissioner call
    returns `42501`. The 1.1.0 button then fails closed with an error alert instead of wiping a
    season.
  - **Not dropped yet:** `season_result.pglite.test.ts` slices the function from
    `20260718000000` to build its archived-season fixture, so it keeps working, and the function
    stays restorable if anything unexpected calls it.
- **Phase 1:** `DROP FUNCTION` in `20261023000009`, **held in `supabase/migrations/deferred/`**
  until the mobile build without the button ships (CLAUDE.md: a header comment holds nothing).
  The PGlite fixture keeps slicing the historical file, which is never rewritten. **Wrapping it
  was considered and rejected:** nothing in its body is worth keeping under B.

---

## 4. Phase 2: what each non-lean board option adds

Each option is additive on top of phase 1; nothing in phase 1 has to be undone for any of them.
Sizes are backend-only, with tests.

### 4.1 (a)-B "I'm in" opt-in by a deadline: **S, ≈1–1.5 days**

Board: "Are you in for Season 2? Reply by Thu" · "4 of 6 in so far · say yes by Thu, Jan 21 ·
7:00 PM ET" · **Not this time** / **I'm in** · push "Are you in? Say yes by …".
- **`renew_league` gets a `p_settings.carry` mode `'opt_in'`:** it copies only the commissioner
  (and the bots), and writes notification kind `season_renewal_invite` (CHECK +=) instead of
  `season_renewed`.
- **`leagues.opt_in_by timestamptz`:** new, set from `p_settings`; it must be ≤ `draft_date` when
  both are set.
- **`league_renewal_responses (league_id, user_id, response text CHECK (response IN ('in','out')), responded_at)`, PK `(league_id, user_id)`:**
  an **explicit tri-state**. No row = no reply yet (the "+2" avatars), and is **never** read as a
  "no". A NULL or missing response is not a decline (CLAUDE.md "Overloaded NULLs are type tags").
  RLS: member SELECT on the new league; no direct writes.
- **`respond_to_renewal(p_league_id uuid, p_response text)`:** SECURITY DEFINER, authenticated,
  explicit revoke from anon.
  - **Gate:** `is_member(new.previous_league_id)` for `auth.uid()`, never a caller-supplied id.
  - **Time gate:** `now() < opt_in_by` and `draft_status='not_started'`, checked on every call
    (the draft-order "checked everywhere, not flipped once" pattern), so no cron is needed.
  - **`'in'`:** upserts the response and INSERTs `league_members` in the same transaction (the
    members trigger then applies the order rules).
  - **`'out'`:** upserts the response and deletes the membership if present. A member may change
    their mind until the deadline.
- **`get_league_history`'s roster block** gains `status: 'in'|'out'|'pending'` from the
  responses.
- **Policy decision needed:** does a non-responder lose the invite-code path after the deadline,
  or can they still join by code until the draft?

### 4.2 (a)-C commissioner picks who's in: **XS–S, ≈0.5 day**

Board: a toggle per manager, "5 of 6 back. Andrea P. won't be in Season 2; they'll get a message."
- **`p_settings.exclude: text[]`:** renewal copies the predecessor members minus these. Each id
  must be a predecessor member and never the commissioner; otherwise `invalid_settings`.
- **Notification kind `season_not_included`** (CHECK +=), with copy from the Design Lead.
- **After Start**, removing a member before the draft needs a commissioner `remove_league_member`
  RPC (DEFINER, `not_started` only). It does not exist today: `[I5]` is self-only.

### 4.3 (b)-B "Keep teams": **M–L, ≈4 days**

Board: "Each team keeps its six stocks. No draft." · "Every slot restarts at $2,000 · Shares are
recalculated at Week 1's open so everyone starts level. No draft night."

**Pieces:**
1. **`leagues.team_start text CHECK (team_start IN ('draft','keep','keepers')) NOT NULL DEFAULT 'draft'`.**
   An explicit discriminator, so nothing infers "no draft" from zero picks.
2. **`league_carried_slots (league_id, user_id, slot_index, symbol)`**, written at Start Season 2.
   It holds each carried member's **final** Season 1 holdings mapped to slots. Holdings are
   defined only in TypeScript (`userNetHoldings`, one definition for drafting, trading and
   snapshotting), so the renewal for this mode goes through a **`renew-league` edge function**
   (verify_jwt + `getUser()`, the draft-control pattern). It computes the map and calls a
   service-role variant of `renew_league` with it.
   - Slot ancestry in fixed-notional leagues follows `drafts.slot_id` and the
     `trades.funded_by_trade_id` chain (a buy inherits the slot of the sale that funded it).
3. **At the teams-lock time** (the analogue of the draft time), a time-gated server path flips
   `draft_status` → `in_progress` (the existing start trigger locks the order and freezes
   membership, which also ends the opt-out window), then `planSeason` → `finalize_league_draft`
   with zero picks.
4. **At Week 1's open**, `materialize_carried_rosters(league_id, prices jsonb)` (service_role)
   writes `drafts` rows with **`pick_source='carried'`** (CHECK +=), `entry_price` = the Week 1
   open, and `quantity` = `notional_per_slot / open`. It must run before `snapshot-week-start`
   builds Week 1, as a pre-step inside that job.
   - It is per-participant complete or refused-and-retried: count against the expected slots,
     never "any row exists" (the CLAUDE.md all-or-nothing family; one unpriceable symbol must
     not abort the league, per success-signal #7).

**Decisions it forces:**
- **(i) Empty slots:** what happens to a slot that ended Season 1 as unreinvested cash? Restart
  it as $2,000 cash, or make the manager pick one stock?
- **(ii) Newcomers:** people who joined by code have no team. Block joins in keep mode, or give
  them a solo pick-six?
- **(iii) Other stake modes:** "$2,000 a slot" is fixed-notional language. Is keep mode
  fixed-notional only, or defined separately for budget/tier leagues? Tier leagues can't simply
  carry a stock that has left its price band.
- **(iv) Before Week 1:** what Home and Portfolio show between Start and Week 1's open, when
  positions are known but not sized.

### 4.4 (b)-C keepers, up to 2: **L, ≈5 days + a live draft test**

Board: "Keep up to 2 · The rest go back in the pool. Choose by Fri, Jan 22 · 7:00 PM ET" ·
"Keepers restart at $2,000 a slot. The draft covers the other 4 rounds."

**Pieces:**
1. **`leagues.keeper_max smallint NOT NULL DEFAULT 0 CHECK (keeper_max BETWEEN 0 AND 2)`** and
   **`leagues.keepers_lock_at timestamptz`** (the board's "choose by", the day before the draft).
   Time-gated on every write, so no cron.
2. **`league_keepers (league_id, user_id, symbol, declared_at)`**, with UNIQUE
   `(league_id, symbol)` and a per-user count ≤ `keeper_max`. Written only by a
   **`declare-keepers` edge function**, because legality is TypeScript. It checks:
   - the symbol is in the user's final Season 1 holdings (`userNetHoldings` over the
     predecessor league);
   - it is legal under the **new** league's settings, through the same `validatePick` gate as
     manual and auto picks (tiers, categories, budget, draftable universe; the auto-pick hard
     requirement).
3. **Declared keepers are owned from the moment the draft starts.** The legality gate's
   ownership check must read `league_keepers`, so nobody else can draft a kept stock.
4. **"The draft covers the other 4 rounds."** Snake turn math is `count(drafts)` over uniform
   rounds (F2), so keepers cannot be pre-inserted, and managers keeping 0, 1 or 2 must still
   share one turn sequence.
   - **Design:** a keeper is a **forced pick in the owner's last k rounds**. When that turn
     comes, the pick path records it instantly, with no clock, as **`pick_source='keeper'`**
     (CHECK +=). It is priced at that moment, and `fillQuantity` already makes that $2,000 for a
     per-slot league. A 2-keeper manager effectively drafts 4 rounds, as the board says. A
     0-keeper manager drafts all 6.
   - **Touches:** `draft-write.ts`, `validate-and-record-pick`, `draft-autopick-sweep`,
     `get_draft_clock` and `overdue_draft_turns` (no clock on a forced turn), and the draft UI.

**Decisions it forces:**
- First or last rounds for keepers (this design assumes last).
- What happens when a declared keeper turns illegal between declaration and its turn (delisted,
  or left its tier): the turn falls back to a normal clocked pick, or to auto-pick.
- Whether a keeper may be a stock acquired by trade, not drafted. Holdings-based says yes.

### 4.5 Hard-enforced opt-out window: **XS**

The phase-1 window ("until the draft order is set") is client-gated. To make it a DB rule, add
one refusal to the `league_members` DELETE path: a **self**-delete of a league with
`previous_league_id IS NOT NULL` whose order meta is `finalized` raises `opt_out_closed`. It is
scoped to renewed leagues, so ordinary leagues keep today's leave rule.

### 4.6 Full Season 1 detail for newcomers: **XS–S**

Players of Season 1 already get full detail in phase 1 (§2.0). For people who joined in Season 2,
there are two options:
- **(i)** Widen `get_season_result`'s gate to "member of this league **or** of a successor in
  its lineage" (one predicate).
- **(ii)** Add `get_season_matchups(p_league_id)` (DEFINER, the same lineage gate) returning
  every week's pairs, gains, winners and display names, plus the draft recap.

Raw `matchups`/`drafts` RLS stays per league; it is not widened.

### 4.7 Duration leagues: **out of scope**

`get_season_result` returns `unsupported` for them and `complete_league_season` is matchup-only,
so a duration league never reaches a completed season the same way. Phase 1 refuses with
`not_a_matchup_league`.

### 4.8 Superseded league display: **0**

`successor_league_id` is in `get_home_summary` from phase 1. Whether the switcher shows the old
league under Finished, folds it into its successor, or hides it is a client choice.

---

## 5. Test plan and migration range

### 5.1 PGlite (`supabase/tests/`, real Postgres under Deno)

**`renew_league.pglite.test.ts`** loads the new migrations **verbatim** on the replica schema,
reusing the `finalize_league_draft` and `season_result` fixtures.
- **Grants:** `proacl` for `renew_league` and `get_league_history`, with the simulated Supabase
  default grants so revoke-from-anon is proven, not assumed. Also the pinned `search_path`,
  `prosecdef`, and the re-created `get_home_summary`'s ACL after its DROP/CREATE.
- **Identity:**
  - anon → `42501`;
  - a member who is not commissioner → refused, with the same error whether or not the season is
    complete (no state leak);
  - the commissioner passes.
- **State gates:** each of these is refused and **asserted to write nothing** (row counts of
  `leagues`, `league_members`, `league_draft_slots`, `league_notifications` unchanged):
  - active, playoffs;
  - `completed` with `completed_at` NULL;
  - a duration league;
  - already renewed;
  - an unknown `p_settings` key;
  - a CHECK-violating value (e.g. `pick_seconds: 20`);
  - a malformed `p_slots`.
- **Column contract:** enumerate `information_schema.columns` for `leagues`, fail on any column
  not classified in §2.3, and assert each class on the new row. Overrides apply. A key naming a
  fixed column is refused, because it is not in the whitelist.
- **Count against the expected set:**
  - members copied == predecessor members, bots included;
  - slots copied == predecessor slots by `slot_index` (or == `p_slots`);
  - notifications == predecessor humans − commissioner, exactly once (a re-call writes none).
- **Idempotency and race:** a second call returns `already_renewed` with the same id. Two
  concurrent calls → exactly one successor (partial UNIQUE). Cancel-equivalent (no call) → no
  successor.
- **Old league frozen:** the predecessor's `leagues` row and its `matchups`, `drafts`, `trades`,
  `week_snapshots`, `league_standings`, `league_seasons` and `league_members` are byte-identical
  before and after (row checksums).
- **Invite code:** the new code is fresh, matches the client alphabet/length regex, and joins the
  new league. The old code is still refused (`completed`).
- **Opt-out path:**
  - an `[I5]` self-leave of the new league while the order is `open` or `finalized` closes the
    gap;
  - the leaver is still a member of the old league;
  - `get_league_history.roster` reports them `out`;
  - after `locked`, the leave is refused (the existing trigger).
- **Draft:** the new league has no meta row. The existing order modes materialise at reveal or
  start. A join after lock is refused.
- **`finalize_league_draft`:** the existing suite unchanged, plus `season_number = 3`.
- **`get_league_history`:**
  - a lineage of 3 is ordered, with full `final_standings` and display names;
  - `my_*` fields match the caller's entry;
  - a non-member gets 0 rows;
  - a newcomer gets the frozen standings;
  - `get_season_result(old)` stays `detail_scope='full'`.
- **`start_new_league_season`:** after phase 0, an authenticated call → `42501`, and `proacl`
  shows postgres only.

**Phase 2 additions:**
- `respond_to_renewal`:
  - the tri-state;
  - non-predecessor refused;
  - after the deadline refused;
  - `in` → member, `out` → not a member;
  - a change of mind;
  - no row ≠ out.
- The keepers ownership gate and forced-turn math (with `draft_pick_clock.pglite.test.ts`'s
  harness).
- Keep-teams materialisation: per-participant completeness and recoverable refusal.

### 5.2 Hermetic (Deno, no DB)

- **`record-trade`:** the `season_completed` refusal, as a pure predicate next to
  `draft_not_completed`.
- **`draft-order-notify`:** the `season_renewed` body builder, with the board copy verbatim and
  the TBD-date clause dropped.
- **Mobile `tests-deno`:**
  - the league-sheet placement of a superseded league;
  - the "Season N" label;
  - the opt-out button gate from `get_draft_order().finalized`;
  - the champion banner visibility (`draft_status = 'not_started'` only).
- **Phase 2:** `declare-keepers` legality and `renew-league` slot ancestry (the
  `funded_by_trade_id` chain) as pure modules.

### 5.3 Prod effect test

`docs/security/run-it-back-effect-test.sql`:
- `proacl` for all new and changed functions;
- `start_new_league_season` revoked;
- inside `BEGIN … ROLLBACK`, a renewal of a completed test league as its commissioner, followed
  by the asserted row counts.

The real end-to-end proof is a test league renewed, drafted, finalized and its Week 1 scored: the
same bar `test_0925` set for season 1.

### 5.4 Migration range `20261023000000`–`09`

| Version | Content | Phase |
|---|---|---|
| `20261023000000` | revoke `start_new_league_season` from PUBLIC/anon/authenticated | **0 (ship now)** |
| `20261023000001` | `leagues.previous_league_id`, `lineage_id`, `season_number` + partial UNIQUE + `lineage_id` index | 1 |
| `20261023000002` | `finalize_league_draft` season number (+ re-stated grants) | 1 |
| `20261023000003` | `league_notifications.kind` += `season_renewed` + its exactly-once index | 1 |
| `20261023000004` | `renew_league` | 1 |
| `20261023000005` | `get_league_history` | 1 |
| `20261023000006` | `get_home_summary` + lineage columns (DROP/CREATE, grants re-applied) | 1 |
| `20261023000007` | opt-in (`opt_in_by`, `league_renewal_responses`, `respond_to_renewal`, kinds) **or** commissioner-picks (`season_not_included`, `remove_league_member`) | 2 |
| `20261023000008` | keep teams **or** keepers (`team_start`, `pick_source` CHECK, `league_carried_slots` / `league_keepers`, `keeper_max`) | 2 |
| `20261023000009` | `DROP FUNCTION start_new_league_season`, **in `deferred/`** until the button-less mobile build ships | 1, deferred |

If Giorgio picks **both** keep teams and keepers, `08` is not enough room. Request a second
range rather than packing unrelated DDL into one file.

---

## 6. Effort and phasing

| Phase | Scope | Backend effort | Gate |
|---|---|---|---|
| **0** | Revoke `start_new_league_season` | XS: one migration, one effect query | none; recommended now |
| **1 (the lean path)** | Carry-over with opt-out, new draft, carried and editable settings, the Start Season 2 notification (in-app; push with the notify cron), Season 1 history kept in full (frozen standings for everyone, week-by-week for its players). Migrations `01`–`06`, the `record-trade` refusal, the `draft-order-notify` kind switch, PGlite + hermetic tests, effect test. | **M: ≈2–2.5 worker days** including tests | Orchestrator approval of B |
| **1-client** | Run-it-back cards, the Season 2 review → `renew_league`, the "I'm out" button, banner, History, removal of the old button | mobile, sized by the Design Lead's screens | phase 1 deployed |
| **2a** | (a)-B opt-in by deadline | S: ≈1–1.5 days | Giorgio's ruling + §4.1 policy question |
| **2b** | (a)-C commissioner picks | XS–S: ≈0.5 day | Giorgio's ruling |
| **2c** | (b)-B keep teams | M–L: ≈4 days | Giorgio on §4.3 (i)–(iv) |
| **2d** | (b)-C keepers | L: ≈5 days + a live draft test (the auto-pick precedent) | Giorgio on §4.4's decisions |
| **2e** | Newcomers see full Season 1 detail; hard opt-out window | XS each | Giorgio's ruling |

**Deploy order for phase 1** (the HUMAN ACTIONS for Giorgio, from the refreshed deploy checkout):
1. `db push` (`01`–`06`).
2. Deploy `record-trade` and `draft-order-notify`, byte-verified.
3. Run the effect test.
4. Re-capture `db-snapshot.json` (new functions and grants).
5. Commit `node scripts/gen-architecture.mjs` with the code PR.

Nothing in phase 1 breaks an old client: the new columns have defaults, `get_home_summary` only
gains columns, and the revoked function was already wrong.

---

## Open questions for the Orchestrator / Giorgio

1. **Approve B**, so phase 1 can be planned for implementation.
2. **Approve shipping phase 0 now**, ahead of the feature?
3. **Giorgio's (a)/(b) rulings** pick from §4.1–§4.4. Each is independent and additive.
4. **Opt-out window:** client-gated (phase 1 default) or hard DB rule (§4.5)?
5. **Newcomers:** frozen standings only (phase 1), or full week-by-week Season 1 too (§4.6)?
6. **Superseded league in the switcher:** Finished, folded into its successor, or hidden (§4.8)?
