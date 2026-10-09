-- ============================================================================
-- complete_league_season: serialize with record_trade_atomic (Run it back)
-- ============================================================================
-- The security review's MEDIUM finding. A season completion sets
-- season_status = 'completed', and record_trade_atomic refuses trades in a
-- completed season, but the two did not share a lock: a trade could read
-- 'active' under its lock while a completion committed afterwards.
--
-- The body is 20261015000000's, verbatim, plus ONE statement after the league row
-- lock: the record-trade advisory lock (the same key record_trade_atomic takes).
-- Grants are restated (CREATE OR REPLACE keeps the ACL).
-- ============================================================================

CREATE OR REPLACE FUNCTION complete_league_season(
  p_league_id UUID,
  p_champion_user_id TEXT,
  p_runner_up_user_id TEXT
) RETURNS void AS $$
DECLARE
  v_league        leagues%ROWTYPE;
  v_season_id     UUID;
  v_existing      RECORD;
  v_final_round   INT;
  v_final_count   INT;
  v_final         RECORD;
  v_expected_runner_up TEXT;
  v_standings     JSONB;
  v_updated       INT;
BEGIN
  -- Lock the league row FIRST: a concurrent caller for the SAME league (the
  -- in-loop call racing the heal, or two overlapping heal runs) blocks here
  -- until this call commits or rolls back, so every check below sees a
  -- consistent, serialized view rather than racing the writes at the bottom.
  SELECT * INTO v_league FROM leagues WHERE id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'League % not found', p_league_id;
  END IF;

  -- Run it back (security review, MEDIUM): take the record-trade advisory lock
  -- too. record_trade_atomic reads season_status under THIS key and refuses a
  -- trade in a completed season; without the lock, a trade that read 'active' could
  -- commit into a season that completes after its read. Lock order: this row lock,
  -- then the advisory key. record_trade_atomic takes the advisory key first and its
  -- own league read is a plain SELECT, so it never waits on the row lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('record-trade:' || p_league_id::text, 0));

  v_season_id := v_league.current_season_id;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION 'League has no active season';
  END IF;

  -- Idempotent re-call, keyed on the RESULT, not just "is it done": the heal
  -- calls this rpc on every run for every league still in 'playoffs' with a
  -- scored final, so a season completed on an earlier run must be a safe
  -- no-op here -- but only for the SAME result. A different champion/runner-up
  -- would silently overwrite final_standings and the podium, so that refuses.
  SELECT completed_at, champion_user_id, runner_up_user_id
    INTO v_existing
    FROM league_seasons
   WHERE id = v_season_id;

  IF v_existing.completed_at IS NOT NULL THEN
    IF v_existing.champion_user_id = p_champion_user_id
       AND v_existing.runner_up_user_id = p_runner_up_user_id THEN
      RETURN; -- already completed with this exact result -- a harmless retry
    END IF;
    RAISE EXCEPTION
      'League % season already completed with a different result (champion %, runner-up %)',
      p_league_id, v_existing.champion_user_id, v_existing.runner_up_user_id;
  END IF;

  IF v_league.season_status IS DISTINCT FROM 'playoffs' THEN
    RAISE EXCEPTION 'League % is not in playoffs (season_status=%)', p_league_id, v_league.season_status;
  END IF;

  -- Verify champion/runner-up against the SCORED FINAL: the single is_playoff
  -- row at this league's highest playoff_round_number, found BY ADDRESS (never
  -- by the playoff_round label) -- same discipline as
  -- advancePlayoffWinner/planAdvance and this migration's TS twin,
  -- decideSeasonCompletion (process-week-results/season-completion.ts).
  SELECT max(playoff_round_number) INTO v_final_round
    FROM matchups WHERE league_id = p_league_id AND is_playoff;

  IF v_final_round IS NULL THEN
    RAISE EXCEPTION 'League % has no playoff rows to complete from', p_league_id;
  END IF;

  SELECT count(*) INTO v_final_count
    FROM matchups
   WHERE league_id = p_league_id AND is_playoff AND playoff_round_number = v_final_round;
  IF v_final_count <> 1 THEN
    RAISE EXCEPTION 'League % has % rows at the final round % (expected exactly 1)',
      p_league_id, v_final_count, v_final_round;
  END IF;

  SELECT team1_user_id, team2_user_id, winner_user_id
    INTO v_final
    FROM matchups
   WHERE league_id = p_league_id AND is_playoff AND playoff_round_number = v_final_round;

  IF v_final.winner_user_id IS NULL THEN
    RAISE EXCEPTION 'League % final (round %) is not scored yet (no winner)', p_league_id, v_final_round;
  END IF;
  -- Checked as an explicit IS NULL guard, not `winner_user_id NOT IN (t1, t2)`:
  -- NOT IN with a NULL list element evaluates to NULL/UNKNOWN, which an IF
  -- treats as not-true and would silently skip the refusal below (the same
  -- "overloaded NULL" trap CLAUDE.md documents for application code).
  IF v_final.team1_user_id IS NULL OR v_final.team2_user_id IS NULL THEN
    RAISE EXCEPTION 'League % final (round %) has an empty slot', p_league_id, v_final_round;
  END IF;
  IF v_final.winner_user_id <> v_final.team1_user_id AND v_final.winner_user_id <> v_final.team2_user_id THEN
    RAISE EXCEPTION 'League % final winner % is not a participant', p_league_id, v_final.winner_user_id;
  END IF;

  -- IS DISTINCT FROM, not <>: p_champion_user_id/p_runner_up_user_id are
  -- caller-supplied and a plain <> against a NULL parameter evaluates to
  -- NULL/UNKNOWN, which an IF treats as not-true and would let a NULL
  -- champion/runner-up slip past this refusal and get written below -- the
  -- exact NULL-vs-UNKNOWN trap this migration already guards against for
  -- v_final.winner_user_id above, just one step earlier in the chain
  -- (security review, F-B).
  IF p_champion_user_id IS DISTINCT FROM v_final.winner_user_id THEN
    RAISE EXCEPTION 'League % champion % does not match the scored final winner %',
      p_league_id, p_champion_user_id, v_final.winner_user_id;
  END IF;
  v_expected_runner_up := CASE WHEN v_final.winner_user_id = v_final.team1_user_id
                                THEN v_final.team2_user_id ELSE v_final.team1_user_id END;
  IF p_runner_up_user_id IS DISTINCT FROM v_expected_runner_up THEN
    RAISE EXCEPTION 'League % runner-up % does not match the scored final loser %',
      p_league_id, p_runner_up_user_id, v_expected_runner_up;
  END IF;

  -- Snapshot final standings. Rank source: public.league_standings_ranked
  -- (20261011000000) -- unchanged from 20261011000002.
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

  UPDATE league_seasons
  SET
    champion_user_id = p_champion_user_id,
    runner_up_user_id = p_runner_up_user_id,
    completed_at = now(),
    final_standings = v_standings
  WHERE id = v_season_id AND completed_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'League % season completion update affected % rows (expected 1)', p_league_id, v_updated;
  END IF;

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
