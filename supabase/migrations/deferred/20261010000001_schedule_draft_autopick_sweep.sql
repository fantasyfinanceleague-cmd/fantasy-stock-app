-- DEFERRED (see supabase/migrations/deferred/README.md): schedules
-- draft_autopick_sweep, the pick clock's server backstop. Held until
-- supabase/functions/draft-autopick-sweep is DEPLOYED and effect-verified —
-- promoting it first would leave the cron posting to a 404 every tick while
-- pg_net records a misleading enqueue "success" (CLAUDE.md success signals #2).
-- Requires 20261010000000 (overdue_draft_turns) to be applied first.
--
-- The command posts ONLY WHERE EXISTS an overdue turn: a SELECT with no FROM
-- and a WHERE is a one-time filter, so net.http_post is never evaluated on an
-- idle tick — no edge invocation, no cost, when no clocked draft is overdue.
-- overdue_draft_turns() runs as the job owner (postgres), which may execute
-- it; clients may not (service_role-only grant in 20261010000000).
--
-- Key from vault.decrypted_secrets ('cron_apikey'), never a literal
-- (CLAUDE.md architecture-map rule; gen-architecture refuses key-shaped text).
-- Explicit timeout_milliseconds (success signals #8): 30s so
-- net._http_response can show a real outcome for a sweep that prices several
-- candidates. Still verify by DATA, not by that table.
--
-- CADENCE — PG_CRON VERSION DEPENDENT (H0: SELECT extversion FROM pg_extension
-- WHERE extname = 'pg_cron'). '10 seconds' needs pg_cron >= 1.5 (interval
-- schedules). If prod reports < 1.5, change the schedule literal below to
-- '* * * * *' before promoting; the only effect is up to ~60s (instead of
-- ~10s) of dead air at 0:00 when NO client is connected — connected clients
-- fire auto_pick themselves within ~1.5s either way.
select cron.unschedule('draft_autopick_sweep')
 where exists (select 1 from cron.job where jobname = 'draft_autopick_sweep');

select cron.schedule(
  'draft_autopick_sweep',
  '10 seconds', -- PG_CRON >= 1.5 ONLY; else '* * * * *' (see header)
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/draft-autopick-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from public.overdue_draft_turns());
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_autopick_sweep';
-- Then, on a TEST league with pick_seconds = 30 and every app closed, start
-- the draft and wait. Verify by DATA:
--   SELECT pick_number, user_id, symbol, pick_source, recorded_at,
--          recorded_at - lag(recorded_at) OVER (ORDER BY pick_number) AS gap
--     FROM drafts WHERE league_id = '<test league>' ORDER BY pick_number;
--   -- picks keep arriving with pick_source auto_* / bot, every gap >= 30s
--   -- (and < 30s + one cron interval + pricing time).
