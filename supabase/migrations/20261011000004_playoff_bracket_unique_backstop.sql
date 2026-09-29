-- ============================================================================
-- Backstop: at most one playoff bracket per league (DB-level)
-- ============================================================================
-- start_league_playoffs (20261011000003) already makes the playoff start atomic
-- and idempotent. This index is the belt to its braces: even a FUTURE writer
-- that bypasses that function (a non-atomic insert, a manual script) cannot
-- create a second bracket for the same league.
--
-- WHAT IDENTIFIES A BRACKET POSITION
--   There is no slot column, and adding one just for this would widen the
--   change. Instead: within one league, a playoff row's (playoff_round,
--   week_number, team1_seed) is unique whenever team1_seed is set.
--     * First round: team1_seed is 1..N/2, distinct by construction
--       (buildPlayoffBracket: 1v4/2v3, 1v8/4v5/2v7/3v6, 1v2).
--     * Later rounds start as placeholders with NULL seeds (excluded by the
--       WHERE clause). advancePlayoffWinner then writes the WINNER'S OWN seed
--       into team1_seed. Seeds are unique per player within a bracket, so two
--       rows of the same round and week never receive the same team1_seed.
--   Any second bracket re-uses seed 1 in its first round, so its first insert
--   collides. (The pre-existing unique (league_id, week_number, team1_user_id)
--   only catches a second bracket with the SAME team1 players; this catches any.)
--   Not covered: a rogue writer inserting ONLY NULL-seed placeholders. That is
--   harmless to scoring, since the pending-matchup query skips team1 IS NULL rows.
--
-- PRE-CHECK (read-only; run BEFORE db push, expect ZERO rows). A duplicate from
-- an old non-atomic run would make CREATE UNIQUE INDEX fail and stop the push
-- at this file (000000-000003 would already be applied, which is fine; they do
-- not depend on this index):
--   SELECT league_id, playoff_round, week_number, team1_seed, count(*)
--   FROM matchups
--   WHERE is_playoff AND team1_seed IS NOT NULL
--   GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;
--
-- POST-PUSH EFFECT CHECK:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'matchups_one_bracket_per_league';
-- ============================================================================

create unique index if not exists matchups_one_bracket_per_league
  on matchups (league_id, playoff_round, week_number, team1_seed)
  where is_playoff and team1_seed is not null;
