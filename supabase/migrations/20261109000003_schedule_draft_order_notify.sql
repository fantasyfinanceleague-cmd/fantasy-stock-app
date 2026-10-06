-- Schedules draft_order_notify (every minute). PROMOTED 2026-10-06 from
-- deferred/20261013000001 by draft auto-start (docs/migrations/DRAFT_AUTO_START_PLAN.md):
-- the "draft room is open" push (T-1h, with your position) now rides this job,
-- so auto-start needs it. Re-stamped into the 20261109 range (never
-- --include-all an old stamp).
--
-- WHAT A RUN DOES (supabase/functions/draft-order-notify):
--   1. open_due_draft_rooms() (20261109000000): every league the auto-start
--      gate cleared whose room time has come gets its order finalized and a
--      'draft_room_open' notice per human; late joiners get theirs.
--   2. finalize_due_draft_orders() (#67/#126): on-time finalize for every other
--      due league. Its 'draft_order_set' rows are in-app records now (their push
--      is marked skipped at insert, 20261109000000), so this sends nothing.
--   3. Deliver pending draft_room_open / draft_started / draft_at_risk /
--      draft_postponed pushes (built at send time from draft_notice_context).
--
-- THE GUARD posts ONLY WHERE draft_room_notices_due() (20261109000000): a room
-- to open, a late joiner owed a notice, or a pending push of a kind this
-- function delivers. NOT #126's draft_order_notify_due(): that is true for ANY
-- pending kind but member_left (e.g. #94's renewal_*, delivered elsewhere), so it
-- could post every minute forever; and its other half (a due unfinalized
-- league) no longer needs this job, since every scheduled league is gated and
-- opened by open_due_draft_rooms. A SELECT with no FROM and a WHERE is a
-- one-time filter, so an idle tick makes no edge call. It runs as the job owner
-- (postgres); clients may not call it (service_role-only grant).
--
-- Key from vault.decrypted_secrets ('cron_apikey'), never a literal
-- (CLAUDE.md architecture-map rule; gen-architecture refuses key-shaped text).
-- TIMEOUT 180000 ms, the repo rule since 20261108000000 (cron_timeouts guard):
-- above the 150 s gateway idle timeout, so net._http_response holds a real
-- outcome. Still verify by DATA (league_notifications.push_status), never by
-- that table or cron.job_run_details.
--
-- PRECONDITIONS (were the deferred README's; met by this release): 20261013000000
-- applied (yes, 2026-09-29); draft-order-notify deployed from THIS branch
-- (byte-verified; the upload list must include _shared/push.ts,
-- _shared/cron-auth.ts, draft-order-notify/plan.ts) BEFORE this push, or the
-- job posts to the old function, which ignores the new kinds.
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
    timeout_milliseconds := 180000
  )
  where public.draft_room_notices_due();
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'draft_order_notify';
--   SELECT public.draft_room_notices_due();   -- returns, no error
-- Then the live test in DRAFT_AUTO_START_PLAN.md: at T-1h the test league has
-- draft_start_watch.room_opened_at set, one 'draft_room_open' row per human, and
-- every push_status settled (sent / no_device), never left pending.
