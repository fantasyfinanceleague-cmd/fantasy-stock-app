-- ============================================================================
-- Flexible playoffs (4/4): live leagues' end date covers their playoff weeks
-- ============================================================================
-- From now on finalize stamps league_end_date = the end of week
-- num_weeks + W, W = ceil(log2 playoff_teams) (schedule.ts planSeason). Leagues
-- finalized before this carry the end of the REGULAR season instead. This
-- extends them by exactly W weeks: new end = the last regular-season
-- week_end + 7·W days (a Friday 21:00Z, the end of the final playoff week,
-- the same window the bracket is dated with).
--
-- SCOPE: ONLY draft-completed matchup leagues whose season_status is 'active'
-- or 'playoffs' and that have regular-season matchups. Completed seasons,
-- duration leagues and undrafted leagues are not touched. It only ever moves an
-- end date LATER (by W weeks from the regular season's end); a league whose end
-- already equals the new value is left alone, so a re-run changes nothing.
--
-- Runs after 20261012000000, so playoff_teams is non-NULL on every matchup
-- league. Runs as the migration owner: auth.uid() is NULL, so the F1 member
-- column guard (20260925000000) lets it through.
--
-- ---------------------------------------------------------------------------
-- PRE-CHECK (read-only; the exact rows this will change, with before/after):
--   SELECT l.id, l.name, l.playoff_teams, l.season_status, l.league_end_date AS before,
--          r.last_regular_end
--            + make_interval(days => 7 * (SELECT min(w) FROM generate_series(0, 31) w
--                                          WHERE (1::bigint << w) >= l.playoff_teams)) AS after
--   FROM leagues l
--   JOIN (SELECT league_id, max(week_end) AS last_regular_end FROM matchups
--         WHERE NOT coalesce(is_playoff, false) GROUP BY league_id) r ON r.league_id = l.id
--   WHERE l.league_type = 'matchup' AND l.draft_status = 'completed'
--     AND l.season_status IN ('active', 'playoffs') AND l.playoff_teams IS NOT NULL;
--   -- expected: test_0925 and test_09_25_v2 (P = 4): 2026-10-16 21:00Z -> 2026-10-30 21:00Z
--
-- PRE-CHECK 2 (read-only; supabase-reviewer 2026-09-29): in-scope leagues with NO
-- regular-season matchups are invisible to the INNER JOIN below and keep their
-- end date. Expect 0 rows; any row needs a manual decision.
--   SELECT id, name, draft_status, season_status, league_end_date FROM leagues
--   WHERE league_type = 'matchup' AND draft_status = 'completed'
--     AND season_status IN ('active', 'playoffs')
--     AND NOT EXISTS (SELECT 1 FROM matchups m WHERE m.league_id = leagues.id
--                     AND NOT coalesce(m.is_playoff, false));
--
-- POST-PUSH EFFECT CHECK: re-run the pre-check; expect before = after on every row.
-- ============================================================================

update public.leagues l
   set league_end_date = x.new_end
  from (
    select l2.id,
           r.last_regular_end
             -- bigint shifts over 0..31 cover every int playoff_teams, so W is
             -- never NULL (an int4 shift is undefined past 31).
             + make_interval(days => 7 * (select min(w) from generate_series(0, 31) w
                                          where (1::bigint << w) >= l2.playoff_teams)) as new_end
      from public.leagues l2
      join (select league_id, max(week_end) as last_regular_end
              from public.matchups
             where not coalesce(is_playoff, false)
             group by league_id) r on r.league_id = l2.id
     where l2.league_type = 'matchup'
       and l2.draft_status = 'completed'
       and l2.season_status in ('active', 'playoffs')
       and l2.playoff_teams is not null
  ) x
 where l.id = x.id
   and l.league_end_date is distinct from x.new_end;
