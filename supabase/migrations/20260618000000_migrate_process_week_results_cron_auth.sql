-- Phase 2b-2 (Sub-phase A): Migrate process-week-results cron auth to apikey header.
--
-- process-week-results runs with verify_jwt = false. Before this phase it had NO
-- auth check at all — publicly invocable. It now validates an `apikey` header
-- against SB_SECRET_KEY_CRON in its own code (constant-time, fail-closed). The
-- cron job that invokes it must therefore send the new cron apikey (read from the
-- `cron_apikey` vault secret) instead of the legacy
-- `Authorization: Bearer <service_role_key>` header.
--
-- GOTCHA: the live cron job that calls process-week-results is named
-- `process-weekly-matchups` (NOT `process-week-results`), defined in
-- 20260116000000_matchup_scoring_redesign.sql:118 with schedule '15 21 * * 5'.
-- We unschedule/reschedule that exact name and keep it (no rename).
--
-- This function has only ONE production invocation path (this cron job). The two
-- local test harnesses (scripts/simulation-test-runner.mjs, scripts/simulate-season.sh)
-- are migrated to send the cron apikey directly in the same phase — they are not
-- scheduled DB objects, so they are not touched here.
--
-- The existing `service_role_key` vault secret is left intact (still used by the
-- other 2 cron functions until later sub-phases). This migration only adds use of
-- the NEW `cron_apikey` vault secret (created in Phase 2b-1).

-- ============================================================================
-- Reschedule the process-weekly-matchups cron job with apikey auth.
--   Preserves the original schedule (Friday 21:15 UTC) and job name.
-- ============================================================================

DO $do$
BEGIN
  PERFORM cron.unschedule('process-weekly-matchups');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'process-weekly-matchups cron job did not exist, nothing to unschedule';
END
$do$;

SELECT cron.schedule(
  'process-weekly-matchups',
  '15 21 * * 5',  -- Friday at 21:15 UTC (unchanged from original migration)
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
