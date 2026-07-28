-- ============================================================================
-- FIX: schedule_snapshot_retry has never scheduled a retry. Not once.
-- ============================================================================
--
-- THE DEFECT
-- The function declares
--     retry_time TIMESTAMPTZ := NOW() + INTERVAL '5 minutes';
-- and then calls
--     PERFORM cron.schedule(retry_job_name, retry_time, format(...));
--
-- cron.schedule has exactly two overloads:
--     cron.schedule(schedule text, command text)
--     cron.schedule(job_name text, schedule text, command text)
-- There is no timestamptz variant, and PostgreSQL removed implicit
-- datetime -> text casts in 8.3. So the call resolves to no function and raises
--     function cron.schedule(text, timestamp with time zone, text) does not exist
-- on EVERY invocation.
--
-- WHY IT SURVIVED THREE MIGRATIONS LOOKING HEALTHY
-- PL/pgSQL does not resolve called-function names at CREATE FUNCTION time — only
-- when the line executes. The function therefore created cleanly in
-- 20260116000000, 20260612000000 and 20260618000001, and nothing ever exercised
-- the failing path in a way anyone saw. Confirmed against the LIVE database
-- (prosrc + pg_proc overload list), not from migration text.
--
-- WHY IT LEFT NO TRACE
-- The `INSERT INTO cron_job_status ... 'retrying'` sits AFTER the PERFORM, and a
-- PL/pgSQL function body is atomic — the raise aborts the status write too. So a
-- failed retry-schedule wrote no row anywhere. cron_job_status has zero rows with
-- status='retrying', which corroborates this and is structurally expected.
-- (An empty cron.job for '%-retry-%' proves nothing either way: the scheduled
-- command unschedules itself, so empty is consistent with both "never scheduled"
-- and "ran and cleaned up". The overload list is the proof, not the job table.)
--
-- WHY THIS MATTERS MORE THAN THE 21:15 COLLISION IT MAKES MOOT
-- The all-or-nothing design in snapshot-week-start (2caf9f8) explicitly depends on
-- retries: abort the league's write, let the existing retry re-attempt, skip only
-- on provable completeness. The abort half works. The recovery half has never run.
-- A league that aborts writes nothing and waits for the next Mon/Tue cron.
--
-- THE FIX
-- Format the retry instant as a five-field cron expression instead of passing a
-- timestamp. Everything else — the command strings, the self-unschedule, the
-- vault lookup, the X-Retry-Attempt header, the branch structure — is unchanged.
--
-- TIMEZONE (verify, do not assume)
-- pg_cron interprets schedules in `cron.timezone`, which defaults to GMT. This
-- function reads that setting at runtime rather than hardcoding UTC, so it stays
-- correct if the GUC is ever changed. current_setting(..., true) returns NULL
-- when the GUC is absent, so the coalesce also covers pg_cron builds that do not
-- expose it. See the HUMAN ACTION block for how to confirm on this database.
--
-- MONTH/DAY ROLLOVER
-- Handled by construction: the future INSTANT is computed first and the whole
-- expression is formatted from that single value. A retry at 23:58 on 31 Jan
-- yields '3 0 1 2 *' (00:03 on 1 Feb), not an invalid 31 Feb. Formatting the
-- time from the future instant but the date from NOW() is the bug this avoids.
-- A cron expression carries no year, but the scheduled command unschedules
-- itself on first run, so it cannot recur next year.
--
-- SEARCH_PATH
-- CREATE OR REPLACE FUNCTION resets proconfig, which would silently drop the
-- `SET search_path = public` pin applied by 20260724000002. It is carried forward
-- explicitly below. (Privileges are NOT reset by CREATE OR REPLACE, so the
-- service_role-only grants from 20260718000002 survive untouched — verify anyway
-- with the proacl query in the HUMAN ACTION block, per CLAUDE.md.)
-- ============================================================================

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
          body := '{}'::jsonb
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
          body := '{}'::jsonb
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
-- HUMAN ACTION — Giorgio only. Nothing below is applied by this migration.
-- ============================================================================
--
-- 1. Preview, then apply:
--      supabase db push --dry-run
--      supabase db push
--    (--dry-run only PREVIEWS; the real push must follow. Per CLAUDE.md, verify
--     the live state afterwards rather than trusting the push output.)
--
-- 2. Confirm the timezone assumption on THIS database:
--      SHOW cron.timezone;
--    If it errors or returns empty, the coalesce default of GMT applies. If it
--    returns something other than GMT/UTC, the function still adapts — but sanity
--    check step 3's scheduled time against your wall clock before trusting it.
--
-- 3. Prove the fix end to end. This SCHEDULES A REAL RETRY, so do it when an
--    extra snapshot run is harmless (the snapshot functions are idempotent per
--    league-week, but pick a quiet window anyway):
--
--      SELECT schedule_snapshot_retry('snapshot-week-start', 99);
--      SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE '%retry%';
--      SELECT job_name, status, attempt_number, updated_at
--        FROM cron_job_status WHERE status = 'retrying';
--
--    EXPECTED: the first SELECT returns without error (before this migration it
--    raised "function cron.schedule(text, timestamp with time zone, text) does
--    not exist"); the second shows one job named 'snapshot-week-start-retry-99'
--    with a schedule like '3 0 1 2 *' about 5 minutes from now; the third shows a
--    'retrying' row, which has NEVER existed in this database before.
--
--    Then clean up so the test retry does not actually fire:
--      SELECT cron.unschedule('snapshot-week-start-retry-99');
--
-- 4. Confirm the grants survived CREATE OR REPLACE (they should — it does not
--    reset privileges — but CLAUDE.md says verify, never assume):
--      SELECT proname, proacl FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'schedule_snapshot_retry';
--    EXPECTED: {postgres=X/postgres,service_role=X/postgres} — no anon, no
--    authenticated.
--
-- 5. Confirm the search_path pin survived:
--      SELECT proname, proconfig FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND proname = 'schedule_snapshot_retry';
--    EXPECTED: {search_path=public}
--
-- 6. Re-capture docs/architecture/db-snapshot.json afterwards — this changes a
--    function definition and (if step 3 leaves anything behind) cron.job.
-- ============================================================================
