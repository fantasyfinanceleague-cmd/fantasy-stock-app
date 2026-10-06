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
