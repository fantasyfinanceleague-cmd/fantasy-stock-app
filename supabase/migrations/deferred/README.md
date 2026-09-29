# Deferred migrations — authored but NOT in the apply path

Files in this directory are **intentionally held out of `supabase db push`.** The
Supabase CLI applies only the timestamped `.sql` files directly in
`supabase/migrations/`; anything in this subdirectory is ignored by `db push`.
Do **not** move a file back to the parent directory until its stated precondition
is met.

**Currently held:** 3 files (see *Held* below): `20260929000000_drop_I6_I2b.sql`, `20261010000001_schedule_draft_autopick_sweep.sql` and `20261013000001_schedule_draft_order_notify.sql`.

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

### `20261010000001_schedule_draft_autopick_sweep.sql`

Schedules `draft_autopick_sweep`, the pick clock's server backstop: every tick
it posts to `draft-autopick-sweep` **only when** `public.overdue_draft_turns()`
returns a row, and that function auto-picks every expired turn in every clocked
live draft. This is what finishes a draft when nobody has the app open.

**Where to run:** the deploy checkout only, refreshed first (see the entry
above and CLAUDE.md).

**Precondition: ALL of the following, in order.**
1. `20261010000000_draft_pick_clock_and_queue.sql` is applied
   (`schema_migrations`), and `overdue_draft_turns`' `proacl` shows
   `service_role` only (the query is at the bottom of that migration).
2. `draft-autopick-sweep` is **deployed**
   (`supabase functions deploy draft-autopick-sweep --project-ref haiaaifjcclsvmkfqgmd`),
   byte-verified against the commit (`supabase functions download`, then diff),
   and a no-credential POST returns the function's own
   `401 {"error":"Unauthorized"}`, not the gateway's generic 401.
3. `validate-and-record-pick` with `action:'auto_pick'` is deployed. Check the
   content first: `grep -c auto_pick supabase/functions/validate-and-record-pick/index.ts`
   must be ≥ 1.
4. **The pg_cron version decides the schedule literal.**
   `SELECT extversion FROM pg_extension WHERE extname = 'pg_cron';` must be
   ≥ 1.5 for `'10 seconds'`. On an older version, change it to `'* * * * *'`
   before promoting (see the file header).
5. A manual run passes: `net.http_post` to the function with the vault
   `cron_apikey`, on a test league with a 30 s clock whose turn is overdue,
   writes a `drafts` row with `pick_source` `auto_*` or `bot`.

**Timestamp note:** if migrations newer than `20261010000001` have been
applied before this is promoted, rename it to a fresh timestamp rather than
passing `--include-all`.

**After applying:** `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_autopick_sweep';`,
then run the data check at the bottom of the file (a test draft with every app
closed keeps advancing, every pick ≥ `pick_seconds` apart). From then on, the
standing stuck-draft check is the query in `docs/migrations/DRAFT_PICK_CLOCK.md`
§Monitoring: any turn more than 2 minutes overdue means that league's sweep is
failing. Then move this section to *History*.

### `20261013000001_schedule_draft_order_notify.sql`

Schedules `draft_order_notify` (every minute). It posts to `draft-order-notify`
**only when** `public.draft_order_notify_due()` is true. That function
finalizes every due draft order nobody has opened, which creates the
"draft order is set" notices in the same transaction. It then delivers the
pending pushes. The order itself never depends on this job, because every read
finalizes lazily; the job owns timeliness and the push.

**Where to run:** the deploy checkout only, refreshed first (see the entries
above and CLAUDE.md).

**Precondition: ALL of the following, in order.**
1. `20261013000000_draft_order_modes.sql` is applied (`schema_migrations`),
   and `docs/security/draft-order-modes-effect-test.sql` returned all PASS.
   `draft_order_notify_due`'s and `finalize_due_draft_orders`' `proacl` show
   `service_role` only.
2. `draft-order-notify` is **deployed**
   (`supabase functions deploy draft-order-notify --project-ref haiaaifjcclsvmkfqgmd`)
   and byte-verified against the commit (`supabase functions download`, then
   diff). The "Uploading asset" list must include `_shared/push.ts`,
   `_shared/cron-auth.ts` and `draft-order-notify/plan.ts`. A no-credential
   POST must return the function's own `401 {"error":"Unauthorized"}`, not the
   gateway's generic 401.
3. A manual run passes: `net.http_post` to the function with the vault
   `cron_apikey`, on a TEST league with 4 members and `draft_date` 30–50
   minutes out. It must set `league_draft_order_meta.state = 'finalized'` and
   settle that league's `league_notifications.push_status` rows (`sent` for a
   1.1.0 device, `no_device` otherwise).
   `net.http_post(... timeout_milliseconds := 30000)` is already proven on
   this `pg_net`: the applied, running `20261005000003_schedule_refresh_market_calendar.sql`
   passes it. The manual run still exercises it before scheduling.

**Timestamp note:** if migrations newer than `20261013000001` have been
applied before this is promoted, rename it to a fresh timestamp rather than
passing `--include-all`.

**After applying:** `SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_order_notify';`,
then run the data check at the bottom of the file. Then move this section to
*History*.

## History

| File | Held for | Resolution |
|---|---|---|
| `20260808000001_drop_broker_credentials.sql` | `quote` still read `broker_credentials`; dropping it would have broken live prices app-wide | `quote` rewired onto the app key (Workstream A); promoted and applied 2026-08-10 |
| `20260810000007_drafts_league_id_set_not_null.sql` | Orphan `drafts` rows with NULL `league_id` would abort the push | Zero NULL rows verified in prod; promoted in `4b3eba2` and applied |
| `20260926000001_drop_client_schedule_insert_policies.sql` | Server-side finalize (PR #14) not yet deployed and effect-verified; web schedule writers still live | Verified by two prod test drafts (test_0925; test_09_25_v2 fully on mobile, PR #20); promoted 2026-09-25 as `20261002000000_drop_client_schedule_insert_policies.sql` (closes F10, retires [I8]/[I9]) |
| `20261005000003_schedule_refresh_market_calendar.sql` | `refresh-market-calendar` not yet deployed/effect-verified; scheduling the cron first would have called a function that didn't exist yet | **Promoted 2026-09-29**, timestamp unchanged (no migration newer than it was applied yet, so no rename needed). All three preconditions met: (1) `20261005000000`–`20261005000002` applied, proacl/relacl verified — `market_session_status` authenticated-only, `apply_market_calendar` service_role-only, `market_calendar`/`market_calendar_coverage` grant `authenticated=r` with no `anon`; (2) `refresh-market-calendar` deployed and byte-identical to `main`, a no-credential POST returned the function's own `401 {"error":"Unauthorized"}` (not the gateway's generic 401), and a manual run via `net.http_post` with the vault `cron_apikey` populated `market_calendar_coverage` `2026-09-22..2026-12-28` (68 sessions), `refreshed_at` 2026-09-29 01:53 UTC — `market_session_status` correctly read "closed / next open: Tue 2026-09-29 09:30"; (3) `docs/security/game-data-asks-effect-test.sql` section #7 gates the push (run after merge, before `db push`, per the Orchestrator). Pushed together with `20261005000004_backfill_missing_user_profiles.sql` in one `db push`, no `--include-all` needed. |

Note that "held for the mobile release" migrations were not always parked here:
`20260811000009_drop_leagues_salary_cap_limit.sql` sat in the apply path with a
"hold" header and was applied by a later `db push`. **A header comment does not hold
a migration — only this directory does.**
