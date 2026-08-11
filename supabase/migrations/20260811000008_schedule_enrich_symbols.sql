-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 4)
-- Schedules the enrich-symbols cron: every 10 minutes, ~50 stalest symbols
-- per run (Finnhub free tier is 60 calls/min, so a daily full pass cannot
-- fit one invocation — see the function header). Initial coverage of the
-- ~14.4k universe completes in ~2 days; steady state re-enriches each
-- symbol on a ~2-day cadence.
--
-- Auth mirrors refresh_symbols_daily post-20260811000000: apikey header from
-- the vault's cron_apikey secret; the function validates it constant-time,
-- fail-closed (verify_jwt=false at the gateway).
--
-- HUMAN ACTION: deploy enrich-symbols FIRST, then supabase db push.
--
-- Effect-verify AFTER push (per CLAUDE.md: pg_net enqueue always
-- "succeeds", so check the cron row, the HTTP responses, and — the real
-- signal — data movement):
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'enrich_symbols_10min';
--   SELECT status_code, count(*) FROM net._http_response
--    GROUP BY 1 ORDER BY 2 DESC LIMIT 5;   -- ~6h TTL window
--   SELECT count(*) FROM symbols WHERE enriched_at IS NOT NULL;  -- must GROW run over run
--   SELECT count(*) FROM symbols WHERE is_draftable;             -- > 0 once large-caps pass

select cron.unschedule('enrich_symbols_10min')
 where exists (select 1 from cron.job where jobname = 'enrich_symbols_10min');

select cron.schedule(
  'enrich_symbols_10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/enrich-symbols',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb
  );
  $$
);
