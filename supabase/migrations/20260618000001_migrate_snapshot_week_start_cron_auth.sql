-- Phase 2b-2 (Sub-phase B): Migrate snapshot-week-start cron auth to apikey header.
--
-- snapshot-week-start now sets verify_jwt = false and validates an `apikey` header
-- against SB_SECRET_KEY_CRON in its own code (constant-time, fail-closed). Every
-- path that invokes it must send the new cron apikey (read from the `cron_apikey`
-- vault secret) instead of the legacy `Authorization: Bearer <service_role_key>`.
--
-- TWO such paths, both rewritten here:
--   1. the weekly `snapshot-week-start` cron job (Mon/Tue 14:35 UTC)
--   2. schedule_snapshot_retry()'s snapshot-week-start branch (automatic retry)
--
-- schedule_snapshot_retry() is SHARED with snapshot-week-end, whose branch was
-- ALREADY migrated to apikey in Phase 2b-1 (20260612000000). CREATE OR REPLACE
-- swaps the whole function body, so this redefinition carries BOTH branches on
-- apikey — it must NOT drop or alter the already-migrated snapshot-week-end branch.
-- The X-Retry-Attempt header is preserved on the retry POST for both branches.
--
-- After this migration, no snapshot cron path uses the legacy `service_role_key`
-- vault secret. It is left intact (still used by sync-alpaca-orders until Sub-phase
-- C); it becomes orphaned once C lands → Phase 5 cleanup.

-- ============================================================================
-- 1. Reschedule the weekly snapshot-week-start cron job with apikey auth.
--    Preserves the original schedule (Mon+Tue 14:35 UTC) and job name.
-- ============================================================================

DO $do$
BEGIN
  PERFORM cron.unschedule('snapshot-week-start');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'snapshot-week-start cron job did not exist, nothing to unschedule';
END
$do$;

SELECT cron.schedule(
  'snapshot-week-start',
  '35 14 * * 1,2',  -- Monday and Tuesday at 14:35 UTC (unchanged from original migration)
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-start',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 2. schedule_snapshot_retry() — retry path, shared with snapshot-week-end.
--    BOTH branches now use apikey auth (cron_apikey):
--      - snapshot-week-end branch: unchanged from 2b-1 (already apikey).
--      - snapshot-week-start branch: migrated here from legacy Bearer → apikey.
--    The cron_apikey vault secret is read at execution time (not inlined into the
--    scheduled command text). X-Retry-Attempt preserved on both.
-- ============================================================================

CREATE OR REPLACE FUNCTION schedule_snapshot_retry(
  p_job_name TEXT,
  p_attempt INT
)
RETURNS void AS $$
DECLARE
  retry_time TIMESTAMPTZ := NOW() + INTERVAL '5 minutes';
  retry_job_name text := p_job_name || '-retry-' || p_attempt;
BEGIN
  IF p_job_name = 'snapshot-week-end' THEN
    -- New apikey auth (unchanged from Phase 2b-1).
    PERFORM cron.schedule(
      retry_job_name,
      retry_time,
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
    -- Phase 2b-2: migrated from legacy Bearer service_role_key → apikey (cron_apikey).
    PERFORM cron.schedule(
      retry_job_name,
      retry_time,
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

  -- Update status
  INSERT INTO cron_job_status (job_name, status, attempt_number)
  VALUES (p_job_name, 'retrying', p_attempt)
  ON CONFLICT (job_name, run_date)
  DO UPDATE SET status = 'retrying', attempt_number = p_attempt, updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION schedule_snapshot_retry IS
  'Schedule a retry for a failed snapshot job. Phase 2b-2: both snapshot-week-end and snapshot-week-start use apikey (cron_apikey) auth.';
