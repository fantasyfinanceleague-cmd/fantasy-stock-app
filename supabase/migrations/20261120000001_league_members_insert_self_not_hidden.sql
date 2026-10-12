-- ============================================================================
-- league_members_insert_self: a player cannot insert their own membership
-- already hidden
-- ============================================================================
-- FINDING (2026-10-11, supabase-reviewer + the frozen-leaver-names worker):
-- the [I4] policy, as narrowed by 20261001000000, constrains user_id, role and
-- the league, but not hidden_at. No migration narrows Supabase's default table
-- grants on league_members (authenticated has INSERT on every column; the
-- effect test's case 1 shows it in prod), so the creator's own self-insert could
-- carry hidden_at = now(). The live predicate matches 20261001000000 exactly
-- (db-snapshot.json, captured 2026-10-07). That is not a legitimate path: hidden_at means "left a
-- FINISHED league" and is written only by leave_league / unhide_league (service
-- role; 20261107000000's column comment). A row born hidden:
--   * hides the league from its own creator's Home (get_home_summary skips it);
--   * fires #205's trg_league_members_freeze_leaver (BEFORE INSERT OR UPDATE OF
--     hidden_at), freezing the creator's name as a "leaver" of a league that has
--     not started;
--   * puts a hidden row in a not_started league, a state every pre-draft
--     reader (draft order, roster counts, Run it back) assumes cannot exist,
--     since hidden_at is otherwise only set once season_status = 'completed'.
-- The effect is on the caller's own row only, so this is hygiene, not an
-- exposure. But the policy should state the one shape its one caller sends.
--
-- THE CHANGE: the policy is a SUPERSET of 20261001000000's, re-created with one
-- added conjunct (marked "20261120000001"): hidden_at IS NULL. user_id, role and
-- the leagues EXISTS are byte-for-byte the same. The three create-league client
-- calls (useLeagues.js upsert, create-league.tsx, leagues.tsx) never send
-- hidden_at, so the column takes its NULL default and they pass unchanged. The
-- web upsert's UPDATE arm is unaffected: league_members has no UPDATE policy.
--
-- [I6] league_members_insert_bot (20260712000002) has the same gap: a member can
-- add a 'bot-%' row with hidden_at set. Left alone here, as reported to the
-- Orchestrator: [I6] is interim and is dropped by
-- supabase/migrations/deferred/20260929000000_drop_I6_I2b.sql.
--
-- POLICIES ARE NOT REPLACEABLE IN PLACE: drop + create runs in this file's one
-- transaction (db push wraps each file), so there is no window with no policy.
--
-- Previous policy (for rollback), 20261001000000:
--   create policy "league_members_insert_self" on league_members
--     for insert to authenticated
--     with check (
--       user_id = auth.uid()::text
--       and role = 'commissioner'
--       and exists (
--         select 1 from leagues l
--         where l.id = league_members.league_id
--           and l.commissioner_id = auth.uid()::text
--           and l.draft_status = 'not_started'
--       )
--     );
--
-- POST-PUSH EFFECT CHECKS (also docs/security/leaver-gaps-effect-test.sql):
--   SELECT roles, cmd, with_check FROM pg_policies
--    WHERE tablename = 'league_members' AND policyname = 'league_members_insert_self';
--   -- {authenticated}, INSERT, ... AND (hidden_at IS NULL)
-- ============================================================================

drop policy "league_members_insert_self" on league_members;

create policy "league_members_insert_self" on league_members
  for insert to authenticated
  with check (
    user_id = auth.uid()::text
    and role = 'commissioner'
    and exists (
      select 1 from leagues l
      where l.id = league_members.league_id
        and l.commissioner_id = auth.uid()::text
        and l.draft_status = 'not_started'
    )
    and hidden_at is null   -- 20261120000001: never born hidden; only leave_league hides
  );
