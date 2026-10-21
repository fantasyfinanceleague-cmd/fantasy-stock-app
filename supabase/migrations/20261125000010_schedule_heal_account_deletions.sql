-- Hourly heal for interrupted account deletions
-- (docs/plans/2026-10-21-account-deletion.md §"Heal pass").
--
-- WHAT A RUN DOES (supabase/functions/heal-account-deletions):
--   1. heal_account_deletions(p_limit := 25) (W2, 20261125000000-09): re-runs the
--      scrub for ledger rows stuck at 'requested' (returning each scrub's result in
--      scrub_results so the function can push its notices), settles stale
--      apple_revoke 'required' rows and pending revokes older than 7 days as
--      'unrevoked', purges 'done' rows after 7 days, and REPORTS the auth users
--      still to delete (at most p_limit, oldest first) and the Apple revokes to
--      retry.
--   2. The function deletes each reported auth user (account_deletion_mark_done
--      then verifies auth.users no longer has it) and retries each pending Apple
--      revoke from vault, dropping the vault entry once it is revoked.
--
-- THE GUARD posts ONLY WHERE heal_account_deletions_due() (W2): true iff there is a
-- 'requested' row older than 10 minutes, any 'scrubbed' row, any 'pending' Apple
-- revoke, a 'required' row older than 10 minutes, or a purgeable 'done' row. A SELECT with no FROM and a WHERE is a one-time filter, so an idle hour
-- makes no edge call. It runs as the job owner (postgres); clients may not call it
-- (service_role-only grant).
--
-- Key from vault.decrypted_secrets ('cron_apikey'), never a literal
-- (CLAUDE.md architecture-map rule; gen-architecture refuses key-shaped text).
-- TIMEOUT 180000 ms, the repo rule since 20261108000000 (cron_timeouts guard):
-- above the 150 s gateway idle timeout, so net._http_response holds a real
-- outcome. Still verify by DATA (account_deletions), never by that table or
-- cron.job_run_details: net.http_post is async, so run_details says 'succeeded'
-- on enqueue, whatever the function answered.
--
-- PRECONDITIONS: W2's migrations (20261125000000-09) applied, so
-- heal_account_deletions_due() exists (plpgsql resolves names at run time, so a
-- missing function would create this job cleanly and fail every hour); and the
-- heal-account-deletions function deployed from the SAME commit (byte-verified:
-- the upload list must include _shared/account-deletion.ts,
-- _shared/account-deletion-db.ts, _shared/apple-revoke.ts, _shared/jwt-claims.ts,
-- _shared/cron-auth.ts, _shared/job-status-io.ts, _shared/job-status.ts, _shared/run-job.ts,
-- _shared/deletion-notices.ts, _shared/notice-delivery.ts, _shared/push.ts).
select cron.unschedule('heal_account_deletions')
 where exists (select 1 from cron.job where jobname = 'heal_account_deletions');

select cron.schedule(
  'heal_account_deletions',
  '23 * * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/heal-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  )
  where public.heal_account_deletions_due();
  $$
);

-- Effect-verify AFTER push (HUMAN ACTION):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'heal_account_deletions';
--   SELECT public.heal_account_deletions_due();   -- returns false on a clean system, no error
-- Then the BY-DATA check (docs/testing/account-deletion-effect-test.md §6): after
-- an interrupted deletion, the next :23 pass leaves its account_deletions row at
-- stage 'done' (or the row is gone after the 7-day purge), and no auth.users row.
