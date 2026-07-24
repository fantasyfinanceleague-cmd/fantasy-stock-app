-- ============================================================================
-- HARDENING: pin search_path on every unpinned SECURITY DEFINER function
-- ============================================================================
-- The excluded concern from the 20260718000000-000002 + 20260724000000 lockdown
-- family. Those four migrations are deliberately single-concern: they only
-- re-assert EXECUTE grants (REVOKE FROM PUBLIC / FROM anon; GRANT to the one
-- intended role) so each is trivially reviewable. search_path was left out on
-- purpose. This migration is that leftover, and nothing else -- it changes no
-- grant and no function body.
--
-- WHY IT MATTERS
-- A SECURITY DEFINER function runs with the DEFINER's privileges (here: the
-- table owner, for whom RLS does not apply). If its search_path is NOT pinned,
-- the function resolves unqualified names using the CALLER's search_path. A
-- caller who can create objects in any schema on that path can shadow an
-- unqualified reference -- a table, a function, an operator, a cast -- and the
-- shadowing object then executes with the DEFINER's privileges. That is the
-- classic definer privilege-escalation footgun, and it is orthogonal to the
-- EXECUTE grants the lockdown family already closed: grants control WHO may
-- call; search_path controls WHAT the call resolves to once it is running.
--
-- SCOPE (inventory re-verified 2026-07-24 against supabase/migrations/)
-- Twelve SECURITY DEFINER functions exist. No DROP FUNCTION exists anywhere in
-- the migration history, so for multiply-defined functions the LATEST
-- CREATE OR REPLACE is the live definition and is what was inspected.
--
--   Already pinned (5) -- NOT touched here; each verified still pinned in its
--   latest definition:
--     is_member(uuid)                              20260712000000:38
--     is_commissioner(uuid)                        20260712000000:52
--     check_and_bump_rate_limit(text,text,int,int)  20260716000000:31
--     join_league_by_code(text,text)                20260716000000:59
--     start_new_league_season(uuid)                 20260718000000:41
--       (re-created there WITH the pin, superseding the unpinned 20260125000000
--        definition -- the pin is live.)
--
--   Unpinned (7) -- all pinned below, in two sections.
--
-- WHY `= public` AND NOT `= pg_catalog` / `= ''`
-- Four of the seven reference unqualified objects that live in `public`
-- (league_standings, leagues, league_seasons, cron_job_status), so they REQUIRE
-- public on the path; narrowing them would break them outright. The other three
-- reference only schema-qualified objects (vault., net., auth.) plus pg_catalog
-- builtins, so they COULD take a stricter target. They are pinned to `public`
-- anyway, deliberately:
--   1. The threat model is CALLER-CONTROLLED search_path. Pinning to any fixed
--      value closes it completely; `public` vs `''` only changes which schema an
--      already-privileged actor would have to plant an object in, and `public`
--      here is owner-controlled (no client role holds CREATE on it -- see the
--      verification note below to confirm this still holds).
--   2. Uniformity across all twelve makes the audit a single equality check
--      (proconfig = {search_path=public}) instead of a per-function judgement,
--      and matches the five already-pinned functions. A split convention would
--      cost a future reviewer more than the marginal narrowing buys.
--
-- KNOWN RESIDUAL, accepted and not chased here: `= public` does not list
-- pg_temp, and Postgres searches the temp schema FIRST for RELATION and TYPE
-- names when pg_temp is not explicitly listed (it is never searched for
-- function or operator names). So the four functions with unqualified public
-- TABLE references remain theoretically shadowable by a temp table. Exploiting
-- it requires executing arbitrary SQL (CREATE TEMP TABLE) in the same session
-- as the call, which PostgREST does not offer any client role -- and an actor
-- who already has arbitrary SQL does not need the function. Closing it means
-- `SET search_path = public, pg_temp` on ALL TWELVE (splitting the convention
-- otherwise), which is its own single-concern migration, not this one.
--
-- WHY ALTER AND NOT CREATE OR REPLACE
-- ALTER FUNCTION ... SET writes only pg_proc.proconfig; it cannot touch the
-- body, so this migration cannot regress behaviour. CREATE OR REPLACE rewrites
-- the whole pg_proc row and DROPS any SET clause not restated -- which is
-- exactly how a pin gets silently lost. CAVEAT FOR FUTURE WORK: any later
-- CREATE OR REPLACE of the functions below will drop these pins. Carry
-- `SET search_path = public` forward in the new definition, or re-run an ALTER.
--
-- IDEMPOTENCY: ALTER FUNCTION ... SET search_path assigns the setting outright.
-- Re-running is a no-op on an already-pinned function -- no error, no change.
-- Safe to re-apply. Signatures below are exact; a mismatch fails loudly rather
-- than silently pinning nothing.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SECTION 1 -- the four functions already inventoried by the lockdown family.
-- Grants for all four were set by 20260718000002 / 20260724000000; this adds
-- only the search_path pin.
-- ----------------------------------------------------------------------------

