-- B2 (snapshot jobs hardening): make an S9 refusal RECOVERABLE the same week.
--
-- snapshot-week-end runs only on Friday (21:05Z, plus its own retries). An S9
-- refusal (a holder with no baseline row, or no marker) recovers when week-start's
-- Monday heal writes the baseline and the marker, and that alone does not close the
-- week. Without this job the close waited for the next Friday.
--
-- This schedules a second week-end run on Monday and Tuesday at 15:30Z, after
-- week-start's 14:35Z run. It is idempotent by construction:
--   - week-end targets only CLOSED, UNSCORED league-weeks (week-select.ts);
--   - a closed week that is already fully closed is skipped by the coverage gate;
--   - a week that is still refused just refuses again, loudly.
-- On a normal week it is a no-op, since Friday's run scored it. It only does work
-- where a refused close can now proceed.
--
-- The schedule is replaced by name, so re-running this migration is harmless. The
-- apikey comes from vault, as in every other snapshot cron, with no key literal.
--
-- MANUAL FALLBACK (if the heal did not run, or to force one): POST
--   https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end
-- with the cron apikey header, from the SQL editor via net.http_post, or run the
-- same call from an operator shell. Check cron_job_status afterwards.

SELECT cron.unschedule('snapshot-week-end-heal')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-week-end-heal');

SELECT cron.schedule(
  'snapshot-week-end-heal',
  '30 15 * * 1,2',
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
