-- ============================================
-- MATCHUP SCORING SYSTEM REDESIGN
-- ============================================
-- Changes:
-- 1. Week runs Monday open → Friday close (not Tuesday → Friday)
-- 2. Store both start AND end prices in snapshots
-- 3. Support mid-week trade tracking
-- 4. Dollar gain scoring with quantity
-- 5. Retry tracking for cron jobs
-- 6. True ties with 0.5 wins

-- ============================================
-- PHASE 1: SCHEMA CHANGES
-- ============================================

-- Add week_end_price to snapshots table
ALTER TABLE week_snapshots
ADD COLUMN IF NOT EXISTS week_end_price NUMERIC(12,4) NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN week_snapshots.week_start_price IS 'Price at Monday 9:30 AM ET market open';
COMMENT ON COLUMN week_snapshots.week_end_price IS 'Price at Friday 4:00 PM ET market close';

-- Index for efficient trade queries by date range
CREATE INDEX IF NOT EXISTS trades_league_created_idx
ON trades(league_id, created_at);

-- Add is_tie column to matchups
ALTER TABLE matchups
ADD COLUMN IF NOT EXISTS is_tie BOOLEAN DEFAULT FALSE;

-- Update standings to support half-wins (0.5 for ties)
ALTER TABLE league_standings
ALTER COLUMN wins TYPE NUMERIC(5,1),
ALTER COLUMN losses TYPE NUMERIC(5,1),
ALTER COLUMN ties TYPE NUMERIC(5,1);

-- Create retry tracking table for cron jobs
CREATE TABLE IF NOT EXISTS cron_job_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'retrying')),
  attempt_number INT DEFAULT 1,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One status per job per day
  UNIQUE(job_name, run_date)
);

-- Enable RLS on cron_job_status
ALTER TABLE cron_job_status ENABLE ROW LEVEL SECURITY;

-- Only service role can access cron status
CREATE POLICY "service_role_only" ON cron_job_status
FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- PHASE 2: UPDATE CRON SCHEDULES
-- ============================================

-- Remove old schedules (ignore errors if they don't exist)
DO $$
BEGIN
  PERFORM cron.unschedule('snapshot-week-start');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('snapshot-week-end');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('process-weekly-matchups');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule snapshot-week-start: Monday 9:35 AM ET (14:35 UTC)
-- Also runs Tuesday in case Monday was a holiday
SELECT cron.schedule(
  'snapshot-week-start',
  '35 14 * * 1,2',  -- Monday and Tuesday at 14:35 UTC
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-start',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Schedule snapshot-week-end: Friday 4:05 PM ET (21:05 UTC)
SELECT cron.schedule(
  'snapshot-week-end',
  '5 21 * * 5',  -- Friday at 21:05 UTC
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Schedule process-weekly-matchups: Friday 4:15 PM ET (21:15 UTC)
-- Runs after snapshot-week-end completes
SELECT cron.schedule(
  'process-weekly-matchups',
  '15 21 * * 5',  -- Friday at 21:15 UTC
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================
-- PHASE 3: HELPER FUNCTIONS
-- ============================================

-- Trigger week-end snapshot manually
CREATE OR REPLACE FUNCTION trigger_week_end_snapshot()
RETURNS bigint AS $$
DECLARE
  request_id bigint;
  supabase_url text := 'https://haiaaifjcclsvmkfqgmd.supabase.co';
  service_key text;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  SELECT net.http_post(
    url := supabase_url || '/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  ) INTO request_id;

  RETURN request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule a retry for a failed job
CREATE OR REPLACE FUNCTION schedule_snapshot_retry(
  p_job_name TEXT,
  p_attempt INT
)
RETURNS void AS $$
DECLARE
  retry_time TIMESTAMPTZ := NOW() + INTERVAL '5 minutes';
  service_key text;
  function_name text;
BEGIN
  -- Determine which function to call
  IF p_job_name = 'snapshot-week-start' THEN
    function_name := 'snapshot-week-start';
  ELSIF p_job_name = 'snapshot-week-end' THEN
    function_name := 'snapshot-week-end';
  ELSE
    RAISE EXCEPTION 'Unknown job name: %', p_job_name;
  END IF;

  -- Get service key
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  -- Schedule one-time retry job
  PERFORM cron.schedule(
    p_job_name || '-retry-' || p_attempt,
    retry_time,
    format(
      $sql$
      SELECT net.http_post(
        url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/%s',
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
      function_name,
      service_key,
      p_attempt,
      p_job_name || '-retry-' || p_attempt
    )
  );

  -- Update status
  INSERT INTO cron_job_status (job_name, status, attempt_number)
  VALUES (p_job_name, 'retrying', p_attempt)
  ON CONFLICT (job_name, run_date)
  DO UPDATE SET status = 'retrying', attempt_number = p_attempt, updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON FUNCTION trigger_week_end_snapshot IS
  'Manually trigger Friday close snapshot. Use this for testing or to recover from missed runs.';

COMMENT ON FUNCTION schedule_snapshot_retry IS
  'Schedule a retry for a failed snapshot job. Called by edge functions on failure.';

COMMENT ON TABLE cron_job_status IS
  'Tracks the status of cron job runs for monitoring and retry logic.';