-- complete_league_season(uuid, text, text) -- service_role ONLY (grants set in
-- 20260718000002). Called only by process-week-results (cron). Body reads
-- `leagues` and `league_standings` and writes `league_seasons` + `leagues`, all
-- UNQUALIFIED -- the highest-value target in this set, since a shadowed
-- `league_standings` would feed forged rows into a definer-privileged UPDATE.
-- Requires `public` on the path.
ALTER FUNCTION complete_league_season(uuid, text, text) SET search_path = public;

-- schedule_snapshot_retry(text, int) -- service_role ONLY (grants set in
-- 20260718000002). Latest definition is 20260618000001 (supersedes
-- 20260116000000 and 20260612000000). Body calls cron.schedule /
-- cron.unschedule and vault.decrypted_secrets QUALIFIED, but writes
-- `cron_job_status` unqualified. Requires `public` on the path.
-- Note: the dollar-quoted command text it schedules is executed LATER by
-- pg_cron under pg_cron's own context -- that string's resolution is not
-- governed by this pin, which is why its references are schema-qualified.
ALTER FUNCTION schedule_snapshot_retry(text, int) SET search_path = public;

-- trigger_week_end_snapshot() -- MANUAL recovery helper; EXECUTE stripped from
-- all client roles and granted to no one (20260718000002), run by the owner in
-- the SQL editor. Latest definition is 20260612000000 (supersedes
-- 20260116000000). Body is fully schema-qualified (vault.decrypted_secrets,
-- net.http_post) plus pg_catalog builtins -- pinned to `public` for uniformity,
-- not necessity. Highest-consequence body in the set: it reads the `cron_apikey`
-- vault secret and POSTs it to an edge function.
ALTER FUNCTION trigger_week_end_snapshot() SET search_path = public;

-- get_real_user_ids(text[]) -- authenticated ONLY; anon EXECUTE revoked in
-- 20260724000000 (the grant was intentional, then decided against). LANGUAGE
-- SQL. Body reads auth.users QUALIFIED, so `public` is for uniformity. It is
-- the only function here reachable by a CLIENT role, which makes it the only
-- one where a caller-controlled search_path was ever directly exploitable --
-- the `id::text` cast and the `= any(...)` operator are both resolvable through
-- the path, and it crosses the auth.users boundary with definer privileges.
ALTER FUNCTION get_real_user_ids(text[]) SET search_path = public;


-- ----------------------------------------------------------------------------
-- SECTION 2 -- three SECURITY DEFINER functions the lockdown family MISSED.
--
-- 20260718000002's header claims "a full inventory of SECURITY DEFINER
-- functions". Re-verifying scope for THIS migration found that inventory was
-- incomplete: these three are SECURITY DEFINER, are unpinned, and were never
-- reviewed by 20260718000001/000002. They are pinned here because the concern
-- is identical and leaving them out would leave the stated goal unmet.
--
-- !! SEPARATE FOLLOW-UP REQUIRED -- NOT ADDRESSED BY THIS MIGRATION !!
-- Because they were never inventoried, their EXECUTE GRANTS were never
-- re-asserted, so all three presumably still carry Supabase's default
-- anon=X / authenticated=X (see 20260718000001's header for why REVOKE FROM
-- PUBLIC did not remove those). Two of them read a vault secret and POST it to
-- an edge function. Confirm with the proacl query in the handoff notes and, if
-- confirmed, close them in a grants-only migration -- this file changes no
-- grant.
-- ----------------------------------------------------------------------------

-- update_standings(uuid, text, boolean, boolean, boolean, numeric, numeric) --
-- 20251230200000. Upserts `league_standings` UNQUALIFIED; requires `public` on
-- the path. Same shadowing exposure as complete_league_season.
ALTER FUNCTION update_standings(uuid, text, boolean, boolean, boolean, numeric, numeric)
  SET search_path = public;

-- trigger_week_processing() -- 20251230210000. Manual/admin trigger. Reads the
-- `service_role_key` vault secret and POSTs it to process-week-results. Body is
-- schema-qualified (vault., net.); pinned for uniformity.
ALTER FUNCTION trigger_week_processing() SET search_path = public;

-- trigger_week_snapshot() -- 20260105100000. Manual/admin trigger. Reads the
-- `service_role_key` vault secret and POSTs it to snapshot-week-start. Body is
-- schema-qualified (vault., net.); pinned for uniformity.
ALTER FUNCTION trigger_week_snapshot() SET search_path = public;
