-- ============================================================================
-- complete_league_season: guarded + idempotent (F-B season completion heal)
-- ============================================================================
-- PROBLEM
--   completeSeasonFromPlayoffs (process-week-results/index.ts) called this rpc
--   and only LOGGED its `{ error }` (CLAUDE.md "Success signals" #5:
--   supabase-js `.rpc()` resolves `{ data, error }` and never throws on a
--   Postgres error). Nothing ever retried it, and the caller logged "Season
--   completed successfully" regardless of whether the call actually
--   succeeded. A failed call (observed cause: current_season_id NULL -> "League
--   has no active season", see 20260926000000's header) left the league at
--   season_status='playoffs' with its final matchup already scored FOREVER:
--   the pending-matchup query selects on team1_gain IS NULL, and a scored
--   final never matches that again, so the in-loop call site was the ONLY
--   call site and it ran exactly once per league. A read-only
--   get_season_result rpc drafted on a separate, not-yet-merged branch
--   (feat/season-result-summary, commit dceeb40) would then correctly, and
--   permanently, report the league as not_complete -- named here only as the
--   reporting side this migration is the write-side counterpart to, not as
--   something this migration depends on or that has landed on main.
--
-- FIX, split across two layers:
--   1. process-week-results now checks the rpc's `{ error }` and adds a heal
--      pass (season-completion.ts: healUncompletedSeasons) that runs BEFORE
--      the pending-matchup query -- same placement as the existing
--      healRefusedTransitions / healMissedAdvances -- so it also runs on the
--      early-return "no pending matchups" path, which is exactly the path a
--      stranded league takes every week thereafter.
--   2. THIS MIGRATION hardens the rpc itself, because the heal calls it
--      REPEATEDLY by design (every run, for every league still in 'playoffs'
--      whose final is scored) -- so the rpc must not trust its caller:
--        a. locks the league row, so two concurrent callers (the in-loop call
--           racing the heal, or two heal runs) serialize here instead of
--           racing the season_seasons UPDATE below;
--        b. a re-call with the SAME champion/runner-up on an already-completed
--           season is a no-op success (RETURN) -- makes the heal's repeated
--           calls harmless once completion has already landed;
--        c. a re-call with a DIFFERENT champion/runner-up on an
--           already-completed season RAISEs -- never silently overwrites
--           final_standings / champion_user_id with a second answer;
--        d. a league not in season_status = 'playoffs' RAISEs -- refuses to
--           "complete" an active regular season;
--        e. the champion/runner-up are verified against the SCORED FINAL
--           (the single is_playoff row at the league's highest
--           playoff_round_number) before anything is written -- the same
--           champion_mismatch check the not-yet-merged get_season_result rpc
--           (see PROBLEM above) does read-side, done here at write time
--           instead of only reported after the fact;
--        f. the season UPDATE is guarded WHERE completed_at IS NULL and its
--           row count is checked (CLAUDE.md "success signals" #5 shape again,
--           applied to this function's OWN write, not just its caller's).
--   Every refusal RAISEs (unchanged calling convention: this function has
--   always RETURNS void and communicated failure by raising, and
--   completeLeagueSeason / the heal read that via supabase-js's `{ error }`,
--   same as every other rpc call in this file). A raise leaves the league at
--   season_status='playoffs' (the whole function body is one transaction), so
--   the heal pass retries it next run -- never a half-written completion.
--
-- WHAT IS *NOT* CHANGED: everything from 20261011000002 -- the standings
-- snapshot query (rank source: league_standings_ranked), SECURITY DEFINER,
-- the search_path pin, and the grants (service_role only; CREATE OR REPLACE
-- does not reset either, both are restated here as before).
--
-- LEGACY BRACKET ROWS (playoff_round_number/bracket_position NULL on an
-- is_playoff row): not handled here as a distinct guard, because it is not
-- possible to hit for any row satisfying is_playoff=true since
-- 20261012000000's `matchups_playoff_address` CHECK constraint applied (every
-- is_playoff row must carry both fields, or is_playoff must be false) --
-- max(playoff_round_number) below can only be NULL when there are no playoff
-- rows at all, which the "no playoff rows to complete from" refusal already
-- covers. process-week-results' TS-side decideSeasonCompletion (which reads
-- the same columns through supabase-js's nullable-by-column-type generated
-- types, not through this constraint) still checks for it explicitly as
-- defense in depth -- see season-completion.ts's SeasonPlayoffRow doc comment.
--
-- PRE-PUSH QUERIES (read-only; run BEFORE db push)
--   -- (1) currently stranded leagues this heal will pick up on the next run:
--   SELECT l.id, l.season_status, l.current_season_id,
--          m.playoff_round_number AS final_round, m.winner_user_id AS scored_champion
--   FROM leagues l
--   JOIN matchups m ON m.league_id = l.id AND m.is_playoff
--    AND m.playoff_round_number = (SELECT max(playoff_round_number) FROM matchups
--                                   WHERE league_id = l.id AND is_playoff)
--   WHERE l.league_type = 'matchup' AND l.season_status = 'playoffs'
--     AND m.team1_gain IS NOT NULL;
--   -- (2) legacy-bracket-row exposure (expect 0 -- confirms the CHECK holds):
--   SELECT count(*) FROM matchups WHERE is_playoff
--     AND (playoff_round_number IS NULL OR bracket_position IS NULL);
--
-- POST-PUSH EFFECT CHECKS (run each separately)
--   -- 1. grants/security unchanged from 20261011000002:
--   SELECT proname, proacl, prosecdef, proconfig FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname = 'complete_league_season';
--   -- expect: service_role=X (+ postgres) only; prosecdef = t;
--   --         proconfig = {search_path=public}
--   -- 2. re-run query (1) above -- each listed league should now show
--   --    season_status = 'completed' after the next process-week-results run
--   --    (cron, or a manual invocation) with the heal in place.
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
