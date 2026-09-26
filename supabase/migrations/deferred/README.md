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
| `20260926000001_drop_client_schedule_insert_policies.sql` | Server-side finalize (PR #14) not yet deployed and effect-verified; web schedule writers still live | Verified by two prod test drafts (test_0925; test_09_25_v2 fully on mobile, PR #20); promoted 2026-09-25 as `20261002000000_drop_client_schedule_insert_policies.sql` (closes F10, retires [I8]/[I9]) |

Note that "held for the mobile release" migrations were not always parked here:
`20260811000009_drop_leagues_salary_cap_limit.sql` sat in the apply path with a
"hold" header and was applied by a later `db push`. **A header comment does not hold
a migration — only this directory does.**
