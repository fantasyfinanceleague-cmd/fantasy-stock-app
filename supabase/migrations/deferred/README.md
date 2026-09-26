# Deferred migrations — authored but NOT in the apply path

Files in this directory are **intentionally held out of `supabase db push`.** The
Supabase CLI applies only the timestamped `.sql` files directly in
`supabase/migrations/`; anything in this subdirectory is ignored by `db push`.
Do **not** move a file back to the parent directory until its stated precondition
is met.

**Currently held:** 2 files (see *Held* below).

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

**Where to run every step below:** after the branch is merged to `main`, and only
from the deploy checkout `/Users/giorgio/fantasy-stock-deploy`, never from
`/Users/giorgio/fantasy-stock`.

**Prerequisite:** the checkout is linked. See `docs/security/DEPLOY-RUNBOOK.md` step 4
for the one-time `supabase link`. `db push` has no `--project-ref` flag; it pushes to
the *linked* project. The link lives in the gitignored `supabase/.temp/`, so it
survives later checkouts. Confirm it every time:
```bash
cat supabase/.temp/project-ref
```
This must print `haiaaifjcclsvmkfqgmd`.

Refresh the checkout:
```bash
git -C /Users/giorgio/fantasy-stock-deploy fetch origin && git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main
```
Then, from `/Users/giorgio/fantasy-stock-deploy`:
```bash
supabase db push --dry-run
```
```bash
supabase db push
```
Before deploying, check the file content. A single-file function looks identical in
the upload list whether it is stale or fresh, so the list proves nothing. This must
print a count ≥ 1:
```bash
grep -c finalize_league_draft supabase/functions/validate-and-record-pick/index.ts
```
```bash
supabase functions deploy validate-and-record-pick --project-ref haiaaifjcclsvmkfqgmd
```
Promoting this file (the `git mv` into `supabase/migrations/`) is a normal commit
on a branch. It lands on `main` through a merge and is then pushed from the refreshed
deploy checkout, the same way.

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

### `20260929000000_drop_I6_I2b.sql`

Drops the interim policies `[I6]` `league_members_insert_bot` and `[I2b]`
`leagues_update_member_draft_complete`. Retired by
`supabase/functions/draft-control` (mobile draft launch blocker — start a draft
and add bots, which the web-only client-side UPDATE/insert paths made
unreachable once the web app was paused).

**Where to run every step below:** same as the sibling entry above — after
merge to `main`, only from `/Users/giorgio/fantasy-stock-deploy`, confirmed
linked (`cat supabase/.temp/project-ref` prints `haiaaifjcclsvmkfqgmd`),
refreshed with
`git -C /Users/giorgio/fantasy-stock-deploy fetch origin && git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main`,
then `supabase db push --dry-run` and `supabase db push`.

**Precondition: ALL of the following, in order.**
1. `20260926000000_finalize_league_draft_rpc.sql` is applied (check
   `schema_migrations`) and `finalize_league_draft`'s `proacl` shows
   `service_role` only — same check as the sibling entry above.
2. `draft-control` is **deployed**
   (`supabase functions deploy draft-control --project-ref haiaaifjcclsvmkfqgmd`)
   and effect-verified: a no-credential POST reaches our code (401 from the
   function, not the gateway's generic 401 — see CLAUDE.md's verify_jwt
   guidance).
3. `validate-and-record-pick` with the `bot_pick` action (this branch) is
   **deployed**. Content check before deploying, same pattern as the sibling
   entry: `grep -c bot_pick supabase/functions/validate-and-record-pick/index.ts`
   must be ≥ 1.
4. **Effect-verified with a REAL mobile test league**, drafted end-to-end
   through draft-control + validate-and-record-pick alone (no direct
   PostgREST writes), including at least one `bot_pick`-driven pick or skip so
   the bot path is proven, not just asserted:
   ```sql
   SELECT l.draft_status, l.league_start_date, l.league_end_date,
          (SELECT count(*) FROM league_members m WHERE m.league_id = l.id) AS n_members,
          (SELECT count(*) FILTER (WHERE m.user_id LIKE 'bot-%') FROM league_members m WHERE m.league_id = l.id) AS n_bots,
          (SELECT count(*) FROM matchups m WHERE m.league_id = l.id) AS n_matchups
   FROM leagues l WHERE l.id = '<test league id>';
   ```
   `draft_status` must be `completed` with `n_matchups > 0`.
5. No client performs a direct `leagues.update({draft_status: ...})` on the
   member path, or a direct `league_members.insert` of a `bot-*` row. True on
   `main` once this branch merges (mobile routes both through the new
   functions) and true on web today only because it is paused — re-verify this
   bullet specifically if web is ever unpaused before this migration is
   promoted.

**Timestamp note:** same as the sibling entry — if migrations newer than
`20260929000000` are applied before this is promoted, rename it to a fresh
timestamp when promoting instead of passing `--include-all`.

**After applying:** confirm both policies are gone
(`SELECT policyname FROM pg_policies WHERE tablename IN ('leagues','league_members') AND policyname IN ('leagues_update_member_draft_complete','league_members_insert_bot');`
must return zero rows) and re-run the effect-verify query above against a
*second* fresh test league to prove drafting still works with the policies
gone. Then move this section to *History*.

## History

| File | Held for | Resolution |
|---|---|---|
| `20260808000001_drop_broker_credentials.sql` | `quote` still read `broker_credentials`; dropping it would have broken live prices app-wide | `quote` rewired onto the app key (Workstream A); promoted and applied 2026-08-10 |
| `20260810000007_drafts_league_id_set_not_null.sql` | Orphan `drafts` rows with NULL `league_id` would abort the push | Zero NULL rows verified in prod; promoted in `4b3eba2` and applied |

Note that "held for the mobile release" migrations were not always parked here:
`20260811000009_drop_leagues_salary_cap_limit.sql` sat in the apply path with a
"hold" header and was applied by a later `db push`. **A header comment does not hold
a migration — only this directory does.**
