-- Daily purge of pg_cron's own run log (cron.job_run_details).
--
-- WHY: pg_cron writes one job_run_details row for EVERY run of EVERY job,
-- including runs whose command did nothing. draft_autopick_sweep fires every
-- 10 s and its WHERE EXISTS filters the HTTP post out on an idle tick, but the
-- tick itself is still logged: ~8,640 rows/day from that one job, forever, in
-- a table nothing in this repo trims. Nothing reads rows older than a week
-- (CLAUDE.md: this table only records the ENQUEUE, never the outcome, so we
-- verify by data, not by it).
--
-- THIS JOB IS PLAIN SQL: a DELETE, with no pg_net call and no HTTP request. The
-- rule that every HTTP-posting schedule passes an explicit timeout_milliseconds
-- therefore does not apply to it, and there is no key or vault read here.
--
-- It deletes by coalesce(end_time, start_time), so a run that never finished
-- (end_time NULL: a crashed backend) is purged too, while a run genuinely in
-- flight is days from the cutoff and never touched. 7 days keeps a week of
-- history for the standing stuck-draft and "did the job run" checks. Weekly
-- jobs' outcomes are carried by cron_job_status, not by this table. The delete runs as the job owner (postgres), which
-- owns the table. Re-running this migration is harmless: the schedule is
-- replaced by name. Verify:
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'purge_cron_run_details';
select cron.unschedule('purge_cron_run_details')
 where exists (select 1 from cron.job where jobname = 'purge_cron_run_details');

select cron.schedule(
  'purge_cron_run_details',
  '17 4 * * *',
  $$ delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '7 days' $$
);
