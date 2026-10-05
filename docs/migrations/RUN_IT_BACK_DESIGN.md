# "Run it back": renewing a finished league (backend design)

**Status:** DESIGN ONLY for phase 1. Phase 0 is committed (`5c2175c`). B is approved in
principle.
**Rev 3 (2026-10-04):** Giorgio ruled **(a) = opt-in with commissioner reconciliation, in phase
1** (board `design/your-call-run-it-back` @ `4538f60`, frames a1–a6). §2 is rewritten for it.
(b) is undecided; a new draft is assumed. Rev 2 mapped the earlier lean path; rev 1 compared the
architectures (§1, unchanged).
**Rev 3.1 (2026-10-04), Giorgio's rulings:**
- a player who answered **in** sees the full "Who's running back" list, read-only;
- the commissioner gets **Nudge again** and **Remove** on pending rows;
- `in ↔ out` flips are **free** until the draft starts.
See §2.4 and §2.5.
**Branch:** `docs/run-it-back-design`. **Migration range reserved:** `20261023000000`–`09`.
**Author:** the "run it back backend" worker, 2026-10-04, read-only against `main` @ `ee2ceff`.

---

## TL;DR

- **Architecture B (approved in principle).** Each season is a **new `leagues` row** linked by
  `previous_league_id`. The finished league is never written again, so its history stays **full
  detail** (week by week, playoffs, best week) through the existing `get_season_result`.
- **Why B:** every operational table and reader is keyed by `league_id`, so a new id keeps all of
  them correct with no change. A or C would mean ≈50 season-scoping edits and a rewrite of the
  draft-order triggers (§1).
- **Phase 0, done (`5c2175c`):** `start_new_league_season` is revoked from every API role, with a
  9-step PGlite test. The 1.1.0 button now fails closed with an "Error" alert. The DROP is held
  in `deferred/`.
- **Phase 1 = opt-in renewal + a new draft (≈4–5 worker days):**
  - "Run it back" → **`renew_league`** creates Season 2 and asks every Season 1 player.
  - Players answer through **`respond_to_renewal`**. Each answer notifies the commissioner, who
    sees In / New / Out / No reply through **`get_renewal_roster`**. On a non-reply they can
    **Nudge again** (`nudge_renewal`) or **Remove** (`remove_renewal_invitee`).
  - Players who are in see the same list, read-only. Flips between in and out are free until the
    draft starts.
  - A **server-side gate** stops the draft date, the order and the start while any reply is
    pending (a trigger that binds service_role too, `set_draft_order`, and a `draft-control`
    blocker). The gate is provably one-way.
  - Newcomers join by code: `num_participants` = **16** until the draft, then the member count.
  - The review's "Start Season 2" is **`start_renewed_season`**.
  - After that, the existing draft → finalize → scoring path runs.
- **Release precondition:** the ask is a push, so the deferred `draft-order-notify` cron must be
  promoted with phase 1 (§2.9).
- **Phase 2 = (b), if chosen:** keep teams (M–L) or keepers (L) (§4).

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
`previous_league_id = old.id`, **invites** the Season 1 players (opt-in, §2.2), and gets a
fresh invite code. The old league is left **exactly as it is**, not one row written: completed,
scored, read-only.

**B.1 Tables touched.**

| Table | Action |
|---|---|
| `leagues` | **INSERT** one row (copy-classified columns, §2.3). New columns: `previous_league_id uuid REFERENCES leagues(id)`, a partial UNIQUE on it (one successor per league, which is also the race and idempotency guard), `lineage_id uuid` (root league id; NULL = self), `season_number int NOT NULL DEFAULT 1` (lineage ordinal) |
| `league_members` | INSERT the commissioner only; each player's row is inserted when they answer "I'm in" (§2.5) |
| `league_renewal_responses` | **new table**: one `pending` row per invited Season 1 player (§2.2) |
| `league_notifications` | INSERT one `renewal_invite` per invited player (kinds CHECK +=, §2.9) |
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

**B.4 Migration size: small to medium** (medium once the opt-in replies are included). Three columns and one partial unique index; one DEFINER function
(`renew_league`) plus the opt-in reply functions, one new table, one gate trigger (§2); a two-line
`finalize_league_draft` change; notification kinds; a re-created `get_home_summary`; a new read function (`get_league_history`); the revoke/drop of
`start_new_league_season`. There
are no changes to operational tables and no backfill beyond defaults.

**B.5 Partial-state risk: low, and recoverable.** Renewal is one transaction that writes only
**new** rows. It either fully exists or does not exist, and a failure
loses nothing. The checks that remain are all count-against-expected-set, per CLAUDE.md:
- Invitations written: `count(pending responses) = count(old human members) − 1` (the
  commissioner), asserted inside the function before COMMIT.
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
| Migration size | L | XL | **S** (plus opt-in, which any architecture would need) |

**Recommendation: B.** It is the only option where correctness of the scoring and draft
pipeline after renewal is a property of the schema, not of every reader remembering a filter.
C's one real advantage, full history in place, B also gets for free.

---

---

## 2. Phase 1: opt-in renewal with commissioner reconciliation, end to end

**Giorgio's ruling on (a), 2026-10-04: OPT-IN, in phase 1.** The Design Lead's frames a1–a6 are
on the board (`design/your-call-run-it-back` @ `4538f60`).
1. **Only the commissioner** runs it back.
2. **Every Season 1 player** is asked "I'm in / I'm out" by push and a Home/League card.
3. **Each reply notifies the commissioner**, who sees In / New / Out / No reply yet by name.
4. **The draft can't be set**, and can't start, while anyone is left without a reply. This is
   enforced on the **server**.
5. **New people join with the invite code** during the renewal. The team count follows who's in,
   up to 16.

**(b) is undecided, so this assumes a new draft.**

Four things change from rev 2:
- "Carry every member" becomes "invite every member".
- `renew_league` now runs at the **"Run it back" tap**, because the ask goes out the moment the
  commissioner runs it back (frame 1). The settings review comes **after** everyone has replied
  (frame 6), as its own commit, `start_renewed_season`.
- An abandoned renewal therefore needs an explicit `cancel_league_renewal`.
- §2.7 corrects rev 2's join claim: `join_league_by_code` also refuses `league_full` at
  `num_participants`, so a copied team count would block newcomers.

### 2.0 Board frame → backend

