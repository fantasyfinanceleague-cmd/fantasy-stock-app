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
