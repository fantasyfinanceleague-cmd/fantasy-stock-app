-- Phase 2b-2 (Sub-phase C): Migrate sync-alpaca-orders cron auth to apikey header.
--
-- sync-alpaca-orders now sets verify_jwt = false (a true->false FLIP — it was
-- previously JWT-verified) and validates an `apikey` header against
-- SB_SECRET_KEY_CRON in its own code (constant-time, fail-closed). The cron job
-- must therefore send the new cron apikey (read from the `cron_apikey` vault
-- secret) instead of the legacy `Authorization: Bearer <service_role_key>` header.
--
-- This function is cron-only in practice (no client invokes it; its user-authed
-- verify/sync modes are now USER-UNREACHABLE — Phase 5 dead-code cleanup). The
-- single production invocation path is this daily cron job, rewritten below.
--
-- CRITICAL: preserve the body `{"mode":"sync-all"}`. Without it the function
-- defaults to mode 'sync', which requires a user JWT and would return
-- not_authenticated on an apikey-only (cron) call.
--
-- After this migration, NO cron job uses the legacy `service_role_key` vault
-- secret — it is now orphaned (left intact here; removed in Phase 5).

-- ============================================================================
-- Reschedule the sync-alpaca-orders cron job with apikey auth.
--   Preserves the original schedule (weekdays 21:30 UTC), job name, and
--   the {"mode":"sync-all"} body.
-- ============================================================================

DO $do$
BEGIN
  PERFORM cron.unschedule('sync-alpaca-orders');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sync-alpaca-orders cron job did not exist, nothing to unschedule';
END
$do$;

SELECT cron.schedule(
  'sync-alpaca-orders',
  '30 21 * * 1-5',  -- Mon-Fri at 21:30 UTC (unchanged from original migration)
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/sync-alpaca-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{"mode": "sync-all"}'::jsonb
  );
  $$
);
