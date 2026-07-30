-- ============================================================================
-- SECURITY FIX (F6, MEDIUM): bound the interim league_standings INSERT policy
-- to INITIAL (zero) score values.
-- ============================================================================
-- FINDING
-- The interim [I9] INSERT policy `league_standings_insert_members` (created in
-- 20260712000005_rls_b1_05_league_standings.sql) has only:
--     with check (is_member(league_id))
-- Nothing bounds the score columns, so any league member could INSERT a
-- standings row with ARBITRARY wins/losses/ties/points_for/points_against for
-- any user_id in the league (PK is (league_id, user_id)), poisoning the
-- standings the whole league reads. `is_member` gates WHICH league you can
-- write to, but not WHAT scores you write.
--
-- WHY NOT PIN user_id = auth.uid()::text
-- The legitimate init flow does NOT insert one-row-per-caller. At draft
-- completion a SINGLE member's browser bulk-initializes standings for the
-- ENTIRE league:
--   apps/web/src/pages/DraftPage.jsx:551  completeDraft() ->
--     generateInitialStandings(leagueId, memberIds) -> insert(standingsRows)
--   apps/web/src/pages/Leaderboard.jsx:470 autoGenerateSchedule() (same helper)
-- `generateInitialStandings` (apps/web/src/utils/scheduleGenerator.js:160)
-- emits one row PER member, each with wins/losses/ties/points_for/
-- points_against all = 0. Pinning user_id = auth.uid() would REJECT that
-- honest bulk insert (the same regression class a sibling finding's first
-- patch hit), because the caller inserts rows for the OTHER members too.
--
-- THE FIX (targeted, behaviour-preserving for the honest client)
-- Keep is_member(league_id) so a member may still create the initial rows for
-- everyone, but bound EVERY score column to its initial/zero value in the
-- WITH CHECK. This is exactly what generateInitialStandings writes, so no
-- INSERT the honest client sends today is rejected; only the ability to inject
-- arbitrary win/loss/points values is removed. Standings are only advanced
-- afterward by the SECURITY DEFINER standings function / cron (service_role
-- bypasses RLS), so bounding client INSERTs to zeros does not impede scoring.
--
-- Column set + types confirmed against:
--   20251230000000_add_league_duration.sql  (wins/losses/ties int default 0;
--     points_for/points_against numeric(12,2) default 0)
--   20260116000000_matchup_scoring_redesign.sql  (wins/losses/ties retyped to
--     numeric(5,1); comparison to 0 remains exact for these scales)
--
-- Only the WITH CHECK changes. The policy name, command (INSERT), and role
-- (authenticated) are preserved verbatim; there is no USING clause on an
-- INSERT policy. This remains the interim [I9] policy and is still slated for
-- removal when schedule-gen moves server-side (mini-project #2).
-- ============================================================================

drop policy if exists "league_standings_insert_members" on league_standings;

create policy "league_standings_insert_members" on league_standings
  for insert to authenticated
  with check (
    is_member(league_id)
    and wins = 0
    and losses = 0
    and ties = 0
    and points_for = 0
    and points_against = 0
  );