| Board frame (`4538f60` unless noted) | What the backend provides |
|---|---|
| Home "Run it back?" / League tab "Run it back" (commissioner) | Shown when the old league is `season_status='completed'`, the caller is commissioner, and `successor_league_id IS NULL` (`get_home_summary` + lineage columns). The tap calls **`renew_league(old_id)`** (§2.3). |
| Push to every Season 1 player: "Roberto B. is running it back. Are you in for Season 2?" | `renew_league` writes one **`league_renewal_responses`** row per invited player with `status='pending'`, plus one `league_notifications` row of kind `renewal_invite` each, in the same transaction (§2.2). |
| Member card "Roberto B. is running it back. Are you in? … The draft is set once everyone has replied" · **I'm out** / **I'm in** | **`respond_to_renewal(new_id, 'in'\|'out')`**: self only, keyed on `auth.uid()`. `in` also INSERTs the member's `league_members` row in the new league; `out` deletes it if present. Every reply writes a `renewal_reply` notification to the commissioner. |
| a2 Commissioner push per reply: "Gianluigi B. is in for Season 2. 4 in · 1 out · 1 to reply." | The `renewal_reply` row carries `subject_user_id` and `detail = {response, in, out, pending}`, **snapshotted at reply time**. A fast in→out flip therefore produces two truthful pushes, not two copies of the latest state. |
| a3 Commissioner Home "Season 2 · who's in … Waiting on Andrea P." / a4 League tab: In / New / Out / No reply yet, by name; draft rows disabled with the reason | **`get_renewal_roster(new_id)`** (§2.4). It returns `replies_pending`, so the client disables the draft rows from the same fact the server gate uses. **Rev 3.1:** a player who answered *in* gets the same full list, read-only ("Who's running back"). |
| a5 "Nudge again" / "Mark as out" (**Giorgio: "Remove"**) | **Confirmed, phase 1:** `nudge_renewal(new_id, user_id)` re-sends the ask and **never changes status**; `remove_renewal_invitee(new_id, user_id)` moves a row from `pending` to `out` and writes `renewal_removed` to the player. Both are commissioner only and `pending` only. **Still an unconfirmed proposal:** a5's "can still ask you to be let back in" (`request_back_in` + `readmit_to_renewal`). See §2.5. |
| Server gate: "You can set the draft once everyone has replied" | **`trg_leagues_renewal_gate`** on `leagues` (draft date, order mode, draft start), a check in **`set_draft_order`**, and a **`renewal_replies_pending`** blocker in `draft-control` (§2.6). |
| a4 "New · joined with the invite code" / a6 "Teams: 5 · Follows who's in, up to 16. More can join with SCUD26 until the draft." | A fresh invite code. **`num_participants = 16`** on a renewed league until the draft starts, then the actual member count (§2.7). `join_league_by_code` is unchanged. |
| a6 Review (after everyone has replied) → **Start Season 2**: "Everyone who's in gets a notification" | **`start_renewed_season(new_id, p_settings, p_slots)`** applies the reviewed settings and the draft date in one transaction, and writes `season_set` notifications to every member. It is **refused while any reply is pending** (§2.3). |
| New draft: random order at T−1h, pick clock, auto-pick | Unchanged. The new league has no draft-order row until reveal or start. |
| Last pick → finalize → Week 1 | Unchanged path. `finalize_league_draft` numbers the season from `leagues.season_number` (§2.8). |
| Champion banner / League › History / "you finished 5th" (`99032ec` frame d) | `get_league_history(new_id)` (§2.4). Unchanged from rev 2. Season 1's matchups and draft recap are **kept** in the old league, which is never written. |

### 2.1 New, changed, reused

| Name | Kind | Status | Caller |
|---|---|---|---|
| `renew_league(p_league_id uuid)` | SQL DEFINER | **new** | commissioner, "Run it back" |
| `respond_to_renewal(p_league_id uuid, p_response text)` | SQL DEFINER | **new** | invited player |
| `remove_renewal_invitee(p_league_id uuid, p_user_id text)` | SQL DEFINER | **new** ("Remove") | commissioner |
| `nudge_renewal(p_league_id uuid, p_user_id text)` | SQL DEFINER | **new** ("Nudge again") | commissioner |
| `start_renewed_season(p_league_id uuid, p_settings jsonb, p_slots jsonb default null)` | SQL DEFINER | **new** | commissioner, review → "Start Season 2" |
| `cancel_league_renewal(p_league_id uuid)` | SQL DEFINER | **new** | commissioner |
| `get_renewal_roster(p_league_id uuid)` | SQL DEFINER, STABLE | **new** | members + invitees |
| `get_league_history(p_league_id uuid)` | SQL DEFINER, STABLE | **new** (as rev 2) | members |
| `league_renewal_responses` | table | **new** | written only by the functions above |
| `enforce_league_renewal_gate()` + `trg_leagues_renewal_gate` | trigger fn (DEFINER) | **new** | every `leagues` UPDATE |
| `request_back_in`, `readmit_to_renewal` | SQL DEFINER | **new only if Giorgio confirms "ask back in"** | removed player / commissioner |
| `set_draft_order` | SQL | **changed**: refuses `renewal_replies_pending` | commissioner |
| `league_notifications` | table | **changed**: `kind` CHECK += `renewal_invite`, `renewal_reply`, `renewal_removed`, `season_set` + `renewal_nudge` (+ `renewal_rejoin_request` only if "ask back in" is confirmed); + `subject_user_id text`, `detail jsonb` | — |
| `draft-order-notify` | edge fn | **changed**: body builder by `kind`, copy verbatim from the board | cron (still deferred, §2.9) |
| `draft-control` (`rules.ts`) | edge fn | **changed**: `renewal_replies_pending` start blocker; `status` reports `replies_pending` | members |
| `finalize_league_draft` | SQL | **changed**: season number (§2.8) | service_role |
| `get_home_summary` | SQL | **changed**: + `previous_league_id`, `successor_league_id`, `season_number` (DROP/CREATE, grants re-applied) | mobile |
| `record-trade` | edge fn | **changed**: refuses `season_status='completed'` (F9) | mobile |
| `join_league_by_code`, `get_draft_order`, `get_draft_clock`, `validate-and-record-pick`, `draft-autopick-sweep`, `_shared/schedule.ts`, the snapshot and scoring crons, `complete_league_season`, `start_league_playoffs`, `league_standings_ranked`, `get_season_result` | — | **reused unchanged** | — |

