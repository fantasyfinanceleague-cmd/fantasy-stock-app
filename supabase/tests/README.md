# supabase/tests: SQL tests against real Postgres

The tests here execute migrations against a **real Postgres 16** (PGlite, Postgres
compiled to WASM, running in-process under Deno). The hermetic unit tests live next to
their modules in `supabase/functions/`. The tests in this folder are the counterpart
for SQL. PL/pgSQL resolves names only at execution time, so a migration that applies
cleanly proves nothing about its function bodies (`CLAUDE.md`).

They are **deliberately outside `supabase/functions/`**. That keeps
`deno test supabase/functions/` offline and hermetic, with no npm fetch and no WASM.

## finalize_league_draft.pglite.test.ts

What it does:
- Loads `supabase/migrations/20260926000000_finalize_league_draft_rpc.sql`
  **verbatim** onto a minimal replica of the schema it touches.
- Simulates Supabase's `ALTER DEFAULT PRIVILEGES` grants to `anon`/`authenticated`,
  so the `proacl` assertion proves the explicit revokes work. `REVOKE FROM PUBLIC`
  alone would fail it.
- Drives the migration with payloads from the real planner in
  `supabase/functions/_shared/schedule.ts`.

It covers:
- grants and the pinned `search_path`
- the season-1 backfill and its idempotency
- the happy path, and a re-run that is a no-op
- odd rosters and `num_weeks` COALESCE
- duration leagues
- 14 payload/roster refusals, each asserted to write nothing and leave the draft
  `in_progress`
- partial schedule vs. partial standings
- season-N re-scheduling
- PR #9's leagues trigger contract
- the stuck-draft detector query in the migration header

## league_standings_ranked.pglite.test.ts

What it does:
- Loads the three `20261011*` ranking migrations **verbatim**, on top of the real
  prior definitions they replace: `20261004000000` + `20261004000001` whole, and
  `complete_league_season` sliced out of `20260125000000` with its lockdown grants
  (`20260718000002`) and `search_path` pin (`20260724000002`).
- Recreates the prod members-only SELECT policies (with `is_member()` sliced out of
  `20260712000000`) so the INVOKER function runs under real RLS.

It covers:
- grants and security mode; the two re-created functions' `proacl`, `prosecdef`
  and `proconfig` byte-identical before/after
- the motivating 5-1 vs 5-1 case, including `get_home_summary`'s rank flipping
  from 2nd to 1st
- win % over non-bye games (ties half; uneven byes; 0 games played = 0%), 2-/3-/4-way H2H (balanced, cycle, unbalanced, never-met,
  recursive subgroups), byes, unscored and playoff games ignored
- the pre-season join-order key, the playoff-cutoff case, ranks exactly 1..N
- RLS (member / non-member / anon) and `complete_league_season`'s snapshot

## start_league_playoffs.pglite.test.ts

What it does: loads `20261011000003` and the `20261011000004` backstop index
**verbatim** on a replica of `matchups`' unique keys and `valid_playoff_round` check. It drives the function with brackets from the
real `buildPlayoffBracket` (`process-week-results/season-transition.ts`).

It covers:
- grants (DEFINER, `service_role` only)
- claim + full bracket insert
- idempotency: a repeat call is `already_transitioned` and writes nothing
- atomicity: a bad timestamp or duplicate key rolls back the claim, and a retry then
  succeeds
- no re-claim with existing playoff rows or a non-active status
- compare-and-swap: a stale `p_expected_week` is `not_eligible` and writes nothing
- backstop index: a non-atomic second bracket is rejected, while normal winner
  advancement (4- and 8-team) never trips it
- 17 write-free refusals
- anon/authenticated denied

PGlite has one connection, so true concurrency is argued in the migration header (row
lock + READ COMMITTED re-check of `season_status`), not executed.

## bye_recompute.pglite.test.ts

Runs the hand-run HUMAN ACTION `docs/migrations/bye-no-result-standings-recompute.sql`
**verbatim**. Steps 1–2 run as written; step 3 has its `-- ` prefix stripped and the
league id substituted. It proves:
- steps 1–2 find the legacy bye wins and the managers they inflate;
- step 3 corrects W/L/T only for the target league, keeps `points_for`, and rewrites
  legacy bye rows to the no-result shape;
- a completed season is never touched.

### Run (from the repo root)

```bash
deno test --allow-read --allow-env supabase/tests/
```

