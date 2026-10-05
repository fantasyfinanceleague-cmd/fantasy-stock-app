-- B2 (snapshot jobs hardening): make an S9 refusal RECOVERABLE the same week.
--
-- snapshot-week-end runs only on Friday (21:05Z, plus its own retries). An S9
-- refusal (a holder with no baseline row, or no marker) recovers when week-start's
-- Monday heal writes the baseline and the marker, and that alone does not close the
-- week. Without this job the close waited for the next Friday.
--
-- This schedules a second week-end run on Monday and Tuesday at 15:30Z, after
-- week-start's 14:35Z run. It is idempotent by construction:
--   - week-end targets only CLOSED league-weeks that are not WHOLLY scored (week-select.ts).
--     A partly scored week stays a target so its unscored matchups can be healed; its
--     close writes are per participant and idempotent;
--   - a closed week that is already fully closed is skipped by the coverage gate;
--   - a week that is still refused just refuses again, loudly.
-- On a normal week it is a no-op, since Friday's run scored it. It only does work
-- where a refused close can now proceed.
--
-- BEHAVIOUR CHANGE (intended, with refresh-market-calendar LOOKBACK_DAYS 7 -> 120):
-- calendar coverage now reaches ~120 days back, so UNSCORED past weeks of in-season
-- leagues can be baselined, closed and scored on the next Friday (retroactive
-- scoring). In prod today this is a no-op: the live leagues' past weeks are scored,
-- and the August leagues have no matchups. A week older than the lookback that is
-- still unscored refuses 'no_coverage' loudly on every run.
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
      -- Attempt 3 = the function's MAX_RETRIES: an incomplete heal fails loudly
      -- instead of scheduling 'snapshot-week-end-retry-2', which would replace a
      -- pending Friday retry of the same name (pg_cron replaces by name).
      'X-Retry-Attempt', '3',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb,
    -- pg_net's 5 s default is shorter than a run; the outcome is read from the data
    -- the job writes, not from net._http_response (CLAUDE.md success-signal #8).
    timeout_milliseconds := 60000
  );
  $$
);