### 2.2 `league_renewal_responses`: the reply state is explicit, never inferred

```sql
create table public.league_renewal_responses (
  league_id     uuid not null references public.leagues(id) on delete cascade,  -- the NEW league
  user_id       text not null,            -- text, like league_members.user_id
  status        text not null,
  decided_by    text,
  invited_at    timestamptz not null default now(),
  responded_at  timestamptz,
  nudge_count   smallint not null default 0,
  last_nudged_at timestamptz,
  rejoin_requested_at timestamptz,        -- "ask back in" only (unconfirmed)
  primary key (league_id, user_id),
  constraint lrr_status_check check (status in ('pending', 'in', 'out')),
  constraint lrr_decided_by_check check (decided_by in ('player', 'commissioner')),
  -- the stamps agree with the discriminator (the league_draft_order_meta pattern)
  constraint lrr_stamps_check check (
       (status = 'pending' and decided_by is null and responded_at is null)
    or (status <> 'pending' and decided_by is not null and responded_at is not null))
);
```

- **One row per invited player, written at renewal.** This deliberately departs from the
  Orchestrator's "no row = pending":
  - **The expected set is frozen when the ask goes out.** "No reply yet" is then a **count
    against that fixed set**, not "a Season 1 member with no row".
  - **A live "no row" read changes meaning under it.** If a Season 1 member later leaves the
    *old* league (`[I5]` still allows that), they would silently vanish from the pending set.
    That is the CLAUDE.md all-or-nothing family: a gate keyed on "does a row exist?" over a set
    that can change underneath it.
  - **`status` is the discriminator.** NULL or absence never means "no" (CLAUDE.md "Overloaded
    NULLs are type tags").
- **Who is invited:** every **human** member of the old league at renewal time. The commissioner
  gets a row with `status='in', decided_by='commissioner'`, so the In list is just this table
  plus newcomers.
  - **Bots are not invited and not carried.** They can't answer, and they are test-account-only.
    A test commissioner tops up again with `draft-control add_bots`, as for any league.
- **Newcomers** who join by code get **no** row. They are "New" in the roster: members of the
  new league with no response row.
- **RLS:** enabled. No client policies (no direct reads or writes). Every read goes through
  `get_renewal_roster`, every write through the DEFINER functions. Explicit revokes cover all
  table privileges for anon and authenticated.

### 2.3 The commissioner's functions

**`renew_league(p_league_id)`**, the "Run it back" tap. One transaction:
1. **Gates:**
   - identity first: `auth.uid() IS NULL → 42501`; the caller is `commissioner_id`;
   - then state: `league_type='matchup'`, `season_status='completed'` **and** the current
     season's `completed_at IS NOT NULL`, and no successor yet.
   - Two calls racing → the partial UNIQUE on `previous_league_id` (`23505` caught →
     `already_renewed` with the existing id).
2. **INSERT the new `leagues` row** per the column contract (§2.3a), which means:
   - `num_participants = 16` (§2.7);
   - `draft_date = NULL`;
   - a fresh `invite_code` (the client's 32-symbol alphabet and length, retried on UNIQUE);
   - settings copied **as is**. The review edits them later through `start_renewed_season`.
3. **Copy `league_draft_slots`.**
4. **INSERT the commissioner's `league_members` row and their `in` response.**
5. **INSERT one `pending` response and one `renewal_invite` notification per invited player.**
   The count must equal the old league's human members minus the commissioner, else raise.
6. **Returns** `{status:'renewed'|'already_renewed', league_id, invite_code, invited}`.

The old league is not written.

**`remove_renewal_invitee(p_league_id, p_user_id)`**:
- commissioner only;
- refused unless that player's row is `pending` (a player's own answer is never overridden);
- `draft_status='not_started'`;
- sets `out` / `commissioner` / `responded_at = now()`;
- writes `renewal_removed` to the player.

**`start_renewed_season(p_league_id, p_settings, p_slots)`**, the review's "Start Season 2":
- commissioner only, `draft_status='not_started'`, and **zero pending replies** (else
  `renewal_replies_pending`).
- **`p_settings`:** a whitelist of rev 2's overridable columns plus `draft_date` (required here:
  the review's Draft row). An unknown key is **refused**, never ignored. Values are validated by
  the table CHECKs.
- **`p_slots`:** NULL means keep the copied slots; an array replaces them.
- **One transaction:** UPDATE `leagues`, replace the slots, and write one `season_set`
  notification per member other than the commissioner.
- **Idempotent:** a second call applies the new values but writes `season_set` only once
  (partial UNIQUE per member).
- **Edits after this** (until the draft) use the existing settings paths, behind the gate
  trigger.

**`cancel_league_renewal(p_league_id)`**:
- commissioner only;
- only on a renewed league (`previous_league_id IS NOT NULL`) still at
  `draft_status='not_started'`;
- `DELETE`s the new league. Members, responses, notifications, slots and any `open` draft order
  cascade; the draft-order meta trigger already permits a cascade once the league is gone.
- This frees the predecessor for a fresh renewal. It is needed because the league now exists
  from the first tap.

### 2.3a The column contract (`renew_league` and `start_renewed_season`)

Every `leagues` column is classified. The PGlite test fails on any unclassified column (B.5).

| Class | Columns |
|---|---|
| **Copy, overridable later through `start_renewed_season`'s `p_settings`** | `name`, `num_rounds`, `stake_mode`, `notional_per_slot`, `budget_amount`, `allow_undraftable`, `num_weeks`, `playoff_teams`, `draft_order_mode`, `pick_seconds`, `pick_clock_enabled` |
| **Copy, fixed** | `league_type` (a lineage stays one game type), `duration_days`, `budget_mode` (deprecated; copied so the default never differs), `commissioner_id` |
| **Reset, set later through `p_settings`** | `draft_date` (NULL at renewal; **required** by `start_renewed_season`, and refused by the gate while any reply is pending) |
| **Set to the ceiling** | `num_participants = 16` until the draft starts, then the member count (§2.7). Editable 4–16 by the commissioner, as today. |
| **Reset, fixed** | `draft_status='not_started'`, `draft_started_at=NULL`, `league_start_date=NULL`, `league_end_date=NULL`, `current_week=1`, `current_season_id=NULL`, `season_status='active'` |
| **New** | `id`, `created_at`, `invite_code` (fresh), `previous_league_id = old.id`, `lineage_id = coalesce(old.lineage_id, old.id)`, `season_number = old.season_number + 1` |

- **`p_settings`** (in `start_renewed_season` only; `renew_league` takes no settings, because
  the review comes after the replies): a key outside the overridable whitelist is **refused**
  (`invalid_settings`), not ignored, so a client typo can never silently drop a setting the
  commissioner changed. Values are validated by the table's own CHECKs; a violation aborts the
  whole transaction.
- **`p_slots`**: NULL keeps the slots `renew_league` copied; an array replaces them atomically,
  validated by the table's CHECKs and UNIQUE.
- **`num_weeks`** is copied and editable in the review. The number of teams is only known once
  every reply is in. `planSeason` builds the round robin over the **actual** roster for
  `num_weeks` weeks, so a different team count changes only byes and repeat pairings, never
  correctness. The review shows the uneven-bye notice (a6).

### 2.4 The read functions

**`get_renewal_roster(p_league_id)`**:
- **Gate:** `auth.uid() IS NULL → 42501`. The caller must be a member of the new league **or**
  hold a response row in it (an invitee who hasn't answered, or is out, isn't a member). Otherwise
  0 rows (no existence oracle).
- **It returns:**
  - **counts:** `in`, `new`, `out`, `pending`, `team_count = in + new`, `max_teams = 16`;
  - **`replies_pending`:** boolean, `pending > 0`, the same predicate as the gate;
  - **`caller_status`:** the caller's own row (`pending`, `in`, `out`), `new`, or `none`;
  - **`people[]`:** `{user_id, display_name, group: 'in'|'new'|'out'|'pending', decided_by,
    responded_at, nudge_count, last_nudged_at, rejoin_requested}`.
- **Who gets the full list (Giorgio, rev 3.1):**

  | Caller | `people[]` | Counts | Actions |
  |---|---|---|---|
  | the commissioner | **full**: every invitee and newcomer, by name and answer (running back / out / no reply / new) | yes | `can_nudge`, `can_remove` per pending row |
  | a player whose own answer is **in** | **full**, the same list, read-only ("Who's running back") | yes | none |
  | a newcomer (joined by code, no response row) | **full**, read-only. **To confirm:** assumed, because the rule below makes it free. | yes | none |
  | a player who is **pending** or **out** | **empty**: only `caller_status` (and, if removed, `decided_by='commissioner'`). **To confirm:** assumed no counts either. | no | none |

  - **The rule is one predicate: `is_member(new league)`.** In the new league, membership is
    exactly the commissioner, every player who answered in, and the newcomers. Pending and out
    players are not members by construction (§2.5: in ⇔ membership). So "sees the list" needs
    no new state.
  - **Why it stays correct as players flip:** an in → out flip deletes the membership and
    revokes the list in the same transaction.
  - **Shape is unaffected:** if the "to confirm" rows change, only this one predicate changes.
    There is still no client RLS on `league_renewal_responses`; the RPC is the only read path.
  - **API values vs copy:** `group` stays `'in'|'new'|'out'|'pending'`. The client maps those to
    the board copy ("running back" / "new" / "out" / "no reply").

**`get_league_history(p_league_id)`**: unchanged from rev 2. One row per season in the lineage,
the full frozen `final_standings` with display names, the podium and the caller's own rank, for
every member of the current league.

### 2.5 Reply semantics, the gate's monotonicity, and the commissioner's actions

| From → to | Who | When allowed | Effect |
|---|---|---|---|
| `pending → in` | player | `draft_status='not_started'` | INSERT `league_members` (the draft-order trigger appends if an order exists); `renewal_reply` to the commissioner |
| `pending → out` | player | same | no membership; `renewal_reply` |
| `in ↔ out` (changing their mind, **free: Giorgio, rev 3.1**) | player, own row only, `decided_by='player'` | any number of times while `draft_status='not_started'`, i.e. until the draft starts and the order locks. Before lock the draft-order trigger treats each flip as a normal join or leave: append after T−1h, gap closed on leave. After lock the same trigger refuses it. | membership follows; `renewal_reply` each time |
| `pending → out` | commissioner, **"Remove"** (`remove_renewal_invitee`) | `not_started` | `renewal_removed` to the player |
| `pending → pending` | commissioner, **"Nudge again"** (`nudge_renewal`) | `not_started`, at most once per 24 h per player | **status unchanged**; `nudge_count`/`last_nudged_at` bumped; `renewal_nudge` to the player |
| `out(commissioner) → in` | — | **refused** in phase 1 (`removed`) | — |

**The gate is a one-way door.** `pending` rows are created **only** inside `renew_league`.
Nothing moves a row back to `pending`: every transition leaves `pending`, and none returns to
it.
- Once the count reaches 0, it stays 0.
- So after "Start Season 2" the gate can never re-close under a scheduled draft. There is no
  "the date was set, then someone re-opened a reply" state to handle.
- The PGlite test asserts this on every transition.
- **Rev 3.1's additions keep it:**
  - **Nudge** writes only `nudge_count` and `last_nudged_at`, never `status`.
  - **Remove** leaves `pending`.
  - **Free flips** move between `in` and `out` only; a flip never reaches `pending`.
- **Free flips after "Start Season 2" are allowed but visible.** They can move the team count
  after the review, and the commissioner gets a `renewal_reply` for each. At draft start the
  existing `draft-control` blockers re-check the new count: `not_enough_members` below 4, and
  `playoff_teams_exceeds_members`. A flip can delay a start, but it can never produce an invalid
  season.

**The commissioner's two actions on a pending row (confirmed, rev 3.1):**
- **"Nudge again":** `nudge_renewal(new_id, user_id)`.
  - Commissioner only, `pending` only.
  - Refused (`nudge_too_soon`) if `last_nudged_at > now() − 24h`. That is the design default
    against push spam; the window is one constant.
  - It bumps `nudge_count`/`last_nudged_at` and writes a `renewal_nudge` notification, so the
    player gets the ask again by push and in-app.
  - It **never changes `status`**.
  - a5's "Asked Sat, Jan 16. Nudged once." comes from `invited_at` + `nudge_count`.
- **"Remove":** `remove_renewal_invitee(new_id, user_id)`, `pending → out`,
  `decided_by='commissioner'`. It notifies the player (`renewal_removed`). A removed player cannot
  self-flip back to in (`removed`).

**Still an unconfirmed proposal (a5's last line, not covered by the rulings): "ask back in."**
Build it only if confirmed; it is XS.
- `request_back_in(new_id)`: the removed player stamps `rejoin_requested_at` and notifies the
  commissioner (`renewal_rejoin_request`).
- `readmit_to_renewal(new_id, user_id)`: the commissioner sets `in` / `commissioner` and
  INSERTs the membership.
- **Neither touches `pending`**, so the gate's monotonicity holds.
- Both are allowed "until the draft is set". This design reads that as **until the draft order
  is finalized (T−1h)**. **Giorgio to confirm** which instant "set" means.

### 2.6 The server-side gate (no draft date, order or start while a reply is pending)

"Pending" = `exists (select 1 from league_renewal_responses where league_id = L and status =
'pending')`. That is an EXISTS over the frozen expected set, the correct predicate here because
the question is "is ANY reply missing?" (§2.2). One definition is used by every enforcement point
and by `get_renewal_roster.replies_pending`.

| Path that could schedule or start the draft | Enforcement |
|---|---|
| `leagues.draft_date` set or changed (`[I2a]` from league-settings, or `start_renewed_season`) | **`trg_leagues_renewal_gate`**, BEFORE UPDATE OF `draft_date`, `draft_order_mode`, `draft_status`. It raises `renewal_replies_pending` (errcode `22023`) when the value changes and a reply is pending. **No `auth.uid()` exemption:** it binds service_role too, because `draft-control` starts drafts as service_role. SECURITY DEFINER, so it counts the **whole** table regardless of RLS (a subset-derived verdict is the bug CLAUDE.md case 5 describes). Fires only for `previous_league_id IS NOT NULL`, so ordinary leagues are untouched. |
| `leagues.draft_order_mode` switched (random ↔ manual) | same trigger |
| `draft_status` `not_started → in_progress`: `draft-control start`, or the commissioner's direct `[I2a]` flip (still live until `deferred/20260929000000`) | same trigger, the backstop for both paths |
| `set_draft_order` (manual order edits) | an added `renewal_replies_pending` refusal (`CREATE OR REPLACE`, body otherwise verbatim from `20261013000000`, grants re-stated) |
| `get_draft_order`'s lazy reveal / finalize | needs `draft_date`, which can't be set while pending. Nothing to add, and a read path is never made to raise. |
| `draft-control status` / `start` | a `renewal_replies_pending` blocker in `computeStartBlockers` (`rules.ts`), so the UI shows the reason; `start` refuses with it. The trigger remains the guarantee. |

### 2.7 `num_participants` on a renewed league (and the audit)

**Correction to rev 2.** `join_league_by_code` (`20260930000000:89`, originally
`20260716000000:101`) refuses `league_full` when `members ≥ num_participants`, so a copied
Season 1 size **would** block newcomers.

**The rule (matches a6, "follows who's in, up to 16"):**
- `renew_league` sets `num_participants = 16`, the `leagues_num_participants_range` CHECK
  ceiling.
- At draft start, `trg_leagues_renewal_gate` sets `NEW.num_participants` = the member count for
  a renewed league. The count is ≥ 4 by the draft-control blocker and ≤ 16 by the join cap, so it
  satisfies the CHECK.
- **Trigger order:** BEFORE triggers fire alphabetically, so `trg_leagues_renewal_gate` runs
  after `trg_leagues_member_update_columns`. The F1 column guard therefore sees the caller's
  columns, not this server-side write. The PGlite test pins this order.
- The commissioner may still edit it (4–16) before the draft, as today.

**Every reader of `num_participants`:**

| Reader | Use | Effect of 16-until-start |
|---|---|---|
| `join_league_by_code` (`20260930000000:89`) | `league_full` cap | **The point**: newcomers join until 16 or the draft. Unchanged code. |
| `preview-league/reason.ts:54` | predicts `league_full` for the join preview | consistent with join, unchanged |
| `draft-control` `computeBotsNeeded` (`rules.ts:110`) | bots to reach `min(4, cap)` | `min(4, 16) = 4`, same as any league; unchanged |
| `draft-control` `LeagueStartState.numParticipants` | passed to the above only; **not** a start blocker | no effect |
| `_shared/schedule.ts` `planSeason`, `finalize_league_draft`, byes, playoff checks | **do not read it**: the roster is the stored draft order (the actual members); byes come from roster parity; `playoff_teams ≤ members` is checked against the **member count** (`draft-control`), and `num_weeks` defaults to `roster − 1` | none |
| `CHECK leagues_num_participants_range` (4–16) | bounds | 16 and the start count both pass |
| mobile `league-settings.tsx:72,124,422,435-446` | stepper 4–16 + `SlotBuilder leagueSize` | **Client follow-up:** in a renewed pre-draft league, show the stepper as "up to 16 · follows who's in" and pass `leagueSize` = in + new, not 16. Otherwise SlotBuilder's universe check (`SlotBuilder.tsx:69`, "needs at least teams × slots") raises false "only N stocks match" warnings sized for 16 teams. |
| mobile `create-league.tsx:131,347` | creation only | n/a (renewal doesn't use it) |
| mobile `LeagueContext.tsx:139` → `leagueSheet.ts:125` "N of capacity joined" | display | **Client follow-up:** a renewed pre-draft league reads "5 of 16 joined". Render a6's "follows who's in, up to 16" instead (renewed = `previous_league_id` non-null). After start, capacity = members. |
| mobile `join-league.tsx:240` "current/num_participants" | display | shows "/16" during renewal: acceptable, or use the same copy |
| web `JoinLeague.jsx:72`, `LeagueDetail.jsx:201`, `Leagues.jsx:131,233,516,925`, `useLeagues.js:127`, `DraftPage.jsx:351` | display / web create+edit | web is paused; display-only effect |
| `scripts/simulation-test-runner.mjs` | test fixtures | none |

### 2.8 `finalize_league_draft`, the old league, Home, and history

#### `finalize_league_draft` change (exact)

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

#### The old league after renewal: frozen, guarded where it matters

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

#### Home and history

`get_home_summary` gains `previous_league_id`, `successor_league_id` and `season_number`. A
`RETURNS TABLE` shape change needs DROP + CREATE, which **resets** privileges, so the explicit
revoke/grant is re-applied. If `ui/mobile-home`'s `get_home_league` (F14) merges first, the
columns go there as well. History is `get_league_history` (§2.4).

### 2.9 Notifications and push

| Kind | To | Written by | Exactly once? | Board copy |
|---|---|---|---|---|
| `renewal_invite` | each invited player | `renew_league` | yes (partial UNIQUE per member) | "Roberto B. is running it back. Are you in for Season 2?" |
| `renewal_reply` | the commissioner | `respond_to_renewal` | no: one per reply event; `detail` snapshots the response and counts | "Gianluigi B. is in for Season 2. 4 in · 1 out · 1 to reply." |
| `renewal_removed` | the player | `remove_renewal_invitee` | yes | Design Lead to write |
| `season_set` | every member except the commissioner | `start_renewed_season` | yes | Design Lead to write (a6: "Everyone who's in gets a notification") |
| `renewal_nudge` | the player | `nudge_renewal` | no: one per nudge, at most one per 24 h | the original ask again ("Roberto B. is running it back. Are you in for Season 2?") unless the Design Lead writes a nudge variant |
| `renewal_rejoin_request` | the commissioner | `request_back_in` | once per request | only if "ask back in" is confirmed |

- **In-app works from day 1:** the rows exist, and owner-only SELECT already applies.
- **Push goes through `draft-order-notify`,** with its body builder switched on `kind`. That
  function's cron is still in `deferred/` (STATUS item 19, a live-test precondition).
- **Under opt-in, push is no longer a nice-to-have:** the ask itself is a push. **Promoting the
  notify cron is therefore a phase-1 release precondition.** Until it is promoted, the ask only
  reaches players who open the app.

### 2.10 Security model

Every new function is SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM
PUBLIC, anon, service_role` (no server caller; `auth.uid()` would be NULL), then `GRANT EXECUTE …
TO authenticated`. Each one is verified by `proacl`, with simulated default grants in PGlite.

| Function | Identity (inside, on `auth.uid()`, before any state check) |
|---|---|
| `renew_league`, `remove_renewal_invitee`, `start_renewed_season`, `cancel_league_renewal`, `nudge_renewal`, `readmit_to_renewal` | caller = `leagues.commissioner_id` (of the **old** league for `renew_league`, of the **new** one otherwise) |
| `respond_to_renewal`, `request_back_in` | caller holds a response row in that league; the user id is **always** `auth.uid()`, never a parameter (the `join_league_by_code` `p_user_id` lesson) |
| `get_renewal_roster` | holder of a response row **or** member of the new league; the **full list only for `is_member(new league)`** (the commissioner, players who are in, newcomers), per §2.4 |
| `get_league_history` | member of the league asked about |
| `enforce_league_renewal_gate` | trigger function: not callable; default grants revoked anyway so `proacl` reads as the lockdown it is |

The table `league_renewal_responses` has RLS enabled and no client policies, with table
privileges revoked from anon and authenticated.

### 2.11 Client contract (for the mobile worker)

- **"Run it back"** → `renew_league` → `setActiveLeagueId(new_id)`. The commissioner lands on
  the reconcile view (a3/a4).
- **Invited players** have no `league_members` row in the new league until they answer. The
  league sheet and Home find the ask through `get_home_summary`'s `successor_league_id` on the
  **old** league, plus `get_renewal_roster(successor).caller_status = 'pending'`.
- **The draft rows on a4** are disabled from `replies_pending`. **Start Season 2** →
  `start_renewed_season`.
- **Remove** the old league-settings button (it is already dead after phase 0).
- **`num_participants` displays:** §2.7 client follow-ups.

---

## 3. Today's `start_new_league_season`: locked in phase 0 (`5c2175c`), dropped later

It is **strictly worse than nothing**:
- It deletes the season's matchups, so history drops to `standings_only`.
- It creates no draft and no schedule (STATUS §4 item 9).
- Season-1 drafts and trades persist, so holdings carry over silently (F3).
- `draft_status` stays `completed`, so the pick path refuses and nothing ever heals it.
- Its confirm dialog tells the commissioner it generates a schedule, which it does not.

It is callable today by any commissioner of a completed league through the 1.1.0 build's
settings screen.

- **Phase 0, committed as `5c2175c` on `fix/lock-start-new-league-season`:** `20261023000000_lock_start_new_league_season.sql`.
  It also revokes `service_role`: no server caller exists, and the prod snapshot shows Supabase's
  default grant. The 9-step PGlite test runs the header's DO-block effect check verbatim, which
  reports FAIL before the migration and PASS after it:
  ```sql
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM anon;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM authenticated;
  REVOKE ALL ON FUNCTION public.start_new_league_season(uuid) FROM service_role;
  -- no grant to anyone; postgres keeps ownership
  ```
  - **Effect check:** `proacl` shows only `postgres`, and an authenticated commissioner call
    returns `42501`. The 1.1.0 button then fails closed with an error alert instead of wiping a
    season.
  - **Not dropped yet:** `season_result.pglite.test.ts` slices the function from
    `20260718000000` to build its archived-season fixture, so it keeps working, and the function
    stays restorable if anything unexpected calls it.
- **Later:** `DROP FUNCTION` in `20261023000009`, **held in `supabase/migrations/deferred/`** (committed with phase 0)
  until the mobile build without the button ships (CLAUDE.md: a header comment holds nothing).
  The PGlite fixture keeps slicing the historical file, which is never rewritten. **Wrapping it
  was considered and rejected:** nothing in its body is worth keeping under B.

---

---

## 4. Phase 2: what each remaining board option adds

(a) is decided (opt-in) and now lives in phase 1 (§2). What remains is (b), plus a few smaller
reads. Each item is additive on top of phase 1; nothing in phase 1 has to be undone for any of
them.

### 4.1 (b)-B "Keep teams": **M–L, ≈4 days**

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
   membership, which also closes replies (§2.5)), then `planSeason` → `finalize_league_draft`
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

### 4.2 (b)-C keepers, up to 2: **L, ≈5 days + a live draft test**

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

### 4.3 Full Season 1 detail for newcomers: **XS–S**

Players of Season 1 already get full detail in phase 1 (§2.0, history row). For people who joined in Season 2,
there are two options:
- **(i)** Widen `get_season_result`'s gate to "member of this league **or** of a successor in
  its lineage" (one predicate).
- **(ii)** Add `get_season_matchups(p_league_id)` (DEFINER, the same lineage gate) returning
  every week's pairs, gains, winners and display names, plus the draft recap.

Raw `matchups`/`drafts` RLS stays per league; it is not widened.

### 4.4 Duration leagues: **out of scope**

`get_season_result` returns `unsupported` for them and `complete_league_season` is matchup-only,
so a duration league never reaches a completed season the same way. Phase 1 refuses with
`not_a_matchup_league`.

### 4.5 Superseded league display: **0**

`successor_league_id` is in `get_home_summary` from phase 1. Whether the switcher shows the old
league under Finished, folds it into its successor, or hides it is a client choice.

---

## 5. Test plan and migration range

### 5.1 PGlite (`supabase/tests/`, real Postgres under Deno)

**`run_it_back.pglite.test.ts`** loads the new migrations **verbatim** on the replica schema,
reusing the `finalize_league_draft`, `season_result` and `draft_order_modes` fixtures, so the
real draft-order triggers run.

- **Grants:** `proacl` for every new function and the re-created `get_home_summary`, with the
  simulated Supabase default grants, so revoke-from-anon and revoke-from-service_role are
  proven, not assumed. Also the pinned `search_path` and `prosecdef`. `league_renewal_responses`
  has no anon/authenticated table privileges and RLS on.
- **`renew_league`:**
  - **identity:** anon → `42501`; a non-commissioner is refused with the same error whatever
    the league's state;
  - **state gates:** each refused, writing nothing (active, playoffs, `completed` with an open
    season row, duration, already renewed);
  - **column contract:** `information_schema` enumeration; fails on any unclassified column;
  - **counts against the expected set:** responses = old humans; commissioner `in`; bots
    excluded; `renewal_invite` exactly once each;
  - **`num_participants` = 16**, the code is fresh, and the race yields one successor;
  - **old league byte-identical** before and after.
- **Replies:**
  - every transition in the §2.5 table, plus each refusal: a non-invitee, a removed player
    saying `in`, anything after the draft starts;
  - **`in` ⇒ membership, `out` ⇒ none**, checked after every step;
  - `renewal_reply.detail` snapshots the counts at the time of the reply;
  - **monotonicity:** after any sequence of calls, the pending count never increases.
- **`remove_renewal_invitee` ("Remove"):** commissioner only; `pending` only (a player's own `in` or `out` can't
  be overridden); notifies the player.
- **The gate, each path refused while ≥ 1 reply is pending, and each allowed at 0:**
  - a direct `[I2a]`-shaped UPDATE of `draft_date`, as the commissioner's JWT;
  - `draft_order_mode`;
  - `draft_status` → `in_progress` as **service_role** (the draft-control path, no exemption);
  - `set_draft_order`;
  - `start_renewed_season`.
  - Plus: ordinary leagues (no `previous_league_id`) are unaffected, and the trigger counts
    rows RLS would hide.
- **Joins during renewal:** `join_league_by_code` admits newcomers beyond the old league's size,
  up to 16, then refuses `league_full`. They show as `new` in the roster. At draft start,
  `num_participants` = the member count.
  - **Trigger order:** a commissioner-JWT start still passes the F1 column guard.
- **`start_renewed_season`:** unknown key refused; CHECK violation refused (nothing written);
  slots replaced atomically; `season_set` exactly once to members; idempotent re-call.
- **`cancel_league_renewal`:** cascades everything (the open draft order included); the
  predecessor can be renewed again; refused after draft start.
- **`get_renewal_roster` (rev 3.1 access):**
  - the commissioner sees the full list with `can_nudge`/`can_remove`;
  - an **in** player sees the same full list with no actions;
  - a newcomer sees the full list;
  - a **pending** or **out** player gets only `caller_status`, with empty `people[]`;
  - an **in → out flip revokes the list in the same transaction**, and out → in restores it;
  - a stranger gets 0 rows;
  - `replies_pending` equals the gate predicate.
- **`nudge_renewal`:** commissioner only; `pending` only; refused inside 24 h; status
  byte-identical after it; one `renewal_nudge` row per accepted nudge.
- **Free flips:** in → out → in → out by the same player before the draft: membership tracks
  every step, the pending count never moves, and each flip writes one `renewal_reply`. After
  draft start the flip is refused.
- **End to end:**
  - renew → replies → mark out → start season → draft start (the real `lock_draft_order_on_start`
    locks an order over the actual members) → `finalize_league_draft` with `season_number = 2`
    → `get_league_history` shows both seasons;
  - `get_season_result(old)` is still `detail_scope='full'`.
- **Phase 0** is already covered by `lock_start_new_league_season.pglite.test.ts` (`5c2175c`).

### 5.2 Hermetic (Deno, no DB)

- **`draft-control/rules.test.ts`:** the `renewal_replies_pending` blocker, its order among the
  existing blockers, and `status` reporting `replies_pending`.
- **`record-trade`:** the `season_completed` refusal.
- **`draft-order-notify`:** the body builder for each new kind (board copy verbatim, counts from
  `detail`, not live).
- **Mobile `tests-deno`:**
  - a renewed league's capacity copy ("follows who's in, up to 16");
  - SlotBuilder `leagueSize` = in + new;
  - the reconcile groups and the disabled-draft reason, driven from `replies_pending`.

### 5.3 Prod effect test

`docs/security/run-it-back-effect-test.sql` runs inside `BEGIN … ROLLBACK`, as a real
commissioner of a completed test league:
- renew;
- one invitee says `in`, one is marked `out`;
- the gate refuses `draft_date` while a third is pending, then allows it at 0;
- `proacl` for everything.

The real end-to-end proof is a test league renewed, replied to, drafted, finalized, and its
Week 1 scored.

### 5.4 Migration range `20261023000000`–`09`

| Version | Content | Phase |
|---|---|---|
| `20261023000000` | lock `start_new_league_season` | **0, committed `5c2175c`** |
| `20261023000001` | `leagues.previous_league_id`, `lineage_id`, `season_number` + partial UNIQUE + `lineage_id` index | 1 |
| `20261023000002` | `finalize_league_draft` season number (+ re-stated grants) | 1 |
| `20261023000003` | `league_notifications`: kinds, `subject_user_id`, `detail`, exactly-once indexes | 1 |
| `20261023000004` | `league_renewal_responses` + `renew_league`, `respond_to_renewal`, `remove_renewal_invitee`, `start_renewed_season`, `cancel_league_renewal`, `nudge_renewal` (+ ask-back-in functions only if confirmed) | 1 |
| `20261023000005` | `trg_leagues_renewal_gate` (gate + `num_participants` at start) + `set_draft_order` refusal | 1 |
| `20261023000006` | `get_renewal_roster`, `get_league_history` | 1 |
| `20261023000007` | `get_home_summary` + lineage columns (DROP/CREATE, grants re-applied) | 1 |
| `20261023000008` | (b) keep teams **or** keepers, if chosen | 2 |
| `20261023000009` | `DROP FUNCTION start_new_league_season`, **in `deferred/`** (committed `5c2175c`) | deferred |

If (b) picks both keep teams and keepers, request a second range.

---

## 6. Effort and phasing

| Phase | Scope | Backend effort | Gate |
|---|---|---|---|
| **0** | Lock `start_new_league_season` | **done: `5c2175c`** (9/9 PGlite) | Giorgio's `db push` |
| **1 (opt-in renewal + new draft)** | §2: lineage columns, `renew_league`, the replies table and its four functions, the server gate (trigger + `set_draft_order` + draft-control blocker), `num_participants` behaviour, notifications (five kinds + the push body builder), `get_renewal_roster`, `get_league_history`, `get_home_summary`, the `finalize_league_draft` season number, the `record-trade` refusal. PGlite + hermetic + effect tests. | **L: ≈4–5 worker days** including tests (rev 2's lean path was ≈2–2.5; opt-in adds the replies state machine, the gate and its five enforcement points, and four notification kinds) | Orchestrator go, after (b) |
| **1 + ask back in** | `request_back_in` + `readmit_to_renewal` (Nudge and Remove are already in phase 1) | **+0.25 day** | Giorgio confirms |
| **1 release** | promote the `draft-order-notify` cron (deferred precondition 5), since the ask is a push | ops | live test |
| **1-client** | a1–a6 + the history frames; `num_participants` displays (§2.7) | mobile | phase 1 deployed |
| **2c** | (b)-B keep teams | M–L: ≈4 days | Giorgio on §4.1 (i)–(iv) |
| **2d** | (b)-C keepers | L: ≈5 days + a live draft test | Giorgio on §4.2 |
| **2e** | newcomers see full Season 1 detail | XS–S | Giorgio |

**Deploy order for phase 1** (HUMAN ACTIONS for Giorgio, from the refreshed deploy checkout):
1. `db push` of `01`–`07`; the dry-run lists exactly those.
2. Deploy `draft-control`, `record-trade` and `draft-order-notify`, each byte-verified.
3. Run the effect test.
4. Re-capture `db-snapshot.json`.
5. Commit `gen-architecture.mjs` with the code PR.

**Ordering hazard:** step 1 before step 2 is safe. The gate trigger refuses a pending-reply start
even with the old `draft-control`, which then reports a generic 500 instead of the new blocker,
for the minutes in between.

---

## Open questions for the Orchestrator / Giorgio

1. **(b) How teams start.** This design assumes a new draft. Keep teams (§4.1) and keepers
   (§4.2) are each additive.
2. **"Ask back in"** for a removed player (a5's last line). Not covered by the rev 3.1 rulings.
   If wanted: until when (assumed: the order is finalized at T−1h)?
3. **To confirm (§2.4):**
   - Does a **newcomer** see the full "Who's running back" list? Assumed yes, because the
     predicate is membership.
   - Does a **pending/out** player see counts? Assumed no, only their own status.
   Either change is one predicate, with no change to the RLS or RPC shape.
4. **The nudge rate limit:** 24 h per player (default)?
5. **Copy needed** for `renewal_removed`, `season_set` and, optionally, a nudge variant (Design
   Lead).
6. **Newcomers and Season 1 detail:** frozen standings only (phase 1), or full week-by-week
   Season 1 too (§4.3)?
7. **The superseded league in the switcher** (§4.5).

**Resolved in rev 3.1:**
- roster visibility (in players see the full list);
- Nudge again + Remove (phase 1);
- in ↔ out flips are free until the draft starts.

---

## 7. Review fixes (2026-10-04, before the first push)

Two read-only reviews (security-reviewer; supabase-reviewer) ran against `feat/run-it-back`.
The valid findings were fixed in place and are covered by the PGlite suite:

| Finding | Fix | Where |
|---|---|---|
| A commissioner could clear `previous_league_id` (switching the gate off) or forge `lineage_id` (reading another lineage) through the self-service RLS policies | `enforce_league_lineage_columns`: a direct client write (`current_user` anon/authenticated) may not set or change the lineage columns. SECURITY INVOKER, so the definer RPCs are exempt | 000004 |
| The gate keyed on `previous_league_id` | keyed on the pending rows instead | 000004 |
| A league with a successor could be deleted, silently dropping a season | `previous_league_id` is `on delete restrict` | 000000 |
| Invitees' seats were not reserved, so newcomers could lock them out | `enforce_renewal_membership` on `league_members` INSERT: a newcomer or bot takes only an unreserved seat (members + pending + 1 <= cap) | 000004 |
| Removal could be undone by joining with the invite code | the same trigger refuses a commissioner-removed player on ANY insert path | 000004 |
| A pending invitee who joined by code kept a 'pending' reply | the trigger syncs it to 'in' (decided by the player) | 000004 |
| Visibility of later seasons persisted after declining | a visibility ceiling: a caller sees seasons up to the latest one they were a member of (**a decision to confirm**) | 000003 |
| Existence oracle in `renew_league` and `respond_to_renewal` | uniform refusals for non-invitees and missing leagues | 000003 |
| Bots counted as newcomers in the roster and counts | excluded (`bot-%`) | 000003 |
| `pick_clock_enabled` silently discarded by the pick-clock guard | removed from the settings whitelist (client writes are always clocked) | 000003 |
| `add_bots` could fill seats an invitee needs | refused while any reply is pending | draft-control |

Not changed, with reasons:
- **Stake mode mirror (reported as MED-3):** a false positive. The
  `leagues_mirror_budget_mode` trigger was dropped by `20260811000001`.
- **Lock profile (LOW-7):** the affected tables are small, and every existing row
  satisfies the new constraints. `NOT VALID` plus `VALIDATE` would only matter at
  scale.
- **Flip rate limit (LOW-6):** each reply writes one notice. Coalescing is a
  follow-up.
- **Seat reservation for join-by-code:** enforced at the table, so it covers every
  path. The join function's own message still says "league_full" for a full league,
  and the trigger's message is the one a reserved-seat refusal shows.

