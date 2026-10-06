-- Re-schedules draft_autopick_sweep so the SAME 10 s job also starts due drafts
-- (draft auto-start, 2026-10-06; plan: docs/migrations/DRAFT_AUTO_START_PLAN.md §1).
-- Only the post guard widens: same job name, URL, cadence, vault key, timeout
-- and body as 20261106000000 (whose header explains each of them). No other
-- cron job is touched.
--
-- PROVISIONAL TIMESTAMP (20261109000000-09 range). ORDERING IS LOAD-BEARING:
-- this MUST be applied AFTER 20261106000000 (ops/autopick-cron-live). That file
-- unschedules and re-schedules the same job name, so if it ran second it would
-- silently revert the job to overdue-only and no draft would ever auto-start.
-- Timestamp order gives that for free on a normal `db push`; do NOT pass
-- --include-all to push 20261106000000 after this one. Re-stamp both together
-- if either moves. supabase/tests/draft_auto_start_cron_wiring.test.ts fails if
-- the LATEST migration scheduling 'draft_autopick_sweep' lacks either guard.
-- Requires 20261109000000 (due_draft_starts) in the same or an earlier push.
--
-- THE GUARD: post when there is an overdue turn worth a call (20261106000000's
-- predicate, VERBATIM, stall throttle included) OR a draft due to start
-- (public.due_draft_starts(): draft_date reached, inside the start grace, not
-- blocked in the last 60 s). Both are one-time filters over a SELECT with no
-- FROM, so an idle tick still makes no edge call. The 60 s back-off on blocked
-- starts lives inside due_draft_starts (draft_start_blocks.last_seen_at), the
-- same throttle shape as the stall NOT EXISTS below.
--
-- Verify by DATA, never by cron.job_run_details / net._http_response (CLAUDE.md
-- success signals #2/#8): a test league's draft_status flips to in_progress
-- with draft_started_at within ~15 s of draft_date.
select cron.unschedule('draft_autopick_sweep')
 where exists (select 1 from cron.job where jobname = 'draft_autopick_sweep');

select cron.schedule(
  'draft_autopick_sweep',
  '10 seconds', -- PG_CRON >= 1.5 ONLY; prod is 1.6 (see 20261106000000)
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/draft-autopick-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  )
  where exists (
    select 1
      from public.overdue_draft_turns() o
     where not exists (
       select 1
         from public.draft_stalls s
        where s.league_id = o.league_id
          and s.pick_number = o.pick_number
          and s.reason <> 'vendor_outage'
          and s.last_seen_at > now() - interval '60 seconds'
     )
  )
     or exists (select 1 from public.due_draft_starts());
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_autopick_sweep';
--   -- command contains BOTH overdue_draft_turns() and due_draft_starts()
-- Then, on a TEST league with 4 members and draft_date ~62 minutes out, every
-- app closed, wait past draft_date. Verify by DATA:
--   SELECT draft_status, draft_date, draft_started_at, draft_started_at - draft_date AS lag
--     FROM leagues WHERE id = '<test league>';
--   -- in_progress, lag well under 15 s (one tick + the start pass)
--   SELECT * FROM draft_start_blocks WHERE league_id = '<test league>';   -- no row
