-- DEFERRED (see supabase/migrations/deferred/README.md): schedules
-- refresh_market_calendar_daily. Held until supabase/functions/
-- refresh-market-calendar is DEPLOYED and effect-verified — promoting this
-- before the function exists would leave the cron calling a 404 every day
-- while reporting a misleading net._http_response, which is precisely the
-- "logs success, does nothing" shape ask #7 exists to avoid (CLAUDE.md
-- "success signals are unreliable" #2, #8).
--
-- Explicit timeout_milliseconds (CLAUDE.md "success signals" #8): pg_net's
-- 5000ms default means net._http_response cannot show this job's true
-- outcome once the Alpaca fetch + apply_market_calendar round trip runs
-- past it; 30s covers it with headroom. No other cron in this repo sets
-- this yet (STATUS.md §4 item 13 tracks retrofitting the rest) — this is the
-- first one authored with it from the start.
select cron.unschedule('refresh_market_calendar_daily')
 where exists (select 1 from cron.job where jobname = 'refresh_market_calendar_daily');

select cron.schedule(
  'refresh_market_calendar_daily',
  '20 10 * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-market-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
