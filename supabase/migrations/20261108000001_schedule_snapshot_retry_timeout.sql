-- schedule_snapshot_retry: give the one-shot retry jobs the same explicit pg_net
-- timeout as every other cron (20261108000000; CLAUDE.md "Success signals" #8).
--
-- WHY A SEPARATE FILE: the retry jobs are not in cron.job until a snapshot run fails,
-- so they cannot be rescheduled by name; they are CREATED by this function's body.
-- Replacing the function is the only way to change what they will contain.
--
-- WHAT CHANGED vs the live definition (20260727000000): ONLY
-- `timeout_milliseconds := 180000` in each of the two generated commands. Everything
-- else is copied verbatim, including the ordering from the success-signals #3 fix:
-- the 'retrying' INSERT stays AFTER the cron.schedule PERFORM, so a retry that
-- could not be scheduled raises instead of recording a 'retrying' row for it
-- (20260727000000). `SET search_path = public` is carried forward explicitly because
-- CREATE OR REPLACE resets proconfig. Privileges are NOT reset by CREATE OR
-- REPLACE (service_role-only grants from 20260718000002 survive), but the HUMAN
-- ACTION below verifies them anyway, as CLAUDE.md requires.
--
-- No behavior or semantics change: same job names, same schedule expression, same
-- X-Retry-Attempt header, same vault apikey lookup, same status write.

CREATE OR REPLACE FUNCTION schedule_snapshot_retry(
  p_job_name TEXT,
  p_attempt INT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public          -- carried forward from 20260724000002
AS $$
DECLARE
  retry_at        TIMESTAMPTZ := NOW() + INTERVAL '5 minutes';
  retry_job_name  TEXT := p_job_name || '-retry-' || p_attempt;
  -- pg_cron reads schedules in cron.timezone (default GMT). Read it rather than
  -- assuming UTC; the `true` second argument makes a missing GUC return NULL
  -- instead of raising.
  cron_tz         TEXT := coalesce(nullif(current_setting('cron.timezone', true), ''), 'GMT');
  -- Five-field cron: minute hour day-of-month month day-of-week.
  -- FM strips the zero padding to_char would otherwise emit ('05' -> '5').
  retry_schedule  TEXT := to_char(retry_at AT TIME ZONE cron_tz, 'FMMI FMHH24 FMDD FMMM') || ' *';
BEGIN
  IF p_job_name = 'snapshot-week-end' THEN
    PERFORM cron.schedule(
      retry_job_name,
      retry_schedule,
      format(
        $sql$
        SELECT net.http_post(
          url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1),
            'X-Retry-Attempt', '%s'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 180000
        );
        -- Clean up this one-time job
        SELECT cron.unschedule('%s');
        $sql$,
        p_attempt,
        retry_job_name
      )
    );

  ELSIF p_job_name = 'snapshot-week-start' THEN
    PERFORM cron.schedule(
      retry_job_name,
      retry_schedule,
      format(
        $sql$
        SELECT net.http_post(
          url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-start',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1),
            'X-Retry-Attempt', '%s'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 180000
        );
        -- Clean up this one-time job
        SELECT cron.unschedule('%s');
        $sql$,
        p_attempt,
        retry_job_name
      )
    );

  ELSE
    RAISE EXCEPTION 'Unknown job name: %', p_job_name;
  END IF;

  -- Status write. Unchanged in position, but note it is only reachable now that
  -- the PERFORM above stops raising — which is precisely why this defect left no
  -- row behind for three migrations.
  INSERT INTO cron_job_status (job_name, status, attempt_number)
  VALUES (p_job_name, 'retrying', p_attempt)
  ON CONFLICT (job_name, run_date)
  DO UPDATE SET status = 'retrying', attempt_number = p_attempt, updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION schedule_snapshot_retry IS
  'Schedule a one-shot retry for a failed snapshot job, 5 minutes out. Passes a '
  'five-field cron expression (formatted in cron.timezone) — passing a TIMESTAMPTZ '
  'matched no cron.schedule overload and raised on every call from 20260116000000 '
  'until 20260727000000. apikey (cron_apikey) auth on both branches.';


-- ============================================================================
-- HUMAN ACTION (Giorgio) -- from the deploy checkout, after the dry run.
--
--   PRE-PUSH: confirm the live body is the 20260727000000 definition this file was
--   copied from (the snapshot records only its ACL and search_path, not its body):
--     SELECT pg_get_functiondef('public.schedule_snapshot_retry(text,int)'::regprocedure);
--   Any difference besides the two timeout lines means live is the truth: stop.
--
--   POST-PUSH, effect not push output:
--     SELECT proname, proacl, proconfig FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND proname = 'schedule_snapshot_retry';
--     -> proacl = {postgres=X/postgres,service_role=X/postgres} (no anon, no
--        authenticated, no PUBLIC); proconfig = {search_path=public}.
--
--     SELECT prosrc LIKE '%timeout_milliseconds := 180000%' FROM pg_proc
--      WHERE proname = 'schedule_snapshot_retry';   -> true
--
--   The retry path is exercised only by a real snapshot failure. Verify by data the
--   next time one happens: the generated one-shot job's command carries the
--   timeout, and cron_job_status shows 'retrying' (never absent) for that run:
--     SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE '%-retry-%';
--     SELECT job_name, run_date, status, attempt_number FROM cron_job_status
--      WHERE status = 'retrying' ORDER BY updated_at DESC LIMIT 5;
-- ============================================================================
