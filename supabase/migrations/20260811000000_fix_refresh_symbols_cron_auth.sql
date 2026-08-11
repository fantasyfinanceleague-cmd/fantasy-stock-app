-- fix(cron): add apikey auth to refresh_symbols_daily
--
-- The cron had NO auth header and has been silently failing with 401 since
-- ~May 1: cron.job_run_details showed "succeeded" (pg_net enqueue succeeds
-- regardless), while net._http_response showed 401 Unauthorized and
-- symbols.updated_at proved zero effect. The June cron-auth migrations
-- (20260618000001/2) fixed the snapshot/sync crons but missed this one.
--
-- Fix mirrors the working sibling (snapshot-week-start): apikey header read
-- from the vault's cron_apikey secret.
--
-- Applied ad hoc in prod 2026-08-11 (new jobid 23); this migration records
-- it in the repo. Re-applying is idempotent (unschedule + reschedule).
-- Effect-verified: manual invoke returned 200; 949 symbols touched and
-- ~950 new listings backfilled (13,458 -> 14,407 rows).

select cron.unschedule('refresh_symbols_daily');

select cron.schedule(
  'refresh_symbols_daily',
  '0 */6 * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb
  );
  $$
);
