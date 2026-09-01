-- In-house simulator migration (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 1):
-- unschedule the `sync-alpaca-orders` cron job.
--
-- WHY: the sync-alpaca-orders edge function is removed in this branch (it read
-- per-user broker credentials from broker_credentials to sync each user's Alpaca
-- account). The daily cron job scheduled by 20260125200000 and rewritten by
-- 20260618000002 still posts to /functions/v1/sync-alpaca-orders. Left in place,
-- that job would `net.http_post` to a now-deleted function and — because
-- net.http_post is asynchronous — cron.job_run_details would keep logging
-- `succeeded` on enqueue every weekday while the request 404s (the exact
-- success-signal failure mode documented in CLAUDE.md). Unschedule it so no cron
-- targets a deleted function.
--
-- HUMAN ACTION: this migration is authored on branch `remove-alpaca-linking` and
-- is NOT applied here. Giorgio runs `supabase db push` after diff review, then
-- verifies the effect (not the push output):
--   SELECT jobname FROM cron.job WHERE jobname = 'sync-alpaca-orders';
-- -> must return zero rows.
--
-- Idempotent: guarded so a re-run (or an environment where the job was already
-- removed) is a no-op rather than an error.

DO $do$
BEGIN
  PERFORM cron.unschedule('sync-alpaca-orders');
  RAISE NOTICE 'Unscheduled cron job sync-alpaca-orders';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sync-alpaca-orders cron job did not exist, nothing to unschedule';
END
$do$;
