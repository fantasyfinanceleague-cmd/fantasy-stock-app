-- Schedules draft_autopick_sweep, the pick clock's server backstop: every tick it
-- posts to draft-autopick-sweep, which auto-picks every expired turn in every
-- clocked live draft. This is what finishes a draft when nobody has the app open.
-- (Promoted from deferred/ on 2026-10-06 as 20261106000000; was
-- 20261010000001. Runbook: docs/migrations/AUTOPICK_CRON_LIVE.md.)
--
-- RUN ONLY AFTER the live test in that runbook passed (a manual sweep on a 30 s
-- test league wrote auto_*/bot picks), and after its F2 preflight: the moment
-- this lands, EVERY league that is in_progress with pick_clock_enabled = true
-- and an overdue turn is auto-picked to completion and finalized, matchups
-- included. The runbook makes Giorgio decide each such league first.
--
-- The command posts ONLY WHERE EXISTS a turn worth a call: a SELECT with no FROM
-- and a WHERE is a one-time filter, so net.http_post is never evaluated on an
-- idle tick (no edge invocation, no cost). overdue_draft_turns() runs as the job
-- owner (postgres), which may execute it; clients may not (service_role-only
-- grant in 20261010000000).
--
-- STALL THROTTLE (D1). A turn with no legal stock STALLS and stays overdue until
-- someone fixes the league, so without a guard this job would post every 10 s
-- (~8,640 calls/day) per stalled league. The function already refuses to re-run
-- the search for a legality stall seen < 60 s ago (STALL_COOLDOWN_MS in
-- _shared/draft-write.ts, recentStall), so those calls only return 'stalled'.
-- The NOT EXISTS below says the same thing in SQL: skip a turn whose draft_stalls
-- row is a non-vendor_outage stall refreshed within the last 60 s. It matches
-- recentStall exactly, on purpose:
--   * reason = 'vendor_outage' is NOT throttled, because recentStall never
--     short-circuits it either (the outage retries every tick so the draft
--     recovers within seconds of the vendor coming back);
--   * a stalled turn is retried about once a minute (and recordStall refreshes
--     last_seen_at, which re-arms the 60 s window);
--   * a healthy overdue turn has no draft_stalls row, so it posts within 10 s.
-- It only ever NARROWS the post, never widens it. supabase/tests/autopick_cron_wiring.test.ts
-- pins this 60 s to STALL_COOLDOWN_MS, so changing one without the other fails.
--
-- Key from vault.decrypted_secrets ('cron_apikey'), never a literal
-- (CLAUDE.md architecture-map rule; gen-architecture refuses key-shaped text).
--
-- TIMEOUT. timeout_milliseconds := 180000 (above Supabase's 150 s gateway idle
-- timeout), so net._http_response always holds a REAL outcome (the gateway's
-- status) instead of a NULL "Timeout of N ms reached" (CLAUDE.md success signals
-- #8). The value does NOT control overlap: pg_net's timeout only bounds how long
-- pg_net waits to record a response, the edge function runs to completion
-- either way. Overlapping sweeps are safe by construction: every pick write goes
-- through insertGatedPick, whose unique (league_id, pick_number) index lets one
-- writer win (the loser gets pick_conflict and writes nothing), and each sweep
-- re-reads get_draft_clock per league, so a just-recorded pick re-anchors the
-- next turn's clock and the next sweep finds it not overdue. Still verify by
-- DATA (drafts rows, pick_source auto_*/bot), never by net._http_response or
-- cron.job_run_details.
--
-- CADENCE. '10 seconds' needs pg_cron >= 1.5; prod is 1.6 (STATUS.md). On an
-- older version this would fail at push, so re-check
--   SELECT extversion FROM pg_extension WHERE extname = 'pg_cron';
-- and change the literal to '* * * * *' if it ever reports < 1.5. The only
-- effect of the slower schedule is up to ~60 s (instead of ~10 s) of dead air
-- at 0:00 when NO client is connected.
select cron.unschedule('draft_autopick_sweep')
 where exists (select 1 from cron.job where jobname = 'draft_autopick_sweep');

select cron.schedule(
  'draft_autopick_sweep',
  '10 seconds', -- PG_CRON >= 1.5 ONLY; prod is 1.6 (see header)
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
  );
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION, see docs/migrations/AUTOPICK_CRON_LIVE.md):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_autopick_sweep';
-- Then verify by DATA: a test draft with every app closed keeps advancing, every
-- pick at least pick_seconds after the previous one, pick_source auto_* / bot.
