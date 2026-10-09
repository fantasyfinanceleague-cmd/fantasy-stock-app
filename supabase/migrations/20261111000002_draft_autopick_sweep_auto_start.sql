-- Re-schedules draft_autopick_sweep so the SAME 10 s job also runs draft
-- auto-start (2026-10-06; plan + Giorgio's decisions:
-- docs/migrations/DRAFT_AUTO_START_PLAN.md): it watches scheduled leagues (the
-- commissioner's early warning), gates them at room-open time (postpone if
-- blocked), and starts them at their draft time.
-- Only the post guard widens: same job name, URL, cadence, vault key, timeout
-- and body as 20261106000000 (whose header explains each of them). No other
-- cron job is touched.
--
-- PROVISIONAL TIMESTAMP (20261111000000-09 range). ORDERING IS LOAD-BEARING:
-- this MUST be applied AFTER 20261106000000 (ops/autopick-cron-live). That file
-- unschedules and re-schedules the same job name, so if it ran second it would
-- silently revert the job to overdue-only and no draft would ever auto-start.
-- Timestamp order gives that for free on a normal `db push`; do NOT pass
-- --include-all to push 20261106000000 after this one. Re-stamp both together
-- if either moves. supabase/tests/draft_auto_start_cron_wiring.test.ts fails if
-- the LATEST migration scheduling 'draft_autopick_sweep' lacks either guard.
-- Requires 20261111000000 (due_draft_starts, draft_watch_due) in the same or an
-- earlier push.
--
-- THE GUARD: post when there is an overdue turn worth a call (20261106000000's
-- predicate, VERBATIM, stall throttle included) OR a draft at/past its time
-- (public.due_draft_starts(), not postponed) OR a league to watch/gate
-- (public.draft_watch_due(): a changed or stale verdict, a reminder due, or the
-- gate window) — the latter two wrapped in public.draft_auto_start_work_due(),
-- which returns false on any runtime error, so a fault in the new lists can
-- never take down the overdue (auto-pick) half of this statement. All are
-- one-time filters over a SELECT with no FROM, so an idle tick still makes no
-- edge call. draft_watch_due only lists a league whose
-- inputs changed, whose verdict is older than 5 min inside 24 h, or that is in
-- its gate window, so a quiet scheduled league costs nothing between changes.
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
     or public.draft_auto_start_work_due();
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_autopick_sweep';
--   -- command contains overdue_draft_turns() and draft_auto_start_work_due()
-- Then the live checks in docs/migrations/DRAFT_AUTO_START_PLAN.md (BUILD v2):
-- a clear test league opens its room at T-1h and starts at T; a blocked one is
-- postponed at the gate. Verify by DATA (leagues.draft_status / draft_started_at,
-- draft_start_watch, draft_postponements, league_notifications).
