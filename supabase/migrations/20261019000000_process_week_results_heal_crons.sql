-- S7 fix (docs/audits/2026-09-30-week-window-audit.md): two additional
-- process-week-results invocations so a batch refused because
-- snapshot-week-end's Friday retry chain is still running (or just finished)
-- at the primary 21:15Z scorer cron gets re-attempted, rather than staying
-- stuck until next Friday's cron (CLAUDE.md "guards keyed on all-or-nothing
-- state" — a refusal must be recoverable; without this, S8's cascade turns
-- one stuck week into every following week having no baseline).
--
-- THE BUG THIS BACKSTOPS: before this fix, a user with a week_snapshots row
-- but no week_end_price yet (snapshot-week-end hasn't finished closing the
-- week) was scored 'legacy' — from LIVE prices, ignoring every mid-week
-- trade, written irreversibly. That code was removed
-- (supabase/functions/process-week-results/index.ts's calculateWeeklyGainLegacy);
-- such a user is now 'close_incomplete' and the matchup is REFUSED instead
-- (team1_gain stays NULL). These two crons are what makes that refusal heal
-- itself rather than wait a week.
--
-- process-week-results is idempotent and cheap to over-invoke: it re-selects
-- ONLY matchups with team1_gain IS NULL
-- (`.is('team1_gain', null).lt('week_end', now)`, index.ts), so a run that
-- finds nothing pending is one 200 response with no writes. These crons are
-- NOT a replacement for the primary 15 21 * * 5 (21:15Z) schedule — they
-- exist only to heal whatever it refused.
--
-- TIMING: snapshot-week-end retries at +5 min per attempt (schedule_snapshot_retry,
-- 20260727000000), up to MAX_RETRIES = 3, so it reaches a terminal state
-- (closed, or permanently failed on an unpriceable symbol) by roughly 21:20Z
-- in the worst realistic case. 22:00Z leaves ~40 minutes of headroom over
-- that. The Saturday run is a second-chance backstop for a longer outage
-- (e.g. Alpaca down past the whole Friday retry chain) — belt-and-suspenders,
-- not the primary recovery path.
--
-- timeout_milliseconds is set explicitly from the start (CLAUDE.md "success
-- signals" #8 — pg_net's 5000ms default cannot show this function's true
-- outcome once it processes multiple leagues; net._http_response would show
-- a timeout on every run regardless of what the function actually did).
-- STATUS.md §4 item 13 tracks retrofitting the OTHER crons that predate this
-- lesson; these two are authored with it from the start, same precedent as
-- refresh_market_calendar_daily (20261005000003).

select cron.unschedule('process-weekly-matchups-heal-2200z')
 where exists (select 1 from cron.job where jobname = 'process-weekly-matchups-heal-2200z');

select cron.schedule(
  'process-weekly-matchups-heal-2200z',
  '0 22 * * 5',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

select cron.unschedule('process-weekly-matchups-heal-sat')
 where exists (select 1 from cron.job where jobname = 'process-weekly-matchups-heal-sat');

select cron.schedule(
  'process-weekly-matchups-heal-sat',
  '0 15 * * 6',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ============================================================================
-- HUMAN ACTION (Giorgio) — from /Users/giorgio/fantasy-stock-deploy per
-- CLAUDE.md (refresh the deploy checkout first: git fetch origin && git
-- checkout --detach origin/main there).
--
-- This migration must land, AND the process-week-results code deploy (S7's
-- scoring-eligibility.ts / index.ts changes) must go out, BEFORE
-- Fri 2026-10-02 21:15Z — that is the first real scored week and the first
-- chance for S7 to bite. Deploy the FUNCTION before or together with this
-- migration; the migration alone adds no protection if the deployed function
-- still runs the old calculateWeeklyGainLegacy path.
--
--   PRE-PUSH: supabase db push --dry-run, then supabase db push.
--   POST-PUSH (effect, not push output):
--     SELECT jobname, schedule, active FROM cron.job
--      WHERE jobname IN ('process-weekly-matchups-heal-2200z', 'process-weekly-matchups-heal-sat')
--      ORDER BY jobname;
--     -> both rows present, active = true,
--        schedule = '0 22 * * 5' / '0 15 * * 6' respectively.
--
--   VERIFY BY DATA the Friday after deploy (not by cron.job_run_details or
--   net._http_response — CLAUDE.md "success signals" #2/#8):
--     SELECT league_id, week_number, reason, matchup_id FROM (
--       -- if the deployed code logs skipped[] anywhere queryable; otherwise
--       -- check matchups directly for the week that just ended:
--       SELECT id AS matchup_id, league_id, week_number, team1_gain
--         FROM matchups
--        WHERE week_end >= now() - interval '2 days'
--          AND week_end < now()
--     ) x WHERE team1_gain IS NULL;
--     -- Any NULL row after Saturday's heal run should be a GENUINE backstop
--     -- case (a permanently unpriceable symbol) or a league with no snapshots
--     -- at all — not a transient S7 race that should have healed by then.
-- ============================================================================