The first run fetches `npm:@electric-sql/pglite` (pinned in `deno.lock`) into the
Deno cache and the root `node_modules/.deno/`, which is gitignored. Later runs are
offline. No DB, no Docker, no secrets.

### PR #9's leagues trigger

The "PR #9 trigger" step loads `enforce_leagues_member_update_columns` /
`trg_leagues_member_update_columns` **verbatim**. It looks in two places:

1. `supabase/migrations/*_leagues_member_draft_complete_column_guard.sql`.
   PR #9 merged (`5e3b5d1`) with this file at `20260925000000`, so on `main` the
   step picks it up automatically and **runs**. Expect 25 steps passed and 0
   ignored.
2. The file named by `PR9_TRIGGER_SQL`, for older branches that predate the merge.
   Nothing is vendored:

   ```bash
   git show origin/main:supabase/migrations/20260925000000_leagues_member_draft_complete_column_guard.sql > /tmp/pr9_trigger.sql
   ```
   ```bash
   PR9_TRIGGER_SQL=/tmp/pr9_trigger.sql deno test --allow-read --allow-env supabase/tests/
   ```

If neither is found, the step reports **ignored**, never passed. So an unrun trigger
check stays visible in the summary.

## draft_pick_clock.pglite.test.ts

Loads `supabase/migrations/20261010000000_draft_pick_clock_and_queue.sql` verbatim, together with PR #9's leagues column guard. It covers the pick clock (trigger, CHECK, lock, deadline math, overdue list), the draft queue (RLS and `set_draft_queue`), grants (proacl, and in practice), and `auto_pick_search_candidates` compared against its TS mirror, which uses `effectiveCategoryIds`, the rule the pick gate uses. It also runs `docs/security/draft-pick-clock-effect-test.sql` itself. That is the file Giorgio runs in the SQL editor after the push, and every line must PASS here first.

## draft_order_modes.pglite.test.ts

Loads `20261013000000_draft_order_modes.sql` verbatim, on top of (all verbatim, in timestamp order) PR #9's leagues column guard, the pick-clock migration, `20261011000003`/`04`, and flexible playoffs `20261012000000`–`03`. That proves it applies cleanly on what prod will have, and that all `leagues` triggers (column guard, playoff-teams freeze, order mode, pick clock, order start) fire together in their real order. It covers:
- grants: proacl, relacl, and the column-level UPDATE on `league_notifications`
- the legacy backfill, byte-identical to the deleted `computeDraftOrder`, with mixed-case and bot ids
- reveal gating at `draft_date − 1h`, and generated-exactly-once
- the **no-commissioner-first regression**, 200 trials on each of four paths, with the commissioner reading the order after every join. This test caught a real bug before the first commit: finalizing with only the commissioner in the league put them first 200/200.
- the 4-member floor
- manual seed / save / refusals, and the mode-change rules
- joins and leaves in each state
- the start backstop, the reconcile and the lock
- immutability for every role
- the league-delete cascade
- the cron work list

It also runs `docs/security/draft-order-modes-effect-test.sql`, which must show exactly 24 PASS.

## draft_order_no_derivation.test.ts

A structural guard. No production file may call `computeDraftOrder` or re-implement the commissioner filter+sort; the draft order is stored. It reads files only: `deno test --allow-read supabase/tests/draft_order_no_derivation.test.ts`.

## draft_insert_sites.test.ts

A structural guard. Only `insertGatedPick` (gated picks) and `insertSkip` (SKIP rows) may write `drafts`, and only `gatePick` may produce a `GatedPick`. It reads files only: `deno test --allow-read supabase/tests/draft_insert_sites.test.ts`.

## username_write_path.pglite.test.ts

What it does:
- Loads `20261007000000_username_write_path.sql` **verbatim**, on top of the five
  earlier `user_profiles` migrations, also verbatim. Those five give it the real
  table, the `LOWER(username)` unique index, the RLS policies and the
  `handle_new_user_profile` signup trigger.
- Stubs only the Supabase shell: the roles and their default grants, a three-column
  `auth.users`, `auth.uid()` (the real body), and the `supabase_realtime`
  publication.

It covers:
- regex parity between the CHECK, both RPCs and the trigger
- the migration failing closed on a violating row (nothing half-applied)
- `convalidated`
- grants, `SECURITY DEFINER` and `search_path`
- the CHECK on direct writes
- `set_username`: ok, idempotent, re-casing your own name, taken
  (case-insensitive), invalid (including NULL, `''`, `\n` and non-ASCII), and the
  no-row insert arm
