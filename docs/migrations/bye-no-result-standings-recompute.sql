-- ============================================================================
-- Bye = NO RESULT: find and correct standings written under the old rule
-- ============================================================================
-- NOT A MIGRATION. `supabase db push` never reads this directory. Run the
-- steps by hand in the SQL editor, in order. Step 3 CHANGES DATA; run it only
-- after reading steps 1-2's output, and only for the leagues you choose.
--
-- BACKGROUND
--   Until the fix/unified-league-ranking deploy, process-week-results scored a
--   regular-season bye as an automatic WIN (winner_user_id = the bye manager,
--   +1 to wins). From that deploy on, a bye is NO RESULT (winner NULL,
--   is_tie false, no W/L/T; the week's gain still goes to points_for).
--   league_standings_ranked ranks by win% = (W + 0.5*T) / (W+L+T), so any bye
--   win already recorded inflates both W and games played for that manager.
--
-- WHICH LEAGUES CAN BE AFFECTED (reasoning, no query run):
--   Only leagues with an ODD roster (a BYE seat is added by
--   _shared/schedule.ts roundRobinPairings) whose regular-season weeks were
--   SCORED before the deploy. As of 2026-09-29:
--     * test_0925 / test_09_25_v2: first scoring run is Fri 2026-10-02 21:15
--       UTC. If the deploy lands before that, and either roster is odd, they
--       will never record a bye win: nothing to correct. If it lands after,
--       an odd roster has bye wins from each Friday before the deploy.
--     * The three old test leagues are season_status = 'completed'. Their
--       league_seasons.final_standings is a historical snapshot. Recommend
--       NOT rewriting completed seasons; step 3 skips them.
--
-- ============================================================================
-- STEP 1 (read-only): scored bye rows still carrying the OLD bye-as-win shape
-- ============================================================================
SELECT l.id, l.name, l.season_status,
       count(*) AS legacy_bye_wins
FROM matchups m
JOIN leagues l ON l.id = m.league_id
WHERE m.team2_user_id IS NULL
  AND NOT coalesce(m.is_playoff, false)
  AND m.team1_gain IS NOT NULL
  AND m.winner_user_id = m.team1_user_id
GROUP BY l.id, l.name, l.season_status
ORDER BY l.season_status, l.name;

-- ============================================================================
-- STEP 2 (read-only): stored W/L/T vs W/L/T recomputed from scored non-bye games
-- Rows returned = managers whose standings would change in step 3.
-- ============================================================================
WITH games AS (
  SELECT s.league_id, s.user_id,
         count(m.id) FILTER (WHERE m.winner_user_id = s.user_id)                                   AS w,
         count(m.id) FILTER (WHERE m.winner_user_id IS NOT NULL AND m.winner_user_id <> s.user_id) AS l,
         count(m.id) FILTER (WHERE m.id IS NOT NULL AND m.winner_user_id IS NULL)                  AS t
  FROM league_standings s
  JOIN leagues lg ON lg.id = s.league_id AND lg.season_status <> 'completed'
  LEFT JOIN matchups m
    ON m.league_id = s.league_id
   AND s.user_id IN (m.team1_user_id, m.team2_user_id)
   AND NOT coalesce(m.is_playoff, false)
   AND m.team1_gain IS NOT NULL        -- scored
   AND m.team2_user_id IS NOT NULL     -- not a bye
  GROUP BY s.league_id, s.user_id
)
SELECT g.league_id, g.user_id,
       s.wins AS stored_w, s.losses AS stored_l, s.ties AS stored_t,
       g.w AS new_w, g.l AS new_l, g.t AS new_t
FROM games g
JOIN league_standings s USING (league_id, user_id)
WHERE (s.wins, s.losses, s.ties) IS DISTINCT FROM (g.w::numeric, g.l::numeric, g.t::numeric)
ORDER BY g.league_id, g.user_id;

-- ============================================================================
-- STEP 3 (DATA-CHANGING, HUMAN ACTION): recompute W/L/T for chosen leagues
--   * Only W/L/T. points_for / points_against are deliberately untouched:
--     bye-week gains stay in season gain under the new rule too.
--   * Skips completed seasons.
--   * Also rewrites legacy bye rows to the NO RESULT shape, so no consumer
--     ever sees a bye with a winner again.
--   Replace the league id list, run inside BEGIN, re-run step 2 (expect 0 rows
--   for those leagues), then COMMIT (or ROLLBACK).
-- ============================================================================
-- BEGIN;
--
-- WITH target AS (
--   SELECT id FROM leagues
--   WHERE id = ANY (ARRAY['<league-uuid>']::uuid[]) AND season_status <> 'completed'
-- ),
-- games AS (
--   SELECT s.league_id, s.user_id,
--          count(m.id) FILTER (WHERE m.winner_user_id = s.user_id)                                   AS w,
--          count(m.id) FILTER (WHERE m.winner_user_id IS NOT NULL AND m.winner_user_id <> s.user_id) AS l,
--          count(m.id) FILTER (WHERE m.id IS NOT NULL AND m.winner_user_id IS NULL)                  AS t
--   FROM league_standings s
--   JOIN target t ON t.id = s.league_id
--   LEFT JOIN matchups m
--     ON m.league_id = s.league_id
--    AND s.user_id IN (m.team1_user_id, m.team2_user_id)
--    AND NOT coalesce(m.is_playoff, false)
--    AND m.team1_gain IS NOT NULL
--    AND m.team2_user_id IS NOT NULL
--   GROUP BY s.league_id, s.user_id
-- )
-- UPDATE league_standings s
--    SET wins = g.w, losses = g.l, ties = g.t, updated_at = now()
--   FROM games g
--  WHERE s.league_id = g.league_id AND s.user_id = g.user_id;
--
-- UPDATE matchups m
--    SET winner_user_id = NULL, is_tie = false
--  WHERE m.league_id IN (SELECT id FROM leagues
--                        WHERE id = ANY (ARRAY['<league-uuid>']::uuid[])
--                          AND season_status <> 'completed')
--    AND m.team2_user_id IS NULL
--    AND NOT coalesce(m.is_playoff, false)
--    AND m.team1_gain IS NOT NULL
--    AND m.winner_user_id = m.team1_user_id;
--
-- -- re-run STEP 2 here; expect no rows for the target leagues
-- COMMIT;
