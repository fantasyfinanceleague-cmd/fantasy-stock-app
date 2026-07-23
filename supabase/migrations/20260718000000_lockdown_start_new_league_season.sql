-- ============================================================================
-- LOCKDOWN: start_new_league_season — anon-callable destructive reset
-- ============================================================================
-- VULNERABILITY (confirmed on prod 2026-07-18 via pg_proc.proacl = anon=X/authenticated=X):
-- start_new_league_season(uuid) is SECURITY DEFINER with EXECUTE granted to
-- PUBLIC (inherited default — no GRANT/REVOKE was ever written for it). It is
-- therefore callable over PostgREST by ANY caller holding the publishable key,
-- INCLUDING anon (no login at all). Its only guard was a STATE check
-- (season_status = 'completed') — never an authorization check.
--
-- Impact: for any league sitting at season_status='completed' (3 such leagues at
-- time of writing), an unauthenticated caller could:
--   * DELETE every row in matchups for that league  (destructive, unrecoverable)
--   * zero every league_standings row for that league
--   * flip the league back to season_status='active', current_week=1
-- SECURITY DEFINER means RLS never applies, so the B1 hardening gave no cover.
--
-- FIX (two independent layers, both required):
--   1. Identity gate INSIDE the function — only the league's commissioner may run
--      it. auth.uid() reads the request JWT claim and works inside SECURITY
--      DEFINER (definer changes the ROLE, not the CLAIMS — same mechanic as the
--      B1 is_member/is_commissioner helpers). It is NULL for anon, so this fails
--      closed even if the grant were ever loosened again.
--   2. REVOKE EXECUTE from PUBLIC, GRANT only to authenticated — closes the anon
--      path entirely, so unauthenticated callers cannot even reach the function.
--
-- NOTE: CREATE OR REPLACE FUNCTION does NOT reset privileges — the existing
-- anon=X grant survives a replace. The REVOKE below is what actually closes the
-- anon hole; the identity gate alone would leave anon able to invoke (and fail).
--
-- All mutation logic below is PRESERVED VERBATIM from 20260125000000. The only
-- behavioural additions are the identity gate and the search_path pin.
-- ============================================================================

CREATE OR REPLACE FUNCTION start_new_league_season(
  p_league_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_season_id UUID;
  v_new_season_number INT;
BEGIN
  -- [ADDED] Identity gate: only the league's commissioner may reset the season.
  -- Checked BEFORE the state guard so that (a) an unauthorized caller learns
  -- nothing about league state, and (b) a legitimate commissioner whose season
  -- is not yet complete still receives the original, accurate message below.
  -- commissioner_id is TEXT, so cast auth.uid() (uuid) to text — same convention
  -- as the B1 policies. auth.uid() is NULL for anon => fails closed.
  IF NOT EXISTS (
    SELECT 1 FROM leagues
    WHERE id = p_league_id
      AND commissioner_id = auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Only the commissioner can start a new season';
  END IF;

  -- [UNCHANGED] Check if current season is completed
  IF NOT EXISTS (
    SELECT 1 FROM leagues
    WHERE id = p_league_id AND season_status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Current season must be completed before starting a new one';
  END IF;

  -- [UNCHANGED] Get next season number
  SELECT COALESCE(MAX(season_number), 0) + 1 INTO v_new_season_number
  FROM league_seasons
  WHERE league_id = p_league_id;

  -- [UNCHANGED] Create new season record
  INSERT INTO league_seasons (league_id, season_number)
  VALUES (p_league_id, v_new_season_number)
  RETURNING id INTO v_new_season_id;

  -- [UNCHANGED] Reset league standings
  UPDATE league_standings
  SET wins = 0, losses = 0, ties = 0, points_for = 0, points_against = 0, updated_at = now()
  WHERE league_id = p_league_id;

  -- [UNCHANGED] Delete old matchups (keep history via league_seasons.final_standings)
  DELETE FROM matchups WHERE league_id = p_league_id;

  -- [UNCHANGED] Reset league state
  UPDATE leagues
  SET
    current_season_id = v_new_season_id,
    season_status = 'active',
    current_week = 1
  WHERE id = p_league_id;

  RETURN v_new_season_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants: close the anon path. CREATE OR REPLACE above preserved the old ACL,
-- so this REVOKE is the line that actually removes anon=X.
-- Only `authenticated` retains EXECUTE (the mobile client calls it directly via
-- supabase.rpc from league-settings.tsx). If this is ever moved behind an edge
-- function (the join-league pattern), add: GRANT EXECUTE ... TO service_role;
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION start_new_league_season(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_new_league_season(uuid) TO authenticated;
