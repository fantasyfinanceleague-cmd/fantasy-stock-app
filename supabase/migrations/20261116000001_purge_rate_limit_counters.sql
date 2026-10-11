-- Daily purge of the rate limiter's counters (public.rate_limit_counters).
--
-- WHY: check_and_bump_rate_limit writes one row per (bucket, subject, window).
-- Until 2026-10-08 only preview-league and join-league used it, so the table
-- grew slowly. The market-data guards (security/market-data-guards-fns) bump it
-- on EVERY quote / historical-bars / ticker-quotes call, and check_usernames
-- (20261116000000) bumps two windows per call: Home alone polls quote and
-- historical-bars every 30 s, about two new rows a minute per active player.
-- Nothing in this repo deleted from the table, so it would grow without bound.
--
-- WHAT IS SAFE TO DELETE: a counter only matters while its window is current.
-- The longest window any caller uses is 3600 s (check_usernames' hourly
-- bucket), so any row whose window_start is more than an hour old is dead. Two
-- days keeps a generous margin and some history for diagnosing a lockout
-- ("why did this user get 429s yesterday?").
--
-- THIS JOB IS PLAIN SQL, the same shape as purge_cron_run_details
-- (20261106000001): a DELETE, no pg_net call, no HTTP request, no key or vault
-- read, so the explicit timeout_milliseconds rule for HTTP-posting schedules
-- does not apply. It runs as the job owner (postgres), which owns the table
-- (RLS is enabled with no policies; the owner is not subject to it).
-- Re-running this migration is harmless: the schedule is replaced by name.
--
-- The delete scans by window_start, which is the third column of the primary
-- key, so it is a sequential scan. Run once a day over a table that is purged
-- daily, that is cheap; an index on window_start would instead tax every
-- limiter bump on every price call, so none is added.
--
-- Verify after push:
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'purge_rate_limit_counters';
-- and the next day, that it ran and the oldest row is recent:
--   SELECT min(window_start) FROM public.rate_limit_counters;   -- EXPECT within ~2 days
select cron.unschedule('purge_rate_limit_counters')
 where exists (select 1 from cron.job where jobname = 'purge_rate_limit_counters');

select cron.schedule(
  'purge_rate_limit_counters',
  '37 4 * * *',
  $$ delete from public.rate_limit_counters where window_start < now() - interval '2 days' $$
);
