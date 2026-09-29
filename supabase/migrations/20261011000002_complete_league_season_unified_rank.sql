-- ============================================================================
-- complete_league_season: final_standings.rank from league_standings_ranked
-- ============================================================================
-- Re-creates complete_league_season(uuid, text, text) with its body VERBATIM
-- (latest definition: 20260125000000) except the final-standings snapshot,
-- whose rank now comes from public.league_standings_ranked (20261011000000)
-- instead of row_number() OVER (ORDER BY wins DESC, points_for DESC). Season
-- history (mobile league.tsx reads final_standings[].rank) therefore shows the
-- same order the standings screen showed and the playoffs were seeded from.
--
-- Everything else is preserved exactly:
--   * SECURITY DEFINER (restated; CREATE OR REPLACE would otherwise reset it)
--   * search_path = public, pinned by 20260724000002 via ALTER FUNCTION.
--     CREATE OR REPLACE REPLACES the SET clause, so it is restated in the
--     definition -- omitting it would silently clear the pin.
--   * grants: service_role ONLY (20260718000002). CREATE OR REPLACE keeps the
--     ACL; the grant block is re-run so this file is correct on its own.
-- The PGlite test asserts proacl, prosecdef and proconfig are identical before
-- and after this migration.
--
-- As a DEFINER (owner postgres), its call into the INVOKER ranking function runs
-- as the owner and bypasses RLS, so it ranks the whole league.
--
-- POST-PUSH EFFECT CHECKS (run each separately):
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'complete_league_season';
--   -- expect: service_role=X (+ postgres) only; prosecdef = t;
--   --         proconfig = {search_path=public} -- same as before
-- ============================================================================

CREATE OR REPLACE FUNCTION complete_league_season(
  p_league_id UUID,
  p_champion_user_id TEXT,
  p_runner_up_user_id TEXT
) RETURNS void AS $$
DECLARE
  v_season_id UUID;
  v_standings JSONB;
BEGIN
  -- Get current season id
  SELECT current_season_id INTO v_season_id
  FROM leagues
  WHERE id = p_league_id;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'League has no active season';
  END IF;

  -- Snapshot final standings. Rank source: public.league_standings_ranked
  -- (20261011000000) -- the same order the standings screen shows and playoff
  -- seeding uses. The only change from 20260125000000 (which ranked by
  -- wins DESC, points_for DESC). The aggregate is now ORDER BY rank so the
  -- stored array reads in standings order; readers key on 'rank', not position.
  SELECT json_agg(row_data ORDER BY rnk) INTO v_standings
  FROM (
    SELECT json_build_object(
      'user_id', r.user_id,
      'rank', r.rank,
      'wins', r.wins,
      'losses', r.losses,
      'ties', r.ties,
      'points_for', r.points_for,
      'points_against', r.points_against
    ) AS row_data,
    r.rank AS rnk
    FROM public.league_standings_ranked(p_league_id) r
  ) ranked;

  -- Update season record
  UPDATE league_seasons
  SET
    champion_user_id = p_champion_user_id,
    runner_up_user_id = p_runner_up_user_id,
    completed_at = now(),
    final_standings = v_standings
  WHERE id = v_season_id;

  -- Update league status
  UPDATE leagues
  SET season_status = 'completed'
  WHERE id = p_league_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

REVOKE ALL ON FUNCTION complete_league_season(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_league_season(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION complete_league_season(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION complete_league_season(uuid, text, text) TO service_role;
