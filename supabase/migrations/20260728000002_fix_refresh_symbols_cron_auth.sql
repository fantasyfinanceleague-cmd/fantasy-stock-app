-- ============================================================================
-- Fix refresh_symbols_daily: add vault apikey auth, reconcile name vs schedule
-- ============================================================================
-- ⛔ THIS MIGRATION IS INCOMPLETE ON ITS OWN. SETTLED 2026-07-30 — no curl needed.
--
-- The dashboard's own description of the toggle resolves it:
--   "Verify JWT with legacy secret — Requires a JWT signed only by the legacy
--    secret in the Authorization header. The anon key satisfies this."
--
-- So verify_jwt inspects the AUTHORIZATION header for a JWT signed by the legacy
-- secret. Two consequences, both fatal to a header-only fix:
--   1. An `apikey` header cannot satisfy it AT ALL — wrong header, wrong
--      mechanism. The job's problem was never "no apikey"; it is that an apikey
--      is not a JWT.
--   2. Even in the right header it would fail, because `cron_apikey` holds a
--      new-format sb_secret_… key. Those are opaque strings, not JWTs, so they
--      cannot be signed by the legacy secret by construction.
-- (User SESSION JWTs are signed by the project JWT secret, which is why client
--  calls to verify_jwt=true functions work and a cron job's cannot.)
--
-- WHY THE FOUR WORKING CRON JOBS DO NOT PROVE THE PATTERN TRANSFERS: all four
-- target verify_jwt=FALSE functions. With platform JWT verification off, their
-- apikey header is consumed by each function's OWN constant-time
-- SB_SECRET_KEY_CRON guard — an in-code check, not a gateway one. The pattern is
-- a package: flag OFF **and** header **and** in-code guard. refresh-symbols has
-- the flag ON and no guard, so a header alone lands nowhere.
--
-- ===========================================================================
-- HUMAN ACTION — REVISED 2026-07-30 for branch security/claude-security-fixes.
--
-- THIS MIGRATION IS NOW THE ONLY REMAINING PIECE. It was originally written on
-- branch item4-fix-refresh-symbols-cron as part C of a three-part fix, with a
-- strict guard-before-flip sequence. Parts A and B have since landed on THIS
-- branch as scan finding F5:
--   A. config.toml already reads verify_jwt = false for refresh-symbols.
--   B. refresh-symbols/index.ts already carries the constant-time, fail-closed
--      SB_SECRET_KEY_CRON guard (verified byte-identical to the part-B version).
-- So the old ordered block is obsolete and has been replaced — do not follow a
-- copy of it from item4, which still assumes config.toml says `true`.
--
-- THE ORDERING HAZARD IS ALSO DIFFERENT NOW, and milder. The original sequence
-- needed care because the flag and the guard were being introduced SEPARATELY:
-- flipping first would have left the function publicly callable until the guard
-- deployed. Here they are in the SAME deploy — config.toml carries the flag and
-- index.ts carries the guard — so a single `functions deploy` lands both
-- atomically. There is no window between them by construction.
--
--   1. DEPLOY THE FUNCTION (this is F5's deploy step; applies flag + guard):
--        supabase functions deploy refresh-symbols
--
--   2. PROVE THE true->false FLIP TOOK — this is the gate, not the deploy log.
--        curl -i -X POST '<fn-url>' -H 'Content-Type: application/json' -d '{}'
--      Expect OUR {"error":"Unauthorized"} 401 — our guard running, meaning the
--      gateway has stepped aside. If you get the platform's
--      UNAUTHORIZED_NO_AUTH_HEADER instead, the flip did NOT take: per CLAUDE.md
--      a true->false flip may need a REDEPLOY. Redeploy, confirm the dashboard
--      Verify-JWT toggle reads OFF, and retry before continuing.
--      ⚠️ Until this gate passes the function is NOT yet reachable by the cron,
--      so step 3 cannot be validated. Do not skip ahead.
--
--   3. PUSH THIS MIGRATION:  supabase db push
--      NOTE it will also apply the three pending 20260730* migrations (F1, F6,
--      F12) — db push applies ALL pending files, not just this one. Per the
--      deploy checklist in docs/security/REMAINING-SECURITY-WORK.md, F12 requires
--      `place-order` to be DEPLOYED FIRST or trades briefly fail to record. So
--      either deploy place-order before this push, or push before deploying it
--      and accept that gap knowingly.
--
--   4. CONFIRM THE LIVE JOB ACTUALLY CHANGED (never trust the push output):
--        SELECT jobid, jobname, schedule, command FROM cron.job
--        WHERE jobname = 'refresh_symbols_daily';
--      Expect schedule '0 6 * * *' and `command` containing apikey/cron_apikey.
--      A stale command means the push did not take.
--
--   5. PROVE END-TO-END — the part cron.job_run_details CANNOT tell you, because
--      net.http_post is async and records the enqueue, not the response. Fire it
--      manually with the real key and read net._http_response per the
--      VERIFICATION block at the bottom of this file. Expect status_code 200.
--
--   6. RE-CAPTURE THE SNAPSHOT: after all Supabase changes, re-run
--      docs/architecture/db-snapshot.sql and `node scripts/gen-architecture.mjs`.
--      The drift panel stays red — and refresh_symbols_daily keeps showing as the
--      only job without an apikey header — until this is done.
-- ===========================================================================
--
-- WHY THIS IS CORRECT DESPITE RLS_HARDENING_SPEC B2 RECORDING IT AS REVERTED:
-- B2 rejected the cron-apikey-guard pattern for refresh-symbols on the grounds
-- that it is "a user-invoked function", for which a cron guard is the wrong
-- shape. That premise was true when written and is now false: grep finds NO
-- client caller of refresh-symbols anywhere in apps/ — the only invoker is this
-- cron job. A guard keyed to the cron secret is therefore exactly right for what
-- the function has become. Update B2 and L7 when A+B land rather than leaving two
-- contradictory decisions on record.
--   Note the trade-off B2 was protecting against still exists in a different
--   form: verify_jwt=true currently makes refresh-symbols callable by ANY
--   authenticated user (L7, cost-abuse). Flipping to false + cron guard does not
--   widen that — it NARROWS it, from any-authenticated to cron-only.
--
-- The reschedule mechanics below (unschedule/schedule, header construction,
-- daily cadence) were reviewed and are correct and reversible regardless of how
-- the gate resolves — only the AUTH MECHANISM is in question.
-- ============================================================================
-- THE DEFECT: the job posts with `headers := '{"Content-Type":"application/json"}'`
-- and nothing else — no `apikey`, no `Authorization`. refresh-symbols declares
-- `verify_jwt = true` (supabase/config.toml), so the Supabase gateway rejects
-- every run with 401 BEFORE the function body executes. The symbols table has
-- therefore not been refreshed by this job since verify_jwt was set.
--
-- WHY NOBODY NOTICED: net.http_post is ASYNCHRONOUS. cron.job_run_details
-- records that the request was ENQUEUED (return_message '1 row' is the request
-- id), never what the server answered. Five consecutive runs read 'succeeded'
-- while every one of them 401'd. This is CLAUDE.md silent-failure #2 — do not
-- use cron.job_run_details to judge whether a cron HTTP call worked.
--
-- WHY THE MIGRATION SWEEP MISSED IT: no migration in this repo ever scheduled
-- this job. It was created out-of-band against prod (jobid 7, versus 18-21 for
-- the Phase 2b cron-auth-migrated set), so a sweep over supabase/migrations/
-- could not see it. A consequence worth stating plainly: any environment
-- rebuilt from migrations alone does not have this job AT ALL. This migration
-- also fixes that — it is the first time the job exists in version control.
--
-- ---------------------------------------------------------------------------
-- NAME vs SCHEDULE — the job is named `_daily` but ran '0 */6 * * *' (every 6h).
-- RESOLVED IN FAVOUR OF THE NAME: schedule becomes daily, name is preserved.
-- Reasoning:
--   * The payload is NASDAQ/NYSE ticker reference data. Listings change at most
--     once a day; four fetches a day cannot surface data that does not exist yet.
--   * Each run is an external fetch plus a ~12,525-row upsert. Running it 4x
--     daily is 4x the third-party quota and DB write volume for no new data —
--     and RLS_HARDENING_SPEC L7 already flags refresh-symbols as a cost-abuse
--     surface, so reducing frequency is aligned with that, not against it.
--   * The NAME records the original intent. The 6-hour cadence has the shape of
--     a debugging leftover that was never reverted.
--   * Renaming instead would keep the 4x cost AND orphan the existing
--     `cron.refresh_symbols_daily` annotation key in docs/architecture.
-- 06:00 UTC = ~01:00-02:00 ET: after overnight listing files settle, well before
-- the 09:30 ET open.
-- ---------------------------------------------------------------------------
--
-- AUTH PATTERN: identical to the four jobs migrated in Phase 2b — the apikey is
-- read from the `cron_apikey` vault secret at RUN time, never inlined. NOTE the
-- asymmetry against those four: they target verify_jwt=false functions whose own
-- constant-time apikey guard is the auth boundary. refresh-symbols is
-- verify_jwt=TRUE, so here the gateway itself validates the key and the function
-- has no in-code guard. Same header, different enforcement point.
-- ============================================================================

-- Unschedule defensively: the job exists in prod (out-of-band, jobid 7) but does
-- NOT exist in an environment rebuilt from migrations. Both must succeed.
DO $do$
BEGIN
  PERFORM cron.unschedule('refresh_symbols_daily');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'refresh_symbols_daily cron job did not exist, nothing to unschedule';
END
$do$;

SELECT cron.schedule(
  'refresh_symbols_daily',
  '0 6 * * *',  -- daily 06:00 UTC (was '0 */6 * * *' — see NAME vs SCHEDULE above)
  $$
  SELECT net.http_post(
    url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- VERIFICATION (run AFTER `supabase db push`)
--
-- 1. Live job definition now carries the apikey header and the daily schedule:
--
--    SELECT jobid, jobname, schedule, active, command
--    FROM cron.job WHERE jobname = 'refresh_symbols_daily';
--
--    Expect: schedule '0 6 * * *', and `command` containing
--    'apikey' + 'cron_apikey'. A stale command means the push did not take.
--
-- 2. Prove it now AUTHENTICATES — this is the part cron.job_run_details cannot
--    tell you. net._http_response holds roughly a 6h TTL, so this must be run
--    shortly after a firing. To avoid waiting for 06:00 UTC, fire it manually
--    first (this is the same statement the job runs):
--
--    SELECT net.http_post(
--      url := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/refresh-symbols',
--      headers := jsonb_build_object(
--        'Content-Type', 'application/json',
--        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_apikey' LIMIT 1)
--      ),
--      body := '{}'::jsonb
--    );
--
--    then, a few seconds later:
--
--    SELECT id, status_code, left(content, 200) AS body
--    FROM net._http_response ORDER BY id DESC LIMIT 3;
--
--    Expect status_code 200. A 401 means the gateway still rejected it — check
--    that the `cron_apikey` vault secret holds a CURRENT key.
--    NOTE: a 200 here performs a real ~12,525-row upsert into symbols. That is
--    idempotent (on-conflict upsert of canonical listings) but not free.
--
-- 3. Independent confirmation via effect rather than status:
--
--    SELECT count(*) AS symbols, max(updated_at) AS last_refreshed FROM symbols;
--
--    last_refreshed should be within minutes of the manual fire in step 2.
-- ============================================================================
