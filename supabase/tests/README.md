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

1. `supabase/migrations/*_leagues_member_draft_complete_column_guard.sql`. The step
   picks this up automatically once PR #9 is merged.
2. The file named by `PR9_TRIGGER_SQL`, for use until then. Nothing is vendored:

   ```bash
   git show origin/security/claude-security-fixes-20260730:supabase/migrations/20260730000000_leagues_member_draft_complete_column_guard.sql > /tmp/pr9_trigger.sql
   ```
   ```bash
   PR9_TRIGGER_SQL=/tmp/pr9_trigger.sql deno test --allow-read --allow-env supabase/tests/
   ```

   (PR #9's worker is re-timing that migration to `20260925000000`. If the path above
   is gone from the branch, list the branch's migrations with
   `git ls-tree -r --name-only origin/security/claude-security-fixes-20260730 supabase/migrations`.)

If neither is found, the step reports **ignored**, never passed. So an unrun trigger
check stays visible in the summary.
