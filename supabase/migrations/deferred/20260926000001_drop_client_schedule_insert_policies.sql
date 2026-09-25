-- ============================================================================
-- DEFERRED — do NOT move into supabase/migrations/ until the precondition in
-- supabase/migrations/deferred/README.md is met and verified.
-- ============================================================================
-- Retire the interim client INSERT policies on the schedule tables:
--   [I8] matchups_insert_members          (20260712000004) — closes F10: any league
--        member could INSERT arbitrary matchups (forged pairings / weeks / dates)
--   [I9] league_standings_insert_members  (20260712000005; PR #9's F6 re-creates
--        it with zero-valued stats — IF EXISTS covers either version)
--
-- Both existed only because schedule generation ran in the web client. It now
-- runs server-side (validate-and-record-pick -> finalize_league_draft, service
-- role, bypasses RLS), and the web writers are removed, so after this migration
-- the ONLY writers of matchups / league_standings are service-role code paths.
-- The SELECT policies (matchups_select_members, league_standings_select_members)
-- are permanent and untouched.
--
-- POST-APPLY EFFECT CHECKS (run each separately):
--   -- expect exactly one row per table, cmd = SELECT
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN ('matchups', 'league_standings')
--   ORDER BY tablename, policyname;
--   -- negative test (as a real member session, via the client / PostgREST — NOT
--   -- the SQL editor, which runs as postgres and bypasses RLS): an INSERT into
--   -- matchups or league_standings must fail with 42501 / "violates row-level
--   -- security policy".
-- ============================================================================

drop policy if exists "matchups_insert_members" on public.matchups;
drop policy if exists "league_standings_insert_members" on public.league_standings;
