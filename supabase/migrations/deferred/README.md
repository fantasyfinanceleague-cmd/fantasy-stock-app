# Deferred migrations — authored but NOT in the apply path

Files in this directory are **intentionally held out of `supabase db push`.** The
Supabase CLI applies only the timestamped `.sql` files directly in
`supabase/migrations/`; anything in this subdirectory is ignored by `db push`.
Do **not** move a file back to the parent directory until its stated precondition
is met.

**Currently held:** 2 files (see *Held* below): `20260929000000_drop_I6_I2b.sql` and `20261105000008_drop_start_new_league_season.sql`.

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

### `20261105000008_drop_start_new_league_season.sql`

Drops `start_new_league_season(uuid)`. Phase 0 of Run it back
(`20261023000000_lock_start_new_league_season.sql`) already revoked EXECUTE
from PUBLIC, anon, authenticated and service_role, so the function is
unreachable from every API role; this removes it for good. Design:
`docs/migrations/RUN_IT_BACK_DESIGN.md` §3.

**Where to run:** only from `/Users/giorgio/fantasy-stock-deploy`, refreshed
with
`git -C /Users/giorgio/fantasy-stock-deploy fetch origin && git -C /Users/giorgio/fantasy-stock-deploy checkout --detach origin/main`,
then `supabase db push --dry-run` (must list exactly this file) and
`supabase db push`.

**Precondition: ALL of the following.**
1. `20261023000000` is applied (`schema_migrations`), and the function's
   `proacl` is exactly `{postgres=X/postgres}`:
   ```sql
   SELECT proname, proacl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'start_new_league_season';
   ```
2. **No shipped client calls it.** The mobile build that removes the
   `league-settings.tsx` "Start New Season" button (and its
   `rpc('start_new_league_season')`) is the one testers have installed, and no
   older build (1.0.0, 1.1.0) is still in use. Check on `main` first:
   `grep -rn start_new_league_season apps/` must return nothing.
3. Nothing server-side calls it:
   `grep -rn start_new_league_season supabase/functions scripts` returns
   only comments (today: `scripts/gen-architecture.mjs` annotations, which
   should be removed in the same PR that promotes this file, then
   `node scripts/gen-architecture.mjs` re-run).

**Timestamp note:** if migrations newer than `20261105000008` have been
applied before this is promoted, rename it to a fresh timestamp rather than
passing `--include-all`.

**After applying:** the proacl query above must return zero rows. Then
re-capture `docs/architecture/db-snapshot.json` and move this section to
*History*. (`supabase/tests/season_result.pglite.test.ts` keeps slicing the
function from the historical `20260718000000` file, which is never
rewritten, so it is unaffected.)

## History

| File | Held for | Resolution |
|---|---|---|
| `20260808000001_drop_broker_credentials.sql` | `quote` still read `broker_credentials`; dropping it would have broken live prices app-wide | `quote` rewired onto the app key (Workstream A); promoted and applied 2026-08-10 |
| `20260810000007_drafts_league_id_set_not_null.sql` | Orphan `drafts` rows with NULL `league_id` would abort the push | Zero NULL rows verified in prod; promoted in `4b3eba2` and applied |
| `20260926000001_drop_client_schedule_insert_policies.sql` | Server-side finalize (PR #14) not yet deployed and effect-verified; web schedule writers still live | Verified by two prod test drafts (test_0925; test_09_25_v2 fully on mobile, PR #20); promoted 2026-09-25 as `20261002000000_drop_client_schedule_insert_policies.sql` (closes F10, retires [I8]/[I9]) |
| `20261013000001_schedule_draft_order_notify.sql` | `draft-order-notify` not yet deployed/effect-verified | **Promoted 2026-10-06 by draft auto-start** as `20261111000003_schedule_draft_order_notify.sql` (re-stamped; guard widened with `draft_room_notices_due()`; `timeout_milliseconds := 180000` per `20261108000000`). The "draft room is open" push rides it. Its deploy + byte-verify precondition moved into that file's header and `docs/migrations/DRAFT_AUTO_START_PLAN.md`. |
| `20261005000003_schedule_refresh_market_calendar.sql` | `refresh-market-calendar` not yet deployed/effect-verified; scheduling the cron first would have called a function that didn't exist yet | **Promoted 2026-09-29**, timestamp unchanged (no migration newer than it was applied yet, so no rename needed). All three preconditions met: (1) `20261005000000`–`20261005000002` applied, proacl/relacl verified — `market_session_status` authenticated-only, `apply_market_calendar` service_role-only, `market_calendar`/`market_calendar_coverage` grant `authenticated=r` with no `anon`; (2) `refresh-market-calendar` deployed and byte-identical to `main`, a no-credential POST returned the function's own `401 {"error":"Unauthorized"}` (not the gateway's generic 401), and a manual run via `net.http_post` with the vault `cron_apikey` populated `market_calendar_coverage` `2026-09-22..2026-12-28` (68 sessions), `refreshed_at` 2026-09-29 01:53 UTC — `market_session_status` correctly read "closed / next open: Tue 2026-09-29 09:30"; (3) `docs/security/game-data-asks-effect-test.sql` section #7 gates the push (run after merge, before `db push`, per the Orchestrator). Pushed together with `20261005000004_backfill_missing_user_profiles.sql` in one `db push`, no `--include-all` needed. |
| `20261010000001_schedule_draft_autopick_sweep.sql` | Live test of the sweep (precondition 5) | **Promoted as `20261106000000` (applied: PENDING the HUMAN ACTION `db push`; record the date here once it is)** (stall throttle + explicit 180000 ms timeout added), together with `20261106000001_purge_cron_run_details.sql` (new) and the SKIP trigger below, after the live test in `docs/migrations/AUTOPICK_CRON_LIVE.md`. Verification and the post-promotion data check are in that runbook. |
| `20261101000002_drafts_refuse_new_skip.sql` | The sweep cron had to be live first (stall recovery for bots relies on it), and had to be re-stamped later than prod's latest applied migration | **Promoted as `20261106000002` (applied: PENDING `db push`)**, body unchanged, in the same release as the cron. Effect check: `docs/security/refuse-new-skip-effect-test.sql`. |

Note that "held for the mobile release" migrations were not always parked here:
`20260811000009_drop_leagues_salary_cap_limit.sql` sat in the apply path with a
"hold" header and was applied by a later `db push`. **A header comment does not hold
a migration — only this directory does.**