- a simulated `unique_violation` race → `taken`
- `check_usernames`: order, duplicates, the NULL element, the 10/11 cap, and
  NULL/`{}` input
- no-JWT and anon → 42501
- direct DML through the real RLS policies
- the signup trigger after the CHECK

Mutation-checked on 2026-09-29. Each of these is caught:
- dropping the own-row exclusion
- keeping the anon grant (caught by two steps)
- removing the `unique_violation` handler
- letting NULL through `set_username`

It **cannot** prove the following (the file header lists them). The SQL-editor test
`docs/security/username-write-path-effect-test.sql` still owns them:
- prod's real roles and grants
- PostgREST/GoTrue JWT handling
- the real `auth.users` and GoTrue's signup transaction
- real concurrency (PGlite is one connection; the race is simulated with a
  test-only trigger)
- prod data (the migration's PRE-CHECK covers that)

Running it may rewrite `deno.lock` with unrelated npm workspace churn. Don't commit
that as part of a test change.

## flexible_playoffs.pglite.test.ts

What it does:
- Loads the prior definitions (`20261011000003` `start_league_playoffs`, the
  `20261011000004` backstop index) on a replica of `leagues`/`matchups` with the
  OLD `IN (2,4,8)` and 3-round CHECKs.
- Inserts **legacy fixtures** (a finished 4-team bracket, an in-flight 8-team one,
  NULL `playoff_teams`, live and finished leagues) **before** applying
  `20261012000000`–`03` verbatim, so the backfills run against real legacy data.
- Drives the function with brackets from the real `buildPlayoffBracket`, and
  advances winners with the real `planAdvance` plus the same conditional,
  addressed UPDATE `advancePlayoffWinner` issues.

It covers:
- bracket-address backfill (the in-flight 8-team bracket gets exactly
  `planBracket`'s addresses), NULL → 4 on matchup leagues only, the new CHECKs,
  and the `league_end_date` extension (live only; idempotent)
- acceptance of the exact bracket for every P from 2 to 16 (byes pre-placed in
  round 2), P below the member count, and P = 17 refused (`bracket_too_large`)
- 20 shape refusals, each asserted to write nothing
- a full tournament for every P: every slot is filled when its week starts,
  nobody plays twice in a week, retries are no-ops, and there is one champion
- the `playoff_teams` freeze, including the designed order (lower P while
  `not_started`, then start) and the service-role exemption
- `proacl` of the replaced function and the new trigger function

`start_league_playoffs.pglite.test.ts` now loads the whole chain through
`20261012000003`, so it tests the live definition. Its backstop steps test the
address index that replaced it.


## season_result.pglite.test.ts

What it does:
- Loads `20261014000000` (`get_season_result`) and `20261014000001` (the
  `league_seasons` commissioner-write drop) **verbatim**, on top of the real
  functions they read or depend on: `is_member` (sliced), `participant_display_name`,
  `league_standings_ranked`, `complete_league_season` (`20261011000002`), and
  `start_new_league_season` (sliced from `20260718000000`). It also loads both prod
  `league_seasons` policies, sliced from `20260125000000`.
- Every `final_standings` is written by the **real** `complete_league_season`, so
  `final_rank` is the unified ranking's output, never a hand-typed number.
- Simulates Supabase's default EXECUTE and table-ALL grants to the API roles, so the
  `proacl` and table-grant assertions prove the explicit revokes work.

It covers:
- grants: DEFINER, authenticated only, `search_path` pinned; anon, service_role and a
  missing `sub` are all refused
- the policy drop:
  - the FOR ALL hole is reproduced BEFORE the migration;
  - after it, a commissioner's UPDATE (champion / final_standings), INSERT and
    DELETE fail with 42501, and a member still reads;
  - the DEFINER completion and `start_new_league_season` still write
- a 4-team league: the champion, the runner-up and an eliminated semifinalist; the
  best week; `final_rank` equal to the stored rank
- a 6-team league with P=6: a bye seed losing its first game (0-1, round 2), the
  wild-card exit (round 1), and the champion at 3-0
- a 5-team odd roster: a bye adds no W/L/T, but it can be the best week; a manager who
  missed the playoffs
- 12 `inconsistent` refusals, each checked from a third member's seat with every
  derived field NULL:
  - `champion_mismatch` (a forged champion, a forged runner-up)
  - `weeks_unscored` (a week unscored, a week missing)
  - `points_for_mismatch`
  - `playoffs_unscored` (a game unscored, all games missing)
  - `playoff_final_unresolved`
  - `playoff_shape_mismatch`
  - `standings_missing_participant`
  - `final_standings_missing`
  - `season_status_mismatch`
- `not_complete` (no podium, even with the final scored), and `no_season`
- the archived season after `start_new_league_season`:
  - `standings_only`;
  - the default picks the last *completed* season;
  - eliminated vs missed is NULL, not guessed;
  - a member who joined later gets `caller_participated = false`
- 0 rows for a non-member, an unknown league, and a season from another league

## f8_push_tokens.pglite.test.ts

What it does:
- Loads `supabase/migrations/20261017000000_f8_push_tokens_relocation.sql` **verbatim**
  onto a replica of prod's `user_profiles` (the token column and its index, the three
  prod policies, and membership in `supabase_realtime`), with Supabase's default
  table grants simulated.

It covers:
- the finding reproduced BEFORE the migration (any authenticated user reads another's token)
- the backfill (non-null tokens only, keyed by user)
- the column dropped from the published table (the Realtime vector), while cross-user
  username/avatar reads keep working
- `push_tokens` not in `supabase_realtime`
- owner-only SELECT/INSERT/UPDATE/DELETE, and the 1.1.0 client's upsert + logout delete
- anon holds no privilege at all (not merely RLS-empty)
- service_role reads any token (send-notification's admin client)
- the `auth.users` delete cascade

Mutation-checked: an open SELECT policy, a missing anon revoke, or a kept column
each fail their own step.

## lock_start_new_league_season.pglite.test.ts

What it does:
- Rebuilds the function's real prod ACL history **verbatim**: the body and grant
  lines from `20260718000000`, then the grant lines from `20260718000001`, under
  simulated Supabase default grants. The pre-state therefore has
  `authenticated=X` and `service_role=X`, matching the prod snapshot.
- Applies `20261023000000_lock_start_new_league_season.sql` whole.
- Runs the migration header's POST-PUSH **DO-block effect check**,
  un-commented, both before the migration (it must report `FAIL`) and after it
  (it must report `PASS -- 42501`). So the HUMAN ACTION query is proven able
  to tell the two apart, and to pick a UUID-shaped commissioner over a newer
  `bot-*` one.

It covers:
- the pre-state: the commissioner reaches the body, and it really DELETEs the
  league's matchups (inside a rolled-back transaction);
- `proacl` = `{postgres=X/postgres}` exactly, with one overload kept (not dropped);
- the authenticated commissioner, anon and service_role each refused with
  `42501`, with matchups, seasons, standings and the leagues row unchanged;
- the owner keeps EXECUTE (its call reaches the body's own commissioner gate,
  `P0001`), so the function stays restorable;
- re-applying the migration is a no-op.

## draft_feasibility_pool (draft-never-skips, 2026-10-05)

`draft_feasibility_pool.pglite.test.ts` — the SQL pool groups == the TS
`buildPoolGroups` on one fixture, and the service-role-only grant.
Run: `deno test --allow-read --allow-env supabase/tests/draft_feasibility_pool.pglite.test.ts`
(first run fetches `npm:@electric-sql/pglite`).

## record_trade_atomic.pglite.test.ts

What it does:
- Loads **verbatim**: the trades table and its RLS (`20250118000000`), the quantity
  widening (`20260810000000`), `funded_by_trade_id` and its unique index
  (`20261006000000`), the client-INSERT policy drop (`20260811000002`), and
  `20261102000000_record_trade_atomic.sql`. leagues, league_members, drafts and
  league_draft_slots are replicas of the columns the function reads.
- Drives the function through record-trade's **real** write path:
  `commitWithRetry` + `decideTrade` (`supabase/functions/record-trade/commit.ts`)
  over the real validator. Only the reads are SQL instead of paginated PostgREST;
  pagination is covered hermetically in `record-trade/commit.test.ts`.
- Forces each race's losing interleaving deterministically: A and B both read, A
  commits, then B submits its stale view.

It covers:
- grants: INVOKER, VOLATILE, `service_role` only, `search_path` pinned; anon is
  denied, and a *leaked* authenticated grant still cannot insert (trades RLS)
- structure: the advisory lock precedes every table read, with the key pinned
- the races, each with exactly one row committed and the loser's game refusal:
  - double sell → `not_owned`, net position 0
  - double budget_cap buy → `symbol_owned`
  - two buys that each fit the budget alone → `over_budget`
  - double price_tiers buy → `symbol_owned`
  - two buys racing for the last roster spot → `roster_full`
  - cross-user same symbol → `symbol_owned`, one owner
  - two buys into one skipped fixed_notional slot → `no_proceeds`
  - two buys reinvesting the same named sale → `proceeds_unavailable`
- the CAS: a moved trade, a deleted draft pick, each of the five rules columns,
  and a slot edit or insert are each `ledger_changed` naming what moved; exact-set
  semantics (missing, extra, duplicated id); numerics compared by value (no
  spurious conflict); a sell is not refused by a rules edit it never read; a
  mid-flight budget edit re-validates under the new rules
- **`trade_conflict` means nothing was traded:** a neighbour commits between
  every read and its RPC, so all 3 attempts of a FUNDED fixed_notional buy get
  `ledger_changed`. The test asserts `trade_conflict`, that every attempt really
  was funded by the sale, that only the neighbour's rows are new, and that no
  `funded_by_trade_id` row exists in the league and the sale is claimed nowhere.
  (The hermetic side, `trade_conflict` ONLY when every attempt was
  `ledger_changed`, never after an rpc `{ error }`, a timeout or a 23505, is in
  `record-trade/commit.test.ts`.)
- write-free refusals: `not_a_member`, `league_not_found`, `bad_request`,
  `draft_not_completed`
- the funded index is mapped inside the RPC **by name**; any other constraint
  still raises
- the migration header's HUMAN ACTION **DO-block effect check**, run verbatim:
  PASS on this function, FAIL on one with the CAS neutered, and it rolls back
  either way

What it cannot show: two truly concurrent transactions blocking on the advisory
lock. PGlite has one connection, so the lock rests on the argument in the migration
header plus the structure step.

Mutation-checked (each fails at least one step):
- neutering the trades CAS (11 steps, including the trade_conflict proof);
- neutering the drafts CAS;
- dropping DISTINCT from the seen-set join;
- removing the NULL-element guard;
- removing the lock (the structure step);
- `STABLE` instead of `VOLATILE` (every step: a STABLE function cannot INSERT);
- removing the READ COMMITTED guard;
- `MAX_ATTEMPTS = 1`, i.e. no retry (10 steps here, plus 6 hermetic tests).

Also covered: jsonb `'null'` for rules/slots reads as not given (a sell still
commits), and the function refuses to run under REPEATABLE READ.

### record_trade_atomic.pglite.test.ts: tier slots (20261103000000)

The same file also loads `20261103000000_trades_slot_id.sql` (adds `trades.slot_id`,
drops the 12-arg overload, adds `p_slot_id`) and drives it through the real
`commitWithRetry` + `decideTrade`. The steps:
- exactly ONE `record_trade_atomic` (13 args) and the 12-arg signature is gone;
  the proacl lockdown is re-asserted on the new signature;
- the repro end to end: NVDA in hi, a $100 buy fills lo and records `slot_id`, a $150
  buy is refused `no_eligible_slot` with `open_slots: []`; sell-then-buy fills the freed
  tier; draft-sell-rebuy counts the buy's slot once;
- race 3c: two different symbols into one free tier slot, the loser re-validates;
- legacy rows: a NULL-slot buy occupies its derived tier, and a manager already holding
  two stocks in one tier is never stranded (sell either, then it reopens);
- the three RPC slot guards (slot on a sell, a foreign slot, a slot-less buy in a slotted
  league) are `bad_request` and write nothing, and run AFTER the CAS;
- a slot deleted between the guard reads and the INSERT (a test trigger simulates the
  commissioner's lock-free DELETE) maps the FK error to `ledger_changed`, nothing written;
- the table: `slot_id` buy-only CHECK, deleted slot is SET NULL;
- both HUMAN ACTION effect-check DO blocks run verbatim: the #113 block against the
  13-arg function, and the new `TIER_TRADE_SLOTS EFFECT TEST` block, which must PASS,
  read PARTIAL (never PASS) when no completed slotted league exists, and FAIL (writing
  nothing) for each of: a removed guard (x3), EXECUTE leaked to authenticated, the
  12-arg overload left callable.

Mutation-checked: reverting the validator's occupancy to drafts-only fails 7 hermetic
tests including the repro (`draft-validation.test.ts`, "tier trades: ...").

## freeze_league_rules.pglite.test.ts

What it does:
- Loads, **verbatim** and in prod order:
  - the `drafts` RLS (`20251205110000`, including the live "Commissioners can delete
    picks" policy) and its INSERT-policy drop (`20260811000003`);
  - the B1 helpers and the `leagues` / `league_members` RLS (`20260712000000`/`01`/`02`,
    including [I5] delete-self);
  - `league_draft_slots` with its interim commissioner policies (`20260810000004`);
  - the F1 member column guard (`20260925000000`) and the pick clock (`20261010000000`);
  - the `playoff_teams` freeze (`20261012000002`) and draft order modes
    (`20261013000000`);
  - then `20261104000000_freeze_league_rules_after_draft_start`.

  So every prod trigger on `leagues` and `league_members` fires here, in prod's order.
- Builds `leagues` by **replaying every `CREATE TABLE` / `ALTER TABLE … ADD|DROP|RENAME
  COLUMN` on it** from `supabase/migrations/` (FK `REFERENCES` stripped). The triggers
  therefore run against the real column set, types and inline CHECKs.
- Runs writes as `authenticated` with a JWT sub, so the real interim policies admit the
  commissioner and the new triggers are what refuse them. The service role is
  `service_role` (bypassrls) with no sub.

It covers:
- **replay completeness**: every migration statement that mentions `table leagues` is
  either replayed or a known non-column form (constraints, RLS, column defaults). An
  `ADD x` without `COLUMN`, a quoted name, or DDL inside a `DO` block fails the test, so
  the replay can't silently miss a column.
- **classification**: every `leagues` column is classified as `frozen`, `stamp_once`,
  `guarded` (with the named trigger) or deliberately `editable`. **A new column fails
  this test until it is classified**, so a future rule column cannot silently stay
  commissioner-writable. The editable set is exercised post-draft, and `id` is pinned.
- the season-state columns (`season_status`, `current_week`, `current_season_id`,
  `commissioner_id`) and the retired `budget_mode` frozen like the rules; `league_start_date` / `league_end_date`
  stamp-once, exactly F1's carve-out: NULL → value only in the completing UPDATE
  (`in_progress` → `completed`). The member and commissioner completion shapes pass. A
  rewrite, a clear, or a hindsight stamp at any other time is refused.
- the "guarded elsewhere" columns are proven post-draft: `draft_order_mode` and
  `pick_seconds` are refused, and `pick_clock_enabled` / `draft_started_at` are reverted
- no probing: a non-commissioner writing a slot into someone else's league gets the RLS
  error, not `league_slots_locked`. The DEFINER trigger only reads and locks the caller's
  own leagues.
- leaving the league ([I5], interim guard): a member and the commissioner refused with
  `league_membership_locked` in `in_progress` and `completed`; pre-draft leave unchanged;
  the service role may remove a member post-draft, but mid-draft it still meets the
  older all-roles `draft_in_progress`; deleting a started league cascades its members,
  slots and draft order; two leaves in one transaction complete (single connection only).
  The lock MODES (`FOR NO KEY UPDATE` for leaves, `FOR SHARE` scoped to the caller's
  leagues for slots) are pinned statically from `pg_proc.prosrc`, because one connection
  can't tell them apart.
- draft picks: the commissioner's pick DELETE is refused in `in_progress` and `completed`
  (`draft_picks_locked`). A pre-draft delete is allowed. A member's delete and any user
  UPDATE match 0 rows (there are no such policies). The service role may delete, and
  deleting a started league cascades its picks.
- pre-draft: the commissioner inserts, updates and deletes slots and edits every rule
- `in_progress` and `completed`: every slot write (and the delete-then-insert client
  save) refused with `league_slots_locked`; each of the 14 frozen columns refused on
  its own (and set to NULL) with `league_rules_locked` naming the column; nothing written
- the same-value patch shapes of mobile `league-settings.tsx` and web `Leagues.jsx`
  (with an unscaled `budget_amount`) still saving after the draft
- one UPDATE that changes a rule and starts the draft (judged on OLD, allowed)
- the `draft_status` transition table: the three forward moves, every backward move
  refused for the commissioner (`league_draft_status_locked`) but allowed for the
  service role, and the rewind bypass closed end to end
- re-parenting a slot into or out of a started league; the commissioner deleting a
  completed league (the slot cascade); a member still refused by RLS
- the lock: a slot write row-locks its league (`xmax`), and both same-transaction
  orders complete. Two-transaction races need two connections, so that argument is in
  the migration header.
- fail closed: an unknown or NULL `draft_status` (with the CHECK dropped) freezes
  everything and allows no move
- `proacl`, `prosecdef` and the `search_path` pin of both trigger functions
- the human post-push block `docs/security/freeze-league-rules-effect-test.sql`, run
  **verbatim** (via `request.jwt.claims` and Supabase's real `auth.uid()` definition):
  all 28 lines PASS, including F2 (`drafts.league_id` cascades; prints REVIEW in prod if
  the prod-only FK differs), F1 (the only FK touching `league_members` is its
  `league_id` cascade) and C1 (every live `leagues` column classified; its list must
  equal the test's `CLASSIFICATION`), and nothing persists

**PR #94 (Run it back) pointer.** On `origin/feat/run-it-back` (not on `main` when this
test was written), `renew_league` and `start_renewed_season` write slots and rules with
the commissioner's JWT, so this freeze applies to them. Both touch only `not_started`
leagues, so they pass as written. When #94 lands, add a step here that runs them against
this trigger. #94 also adds `leagues` columns (`previous_league_id`, `lineage_id`,
`season_number`), so on rebase this test FAILS until they are classified. They are
guarded by #94's own `enforce_league_lineage_columns` trigger.

Mutation-checked: 25 mutations, 23 of which fail at least one step. They cover:
- each guard branch;
- the leave guard disabled, its cascade allowance removed, its service-role exemption
  removed, and its lock swapped to `FOR SHARE`;
- the drafts guard disabled, its cascade allowance removed, and its scope removed;
- the slot trigger's commissioner scope removed;
- a state column dropped, and `budget_mode` dropped;
- stamp-once refusing NULL → value, and stamp-once widened back to any time;
- three probe migrations: an unclassified column, an `ADD` without `COLUMN`, and an
  `ADD COLUMN` inside a `DO` block.

The two survivors are equivalent, not gaps. They remove the slot and drafts triggers'
explicit `auth.uid() IS NULL` exemption, which changes nothing: their commissioner scope
(`commissioner_id = auth.uid()::text`) already matches no league when the uid is NULL.

#94 compatibility was checked once, in a scratch copy of this suite, against
`20261105000004_run_it_back_gate.sql` @ `f450e78`, all passing:
- the renewal self-leave while `not_started` is allowed and its sync sets the reply to `out`;
- the gate's `num_participants` rewrite on the start UPDATE is allowed (judged on OLD);
- after the start, the freeze and the leave guard hold.

Make that a committed step when #94 lands.

## leave_league.pglite.test.ts

What it does:
- Loads the leave-league migrations `20261107000000`–`06` **verbatim**. Underneath them, also verbatim, are the real objects they meet in prod:
  - PR #9's leagues column guard;
  - the pick clock;
  - flexible playoffs;
  - the draft-order chain `20261013000000`, whose member trigger closes the order gap on a leave;
  - the display-name and Home RPCs, with the ranking they read;
  - `join_league_by_code`, for the rejoin case.
- Simulates Supabase's default API-role grants, so the `proacl` assertions prove the explicit revokes work.
- Runs `docs/security/leave-league-effect-test.sql`, the prod effect check, and requires all 20 lines to PASS and the fixture to roll back.

It covers:
- the leave window:
  - random mode before the reveal;
  - an open manual order;
  - inside the hour, by time;
  - a finalized order with `draft_date` moved later, by state;
  - mid-draft and mid-season;
  - a TBD date;
- refusals writing nothing;
- the reconfirm row across two leaves and a rejoin;
- `confirm_league_roster` with P above, at and below the member count;
- the commissioner hand-over and the successor refusals;
- `sole_manager`;
- hide/unhide plus `get_home_summary` skipping hidden leagues (ACL byte-identical);
- `[I5]` gone (a client DELETE removes nothing).
- the board's reconfirmation:
  - "Invite someone new" is cleared by a HUMAN join through `join_league_by_code`, never by a bot, never on a pending row, and never while P > members;
  - a new departure re-opens the choice;
  - a repeat leave sends no second notice;
- the draft order WAITING past T−1h while a reconfirmation is owed, and set the moment it clears (on confirm, or on an invite cleared by a join);
- the start gate binding the commissioner's raw flip and the service role;
- `draft_order_notify_due` ignoring stranded `member_left` rows.

The second `Deno.test` boots a fresh database with `fixtures/run_it_back_398da84_membership.sql`, a verbatim copy of PR #94's renewal response table and its `trg_league_members_renewal_sync_delete`. It proves three things:
- an invitee's leave is an `out` reply with no reconfirm row;
- a newcomer's leave writes one;
- the renewal commissioner is refused.

**When #94 merges, delete the fixture and load #94's migrations instead.**

Run: `deno test --allow-read --allow-env supabase/tests/leave_league.pglite.test.ts`

## migration_cli_split.test.ts

What it does:
- Ports the Supabase CLI's statement splitter (`pkg/parser/state.go`, v2.67.1) to
  TypeScript, faithfully, quirks included, and runs it over every file in
  `supabase/migrations/` and `deferred/`.
- A file passes when the splitter ends at rest (ready, or in a trailing line
  comment). Ending inside an ATOMIC block, a quote, a dollar quote or a block
  comment means `supabase db push` would glue statements into one and Postgres
  would refuse it (42601).

Why: PGlite runs multi-statement text directly, so the PGlite suites can't see
the CLI's splitting. On 2026-10-06 the first push of `20261102000000` failed
because the bare name `record_trade_atomic` contains "atomic", which the splitter
reads as `BEGIN ATOMIC`. Fix: quote the identifier (`public."my_atomic_fn"`).

Run: `deno test --allow-read supabase/tests/migration_cli_split.test.ts` (files only).

## autopick_cron_wiring.test.ts, autopick_cron_predicate.pglite.test.ts

The auto-pick cron (`20261106000000`) cannot run in PGlite (`pg_cron`, `pg_net` and `vault` do not exist
there), so two tests cover what a header comment cannot enforce.
- `autopick_cron_wiring.test.ts` (hermetic, `--allow-read` only): schedule and cadence, vault key with no key
  literal, explicit `timeout_milliseconds := 180000`, the stall throttle window equals `STALL_COOLDOWN_MS`
  and does not throttle `vendor_outage`, the purge job is plain SQL, the stamps are in order, nothing is left
  in `deferred/`.
- `autopick_cron_predicate.pglite.test.ts`: slices the cron's actual `where exists (...)` out of the migration and
  executes it against a stubbed `overdue_draft_turns()` and a `draft_stalls` replica (11 cases).

## refuse_new_skip.pglite.test.ts

Loads `20261106000002` verbatim onto a `drafts` table that already holds legacy SKIP rows: SKIP/skip INSERT and an
UPDATE-to-SKIP are refused with `23514`, normal picks insert, legacy rows stay readable and editable on other
columns, and the function is not executable by anon/authenticated.

## autopick_runbook_sql.pglite.test.ts

Runs `docs/security/autopick-live-test-proof.sql` and `docs/security/refuse-new-skip-effect-test.sql` **verbatim**
(the SQL-editor scripts of `docs/migrations/AUTOPICK_CRON_LIVE.md`): PASS on a good fixture, then one mutation per
check must flip exactly its own line to FAIL, and each script must leave nothing behind.
## cron_timeouts.pglite.test.ts

What it does:
- Stubs `cron.job` / `cron.schedule` / `cron.unschedule` (pg_cron semantics: upsert by
  name) and seeds the live rows from `docs/architecture/db-snapshot.json` plus the two
  heal-cron migrations that postdate it.
- Runs `20261108000000_cron_explicit_timeouts.sql` over them and asserts every job keeps
  its schedule and its command (modulo the timeout), gains `timeout_milliseconds :=
  180000`, and is not duplicated; the key still comes from the vault.
- Proves the migration's pre-flight aborts, changing nothing, when a job is missing or
  on another schedule.
- Loads the prior `schedule_snapshot_retry` verbatim, then `20261108000001`, and shows the
  generated one-shot jobs gain the timeout while `search_path`, `SECURITY DEFINER` and
  the 'retrying' write are unchanged.
- GUARD: replays every `supabase/migrations/*.sql` (not `deferred/`) and fails any cron
  still scheduled without a timeout above 150 s. Jobs unscheduled and never rescheduled
  are ignored; the guard is itself tested on synthetic input.

Re-run it against the next `db-snapshot.json` re-capture: a live command that differs
from the migration's (timeout aside) fails the "same command" test.

## cron_status_handlers.test.ts

Drives the REAL `index.ts` of process-week-results, snapshot-week-start/-end and
refresh-market-calendar (Deno.serve captured, `fetch` replaced by an in-memory PostgREST)
through each exit, and asserts the `cron_job_status` writes: one `running`, one terminal,
the same-day no-op rule (a heal never erases earlier work or a failure), and that a
rejected status write cannot change the HTTP response. Hermetic (no network, no DB):
`deno test --allow-read --allow-env supabase/tests/cron_status_handlers.test.ts`.
