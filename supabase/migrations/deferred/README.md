# Deferred migrations — authored but NOT in the apply path

Files in this directory are **intentionally held out of `supabase db push`.** The
Supabase CLI applies only the timestamped `.sql` files directly in
`supabase/migrations/`; anything in this subdirectory is ignored by `db push`.
Do **not** move a file back to the parent directory until its stated precondition
is met.

**Currently held:** 1 file (see *Held* below).

## How to use it

1. Put a migration here when it is correct but its precondition is not yet met
   (a client release, a data cleanup, a deploy it depends on).
2. Add a section below naming the file, the precondition, the query that proves the
   precondition, and the effect-verification query to run after applying.
3. When the precondition is met, `git mv` it into `supabase/migrations/`, apply as a
   HUMAN ACTION, effect-verify, and move its section to *History*.

## Held

### `20260926000001_drop_client_schedule_insert_policies.sql`

Drops the interim client INSERT policies `[I8]` `matchups_insert_members` and `[I9]`
`league_standings_insert_members`. This closes **F10** (any member could forge
matchups) and retires `[I8]`/`[I9]`.

**Precondition: ALL of the following, in order.**
1. `20260926000000_finalize_league_draft_rpc.sql` is applied (check
   `schema_migrations`) and `finalize_league_draft`'s `proacl` shows `service_role`
   only.
2. `validate-and-record-pick` with `finalizeDraft` is **deployed**.
3. **Effect-verified with a real test league.** Draft to completion and confirm the
   league has `draft_status='completed'`, non-NULL `league_start_date`,
   `league_end_date`, `num_weeks` and `current_season_id`, plus the expected
   matchup and standings counts:
   ```sql
   SELECT l.draft_status, l.league_start_date, l.league_end_date, l.num_weeks, l.current_season_id,
          (SELECT count(*) FROM matchups m WHERE m.league_id = l.id) AS n_matchups,
          (SELECT count(*) FROM league_standings s WHERE s.league_id = l.id) AS n_standings,
          (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS n_members
   FROM leagues l WHERE l.id = '<test league id>';
   ```
   For a matchup league, `n_standings` should equal `n_members`. `n_matchups`
   should be `num_weeks * ceil(n_members / 2)`.
4. The web-writer removal (`DraftPage` `completeDraft` and the `Leaderboard`
   auto-generate) is live on `main`. The web is paused, so this only matters if it
   is unpaused before the drop.

**Timestamp note:** if migrations newer than `20260926000001` are applied before
this one is promoted, `db push` will call it out-of-order. When promoting, rename it
to a fresh timestamp (following the orchestrator's range rules) instead of passing
`--include-all`.

**After applying:** run the two effect checks in the file header. Then move this
section to *History*.

## History

| File | Held for | Resolution |
|---|---|---|
| `20260808000001_drop_broker_credentials.sql` | `quote` still read `broker_credentials`; dropping it would have broken live prices app-wide | `quote` rewired onto the app key (Workstream A); promoted and applied 2026-08-10 |
| `20260810000007_drafts_league_id_set_not_null.sql` | Orphan `drafts` rows with NULL `league_id` would abort the push | Zero NULL rows verified in prod; promoted in `4b3eba2` and applied |

Note that "held for the mobile release" migrations were not always parked here:
`20260811000009_drop_leagues_salary_cap_limit.sql` sat in the apply path with a
"hold" header and was applied by a later `db push`. **A header comment does not hold
a migration — only this directory does.**
