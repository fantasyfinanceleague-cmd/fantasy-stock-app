-- Phase 2b-1: Migrate snapshot-week-end cron auth from legacy JWT to apikey header.
--
-- snapshot-week-end now sets verify_jwt = false and validates an `apikey` header
-- against SB_SECRET_KEY_CRON in its own code. Every path that invokes it must
-- therefore send the new cron apikey (read from the `cron_apikey` vault secret)
-- instead of the legacy `Authorization: Bearer <service_role_key>` header.
--
-- There are THREE such paths, all rewritten here:
--   1. the weekly `snapshot-week-end` cron job
--   2. trigger_week_end_snapshot()  (manual recovery helper)
--   3. schedule_snapshot_retry()    (automatic retry path)
--
-- schedule_snapshot_retry() is SHARED with snapshot-week-start, which stays on
-- legacy auth until Phase 2b-2. So only its snapshot-week-end branch is migrated;
-- the snapshot-week-start branch keeps the legacy Bearer service_role_key header.
--
-- The existing `service_role_key` vault secret is left intact (still used by the
-- other 3 cron functions). This migration only adds use of the NEW `cron_apikey`
-- vault secret, which the user created in Phase 2b-1 step 2.

-- ============================================================================
-- 1. Reschedule the weekly snapshot-week-end cron job with apikey auth.
--    Preserves the original schedule (Friday 21:05 UTC) and job name.
-- ============================================================================

DO $do$
BEGIN
  PERFORM cron.unschedule('snapshot-week-end');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'snapshot-week-end cron job did not exist, nothing to unschedule';
END
$do$;

SELECT cron.schedule(
  'snapshot-week-end',
  '5 21 * * 5',  -- Friday at 21:05 UTC (unchanged from original migration)
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 2. trigger_week_end_snapshot() — manual recovery helper. Now sends apikey.
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_week_end_snapshot()
RETURNS bigint AS $$
DECLARE
  request_id bigint;
  supabase_url text := 'https://haiaaifjcclsvmkfqgmd.supabase.co';
  cron_key text;
BEGIN
  SELECT decrypted_secret INTO cron_key
  FROM vault.decrypted_secrets
  WHERE name = 'cron_apikey'
  LIMIT 1;

  SELECT net.http_post(
    url := supabase_url || '/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', cron_key
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RETURN request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 3. schedule_snapshot_retry() — retry path, shared with snapshot-week-start.
--    snapshot-week-end branch: new apikey auth (cron_apikey).
--    snapshot-week-start branch: UNCHANGED legacy Bearer service_role_key.
-- ============================================================================

CREATE OR REPLACE FUNCTION schedule_snapshot_retry(
  p_job_name TEXT,
  p_attempt INT
)
RETURNS void AS $$
DECLARE
  retry_time TIMESTAMPTZ := NOW() + INTERVAL '5 minutes';
  service_key text;
  retry_job_name text := p_job_name || '-retry-' || p_attempt;
BEGIN
  IF p_job_name = 'snapshot-week-end' THEN
    -- New apikey auth. The cron_apikey vault secret is read at execution time
    -- (not inlined into the scheduled command text).
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
    -- Legacy auth, UNCHANGED — snapshot-week-start migrates in Phase 2b-2.
    SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

    PERFORM cron.schedule(
      retry_job_name,
      retry_time,
      format(
        $sql$
        SELECT net.http_post(
          url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-start',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer %s',
            'X-Retry-Attempt', '%s'
          ),
          body := '{}'::jsonb
        );
        -- Clean up this one-time job
        SELECT cron.unschedule('%s');
        $sql$,
        service_key,
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

COMMENT ON FUNCTION trigger_week_end_snapshot IS
  'Manually trigger Friday close snapshot. Phase 2b-1: uses apikey (cron_apikey) auth.';

COMMENT ON FUNCTION schedule_snapshot_retry IS
  'Schedule a retry for a failed snapshot job. Phase 2b-1: snapshot-week-end uses apikey auth; snapshot-week-start remains on legacy Bearer until 2b-2.';
