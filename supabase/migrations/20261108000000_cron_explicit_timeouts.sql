-- Explicit pg_net timeout on every scheduled cron job (CLAUDE.md "Success signals"
-- #8, STATUS.md §4 item 13).
--
-- THE DEFECT: net.http_post's default timeout is 5000 ms and no cron here set one,
-- so for any job that runs longer than 5 s net._http_response recorded
-- "Timeout of 5000 ms reached" with a NULL status while the edge function kept
-- running and finished. A timeout row therefore meant NOTHING: it was written for
-- healthy and broken runs alike, and a monitor reading it could not tell them apart.
--
-- THE RULE: every cron http_post sets timeout_milliseconds := 180000.
-- Supabase answers a request with a 504 if the function has not responded within
-- 150 s (its request idle timeout), so a 180 s client timeout is always LONGER than
-- the platform's own. net._http_response then holds one of two things for every
-- run: the function's real response (status + body), or the gateway's 504. After
-- this migration a "Timeout of 180000 ms reached" row is a pg_net-side fault, no
-- longer a maybe-fine run. The previous values (30 s on refresh_market_calendar_daily,
-- 60 s on the three heal crons) were raised to the same number: a heal on a busy
-- Friday can legitimately outrun 60 s, and one rule is easier to audit than four.
--
-- WHAT THIS DOES NOT FIX: net._http_response has a ~6 h TTL, so it is a same-day
-- signal only. The durable check for every job is still the data it writes (the
-- HUMAN ACTION block lists one query per job). A response also says only that the
-- function answered, not that it did the right thing: success-signals #4/#7 are
-- exactly 200s over refused or empty work.
--
-- WHAT THIS DOES NOT TOUCH: the deferred auto-pick / draft-order-notify crons
-- (deferred/), which already carry timeout_milliseconds := 30000 and are owned by the
-- sweep-promotion work; they should adopt the same 180000 when promoted.
-- The one-shot snapshot retry jobs get the same timeout in 20261108000001.
--
-- SCHEDULE AND BODY ARE UNCHANGED. Each job is replaced BY NAME, with the same
-- schedule and the same command as the live row, plus the timeout. The apikey is
-- read from vault.decrypted_secrets, as in every existing cron; there is no key
-- literal here (scripts/gen-architecture.mjs refuses a key-shaped literal).
-- supabase/tests/cron_timeouts.pglite.test.ts compares every command below with
-- docs/architecture/db-snapshot.json (timeout stripped) and with the heal-cron
-- migrations, so a drifted copy fails a test before it can be pushed.
--
-- The pre-flight below aborts the whole migration, changing nothing, if any job is
-- missing or has a different schedule live. A misnamed job would otherwise be
-- created as a SECOND schedule (cron.schedule on an unknown name inserts), and a
-- missing job means prod has drifted from migrations: stop and look.

DO $preflight$
DECLARE
  r record;
  live text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('process-weekly-matchups', '15 21 * * 5'),
    ('snapshot-week-start', '35 14 * * 1,2'),
    ('snapshot-week-end', '5 21 * * 5'),
    ('enrich_symbols_10min', '*/10 * * * *'),
    ('refresh_symbols_daily', '0 */6 * * *'),
    ('refresh_market_calendar_daily', '20 10 * * *'),
    ('process-weekly-matchups-heal-2200z', '0 22 * * 5'),
    ('process-weekly-matchups-heal-sat', '0 15 * * 6'),
    ('snapshot-week-end-heal', '30 15 * * 1,2')
  ) AS t(jobname, schedule)
  LOOP
    SELECT schedule INTO live FROM cron.job WHERE jobname = r.jobname;
    IF live IS NULL THEN
      RAISE EXCEPTION 'cron job % is not scheduled live; prod has drifted from migrations. Aborting before changing anything.', r.jobname;
    END IF;
    IF live <> r.schedule THEN
      RAISE EXCEPTION 'cron job % is scheduled "%" live but this migration expects "%". Aborting before changing anything.', r.jobname, live, r.schedule;
    END IF;
  END LOOP;
END
$preflight$;

SELECT cron.unschedule('process-weekly-matchups')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-weekly-matchups');

