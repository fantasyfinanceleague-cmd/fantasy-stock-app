-- PROPOSED, NOT APPLIED (supabase/migrations/deferred/ is outside db push).
-- Lockdown audit #7. Ruling 2026-10-08: "I don't want people to be able to
-- scrape anything and the more secure and locked down this can be the better."
--
-- WHAT IT CLOSES
-- Supabase grants ALL on every new public table (and sequence) to anon, and
-- EXECUTE on every new function to anon and authenticated, through default
-- privileges set FOR ROLE postgres IN SCHEMA public. Postgres itself grants
-- EXECUTE on every new function to PUBLIC. Today RLS is the only thing between
-- anon and most tables: one future policy written TO public, or one table
-- created without RLS, is an anonymous read. This removes the anon half of the
-- two-gate model for every existing object AND for every object created later
-- by migrations (which run as postgres):
--   * REVOKE ALL on every public table, view and sequence FROM anon;
--   * REVOKE EXECUTE on every public function FROM anon and PUBLIC (after
--     20261116000000 there are none left in prod; this is the sweep);
--   * the default privileges for objects postgres creates: no table/sequence
--     grant to anon, no function EXECUTE to anon -- and, GLOBALLY (Postgres
--     only allows the built-in PUBLIC default to be revoked globally), none to
--     PUBLIC.
--
-- PRECONDITIONS (all three; see deferred/README.md)
--   1. security/lockdown-symbols stage 1 (PR #175) is DEPLOYED: before it,
--      symbols-search and symbol-name read symbols as anon and would go empty.
--   2. 20261116000000 is applied (it is the function half of this sweep, and
--      its tests assume the trigger functions' grants it sets).
--   3. A fresh db-snapshot.json captured with the 2026-10-08 db-snapshot.sql,
--      confirming no anon grant is load-bearing:
--        - no storage bucket relies on anon table access (storageBuckets);
--        - defaultPrivileges shows the postgres/public rules this edits.
--
-- PRODUCT-IMPACT CHECK (done 2026-10-08, from the repo)
--   * No pre-sign-in screen reads a table or calls an RPC. The one anon WRITE
--     in the codebase is the user_profiles upsert straight after signUp
--     (apps/mobile/lib/SessionProvider.tsx, apps/web/src/pages/Login.jsx) when
--     email confirmation leaves NO session: it already fails today (RLS, 42501,
--     auth.uid() is null) and will fail with 42501 "permission denied" after --
--     same SQLSTATE, same client path (it only special-cases 23505), and the
--     username is written by the handle_new_user_profile trigger anyway.
--   * Edge functions read as service_role or as the caller; after stage 1 none
--     reads a table as bare anon (supabase/tests/symbols_readers.test.ts).
--   * Auth hooks and the signup trigger run as supabase_auth_admin / owner,
--     not anon. Schema USAGE for anon is kept (PostgREST needs it to answer
--     401/42501 rather than 404).
--   * PROCESS CHANGE: every NEW function must GRANT EXECUTE explicitly to the
--     roles that call it (authenticated / service_role). The repo's
--     convention already does this (CLAUDE.md "Postgres function grants"); a
--     migration that relied on the default grant would now be uncallable --
--     a loud failure, not a silent exposure.
--
-- POST-APPLY CHECKS (SQL editor; each on its own)
--   -- EXPECT 0 rows: no public table/view/sequence grants anon anything.
--   SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
--      AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
--        OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'));
--   -- EXPECT 0 rows: no public function is anon-callable.
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
--   -- EXPECT no 'anon=' entry on any postgres rule, and the global 'f' rule
--   -- without '=X' (PUBLIC): re-run docs/architecture/db-snapshot.sql and read
--   -- defaultPrivileges.
--   -- Effect: signed in, the app works end to end (Home, draft room, money);
--   -- signed out, GET /rest/v1/<any table>?limit=1 with only the publishable
--   -- key returns 401 / 42501.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
-- The built-in PUBLIC EXECUTE default can only be removed by a GLOBAL rule.
alter default privileges for role postgres revoke execute on functions from public;
