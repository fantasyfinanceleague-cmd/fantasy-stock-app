-- DEFERRED (see supabase/migrations/deferred/README.md): schedules
-- draft_order_notify, which finalizes due draft orders on time and delivers
-- the "draft order is set" push. Held until supabase/functions/draft-order-notify
-- is DEPLOYED and effect-verified — promoting it first would leave the cron
-- posting to a 404 every tick while pg_net records a misleading enqueue
-- "success" (CLAUDE.md success signals #2). Requires 20261013000000
-- (draft_order_notify_due, finalize_due_draft_orders) to be applied first.
--
-- The ORDER never depends on this job: every read/write finalizes lazily. The
-- job owns only timeliness (a league nobody opened still finalizes at T−1h)
-- and the push.
--
-- The command posts ONLY WHERE draft_order_notify_due(): a league past its
-- finalize instant with >= 4 members and no finalized order yet, or a pending
-- (or stale 'sending') push. A SELECT with no FROM and a WHERE is a one-time
-- filter, so net.http_post is never evaluated on an idle tick. The function
-- runs as the job owner (postgres); clients may not call it (service_role-only
-- grant in 20261013000000).
--
-- Key from vault.decrypted_secrets ('cron_apikey'), never a literal
-- (CLAUDE.md architecture-map rule; gen-architecture refuses key-shaped text).
-- Explicit timeout_milliseconds (success signals #8): 30s, so
-- net._http_response can show a real outcome for a run that sends up to 50
-- pushes. Still verify by DATA, not by that table.
--
-- CADENCE: every minute. The finalize instant is minute-granular in practice
-- (a lazy read finalizes sooner if anyone opens the app).
select cron.unschedule('draft_order_notify')
 where exists (select 1 from cron.job where jobname = 'draft_order_notify');

select cron.schedule(
  'draft_order_notify',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/draft-order-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where public.draft_order_notify_due();
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_order_notify';
-- Then, on a TEST league with 4 members and draft_date ~70 minutes out, with
-- every app closed, wait ~15 minutes. Verify by DATA:
--   SELECT m.state, m.finalized_at FROM league_draft_order_meta m WHERE m.league_id = '<test league>';
--   -- state = 'finalized', finalized_at within ~1 minute of draft_date - 1h
--   SELECT user_id, push_status, push_attempts, push_error
--     FROM league_notifications WHERE league_id = '<test league>';
--   -- one row per human member; push_status settled (sent / no_device), never
--   -- left 'pending' or 'sending' for more than a couple of ticks.
--   SELECT public.draft_order_notify_due();   -- false once everything settled