SELECT cron.schedule(
  'process-weekly-matchups',
  '15 21 * * 5',
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('snapshot-week-start')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-week-start');

SELECT cron.schedule(
  'snapshot-week-start',
  '35 14 * * 1,2',
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-start',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('snapshot-week-end')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-week-end');

SELECT cron.schedule(
  'snapshot-week-end',
  '5 21 * * 5',
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/snapshot-week-end',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('enrich_symbols_10min')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enrich_symbols_10min');

SELECT cron.schedule(
  'enrich_symbols_10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/enrich-symbols',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('refresh_symbols_daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_symbols_daily');

SELECT cron.schedule(
  'refresh_symbols_daily',
  '0 */6 * * *',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('refresh_market_calendar_daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_market_calendar_daily');

SELECT cron.schedule(
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
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('process-weekly-matchups-heal-2200z')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-weekly-matchups-heal-2200z');

SELECT cron.schedule(
  'process-weekly-matchups-heal-2200z',
  '0 22 * * 5',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

SELECT cron.unschedule('process-weekly-matchups-heal-sat')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-weekly-matchups-heal-sat');

SELECT cron.schedule(
  'process-weekly-matchups-heal-sat',
  '0 15 * * 6',
  $$
  select net.http_post(
    url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/process-week-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_apikey' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);

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
    timeout_milliseconds := 180000
  );
  $$
);

-- Post-condition, inside the migration: every job is back, on its old schedule, and
-- carries the timeout. (A push that "succeeds" says nothing about the live row; this
-- is the effect check CLAUDE.md asks for, run where it cannot be skipped.)
DO $postcheck$
DECLARE
  r record;
  n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('process-weekly-matchups', '15 21 * * 5'),
    ('snapshot-week-start', '35 14 * * 1,2'),
    ('snapshot-week-end', '5 21 * * 5'),
    ('enrich_symbols_10min', '*/10 * * * *'),
    ('refresh_symbols_daily', '0 */6 * * *'),
    ('refresh_market_calendar_daily', '20 10 * * *'),
    ('process-weekly-matchups-heal-2200z', '0 22 * * 5'),
    ('process-weekly-matchups-heal-sat', '0 15 * * 6'),
    ('snapshot-week-end-heal', '30 15 * * 1,2')
  ) AS t(jobname, schedule)
  LOOP
    SELECT count(*) INTO n FROM cron.job
     WHERE jobname = r.jobname
       AND schedule = r.schedule
       AND command LIKE '%timeout_milliseconds := 180000%';
    IF n <> 1 THEN
      RAISE EXCEPTION 'cron job % is missing, mis-scheduled, or lacks the 180000 ms timeout after rescheduling', r.jobname;
    END IF;
  END LOOP;
END
$postcheck$;

-- ============================================================================
-- HUMAN ACTION (Giorgio) -- from /Users/giorgio/fantasy-stock-deploy per CLAUDE.md
-- (git -C ... fetch origin && git -C ... checkout --detach origin/main first).
--
--   Order: this migration and 20261108000001 are independent of the function
--   deploys, and the function deploys (process-week-results, snapshot-week-start,
--   snapshot-week-end, refresh-market-calendar) are independent of them. Either
--   order is safe. Ship the migrations FIRST if you only want the timeout.
--
--   PRE-PUSH, capture the live rows (this is what the pre-flight compares):
--     SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
--   Diff each command against the one below, ignoring the timeout line. Any
--   difference means the live row is the truth and this file must change first.
--
--   supabase db push --dry-run   (previews only), then supabase db push.
--
--   POST-PUSH, effect not push output:
--     SELECT jobname, schedule, active,
--            substring(command from 'timeout_milliseconds := (\d+)') AS timeout_ms
--       FROM cron.job
--      WHERE command LIKE '%net.http_post%' AND jobname NOT LIKE '%-retry-%'
--      ORDER BY jobname;
--     -> every row timeout_ms = 180000, active = true, schedules as above.
--
--   Then read the first scheduled run's outcome from the response table, within 6 h:
--     SELECT created, status_code, timed_out, error_msg, left(content, 200)
--       FROM net._http_response ORDER BY created DESC LIMIT 20;
--     -> a real status_code (200, or 504 from the gateway), not a NULL status with
--        "Timeout of ... reached".
-- ============================================================================
